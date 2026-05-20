/**
 * CallControls Component
 * Provides mute, camera, screen share, and hang up controls
 */

'use client';

import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  MonitorOff,
} from 'lucide-react';
import type { MediaState } from '@/types/call';

interface CallControlsProps {
  mediaState: MediaState;
  callType: 'voice' | 'video';
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onEndCall: () => void;
  disabled?: boolean;
}

export function CallControls({
  mediaState,
  callType,
  onToggleAudio,
  onToggleVideo,
  onStartScreenShare,
  onStopScreenShare,
  onEndCall,
  disabled = false,
}: CallControlsProps) {
  return (
    <div className="flex items-center justify-center gap-4 p-4 bg-zinc-900/90 rounded-xl">
      {/* Mute/Unmute */}
      <button
        onClick={onToggleAudio}
        disabled={disabled}
        className={`p-4 rounded-full transition-colors ${
          mediaState.audioMuted
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-zinc-700 hover:bg-zinc-600'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title={mediaState.audioMuted ? 'Unmute' : 'Mute'}
      >
        {mediaState.audioMuted ? (
          <MicOff className="w-6 h-6 text-white" />
        ) : (
          <Mic className="w-6 h-6 text-white" />
        )}
      </button>

      {/* Camera Toggle (video calls only) */}
      {callType === 'video' && (
        <button
          onClick={onToggleVideo}
          disabled={disabled}
          className={`p-4 rounded-full transition-colors ${
            !mediaState.videoEnabled
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-zinc-700 hover:bg-zinc-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title={mediaState.videoEnabled ? 'Turn off camera' : 'Turn on camera'}
        >
          {mediaState.videoEnabled ? (
            <Video className="w-6 h-6 text-white" />
          ) : (
            <VideoOff className="w-6 h-6 text-white" />
          )}
        </button>
      )}

      {/* Screen Share */}
      <button
        onClick={mediaState.screenSharing ? onStopScreenShare : onStartScreenShare}
        disabled={disabled}
        className={`p-4 rounded-full transition-colors ${
          mediaState.screenSharing
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-zinc-700 hover:bg-zinc-600'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title={mediaState.screenSharing ? 'Stop sharing' : 'Share screen'}
      >
        {mediaState.screenSharing ? (
          <MonitorOff className="w-6 h-6 text-white" />
        ) : (
          <Monitor className="w-6 h-6 text-white" />
        )}
      </button>

      {/* End Call */}
      <button
        onClick={onEndCall}
        disabled={disabled}
        className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="End call"
      >
        <PhoneOff className="w-6 h-6 text-white" />
      </button>
    </div>
  );
}

export default CallControls;
