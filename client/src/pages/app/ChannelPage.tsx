import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useAuth } from '@/hooks/useAuth';
import { useEncryption } from '@/hooks/useEncryption';
import { useDKG } from '@/hooks/useDKG';
import { useRealtime, type OnMessageReceived } from '@/hooks/useRealtime';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/components/ui/Toast';
import { getPublicKeys, getPublicKey } from '@/lib/keyStore';
import { getSocketManager } from '@/lib/socket';
import { validateFile, encryptFileData, getFileKeyForChannel, formatFileSize } from '@/lib/fileEncryption';
import naclUtil from 'tweetnacl-util';
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
  const navigate = useNavigate();
  const params = useParams();
  const communityId = params.id as string;
  const channelId = params.channelId as string;

  const {
    publicId,
    isAuthenticated,
    session,
  } = useAuth();
  const { publicKey: encryptionPublicKey, getDecryptedChannelKey, storeNewChannelKey, encryptForChannel, boxEncrypt, boxOpen } = useEncryption();
  const { initiateGroupKey, acceptShare, reconstruct, getShareCount, getThreshold } = useDKG(publicId || '', boxEncrypt, boxOpen);
  const api = useApi();
  const { warning: showWarning, error: showError, success: showSuccess } = useToast();

  // State
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dkgStatus, setDkgStatus] = useState<'none' | 'initiating' | 'ready' | 'error'>('none');

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
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Fetch community and channel details
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || !publicId || !communityId) return;

      setIsLoading(true);
      try {
        const [communityResponse, channelsResponse, membersResponse, allCommunitiesResponse] = await Promise.all([
          api.get<{ community: CommunityDetail }>(`/api/communities/${communityId}`, { showErrorToast: false }),
          api.get<{ channels: ChannelDetail[] }>(`/api/communities/${communityId}/channels`, { showErrorToast: false }),
          api.get<{ members: Array<{ publicId: string; role?: string }> }>(`/api/communities/${communityId}/members`, { showErrorToast: false }),
          api.get<{ communities: Array<{ id: string; name: string; icon?: string }> }>('/api/communities', { showErrorToast: false }),
        ]);

        if (communityResponse.success && communityResponse.data?.community) {
          setCommunity(communityResponse.data.community);
        } else if (communityResponse.error?.statusCode === 404) {
          navigate('/app');
          return;
        } else {
          throw new Error('Failed to fetch community');
        }

        if (channelsResponse.success && channelsResponse.data?.channels) {
          setChannels(channelsResponse.data.channels);
        }

        if (membersResponse.success && membersResponse.data?.members) {
          const memberList: Member[] = membersResponse.data.members.map((m) => ({
            id: m.publicId,
            publicId: m.publicId,
            role: (m.role || 'MEMBER') as 'OWNER' | 'MEMBER',
            isOnline: isUserOnline(m.publicId),
          }));
          setMembers(memberList);
        }

        if (allCommunitiesResponse.success && allCommunitiesResponse.data?.communities) {
          const communityList: Community[] = allCommunitiesResponse.data.communities.map((c) => ({
            id: c.id,
            name: c.name,
            icon: c.icon || null,
            unreadCount: 0,
          }));
          setCommunities(communityList);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
        navigate('/app');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, publicId, communityId, navigate, isUserOnline, api]);

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

  // Check for channel key and initiate DKG if needed
  useEffect(() => {
    const initChannelKey = async () => {
      if (!channelId || !isAuthenticated || !encryptionPublicKey || members.length < 2) return;

      // Check if we already have a channel key
      const existingKey = await getDecryptedChannelKey(channelId);
      if (existingKey) {
        setDkgStatus('ready');
        return;
      }

      // No key — initiate DKG
      setDkgStatus('initiating');

      // Fetch encryption public keys for all members (including self — initiator gets a share too)
      const memberPublicIds = members.map((m) => m.publicId);
      const fetchedKeys = await getPublicKeys(memberPublicIds);

      // We need at least 2 members with valid encryption keys to run DKG
      if (fetchedKeys.size < 2) {
        console.warn('[ChannelPage] Not enough members with encryption keys for DKG');
        setDkgStatus('none');
        return;
      }

      const session = initiateGroupKey(channelId, fetchedKeys);
      if (session) {
        // Distribute encrypted shares to members via socket
        const socketManager = getSocketManager();
        if (socketManager?.isConnected()) {
          const sharesObj: Record<string, string> = {};
          session.encryptedShares.forEach((value, key) => {
            sharesObj[key] = value;
          });
          socketManager.emit('dkg:distribute', {
            channelId,
            shares: sharesObj,
            groupPublicKey: session.groupPublicKey,
            threshold: session.threshold,
          });
        }
        setDkgStatus('ready');
      } else {
        setDkgStatus('error');
      }
    };

    initChannelKey();
  }, [channelId, isAuthenticated, encryptionPublicKey, members.length, getDecryptedChannelKey, initiateGroupKey]);

  // Listen for incoming DKG share distributions from other members
  useEffect(() => {
    if (!channelId || !isAuthenticated || !publicId) return;

    const socketManager = getSocketManager();
    if (!socketManager) return;

    const unsubscribe = socketManager.on(
      'dkg:share',
      async (data: {
        channelId: string;
        fromId: string;
        encryptedShare: string;
        groupPublicKey: string;
        threshold: number;
      }) => {
        if (data.channelId !== channelId) return;

        // Look up the sender's encryption public key from their publicId
        const senderEncryptionKey = await getPublicKey(data.fromId);
        if (!senderEncryptionKey) {
          console.error('[ChannelPage] Could not resolve encryption key for sender:', data.fromId);
          return;
        }

        // Decrypt the share using our secret key via the DKG hook
        const share = acceptShare(channelId, data.encryptedShare, senderEncryptionKey);
        if (!share) {
          console.error('[ChannelPage] Failed to accept DKG share');
          return;
        }

        console.log('[ChannelPage] DKG share accepted for channel', channelId);

        // Check if we have enough shares for reconstruction
        const shareCount = getShareCount(channelId);
        const threshold = data.threshold || getThreshold(members.length);

        if (shareCount >= threshold) {
          const channelKey = reconstruct(channelId, threshold);
          if (channelKey) {
            await storeNewChannelKey(channelId, channelKey);
            setDkgStatus('ready');
            console.log('[ChannelPage] Channel key reconstructed and stored for', channelId);
          } else {
            console.error('[ChannelPage] Key reconstruction failed for', channelId);
            setDkgStatus('error');
          }
        }
      }
    );

    return unsubscribe;
  }, [channelId, isAuthenticated, publicId, members.length, acceptShare, reconstruct, getShareCount, getThreshold, storeNewChannelKey]);

  // Messages come from socket events only — no server-side storage
  // On mount, start with an empty message list. New messages arrive via handleMessage.

  const handleSelectChannel = useCallback((newChannelId: string) => {
    navigate(`/app/community/${communityId}/channel/${newChannelId}`);
  }, [communityId, navigate]);

  const handleSelectCommunity = useCallback((newCommunityId: string) => {
    navigate(`/app/community/${newCommunityId}`);
  }, [navigate]);

  const handleSelectDM = useCallback((dmId: string) => {
    navigate(`/app/dm/${dmId}`);
  }, [navigate]);

  const handleSwitchToDMs = useCallback(() => {
    navigate('/app');
  }, [navigate]);

  const handleMessageSent = useCallback((message: { content: string; nonce: string }) => {
    sendChannelMessage(channelId, message.content, message.nonce);
  }, [channelId, sendChannelMessage]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleReport = useCallback((_messageId: string, _senderId: string) => {}, []);

  // Channel file transfer: encrypt with channel-derived key and send via socket relay
  const handleFileSend = useCallback(async (file: File) => {
    // Validate file type and size
    const validation = validateFile(file);
    if (!validation.valid) {
      showError(validation.error || 'Invalid file');
      return;
    }

    // Ensure we have a channel key
    const channelKey = await getDecryptedChannelKey(channelId);
    if (!channelKey) {
      showWarning('Channel encryption key not available. Wait for group key setup to complete.');
      return;
    }

    // Derive a file-specific key from the channel key
    const fileKey = await getFileKeyForChannel(channelKey);
    if (!fileKey) {
      showError('Failed to derive file encryption key.');
      return;
    }

    try {
      // Read and encrypt the file
      const arrayBuffer = await file.arrayBuffer();
      const encrypted = encryptFileData(arrayBuffer, fileKey);
      if (!encrypted) {
        showError('File encryption failed.');
        return;
      }

      // Encode encrypted data as base64 for transport
      const encryptedBase64 = naclUtil.encodeBase64(encrypted.encryptedData);

      // Build a file message payload (JSON-serialized as the message content)
      const filePayload = JSON.stringify({
        type: 'file',
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        encryptedData: encryptedBase64,
        nonce: encrypted.nonce,
      });

      // Encrypt the entire file payload with channel key (same as text messages)
      const channelEncrypted = await encryptForChannel(filePayload, channelId);
      if (!channelEncrypted) {
        showError('Channel encryption failed.');
        return;
      }

      sendChannelMessage(channelId, channelEncrypted.encrypted, channelEncrypted.nonce);

      showSuccess(`File sent: ${file.name} (${formatFileSize(file.size)})`);
    } catch (err) {
      console.error('[ChannelPage] File send failed:', err);
      showError('Failed to send file.');
    }
  }, [channelId, getDecryptedChannelKey, encryptForChannel, sendChannelMessage, showError, showWarning, showSuccess]);

  const handleMemberClick = useCallback((member: Member) => {
    if (member.publicId !== publicId) {
      navigate(`/app/dm/${member.publicId}`);
    }
  }, [navigate, publicId]);

  const handleSettings = useCallback(() => {
    navigate('/app/settings');
  }, [navigate]);

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
            onClick={() => navigate(`/app/community/${communityId}`)}
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
      onAddCommunity={() => navigate('/app')}
      onUserSettings={handleSettings}
      onMemberClick={handleMemberClick}
    >
      <div className="h-full flex flex-col">
        {/* DKG Status */}
        {dkgStatus === 'initiating' && (
          <div className="px-4 py-2 bg-indigo-900/20 border-b border-indigo-700/30 flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-indigo-300">Setting up group encryption...</span>
          </div>
        )}
        <div className="flex-1 min-h-0">
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
            onFileSend={handleFileSend}
            isTimedOut={false}
          />
        </div>
      </div>
    </AppLayout>
  );
}
