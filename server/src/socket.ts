/**
 * Socket.io Server for Void Chat
 * Handles real-time message relay, WebRTC signaling, and presence
 *
 * Zero persistence — messages are relayed and optionally buffered in memory
 * with a 24hr TTL for offline users. Server restart = buffer gone.
 */

import { Server, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verify } from '@noble/ed25519';
import bs58 from 'bs58';
import { randomBytes } from 'crypto';
import { prisma } from './lib/prisma.js';

// =============================================================================
// CONFIG
// =============================================================================

const RATE_LIMIT = {
  windowMs: 60000,
  maxMessages: 60,
  maxSignals: 100,
};

const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BUFFERED_PER_USER = 500;
const MAX_BUFFERED_PER_SENDER = 50; // Per-sender limit within a recipient's buffer

// Map size caps to prevent OOM under load
const MAX_RATE_LIMIT_ENTRIES = 50000;
const MAX_NONCE_ENTRIES = 50000;
const MAX_OFFLINE_BUFFER_USERS = 10000;

function enforceMapLimit<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface P2PSignal {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidate;
}

interface AuthenticatedSocket extends Socket {
  publicId?: string;
  authenticated?: boolean;
}

interface RateLimitEntry {
  messages: number;
  signals: number;
  windowStart: number;
}

interface OnlineUser {
  publicId: string;
  socketId: string;
  connectedAt: number;
  lastSeen: number;
}

interface BufferedMessage {
  id: string;
  type: 'channel' | 'dm';
  senderId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
  expiresAt: number;
}

// =============================================================================
// IN-MEMORY STORES
// =============================================================================

const onlineUsers: Map<string, OnlineUser> = new Map();
const socketToUser: Map<string, string> = new Map();
const rateLimits: Map<string, RateLimitEntry> = new Map();
const typingUsers: Map<string, Set<string>> = new Map();
const offlineBuffer: Map<string, BufferedMessage[]> = new Map();

// Nonce tracking for replay prevention (CRIT-8)
const AUTH_NONCE_TTL_MS = 6 * 60 * 1000; // 6 minutes (slightly longer than the 5-min timestamp window)
const usedNonces: Map<string, number> = new Map(); // nonce -> expiry timestamp

// =============================================================================
// HELPERS
// =============================================================================

function generateMessageId(): string {
  return `msg-${Date.now()}-${randomBytes(8).toString('hex')}`;
}

function getDMRoomId(id1: string, id2: string): string {
  const sorted = [id1, id2].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

function getChannelRoomId(channelId: string): string {
  return `channel:${channelId}`;
}

function checkRateLimit(publicId: string, type: 'message' | 'signal'): boolean {
  const now = Date.now();
  let entry = rateLimits.get(publicId);

  if (!entry || now - entry.windowStart > RATE_LIMIT.windowMs) {
    entry = { messages: 0, signals: 0, windowStart: now };
    enforceMapLimit(rateLimits, MAX_RATE_LIMIT_ENTRIES);
    rateLimits.set(publicId, entry);
  }

  if (type === 'message') {
    if (entry.messages >= RATE_LIMIT.maxMessages) return false;
    entry.messages++;
  } else {
    if (entry.signals >= RATE_LIMIT.maxSignals) return false;
    entry.signals++;
  }

  return true;
}

async function verifySignature(
  publicKey: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    const publicKeyBytes = bs58.decode(publicKey);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);
    return await verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch (error) {
    console.error('[Socket Server] Signature verification failed:', error);
    return false;
  }
}

function bufferForOfflineUser(targetPublicId: string, type: 'channel' | 'dm', payload: Record<string, unknown>, senderId?: string): void {
  const now = Date.now();
  const msg: BufferedMessage = {
    id: generateMessageId(),
    type,
    senderId,
    payload,
    timestamp: now,
    expiresAt: now + MESSAGE_TTL_MS,
  };

  let buffer = offlineBuffer.get(targetPublicId);
  if (!buffer) {
    buffer = [];
    enforceMapLimit(offlineBuffer, MAX_OFFLINE_BUFFER_USERS);
    offlineBuffer.set(targetPublicId, buffer);
  }

  // Purge expired messages
  const valid = buffer.filter(m => m.expiresAt > now);

  // Enforce per-sender limit to prevent one user from filling another's buffer
  if (senderId) {
    const senderMessages = valid.filter(m => m.senderId === senderId);
    if (senderMessages.length >= MAX_BUFFERED_PER_SENDER) {
      // Drop the oldest message from this sender
      const oldestIdx = valid.findIndex(m => m.senderId === senderId);
      if (oldestIdx !== -1) valid.splice(oldestIdx, 1);
    }
  }

  // Enforce total buffer limit
  if (valid.length >= MAX_BUFFERED_PER_USER) valid.shift();
  valid.push(msg);
  offlineBuffer.set(targetPublicId, valid);
}

