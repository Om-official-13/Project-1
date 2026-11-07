import { useState } from 'react';
import { Search, Phone, Video, Settings, LogOut, Volume2, VolumeX, Loader2, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useContacts, type ContactWithPresence } from '@/hooks/usePresence';
import { isSoundMuted, setSoundMuted } from '@/lib/sounds';

type SidebarProps = {
  selectedPeerId: string | null;
  onSelectPeer: (peer: ContactWithPresence) => void;
  onStartCall: (peer: ContactWithPresence, mode: 'voice' | 'video') => void;
  onOpenSettings: () => void;
};

function Avatar({ name, color, size = 48, online }: { name: string; color: string; size?: number; online?: boolean }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold"
        style={{ backgroundColor: color, fontSize: size * 0.36 }}
      >
        {initials}
      </div>
      {online !== undefined && (
        <span
          className={`absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
            online ? 'bg-green-500' : 'bg-slate-500'
          }`}
        />
      )}
    </div>
  );
}

export function Sidebar({ selectedPeerId, onSelectPeer, onStartCall, onOpenSettings }: SidebarProps) {
  const { profile, signOut } = useAuth();
  const { contacts, searchUsers, addContact } = useContacts(profile?.id ?? '');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ContactWithPresence[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [muted, setMuted] = useState(isSoundMuted());
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  async function handleSearch() {
    const query = search.trim();
    if (!query) {
      setSearchResults([]);
      setSearchSubmitted(false);
      return;
    }

    setSearching(true);
    setSearchSubmitted(true);
    setSearchResults(await searchUsers(query));
    setSearching(false);
  }

  function handleSelect(contact: ContactWithPresence) {
    setSearch('');
    setSearchResults([]);
    setSearchSubmitted(false);
    addContact(contact);
    onSelectPeer(contact);
  }

  return (
    <div className="flex flex-col h-full bg-[#17212b] border-r border-[#202b36]">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-[#17212b] border-b border-[#202b36]">
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="transition-transform hover:scale-105"
          >
            {profile && (
              <Avatar name={profile.display_name} color={profile.avatar_color} size={40} />
            )}
          </button>
          {showProfileMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowProfileMenu(false)} />
              <div className="absolute left-0 top-12 z-20 bg-slate-800 rounded-lg shadow-xl border border-slate-700 py-1 min-w-[160px]">
                <button
                  onClick={() => { onOpenSettings(); setShowProfileMenu(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <Settings className="w-4 h-4" /> Settings
                </button>
                <button
                  onClick={() => {
                    const m = !muted;
                    setMuted(m);
                    setSoundMuted(m);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  {muted ? 'Unmute' : 'Mute'} Sounds
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button
                  onClick={() => signOut()}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold text-sm truncate">
            {profile?.display_name ?? 'User'}
          </h2>
          <p className="text-xs text-[#aebac1]">
            {profile?.is_guest ? 'Guest account' : 'Online'}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="p-3 bg-[#17212b] border-b border-[#202b36]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value.trim()) {
                setSearchResults([]);
                setSearchSubmitted(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="Search by user ID or username..."
            className="w-full bg-[#202c33] border border-transparent rounded-lg pl-10 pr-16 py-2 text-sm text-[#e9edef] placeholder:text-[#8696a0] focus:border-[#4d6b78] focus:outline-none transition-colors"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !search.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white disabled:opacity-40"
            title="Find user"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Contacts list */}
      <div className="flex-1 overflow-y-auto">
        {searchSubmitted && !searching && (
          <div className="border-b border-slate-800">
            {searchResults.length > 0 ? searchResults.map((contact) => (
              <div
                key={contact.id}
                onClick={() => handleSelect(contact)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
              >
                <UserPlus className="w-5 h-5 text-blue-400 shrink-0" />
                <Avatar name={contact.display_name} color={contact.avatar_color} size={40} online={contact.is_online} />
                <div className="min-w-0">
                  <h3 className="text-white text-sm font-medium truncate">{contact.display_name}</h3>
                  <p className="text-xs text-slate-400 truncate">{contact.id}</p>
                </div>
              </div>
            )) : (
              <p className="px-4 py-4 text-sm text-slate-500">No user found with that ID.</p>
            )}
          </div>
        )}
        {!searchSubmitted && contacts.length === 0 && (
          <div className="text-center py-12 px-4">
            <p className="text-slate-500 text-sm">No chats yet. Search a user ID to start messaging.</p>
          </div>
        )}
        {!searchSubmitted && contacts.map((contact) => (
          <div
            key={contact.id}
            onClick={() => handleSelect(contact)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group ${
              selectedPeerId === contact.id
                ? 'bg-[#2b5278]'
                : 'hover:bg-[#202b36]'
            }`}
          >
            <Avatar
              name={contact.display_name}
              color={contact.avatar_color}
              size={44}
              online={contact.is_online}
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-white text-sm font-medium truncate">
                {contact.display_name}
              </h3>
              <p className={`text-xs truncate ${contact.is_online ? 'text-green-400' : 'text-slate-500'}`}>
                {contact.is_online ? 'online' : 'last seen recently'}
              </p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCall(contact, 'voice');
                }}
                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded-md transition-colors"
                title="Voice call"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCall(contact, 'video');
                }}
                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded-md transition-colors"
                title="Video call"
              >
                <Video className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-slate-800 flex items-center justify-between">
        <span className="text-xs text-slate-500">Privyte - E2E Encrypted</span>
        <button
          onClick={() => {
            const m = !muted;
            setMuted(m);
            setSoundMuted(m);
          }}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          title={muted ? 'Unmute sounds' : 'Mute sounds'}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export { Avatar };
