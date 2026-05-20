/**
 * useCall Hook for Voice/Video Calling in Void Chat
 * Manages WebRTC media streams, call state, and signaling
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import Peer, { Instance as PeerInstance, SignalData } from 'simple-peer';
import { getSocketManager, SocketManager } from '@/lib/socket';
import type {
  CallType,
  CallState,
  CallEndReason,
  MediaState,
  ConnectionQuality,
  CallParticipant,
  Call,
  IncomingCall,
} from '@/types/call';
import {
  VOICE_CALL_CONSTRAINTS,
  VIDEO_CALL_CONSTRAINTS,
  CALL_ICE_SERVERS,
  CALL_TIMEOUTS,
} from '@/types/call';

export interface UseCallOptions {
  onIncomingCall?: (call: IncomingCall) => void;
  onCallAccepted?: (callId: string) => void;
  onCallRejected?: (callId: string, reason?: string) => void;
  onCallEnded?: (callId: string, reason: CallEndReason) => void;
  onParticipantJoined?: (participant: CallParticipant) => void;
  onParticipantLeft?: (peerId: string) => void;
}

export interface UseCallReturn {
  currentCall: Call | null;
  incomingCall: IncomingCall | null;
  localStream: MediaStream | null;
  localMediaState: MediaState;
  participants: CallParticipant[];
  connectionQuality: ConnectionQuality | null;
  initiateCall: (targetPublicId: string, type: CallType, channelId?: string) => Promise<string>;
  acceptCall: () => Promise<void>;
  rejectCall: (reason?: string) => void;
  endCall: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  joinVoiceChannel: (channelId: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  isInCall: boolean;
  callDuration: number;
}

function generateCallId(): string {
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `call-${Date.now()}-${randomHex}`;
}

const DEFAULT_MEDIA_STATE: MediaState = {
  audioEnabled: true,
  videoEnabled: false,
  screenSharing: false,
  audioMuted: false,
};

const DEFAULT_CONNECTION_QUALITY: ConnectionQuality = {
  quality: 'good',
  packetLoss: 0,
  latency: 0,
  jitter: 0,
  bandwidth: 0,
};

export function useCall(options: UseCallOptions = {}): UseCallReturn {
  const {
    onIncomingCall,
    onCallAccepted,
    onCallRejected,
    onCallEnded,
    onParticipantJoined,
    onParticipantLeft,
  } = options;

  const { publicId, isAuthenticated } = useAuth();

  const [currentCall, setCurrentCall] = useState<Call | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localMediaState, setLocalMediaState] = useState<MediaState>(DEFAULT_MEDIA_STATE);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);

  const socketManagerRef = useRef<SocketManager | null>(null);
  const peersRef = useRef<Map<string, PeerInstance>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onIncomingCallRef = useRef(onIncomingCall);
  const onCallAcceptedRef = useRef(onCallAccepted);
  const onCallRejectedRef = useRef(onCallRejected);
  const onCallEndedRef = useRef(onCallEnded);
  const onParticipantJoinedRef = useRef(onParticipantJoined);
  const onParticipantLeftRef = useRef(onParticipantLeft);

  useEffect(() => {
    onIncomingCallRef.current = onIncomingCall;
    onCallAcceptedRef.current = onCallAccepted;
    onCallRejectedRef.current = onCallRejected;
    onCallEndedRef.current = onCallEnded;
    onParticipantJoinedRef.current = onParticipantJoined;
    onParticipantLeftRef.current = onParticipantLeft;
  }, [onIncomingCall, onCallAccepted, onCallRejected, onCallEnded, onParticipantJoined, onParticipantLeft]);

  const getUserMedia = useCallback(async (type: CallType): Promise<MediaStream> => {
    const constraints = type === 'video' ? VIDEO_CALL_CONSTRAINTS : VOICE_CALL_CONSTRAINTS;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
      return stream;
    } catch (error) {
      console.error('[useCall] Failed to get user media:', error);
      throw new Error('Failed to access camera/microphone. Please check permissions.');
    }
  }, []);

  const stopStream = useCallback((stream: MediaStream | null) => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  }, []);

  const createPeer = useCallback((
    targetPublicId: string,
    initiator: boolean,
    stream: MediaStream
  ): PeerInstance => {
    const peer = new Peer({
      initiator,
      trickle: true,
      stream,
      config: { iceServers: CALL_ICE_SERVERS },
    });

    peer.on('signal', (signal: SignalData) => {
      const socketManager = socketManagerRef.current;
      if (!socketManager?.isConnected()) return;

      if (signal.type === 'offer') {
        socketManager.sendSignalOffer(targetPublicId, { type: 'offer', sdp: signal.sdp });
      } else if (signal.type === 'answer') {
        socketManager.sendSignalAnswer(targetPublicId, { type: 'answer', sdp: signal.sdp });
      } else if ('candidate' in signal && signal.candidate) {
        socketManager.sendICECandidate(targetPublicId, signal.candidate as RTCIceCandidate);
      }
    });

    peer.on('stream', (remoteStream: MediaStream) => {
      setParticipants(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p.peerId === targetPublicId);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            stream: remoteStream,
            videoTrack: remoteStream.getVideoTracks()[0],
            audioTrack: remoteStream.getAudioTracks()[0],
          };
        }
        return updated;
      });
    });

    peer.on('connect', () => {
      setCurrentCall(prev => prev ? { ...prev, state: 'connected' } : null);
    });

    peer.on('close', () => {
      peersRef.current.delete(targetPublicId);
    });

    peer.on('error', (error: Error) => {
      console.error(`[useCall] Peer error with ${targetPublicId}:`, error);
    });

    peersRef.current.set(targetPublicId, peer);
    return peer;
  }, []);

  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  }, []);

  const stopCallTimer = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  }, []);

  const cleanupCall = useCallback(() => {
    peersRef.current.forEach((peer) => {
      try { peer.destroy(); } catch {}
    });
    peersRef.current.clear();

    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);

    stopStream(screenStreamRef.current);
    screenStreamRef.current = null;

    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    stopCallTimer();

    setCurrentCall(null);
    setIncomingCall(null);
    setParticipants([]);
    setLocalMediaState(DEFAULT_MEDIA_STATE);
    setConnectionQuality(null);
    setCallDuration(0);
  }, [stopStream, stopCallTimer]);

  const initiateCall = useCallback(async (
    targetPublicId: string,
    type: CallType,
    channelId?: string
  ): Promise<string> => {
    if (!publicId) throw new Error('Not authenticated');

    const callId = generateCallId();

    try {
      const stream = await getUserMedia(type);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setLocalMediaState({
        audioEnabled: true,
        videoEnabled: type === 'video',
        screenSharing: false,
        audioMuted: false,
      });

      const call: Call = {
        id: callId,
        type,
        state: 'initiating',
        initiatorId: publicId,
        participants: new Map(),
        channelId,
        isGroupCall: !!channelId,
      };
      setCurrentCall(call);

      const socketManager = socketManagerRef.current;
      if (socketManager?.isConnected()) {
        const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
        socket?.emit('call:initiate', { callId, type, targetPublicId, channelId });
      }

      setCurrentCall(prev => prev ? { ...prev, state: 'ringing' } : null);

      ringingTimeoutRef.current = setTimeout(() => {
        if (currentCall?.state === 'ringing') {
          endCall();
          onCallEndedRef.current?.(callId, 'no_answer');
        }
      }, CALL_TIMEOUTS.ringing);

      createPeer(targetPublicId, true, stream);
      return callId;
    } catch (error) {
      cleanupCall();
      throw error;
    }
  }, [publicId, getUserMedia, createPeer, cleanupCall, currentCall?.state]);

  const acceptCall = useCallback(async (): Promise<void> => {
    if (!incomingCall || !publicId) throw new Error('No incoming call to accept');

    try {
      const stream = await getUserMedia(incomingCall.type);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setLocalMediaState({
        audioEnabled: true,
        videoEnabled: incomingCall.type === 'video',
        screenSharing: false,
        audioMuted: false,
      });

      const call: Call = {
        id: incomingCall.callId,
        type: incomingCall.type,
        state: 'connecting',
        initiatorId: incomingCall.callerId,
        participants: new Map(),
        channelId: incomingCall.channelId,
        communityId: incomingCall.communityId,
        isGroupCall: !!incomingCall.channelId,
        startedAt: Date.now(),
      };
      setCurrentCall(call);

      const socketManager = socketManagerRef.current;
      if (socketManager?.isConnected()) {
        const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
        socket?.emit('call:accept', { callId: incomingCall.callId, initiatorPublicId: incomingCall.callerId });
      }

      createPeer(incomingCall.callerId, false, stream);
      setIncomingCall(null);
      startCallTimer();
      onCallAcceptedRef.current?.(incomingCall.callId);
    } catch (error) {
      cleanupCall();
      throw error;
    }
  }, [incomingCall, publicId, getUserMedia, createPeer, cleanupCall, startCallTimer]);

  const rejectCall = useCallback((reason?: string): void => {
    if (!incomingCall) return;

    const socketManager = socketManagerRef.current;
    if (socketManager?.isConnected()) {
      const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
      socket?.emit('call:reject', { callId: incomingCall.callId, initiatorPublicId: incomingCall.callerId, reason });
    }

    onCallRejectedRef.current?.(incomingCall.callId, reason);
    setIncomingCall(null);
  }, [incomingCall]);

  const endCall = useCallback((): void => {
    if (!currentCall) return;

    const socketManager = socketManagerRef.current;
    if (socketManager?.isConnected()) {
      const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
      socket?.emit('call:end', { callId: currentCall.id, reason: 'user_hangup' as CallEndReason });
    }

    onCallEndedRef.current?.(currentCall.id, 'user_hangup');
    cleanupCall();
  }, [currentCall, cleanupCall]);

  const toggleAudio = useCallback((): void => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setLocalMediaState(prev => ({ ...prev, audioMuted: !audioTrack.enabled }));

      const socketManager = socketManagerRef.current;
      if (socketManager?.isConnected() && currentCall) {
        const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
        socket?.emit('call:media-toggle', {
          callId: currentCall.id,
          peerId: publicId,
          mediaType: 'audio',
          enabled: audioTrack.enabled,
        });
      }
    }
  }, [currentCall, publicId]);

  const toggleVideo = useCallback((): void => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setLocalMediaState(prev => ({ ...prev, videoEnabled: videoTrack.enabled }));

      const socketManager = socketManagerRef.current;
      if (socketManager?.isConnected() && currentCall) {
        const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
        socket?.emit('call:media-toggle', {
          callId: currentCall.id,
          peerId: publicId,
          mediaType: 'video',
          enabled: videoTrack.enabled,
        });
      }
    }
  }, [currentCall, publicId]);

  const startScreenShare = useCallback(async (): Promise<void> => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = screenStream;

      const videoTrack = screenStream.getVideoTracks()[0];
      peersRef.current.forEach((peer) => {
        const sender = (peer as unknown as { _pc: RTCPeerConnection })._pc
          ?.getSenders()
          .find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });

      setLocalMediaState(prev => ({ ...prev, screenSharing: true }));
      videoTrack.onended = () => stopScreenShare();

      const socketManager = socketManagerRef.current;
      if (socketManager?.isConnected() && currentCall) {
        const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
        socket?.emit('call:media-toggle', {
          callId: currentCall.id,
          peerId: publicId,
          mediaType: 'screen',
          enabled: true,
        });
      }
    } catch (error) {
      console.error('[useCall] Failed to start screen share:', error);
      throw new Error('Failed to start screen sharing');
    }
  }, [currentCall, publicId]);

  const stopScreenShare = useCallback((): void => {
    if (!screenStreamRef.current) return;

    stopStream(screenStreamRef.current);
    screenStreamRef.current = null;

    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) {
      peersRef.current.forEach((peer) => {
        const sender = (peer as unknown as { _pc: RTCPeerConnection })._pc
          ?.getSenders()
          .find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(cameraTrack);
      });
    }

    setLocalMediaState(prev => ({ ...prev, screenSharing: false }));

    const socketManager = socketManagerRef.current;
    if (socketManager?.isConnected() && currentCall) {
      const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
      socket?.emit('call:media-toggle', {
        callId: currentCall.id,
        peerId: publicId,
        mediaType: 'screen',
        enabled: false,
      });
    }
  }, [stopStream, currentCall, publicId]);

  const joinVoiceChannel = useCallback(async (channelId: string): Promise<void> => {
    if (!publicId) throw new Error('Not authenticated');

    try {
      const stream = await getUserMedia('voice');
      localStreamRef.current = stream;
      setLocalStream(stream);
      setLocalMediaState({
        audioEnabled: true,
        videoEnabled: false,
        screenSharing: false,
        audioMuted: false,
      });

      const call: Call = {
        id: `voice-channel-${channelId}`,
        type: 'voice',
        state: 'connecting',
        initiatorId: publicId,
        participants: new Map(),
        channelId,
        isGroupCall: true,
        startedAt: Date.now(),
      };
      setCurrentCall(call);

      const socketManager = socketManagerRef.current;
      if (socketManager?.isConnected()) {
        const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
        socket?.emit('call:join-voice-channel', { channelId });
      }

      startCallTimer();
    } catch (error) {
      cleanupCall();
      throw error;
    }
  }, [publicId, getUserMedia, cleanupCall, startCallTimer]);

  const leaveVoiceChannel = useCallback((): void => {
    if (!currentCall?.channelId) return;

    const socketManager = socketManagerRef.current;
    if (socketManager?.isConnected()) {
      const socket = (socketManager as unknown as { socket: { emit: (e: string, d: unknown) => void } }).socket;
      socket?.emit('call:leave-voice-channel', { channelId: currentCall.channelId });
    }

    cleanupCall();
  }, [currentCall, cleanupCall]);

  // Initialize socket manager and set up event handlers
  useEffect(() => {
    if (!isAuthenticated || !publicId) return;

    socketManagerRef.current = getSocketManager();
    const socketManager = socketManagerRef.current;
    const socket = (socketManager as unknown as { socket: { on: (e: string, cb: (d: unknown) => void) => void } }).socket;

    if (!socket) return;

    socket.on('call:incoming', (data: unknown) => {
      const incomingData = data as IncomingCall;
      setIncomingCall(incomingData);
      onIncomingCallRef.current?.(incomingData);
    });

    socket.on('call:accepted', (data: unknown) => {
      const acceptData = data as { callId: string; accepterId: string };
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
        ringingTimeoutRef.current = null;
      }
      setCurrentCall(prev => prev ? { ...prev, state: 'connecting', startedAt: Date.now() } : null);
      startCallTimer();
      onCallAcceptedRef.current?.(acceptData.callId);
    });

    socket.on('call:rejected', (data: unknown) => {
      const rejectData = data as { callId: string; rejecterId: string; reason?: string };
      cleanupCall();
      onCallRejectedRef.current?.(rejectData.callId, rejectData.reason);
    });

    socket.on('call:ended', (data: unknown) => {
      const endData = data as { callId: string; enderId: string; reason: CallEndReason };
      cleanupCall();
      onCallEndedRef.current?.(endData.callId, endData.reason);
    });

    socket.on('call:media-toggle', (data: unknown) => {
      const toggleData = data as { peerId: string; mediaType: 'audio' | 'video' | 'screen'; enabled: boolean };
      setParticipants(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(p => p.peerId === toggleData.peerId);
        if (idx >= 0) {
          const mediaState = { ...updated[idx].mediaState };
          if (toggleData.mediaType === 'audio') mediaState.audioMuted = !toggleData.enabled;
          else if (toggleData.mediaType === 'video') mediaState.videoEnabled = toggleData.enabled;
          else if (toggleData.mediaType === 'screen') mediaState.screenSharing = toggleData.enabled;
          updated[idx] = { ...updated[idx], mediaState };
        }
        return updated;
      });
    });

    socket.on('call:participant-joined', (data: unknown) => {
      const joinData = data as { participant: Omit<CallParticipant, 'stream' | 'videoTrack' | 'audioTrack'> };
      const newParticipant: CallParticipant = { ...joinData.participant, stream: undefined, videoTrack: undefined, audioTrack: undefined };
      setParticipants(prev => [...prev, newParticipant]);
      onParticipantJoinedRef.current?.(newParticipant);

      if (localStreamRef.current) {
        createPeer(joinData.participant.peerId, true, localStreamRef.current);
      }
    });

    socket.on('call:participant-left', (data: unknown) => {
      const leftData = data as { peerId: string };
      setParticipants(prev => prev.filter(p => p.peerId !== leftData.peerId));
      const peer = peersRef.current.get(leftData.peerId);
      if (peer) {
        peer.destroy();
        peersRef.current.delete(leftData.peerId);
      }
      onParticipantLeftRef.current?.(leftData.peerId);
    });

    // Handle WebRTC signals
    socketManager.setOnSignalOffer((data) => {
      const peer = peersRef.current.get(data.fromPublicId);
      if (peer) {
        peer.signal({ type: 'offer', sdp: data.signal.sdp });
      } else if (localStreamRef.current) {
        const newPeer = createPeer(data.fromPublicId, false, localStreamRef.current);
        newPeer.signal({ type: 'offer', sdp: data.signal.sdp });
      }
    });

    socketManager.setOnSignalAnswer((data) => {
      const peer = peersRef.current.get(data.fromPublicId);
      if (peer) peer.signal({ type: 'answer', sdp: data.signal.sdp });
    });

    socketManager.setOnICECandidate((data) => {
      const peer = peersRef.current.get(data.fromPublicId);
      if (peer) peer.signal({ type: 'candidate', candidate: data.candidate });
    });

    return () => { cleanupCall(); };
  }, [isAuthenticated, publicId, cleanupCall, createPeer, startCallTimer]);

  return {
    currentCall,
    incomingCall,
    localStream,
    localMediaState,
    participants,
    connectionQuality,
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    joinVoiceChannel,
    leaveVoiceChannel,
    isInCall: currentCall !== null && currentCall.state !== 'ended' && currentCall.state !== 'failed',
    callDuration,
  };
}

export default useCall;
