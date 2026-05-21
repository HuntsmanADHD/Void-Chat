'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Lock, Shield } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useSession } from '@/hooks/useSession';
import { useEncryption } from '@/hooks/useEncryption';
import { useRealtime, type OnMessageReceived } from '@/hooks/useRealtime';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/components/ui/Toast';
import type { Community, DirectMessage, CurrentUser } from '@/components/layout/Sidebar';
import type { Member } from '@/components/layout/MemberList';
import type { HeaderUser } from '@/components/layout/Header';

interface DMUserProfile {
  publicId: string;
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
  const recipientId = params.publicId as string;

  const { session, isReady } = useSession();
  const publicId = session?.signingPublicKey ?? '';
  const isAuthenticated = isReady;
  const { } = useEncryption();
  const api = useApi();
  const { error: showError } = useToast();

  // State
  const [recipientProfile, setRecipientProfile] = useState<DMUserProfile | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Handle incoming realtime messages
  const handleMessage: OnMessageReceived = useCallback((message) => {
    // Check if this message is for this DM conversation
    const isFromRecipient = message.senderId === recipientId;
    const isToRecipient = message.dmRecipientId === recipientId;

    if (isFromRecipient || isToRecipient) {
      const msgAny = message as { encrypted?: string; nonce?: string };
      const newMessage: MessageData = {
        id: message.id,
        content: msgAny.encrypted || '',
        nonce: msgAny.nonce || '',
        senderId: message.senderId,
        sender: {
          publicId: message.senderId,
        },
        dmRecipient: message.dmRecipientId,
        createdAt: new Date(message.timestamp),
      };
      setMessages((prev) => [...prev, newMessage]);
    }
  }, [recipientId]);

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

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  // Prevent DM to self
  useEffect(() => {
    if (publicId && recipientId === publicId) {
      router.push('/app');
    }
  }, [publicId, recipientId, router]);

  // Fetch recipient profile
  useEffect(() => {
    const fetchRecipientProfile = async () => {
      if (!isAuthenticated || !publicId || !recipientId) return;

      setIsLoading(true);

      const [userResponse, communitiesResponse] = await Promise.all([
        api.get<{ user: {
          publicId: string;
          publicKey?: string;
          imageUrl?: string;
        } }>(`/api/users/${recipientId}`, { showErrorToast: false }),
        api.get<{ communities: Array<{ id: string; name: string; icon?: string }> }>('/api/communities', { showErrorToast: false }),
      ]);

      if (userResponse.success && userResponse.data?.user) {
        const data = userResponse.data.user;
        setRecipientProfile({
          publicId: data.publicId,
          publicKey: data.publicKey || '',
          imageUrl: data.imageUrl || null,
        });
      } else if (userResponse.error?.statusCode === 404) {
        setRecipientProfile({
          publicId: recipientId,
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

      // DM list just shows current conversation (no server-side history)
      setDirectMessages([{
        id: recipientId,
        recipientId: recipientId,
        recipientImageUrl: null,
        status: isUserOnline(recipientId) ? 'online' : 'offline',
        unreadCount: 0,
        isActive: true,
      }]);

      setIsLoading(false);
    };

    fetchRecipientProfile();
  }, [isAuthenticated, publicId, recipientId, isUserOnline, api, showError]);

  // Join DM room
  useEffect(() => {
    if (recipientId && isAuthenticated) {
      joinDM(recipientId);

      // Try to establish P2P connection
      if (!isPeerConnected(recipientId) && isUserOnline(recipientId)) {
        initiatePeerConnection(recipientId);
      }

      return () => {
        leaveDM(recipientId);
      };
    }
    return undefined;
  }, [recipientId, isAuthenticated, joinDM, leaveDM, isPeerConnected, isUserOnline, initiatePeerConnection]);

  // Messages come from socket events only — no server-side storage

  // Handle message sent
  const handleMessageSent = useCallback(async (message: { content: string; nonce: string }) => {
    const success = await sendMessage(
      recipientId,
      message.content,
      message.nonce,
      { preferP2P: true }
    );

    if (!success) {
      console.error('Failed to send message');
    }
  }, [recipientId, sendMessage]);

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
    publicId: publicId || '',
    imageUrl: null,
    status: 'online',
  };

  // Active DM user for header and member list
  const activeDMUser: (HeaderUser & Member) | undefined = recipientProfile ? {
    id: recipientProfile.publicId,
    publicId: recipientProfile.publicId,
    isOnline: isUserOnline(recipientId),
    imageUrl: recipientProfile.imageUrl || undefined,
    role: 'MEMBER',
  } : undefined;

  // Chat header info
  const headerInfo: ChatHeaderInfo | undefined = recipientProfile ? {
    name: `${recipientId.slice(0, 4)}...${recipientId.slice(-4)}`,
    icon: recipientProfile.imageUrl || undefined,
    isOnline: isUserOnline(recipientId),
    recipientId: recipientId,
  } : undefined;

  // Member list for right sidebar (just the recipient)
  const members: Member[] = recipientProfile ? [{
    id: recipientProfile.publicId,
    publicId: recipientProfile.publicId,
    isOnline: isUserOnline(recipientId),
    role: 'MEMBER',
  }] : [];

  // Loading state
  if (!isAuthenticated || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 flex items-center justify-center mb-4 mx-auto animate-pulse border border-zinc-500/30">
            <span className="text-zinc-100 font-bold text-2xl">C</span>
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
          {isPeerConnected(recipientId) && (
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
            recipientId={recipientId}
            headerInfo={headerInfo}
            messages={messages}
            isLoading={false}
            hasMore={false}
            onLoadMore={() => {}}
            onMessageSent={handleMessageSent}
            onReport={handleReport}
            isTimedOut={false}
          />
        </div>
      </div>
    </AppLayout>
  );
}
