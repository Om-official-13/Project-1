import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Download, X } from 'lucide-react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AuthScreen } from '@/components/AuthScreen';
import { Sidebar } from '@/components/Sidebar';
import { ChatWindow } from '@/components/ChatWindow';
import { CallOverlay } from '@/components/CallOverlay';
import { SettingsModal } from '@/components/SettingsModal';
import { useWebRTC } from '@/hooks/useWebRTC';
import type { ContactWithPresence } from '@/hooks/usePresence';
import { supabase } from '@/lib/supabase';
import { setupInstallPrompt, triggerInstall, isStandalone } from '@/lib/push';

function MessagingApp() {
  const { user, profile, loading } = useAuth();
  const webrtc = useWebRTC(user?.id ?? '', profile?.display_name);
  const [selectedPeer, setSelectedPeer] = useState<ContactWithPresence | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [canInstall, setCanInstall] = useState(false);

  // PWA install prompt
  useEffect(() => {
    if (isStandalone()) return;
    const cleanup = setupInstallPrompt(() => setCanInstall(true));
    return cleanup;
  }, []);

  // Handle service worker messages (notification actions: reply, accept call, decline call)
  useEffect(() => {
    if (!user) return;

    const handler = async (event: MessageEvent) => {
      const msg = event.data as { type: string; data?: Record<string, unknown>; replyText?: string };
      if (!msg) return;

      if (msg.type === 'REPLY_ACTION' && msg.data && msg.replyText) {
        // Send reply from notification
        const roomId = msg.data.roomId as string;
        if (roomId) {
          await supabase.from('messages').insert({
            room_id: roomId,
            sender_id: user.id,
            text_content: msg.replyText,
          });
        }
      } else if (msg.type === 'ACCEPT_CALL' && msg.data) {
        // The WebRTC hook will pick up the call offer from call_signals table
        // The acceptCall function is already wired via realtime subscription
      } else if (msg.type === 'DECLINE_CALL' && msg.data) {
        const fromUser = msg.data.fromUser as string;
        if (fromUser) {
          await supabase.from('call_signals').insert({
            room_id: msg.data.roomId as string,
            from_user: user.id,
            to_user: fromUser,
            signal_type: 'call_reject',
            signal_data: {},
          });
        }
      } else if (msg.type === 'NAVIGATE' && msg.data) {
        const fromUser = msg.data.fromUser as string;
        if (fromUser) {
          // Find the contact and select them
          const { data: contactProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', fromUser)
            .maybeSingle();
          if (contactProfile) {
            setSelectedPeer(contactProfile as ContactWithPresence);
          }
        }
      }
    };

    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [user]);

  // Presence on unmount is handled by AuthContext (visibilitychange + pagehide + beforeunload)

  const handleInstall = useCallback(async () => {
    const accepted = await triggerInstall();
    if (accepted) setCanInstall(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/30">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <AuthScreen />;
  }

  const handleStartCall = (peer: ContactWithPresence, mode: 'voice' | 'video') => {
    webrtc.startCall(peer.id, peer.display_name, peer.avatar_color, mode);
  };

  return (
    <div className="w-full h-dvh min-h-0 flex bg-slate-900 overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          selectedPeer ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 lg:w-96 shrink-0 min-h-0 flex-col`}
      >
        <Sidebar
          selectedPeerId={selectedPeer?.id ?? null}
          onSelectPeer={setSelectedPeer}
          onStartCall={handleStartCall}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>

      {/* Chat window */}
      <div
        className={`${
          selectedPeer ? 'flex' : 'hidden md:flex'
        } w-full flex-1 min-w-0 min-h-0`}
      >
        {selectedPeer ? (
          <ChatWindow
            peer={selectedPeer}
            onStartCall={(mode) => handleStartCall(selectedPeer, mode)}
            onBack={() => setSelectedPeer(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-950">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-slate-800/50 mb-4">
              <MessageSquare className="w-10 h-10 text-slate-600" />
            </div>
            <h2 className="text-slate-400 text-lg font-medium mb-1">Privyte</h2>
            <p className="text-slate-600 text-sm">Select a contact to start messaging</p>
            <p className="text-slate-700 text-xs mt-4">End-to-end encrypted - P2P calls</p>
          </div>
        )}
      </div>

      {/* PWA Install banner */}
      {canInstall && (
        <div className="fixed top-4 right-4 z-40 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-sm">
          <Download className="w-5 h-5 text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium">Install Privyte</p>
            <p className="text-slate-400 text-xs">Add to your home screen</p>
          </div>
          <button
            onClick={handleInstall}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            Install
          </button>
          <button
            onClick={() => setCanInstall(false)}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
            title="Close"
            aria-label="Close install prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Call overlay */}
      <CallOverlay webrtc={webrtc} />

      {/* Settings modal */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <MessagingApp />
    </AuthProvider>
  );
}

export default App;
