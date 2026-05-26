import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useSession } from '@/hooks/useSession';
import { useChannelRoster, useRealtime, type DecryptedChannelMessage } from '@/hooks/useRealtime';
import {
  appendChannel as storeAppendChannel,
  listChannel as storeListChannel,
} from '@/lib/messageStore';
import {
  clearCommunityPassword,
  communityAuthHeaders,
  getCommunityPassword,
  setCommunityPassword,
} from '@/lib/communityPasswordStore';
import { CommunityPasswordPrompt } from '@/components/community/CommunityPasswordPrompt';
import { useToast } from '@/components/ui/Toast';
import { useBackdropClose } from '@/hooks/useBackdropClose';
import { apiUrl, apiUrlFor, relayBaseFor } from '@/lib/relayBase';
import type { Channel, Community as CommunityListItem, CurrentUser } from '@/components/layout/Sidebar';
import type { Member } from '@/components/layout/MemberList';
import { UserProfileModal, type UserProfileData } from '@/components/ui';
import { CreateChannelModal, type CreateChannelFormData } from '@/components/community/CreateChannelModal';
import { useTorStatus } from '@/hooks/useTorStatus';
import { formatInvite } from '@/lib/invite';

interface CommunityDetail {
  id: string;
  name: string;
  icon?: string | null;
  description?: string;
}

interface ChannelDetail {
  id: string;
  name: string;
  description?: string;
  type: 'text' | 'voice';
}

