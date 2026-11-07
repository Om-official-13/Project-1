import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone, X } from 'lucide-react';
import type { UseWebRTCReturn } from '@/hooks/useWebRTC';
import { Avatar } from '@/components/Sidebar';

type CallOverlayProps = {
  webrtc: UseWebRTCReturn;
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallOverlay({ webrtc }: CallOverlayProps) {
  const {
    callState,
    callMode,
    remotePeer,
    localStream,
    remoteStream,
    audioMuted,
    videoEnabled,
    acceptCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    callError,
    clearCallError,
    requestPermissions,
  } = webrtc;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [callDuration, setCallDuration] = useState(0);

  // Call duration timer — counts up while connected
  useEffect(() => {
    if (callState !== 'connected') {
      setCallDuration(0);
      return;
    }
    const interval = window.setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [callState]);

  // Attach local stream to the local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, callState]);

  // Attach remote stream to the remote video element whenever it or the call state changes
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callState]);

  // Attach remote stream to the hidden audio element — this plays the remote audio for BOTH
  // voice and video calls. Without this, voice calls have no element to output sound through.
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      // Some browsers need an explicit play() call after setting srcObject
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream, callState]);

  if (callState === 'idle') {
    if (!callError) return null;
    return (
      <div className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-red-400/30 bg-[#182533] px-4 py-3 shadow-2xl">
        <p className="flex-1 text-sm text-slate-200">{callError}</p>
        <button
          onClick={() => requestPermissions(callMode)}
          className="shrink-0 rounded-lg bg-[#3390ec] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#4aa3f3]"
        >
          Allow access
        </button>
        <button
          onClick={clearCallError}
          className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Dismiss call error"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const isVideoCall = callMode === 'video';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Hidden audio element that plays remote audio for ALL call types (voice + video) */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-20"
          style={{ backgroundColor: remotePeer?.avatarColor ?? '#3b82f6' }}
        />
      </div>

      {/* Video streams */}
      {callState === 'connected' && isVideoCall && remoteStream && (
        <div className="absolute inset-0">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Local video preview (picture-in-picture) */}
      {callState === 'connected' && isVideoCall && localStream && videoEnabled && (
        <div className="absolute top-4 right-4 w-32 h-48 md:w-40 md:h-60 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-10">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
        </div>
      )}

      {/* Content */}
      <div className="relative flex-1 flex flex-col items-center justify-center z-10">
        {/* Avatar / caller info */}
        {(!isVideoCall || callState !== 'connected' || !remoteStream) && (
          <div className="flex flex-col items-center">
            <div className="mb-6">
              {remotePeer && (
                <Avatar
                  name={remotePeer.displayName}
                  color={remotePeer.avatarColor}
                  size={120}
                />
              )}
            </div>
            <h2 className="text-white text-2xl font-semibold mb-2">
              {remotePeer?.displayName ?? 'Unknown'}
            </h2>
            <div className="flex items-center gap-2 text-slate-400">
              {isVideoCall && <Video className="w-4 h-4" />}
              {!isVideoCall && <Phone className="w-4 h-4" />}
              <span className="text-sm">
                {callState === 'calling' && 'Calling...'}
                {callState === 'incoming' && 'Incoming call...'}
                {callState === 'connected' && formatDuration(callDuration)}
              </span>
            </div>
          </div>
        )}

        {/* Connected status for video */}
        {callState === 'connected' && isVideoCall && remoteStream && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-md rounded-full px-4 py-1.5">
            <span className="text-white text-sm font-medium">{remotePeer?.displayName} · {formatDuration(callDuration)}</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="relative z-10 flex flex-col items-center gap-4 pb-12 pt-4">
        {callError && (
          <div className="flex max-w-md items-center gap-3 rounded-xl border border-red-400/30 bg-[#182533] px-4 py-3 shadow-xl">
            <p className="text-center text-sm text-slate-200">{callError}</p>
            <button
              onClick={() => requestPermissions(callMode)}
              className="shrink-0 rounded-lg bg-[#3390ec] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#4aa3f3]"
            >
              Allow access
            </button>
          </div>
        )}
        {/* Incoming call buttons */}
        {callState === 'incoming' && (
          <div className="flex items-center gap-8">
            <button
              onClick={rejectCall}
              className="flex flex-col items-center gap-2 group"
            >
              <div className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-105">
                <PhoneOff className="w-7 h-7 text-white" />
              </div>
              <span className="text-slate-400 text-xs">Decline</span>
            </button>
            <button
              onClick={acceptCall}
              className="flex flex-col items-center gap-2 group"
            >
              <div className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30 transition-all hover:scale-105 animate-pulse">
                {isVideoCall ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
              </div>
              <span className="text-slate-400 text-xs">Accept</span>
            </button>
          </div>
        )}

        {/* Calling / Connected controls */}
        {(callState === 'calling' || callState === 'connected') && (
          <div className="flex items-center gap-4">
            <button
              onClick={toggleAudio}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105 ${
                audioMuted
                  ? 'bg-white text-slate-900'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              title={audioMuted ? 'Unmute' : 'Mute'}
            >
              {audioMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            {isVideoCall && (
              <button
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105 ${
                  !videoEnabled
                    ? 'bg-white text-slate-900'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
                title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
              >
                {videoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
              </button>
            )}

            <button
              onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-105"
              title="End call"
            >
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
