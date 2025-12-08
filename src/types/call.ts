/**
 * Voice/Video Call Types for Void Chat
 */

export type CallType = 'voice' | 'video';
export type CallState = 'idle' | 'initiating' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';
export type CallEndReason = 'completed' | 'rejected' | 'no_answer' | 'busy' | 'network_error' | 'user_hangup' | 'timeout';

export interface MediaState {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  audioMuted: boolean;
}

export interface ConnectionQuality {
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  packetLoss: number;
  latency: number;
  jitter: number;
  bandwidth: number;
}

export interface CallParticipant {
  peerId: string;
  displayName?: string;
  xHandle?: string;
  joinedAt: number;
  mediaState: MediaState;
  audioLevel: number;
  speaking: boolean;
  connectionQuality: ConnectionQuality;
  stream?: MediaStream;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
}

export interface Call {
  id: string;
  type: CallType;
  state: CallState;
  initiatorId: string;
  participants: Map<string, CallParticipant>;
  startedAt?: number;
  endedAt?: number;
  endReason?: CallEndReason;
  channelId?: string;
  communityId?: string;
  isGroupCall: boolean;
}

export interface IncomingCall {
  callId: string;
  type: CallType;
  callerId: string;
  callerXHandle?: string;
  channelId?: string;
  communityId?: string;
  timestamp: number;
}

export const CALL_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const CALL_TIMEOUTS = { ringing: 30000, connecting: 15000, reconnecting: 10000 };