export default function Community() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const communityId = params.id as string;

  const { session, isReady } = useSession();
  const publicId = session?.signingPublicKey ?? '';
  const { success: toastSuccess, error: toastError } = useToast();
  const tor = useTorStatus();

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<UserProfileData | null>(null);

  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);

  const [needsPassword, setNeedsPassword] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteConfirmBackdrop = useBackdropClose(
    () => setShowDeleteConfirm(false),
    showDeleteConfirm && !isDeleting,
  );

  const handleChannelMessage = useCallback(
    (msg: DecryptedChannelMessage) => {
      if (msg.channelId !== activeChannelId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.msgId)) return prev;
        const decoded: MessageData = {
          id: msg.msgId,
          content: msg.plaintext,
          nonce: '',
          senderId: msg.senderSigningPublicKey,
          sender: { publicId: msg.senderSigningPublicKey, displayName: msg.senderDisplayName },
          channelId: msg.channelId,
          createdAt: new Date(msg.ts),
        };
        return [...prev, decoded];
      });
    },
    [activeChannelId],
  );

  const { joinChannel, leaveChannel, sendChannelMessage, isReady: isRealtimeReady } = useRealtime({
    onChannelMessage: handleChannelMessage,
    relayUrl: relayBaseFor(communityId),
  });

  const roster = useChannelRoster(activeChannelId);

  const fetchCommunityData = useCallback(async () => {
    if (!isReady || !communityId) return;
    setIsLoading(true);
    try {
      const authHeaders = communityAuthHeaders(communityId);
      const [communityRes, channelsRes, allRes] = await Promise.all([
        fetch(apiUrlFor(communityId, `/api/communities/${communityId}`), { headers: authHeaders }),
        fetch(apiUrlFor(communityId, `/api/communities/${communityId}/channels`), { headers: authHeaders }),
        fetch(apiUrl('/api/communities')),
      ]);
      if (communityRes.status === 401) {
        clearCommunityPassword(communityId);
        setNeedsPassword(true);
        return;
      }
      if (!communityRes.ok) {
        if (communityRes.status === 404) navigate('/app');
        return;
      }
      const cData = await communityRes.json();
      setCommunity({
        id: cData.id ?? communityId,
        name: cData.name ?? '',
        description: cData.description,
        icon: cData.avatar ?? null,
      });
      if (channelsRes.ok) {
        const chData = await channelsRes.json();
        const list: ChannelDetail[] = chData.channels || [];
        setChannels(list);
        const general = list.find((c) => c.name.toLowerCase() === 'general');
        const def = general || list[0];
        if (def) setActiveChannelId(def.id);
      }
      if (allRes.ok) {
        const allData = await allRes.json();
        const list: CommunityListItem[] =
          allData.communities?.map((c: { id: string; name: string; avatar?: string | null }) => ({
            id: c.id,
            name: c.name,
            icon: c.avatar || null,
            unreadCount: 0,
          })) || [];
        setCommunities(list);
      }
    } catch (err) {
      console.error('Failed to fetch community:', err);
      navigate('/app');
    } finally {
      setIsLoading(false);
    }
  }, [isReady, communityId, navigate]);

  useEffect(() => {
    void fetchCommunityData();
  }, [fetchCommunityData]);

  useEffect(() => {
    if (!activeChannelId || !isReady) return;
    joinChannel(activeChannelId);
    return () => leaveChannel(activeChannelId);
  }, [activeChannelId, isReady, joinChannel, leaveChannel]);

  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessages([]);
    void storeListChannel(activeChannelId).then((stored) => {
      if (cancelled) return;
      setMessages(
        stored.map((m) => ({
          id: m.id,
          content: m.plaintext,
          nonce: '',
          senderId: m.senderSigningPublicKey,
          sender: { publicId: m.senderSigningPublicKey, displayName: m.senderDisplayName },
          channelId: activeChannelId,
          createdAt: new Date(m.ts),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeChannelId]);

  const handleSend = useCallback(
    async (plaintext: string) => {
      if (!activeChannelId) return false;
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ts = Date.now();
      const localName = session?.displayName || '';
      const optimistic: MessageData = {
        id,
        content: plaintext,
        nonce: '',
        senderId: publicId,
        sender: { publicId, displayName: localName },
        channelId: activeChannelId,
        createdAt: new Date(ts),
      };
      setMessages((prev) => [...prev, optimistic]);
      void storeAppendChannel(activeChannelId, {
        id,
        ts,
        senderSigningPublicKey: publicId,
        senderBoxPublicKey: '',
        senderDisplayName: localName,
        plaintext,
        optimistic: true,
      });
      return sendChannelMessage(activeChannelId, plaintext);
    },
    [activeChannelId, publicId, session, sendChannelMessage],
  );

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      navigate(`/app/community/${communityId}/channel/${channelId}`, { preventScrollReset: true });
    },
    [communityId, navigate],
  );

  const handleSelectCommunity = useCallback(
    (newCommunityId: string) => navigate(`/app/community/${newCommunityId}`),
    [navigate],
  );
  const handleSelectDM = useCallback((dmId: string) => navigate(`/app/dm/${dmId}`), [navigate]);
  const handleSwitchToDMs = useCallback(() => navigate('/app'), [navigate]);

  const handleMemberClick = useCallback(
    (member: Member) =>
      setSelectedMember({
        id: member.id,
        publicId: member.publicId,
        imageUrl: member.imageUrl,
        status: member.status,
        role: member.role,
        isOnline: member.isOnline,
      }),
    [],
  );
  const handleStartDM = useCallback(
    (memberId: string) => navigate(`/app/dm/${memberId}`),
    [navigate],
  );
  const handleCloseProfileModal = useCallback(() => setSelectedMember(null), []);

  const handleSettings = useCallback(() => navigate('/app/settings'), [navigate]);
  const handleOpenSettings = useCallback(() => navigate('/app/settings'), [navigate]);
  const handleOpenHelp = useCallback(() => alert('Help feature coming soon!'), []);
  const handleOpenPinned = useCallback(() => alert('Pinned messages feature coming soon!'), []);
  const handleOpenNotifications = useCallback(() => alert('Notifications feature coming soon!'), []);
  const handleOpenSearch = useCallback(() => alert('Search feature coming soon!'), []);

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      setPwSubmitting(true);
      setPwError(null);
      try {
        const res = await fetch(apiUrlFor(communityId, `/api/communities/${communityId}`), {
          headers: { 'x-community-password': password },
        });
        if (res.status === 401) {
          setPwError('Wrong password');
          return;
        }
        if (!res.ok) {
          setPwError('Could not reach the community');
          return;
        }
        setCommunityPassword(communityId, password);
        setNeedsPassword(false);
        void fetchCommunityData();
      } catch {
        setPwError('Network error');
      } finally {
        setPwSubmitting(false);
      }
    },
    [communityId, fetchCommunityData],
  );

  const handlePasswordCancel = useCallback(() => navigate('/app'), [navigate]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      // Format: `<communityId>@<onion>` so the joiner knows what host to
      // dial over Tor. Falls back to bare ID if our hidden service hasn't
      // bootstrapped yet — same-host joins still work in that case.
      const invite = formatInvite(communityId, tor.hostname);
      await navigator.clipboard.writeText(invite);
      const isPrivate = getCommunityPassword(communityId) !== null;
      const baseMsg = tor.hostname ? 'Invite code copied (includes your .onion)' : 'Invite code copied (host onion not ready yet)';
      toastSuccess(
        isPrivate ? `${baseMsg} — share the password separately` : baseMsg,
      );
    } catch {
      toastError('Could not access the clipboard');
    }
  }, [communityId, tor.hostname, toastSuccess, toastError]);

  const handleDeleteCommunity = useCallback(async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(apiUrlFor(communityId, `/api/communities/${communityId}`), {
        method: 'DELETE',
        headers: communityAuthHeaders(communityId),
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearCommunityPassword(communityId);
          setShowDeleteConfirm(false);
          setNeedsPassword(true);
          return;
        }
        setShowDeleteConfirm(false);
        return;
      }
      clearCommunityPassword(communityId);
      navigate('/app');
    } catch {
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  }, [communityId, navigate]);

  const handleCreateChannel = useCallback(
    async (data: CreateChannelFormData) => {
      if (!communityId) return;
      setIsCreatingChannel(true);
      setCreateChannelError(null);
      try {
        const response = await fetch(apiUrlFor(communityId, `/api/communities/${communityId}/channels`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...communityAuthHeaders(communityId) },
          body: JSON.stringify({
            name: data.name,
            description: data.description || null,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to create channel');
        }
        const newChannel = await response.json();
        setChannels((prev) => [
          ...prev,
          {
            id: newChannel.id,
            name: newChannel.name,
            description: newChannel.description,
            type: 'text' as const,
          },
        ]);
        setShowCreateChannelModal(false);
        setActiveChannelId(newChannel.id);
      } catch (err) {
        console.error('Failed to create channel:', err);
        setCreateChannelError(err instanceof Error ? err.message : 'Failed to create channel');
      } finally {
        setIsCreatingChannel(false);
      }
    },
    [communityId],
  );

  const members: Member[] = useMemo(
    () =>
      roster.map((m) => ({
        id: m.signingPublicKey,
        publicId: m.signingPublicKey,
        displayName: m.displayName,
        role: 'MEMBER',
        isOnline: true,
      })),
    [roster],
  );

  const currentUser: CurrentUser = {
    publicId: publicId || '',
    displayName: session?.displayName,
    imageUrl: null,
    status: 'online',
  };

  const activeChannel = useMemo(() => {
    if (!activeChannelId) return null;
    const channel = channels.find((c) => c.id === activeChannelId);
    return channel ? { id: channel.id, name: channel.name, description: channel.description } : null;
  }, [activeChannelId, channels]);

  const sidebarChannels: Channel[] = useMemo(
    () =>
      channels.map((c) => ({
        id: c.id,
        name: c.name,
        type: 'text',
        isActive: c.id === activeChannelId,
      })),
    [channels, activeChannelId],
  );

  const headerInfo: ChatHeaderInfo | undefined = activeChannel
    ? { name: activeChannel.name, description: activeChannel.description, memberCount: members.length }
    : undefined;

  if (!isReady || (isLoading && !needsPassword)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-zinc-400">Loading community…</p>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="h-screen w-screen bg-black">
        <CommunityPasswordPrompt
          isOpen
          error={pwError}
          isSubmitting={pwSubmitting}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      </div>
    );
  }

  return (
    <>
      <AppLayout
        communities={communities}
        activeCommunityId={communityId}
        channels={sidebarChannels}
        directMessages={[]}
        currentUser={currentUser}
        activeChannel={activeChannel}
        members={members}
        isDMView={false}
        onSelectCommunity={handleSelectCommunity}
        onSelectChannel={handleSelectChannel}
        onSelectDM={handleSelectDM}
        onSwitchToDMs={handleSwitchToDMs}
        onAddCommunity={() => navigate('/app')}
        onAddChannel={() => setShowCreateChannelModal(true)}
        onUserSettings={handleSettings}
        onCopyInviteLink={handleCopyInvite}
        onDeleteCommunity={() => setShowDeleteConfirm(true)}
        onOpenSettings={handleOpenSettings}
        onOpenHelp={handleOpenHelp}
        onOpenPinned={handleOpenPinned}
        onOpenNotifications={handleOpenNotifications}
        onOpenSearch={handleOpenSearch}
        onMemberClick={handleMemberClick}
      >
        {activeChannelId ? (
          <ChatContainer
            mode="channel"
            channelId={activeChannelId}
            headerInfo={headerInfo}
            messages={messages}
            isLoading={false}
            onSend={handleSend}
            isSendReady={isRealtimeReady}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <h2 className="text-xl font-semibold text-white mb-2">Welcome to {community?.name}</h2>
              <p className="text-zinc-400">Select a channel from the sidebar to start chatting</p>
            </div>
          </div>
        )}
      </AppLayout>

      <UserProfileModal
        isOpen={selectedMember !== null}
        onClose={handleCloseProfileModal}
        user={selectedMember}
        onStartDM={handleStartDM}
        currentUserId={publicId || undefined}
      />

      <CreateChannelModal
        isOpen={showCreateChannelModal}
        onClose={() => setShowCreateChannelModal(false)}
        onSubmit={handleCreateChannel}
        isSubmitting={isCreatingChannel}
        error={createChannelError}
      />

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          {...deleteConfirmBackdrop}
        >
          <div className="w-full max-w-sm bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-red-900/40 p-6 space-y-4">
            <h3 className="font-semibold text-white">Delete this community?</h3>
            <p className="text-sm text-zinc-400">
              {community?.name ? `"${community.name}"` : 'This community'} and all of its channels
              will be removed from the server. Locally cached messages on your device stay until
              you reload. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCommunity}
                disabled={isDeleting}
                className="px-4 py-2 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
