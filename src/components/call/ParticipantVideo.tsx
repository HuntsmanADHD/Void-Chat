/**
 * ParticipantVideo Component
 * Displays video/audio for a call participant
 */

'use client';

import React, { useRef, useEffect, useState } from 'react';
import { MicOff, VideoOff, Wifi, WifiOff } from 'lucide-react';
import type { CallParticipant, ConnectionQuality } from '@/types/call';

interface ParticipantVideoProps {
  participant: CallParticipant;
  isLocal?: boolean;
  isSpeaking?: boolean;
  showControls?: boolean;
  className?: string;
}

function getQualityColor(quality: ConnectionQuality['quality']): string {
  switch (quality) {
    case 'excellent':
      return 'text-green-500';
    case 'good':
      return 'text-green-400';
    case 'fair':
      return 'text-yellow-500';
    case 'poor':
      return 'text-red-500';
    default:
      return 'text-zinc-400';
  }
}

export function ParticipantVideo({
  participant,
  isLocal = false,
  isSpeaking = false,
  showControls = true,
  className = '',
}: ParticipantVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      setHasVideo(participant.stream.getVideoTracks().length > 0 && participant.mediaState.videoEnabled);
    }
  }, [participant.stream, participant.mediaState.videoEnabled]);

  const displayName = participant.xHandle || participant.displayName || `${participant.peerId.slice(0, 4)}...${participant.peerId.slice(-4)}`;

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-zinc-800 ${
        isSpeaking ? 'ring-2 ring-green-500' : ''
      } ${className}`}
    >
      {/* Video Element */}
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-700">
          <div className="w-20 h-20 rounded-full bg-zinc-600 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Overlay with participant info */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate max-w-32">
              {isLocal ? 'You' : displayName}
            </span>
          </div>

          {showControls && (
            <div className="flex items-center gap-2">
              {participant.mediaState.audioMuted && (
                <div className="p-1 rounded-full bg-red-600">
                  <MicOff className="w-3 h-3 text-white" />
                </div>
              )}
              {!participant.mediaState.videoEnabled && (
                <div className="p-1 rounded-full bg-red-600">
                  <VideoOff className="w-3 h-3 text-white" />
                </div>
              )}
              <div className={getQualityColor(participant.connectionQuality.quality)}>
                {participant.connectionQuality.quality === 'poor' ? (
                  <WifiOff className="w-4 h-4" />
                ) : (
                  <Wifi className="w-4 h-4" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Speaking indicator */}
      {participant.speaking && (
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-white">Speaking</span>
        </div>
      )}
    </div>
  );
}

export default ParticipantVideo;
