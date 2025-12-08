'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Lock, Shield } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { useEncryption } from '@/hooks/useEncryption';
import { useRealtime, type OnMessageReceived } from '@/hooks/useRealtime';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/components/ui/Toast';
import type { Community, DirectMessage, CurrentUser } from '@/components/layout/Sidebar';
import type { Member } from '@/components/layout/MemberList';
import type { HeaderUser } from '@/components/layout/Header';

interface DMUserProfile {
  walletAddress: string;
  xHandle?: string | null;
  xVerified: boolean;
  tokenBalance: bigint;
  strikes: number;
  publicKey: string;
  imageUrl?: string | null;
}

/**
 * DM conversation page
 *
 * Features:
 * - Uses AppLayout
 * - ChatContainer for DM messages
 * - User profile in right sidebar
 * - E2E encryption active
 * - P2P messaging when available
 */
export default function DMPage() {
  const router = useRouter();
  const params = useParams();
  const recipientWallet = params.wallet as string;

  const {
    wallet,
    isConnected,
    isAuthenticated,
    tokenBalance,
    session,
  } = useWalletAuth();
  const { } = useEncryption();
  const api = useApi();
  const { error: showError } = useToast();

  // State
  const [recipientProfile, setRecipientProfile] = useState<DMUserProfile | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Handle incoming realtime messages
  const handleMessage: OnMessageReceived = useCallback((message) => {
    // Check if this message is for this DM conversation
    const isFromRecipient = message.senderId === recipientWallet;
    const isToRecipient = message.dmRecipientId === recipientWallet;

    if (isFromRecipient || isToRecipient) {
      const msgAny = message as { encrypted?: string; nonce?: string };
      const newMessage: MessageData = {
        id: message.id,
        content: msgAny.encrypted || '',
        nonce: msgAny.nonce || '',
        senderId: message.senderId,
        sender: {
          walletAddress: message.senderId,
          xHandle: isFromRecipient ? recipientProfile?.xHandle || null : null,
          xVerified: isFromRecipient ? recipientProfile?.xVerified || false : false,
          tokenBalance: isFromRecipient ? recipientProfile?.tokenBalance || BigInt(0) : tokenBalance,
          strikes: 0,
        },
        dmRecipient: message.dmRecipientId,
        createdAt: new Date(message.timestamp),
      };
      setMessages((prev) => [...prev, newMessage]);
    }
  }, [recipientWallet, recipientProfile, tokenBalance]);

  const {
    joinDM,
    leaveDM,
    sendMessage,
    isUserOnline,
    isPeerConnected,
    initiatePeerConnection,
  } = useRealtime({
    onMessage: handleMessage,
    autoConnect: isAuthenticated,
    preferP2P: true,
  });

  // Redirect if not connected
  useEffect(() => {
    if (!isConnected) {
      router.push('/');
    }
  }, [isConnected, router]);

  // Prevent DM to self
  useEffect(() => {
    if (wallet && recipientWallet === wallet) {
      router.push('/app');
    }
  }, [wallet, recipientWallet, router]);

  // Fetch recipient profile
  useEffect(() => {
    const fetchRecipientProfile = async () => {
      if (!isAuthenticated || !wallet || !recipientWallet) return;

      setIsLoading(true);

      const [userResponse, communitiesResponse, dmsResponse] = await Promise.all([
        api.get<{ user: {
          walletAddress: string;
          xHandle?: string;
          xVerified?: boolean;
          tokenBalance?: string;
          strikes?: number;
          publicKey?: string;
          imageUrl?: string;
        } }>(`/api/users/${recipientWallet}`, { showErrorToast: false }),
        api.get<{ communities: Array<{ id: string; name: string; icon?: string }> }>('/api/communities', { showErrorToast: false }),
        api.get<{ conversations: Array<{
          recipientWallet: string;
          recipientXHandle?: string;
          recipientImageUrl?: string;
          unreadCount?: number;
        }> }>(`/api/dm/${wallet}`, { showErrorToast: false }),
      ]);

      if (userResponse.success && userResponse.data?.user) {
        const data = userResponse.data.user;
        setRecipientProfile({
          walletAddress: data.walletAddress,
          xHandle: data.xHandle || null,
          xVerified: data.xVerified || false,
          tokenBalance: BigInt(data.tokenBalance || 0),
          strikes: data.strikes || 0,
          publicKey: data.publicKey || '',
          imageUrl: data.imageUrl || null,
        });
      } else if (userResponse.error?.statusCode === 404) {
        setRecipientProfile({
          walletAddress: recipientWallet,
          xHandle: null,
          xVerified: false,
          tokenBalance: BigInt(0),
          strikes: 0,
          publicKey: '',
        });
      } else {
        showError('Failed to load user profile');
      }

      if (communitiesResponse.success && communitiesResponse.data?.communities) {
        const communityList: Community[] = communitiesResponse.data.communities.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon || null,
          unreadCount: 0,
        }));
        setCommunities(communityList);
      }

      if (dmsResponse.success && dmsResponse.data?.conversations) {
        const dmList: DirectMessage[] = dmsResponse.data.conversations.map((c) => ({
          id: c.recipientWallet,
          recipientWallet: c.recipientWallet,
          recipientXHandle: c.recipientXHandle || null,
          recipientImageUrl: c.recipientImageUrl || null,
          status: isUserOnline(c.recipientWallet) ? 'online' : 'offline',
          unreadCount: c.unreadCount || 0,
          isActive: c.recipientWallet === recipientWallet,
        }));

        if (!dmList.find((d) => d.recipientWallet === recipientWallet)) {
          dmList.unshift({
            id: recipientWallet,
            recipientWallet: recipientWallet,
            recipientXHandle: null,
            recipientImageUrl: null,
            status: isUserOnline(recipientWallet) ? 'online' : 'offline',
            unreadCount: 0,
            isActive: true,
          });
        }

        setDirectMessages(dmList);
      }

      setIsLoading(false);
    };

    fetchRecipientProfile();
  }, [isAuthenticated, wallet, recipientWallet, isUserOnline, api, showError]);

  // Join DM room
  useEffect(() => {
    if (recipientWallet && isAuthenticated) {
      joinDM(recipientWallet);

      // Try to establish P2P connection
      if (!isPeerConnected(recipientWallet) && isUserOnline(recipientWallet)) {
        initiatePeerConnection(recipientWallet);
      }

      return () => {
        leaveDM(recipientWallet);
      };
    }
    return undefined;
  }, [recipientWallet, isAuthenticated, joinDM, leaveDM, isPeerConnected, isUserOnline, initiatePeerConnection]);

  // Fetch messages
  useEffect(() => {
    const fetchMessages = async () => {
      if (!recipientWallet || !wallet) return;

      setIsLoadingMessages(true);

      const response = await api.get<{ messages: Array<{
        id: string;
        encryptedContent: string;
        nonce: string;
        senderWallet: string;
        senderXHandle?: string | null;
        recipientWallet?: string | null;
        createdAt: string;
      }>; hasMore?: boolean }>(`/api/dm/${recipientWallet}`, { showErrorToast: false });

      if (response.success && response.data?.messages) {
        const messageList: MessageData[] = response.data.messages.map((m) => ({
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
          dmRecipient: m.recipientWallet || null,
          createdAt: new Date(m.createdAt),
        }));
        setMessages(messageList);
        setHasMore(response.data?.hasMore || false);
      }

      setIsLoadingMessages(false);
    };

    fetchMessages();
  }, [recipientWallet, wallet, api]);

  // Handle load more messages
  const handleLoadMore = useCallback(async () => {
    if (!recipientWallet || !wallet || messages.length === 0) return;

    const oldestMessage = messages[0];

    const response = await api.get<{ messages: Array<{
      id: string;
      encryptedContent: string;
      nonce: string;
      senderWallet: string;
      senderXHandle?: string | null;
      recipientWallet?: string | null;
      createdAt: string;
    }>; hasMore?: boolean }>(`/api/dm/${recipientWallet}?cursor=${oldestMessage.id}`, { showErrorToast: false });

    if (response.success && response.data?.messages) {
      const olderMessages: MessageData[] = response.data.messages.map((m) => ({
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
        dmRecipient: m.recipientWallet || null,
        createdAt: new Date(m.createdAt),
      }));
      setMessages((prev) => [...olderMessages, ...prev]);
      setHasMore(response.data?.hasMore || false);
    }
  }, [recipientWallet, wallet, messages, api]);

  // Handle message sent
  const handleMessageSent = useCallback(async (message: { content: string; nonce: string }) => {
    const success = await sendMessage(
      recipientWallet,
      message.content,
      message.nonce,
      { preferP2P: true }
    );

    if (!success) {
      console.error('Failed to send message');
    }
  }, [recipientWallet, sendMessage]);

  // Handle report
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleReport = useCallback((_messageId: string, _senderId: string) => {
    // Report will be handled by the ReportModal component
  }, []);

  // Handle community selection
  const handleSelectCommunity = useCallback((communityId: string) => {
    router.push(`/app/community/${communityId}`);
  }, [router]);

  // Handle DM selection
  const handleSelectDM = useCallback((dmId: string) => {
    router.push(`/app/dm/${dmId}`);
  }, [router]);

  // Handle switch to DMs
  const handleSwitchToDMs = useCallback(() => {
    router.push('/app');
  }, [router]);

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

  // Current user
  const currentUser: CurrentUser = {
    walletAddress: wallet || '',
    xHandle: null,
    imageUrl: null,
    status: 'online',
  };

  // Active DM user for header and member list
  const activeDMUser: (HeaderUser & Member) | undefined = recipientProfile ? {
    id: recipientProfile.walletAddress,
    walletAddress: recipientProfile.walletAddress,
    xHandle: recipientProfile.xHandle || undefined,
    xVerified: recipientProfile.xVerified,
    isOnline: isUserOnline(recipientWallet),
    imageUrl: recipientProfile.imageUrl || undefined,
    tokenBalance: recipientProfile.tokenBalance,
    role: 'MEMBER',
    strikes: 0,
  } : undefined;

  // Chat header info
  const headerInfo: ChatHeaderInfo | undefined = recipientProfile ? {
    name: recipientProfile.xHandle ? `@${recipientProfile.xHandle}` : `${recipientWallet.slice(0, 4)}...${recipientWallet.slice(-4)}`,
    icon: recipientProfile.imageUrl || undefined,
    isOnline: isUserOnline(recipientWallet),
    recipientWallet: recipientWallet,
  } : undefined;

  // Member list for right sidebar (just the recipient)
  const members: Member[] = recipientProfile ? [{
    id: recipientProfile.walletAddress,
    walletAddress: recipientProfile.walletAddress,
    xHandle: recipientProfile.xHandle || null,
    xVerified: recipientProfile.xVerified,
    isOnline: isUserOnline(recipientWallet),
    tokenBalance: recipientProfile.tokenBalance,
    role: 'MEMBER',
    strikes: 0,
  }] : [];

  // Loading state
  if (!isConnected || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--discord-bg)]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center mb-4 mx-auto animate-pulse">
            <span className="text-white font-bold text-2xl">C</span>
          </div>
          <p className="text-zinc-400">Loading conversation...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout
      communities={communities}
      activeCommunityId={null}
      channels={[]}
      directMessages={directMessages}
      currentUser={currentUser}
      activeDMUser={activeDMUser}
      members={members}
      isDMView={true}
      onSelectCommunity={handleSelectCommunity}
      onSelectDM={handleSelectDM}
      onSwitchToDMs={handleSwitchToDMs}
      onAddCommunity={() => router.push('/app')}
      onUserSettings={handleSettings}
      onOpenSettings={handleOpenSettings}
      onOpenHelp={handleOpenHelp}
      onOpenNotifications={handleOpenNotifications}
      onOpenSearch={handleOpenSearch}
    >
      <div className="h-full flex flex-col">
        {/* E2E Encryption indicator */}
        <div className="px-4 py-2 bg-zinc-800/50 border-b border-zinc-700 flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-zinc-400">
            Messages are end-to-end encrypted
          </span>
          {isPeerConnected(recipientWallet) && (
            <>
              <span className="text-zinc-600">|</span>
              <Shield className="w-4 h-4 text-indigo-400" />
              <span className="text-xs text-zinc-400">
                P2P connected
              </span>
            </>
          )}
        </div>

        {/* Chat container */}
        <div className="flex-1 min-h-0">
          <ChatContainer
            mode="dm"
            recipientWallet={recipientWallet}
            headerInfo={headerInfo}
            messages={messages}
            isLoading={isLoadingMessages}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            onMessageSent={handleMessageSent}
            onReport={handleReport}
            isTimedOut={false}
          />
        </div>
      </div>
    </AppLayout>
  );
}
