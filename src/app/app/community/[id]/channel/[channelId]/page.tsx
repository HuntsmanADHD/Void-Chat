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

interface ChannelDetail {
  id: string;
  name: string;
  description?: string;
  type: 'text' | 'voice';
}

export default function ChannelPage() {
  const router = useRouter();
  const params = useParams();
  const communityId = params.id as string;
  const channelId = params.channelId as string;

  const { session, isReady } = useSession();
  const publicId = session?.signingPublicKey ?? '';

  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const handleChannelMessage = useCallback(
    (msg: DecryptedChannelMessage) => {
      if (msg.channelId !== channelId) return;
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
    [channelId],
  );

  const { joinChannel, leaveChannel, sendChannelMessage, isReady: isRealtimeReady } =
    useRealtime({ onChannelMessage: handleChannelMessage });

  const roster = useChannelRoster(channelId);

  useEffect(() => {
    const fetchData = async () => {
      if (!isReady || !communityId) return;
      setIsLoading(true);
      try {
        const [channelsRes, allRes] = await Promise.all([
          fetch(`/api/communities/${communityId}/channels`),
          fetch('/api/communities'),
        ]);
        if (!channelsRes.ok) {
          // 404 here means the community itself doesn't exist (the channels
          // route 404s on missing community); bounce back to the dashboard.
          if (channelsRes.status === 404) router.push('/app');
          return;
        }
        const chData = await channelsRes.json();
        setChannels(chData.channels || []);
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
        console.error('Failed to fetch channel data:', err);
        router.push('/app');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [isReady, communityId, router]);

  useEffect(() => {
    if (!channelId || !isReady) return;
    joinChannel(channelId);
    return () => leaveChannel(channelId);
  }, [channelId, isReady, joinChannel, leaveChannel]);

  useEffect(() => {
    setMessages([]);
  }, [channelId]);

  const handleSend = useCallback(
    async (plaintext: string) => {
      // The relay skips the sender on fan-out, so we never see our own
      // message via onChannelMessage. Append a local copy here so the
      // sender sees what they just sent. No reconciliation needed —
      // local-prefixed ids can't collide with server-issued m_* ids.
      const optimistic: MessageData = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: plaintext,
        nonce: '',
        senderId: publicId,
        sender: { publicId },
        channelId,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, optimistic]);
      return sendChannelMessage(channelId, plaintext);
    },
    [channelId, publicId, sendChannelMessage],
  );

  const handleSelectChannel = useCallback(
    (newChannelId: string) => router.push(`/app/community/${communityId}/channel/${newChannelId}`),
    [communityId, router],
  );
  const handleSelectCommunity = useCallback(
    (newCommunityId: string) => router.push(`/app/community/${newCommunityId}`),
    [router],
  );
  const handleSelectDM = useCallback(
    (dmId: string) => router.push(`/app/dm/${dmId}`),
    [router],
  );
  const handleSwitchToDMs = useCallback(() => router.push('/app'), [router]);
  const handleMemberClick = useCallback(
    (member: Member) => {
      if (member.publicId !== publicId) router.push(`/app/dm/${member.publicId}`);
    },
    [publicId, router],
  );
  const handleSettings = useCallback(() => router.push('/app/settings'), [router]);

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
  };

  const activeChannel = useMemo(() => {
    const channel = channels.find((c) => c.id === channelId);
    return channel ? { id: channel.id, name: channel.name, description: channel.description } : null;
  }, [channelId, channels]);

  const sidebarChannels: Channel[] = useMemo(
    () =>
      channels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        isActive: c.id === channelId,
      })),
    [channels, channelId],
  );

  const headerInfo: ChatHeaderInfo | undefined = activeChannel
    ? { name: activeChannel.name, description: activeChannel.description, memberCount: members.length }
    : undefined;

  if (!isReady || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-zinc-400">Loading channel…</p>
      </div>
    );
  }

  if (!activeChannel) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Channel Not Found</h2>
          <button
            onClick={() => router.push(`/app/community/${communityId}`)}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
          >
            Back to Community
          </button>
        </div>
      </div>
    );
  }

  return (
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
      onUserSettings={handleSettings}
      onMemberClick={handleMemberClick}
    >
      <ChatContainer
        mode="channel"
        channelId={channelId}
        headerInfo={headerInfo}
        messages={messages}
        isLoading={false}
        onSend={handleSend}
        isSendReady={isRealtimeReady}
      />
    </AppLayout>
  );
}
