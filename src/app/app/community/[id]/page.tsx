'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useSession } from '@/hooks/useSession';
import { useChannelRoster, useRealtime, type DecryptedChannelMessage } from '@/hooks/useRealtime';
import type { Channel, Community, CurrentUser } from '@/components/layout/Sidebar';
import type { Member } from '@/components/layout/MemberList';
import { UserProfileModal, type UserProfileData } from '@/components/ui';
import { CreateChannelModal, type CreateChannelFormData } from '@/components/community/CreateChannelModal';

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

export default function CommunityPage() {
  const router = useRouter();
  const params = useParams();
  const communityId = params.id as string;

  const { session, isReady } = useSession();
  const publicId = session?.signingPublicKey ?? '';

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<UserProfileData | null>(null);

  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

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
          sender: { publicId: msg.senderSigningPublicKey },
          channelId: msg.channelId,
          createdAt: new Date(msg.ts),
        };
        return [...prev, decoded];
      });
    },
    [activeChannelId],
  );

  const { joinChannel, leaveChannel, sendChannelMessage, isReady: isRealtimeReady } =
    useRealtime({ onChannelMessage: handleChannelMessage });

  const roster = useChannelRoster(activeChannelId);

  useEffect(() => {
    const fetch_ = async () => {
      if (!isReady || !communityId) return;
      setIsLoading(true);
      try {
        const [communityRes, channelsRes, allRes] = await Promise.all([
          fetch(`/api/communities/${communityId}`),
          fetch(`/api/communities/${communityId}/channels`),
          fetch('/api/communities'),
        ]);
        if (!communityRes.ok) {
          if (communityRes.status === 404) router.push('/app');
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
          const list: Community[] =
            allData.communities?.map((c: { id: string; name: string; icon?: string }) => ({
              id: c.id,
              name: c.name,
              icon: c.icon || null,
              unreadCount: 0,
            })) || [];
          setCommunities(list);
        }
      } catch (err) {
        console.error('Failed to fetch community:', err);
        router.push('/app');
      } finally {
        setIsLoading(false);
      }
    };
    fetch_();
  }, [isReady, communityId, router]);

  useEffect(() => {
    if (!activeChannelId || !isReady) return;
    joinChannel(activeChannelId);
    return () => leaveChannel(activeChannelId);
  }, [activeChannelId, isReady, joinChannel, leaveChannel]);

  useEffect(() => {
    setMessages([]);
  }, [activeChannelId]);

  const handleSend = useCallback(
    async (plaintext: string) => {
      if (!activeChannelId) return false;
      const optimistic: MessageData = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: plaintext,
        nonce: '',
        senderId: publicId,
        sender: { publicId },
        channelId: activeChannelId,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, optimistic]);
      return sendChannelMessage(activeChannelId, plaintext);
    },
    [activeChannelId, publicId, sendChannelMessage],
  );

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      router.push(`/app/community/${communityId}/channel/${channelId}`, { scroll: false });
    },
    [communityId, router],
  );

  const handleSelectCommunity = useCallback(
    (newCommunityId: string) => router.push(`/app/community/${newCommunityId}`),
    [router],
  );
  const handleSelectDM = useCallback((dmId: string) => router.push(`/app/dm/${dmId}`), [router]);
  const handleSwitchToDMs = useCallback(() => router.push('/app'), [router]);

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
  const handleStartDM = useCallback((memberId: string) => router.push(`/app/dm/${memberId}`), [router]);
  const handleCloseProfileModal = useCallback(() => setSelectedMember(null), []);

  const handleSettings = useCallback(() => router.push('/app/settings'), [router]);
  const handleOpenSettings = useCallback(() => router.push('/app/settings'), [router]);
  const handleOpenHelp = useCallback(() => alert('Help feature coming soon!'), []);
  const handleOpenPinned = useCallback(() => alert('Pinned messages feature coming soon!'), []);
  const handleOpenNotifications = useCallback(() => alert('Notifications feature coming soon!'), []);
  const handleOpenSearch = useCallback(() => alert('Search feature coming soon!'), []);

  const handleCreateChannel = useCallback(
    async (data: CreateChannelFormData) => {
      if (!communityId) return;
      setIsCreatingChannel(true);
      setCreateChannelError(null);
      try {
        const response = await fetch(`/api/communities/${communityId}/channels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

  const handleToggleMute = useCallback(() => setIsMuted((p) => !p), []);
  const handleToggleDeafen = useCallback(() => {
    setIsDeafened((p) => {
      if (!p) setIsMuted(true);
      return !p;
    });
  }, []);

  const members: Member[] = useMemo(
    () =>
      roster.map((m) => ({
        id: m.signingPublicKey,
        publicId: m.signingPublicKey,
        role: 'MEMBER',
        isOnline: true,
      })),
    [roster],
  );

  const currentUser: CurrentUser = {
    publicId: publicId || '',
    imageUrl: null,
    status: 'online',
    isMuted,
    isDeafened,
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
        type: c.type,
        isActive: c.id === activeChannelId,
      })),
    [channels, activeChannelId],
  );

  const headerInfo: ChatHeaderInfo | undefined = activeChannel
    ? { name: activeChannel.name, description: activeChannel.description, memberCount: members.length }
    : undefined;

  if (!isReady || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-zinc-400">Loading community…</p>
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
        onAddCommunity={() => router.push('/app')}
        onAddChannel={() => setShowCreateChannelModal(true)}
        onUserSettings={handleSettings}
        onOpenSettings={handleOpenSettings}
        onOpenHelp={handleOpenHelp}
        onOpenPinned={handleOpenPinned}
        onOpenNotifications={handleOpenNotifications}
        onOpenSearch={handleOpenSearch}
        onMemberClick={handleMemberClick}
        onToggleMute={handleToggleMute}
        onToggleDeafen={handleToggleDeafen}
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
            <div className="text-center">
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
    </>
  );
}
