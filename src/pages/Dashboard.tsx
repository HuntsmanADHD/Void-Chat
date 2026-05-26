import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, MessageCircle, Sparkles } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CommunityCard, type CommunityData } from '@/components/community/CommunityCard';
import {
  CreateCommunityModal,
  type CreateCommunityFormData,
  type JoinCommunityFormData,
} from '@/components/community/CreateCommunityModal';
import { useSession } from '@/hooks/useSession';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/components/ui/Toast';
import { CommunityPasswordPrompt } from '@/components/community/CommunityPasswordPrompt';
import { setCommunityPassword } from '@/lib/communityPasswordStore';
import { OnboardingModal, hasSeenOnboarding } from '@/components/onboarding/OnboardingModal';
import { apiUrl } from '@/lib/relayBase';
import type { Community, DirectMessage, CurrentUser } from '@/components/layout/Sidebar';

function truncatePublicId(id: string, chars = 4): string {
  if (id.length <= chars * 2 + 3) return id;
  return `${id.slice(0, chars)}...${id.slice(-chars)}`;
}

const WelcomeSection = React.memo(function WelcomeSection({
  onCreateCommunity,
}: {
  onCreateCommunity: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-16 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 flex items-center justify-center mb-6 border border-zinc-500/30 shadow-lg">
        <Sparkles className="w-10 h-10 text-zinc-200" />
      </div>
      <h1 className="text-3xl font-bold text-zinc-100 mb-4">Welcome to Void Chat</h1>
      <p className="text-zinc-400 text-lg mb-8 max-w-md">
        Your private, encrypted messaging experience begins here. Join communities or start direct
        conversations.
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onCreateCommunity}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 text-white font-medium rounded-xl transition-all border border-zinc-500/30 shadow-lg"
        >
          <Plus className="w-5 h-5" />
          Create Community
        </button>
        <button className="flex items-center justify-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-xl transition-colors border border-zinc-700/50">
          <Users className="w-5 h-5" />
          Explore Communities
        </button>
      </div>
    </div>
  );
});

const CommunitiesSection = React.memo(function CommunitiesSection({
  communities,
  onSelectCommunity,
}: {
  communities: CommunityData[];
  onSelectCommunity: (id: string) => void;
}) {
  if (communities.length === 0) return null;
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
        <Users className="w-5 h-5" />
        Your Communities
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {communities.map((community) => (
          <CommunityCard key={community.id} community={community} onClick={onSelectCommunity} />
        ))}
      </div>
    </div>
  );
});

