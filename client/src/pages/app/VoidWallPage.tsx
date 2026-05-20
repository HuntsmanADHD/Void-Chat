import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { ArrowLeft, Shield, ShieldAlert, Users, Award } from 'lucide-react';

interface UserProfile {
  publicId: string;
  publicKey: string;
  artHash: string;
  createdAt: string;
  isBlacklisted: boolean;
}

interface VouchInfo {
  vouchCount: number;
  vouches: Array<{ voucherId: string; createdAt: string }>;
}

export default function VoidWallPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [vouches, setVouches] = useState<VouchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicId) return;

    const fetchProfile = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get<UserProfile>(`/api/users/${publicId}`);
        if (response.success && response.data) {
          setProfile(response.data);
        } else {
          setError('User not found');
        }
      } catch {
        setError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [publicId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-void-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-void-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-void-bg flex items-center justify-center">
        <div className="text-center">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-void-fg/70 text-lg">{error || 'User not found'}</p>
          <button onClick={() => navigate(-1)} className="mt-4 text-void-primary hover:underline">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void-bg">
      <div className="max-w-2xl mx-auto p-6">
        {/* Header */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-void-fg/50 hover:text-void-fg mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Profile Card */}
        <div className="bg-void-card border border-void-border rounded-lg p-8">
          {/* Soul Art Hash Visualization */}
          <div className="flex justify-center mb-6">
            <div className="w-32 h-32 rounded-lg border-2 border-void-primary/30 overflow-hidden">
              <SoulArtVisualization artHash={profile.artHash} size={128} />
            </div>
          </div>

          {/* Identity */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-void-fg">{profile.publicId}</h1>
            <p className="text-void-fg/40 text-sm mt-1 font-mono">
              {profile.publicKey.slice(0, 8)}...{profile.publicKey.slice(-8)}
            </p>
            <p className="text-void-fg/30 text-xs mt-2">
              Joined {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          </div>

          {/* Status */}
          <div className="flex justify-center gap-4 mb-6">
            {profile.isBlacklisted ? (
              <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-full">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                <span className="text-red-400 text-sm font-medium">Platform Banned</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-full">
                <Shield className="w-4 h-4 text-green-500" />
                <span className="text-green-400 text-sm font-medium">Good Standing</span>
              </div>
            )}
          </div>

          {/* Art Hash */}
          <div className="bg-void-bg/50 rounded p-4">
            <p className="text-void-fg/30 text-xs uppercase tracking-wider mb-2">Soul Art Hash</p>
            <p className="text-void-fg/60 font-mono text-xs break-all">{profile.artHash}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Deterministic visual representation of an art hash.
 * Generates a pattern from the hash bytes.
 */
function SoulArtVisualization({ artHash, size }: { artHash: string; size: number }) {
  // Generate a deterministic color grid from the hash
  const colors: string[] = [];
  for (let i = 0; i < artHash.length; i += 6) {
    const hex = artHash.slice(i, i + 6).padEnd(6, '0');
    colors.push(`#${hex}`);
  }

  const gridSize = Math.ceil(Math.sqrt(colors.length));
  const cellSize = size / gridSize;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="#0f0f19" />
      {colors.map((color, i) => {
        const x = (i % gridSize) * cellSize;
        const y = Math.floor(i / gridSize) * cellSize;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={cellSize}
            height={cellSize}
            fill={color}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}
