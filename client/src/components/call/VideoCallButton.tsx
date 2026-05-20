/**
 * VideoCallButton Component
 * Button to initiate a video call
 */

'use client';

import React, { useState } from 'react';
import { Video, Loader2 } from 'lucide-react';

interface VideoCallButtonProps {
  targetId: string;
  onCall: (targetId: string, type: 'video') => Promise<string>;
  disabled?: boolean;
  className?: string;
}

export function VideoCallButton({
  targetId,
  onCall,
  disabled = false,
  className = '',
}: VideoCallButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (disabled || isLoading) return;

    setIsLoading(true);
    try {
      await onCall(targetId, 'video');
    } catch (error) {
      console.error('Failed to start video call:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={`p-2 rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      title="Start video call"
    >
      {isLoading ? (
        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
      ) : (
        <Video className="w-5 h-5 text-blue-400" />
      )}
    </button>
  );
}

export default VideoCallButton;