const RecentDMsSection = React.memo(function RecentDMsSection({
  dms,
  onSelectDM,
}: {
  dms: DirectMessage[];
  onSelectDM: (id: string) => void;
}) {
  if (dms.length === 0) return null;
  return (
    <div className="p-6 border-t border-zinc-800/50">
      <h2 className="text-xl font-semibold text-zinc-100 mb-4 flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-zinc-400" />
        Recent Conversations
      </h2>
      <div className="space-y-2">
        {dms.slice(0, 5).map((dm) => (
          <button
            key={dm.id}
            onClick={() => onSelectDM(dm.recipientId)}
            className="w-full flex items-center gap-3 p-3 bg-zinc-900/50 hover:bg-zinc-800/70 rounded-lg transition-colors border border-zinc-800/30"
          >
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-600 flex items-center justify-center border border-zinc-600/30">
                {dm.recipientImageUrl ? (
                  <img
                    src={dm.recipientImageUrl}
                    alt=""
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className="text-zinc-200 font-medium">{dm.recipientId.slice(0, 2)}</span>
                )}
              </div>
              {dm.status === 'online' && (
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-zinc-900" />
              )}
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium text-zinc-100" title={dm.recipientId}>
                {truncatePublicId(dm.recipientId)}
              </div>
              <div className="text-sm text-zinc-500">Click to open conversation</div>
            </div>
            {dm.unreadCount && dm.unreadCount > 0 && (
              <span className="px-2 py-1 text-xs font-medium bg-zinc-600 text-zinc-100 rounded-full">
                {dm.unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});

export default function Dashboard() {
  const navigate = useNavigate();
  const { session, displayName, isReady } = useSession();
  const publicId = session?.signingPublicKey ?? '';
  const isAuthenticated = isReady;
  const api = useApi();
  const { success: showSuccess, error: showError } = useToast();

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!isReady) return;
    if (!hasSeenOnboarding()) setShowOnboarding(true);
  }, [isReady]);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityData, setCommunityData] = useState<CommunityData[]>([]);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || !publicId) return;
      setIsLoading(true);
      const communitiesResponse = await api.get<{
        communities: Array<{
          id: string;
          name: string;
          description?: string;
          avatar?: string;
          isPrivate?: boolean;
        }>;
      }>('/api/communities', { showErrorToast: false });
      if (communitiesResponse.success && communitiesResponse.data?.communities) {
        const transformedCommunities: CommunityData[] = communitiesResponse.data.communities.map(
          (c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            icon: c.avatar,
            isPrivate: !!c.isPrivate,
          }),
        );
        const communityList: Community[] = transformedCommunities.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon ?? null,
          unreadCount: 0,
        }));
        setCommunities(communityList);
        setCommunityData(transformedCommunities);
      }
      setDirectMessages([]);
      if (!communitiesResponse.success) {
        showError('Failed to load some data. Please refresh the page.');
      }
      setIsLoading(false);
    };
    fetchData();
  }, [isAuthenticated, publicId, api, showError]);

  const [pendingPrivate, setPendingPrivate] = useState<{ id: string; name: string } | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const handleSelectCommunity = useCallback(
    (communityId: string) => {
      const target = communityData.find((c) => c.id === communityId);
      if (target?.isPrivate) {
        setPwError(null);
        setPendingPrivate({ id: communityId, name: target.name });
        return;
      }
      navigate(`/app/community/${communityId}`);
    },
    [communityData, navigate],
  );

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      if (!pendingPrivate) return;
      setPwSubmitting(true);
      setPwError(null);
      try {
        const res = await fetch(apiUrl(`/api/communities/${pendingPrivate.id}`), {
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
        setCommunityPassword(pendingPrivate.id, password);
        const id = pendingPrivate.id;
        setPendingPrivate(null);
        navigate(`/app/community/${id}`);
      } catch {
        setPwError('Network error');
      } finally {
        setPwSubmitting(false);
      }
    },
    [pendingPrivate, navigate],
  );
  const handlePasswordCancel = useCallback(() => setPendingPrivate(null), []);

  const handleSelectDM = useCallback(
    (dmId: string) => {
      navigate(`/app/dm/${dmId}`);
    },
    [navigate],
  );
  const handleSwitchToDMs = useCallback(() => {}, []);

  const handleJoinCommunity = useCallback(
    async (data: JoinCommunityFormData): Promise<string | null> => {
      const code = data.inviteCode.trim();
      if (!code) return 'Invite code is required';
      try {
        const headers: Record<string, string> = {};
        if (data.password) headers['x-community-password'] = data.password;
        const res = await fetch(apiUrl(`/api/communities/${encodeURIComponent(code)}`), { headers });
        if (res.status === 404) return 'Invite code not found';
        if (res.status === 401) {
          return data.password
            ? 'Wrong password for this community'
            : 'This community is private — enter the password';
        }
        if (!res.ok) return 'Could not reach the server';
        if (data.password) setCommunityPassword(code, data.password);
        setShowCreateModal(false);
        navigate(`/app/community/${code}`);
        return null;
      } catch {
        return 'Network error';
      }
    },
    [navigate],
  );

  const handleCreateCommunity = useCallback(
    async (data: CreateCommunityFormData) => {
      if (!publicId) return;
      setIsCreating(true);
      setCreateError(null);
      try {
        let avatarData: string | undefined;
        if (data.icon && data.iconPreview) {
          avatarData = data.iconPreview;
        }
        const response = await api.post<{ id: string; isPrivate: boolean }>('/api/communities', {
          name: data.name,
          description: data.description,
          avatar: avatarData,
          password: data.isPrivate ? data.password : undefined,
        });
        if (response.success) {
          setShowCreateModal(false);
          showSuccess('Community created successfully!');
          const id = response.data?.id;
          if (id) {
            if (data.isPrivate && data.password) {
              try {
                sessionStorage.setItem(`voidchat_pw:${id}`, data.password);
              } catch {}
            }
            navigate(`/app/community/${id}`);
          }
        } else {
          setCreateError(response.error?.message || 'Failed to create community');
        }
      } catch (error) {
        console.error('Failed to create community:', error);
        setCreateError('An unexpected error occurred');
      } finally {
        setIsCreating(false);
      }
    },
    [publicId, api, navigate, showSuccess],
  );

  const handleSettings = useCallback(() => {
    navigate('/app/settings');
  }, [navigate]);
  const handleOpenSettings = useCallback(() => {
    navigate('/app/settings');
  }, [navigate]);
  const handleOpenHelp = useCallback(() => {
    alert('Help feature coming soon!');
  }, []);
  const handleOpenNotifications = useCallback(() => {
    alert('Notifications feature coming soon!');
  }, []);
  const handleOpenSearch = useCallback(() => {
    alert('Search feature coming soon!');
  }, []);

  const currentUser: CurrentUser = { publicId: publicId || '', imageUrl: null, status: 'online' };

  if (!isAuthenticated || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 flex items-center justify-center mb-4 mx-auto animate-pulse border border-zinc-500/30">
            <span className="text-zinc-100 font-bold text-2xl">C</span>
          </div>
          <p className="text-zinc-400">Loading Void Chat...</p>
        </div>
      </div>
    );
  }

  const hasContent = communities.length > 0 || directMessages.length > 0;

  return (
    <>
      <AppLayout
        communities={communities}
        activeCommunityId={null}
        channels={[]}
        directMessages={directMessages}
        currentUser={currentUser}
        isDMView={true}
        onSelectCommunity={handleSelectCommunity}
        onSelectDM={(dmId) => handleSelectDM(dmId)}
        onSwitchToDMs={handleSwitchToDMs}
        onAddCommunity={() => setShowCreateModal(true)}
        onUserSettings={handleSettings}
        onOpenSettings={handleOpenSettings}
        onOpenHelp={handleOpenHelp}
        onOpenNotifications={handleOpenNotifications}
        onOpenSearch={handleOpenSearch}
      >
        <div className="relative h-full">
          <div
            className="absolute pointer-events-none"
            style={{
              top: '5%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '70%',
              height: '70%',
              backgroundImage: 'url(/images/portal-ring.jpg)',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'contain',
              opacity: 0.25,
            }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.85) 75%)',
            }}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">
            {hasContent ? (
              <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                <CommunitiesSection
                  communities={communityData}
                  onSelectCommunity={handleSelectCommunity}
                />
                <RecentDMsSection dms={directMessages} onSelectDM={handleSelectDM} />
              </div>
            ) : (
              <WelcomeSection onCreateCommunity={() => setShowCreateModal(true)} />
            )}
          </div>
        </div>
      </AppLayout>
      <CreateCommunityModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateCommunity}
        onJoin={handleJoinCommunity}
        isSubmitting={isCreating}
        error={createError}
      />
      <CommunityPasswordPrompt
        isOpen={pendingPrivate !== null}
        communityName={pendingPrivate?.name}
        error={pwError}
        isSubmitting={pwSubmitting}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
      <OnboardingModal
        isOpen={showOnboarding}
        displayName={displayName}
        onClose={() => setShowOnboarding(false)}
      />
    </>
  );
}
