import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, getRoomId, type Message, type MediaStore } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { encryptFile, decryptPayload, type EncryptedMediaPayload } from '@/lib/crypto';
import { saveMedia, getMedia, deleteMedia } from '@/lib/vault';
import { playMessageReceived, playMessageSent } from '@/lib/sounds';
import { sendNotificationViaEdgeFunction } from '@/lib/push';

export type ChatMessage = Message & {
  mediaUrl?: string;
  mediaFileName?: string;
  isMine: boolean;
  uploading?: boolean;
  uploadError?: boolean;
  mediaError?: boolean;
};

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function useMessages(currentUserId: string, peerId: string | null, peerDisplayName?: string, currentDisplayName?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mediaUrlCache = useRef<Map<string, string>>(new Map());
  const pendingDecrypt = useRef<Set<string>>(new Set());

  const roomId = peerId ? getRoomId(currentUserId, peerId) : null;

  async function resolveMedia(msg: Message): Promise<{ mediaUrl?: string; mediaFileName?: string; mediaError?: boolean }> {
    if (!msg.media_id || msg.deleted_for_everyone) return {};
    if (mediaUrlCache.current.has(msg.media_id)) {
      return { mediaUrl: mediaUrlCache.current.get(msg.media_id) };
    }

    if (pendingDecrypt.current.has(msg.media_id)) return {};
    pendingDecrypt.current.add(msg.media_id);

    try {
      let vaultEntry = await getMedia(msg.media_id);
      if (!vaultEntry) {
        const { data: stored } = await supabase
          .from('media_store')
          .select('*')
          .eq('media_id', msg.media_id)
          .maybeSingle();

        if (stored) {
          const row = stored as MediaStore;
          const payload: EncryptedMediaPayload = {
            encryptedBase64: row.encrypted_data,
            ivBase64: row.iv_base64,
            keyBase64: row.key_base64,
            mimeType: row.mime_type,
            fileName: row.file_name,
            size: row.file_size,
          };
          const blob = await decryptPayload(payload);
          await saveMedia({
            mediaId: msg.media_id,
            blob,
            mimeType: row.mime_type,
            fileName: row.file_name,
            size: row.file_size,
            createdAt: Date.now(),
            fromUser: row.sender_id,
            roomId: row.room_id,
          });
          vaultEntry = { blob, mimeType: row.mime_type, fileName: row.file_name, size: row.file_size, mediaId: msg.media_id, createdAt: Date.now(), fromUser: row.sender_id, roomId: row.room_id };
        }
      }

      if (vaultEntry) {
        const url = URL.createObjectURL(vaultEntry.blob);
        mediaUrlCache.current.set(msg.media_id, url);
        return { mediaUrl: url, mediaFileName: vaultEntry.fileName };
      }
    } catch {
      // Decryption failed — skip
    } finally {
      pendingDecrypt.current.delete(msg.media_id);
    }

    return { mediaError: true };
  }

  const loadMessages = useCallback(async (showLoading = true) => {
    if (!roomId || !peerId) return;
    if (showLoading) setLoading(true);

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (data) {
      const enriched: ChatMessage[] = [];
      for (const msg of data as Message[]) {
        const isMine = msg.sender_id === currentUserId;
        let mediaUrl: string | undefined;
        let mediaFileName: string | undefined;
        let mediaError = false;

        if (msg.media_id && !msg.deleted_for_everyone) {
          const resolved = await resolveMedia(msg);
          mediaUrl = resolved.mediaUrl;
          mediaFileName = resolved.mediaFileName;
          mediaError = resolved.mediaError ?? false;
        }

        enriched.push({
          ...msg,
          isMine,
          mediaUrl,
          mediaFileName,
          mediaError,
        });
      }
      setMessages((current) => {
        const merged = new Map<string, ChatMessage>();
        for (const message of enriched) merged.set(message.id, message);
        for (const message of current) {
          if (!merged.has(message.id)) merged.set(message.id, message);
        }
        return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      });

      // Mark unread messages as read
      const unread = (data as Message[]).filter(
        (m) => m.sender_id !== currentUserId && !m.read_at && !m.deleted_for_everyone,
      );
      if (unread.length > 0) {
        const now = new Date().toISOString();
        for (const m of unread) {
          await supabase.from('messages').update({ read_at: now }).eq('id', m.id);
        }
      }
    }
    if (showLoading) setLoading(false);
  }, [roomId, peerId, currentUserId]);

  // Load messages and subscribe to realtime
  useEffect(() => {
    loadMessages();

    if (!roomId || !peerId) return;

    const channel = supabase
      .channel(`messages_${roomId}_${uuidv4()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const msg = payload.new as Message;
          const isMine = msg.sender_id === currentUserId;

          let mediaUrl: string | undefined;
          let mediaFileName: string | undefined;
          let mediaError = false;

          if (msg.media_id && !msg.deleted_for_everyone) {
            const resolved = await resolveMedia(msg);
            mediaUrl = resolved.mediaUrl;
            mediaFileName = resolved.mediaFileName;
            mediaError = resolved.mediaError ?? false;
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            // If this is my own media message returning via realtime, replace the temp placeholder
            if (isMine && msg.media_id) {
              const tempIdx = prev.findIndex((m) => m.media_id === msg.media_id && m.id.startsWith('temp-'));
              if (tempIdx >= 0) {
                const temp = prev[tempIdx];
                return prev.map((m) =>
                  m.id === temp.id
                    ? { ...msg, isMine: true, mediaUrl: temp.mediaUrl, mediaFileName: temp.mediaFileName, uploading: false }
                    : m,
                );
              }
            }
            return [...prev, { ...msg, isMine, mediaUrl, mediaFileName, mediaError }];
          });

          if (!isMine && !msg.deleted_for_everyone) {
            playMessageReceived();
            const now = new Date().toISOString();
            await supabase.from('messages').update({ read_at: now }).eq('id', msg.id);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === msg.id) {
                if (msg.deleted_for_everyone) {
                  if (m.mediaUrl) URL.revokeObjectURL(m.mediaUrl);
                  if (msg.media_id) {
                    mediaUrlCache.current.delete(msg.media_id);
                    deleteMedia(msg.media_id).catch(() => {});
                  }
                  return { ...m, deleted_for_everyone: true, text_content: null, mediaUrl: undefined, mediaFileName: undefined };
                }
                if (msg.deleted_for?.includes(currentUserId)) {
                  if (m.mediaUrl) URL.revokeObjectURL(m.mediaUrl);
                  return { ...m, deleted_for: msg.deleted_for };
                }
                return { ...m, read_at: msg.read_at, deleted_for: msg.deleted_for };
              }
              return m;
            }),
          );
          if (msg.deleted_for_everyone && msg.media_id) {
            mediaUrlCache.current.delete(msg.media_id);
            deleteMedia(msg.media_id).catch(() => {});
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const old = payload.old as { id: string };
          setMessages((prev) => {
            const found = prev.find((m) => m.id === old.id);
            if (found?.mediaUrl) URL.revokeObjectURL(found.mediaUrl);
            return prev.filter((m) => m.id !== old.id);
          });
        },
      )
      .subscribe();

    channelRef.current = channel;
    const refreshInterval = window.setInterval(() => {
      void loadMessages(false);
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(refreshInterval);
      channelRef.current = null;
    };
  }, [roomId, peerId, currentUserId, loadMessages]);

  // Typing indicator via realtime broadcast
  useEffect(() => {
    if (!roomId || !peerId) return;

    const channel = supabase.channel(`typing_${roomId}`);
    typingChannelRef.current = channel;
    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.userId !== currentUserId) {
          setIsPeerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsPeerTyping(false), 3000);
        }
      })
      .on('broadcast', { event: 'stop_typing' }, (payload) => {
        if (payload.payload?.userId !== currentUserId) {
          setIsPeerTyping(false);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [roomId, peerId, currentUserId]);

  const sendTyping = useCallback(() => {
    if (!typingChannelRef.current || !roomId) return;
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId },
    });
  }, [currentUserId, roomId]);

  const sendStopTyping = useCallback(() => {
    if (!typingChannelRef.current || !roomId) return;
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'stop_typing',
      payload: { userId: currentUserId },
    });
  }, [currentUserId, roomId]);

  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!roomId || !peerId || !text.trim()) return;

      const { data } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          sender_id: currentUserId,
          text_content: text.trim(),
        })
        .select('*')
        .maybeSingle();

      if (data) {
        const message = data as Message;
        setMessages((prev) => prev.some((item) => item.id === message.id)
          ? prev
          : [...prev, { ...message, isMine: true }]);
        playMessageSent();
        if (peerId) {
          sendNotificationViaEdgeFunction({
            targetUser: peerId,
            fromUser: currentUserId,
            notificationType: 'message',
            title: currentDisplayName || 'New message',
            body: text.trim().substring(0, 100),
            data: { roomId, messageId: (data as Message).id, fromUser: currentUserId },
          });
        }
      }
    },
    [roomId, peerId, currentUserId, currentDisplayName],
  );

  const sendMediaMessage = useCallback(
    async (file: File, mediaType: 'image' | 'video' | 'audio') => {
      if (!roomId || !peerId) return;

      const mediaId = uuidv4();
      const tempId = `temp-${mediaId}`;
      const localUrl = URL.createObjectURL(file);

      // Show the message immediately with uploading state
      setMessages((prev) => [...prev, {
        id: tempId,
        room_id: roomId,
        sender_id: currentUserId,
        text_content: file.name,
        media_type: mediaType,
        media_id: mediaId,
        created_at: new Date().toISOString(),
        read_at: null,
        deleted_for_everyone: false,
        deleted_for: [],
        isMine: true,
        mediaUrl: localUrl,
        mediaFileName: file.name,
        uploading: true,
      }]);

      try {
        const encrypted = await withTimeout(encryptFile(file), 30000);

        // Store the original blob in local vault for the sender
        await withTimeout(saveMedia({
          mediaId,
          blob: file,
          mimeType: file.type || 'application/octet-stream',
          fileName: file.name,
          size: file.size,
          createdAt: Date.now(),
          fromUser: currentUserId,
          roomId,
        }), 15000);

        // Store encrypted media in database so recipient can fetch it on demand
        const { error: mediaError } = await withTimeout(supabase.from('media_store').insert({
          media_id: mediaId,
          room_id: roomId,
          sender_id: currentUserId,
          encrypted_data: encrypted.encryptedBase64,
          iv_base64: encrypted.ivBase64,
          key_base64: encrypted.keyBase64,
          mime_type: file.type,
          file_name: file.name,
          file_size: file.size,
        }), 30000);

        if (mediaError) throw mediaError;

        // Insert message record
        const { data, error: msgError } = await withTimeout(supabase
          .from('messages')
          .insert({
            room_id: roomId,
            sender_id: currentUserId,
            media_type: mediaType,
            media_id: mediaId,
            text_content: file.name,
          })
          .select('*')
          .maybeSingle(), 30000);

        if (msgError) throw msgError;
        if (!data) throw new Error('Media message was not created');

        if (data) {
          const message = data as Message;
          mediaUrlCache.current.set(mediaId, localUrl);
          // Replace the temp message with the real one
          setMessages((prev) => prev.map((m) =>
            m.id === tempId
              ? { ...message, isMine: true, mediaUrl: localUrl, mediaFileName: file.name, uploading: false }
              : m,
          ));
          playMessageSent();
          if (peerId) {
            const mediaLabel = mediaType === 'image' ? 'Photo' : mediaType === 'video' ? 'Video' : 'Voice note';
            sendNotificationViaEdgeFunction({
              targetUser: peerId,
              fromUser: currentUserId,
              notificationType: 'message',
              title: currentDisplayName || 'New message',
              body: `${mediaLabel}`,
              data: { roomId, messageId: (data as Message).id, fromUser: currentUserId },
            });
          }
        }
      } catch {
        // Upload failed — mark the temp message as failed but keep it visible
        setMessages((prev) => prev.map((m) =>
          m.id === tempId ? { ...m, uploading: false, uploadError: true } : m,
        ));
      }
    },
    [roomId, peerId, currentUserId, currentDisplayName],
  );

  const deleteMessageForMe = useCallback(
    async (messageId: string) => {
      const { data: msg } = await supabase
        .from('messages')
        .select('deleted_for')
        .eq('id', messageId)
        .maybeSingle();

      const currentDeletedFor = (msg as { deleted_for?: string[] })?.deleted_for ?? [];
      if (!currentDeletedFor.includes(currentUserId)) {
        await supabase
          .from('messages')
          .update({ deleted_for: [...currentDeletedFor, currentUserId] })
          .eq('id', messageId);
      }
    },
    [currentUserId],
  );

  const deleteMessageForEveryone = useCallback(
    async (messageId: string, mediaId?: string | null) => {
      await supabase
        .from('messages')
        .update({
          deleted_for_everyone: true,
          text_content: null,
        })
        .eq('id', messageId);

      if (mediaId) {
        mediaUrlCache.current.delete(mediaId);
        await deleteMedia(mediaId);
        await supabase.from('media_store').delete().eq('media_id', mediaId);
      }
    },
    [],
  );

  const deleteAllMessages = useCallback(async () => {
    if (!roomId || !peerId) return;
    // Mark all messages in this room as deleted for the current user
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, media_id, deleted_for')
      .eq('room_id', roomId);
    if (msgs) {
      for (const msg of msgs as (Message & { deleted_for?: string[] })[]) {
        const currentDeletedFor = msg.deleted_for ?? [];
        if (!currentDeletedFor.includes(currentUserId)) {
          await supabase
            .from('messages')
            .update({ deleted_for: [...currentDeletedFor, currentUserId] })
            .eq('id', msg.id);
        }
      }
    }
    // Clear media URL caches for this room
    for (const [mediaId, url] of mediaUrlCache.current.entries()) {
      URL.revokeObjectURL(url);
      mediaUrlCache.current.delete(mediaId);
    }
    setMessages([]);
  }, [roomId, peerId, currentUserId]);

  const replyToMessage = useCallback((message: ChatMessage) => {
    setReplyTarget(message);
  }, []);

  const clearReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  return {
    messages,
    loading,
    isPeerTyping,
    sendTextMessage,
    sendMediaMessage,
    sendTyping,
    sendStopTyping,
    deleteMessageForMe,
    deleteMessageForEveryone,
    deleteAllMessages,
    reloadMessages: loadMessages,
    replyToMessage,
    clearReply,
    replyTarget,
  };
}
