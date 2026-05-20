/**
 * CallModal Component
 * Full-screen overlay for active calls
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { CallControls } from './CallControls';
import { ParticipantVideo } from './ParticipantVideo';
import type { Call, CallParticipant, MediaState, IncomingCall } from '@/types/call';

interface CallModalProps {
  call: Call | null;
  incomingCall: IncomingCall | null;
  localStream: MediaStream | null;
  localMediaState: MediaState;
  participants: CallParticipant[];
  callDuration: number;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onStartScreenShare: () => Promise<void>;
  onStopScreenShare: () => void;
  onEndCall: () => void;
  onAcceptCall: () => Promise<void>;
  onRejectCall: (reason?: string) => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function CallModal({
  call,
  incomingCall,
  localStream,
  localMediaState,
  participants,
  callDuration,
  onToggleAudio,
  onToggleVideo,
  onStartScreenShare,
  onStopScreenShare,
  onEndCall,
  onAcceptCall,
  onRejectCall,
}: CallModalProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (call || incomingCall)) {
        setIsMinimized(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [call, incomingCall]);

  // Incoming call modal
  if (incomingCall && !call) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="bg-zinc-900 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-zinc-700 mx-auto mb-4 flex items-center justify-center">
              <span className="text-3xl font-bold text-white">
                {(incomingCall.callerId.slice(0, 2)).charAt(0).toUpperCase()}
              </span>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Incoming {incomingCall.type === 'video' ? 'Video' : 'Voice'} Call
            </h2>
            <p className="text-zinc-400 mb-6">
              {`${incomingCall.callerId.slice(0, 8)}...`}
            </p>

            <div className="flex justify-center gap-4">
              <button
                onClick={() => onRejectCall()}
                className="px-6 py-3 rounded-full bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
              >
                Decline
              </button>
              <button
                onClick={() => onAcceptCall()}
                className="px-6 py-3 rounded-full bg-green-600 hover:bg-green-700 text-white font-medium transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!call) return null;

  // Minimized view
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <div className="bg-zinc-900 rounded-xl p-3 shadow-2xl flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm text-white">{formatDuration(callDuration)}</span>
          </div>
          <button
            onClick={() => setIsMinimized(false)}
            className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <Maximize2 className="w-4 h-4 text-white" />
          </button>
          <button
            onClick={onEndCall}
            className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    );
  }

  // Local participant for display
  const localParticipant: CallParticipant = {
    peerId: 'local',
    joinedAt: call.startedAt || Date.now(),
    mediaState: localMediaState,
    audioLevel: 0,
    speaking: false,
    connectionQuality: { quality: 'good', packetLoss: 0, latency: 0, jitter: 0, bandwidth: 0 },
    stream: localStream || undefined,
  };

  const gridCols = participants.length <= 1 ? 'grid-cols-1' :
                   participants.length <= 4 ? 'grid-cols-2' :
                   participants.length <= 9 ? 'grid-cols-3' : 'grid-cols-4';

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          <span className="text-white font-medium">
            {call.type === 'video' ? 'Video Call' : 'Voice Call'}
          </span>
          <span className="text-zinc-400">{formatDuration(callDuration)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
            title="Minimize"
          >
            <Minimize2 className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Video Grid */}
      <div className="flex-1 p-4 overflow-hidden">
        <div className={`grid ${gridCols} gap-4 h-full`}>
          <ParticipantVideo
            participant={localParticipant}
            isLocal
            className="aspect-video"
          />
          {participants.map((participant) => (
            <ParticipantVideo
              key={participant.peerId}
              participant={participant}
              isSpeaking={participant.speaking}
              className="aspect-video"
            />
          ))}
        </div>
      </div>

      {/* Call Status */}
      {(call.state === 'connecting' || call.state === 'ringing') && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">
              {call.state === 'ringing' ? 'Ringing...' : 'Connecting...'}
            </p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="p-4 flex justify-center">
        <CallControls
          mediaState={localMediaState}
          callType={call.type}
          onToggleAudio={onToggleAudio}
          onToggleVideo={onToggleVideo}
          onStartScreenShare={onStartScreenShare}
          onStopScreenShare={onStopScreenShare}
          onEndCall={onEndCall}
          disabled={call.state !== 'connected'}
        />
      </div>
    </div>
  );
}

export default CallModal;
