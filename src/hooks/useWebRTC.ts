import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, getRoomId, type CallSignal } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import {
  playCallIncoming,
  playCallOutgoing,
  playCallConnected,
  playCallEnded,
} from '@/lib/sounds';
import { sendNotificationViaEdgeFunction } from '@/lib/push';

export type CallState = 'idle' | 'calling' | 'incoming' | 'connected';

export type CallMode = 'voice' | 'video';

export type CallPeer = {
  userId: string;
  displayName: string;
  avatarColor: string;
};

export type RemoteMedia = {
  audioStream: MediaStream | null;
  videoStream: MediaStream | null;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export type UseWebRTCReturn = {
  callState: CallState;
  callMode: CallMode;
  remotePeer: CallPeer | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioMuted: boolean;
  videoEnabled: boolean;
  startCall: (peerUserId: string, peerName: string, peerColor: string, mode: CallMode) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  callError: string | null;
  clearCallError: () => void;
  requestPermissions: (mode: CallMode) => Promise<boolean>;
};

export function useWebRTC(currentUserId: string, currentDisplayName?: string): UseWebRTCReturn {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callMode, setCallMode] = useState<CallMode>('voice');
  const [remotePeer, setRemotePeer] = useState<CallPeer | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remotePeerRef = useRef<CallPeer | null>(null);
  const callModeRef = useRef<CallMode>('voice');
  const isInitiatorRef = useRef(false);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const handledSignalsRef = useRef<Set<string>>(new Set());
  const signalSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const createPeerConnectionRef = useRef<(() => RTCPeerConnection) | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const currentDisplayNameRef = useRef<string | undefined>(currentDisplayName);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    currentDisplayNameRef.current = currentDisplayName;
  }, [currentDisplayName]);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setRemotePeer(null);
    remotePeerRef.current = null;
    isInitiatorRef.current = false;
    setCallState('idle');
    callStateRef.current = 'idle';
    setAudioMuted(false);
    setVideoEnabled(false);
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    if (signalSubscriptionRef.current) {
      signalSubscriptionRef.current.unsubscribe();
      signalSubscriptionRef.current = null;
    }
  }, []);

  const sendSignal = useCallback(
    async (toUser: string, signalType: string, signalData: Record<string, unknown>) => {
      if (!remotePeerRef.current) return;
      const roomId = getRoomId(currentUserId, toUser);
      const { error } = await supabase.from('call_signals').insert({
        room_id: roomId,
        from_user: currentUserId,
        to_user: toUser,
        signal_type: signalType,
        signal_data: signalData,
      });
      if (error) {
        setCallError('The call could not reach the other person. Please try again.');
        return false;
      }
      return true;
    },
    [currentUserId],
  );

  const handleSignal = useCallback(
    async (signal: CallSignal) => {
      if (signal.from_user === currentUserId || handledSignalsRef.current.has(signal.id)) return;
      handledSignalsRef.current.add(signal.id);

      const data = signal.signal_data;

      if (signal.signal_type === 'call_offer') {
        // Incoming call
        const mode = data.mode as CallMode;
        callModeRef.current = mode;
        setCallMode(mode);
        remotePeerRef.current = {
          userId: signal.from_user,
          displayName: data.displayName as string,
          avatarColor: data.avatarColor as string,
        };
        setRemotePeer(remotePeerRef.current);
        setCallState('incoming');
        playCallIncoming();
      } else if (signal.signal_type === 'call_reject') {
        playCallEnded();
        cleanup();
      } else if (signal.signal_type === 'call_end') {
        playCallEnded();
        cleanup();
      } else if (signal.signal_type === 'sdp_offer') {
        // Receiver gets the caller's offer.
        // If the peer connection already exists (acceptCall already ran), process immediately.
        // Otherwise, store it — acceptCall will process it when it creates the peer connection.
        pendingOfferRef.current = data.sdp as RTCSessionDescriptionInit;
        let pc = pcRef.current;
        if (pc) {
          await pc.setRemoteDescription(pendingOfferRef.current);
          for (const cand of pendingCandidatesRef.current) {
            await pc.addIceCandidate(cand as RTCIceCandidateInit);
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal(signal.from_user, 'sdp_answer', { sdp: answer });
        }
        // If no pc yet, acceptCall will pick up pendingOfferRef.current
      } else if (signal.signal_type === 'sdp_answer') {
        if (pcRef.current && pcRef.current.signalingState !== 'stable') {
          await pcRef.current.setRemoteDescription(data.sdp as RTCSessionDescriptionInit);
          playCallConnected();
        }
      } else if (signal.signal_type === 'ice_candidate') {
        const cand = data.candidate as RTCIceCandidateInit;
        if (pcRef.current && pcRef.current.remoteDescription) {
          await pcRef.current.addIceCandidate(cand);
        } else {
          pendingCandidatesRef.current.push(cand);
        }
      }

      // Delete the signal after processing
      await supabase.from('call_signals').delete().eq('id', signal.id);
    },
    [currentUserId, cleanup, sendSignal],
  );

  const subscribeToSignals = useCallback(
    (peerUserId: string) => {
      const roomId = getRoomId(currentUserId, peerUserId);
      const channel = supabase
        .channel(`call_signals_${roomId}_${uuidv4()}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'call_signals',
            filter: `to_user=eq.${currentUserId}`,
          },
          (payload) => {
            handleSignal(payload.new as CallSignal);
          },
        )
        .subscribe();

      signalSubscriptionRef.current = {
        unsubscribe: () => supabase.removeChannel(channel),
      };
    },
    [currentUserId, handleSignal],
  );

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && remotePeerRef.current) {
        sendSignal(remotePeerRef.current.userId, 'ice_candidate', {
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallState('connected');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Give a brief grace period, then cleanup
        setTimeout(() => {
          if (pcRef.current === pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
            playCallEnded();
            cleanup();
          }
        }, 3000);
      }
    };

    return pc;
  }, [sendSignal, cleanup]);
  createPeerConnectionRef.current = createPeerConnection;

  const startCall = useCallback(
    async (peerUserId: string, peerName: string, peerColor: string, mode: CallMode) => {
      setCallError(null);
      isInitiatorRef.current = true;
      callModeRef.current = mode;
      setCallMode(mode);
      remotePeerRef.current = { userId: peerUserId, displayName: peerName, avatarColor: peerColor };
      setRemotePeer(remotePeerRef.current);

      // Get local media
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: mode === 'video',
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setVideoEnabled(mode === 'video');
      } catch {
        cleanup();
        setCallError(`Unable to start the ${mode} call. Please allow microphone${mode === 'video' ? ' and camera' : ''} access and try again.`);
        return;
      }

      // Create peer connection and add local tracks immediately
      const pc = createPeerConnection();
      pcRef.current = pc;
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      subscribeToSignals(peerUserId);
      setCallState('calling');

      // Send call offer notification
      const offerSent = await sendSignal(peerUserId, 'call_offer', {
        mode,
        displayName: currentDisplayNameRef.current || 'Unknown',
        avatarColor: '#3b82f6',
      });
      if (!offerSent) {
        playCallEnded();
        cleanup();
        return;
      }

      // Create and send the SDP offer — the caller is the offerer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(peerUserId, 'sdp_offer', { sdp: offer });

      // Send push notification for the call (for background/closed app)
      sendNotificationViaEdgeFunction({
        targetUser: peerUserId,
        fromUser: currentUserId,
        notificationType: 'call',
        title: `Incoming ${mode === 'video' ? 'Video' : 'Voice'} Call`,
        body: 'Tap to answer',
        data: { fromUser: currentUserId, mode, roomId: getRoomId(currentUserId, peerUserId) },
      });

      playCallOutgoing();
    },
    [currentUserId, sendSignal, subscribeToSignals, cleanup, createPeerConnection],
  );

  const acceptCall = useCallback(async () => {
    if (!remotePeerRef.current) return;

    const peerUserId = remotePeerRef.current.userId;
    const mode = callModeRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video',
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setVideoEnabled(mode === 'video');
    } catch {
      setCallError(`Unable to accept the ${mode} call. Please allow microphone${mode === 'video' ? ' and camera' : ''} access and try again.`);
      return;
    }

    // Create peer connection and add local tracks
    const pc = createPeerConnection();
    pcRef.current = pc;
    setCallState('calling');

    localStreamRef.current!.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    subscribeToSignals(peerUserId);

    // The receiver waits for the caller's sdp_offer, then creates and sends the answer.
    // If the offer already arrived (stored in pendingOfferRef), process it now.
    if (pendingOfferRef.current) {
      await pc.setRemoteDescription(pendingOfferRef.current);
      for (const cand of pendingCandidatesRef.current) {
        await pc.addIceCandidate(cand as RTCIceCandidateInit);
      }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(peerUserId, 'sdp_answer', { sdp: answer });
    }
  }, [createPeerConnection, sendSignal, subscribeToSignals]);

  const rejectCall = useCallback(async () => {
    if (remotePeerRef.current) {
      await sendSignal(remotePeerRef.current.userId, 'call_reject', {});
    }
    cleanup();
  }, [sendSignal, cleanup]);

  const endCall = useCallback(() => {
    if (remotePeerRef.current) {
      sendSignal(remotePeerRef.current.userId, 'call_end', {});
    }
    playCallEnded();
    cleanup();
  }, [sendSignal, cleanup]);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  }, []);

  // Subscribe to incoming call signals (stable — does not re-create on state change)
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`incoming_calls_${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `to_user=eq.${currentUserId}`,
        },
        (payload) => {
          const signal = payload.new as CallSignal;
          const state = callStateRef.current;
          if (signal.signal_type === 'call_offer' && state === 'idle') {
            handleSignal(signal);
          } else if ((signal.signal_type === 'call_end' || signal.signal_type === 'call_reject') && state === 'incoming') {
            handleSignal(signal);
          } else if (state === 'calling' || state === 'connected') {
            // During active calls, handle SDP and ICE signals as fallback
            if (['sdp_offer', 'sdp_answer', 'ice_candidate', 'call_end'].includes(signal.signal_type)) {
              handleSignal(signal);
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, handleSignal]);

  // Poll for pending signals as a backup to realtime (stable — uses ref for state)
  useEffect(() => {
    if (!currentUserId) return;

    const checkPendingSignals = async () => {
      const state = callStateRef.current;
      const { data } = await supabase
        .from('call_signals')
        .select('*')
        .eq('to_user', currentUserId)
        .order('created_at', { ascending: true });
      if (!data) return;

      for (const signal of data as CallSignal[]) {
        if (handledSignalsRef.current.has(signal.id)) continue;

        let shouldHandle = false;
        if (state === 'idle') {
          shouldHandle = signal.signal_type === 'call_offer';
        } else if (state === 'incoming') {
          shouldHandle = signal.signal_type === 'call_end' || signal.signal_type === 'call_reject';
        } else if (state === 'calling' || state === 'connected') {
          shouldHandle = ['sdp_offer', 'sdp_answer', 'ice_candidate', 'call_end'].includes(signal.signal_type);
        }

        if (shouldHandle) {
          await handleSignal(signal);
        }
      }
    };

    void checkPendingSignals();
    const poll = window.setInterval(() => {
      void checkPendingSignals();
    }, 2000);

    return () => window.clearInterval(poll);
  }, [currentUserId, handleSignal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const requestPermissions = useCallback(async (mode: CallMode): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' });
      stream.getTracks().forEach((track) => track.stop());
      setCallError(null);
      return true;
    } catch {
      setCallError(`Microphone${mode === 'video' ? ' and camera' : ''} access is still blocked. Please allow it in your browser settings.`);
      return false;
    }
  }, []);

  const clearCallError = useCallback(() => setCallError(null), []);

  return {
    callState,
    callMode,
    remotePeer,
    localStream,
    remoteStream,
    audioMuted,
    videoEnabled,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    callError,
    clearCallError,
    requestPermissions,
  };
}
