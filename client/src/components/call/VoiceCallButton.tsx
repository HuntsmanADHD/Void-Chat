/**
 * VoiceCallButton Component
 * Button to initiate a voice call
 */

'use client';

import React, { useState } from 'react';
import { Phone, Loader2 } from 'lucide-react';

interface VoiceCallButtonProps {
  targetId: string;
  onCall: (targetId: string, type: 'voice') => Promise<string>;
  disabled?: boolean;
  className?: string;
}

export function VoiceCallButton({
  targetId,
  onCall,
  disabled = false,
  className = '',
}: VoiceCallButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (disabled || isLoading) return;

    setIsLoading(true);
    try {
      await onCall(targetId, 'voice');
    } catch (error) {
      console.error('Failed to start voice call:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={`p-2 rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      title="Start voice call"
    >
      {isLoading ? (
        <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
      ) : (
        <Phone className="w-5 h-5 text-green-400" />
      )}
    </button>
  );
}

export default VoiceCallButton;
