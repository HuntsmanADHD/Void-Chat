'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useWalletAuth } from '@/hooks/useWalletAuth';
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
  minHold: bigint;
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
 *
 * Features:
 * - Same as community but with specific channel selected
 * - ChatContainer connected to channel
 * - Real-time messaging
 * - E2E encryption
 */
export default function ChannelPage() {
  const router = useRouter();
  const params = useParams();
  const communityId = params.id as string;
  const channelId = params.channelId as string;

  const {
    wallet,
    isConnected,
    isAuthenticated,
    session,
  } = useWalletAuth();
  const { } = useEncryption();

  // State
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);

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
          walletAddress: message.senderId,
          xHandle: null,
          xVerified: false,
          tokenBalance: BigInt(0),
          strikes: 0,
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

  // Redirect if not connected
  useEffect(() => {
    if (!isConnected) {
      router.push('/');
    }
  }, [isConnected, router]);

  // Fetch community and channel details
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || !wallet || !communityId || !session) return;

      // Build auth headers
      const authHeaders = {
        'x-wallet-address': session.walletAddress,
        'x-wallet-signature': session.signature,
        'x-auth-message': session.message,
      };

      setIsLoading(true);
      try {
        // Fetch community details
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
          minHold: BigInt(communityData.community.minHold || 0),
        });

        // Fetch channels
        const channelsResponse = await fetch(`/api/communities/${communityId}/channels`, {
          headers: authHeaders,
        });

        if (channelsResponse.ok) {
          const channelsData = await channelsResponse.json();
          setChannels(channelsData.channels || []);
        }

        // Fetch members
        const membersResponse = await fetch(`/api/communities/${communityId}/members`, {
          headers: authHeaders,
        });

        if (membersResponse.ok) {
          const membersData = await membersResponse.json();
          const memberList: Member[] = membersData.members?.map((m: { walletAddress: string; xHandle?: string; xVerified?: boolean; role?: string; tokenBalance?: string }) => ({
            walletAddress: m.walletAddress,
            xHandle: m.xHandle || null,
            xVerified: m.xVerified || false,
            role: m.role || 'MEMBER',
            isOnline: isUserOnline(m.walletAddress),
            tokenBalance: BigInt(m.tokenBalance || 0),
          })) || [];
          setMembers(memberList);
        }

        // Fetch all communities for sidebar
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
  }, [isAuthenticated, wallet, communityId, router, isUserOnline, session]);

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

  // Fetch messages for the channel
  useEffect(() => {
    const fetchMessages = async () => {
      if (!channelId || !wallet || !session) return;

      setIsLoadingMessages(true);
      try {
        const response = await fetch(`/api/channels/${channelId}/messages`, {
          headers: {
            'x-wallet-address': session.walletAddress,
            'x-wallet-signature': session.signature,
            'x-auth-message': session.message,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const messageList: MessageData[] = data.messages?.map((m: { id: string; encryptedContent: string; nonce: string; senderWallet: string; senderXHandle?: string | null; createdAt: string }) => ({
            id: m.id,
            content: m.encryptedContent,
            nonce: m.nonce,
            senderId: m.senderWallet,
            sender: {
              walletAddress: m.senderWallet,
              xHandle: m.senderXHandle || null,
              xVerified: false,
              tokenBalance: BigInt(0),
              strikes: 0,
            },
            channelId: channelId,
            createdAt: new Date(m.createdAt),
          })) || [];
          setMessages(messageList);
          setHasMore(data.hasMore || false);
        }
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    fetchMessages();
  }, [channelId, wallet, session]);

  // Handle load more messages
  const handleLoadMore = useCallback(async () => {
    if (!channelId || !wallet || !session || messages.length === 0) return;

    const oldestMessage = messages[0];
    try {
      const response = await fetch(
        `/api/channels/${channelId}/messages?cursor=${oldestMessage.id}`,
        {
          headers: {
            'x-wallet-address': session.walletAddress,
            'x-wallet-signature': session.signature,
            'x-auth-message': session.message,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const olderMessages: MessageData[] = data.messages?.map((m: { id: string; encryptedContent: string; nonce: string; senderWallet: string; senderXHandle?: string | null; createdAt: string }) => ({
          id: m.id,
          content: m.encryptedContent,
          nonce: m.nonce,
          senderId: m.senderWallet,
          sender: {
            walletAddress: m.senderWallet,
            xHandle: m.senderXHandle || null,
            xVerified: false,
            tokenBalance: BigInt(0),
            strikes: 0,
          },
          channelId: channelId,
          createdAt: new Date(m.createdAt),
        })) || [];
        setMessages((prev) => [...olderMessages, ...prev]);
        setHasMore(data.hasMore || false);
      }
    } catch (error) {
      console.error('Failed to load more messages:', error);
    }
  }, [channelId, wallet, session, messages]);

  // Handle channel selection
  const handleSelectChannel = useCallback((newChannelId: string) => {
    router.push(`/app/community/${communityId}/channel/${newChannelId}`);
  }, [communityId, router]);

  // Handle community selection
  const handleSelectCommunity = useCallback((newCommunityId: string) => {
    router.push(`/app/community/${newCommunityId}`);
  }, [router]);

  // Handle DM selection
  const handleSelectDM = useCallback((dmWallet: string) => {
    router.push(`/app/dm/${dmWallet}`);
  }, [router]);

  // Handle switch to DMs
  const handleSwitchToDMs = useCallback(() => {
    router.push('/app');
  }, [router]);

  // Handle message sent
  const handleMessageSent = useCallback((message: { content: string; nonce: string }) => {
    sendChannelMessage(channelId, message.content, message.nonce);
  }, [channelId, sendChannelMessage]);

  // Handle report
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleReport = useCallback((_messageId: string, _senderId: string) => {
    // Report will be handled by the ReportModal component
  }, []);

  // Handle member click
  const handleMemberClick = useCallback((member: Member) => {
    if (member.walletAddress !== wallet) {
      router.push(`/app/dm/${member.walletAddress}`);
    }
  }, [router, wallet]);

  // Handle settings
  const handleSettings = useCallback(() => {
    router.push('/app/settings');
  }, [router]);

  // Current user
  const currentUser: CurrentUser = {
    walletAddress: wallet || '',
    xHandle: null,
    imageUrl: null,
    status: 'online',
  };

  // Active channel for header
  const activeChannel = useMemo(() => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return null;
    return {
      id: channel.id,
      name: channel.name,
      description: channel.description,
    };
  }, [channelId, channels]);

  // Sidebar channels format
  const sidebarChannels: Channel[] = useMemo(() => {
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      isActive: c.id === channelId,
    }));
  }, [channels, channelId]);

  // Chat header info
  const headerInfo: ChatHeaderInfo | undefined = activeChannel ? {
    name: activeChannel.name,
    description: activeChannel.description,
    memberCount: members.length,
  } : undefined;

  // Loading state
  if (!isConnected || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--discord-bg)]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center mb-4 mx-auto animate-pulse">
            <span className="text-white font-bold text-2xl">C</span>
          </div>
          <p className="text-zinc-400">Loading channel...</p>
        </div>
      </div>
    );
  }

  // Channel not found
  if (!activeChannel && !isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--discord-bg)]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Channel Not Found</h2>
          <p className="text-zinc-400 mb-4">This channel does not exist or you do not have access.</p>
          <button
            onClick={() => router.push(`/app/community/${communityId}`)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
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
      communityOwnerWallet={community?.ownerId}
      verifiedHolderThreshold={community?.minHold}
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
        isLoading={isLoadingMessages}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onMessageSent={handleMessageSent}
        onReport={handleReport}
        isTimedOut={false}
      />
    </AppLayout>
  );
}
