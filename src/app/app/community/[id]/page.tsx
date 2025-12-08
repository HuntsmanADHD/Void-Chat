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
import { UserProfileModal, type UserProfileData } from '@/components/ui';
import { CreateChannelModal, type CreateChannelFormData } from '@/components/community/CreateChannelModal';

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
 * Community view page
 *
 * Features:
 * - Uses AppLayout with community context
 * - Shows channels in sidebar
 * - Defaults to general channel
 * - ChatContainer for messages
 * - MemberList in right sidebar
 */
export default function CommunityPage() {
  const router = useRouter();
  const params = useParams();
  const communityId = params.id as string;

  const {
    wallet,
    isConnected,
    isAuthenticated,
    session,
  } = useWalletAuth();
  const { getOrCreateKeyPair, isInitialized, hasKeypair } = useEncryption();

  // State
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [selectedMember, setSelectedMember] = useState<UserProfileData | null>(null);

  // Channel creation state
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);

  // Voice state
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  // Handle incoming realtime messages
  const handleMessage: OnMessageReceived = useCallback((message) => {
    if (message.channelId === activeChannelId) {
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
      // Add deduplication check to prevent duplicate messages
      setMessages((prev) => {
        // Check if message already exists
        if (prev.some(m => m.id === newMessage.id)) {
          return prev;
        }
        return [...prev, newMessage];
      });
    }
  }, [activeChannelId]);

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

  // Initialize encryption when authenticated
  useEffect(() => {
    const initEncryption = async () => {
      if (isAuthenticated && !isInitialized && !hasKeypair) {
        try {
          await getOrCreateKeyPair();
        } catch (error) {
          console.error('Failed to initialize encryption:', error);
        }
      }
    };
    initEncryption();
  }, [isAuthenticated, isInitialized, hasKeypair, getOrCreateKeyPair]);

  // Fetch community details
  useEffect(() => {
    const fetchCommunity = async () => {
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
          id: communityData.id,
          name: communityData.name,
          description: communityData.description,
          icon: communityData.avatar,
          ownerId: communityData.ownerId,
          minHold: BigInt(communityData.minTokenBalance || 0),
          memberCount: communityData.memberCount,
        });

        // Fetch channels
        const channelsResponse = await fetch(`/api/communities/${communityId}/channels`, {
          headers: authHeaders,
        });

        if (channelsResponse.ok) {
          const channelsData = await channelsResponse.json();
          const channelList: ChannelDetail[] = channelsData.channels || [];
          setChannels(channelList);

          // Select default channel (general or first)
          const generalChannel = channelList.find((c: ChannelDetail) => c.name.toLowerCase() === 'general');
          const defaultChannel = generalChannel || channelList[0];
          if (defaultChannel) {
            setActiveChannelId(defaultChannel.id);
          }
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
        console.error('Failed to fetch community:', error);
        router.push('/app');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCommunity();
    // Removed isUserOnline from deps to prevent excessive re-fetches
  }, [isAuthenticated, wallet, communityId, router, session]);

  // Join/leave channel when active channel changes
  useEffect(() => {
    if (activeChannelId && isAuthenticated) {
      joinChannel(activeChannelId);
      return () => {
        leaveChannel(activeChannelId);
      };
    }
    return undefined;
  }, [activeChannelId, isAuthenticated, joinChannel, leaveChannel]);

  // Fetch messages when channel changes
  useEffect(() => {
    const fetchMessages = async () => {
      if (!activeChannelId || !wallet || !session) return;

      setIsLoadingMessages(true);
      try {
        const response = await fetch(`/api/channels/${activeChannelId}/messages`, {
          headers: {
            'x-wallet-address': session.walletAddress,
            'x-wallet-signature': session.signature,
            'x-auth-message': session.message,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const messageList: MessageData[] = data.messages?.map((m: { id: string; encryptedContent: string; nonce: string; senderWallet: string; senderXHandle?: string | null; channelId: string | null; createdAt: string }) => ({
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
            channelId: m.channelId,
            createdAt: new Date(m.createdAt),
          })) || [];
          // Reverse to show oldest first (API returns newest first)
          setMessages(messageList.reverse());
        }
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    fetchMessages();
  }, [activeChannelId, wallet, session]);

  // Handle channel selection
  const handleSelectChannel = useCallback((channelId: string) => {
    setActiveChannelId(channelId);
    router.push(`/app/community/${communityId}/channel/${channelId}`, { scroll: false });
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
  const handleMessageSent = useCallback(async (message: { content: string; nonce: string }) => {
    if (!activeChannelId || !wallet || !session) return;

    try {
      // Send to API to persist message
      const response = await fetch(`/api/channels/${activeChannelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': session.walletAddress,
          'x-wallet-signature': session.signature,
          'x-auth-message': session.message,
        },
        body: JSON.stringify({
          encryptedContent: message.content,
          nonce: message.nonce,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to send message:', errorData.error);
        return;
      }

      const newMessage = await response.json();

      // Add message to local state for immediate display
      const msgData: MessageData = {
        id: newMessage.id,
        content: newMessage.encryptedContent,
        nonce: newMessage.nonce,
        senderId: newMessage.senderWallet,
        sender: {
          walletAddress: newMessage.senderWallet,
          xHandle: newMessage.senderXHandle || null,
          xVerified: false,
          tokenBalance: BigInt(0),
          strikes: 0,
        },
        channelId: newMessage.channelId,
        createdAt: new Date(newMessage.createdAt),
      };
      // Add message with deduplication check (in case realtime already added it)
      setMessages((prev) => {
        if (prev.some(m => m.id === msgData.id)) {
          return prev;
        }
        return [...prev, msgData];
      });

      // Also broadcast via realtime for other users
      sendChannelMessage(activeChannelId, message.content, message.nonce);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, [activeChannelId, wallet, session, sendChannelMessage]);

  // Handle member click - show profile modal
  const handleMemberClick = useCallback((member: Member) => {
    setSelectedMember({
      id: member.id,
      walletAddress: member.walletAddress,
      xHandle: member.xHandle,
      xVerified: member.xVerified,
      imageUrl: member.imageUrl,
      status: member.status,
      role: member.role,
      tokenBalance: member.tokenBalance,
      strikes: member.strikes,
      isOnline: member.isOnline,
    });
  }, []);

  // Handle start DM from profile modal
  const handleStartDM = useCallback((memberWallet: string) => {
    router.push(`/app/dm/${memberWallet}`);
  }, [router]);

  // Close profile modal
  const handleCloseProfileModal = useCallback(() => {
    setSelectedMember(null);
  }, []);

  // Handle settings
  const handleSettings = useCallback(() => {
    router.push('/app/settings');
  }, [router]);

  // Handle open settings (header settings button)
  const handleOpenSettings = useCallback(() => {
    router.push('/app/settings');
  }, [router]);

  // Handle open help
  const handleOpenHelp = useCallback(() => {
    console.log('Help requested');
    alert('Help feature coming soon!');
  }, []);

  // Handle open pinned
  const handleOpenPinned = useCallback(() => {
    console.log('Pinned messages requested');
    alert('Pinned messages feature coming soon!');
  }, []);

  // Handle open notifications
  const handleOpenNotifications = useCallback(() => {
    console.log('Notifications requested');
    alert('Notifications feature coming soon!');
  }, []);

  // Handle open search
  const handleOpenSearch = useCallback(() => {
    console.log('Search requested');
    alert('Search feature coming soon!');
  }, []);

  // Handle create channel
  const handleCreateChannel = useCallback(async (data: CreateChannelFormData) => {
    if (!wallet || !communityId || !session) return;

    setIsCreatingChannel(true);
    setCreateChannelError(null);

    try {
      const response = await fetch(`/api/communities/${communityId}/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': session.walletAddress,
          'x-wallet-signature': session.signature,
          'x-auth-message': session.message,
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create channel');
      }

      const newChannel = await response.json();

      // Add the new channel to the list
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

      // Navigate to the new channel
      setActiveChannelId(newChannel.id);
    } catch (error) {
      console.error('Failed to create channel:', error);
      setCreateChannelError(error instanceof Error ? error.message : 'Failed to create channel');
    } finally {
      setIsCreatingChannel(false);
    }
  }, [wallet, communityId, session]);

  // Handle toggle mute
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Handle toggle deafen
  const handleToggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      // If deafening, also mute
      if (!prev) {
        setIsMuted(true);
      }
      return !prev;
    });
  }, []);

  // Current user
  const currentUser: CurrentUser = {
    walletAddress: wallet || '',
    xHandle: null,
    imageUrl: null,
    status: 'online',
    isMuted,
    isDeafened,
  };

  // Active channel for header
  const activeChannel = useMemo(() => {
    if (!activeChannelId) return null;
    const channel = channels.find((c) => c.id === activeChannelId);
    if (!channel) return null;
    return {
      id: channel.id,
      name: channel.name,
      description: channel.description,
    };
  }, [activeChannelId, channels]);

  // Sidebar channels format
  const sidebarChannels: Channel[] = useMemo(() => {
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      isActive: c.id === activeChannelId,
    }));
  }, [channels, activeChannelId]);

  // Chat header info
  const headerInfo: ChatHeaderInfo | undefined = activeChannel ? {
    name: activeChannel.name,
    description: activeChannel.description,
    memberCount: members.length,
  } : undefined;

  // Loading state
  if (!isConnected || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 flex items-center justify-center mb-4 mx-auto animate-pulse border border-zinc-500/30">
            <span className="text-zinc-100 font-bold text-2xl">C</span>
          </div>
          <p className="text-zinc-400">Loading community...</p>
        </div>
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
      communityOwnerWallet={community?.ownerId}
      verifiedHolderThreshold={community?.minHold}
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
            isLoading={isLoadingMessages}
            onMessageSent={handleMessageSent}
            isTimedOut={false}
            testMode={true} // TESTING: Enable test mode for development
          />
      ) : (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-white mb-2">
              Welcome to {community?.name}
            </h2>
            <p className="text-zinc-400">
              Select a channel from the sidebar to start chatting
            </p>
          </div>
        </div>
      )}
    </AppLayout>

      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={selectedMember !== null}
        onClose={handleCloseProfileModal}
        user={selectedMember}
        verifiedHolderThreshold={community?.minHold}
        ownerWallet={community?.ownerId}
        onStartDM={handleStartDM}
        currentUserWallet={wallet || undefined}
      />

      {/* Create Channel Modal */}
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
