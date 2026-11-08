import { useEffect, useRef, useState } from 'react';
import {
  Phone,
  Video,
  Send,
  Paperclip,
  Image as ImageIcon,
  Mic,
  Trash2,
  Check,
  CheckCheck,
  X,
  Download,
  ArrowLeft,
  MoreVertical,
  Bell,
  BellOff,
  Info,
  Reply,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMessages, type ChatMessage } from '@/hooks/useMessages';
import { isPresenceOnline, usePresence, type ContactWithPresence } from '@/hooks/usePresence';
import { Avatar } from '@/components/Sidebar';


type ChatWindowProps = {
  peer: ContactWithPresence;
  onStartCall: (mode: 'voice' | 'video') => void;
  onBack?: () => void;
};

const WALLPAPERS = [
  'radial-gradient(circle at 12px 12px, rgba(91, 124, 153, 0.08) 0 1px, transparent 1.5px), linear-gradient(135deg, transparent 46%, rgba(91, 124, 153, 0.045) 47%, transparent 48%), #0e1621',
  'radial-gradient(circle at 28px 20px, rgba(91, 124, 153, 0.08) 0 1px, transparent 1.5px), linear-gradient(45deg, transparent 46%, rgba(91, 124, 153, 0.045) 47%, transparent 48%), #0e1621',
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'last seen just now';
  if (diffMin < 60) return `last seen ${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `last seen ${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'last seen yesterday';
  if (diffDay < 7) return `last seen ${diffDay} days ago`;
  return `last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function ChatWindow({ peer, onStartCall, onBack }: ChatWindowProps) {
  const { user, profile } = useAuth();
  const presenceMap = usePresence();
  const peerIsOnline = isPresenceOnline(presenceMap[peer.id]);
  const {
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
    replyToMessage,
    clearReply,
    replyTarget,
  } = useMessages(user?.id ?? '', peer.id, peer.display_name, profile?.display_name);

  const [input, setInput] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [permissionError, setPermissionError] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wallpaper = WALLPAPERS[peer.id.charCodeAt(0) % WALLPAPERS.length];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPeerTyping]);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [contextMenu]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    sendTyping();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => sendStopTyping(), 1500);
  }

  async function handleSend() {
    if (!input.trim()) return;
    await sendTextMessage(input);
    setInput('');
    sendStopTyping();
    clearReply();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, mediaType: 'image' | 'video' | 'audio') {
    const file = e.target.files?.[0];
    if (!file) return;
    await sendMediaMessage(file, mediaType);
    e.target.value = '';
    setShowAttach(false);
  }

  async function startVoiceRecording() {
    setPermissionError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        await sendMediaMessage(file, 'audio');
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch {
      setPermissionError(true);
    }
  }

  function stopVoiceRecording(send: boolean) {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (send) {
        mediaRecorderRef.current.stop();
      } else {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
        const stream = mediaRecorderRef.current.stream;
        stream?.getTracks().forEach((t) => t.stop());
      }
    }
    setIsRecording(false);
    setRecordingTime(0);
  }

  function handleMessageContextMenu(e: React.MouseEvent, messageId: string) {
    e.preventDefault();
    setContextMenu({ messageId, x: e.clientX, y: e.clientY });
  }

  async function handleDeleteForMe(messageId: string) {
    await deleteMessageForMe(messageId);
    setContextMenu(null);
  }

  async function handleDeleteForEveryone(messageId: string, mediaId?: string | null) {
    await deleteMessageForEveryone(messageId, mediaId);
    setContextMenu(null);
  }

  async function handleDownloadMedia(msg: ChatMessage) {
    if (!msg.mediaUrl) return;
    const a = document.createElement('a');
    a.href = msg.mediaUrl;
    a.download = msg.mediaFileName ?? 'media';
    a.click();
  }

  return (
    <div className="w-full flex flex-col h-full min-h-0 min-w-0 overflow-hidden text-[#e9edef]" style={{ background: wallpaper, backgroundSize: '42px 42px, 42px 42px, auto' }}>
      {/* Header */}
      <div className="relative flex items-center gap-2 px-2 py-2 bg-[#17212b] border-b border-[#202b36] shadow-lg z-10 md:px-4 md:py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="md:hidden p-2 -ml-1 text-white hover:bg-white/10 rounded-full transition-colors"
            title="Back to contacts"
            aria-label="Back to contacts"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <Avatar name={peer.display_name} color={peer.avatar_color} size={42} online={peerIsOnline} />
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold text-[15px] truncate">{peer.display_name}</h2>
          <p className={`text-xs ${isPeerTyping ? 'text-[#66b5f5]' : 'text-[#aebac1]'}`}>
            {isPeerTyping ? 'typing...' : peerIsOnline ? 'online' : formatLastSeen(presenceMap[peer.id]?.last_seen ?? peer.last_seen)}
          </p>
        </div>
        <button
          onClick={() => onStartCall('voice')}
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          title="Voice call"
        >
          <Phone className="w-5 h-5" />
        </button>
        <button
          onClick={() => onStartCall('video')}
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          title="Video call"
        >
          <Video className="w-5 h-5" />
        </button>
        <button
          onClick={() => setChatMenuOpen((open) => !open)}
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          title="More options"
          aria-label="More options"
          aria-expanded={chatMenuOpen}
        >
          <MoreVertical className="w-5 h-5" />
        </button>
        {chatMenuOpen && (
          <>
            <button
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setChatMenuOpen(false)}
              aria-label="Close chat menu"
            />
            <div className="absolute right-2 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-[#2a3942] bg-[#17212b] py-1 shadow-2xl">
              <div className="border-b border-[#2a3942] px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  <Info className="h-4 w-4 text-[#66b5f5]" /> Chat info
                </p>
                <p className="mt-1 truncate text-xs text-[#aebac1]">{peer.display_name}</p>
              </div>
              <button
                onClick={() => setNotificationsMuted((muted) => !muted)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e9edef] transition-colors hover:bg-[#202b36]"
              >
                {notificationsMuted ? <Bell className="h-4 w-4 text-[#66b5f5]" /> : <BellOff className="h-4 w-4 text-[#aebac1]" />}
                {notificationsMuted ? 'Unmute notifications' : 'Mute notifications'}
              </button>
              <button
                onClick={() => {
                  setShowDeleteAllConfirm(true);
                  setChatMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-400 transition-colors hover:bg-[#202b36]"
              >
                <Trash2 className="h-4 w-4" />
                Delete all chats
              </button>
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-1 md:px-5 md:py-4">
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}
        {messages.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800/50 mb-3">
              <Send className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-slate-400 text-sm">No messages yet. Say hello to {peer.display_name}!</p>
            <p className="text-slate-600 text-xs mt-1">Messages are end-to-end encrypted.</p>
          </div>
        )}
        {messages.map((msg, index) => {
          const dateStr = formatDateDivider(msg.created_at);
          const previousDateStr = index > 0 ? formatDateDivider(messages[index - 1].created_at) : '';
          const showDateDivider = dateStr !== previousDateStr;

          if (msg.deleted_for?.includes(user!.id)) return null;

          return (
            <div key={msg.id}>
              {showDateDivider && (
                <div className="flex justify-center my-3">
                  <span className="bg-[#253341]/95 text-[#d6e2ed] text-xs px-3 py-1.5 rounded-full shadow-sm">
                    {dateStr}
                  </span>
                </div>
              )}
              <div
                className={`group/msg flex items-center gap-1 ${msg.isMine ? 'justify-end' : 'justify-start'}`}
                onContextMenu={(e) => handleMessageContextMenu(e, msg.id)}
              >
                {!msg.isMine && !msg.deleted_for_everyone && (
                  <button
                    onClick={() => replyToMessage(msg)}
                    className="opacity-0 group-hover/msg:opacity-100 shrink-0 p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-full transition-all"
                    title="Reply"
                    aria-label="Reply to message"
                  >
                    <Reply className="w-4 h-4" />
                  </button>
                )}
                <div
                  className={`max-w-[86%] md:max-w-[70%] rounded-xl px-3 py-2 ${
                    msg.isMine
                      ? 'bg-[#2b5278] text-[#f1f6fa] rounded-br-sm'
                      : 'bg-[#182533] text-[#f1f6fa] rounded-bl-sm'
                  } shadow-sm transition-all hover:brightness-105`}
                >
                  {msg.deleted_for_everyone ? (
                    <p className="text-sm italic text-slate-400 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5" />
                      {msg.isMine ? 'You deleted this message' : 'This message was deleted'}
                    </p>
                  ) : (
                    <>
                      {/* Media display */}
                      {msg.media_type === 'image' && msg.mediaUrl && (
                        <div className={`mb-1 relative group overflow-hidden rounded-lg border ${msg.isMine ? 'border-[#3d8fd8]' : 'border-[#314454]'} transition-colors`}>
                          <img
                            src={msg.mediaUrl}
                            alt={msg.mediaFileName}
                            className={`rounded-lg max-w-full max-h-64 cursor-pointer object-cover ${msg.uploading ? 'opacity-60' : ''}`}
                            onClick={() => !msg.uploading && setMediaPreview({ url: msg.mediaUrl!, type: 'image', name: msg.mediaFileName! })}
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                              const fallback = event.currentTarget.nextElementSibling;
                              if (fallback instanceof HTMLElement) fallback.classList.remove('hidden');
                            }}
                          />
                          <span className="hidden px-4 py-8 text-center text-xs text-[#aebac1]">Image unavailable</span>
                          {msg.uploading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30">
                              <div className="w-8 h-8 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              <span className="text-white text-xs font-medium">Sending...</span>
                            </div>
                          )}
                          {msg.uploadError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-3 text-center">
                              <span className="text-xs font-medium text-red-100">Couldn’t send this image</span>
                            </div>
                          )}
                          {!msg.isMine && !msg.uploading && (
                            <button
                              onClick={() => handleDownloadMedia(msg)}
                              className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {msg.media_type === 'video' && msg.mediaUrl && (
                        <div className="mb-1 relative">
                          <video
                            src={msg.mediaUrl}
                            controls={!msg.uploading}
                            className="rounded-lg max-w-full max-h-64"
                          />
                          {msg.uploading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 rounded-lg">
                              <div className="w-10 h-10 rounded-full animate-spin" style={{ borderWidth: '3px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
                              <span className="text-white text-xs font-medium">Sending...</span>
                            </div>
                          )}
                          {!msg.isMine && !msg.uploading && (
                            <button
                              onClick={() => handleDownloadMedia(msg)}
                              className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {msg.media_type === 'audio' && msg.mediaUrl && (
                        <div className="mb-1">
                          <audio src={msg.mediaUrl} controls className="w-full max-w-full" />
                        </div>
                      )}
                      {msg.media_type && !msg.mediaUrl && !msg.deleted_for_everyone && (
                        <div className="mb-1 flex items-center gap-2 py-1 text-sm text-slate-400">
                          {!msg.mediaError && <div className="w-4 h-4 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin" />}
                          <span>{msg.mediaError ? 'Media unavailable' : 'Decrypting media...'}</span>
                        </div>
                      )}
                      {/* Text */}
                      {msg.text_content && (
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.text_content}</p>
                      )}
                      {/* Timestamp + read receipt */}
                      <div className={`flex items-center gap-1 mt-0.5 ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                        <span className={`text-[10px] ${msg.isMine ? 'text-[#b7d9f5]' : 'text-[#9aaab5]'}`}>
                          {formatTime(msg.created_at)}
                        </span>
                        {msg.isMine && !msg.deleted_for_everyone && (
                          msg.read_at ? (
                            <CheckCheck className="w-3.5 h-3.5 text-blue-200" />
                          ) : (
                            <Check className="w-3.5 h-3.5 text-blue-300" />
                          )
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {isPeerTyping && (
          <div className="flex justify-start">
            <div className="bg-[#182533] rounded-xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-slate-800 rounded-lg shadow-xl border border-slate-700 py-1 min-w-[160px]"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 170), top: Math.min(contextMenu.y, window.innerHeight - 120) }}
        >
          <button
            onClick={() => {
              handleDeleteForMe(contextMenu.messageId);
            }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Delete for me
          </button>
          {messages.find((m) => m.id === contextMenu.messageId)?.isMine && (
            <button
              onClick={() => {
                const msg = messages.find((m) => m.id === contextMenu.messageId);
                handleDeleteForEveryone(contextMenu.messageId, msg?.media_id);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete for everyone
            </button>
          )}
          {messages.find((m) => m.id === contextMenu.messageId)?.mediaUrl && (
            <button
              onClick={() => {
                const msg = messages.find((m) => m.id === contextMenu.messageId);
                if (msg) handleDownloadMedia(msg);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          )}
        </div>
      )}

      {/* Media preview modal */}
      {mediaPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setMediaPreview(null)}
        >
          <button className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-full">
            <X className="w-6 h-6" />
          </button>
          <img src={mediaPreview.url} alt={mediaPreview.name} className="max-w-full max-h-full rounded-lg" />
        </div>
      )}

      {/* Delete all chats confirmation */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#17212b] rounded-xl border border-[#2a3942] shadow-2xl max-w-sm w-full p-5">
            <h3 className="text-white text-lg font-semibold mb-2">Delete all chats?</h3>
            <p className="text-[#aebac1] text-sm mb-5">
              This will delete all messages in this chat for you. The other person will still see them.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="px-4 py-2 text-sm text-[#aebac1] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await deleteAllMessages();
                  setShowDeleteAllConfirm(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-2 bg-[#17212b] border-t border-[#202b36] md:p-3">
        {replyTarget && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-[#3390ec] bg-[#242f3d] px-3 py-2">
            <Reply className="w-4 h-4 text-[#3390ec] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#3390ec]">
                {replyTarget.isMine ? 'You' : peer.display_name}
              </p>
              <p className="text-xs text-[#aebac1] truncate">
                {replyTarget.text_content || replyTarget.media_type || 'Message'}
              </p>
            </div>
            <button
              onClick={clearReply}
              className="shrink-0 p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
              aria-label="Cancel reply"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {permissionError && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
            <p className="flex-1 text-xs text-amber-100">Microphone access is needed to record a voice message.</p>
            <button
              onClick={startVoiceRecording}
              className="shrink-0 rounded-lg bg-[#3390ec] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#4aa3f3]"
            >
              Allow microphone
            </button>
          </div>
        )}
        {isRecording ? (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-400 text-sm font-medium">
              Recording... {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => stopVoiceRecording(false)}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Cancel"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              onClick={() => stopVoiceRecording(true)}
              className="p-2 text-green-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Send"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="relative order-2">
              <button
                onClick={() => setShowAttach(!showAttach)}
                className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="Attach"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              {showAttach && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAttach(false)} />
                  <div className="absolute bottom-12 left-0 z-20 bg-slate-800 rounded-lg shadow-xl border border-slate-700 py-1 min-w-[140px]">
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      <ImageIcon className="w-4 h-4" /> Photo
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      <Video className="w-4 h-4" /> Video
                    </button>
                  </div>
                </>
              )}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileSelect(e, 'image')}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFileSelect(e, 'video')}
            />
            <textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message"
              rows={1}
              className="order-1 flex-1 bg-[#242f3d] border border-transparent rounded-2xl px-4 py-2.5 text-[#e9edef] text-sm placeholder:text-[#8696a0] focus:border-[#4d6b78] focus:outline-none transition-colors resize-none max-h-32"
              style={{ minHeight: '42px' }}
            />
            {input.trim() ? (
              <button
                onClick={handleSend}
                className="order-3 p-2.5 bg-[#3390ec] text-white rounded-full hover:bg-[#4aa3f3] transition-colors shadow-sm"
                title="Send"
              >
                <Send className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={startVoiceRecording}
                className="order-3 p-2.5 bg-[#3390ec] text-white hover:bg-[#4aa3f3] rounded-full transition-colors shadow-sm"
                title="Record voice note"
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
