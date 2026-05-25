'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer, type ChatHeaderInfo } from '@/components/chat/ChatContainer';
import type { MessageData } from '@/components/chat/Message';
import { useSession } from '@/hooks/useSession';
import { useRealtime, type DecryptedDMMessage } from '@/hooks/useRealtime';
import { useApi } from '@/hooks/useApi';
import { appendDM as storeAppendDM, listDM as storeListDM } from '@/lib/messageStore';

/**
 * Find the most recent display name we've seen for a peer in this DM thread.
 * Looks at messages this peer sent us (not optimistic local ones).
 */
function peerName(messages: MessageData[], peerSigningKey: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.senderId === peerSigningKey && m.sender.displayName?.trim()) {
      return m.sender.displayName.trim();
    }
  }
  return undefined;
}
import type { Community, DirectMessage, CurrentUser } from '@/components/layout/Sidebar';
import type { Member } from '@/components/layout/MemberList';
import type { HeaderUser } from '@/components/layout/Header';

/**
 * DM conversation page.
 *
 * The URL param is the recipient's *signing* public key (ed25519). To
 * actually send we need their *box* public key (curve25519). We look it
 * up from the rosters of channels we currently share with them. If we
 * don't share a channel, we can't reach them — show an explainer.
 */
export default function DMPage() {
  const router = useRouter();
  const params = useParams();
  const recipientSigningKey = params.publicId as string;

  const { session, isReady } = useSession();
  const publicId = session?.signingPublicKey ?? '';
  const api = useApi();

  const [messages, setMessages] = useState<MessageData[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleDMMessage = useCallback(
    (msg: DecryptedDMMessage) => {
      const isFromRecipient = msg.senderSigningPublicKey === recipientSigningKey;
      if (!isFromRecipient) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.msgId)) return prev;
        const decoded: MessageData = {
          id: msg.msgId,
          content: msg.plaintext,
          nonce: '',
          senderId: msg.senderSigningPublicKey,
          sender: { publicId: msg.senderSigningPublicKey, displayName: msg.senderDisplayName },
          dmRecipient: publicId,
          createdAt: new Date(msg.ts),
        };
        return [...prev, decoded];
      });
    },
    [publicId, recipientSigningKey],
  );

  const handleDMOffline = useCallback(() => {
    setSendError('Recipient is offline. Messages do not persist in ephemeral mode.');
  }, []);

  const { sendDM, isReady: isRealtimeReady, lookupBoxKey } = useRealtime({
    onDMMessage: handleDMMessage,
    onDMOffline: handleDMOffline,
  });

  useEffect(() => {
    if (publicId && recipientSigningKey === publicId) router.push('/app');
  }, [publicId, recipientSigningKey, router]);

  // Hydrate persisted DM history for this peer.
  useEffect(() => {
    let cancelled = false;
    void storeListDM(recipientSigningKey).then((stored) => {
      if (cancelled) return;
      setMessages(
        stored.map((m) => ({
          id: m.id,
          content: m.plaintext,
          nonce: '',
          senderId: m.senderSigningPublicKey,
          sender: { publicId: m.senderSigningPublicKey, displayName: m.senderDisplayName },
          dmRecipient: m.optimistic ? recipientSigningKey : publicId,
          createdAt: new Date(m.ts),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [publicId, recipientSigningKey]);

  useEffect(() => {
    const load = async () => {
      if (!isReady) return;
      setIsLoading(true);
      const res = await api.get<{ communities: Array<{ id: string; name: string; avatar?: string | null }> }>(
        '/api/communities',
        { showErrorToast: false },
      );
      if (res.success && res.data?.communities) {
        setCommunities(
          res.data.communities.map((c) => ({
            id: c.id,
            name: c.name,
            icon: c.avatar || null,
            unreadCount: 0,
          })),
        );
      }
      setIsLoading(false);
    };
    load();
  }, [isReady, api]);

  const recipientBoxKey = useMemo(
    () => (isRealtimeReady ? lookupBoxKey(recipientSigningKey) : null),
    [isRealtimeReady, lookupBoxKey, recipientSigningKey],
  );

  const handleSend = useCallback(
    async (plaintext: string) => {
      if (!recipientBoxKey) {
        setSendError(
          "Can't reach this user — join a community channel they're in to discover their key.",
        );
        return false;
      }
      setSendError(null);
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ts = Date.now();
      const localName = session?.displayName || '';
      const optimistic: MessageData = {
        id,
        content: plaintext,
        nonce: '',
        senderId: publicId,
        sender: { publicId, displayName: localName },
        dmRecipient: recipientSigningKey,
        createdAt: new Date(ts),
      };
      setMessages((prev) => [...prev, optimistic]);
      void storeAppendDM(recipientSigningKey, {
        id,
        ts,
        senderSigningPublicKey: publicId,
        senderBoxPublicKey: '',
        senderDisplayName: localName,
        plaintext,
        optimistic: true,
      });
      return sendDM(recipientBoxKey, plaintext);
    },
    [publicId, recipientBoxKey, recipientSigningKey, session, sendDM],
  );

  const handleSelectCommunity = useCallback(
    (communityId: string) => router.push(`/app/community/${communityId}`),
    [router],
  );
  const handleSelectDM = useCallback((dmId: string) => router.push(`/app/dm/${dmId}`), [router]);
  const handleSwitchToDMs = useCallback(() => router.push('/app'), [router]);
  const handleSettings = useCallback(() => router.push('/app/settings'), [router]);

  const currentUser: CurrentUser = {
    publicId: publicId || '',
    displayName: session?.displayName,
    imageUrl: null,
    status: 'online',
  };

  // If we've seen this peer's session before, surface their chosen name.
  const peerCachedName = peerName(messages, recipientSigningKey);

  const activeDMUser: (HeaderUser & Member) | undefined = {
    id: recipientSigningKey,
    publicId: recipientSigningKey,
    displayName: peerCachedName,
    isOnline: recipientBoxKey !== null,
    imageUrl: undefined,
    role: 'MEMBER',
  };

  const headerInfo: ChatHeaderInfo = {
    name: `${recipientSigningKey.slice(0, 4)}…${recipientSigningKey.slice(-4)}`,
    isOnline: recipientBoxKey !== null,
    recipientId: recipientSigningKey,
  };

  const directMessages: DirectMessage[] = [
    {
      id: recipientSigningKey,
      recipientId: recipientSigningKey,
      recipientImageUrl: null,
      status: recipientBoxKey ? 'online' : 'offline',
      unreadCount: 0,
      isActive: true,
    },
  ];

  const members: Member[] = [
    {
      id: recipientSigningKey,
      publicId: recipientSigningKey,
      isOnline: recipientBoxKey !== null,
      role: 'MEMBER',
    },
  ];

  if (!isReady || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-zinc-400">Loading conversation…</p>
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
    >
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 bg-zinc-800/50 border-b border-zinc-700 flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-zinc-400">
            Ephemeral: messages live only while both tabs are open.
          </span>
        </div>

        {sendError && (
          <div className="px-4 py-2 bg-amber-900/30 border-b border-amber-800/50 text-xs text-amber-300">
            {sendError}
          </div>
        )}

        <div className="flex-1 min-h-0">
          <ChatContainer
            mode="dm"
            recipientId={recipientSigningKey}
            headerInfo={headerInfo}
            messages={messages}
            isLoading={false}
            onSend={handleSend}
            isSendReady={isRealtimeReady && recipientBoxKey !== null}
          />
        </div>
      </div>
    </AppLayout>
  );
}
