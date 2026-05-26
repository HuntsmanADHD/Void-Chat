'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useSession } from '@/hooks/useSession';
import { useChannelRoster, useRealtime, type DecryptedChannelMessage } from '@/hooks/useRealtime';
import { appendChannel as storeAppendChannel, listChannel as storeListChannel } from '@/lib/messageStore';
import {
  clearCommunityPassword,
  communityAuthHeaders,
  getCommunityPassword,
  setCommunityPassword,
} from '@/lib/communityPasswordStore';
import { CommunityPasswordPrompt } from '@/components/community/CommunityPasswordPrompt';
import { useToast } from '@/components/ui/Toast';
import { useBackdropClose } from '@/hooks/useBackdropClose';


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
  const [needsPassword, setNeedsPassword] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();
  const deleteConfirmBackdrop = useBackdropClose(
    () => setShowDeleteConfirm(false),
    showDeleteConfirm && !isDeleting,
  );

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
          sender: { publicId: msg.senderSigningPublicKey, displayName: msg.senderDisplayName },
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

  const fetchChannelData = useCallback(async () => {
    if (!isReady || !communityId) return;
    setIsLoading(true);
    try {
      const authHeaders = communityAuthHeaders(communityId);
      const [channelsRes, allRes] = await Promise.all([
        fetch(`/api/communities/${communityId}/channels`, { headers: authHeaders }),
        fetch('/api/communities'),
      ]);
      if (channelsRes.status === 401) {
        clearCommunityPassword(communityId);
        setNeedsPassword(true);
        return;
      }
      if (!channelsRes.ok) {
        if (channelsRes.status === 404) router.push('/app');
        return;
      }
      const chData = await channelsRes.json();
      setChannels(chData.channels || []);
      if (allRes.ok) {
        const allData = await allRes.json();
        const list: Community[] =
          allData.communities?.map((c: { id: string; name: string; avatar?: string | null }) => ({
            id: c.id,
            name: c.name,
            icon: c.avatar || null,
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
  }, [isReady, communityId, router]);

  useEffect(() => {
    void fetchChannelData();
  }, [fetchChannelData]);

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      setPwSubmitting(true);
      setPwError(null);
      try {
        const res = await fetch(`/api/communities/${communityId}`, {
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
        void fetchChannelData();
      } catch {
        setPwError('Network error');
      } finally {
        setPwSubmitting(false);
      }
    },
    [communityId, fetchChannelData],
  );

  const handlePasswordCancel = useCallback(() => router.push('/app'), [router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(communityId);
      const isPrivate = getCommunityPassword(communityId) !== null;
      toastSuccess(isPrivate ? 'Invite code copied — share the password separately' : 'Invite code copied');
    } catch {
      toastError('Could not access the clipboard');
    }
  }, [communityId, toastSuccess, toastError]);

  const handleDeleteCommunity = useCallback(async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/communities/${communityId}`, {
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
      router.push('/app');
    } catch {
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  }, [communityId, router]);

  useEffect(() => {
    if (!channelId || !isReady) return;
    joinChannel(channelId);
    return () => leaveChannel(channelId);
  }, [channelId, isReady, joinChannel, leaveChannel]);

  // Hydrate from local store on channel switch, then live updates from the
  // realtime callback merge in. Optimistic and received messages dedupe by id.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    void storeListChannel(channelId).then((stored) => {
      if (cancelled) return;
      setMessages(
        stored.map((m) => ({
          id: m.id,
          content: m.plaintext,
          nonce: '',
          senderId: m.senderSigningPublicKey,
          sender: { publicId: m.senderSigningPublicKey, displayName: m.senderDisplayName },
          channelId,
          createdAt: new Date(m.ts),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const handleSend = useCallback(
    async (plaintext: string) => {
      // The relay skips the sender on fan-out, so we never see our own
      // message via onChannelMessage. Append a local copy here so the
      // sender sees what they just sent. Local-prefixed ids can't collide
      // with server-issued m_* ids on subsequent receives.
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ts = Date.now();
      const localName = session?.displayName || '';
      const optimistic: MessageData = {
        id,
        content: plaintext,
        nonce: '',
        senderId: publicId,
        sender: { publicId, displayName: localName },
        channelId,
        createdAt: new Date(ts),
      };
      setMessages((prev) => [...prev, optimistic]);
      void storeAppendChannel(channelId, {
        id,
        ts,
        senderSigningPublicKey: publicId,
        senderBoxPublicKey: '',
        senderDisplayName: localName,
        plaintext,
        optimistic: true,
      });
      return sendChannelMessage(channelId, plaintext);
    },
    [channelId, publicId, session, sendChannelMessage],
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
    const channel = channels.find((c) => c.id === channelId);
    return channel ? { id: channel.id, name: channel.name, description: channel.description } : null;
  }, [channelId, channels]);

  const sidebarChannels: Channel[] = useMemo(
    () =>
      channels.map((c) => ({
        id: c.id,
        name: c.name,
        // API doesn't return a type field and voice isn't implemented; pin to
        // 'text' so the sidebar's text-channels section renders these.
        type: 'text',
        isActive: c.id === channelId,
      })),
    [channels, channelId],
  );

  const headerInfo: ChatHeaderInfo | undefined = activeChannel
    ? { name: activeChannel.name, description: activeChannel.description, memberCount: members.length }
    : undefined;

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
      onUserSettings={handleSettings}
      onCopyInviteLink={handleCopyInvite}
      onDeleteCommunity={() => setShowDeleteConfirm(true)}
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

    {showDeleteConfirm && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        {...deleteConfirmBackdrop}
      >
        <div className="w-full max-w-sm bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-red-900/40 p-6 space-y-4">
          <h3 className="font-semibold text-white">Delete this community?</h3>
          <p className="text-sm text-zinc-400">
            All channels under this community will be removed from the server. Locally cached
            messages on your device stay until you reload. This cannot be undone.
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
