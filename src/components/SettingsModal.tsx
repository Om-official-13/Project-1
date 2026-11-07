import { useState } from 'react';
import { X, Volume2, VolumeX, Shield, Trash2, Bell, BellOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { isSoundMuted, setSoundMuted } from '@/lib/sounds';
import { getAllMedia, deleteMedia } from '@/lib/vault';
import { getPushPermissionState } from '@/lib/push';
import { Avatar } from '@/components/Sidebar';

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { profile, user, refreshProfile, signOut, pushEnabled, enablePushNotifications, disablePushNotifications } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [avatarColor, setAvatarColor] = useState(profile?.avatar_color ?? '#3b82f6');
  const [muted, setMuted] = useState(isSoundMuted());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [vaultCount, setVaultCount] = useState<number | null>(null);
  const [clearingVault, setClearingVault] = useState(false);
  const [pushToggling, setPushToggling] = useState(false);
  const pushPermission = getPushPermissionState();

  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
    '#f97316', '#84cc16',
  ];

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() || 'User', avatar_color: avatarColor })
      .eq('id', user.id);
    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleCheckVault() {
    const entries = await getAllMedia();
    setVaultCount(entries.length);
  }

  async function handleClearVault() {
    setClearingVault(true);
    const entries = await getAllMedia();
    for (const entry of entries) {
      await deleteMedia(entry.mediaId);
    }
    setVaultCount(0);
    setClearingVault(false);
  }

  async function handleTogglePush() {
    setPushToggling(true);
    if (pushEnabled) {
      await disablePushNotifications();
    } else {
      await enablePushNotifications();
    }
    setPushToggling(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-white text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Profile */}
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {profile && (
                <Avatar name={displayName || profile.display_name} color={avatarColor} size={64} />
              )}
              <div className="flex-1">
                <label className="text-sm text-slate-400 mb-1.5 block">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Avatar Color</label>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setAvatarColor(c)}
                    className={`w-8 h-8 rounded-full transition-all hover:scale-110 ${
                      avatarColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
            </button>
          </div>

          <div className="border-t border-slate-700 pt-5 space-y-4">
            {/* Sound settings */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {muted ? <VolumeX className="w-5 h-5 text-slate-500" /> : <Volume2 className="w-5 h-5 text-blue-400" />}
                <div>
                  <p className="text-white text-sm font-medium">Sound Effects</p>
                  <p className="text-xs text-slate-500">Message & call sounds</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const m = !muted;
                  setMuted(m);
                  setSoundMuted(m);
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  muted ? 'bg-slate-600' : 'bg-blue-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    muted ? 'left-0.5' : 'left-5'
                  }`}
                />
              </button>
            </div>

            {/* Push notification settings */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {pushEnabled ? <Bell className="w-5 h-5 text-blue-400" /> : <BellOff className="w-5 h-5 text-slate-500" />}
                <div>
                  <p className="text-white text-sm font-medium">Push Notifications</p>
                  <p className="text-xs text-slate-500">
                    {pushPermission === 'denied'
                      ? 'Blocked by browser settings'
                      : pushPermission === 'unsupported'
                        ? 'Not supported on this device'
                        : pushEnabled
                          ? 'Messages & calls in background'
                          : 'Get notified when app is closed'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleTogglePush}
                disabled={pushToggling || pushPermission === 'unsupported' || pushPermission === 'denied'}
                className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  pushEnabled ? 'bg-blue-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    pushEnabled ? 'left-5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Privacy info */}
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-green-400" />
                <span className="text-white text-sm font-medium">Privacy & Security</span>
              </div>
              <ul className="text-xs text-slate-400 space-y-1">
                <li>- End-to-end encrypted messages</li>
                <li>- P2P voice & video calls (no server storage)</li>
                <li>- Media stored in private browser vault</li>
                <li>- Deleting from gallery does not affect chat</li>
                <li>- Deleting from chat does not affect gallery</li>
              </ul>
            </div>

            {/* Vault management */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-slate-500" />
                  <span className="text-white text-sm font-medium">Local Media Vault</span>
                </div>
                <button
                  onClick={handleCheckVault}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Check
                </button>
              </div>
              {vaultCount !== null && (
                <div className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                  <span className="text-sm text-slate-400">
                    {vaultCount} file{vaultCount !== 1 ? 's' : ''} in vault
                  </span>
                  {vaultCount > 0 && (
                    <button
                      onClick={handleClearVault}
                      disabled={clearingVault}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {clearingVault ? 'Clearing...' : 'Clear all'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-700 pt-5">
            <button
              onClick={() => { signOut(); onClose(); }}
              className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
