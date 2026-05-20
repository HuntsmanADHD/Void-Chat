import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { ArrowLeft, ShieldAlert, Skull } from 'lucide-react';

interface BannedUser {
  publicId: string;
  artHash: string;
  createdAt: string;
  kicks: Array<{
    communityName: string;
    reportCount: number;
    kickedAt: string;
  }>;
}

interface BanListResponse {
  count: number;
  banned: BannedUser[];
}

export default function BanWallPage() {
  const navigate = useNavigate();
  const [banList, setBanList] = useState<BannedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBans = async () => {
      const response = await apiClient.get<BanListResponse>('/api/bans');
      if (response.success && response.data) {
        setBanList(response.data.banned);
      }
      setLoading(false);
    };
    fetchBans();
  }, []);

  return (
    <div className="min-h-screen bg-void-bg">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-void-fg/50 hover:text-void-fg mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="text-center mb-8">
          <Skull className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-void-fg">The Void Wall</h1>
          <p className="text-void-fg/40 mt-2">
            Users permanently banned from the platform by community consensus
          </p>
          <p className="text-void-fg/20 text-sm mt-1">
            {banList.length} {banList.length === 1 ? 'user' : 'users'} banned
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-void-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : banList.length === 0 ? (
          <div className="text-center py-12">
            <ShieldAlert className="w-16 h-16 text-void-fg/20 mx-auto mb-4" />
            <p className="text-void-fg/40">No platform bans yet</p>
            <p className="text-void-fg/20 text-sm mt-1">The void remains clean</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {banList.map((user) => (
              <BannedUserCard key={user.publicId} user={user} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BannedUserCard({ user }: { user: BannedUser }) {
  const navigate = useNavigate();

  // Generate deterministic colors from art hash
  const colors: string[] = [];
  for (let i = 0; i < Math.min(user.artHash.length, 36); i += 6) {
    colors.push(`#${user.artHash.slice(i, i + 6).padEnd(6, '0')}`);
  }

  return (
    <div
      className="bg-void-card border border-red-500/20 rounded-lg p-4 hover:border-red-500/40 transition-colors cursor-pointer"
      onClick={() => navigate(`/app/wall/${user.publicId}`)}
    >
      {/* Soul Art Grid */}
      <div className="flex justify-center mb-3">
        <div className="w-20 h-20 rounded border border-red-500/20 overflow-hidden">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <rect width="80" height="80" fill="#0f0f19" />
            {colors.map((color, i) => {
              const gridSize = Math.ceil(Math.sqrt(colors.length));
              const cellSize = 80 / gridSize;
              return (
                <rect
                  key={i}
                  x={(i % gridSize) * cellSize}
                  y={Math.floor(i / gridSize) * cellSize}
                  width={cellSize}
                  height={cellSize}
                  fill={color}
                  opacity={0.6}
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Identity */}
      <div className="text-center mb-3">
        <p className="text-red-400 font-medium">{user.publicId}</p>
        <p className="text-void-fg/20 text-xs mt-1">
          Banned {new Date(user.kicks[0]?.kickedAt || user.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Kick History */}
      <div className="space-y-1">
        {user.kicks.slice(0, 3).map((kick, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="text-void-fg/30 truncate">{kick.communityName}</span>
            <span className="text-red-400/60">{kick.reportCount} reports</span>
          </div>
        ))}
        {user.kicks.length > 3 && (
          <p className="text-void-fg/20 text-xs text-center">+{user.kicks.length - 3} more</p>
        )}
      </div>
    </div>
  );
}
