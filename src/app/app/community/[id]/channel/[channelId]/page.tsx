'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useAuth } from '@/hooks/useAuth';
import { useEncryption } from '@/hooks/useEncryption';
import { useRealtime, type OnMessageReceived } from '@/hooks/useRealtime';
import type { Community, Channel, CurrentUser } from '@/components/layout/Sidebar';
import type { Member } from '@/components/layout/MemberList';

interface CommunityDetail {
  id: string;
  name: string;
  icon?: string | null;
  description?: string;
  ownerId: string;
  memberCount: number;
}

interface ChannelDetail {
  id: string;
  name: string;
  description?: string;
  type: 'text' | 'voice';
}

/**
 * Channel view page
 */
export default function ChannelPage() {
  const router = useRouter();
  const params = useParams();
  const communityId = params.id as string;
  const channelId = params.channelId as string;

  const {
    publicId,
    isAuthenticated,
    session,
  } = useAuth();
  const { } = useEncryption();

  // State
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Handle incoming realtime messages
  const handleMessage: OnMessageReceived = useCallback((message) => {
    if (message.channelId === channelId) {
      const msgAny = message as { encrypted?: string; nonce?: string };
      const newMessage: MessageData = {
        id: message.id,
        content: msgAny.encrypted || '',
        nonce: msgAny.nonce || '',
        senderId: message.senderId,
        sender: {
          publicId: message.senderId,
        },
        channelId: message.channelId,
        createdAt: new Date(message.timestamp),
      };
      setMessages((prev) => [...prev, newMessage]);
    }
  }, [channelId]);

  const {
    joinChannel,
    leaveChannel,
    sendChannelMessage,
    isUserOnline,
  } = useRealtime({
    onMessage: handleMessage,
    autoConnect: isAuthenticated,
  });

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  // Fetch community and channel details
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || !publicId || !communityId || !session) return;

      const authHeaders = {
        'x-public-id': session.publicId,
        'x-signature': session.signature,
      };

      setIsLoading(true);
      try {
        const communityResponse = await fetch(`/api/communities/${communityId}`, {
          headers: authHeaders,
        });

        if (!communityResponse.ok) {
          if (communityResponse.status === 404) {
            router.push('/app');
            return;
          }
          throw new Error('Failed to fetch community');
        }

        const communityData = await communityResponse.json();
        setCommunity({
          ...communityData.community,
        });

        const channelsResponse = await fetch(`/api/communities/${communityId}/channels`, {
          headers: authHeaders,
        });

        if (channelsResponse.ok) {
          const channelsData = await channelsResponse.json();
          setChannels(channelsData.channels || []);
        }

        const membersResponse = await fetch(`/api/communities/${communityId}/members`, {
          headers: authHeaders,
        });

        if (membersResponse.ok) {
          const membersData = await membersResponse.json();
          const memberList: Member[] = membersData.members?.map((m: { publicId: string; role?: string }) => ({
            id: m.publicId,
            publicId: m.publicId,
            role: m.role || 'MEMBER',
            isOnline: isUserOnline(m.publicId),
          })) || [];
          setMembers(memberList);
        }

        const allCommunitiesResponse = await fetch('/api/communities', {
          headers: authHeaders,
        });

        if (allCommunitiesResponse.ok) {
          const allData = await allCommunitiesResponse.json();
          const communityList: Community[] = allData.communities?.map((c: { id: string; name: string; icon?: string }) => ({
            id: c.id,
            name: c.name,
            icon: c.icon || null,
            unreadCount: 0,
          })) || [];
          setCommunities(communityList);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
        router.push('/app');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, publicId, communityId, router, isUserOnline, session]);

  // Join channel when component mounts
  useEffect(() => {
    if (channelId && isAuthenticated) {
      joinChannel(channelId);
      return () => {
        leaveChannel(channelId);
      };
    }
    return undefined;
  }, [channelId, isAuthenticated, joinChannel, leaveChannel]);

  // Messages come from socket events only — no server-side storage
  // On mount, start with an empty message list. New messages arrive via handleMessage.

  const handleSelectChannel = useCallback((newChannelId: string) => {
    router.push(`/app/community/${communityId}/channel/${newChannelId}`);
  }, [communityId, router]);

  const handleSelectCommunity = useCallback((newCommunityId: string) => {
    router.push(`/app/community/${newCommunityId}`);
  }, [router]);

  const handleSelectDM = useCallback((dmId: string) => {
    router.push(`/app/dm/${dmId}`);
  }, [router]);

  const handleSwitchToDMs = useCallback(() => {
    router.push('/app');
  }, [router]);

  const handleMessageSent = useCallback((message: { content: string; nonce: string }) => {
    sendChannelMessage(channelId, message.content, message.nonce);
  }, [channelId, sendChannelMessage]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleReport = useCallback((_messageId: string, _senderId: string) => {}, []);

  const handleMemberClick = useCallback((member: Member) => {
    if (member.publicId !== publicId) {
      router.push(`/app/dm/${member.publicId}`);
    }
  }, [router, publicId]);

  const handleSettings = useCallback(() => {
    router.push('/app/settings');
  }, [router]);

  // Current user
  const currentUser: CurrentUser = {
    publicId: publicId || '',
    imageUrl: null,
    status: 'online',
  };

  const activeChannel = useMemo(() => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return null;
    return { id: channel.id, name: channel.name, description: channel.description };
  }, [channelId, channels]);

  const sidebarChannels: Channel[] = useMemo(() => {
    return channels.map((c) => ({
      id: c.id, name: c.name, type: c.type, isActive: c.id === channelId,
    }));
  }, [channels, channelId]);

  const headerInfo: ChatHeaderInfo | undefined = activeChannel ? {
    name: activeChannel.name, description: activeChannel.description, memberCount: members.length,
  } : undefined;

  if (!isAuthenticated || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 flex items-center justify-center mb-4 mx-auto animate-pulse border border-zinc-500/30">
            <span className="text-zinc-100 font-bold text-2xl">C</span>
          </div>
          <p className="text-zinc-400">Loading channel...</p>
        </div>
      </div>
    );
  }

  if (!activeChannel && !isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Channel Not Found</h2>
          <p className="text-zinc-400 mb-4">This channel does not exist or you do not have access.</p>
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
      communityOwnerId={community?.ownerId}
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
        hasMore={false}
        onLoadMore={() => {}}
        onMessageSent={handleMessageSent}
        onReport={handleReport}
        isTimedOut={false}
      />
    </AppLayout>
  );
}
