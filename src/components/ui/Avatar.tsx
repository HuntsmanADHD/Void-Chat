'use client';

import React, { useMemo } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Public ID to generate gradient from */
  publicId: string;
  /** Optional image URL to display instead of gradient */
  imageUrl?: string | null;
  /** Size variant */
  size?: AvatarSize;
  /** Optional alt text for accessibility */
  alt?: string;
  /** Online status */
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  /** Show status indicator */
  showStatus?: boolean;
  /** Additional class names */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-xl',
};

const statusSizeClasses: Record<AvatarSize, string> = {
  xs: 'w-2 h-2 border',
  sm: 'w-2.5 h-2.5 border',
  md: 'w-3 h-3 border-2',
  lg: 'w-3.5 h-3.5 border-2',
  xl: 'w-4 h-4 border-2',
};

/**
 * Generate a deterministic gradient based on public ID
 * Uses the public ID hash to create consistent colors
 */
function generateGradientFromAddress(address: string): {
  colors: [string, string];
  angle: number;
} {
  // Simple hash function for the address
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Generate hue values from different parts of the hash
  const hue1 = Math.abs(hash % 360);
  const hue2 = Math.abs((hash >> 8) % 360);

  // Ensure good saturation and lightness for visibility
  const saturation1 = 60 + (Math.abs(hash >> 4) % 30); // 60-90%
  const saturation2 = 60 + (Math.abs(hash >> 12) % 30); // 60-90%
  const lightness1 = 45 + (Math.abs(hash >> 16) % 20); // 45-65%
  const lightness2 = 45 + (Math.abs(hash >> 20) % 20); // 45-65%

  // Calculate angle from hash
  const angle = Math.abs((hash >> 24) % 360);

  return {
    colors: [
      `hsl(${hue1}, ${saturation1}%, ${lightness1}%)`,
      `hsl(${hue2}, ${saturation2}%, ${lightness2}%)`,
    ],
    angle,
  };
}

/**
 * Get initials from public ID (first 2 characters)
 */
function getInitials(address: string): string {
  if (!address || address.length < 4) return '??';
  return address.slice(0, 2).toUpperCase();
}

export function Avatar({
  publicId,
  imageUrl,
  size = 'md',
  alt,
  status,
  showStatus = false,
  className = '',
  onClick,
}: AvatarProps) {
  const gradient = useMemo(
    () => generateGradientFromAddress(publicId),
    [publicId]
  );

  const initials = useMemo(
    () => getInitials(publicId),
    [publicId]
  );

  const gradientStyle = useMemo(
    () => ({
      background: `linear-gradient(${gradient.angle}deg, ${gradient.colors[0]}, ${gradient.colors[1]})`,
    }),
    [gradient]
  );

  const sizeClass = sizeClasses[size];
  const statusSizeClass = statusSizeClasses[size];

  const statusColorClasses: Record<string, string> = {
    online: 'bg-[var(--status-online)]',
    idle: 'bg-[var(--status-idle)]',
    dnd: 'bg-[var(--status-dnd)]',
    offline: 'bg-[var(--status-offline)]',
  };

  return (
    <div
      className={`relative inline-block ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={alt || `Avatar for ${publicId}`}
          className={`${sizeClass} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${sizeClass} rounded-full flex items-center justify-center font-semibold text-white select-none`}
          style={gradientStyle}
          title={alt || publicId}
        >
          {initials}
        </div>
      )}

      {showStatus && status && (
        <span
          className={`absolute bottom-0 right-0 ${statusSizeClass} rounded-full border-[var(--discord-sidebar)] ${statusColorClasses[status]}`}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
}

export default Avatar;