function flushOfflineBuffer(publicId: string, socket: AuthenticatedSocket): void {
  const buffer = offlineBuffer.get(publicId);
  if (!buffer || buffer.length === 0) return;

  const now = Date.now();
  const valid = buffer.filter(m => m.expiresAt > now);

  for (const msg of valid) {
    socket.emit(`message:${msg.type}`, msg.payload);
  }

  offlineBuffer.delete(publicId);

  if (valid.length > 0) {
    console.log(`[Socket Server] Flushed ${valid.length} buffered messages to ${publicId}`);
  }
}

function broadcastOnlineUsers(io: Server): void {
  const publicIds = Array.from(onlineUsers.keys());
  io.emit('users:online', publicIds);
}

// =============================================================================
// INIT
// =============================================================================

export function initSocketServer(httpServer: HTTPServer, corsOrigin: string): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: [
        corsOrigin,
        'tauri://localhost',
        'https://tauri.localhost',
        'http://localhost:1420',
        'http://localhost:3000',
        'http://localhost:5173',
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`[Socket Server] Client connected: ${socket.id}`);

    // =========================================================================
    // AUTH
    // =========================================================================

    socket.on('authenticate', async (data: { publicId: string; signature: string; message: string }) => {
      try {
        const { publicId, signature, message } = data;

        if (!publicId || !signature || !message) {
          socket.emit('authenticated', { success: false, error: 'Missing authentication data' });
          return;
        }

        // CRIT-8: Timestamp is MANDATORY — reject messages without one
        const timestampMatch = message.match(/timestamp:\s*(\d+)/i);
        if (!timestampMatch) {
          socket.emit('authenticated', { success: false, error: 'Authentication message must contain a timestamp' });
          return;
        }

        const messageTimestamp = parseInt(timestampMatch[1]);
        const timeDiff = Math.abs(Date.now() - messageTimestamp);
        if (timeDiff > 5 * 60 * 1000) {
          socket.emit('authenticated', { success: false, error: 'Authentication message expired' });
          return;
        }

        // Replay prevention: reject reused signature+message combos
        const nonce = `${publicId}:${signature}`;
        if (usedNonces.has(nonce)) {
          socket.emit('authenticated', { success: false, error: 'Replay detected: authentication already used' });
          return;
        }
        enforceMapLimit(usedNonces, MAX_NONCE_ENTRIES);
        usedNonces.set(nonce, Date.now() + AUTH_NONCE_TTL_MS);

        const user = await prisma.user.findUnique({
          where: { publicId },
          select: { publicKey: true, isBlacklisted: true },
        });

        if (!user) {
          socket.emit('authenticated', { success: false, error: 'User not found' });
          return;
        }

        if (user.isBlacklisted) {
          socket.emit('authenticated', { success: false, error: 'Account suspended' });
          socket.disconnect(true);
          return;
        }

        const isValid = await verifySignature(user.publicKey, signature, message);
        if (!isValid) {
          socket.emit('authenticated', { success: false, error: 'Invalid signature' });
          return;
        }

        // Disconnect existing session — delete from map FIRST to block old socket's messages
        const existingUser = onlineUsers.get(publicId);
        if (existingUser && existingUser.socketId !== socket.id) {
          onlineUsers.delete(publicId);
          socketToUser.delete(existingUser.socketId);
          const oldSocket = io.sockets.sockets.get(existingUser.socketId);
          if (oldSocket) {
            oldSocket.emit('error', { code: 'SESSION_REPLACED', message: 'Connected from another location' });
            oldSocket.disconnect(true);
          }
        }

        socket.publicId = publicId;
        socket.authenticated = true;
        socketToUser.set(socket.id, publicId);

        onlineUsers.set(publicId, {
          publicId,
          socketId: socket.id,
          connectedAt: Date.now(),
          lastSeen: Date.now(),
        });

        socket.emit('authenticated', { success: true });
        socket.broadcast.emit('user:online', publicId);
        broadcastOnlineUsers(io);
        flushOfflineBuffer(publicId, socket);

        console.log(`[Socket Server] User authenticated: ${publicId}`);
      } catch (error) {
        console.error('[Socket Server] Authentication error:', error);
        socket.emit('authenticated', { success: false, error: 'Authentication failed' });
      }
    });

    // =========================================================================
    // ROOM MANAGEMENT
    // =========================================================================

    socket.on('join:channel', async (channelId: string) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      // H-3: Verify community membership before allowing channel join
      try {
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { communityId: true },
        });
        if (!channel) {
          socket.emit('error', { code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
          return;
        }

        const user = await prisma.user.findUnique({
          where: { publicId: socket.publicId },
          select: { id: true },
        });
        if (!user) {
          socket.emit('error', { code: 'USER_NOT_FOUND', message: 'User not found' });
          return;
        }

        const membership = await prisma.membership.findUnique({
          where: { userId_communityId: { userId: user.id, communityId: channel.communityId } },
        });
        if (!membership) {
          socket.emit('error', { code: 'NOT_MEMBER', message: 'You must be a community member to join this channel' });
          return;
        }
      } catch (err) {
        console.error('[Socket Server] join:channel membership check error:', err);
        socket.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to verify membership' });
        return;
      }

      socket.join(getChannelRoomId(channelId));
    });

    socket.on('leave:channel', (channelId: string) => {
      const roomId = getChannelRoomId(channelId);
      socket.leave(roomId);
      const typing = typingUsers.get(roomId);
      if (typing && socket.publicId) typing.delete(socket.publicId);
    });

    socket.on('join:dm', async (recipientId: string) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      // Validate recipientId format (alphanumeric, _, -, 3-32 chars)
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(recipientId)) {
        socket.emit('error', { code: 'INVALID_RECIPIENT', message: 'Invalid recipient ID format' });
        return;
      }

      // Verify recipient exists
      const recipient = await prisma.user.findUnique({
        where: { publicId: recipientId },
        select: { publicId: true },
      });

      if (!recipient) {
        socket.emit('error', { code: 'USER_NOT_FOUND', message: 'Recipient does not exist' });
        return;
      }

      socket.join(getDMRoomId(socket.publicId, recipientId));
    });

    socket.on('leave:dm', (recipientId: string) => {
      if (!socket.publicId) return;
      const roomId = getDMRoomId(socket.publicId, recipientId);
      socket.leave(roomId);
      const typing = typingUsers.get(roomId);
      if (typing) typing.delete(socket.publicId);
    });

    // =========================================================================
    // MESSAGE RELAY
    // =========================================================================

    socket.on('message:channel', (data: {
      channelId: string;
      encrypted: string;
      nonce: string;
      senderId: string;
    }) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      if (!checkRateLimit(socket.publicId, 'message')) {
        socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
        return;
      }

      if (data.senderId !== socket.publicId) {
        socket.emit('error', { code: 'INVALID_SENDER', message: 'Sender mismatch' });
        return;
      }

      const message = {
        id: generateMessageId(),
        channelId: data.channelId,
        encrypted: data.encrypted,
        nonce: data.nonce,
        senderId: data.senderId,
        timestamp: Date.now(),
      };

      io.to(getChannelRoomId(data.channelId)).emit('message:channel', message);

      const user = onlineUsers.get(socket.publicId);
      if (user) user.lastSeen = Date.now();
    });

    socket.on('message:dm', async (data: {
      recipientId: string;
      encrypted: string;
      nonce: string;
      senderId: string;
    }) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      if (!checkRateLimit(socket.publicId, 'message')) {
        socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
        return;
      }

      if (data.senderId !== socket.publicId) {
        socket.emit('error', { code: 'INVALID_SENDER', message: 'Sender mismatch' });
        return;
      }

      const message = {
        id: generateMessageId(),
        encrypted: data.encrypted,
        nonce: data.nonce,
        senderId: data.senderId,
        timestamp: Date.now(),
      };

      io.to(getDMRoomId(socket.publicId, data.recipientId)).emit('message:dm', message);

      if (!onlineUsers.has(data.recipientId)) {
        // Verify recipient exists before buffering to prevent DoS via fake user IDs
        const recipientExists = await prisma.user.findUnique({
          where: { publicId: data.recipientId },
          select: { publicId: true },
        });

        if (!recipientExists) {
          socket.emit('error', { code: 'USER_NOT_FOUND', message: 'Recipient does not exist' });
          return;
        }

        bufferForOfflineUser(data.recipientId, 'dm', message, socket.publicId);
      }

      const user = onlineUsers.get(socket.publicId);
      if (user) user.lastSeen = Date.now();
    });

    // =========================================================================
    // P2P SIGNALING
    // =========================================================================

    socket.on('signal:offer', (data: { targetId: string; signal: P2PSignal }) => {
      if (!socket.authenticated || !socket.publicId) return;
      if (!checkRateLimit(socket.publicId, 'signal')) {
        socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
        return;
      }

      const targetUser = onlineUsers.get(data.targetId);
      if (!targetUser) {
        socket.emit('error', { code: 'USER_OFFLINE', message: 'Target user is not online' });
        return;
      }

      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('signal:offer', { fromId: socket.publicId, signal: data.signal });
      }
    });

    socket.on('signal:answer', (data: { targetId: string; signal: P2PSignal }) => {
      if (!socket.authenticated || !socket.publicId) return;
      if (!checkRateLimit(socket.publicId, 'signal')) {
        socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
        return;
      }

      const targetUser = onlineUsers.get(data.targetId);
      if (!targetUser) return;

      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('signal:answer', { fromId: socket.publicId, signal: data.signal });
      }
    });

    socket.on('signal:ice', (data: { targetId: string; candidate: RTCIceCandidate }) => {
      if (!socket.authenticated || !socket.publicId) return;
      if (!checkRateLimit(socket.publicId, 'signal')) return;

      const targetUser = onlineUsers.get(data.targetId);
      if (!targetUser) return;

      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('signal:ice', { fromId: socket.publicId, candidate: data.candidate });
      }
    });

    // =========================================================================
    // DKG (DISTRIBUTED KEY GENERATION)
    // =========================================================================

    socket.on('dkg:distribute', (data: {
      channelId: string;
      shares: Record<string, string>;
      groupPublicKey: string;
      threshold: number;
    }) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      if (!checkRateLimit(socket.publicId, 'message')) {
        socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
        return;
      }

      for (const targetId of Object.keys(data.shares)) {
        const targetUser = onlineUsers.get(targetId);
        const sharePayload = {
          channelId: data.channelId,
          fromId: socket.publicId,
          encryptedShare: data.shares[targetId],
          groupPublicKey: data.groupPublicKey,
          threshold: data.threshold,
        };

        if (targetUser) {
          const targetSocket = io.sockets.sockets.get(targetUser.socketId);
          if (targetSocket) {
            targetSocket.emit('dkg:share', sharePayload);
          }
        } else {
          bufferForOfflineUser(targetId, 'channel', sharePayload as unknown as Record<string, unknown>, socket.publicId);
        }
      }
    });

    socket.on('dkg:reconstruct-request', (data: { channelId: string }) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      io.to(`channel:${data.channelId}`).emit('dkg:reconstruct-needed', {
        channelId: data.channelId,
        requesterId: socket.publicId,
      });
    });

    socket.on('dkg:share-contribute', (data: {
      channelId: string;
      targetId: string;
      encryptedShare: string;
    }) => {
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      const targetUser = onlineUsers.get(data.targetId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          targetSocket.emit('dkg:share-contributed', {
            channelId: data.channelId,
            fromId: socket.publicId,
            encryptedShare: data.encryptedShare,
          });
        }
      }
    });

    // =========================================================================
    // TYPING INDICATORS
    // =========================================================================

    socket.on('typing:start', (data: { channelId?: string; dmRecipientId?: string }) => {
      if (!socket.authenticated || !socket.publicId) return;

      let roomId: string;
      if (data.channelId) roomId = getChannelRoomId(data.channelId);
      else if (data.dmRecipientId) roomId = getDMRoomId(socket.publicId, data.dmRecipientId);
      else return;

      if (!typingUsers.has(roomId)) typingUsers.set(roomId, new Set());
      typingUsers.get(roomId)!.add(socket.publicId);

      socket.to(roomId).emit('typing:update', {
        channelId: data.channelId,
        dmRecipientId: data.dmRecipientId,
        publicId: socket.publicId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data: { channelId?: string; dmRecipientId?: string }) => {
      if (!socket.authenticated || !socket.publicId) return;

      let roomId: string;
      if (data.channelId) roomId = getChannelRoomId(data.channelId);
      else if (data.dmRecipientId) roomId = getDMRoomId(socket.publicId, data.dmRecipientId);
      else return;

      const typing = typingUsers.get(roomId);
      if (typing) typing.delete(socket.publicId);

      socket.to(roomId).emit('typing:update', {
        channelId: data.channelId,
        dmRecipientId: data.dmRecipientId,
        publicId: socket.publicId,
        isTyping: false,
      });
    });

    // =========================================================================
    // REACTIONS
    // =========================================================================

    socket.on('reaction', (data: {
      messageId: string;
      channelId?: string;
      dmRecipientId?: string;
      emoji: string;
      action: 'add' | 'remove';
    }) => {
      if (!socket.authenticated || !socket.publicId) return;

      let roomId: string;
      if (data.channelId) roomId = getChannelRoomId(data.channelId);
      else if (data.dmRecipientId) roomId = getDMRoomId(socket.publicId, data.dmRecipientId);
      else return;

      io.to(roomId).emit('reaction', {
        messageId: data.messageId,
        emoji: data.emoji,
        action: data.action,
        userId: socket.publicId,
        timestamp: Date.now(),
      });
    });

    // =========================================================================
    // NOTIFICATIONS
    // =========================================================================

    socket.on('notification:send', (data: {
      targetId: string;
      notification: {
        id: string;
        type: string;
        title: string;
        body?: string;
        messageId?: string;
        channelId?: string;
        communityId?: string;
        senderId?: string;
      };
    }) => {
      // CRIT-7: Require authentication before sending notifications
      if (!socket.authenticated || !socket.publicId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
        return;
      }

      const targetUser = onlineUsers.get(data.targetId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          targetSocket.emit('notification', { ...data.notification, timestamp: Date.now() });
        }
      }
    });

    // =========================================================================
    // VOICE/VIDEO CALLS
    // =========================================================================

    socket.on('call:initiate', (data: {
      callId: string;
      type: 'voice' | 'video';
      targetId: string;
      channelId?: string;
      communityId?: string;
    }) => {
      if (!socket.authenticated || !socket.publicId) return;

      const targetUser = onlineUsers.get(data.targetId);
      if (!targetUser) {
        socket.emit('call:error', { code: 'USER_OFFLINE', message: 'Target user is not online' });
        return;
      }

      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('call:incoming', {
          callId: data.callId,
          type: data.type,
          callerId: socket.publicId,
          channelId: data.channelId,
          communityId: data.communityId,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('call:accept', (data: { callId: string; initiatorId: string }) => {
      if (!socket.authenticated || !socket.publicId) return;
      const initiatorUser = onlineUsers.get(data.initiatorId);
      if (initiatorUser) {
        const initiatorSocket = io.sockets.sockets.get(initiatorUser.socketId);
        if (initiatorSocket) {
          initiatorSocket.emit('call:accepted', { callId: data.callId, accepterId: socket.publicId });
        }
      }
    });

    socket.on('call:reject', (data: { callId: string; initiatorId: string; reason?: string }) => {
      if (!socket.authenticated || !socket.publicId) return;
      const initiatorUser = onlineUsers.get(data.initiatorId);
      if (initiatorUser) {
        const initiatorSocket = io.sockets.sockets.get(initiatorUser.socketId);
        if (initiatorSocket) {
          initiatorSocket.emit('call:rejected', { callId: data.callId, rejecterId: socket.publicId, reason: data.reason });
        }
      }
    });

    socket.on('call:end', (data: { callId: string; reason: string; channelId?: string; targetId?: string }) => {
      if (!socket.authenticated || !socket.publicId) return;

      // H-5: Scope to the specific call room instead of broadcasting to ALL sockets
      if (data.channelId) {
        // Voice channel call — emit to the voice room
        const roomId = `voice:${data.channelId}`;
        io.to(roomId).emit('call:ended', { callId: data.callId, enderId: socket.publicId, reason: data.reason });
      } else if (data.targetId) {
        // 1:1 call — emit only to the other participant
        const targetUser = onlineUsers.get(data.targetId);
        if (targetUser) {
          const targetSocket = io.sockets.sockets.get(targetUser.socketId);
          if (targetSocket) {
            targetSocket.emit('call:ended', { callId: data.callId, enderId: socket.publicId, reason: data.reason });
          }
        }
      }
      // Also notify the sender for cleanup
      socket.emit('call:ended', { callId: data.callId, enderId: socket.publicId, reason: data.reason });
    });

    socket.on('call:media-toggle', (data: {
      callId: string;
      peerId: string;
      mediaType: 'audio' | 'video' | 'screen';
      enabled: boolean;
      channelId?: string;
      targetId?: string;
    }) => {
      if (!socket.authenticated || !socket.publicId) return;

      // H-5: Scope to the specific call room instead of broadcasting to ALL sockets
      if (data.channelId) {
        const roomId = `voice:${data.channelId}`;
        io.to(roomId).emit('call:media-toggle', data);
      } else if (data.targetId) {
        const targetUser = onlineUsers.get(data.targetId);
        if (targetUser) {
          const targetSocket = io.sockets.sockets.get(targetUser.socketId);
          if (targetSocket) {
            targetSocket.emit('call:media-toggle', data);
          }
        }
      }
    });

    socket.on('call:join-voice-channel', async (data: { channelId: string }) => {
      if (!socket.authenticated || !socket.publicId) return;

      // H-4: Verify community membership before allowing voice channel join
      try {
        const channel = await prisma.channel.findUnique({
          where: { id: data.channelId },
          select: { communityId: true },
        });
        if (!channel) {
          socket.emit('error', { code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
          return;
        }

        const user = await prisma.user.findUnique({
          where: { publicId: socket.publicId },
          select: { id: true },
        });
        if (!user) {
          socket.emit('error', { code: 'USER_NOT_FOUND', message: 'User not found' });
          return;
        }

        const membership = await prisma.membership.findUnique({
          where: { userId_communityId: { userId: user.id, communityId: channel.communityId } },
        });
        if (!membership) {
          socket.emit('error', { code: 'NOT_MEMBER', message: 'You must be a community member to join this voice channel' });
          return;
        }
      } catch (err) {
        console.error('[Socket Server] call:join-voice-channel membership check error:', err);
        socket.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to verify membership' });
        return;
      }

      const roomId = `voice:${data.channelId}`;
      socket.join(roomId);

      io.to(roomId).emit('call:participant-joined', {
        callId: `voice-channel-${data.channelId}`,
        participant: {
          peerId: socket.publicId,
          joinedAt: Date.now(),
          mediaState: { audioEnabled: true, videoEnabled: false, screenSharing: false, audioMuted: false },
          audioLevel: 0,
          speaking: false,
          connectionQuality: { quality: 'good', packetLoss: 0, latency: 0, jitter: 0, bandwidth: 0 },
        },
      });
    });

    socket.on('call:leave-voice-channel', (data: { channelId: string }) => {
      if (!socket.authenticated || !socket.publicId) return;
      const roomId = `voice:${data.channelId}`;
      io.to(roomId).emit('call:participant-left', {
        callId: `voice-channel-${data.channelId}`,
        peerId: socket.publicId,
      });
      socket.leave(roomId);
    });

    // =========================================================================
    // HEARTBEAT
    // =========================================================================

    socket.on('ping', () => {
      socket.emit('pong');
      if (socket.publicId) {
        const user = onlineUsers.get(socket.publicId);
        if (user) user.lastSeen = Date.now();
      }
    });

    // =========================================================================
    // DISCONNECT
    // =========================================================================

    socket.on('disconnect', (reason) => {
      const publicId = socketToUser.get(socket.id);
      if (publicId) {
        onlineUsers.delete(publicId);
        socketToUser.delete(socket.id);

        typingUsers.forEach((users, roomId) => {
          if (users.has(publicId)) {
            users.delete(publicId);
            io.to(roomId).emit('typing:update', { publicId, isTyping: false });
          }
        });

        io.emit('user:offline', publicId);
        broadcastOnlineUsers(io);
      }
    });

    socket.on('error', (error) => {
      console.error(`[Socket Server] Socket error for ${socket.id}:`, error);
    });
  });

  // ===========================================================================
  // CLEANUP INTERVALS
  // ===========================================================================

  setInterval(() => {
    const now = Date.now();
    rateLimits.forEach((entry, id) => {
      if (now - entry.windowStart > RATE_LIMIT.windowMs * 2) rateLimits.delete(id);
    });
  }, RATE_LIMIT.windowMs);

  setInterval(() => {
    typingUsers.forEach((users, roomId) => {
      if (users.size === 0) typingUsers.delete(roomId);
    });
  }, 60000);

  setInterval(() => {
    const now = Date.now();
    offlineBuffer.forEach((buffer, publicId) => {
      const valid = buffer.filter(m => m.expiresAt > now);
      if (valid.length === 0) offlineBuffer.delete(publicId);
      else offlineBuffer.set(publicId, valid);
    });
  }, 5 * 60 * 1000);

  // CRIT-8: Cleanup expired auth nonces
  setInterval(() => {
    const now = Date.now();
    usedNonces.forEach((expiresAt, nonce) => {
      if (expiresAt < now) usedNonces.delete(nonce);
    });
  }, 60 * 1000);

  return io;
}
