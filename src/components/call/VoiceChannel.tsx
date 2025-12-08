/**
 * VoiceChannel Component
 * Voice channel display in community sidebar
 */

'use client';

import React from 'react';
import { Volume2, Lock, Users } from 'lucide-react';
import type { VoiceChannel as VoiceChannelType } from '@/types/call';

interface VoiceChannelProps {
  channel: VoiceChannelType;
  isActive?: boolean;
  currentUserInChannel?: boolean;
  onJoin: (channelId: string) => Promise<void>;
  onLeave: () => void;
}

export function VoiceChannel({
  channel,
  isActive = false,
  currentUserInChannel = false,
  onJoin,
  onLeave,
}: VoiceChannelProps) {
  const handleClick = () => {
    if (currentUserInChannel) {
      onLeave();
    } else if (!channel.isLocked) {
      onJoin(channel.id);
    }
  };

  return (
    <div className="mb-1">
      <button
        onClick={handleClick}
        disabled={channel.isLocked && !currentUserInChannel}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
          isActive
            ? 'bg-zinc-700 text-white'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <Volume2 className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left text-sm truncate">{channel.name}</span>

        {channel.isLocked && (
          <Lock className="w-3 h-3 text-zinc-500" />
        )}

        {channel.participants.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <Users className="w-3 h-3" />
            <span>{channel.participants.length}</span>
          </div>
        )}
      </button>

      {/* Participants in channel */}
      {channel.participants.length > 0 && (
        <div className="ml-6 mt-1 space-y-1">
          {channel.participants.map((participant) => (
            <div
              key={participant.peerId}
              className="flex items-center gap-2 px-2 py-1"
            >
              <div className="w-6 h-6 rounded-full bg-zinc-600 flex items-center justify-center">
                <span className="text-xs text-white">
                  {(participant.xHandle || participant.peerId.slice(0, 2)).charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-xs text-zinc-400 truncate">
                {participant.xHandle ? `@${participant.xHandle}` : `${participant.peerId.slice(0, 6)}...`}
              </span>
              {participant.speaking && (
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default VoiceChannel;
