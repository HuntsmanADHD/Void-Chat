/**
 * Socket.io Server for Void Chat
 * Handles real-time communication, WebRTC signaling, and message relay
 *
 * Features:
 * - Wallet-based authentication
 * - Room management (channels and DMs)
 * - P2P signal relay for WebRTC
 * - Encrypted message relay (never decrypted server-side)
 * - Online status broadcasting
 * - Typing indicators
 * - Rate limiting per wallet
 *
 * Run separately: npx ts-node server/socket-server.ts
 * Or integrate with custom Next.js server
 */

import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verify } from '@noble/ed25519';
import bs58 from 'bs58';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Configuration
 */
const PORT = process.env['SOCKET_PORT'] ? parseInt(process.env['SOCKET_PORT']) : 3001;
const CORS_ORIGIN = process.env['CORS_ORIGIN'] || 'http://localhost:3000';

/**
 * Rate limiting configuration
 */
const RATE_LIMIT = {
  windowMs: 60000, // 1 minute window
  maxMessages: 60, // Max 60 messages per minute
  maxSignals: 100, // Max 100 signals per minute (for WebRTC)
};

/**
 * Types
 */
interface P2PSignal {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidate;
}

interface AuthenticatedSocket extends Socket {
  walletAddress?: string;
  authenticated?: boolean;
}

interface RateLimitEntry {
  messages: number;
  signals: number;
  windowStart: number;
}

interface OnlineUser {
  walletAddress: string;
  socketId: string;
  connectedAt: number;
  lastSeen: number;
}

/**
 * In-memory stores
 * In production, consider using Redis for scalability
 */
const onlineUsers: Map<string, OnlineUser> = new Map();
const socketToWallet: Map<string, string> = new Map();
const rateLimits: Map<string, RateLimitEntry> = new Map();
const typingUsers: Map<string, Set<string>> = new Map(); // roomId -> Set<walletAddress>

/**
 * Create HTTP server and Socket.io instance
 */
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/**
 * Generate unique message ID
 */
function generateMessageId(): string {
  const timestamp = Date.now();
  const randomPart = randomBytes(8).toString('hex');
  return `msg-${timestamp}-${randomPart}`;
}

/**
 * Get or create DM room ID (deterministic based on both wallets)
 */
function getDMRoomId(wallet1: string, wallet2: string): string {
  // Sort wallets to ensure consistent room ID regardless of who initiates
  const sorted = [wallet1, wallet2].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

/**
 * Get channel room ID
 */
function getChannelRoomId(channelId: string): string {
  return `channel:${channelId}`;
}

/**
 * Check and update rate limit
 */
function checkRateLimit(walletAddress: string, type: 'message' | 'signal'): boolean {
  const now = Date.now();
  let entry = rateLimits.get(walletAddress);

  if (!entry || now - entry.windowStart > RATE_LIMIT.windowMs) {
    // Reset window
    entry = {
      messages: 0,
      signals: 0,
      windowStart: now,
    };
    rateLimits.set(walletAddress, entry);
  }

  if (type === 'message') {
    if (entry.messages >= RATE_LIMIT.maxMessages) {
      return false;
    }
    entry.messages++;
  } else {
    if (entry.signals >= RATE_LIMIT.maxSignals) {
      return false;
    }
    entry.signals++;
  }

  return true;
}

/**
 * Verify wallet signature for authentication
 * Note: This is a simplified version. In production, use proper Solana message verification
 */
async function verifyWalletSignature(
  walletAddress: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    const publicKeyBytes = bs58.decode(walletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);

    // Verify using ed25519
    const isValid = await verify(signatureBytes, messageBytes, publicKeyBytes);
    return isValid;
  } catch (error) {
    console.error('[Socket Server] Signature verification failed:', error);
    return false;
  }
}

/**
 * Broadcast online users list to all connected clients
 */
function broadcastOnlineUsers(): void {
  const walletAddresses = Array.from(onlineUsers.keys());
  io.emit('users:online', walletAddresses);
}

/**
 * Handle socket connection
 */
io.on('connection', (socket: AuthenticatedSocket) => {
  console.log(`[Socket Server] Client connected: ${socket.id}`);

  /**
   * Authentication handler
   */
  socket.on('authenticate', async (data: { walletAddress: string; signature: string; message: string }) => {
    try {
      const { walletAddress, signature, message } = data;

      // Validate inputs
      if (!walletAddress || !signature || !message) {
        socket.emit('authenticated', { success: false, error: 'Missing authentication data' });
        return;
      }

      // Validate message timestamp to prevent replay attacks
      const timestampMatch = message.match(/timestamp:\s*(\d+)/i);
      if (timestampMatch) {
        const messageTimestamp = parseInt(timestampMatch[1]);
        const currentTime = Date.now();
        const timeDiff = Math.abs(currentTime - messageTimestamp);
        const MAX_TIME_DIFF = 5 * 60 * 1000;

        if (timeDiff > MAX_TIME_DIFF) {
          socket.emit('authenticated', { success: false, error: 'Authentication message expired' });
          return;
        }
      }

      // Verify signature
      const isValid = await verifyWalletSignature(walletAddress, signature, message);

      if (!isValid) {
        socket.emit('authenticated', { success: false, error: 'Invalid signature' });
        return;
      }

      // Check if wallet is blacklisted
      const user = await prisma.user.findUnique({
        where: { walletAddress },
        select: { isBlacklisted: true }
      });

      if (user?.isBlacklisted) {
        socket.emit('authenticated', { success: false, error: 'Account suspended' });
        socket.disconnect(true);
        return;
      }

      // Check if wallet is already connected (disconnect old connection)
      const existingUser = onlineUsers.get(walletAddress);
      if (existingUser && existingUser.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingUser.socketId);
        if (oldSocket) {
          oldSocket.emit('error', { code: 'DUPLICATE_SESSION', message: 'Connected from another location' });
          oldSocket.disconnect(true);
        }
      }

      // Store authentication
      socket.walletAddress = walletAddress;
      socket.authenticated = true;
      socketToWallet.set(socket.id, walletAddress);

      // Add to online users
      onlineUsers.set(walletAddress, {
        walletAddress,
        socketId: socket.id,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      });

      // Notify success
      socket.emit('authenticated', { success: true });

      // Broadcast user online
      socket.broadcast.emit('user:online', walletAddress);
      broadcastOnlineUsers();

      console.log(`[Socket Server] User authenticated: ${walletAddress}`);
    } catch (error) {
      console.error('[Socket Server] Authentication error:', error);
      socket.emit('authenticated', { success: false, error: 'Authentication failed' });
    }
  });

  /**
   * Join channel room
   */
  socket.on('join:channel', (channelId: string) => {
    if (!socket.authenticated) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    const roomId = getChannelRoomId(channelId);
    socket.join(roomId);
    console.log(`[Socket Server] ${socket.walletAddress} joined channel: ${channelId}`);
  });

  /**
   * Leave channel room
   */
  socket.on('leave:channel', (channelId: string) => {
    const roomId = getChannelRoomId(channelId);
    socket.leave(roomId);

    // Remove from typing users
    const typing = typingUsers.get(roomId);
    if (typing && socket.walletAddress) {
      typing.delete(socket.walletAddress);
    }
  });

  /**
   * Join DM room
   */
  socket.on('join:dm', (recipientWallet: string) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    const roomId = getDMRoomId(socket.walletAddress, recipientWallet);
    socket.join(roomId);
    console.log(`[Socket Server] ${socket.walletAddress} joined DM with: ${recipientWallet}`);
  });

  /**
   * Leave DM room
   */
  socket.on('leave:dm', (recipientWallet: string) => {
    if (!socket.walletAddress) return;

    const roomId = getDMRoomId(socket.walletAddress, recipientWallet);
    socket.leave(roomId);

    // Remove from typing users
    const typing = typingUsers.get(roomId);
    if (typing) {
      typing.delete(socket.walletAddress);
    }
  });

  /**
   * Handle channel message (relay encrypted, never decrypt)
   */
  socket.on('message:channel', (data: {
    channelId: string;
    encrypted: string;
    nonce: string;
    senderId: string;
  }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(socket.walletAddress, 'message')) {
      socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
      return;
    }

    // Verify sender matches authenticated user
    if (data.senderId !== socket.walletAddress) {
      socket.emit('error', { code: 'INVALID_SENDER', message: 'Sender mismatch' });
      return;
    }

    const roomId = getChannelRoomId(data.channelId);
    const message = {
      id: generateMessageId(),
      channelId: data.channelId,
      encrypted: data.encrypted,
      nonce: data.nonce,
      senderId: data.senderId,
      timestamp: Date.now(),
    };

    // Broadcast to channel (including sender for confirmation)
    io.to(roomId).emit('message:channel', message);

    // Update last seen
    const user = onlineUsers.get(socket.walletAddress);
    if (user) {
      user.lastSeen = Date.now();
    }
  });

  /**
   * Handle DM message (relay encrypted, never decrypt)
   */
  socket.on('message:dm', (data: {
    recipientWallet: string;
    encrypted: string;
    nonce: string;
    senderId: string;
  }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(socket.walletAddress, 'message')) {
      socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
      return;
    }

    // Verify sender matches authenticated user
    if (data.senderId !== socket.walletAddress) {
      socket.emit('error', { code: 'INVALID_SENDER', message: 'Sender mismatch' });
      return;
    }

    const roomId = getDMRoomId(socket.walletAddress, data.recipientWallet);
    const message = {
      id: generateMessageId(),
      encrypted: data.encrypted,
      nonce: data.nonce,
      senderId: data.senderId,
      timestamp: Date.now(),
    };

    // Send to DM room
    io.to(roomId).emit('message:dm', message);

    // Update last seen
    const user = onlineUsers.get(socket.walletAddress);
    if (user) {
      user.lastSeen = Date.now();
    }
  });

  /**
   * P2P Signal: Offer
   */
  socket.on('signal:offer', (data: { targetWallet: string; signal: P2PSignal }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(socket.walletAddress, 'signal')) {
      socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
      return;
    }

    const targetUser = onlineUsers.get(data.targetWallet);
    if (!targetUser) {
      socket.emit('error', { code: 'USER_OFFLINE', message: 'Target user is not online' });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetUser.socketId);
    if (targetSocket) {
      targetSocket.emit('signal:offer', {
        fromWallet: socket.walletAddress,
        signal: data.signal,
      });
    }
  });

  /**
   * P2P Signal: Answer
   */
  socket.on('signal:answer', (data: { targetWallet: string; signal: P2PSignal }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(socket.walletAddress, 'signal')) {
      socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
      return;
    }

    const targetUser = onlineUsers.get(data.targetWallet);
    if (!targetUser) {
      socket.emit('error', { code: 'USER_OFFLINE', message: 'Target user is not online' });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetUser.socketId);
    if (targetSocket) {
      targetSocket.emit('signal:answer', {
        fromWallet: socket.walletAddress,
        signal: data.signal,
      });
    }
  });

  /**
   * P2P Signal: ICE Candidate
   */
  socket.on('signal:ice', (data: { targetWallet: string; candidate: RTCIceCandidate }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(socket.walletAddress, 'signal')) {
      socket.emit('rate-limited', { retryAfter: RATE_LIMIT.windowMs });
      return;
    }

    const targetUser = onlineUsers.get(data.targetWallet);
    if (!targetUser) {
      return; // Silently ignore if target is offline (ICE can fail gracefully)
    }

    const targetSocket = io.sockets.sockets.get(targetUser.socketId);
    if (targetSocket) {
      targetSocket.emit('signal:ice', {
        fromWallet: socket.walletAddress,
        candidate: data.candidate,
      });
    }
  });

  /**
   * Typing: Start
   */
  socket.on('typing:start', (data: { channelId?: string; dmWallet?: string }) => {
    if (!socket.authenticated || !socket.walletAddress) return;

    let roomId: string;
    if (data.channelId) {
      roomId = getChannelRoomId(data.channelId);
    } else if (data.dmWallet) {
      roomId = getDMRoomId(socket.walletAddress, data.dmWallet);
    } else {
      return;
    }

    // Add to typing users
    if (!typingUsers.has(roomId)) {
      typingUsers.set(roomId, new Set());
    }
    typingUsers.get(roomId)!.add(socket.walletAddress);

    // Broadcast to room
    socket.to(roomId).emit('typing:update', {
      channelId: data.channelId,
      dmWallet: data.dmWallet,
      walletAddress: socket.walletAddress,
      isTyping: true,
    });
  });

  /**
   * Reaction: Add/Remove
   * Broadcasts reaction changes to room members
   */
  socket.on('reaction', (data: {
    messageId: string;
    channelId?: string;
    dmWallet?: string;
    emoji: string;
    action: 'add' | 'remove';
  }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    let roomId: string;
    if (data.channelId) {
      roomId = getChannelRoomId(data.channelId);
    } else if (data.dmWallet) {
      roomId = getDMRoomId(socket.walletAddress, data.dmWallet);
    } else {
      return;
    }

    // Broadcast reaction to room (including sender for confirmation)
    io.to(roomId).emit('reaction', {
      messageId: data.messageId,
      emoji: data.emoji,
      action: data.action,
      userWallet: socket.walletAddress,
      timestamp: Date.now(),
    });
  });

  /**
   * Notification: Send to specific user
   * Used by the server to push notifications to connected clients
   */
  socket.on('notification:send', (data: {
    targetWallet: string;
    notification: {
      id: string;
      type: string;
      title: string;
      body?: string;
      messageId?: string;
      channelId?: string;
      communityId?: string;
      senderWallet?: string;
      senderXHandle?: string;
    };
  }) => {
    // This event is typically emitted from server-side code
    // Find the target user's socket and send them the notification
    const targetUser = onlineUsers.get(data.targetWallet);
    if (targetUser) {
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('notification', {
          ...data.notification,
          timestamp: Date.now(),
        });
      }
    }
  });

  /**
   * Typing: Stop
   */
  socket.on('typing:stop', (data: { channelId?: string; dmWallet?: string }) => {
    if (!socket.authenticated || !socket.walletAddress) return;

    let roomId: string;
    if (data.channelId) {
      roomId = getChannelRoomId(data.channelId);
    } else if (data.dmWallet) {
      roomId = getDMRoomId(socket.walletAddress, data.dmWallet);
    } else {
      return;
    }

    // Remove from typing users
    const typing = typingUsers.get(roomId);
    if (typing) {
      typing.delete(socket.walletAddress);
    }

    // Broadcast to room
    socket.to(roomId).emit('typing:update', {
      channelId: data.channelId,
      dmWallet: data.dmWallet,
      walletAddress: socket.walletAddress,
      isTyping: false,
    });
  });

  /**
   * Heartbeat: Ping
   */
  socket.on('ping', () => {
    socket.emit('pong');

    // Update last seen
    if (socket.walletAddress) {
      const user = onlineUsers.get(socket.walletAddress);
      if (user) {
        user.lastSeen = Date.now();
      }
    }
  });

  /**
   * Handle disconnection
   */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket Server] Client disconnected: ${socket.id}, reason: ${reason}`);

    const walletAddress = socketToWallet.get(socket.id);
    if (walletAddress) {
      // Remove from online users
      onlineUsers.delete(walletAddress);
      socketToWallet.delete(socket.id);

      // Remove from all typing sets
      typingUsers.forEach((users, roomId) => {
        if (users.has(walletAddress)) {
          users.delete(walletAddress);
          // Broadcast typing stop
          io.to(roomId).emit('typing:update', {
            walletAddress,
            isTyping: false,
          });
        }
      });

      // Broadcast user offline
      io.emit('user:offline', walletAddress);
      broadcastOnlineUsers();

      console.log(`[Socket Server] User disconnected: ${walletAddress}`);
    }
  });

  // ===========================================================================
  // VOICE/VIDEO CALL EVENTS
  // ===========================================================================

  /**
   * Call: Initiate a call
   */
  socket.on('call:initiate', (data: {
    callId: string;
    type: 'voice' | 'video';
    targetWallet: string;
    channelId?: string;
    communityId?: string;
  }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('call:error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    const targetUser = onlineUsers.get(data.targetWallet);
    if (!targetUser) {
      socket.emit('call:error', { code: 'USER_OFFLINE', message: 'Target user is not online' });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetUser.socketId);
    if (targetSocket) {
      targetSocket.emit('call:incoming', {
        callId: data.callId,
        type: data.type,
        callerId: socket.walletAddress,
        channelId: data.channelId,
        communityId: data.communityId,
        timestamp: Date.now(),
      });
      console.log(`[Socket Server] Call initiated: ${socket.walletAddress} -> ${data.targetWallet}`);
    }
  });

  /**
   * Call: Accept an incoming call
   */
  socket.on('call:accept', (data: { callId: string; initiatorWallet: string }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('call:error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    const initiatorUser = onlineUsers.get(data.initiatorWallet);
    if (initiatorUser) {
      const initiatorSocket = io.sockets.sockets.get(initiatorUser.socketId);
      if (initiatorSocket) {
        initiatorSocket.emit('call:accepted', {
          callId: data.callId,
          accepterId: socket.walletAddress,
        });
        console.log(`[Socket Server] Call accepted: ${data.callId}`);
      }
    }
  });

  /**
   * Call: Reject an incoming call
   */
  socket.on('call:reject', (data: { callId: string; initiatorWallet: string; reason?: string }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('call:error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    const initiatorUser = onlineUsers.get(data.initiatorWallet);
    if (initiatorUser) {
      const initiatorSocket = io.sockets.sockets.get(initiatorUser.socketId);
      if (initiatorSocket) {
        initiatorSocket.emit('call:rejected', {
          callId: data.callId,
          rejecterId: socket.walletAddress,
          reason: data.reason,
        });
        console.log(`[Socket Server] Call rejected: ${data.callId}`);
      }
    }
  });

  /**
   * Call: End an active call
   */
  socket.on('call:end', (data: { callId: string; reason: string }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('call:error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    // Broadcast to all participants
    socket.broadcast.emit('call:ended', {
      callId: data.callId,
      enderId: socket.walletAddress,
      reason: data.reason,
    });
    console.log(`[Socket Server] Call ended: ${data.callId}`);
  });

  /**
   * Call: Toggle media (mute/unmute, camera on/off, screen share)
   */
  socket.on('call:media-toggle', (data: {
    callId: string;
    peerId: string;
    mediaType: 'audio' | 'video' | 'screen';
    enabled: boolean;
  }) => {
    if (!socket.authenticated || !socket.walletAddress) return;
    socket.broadcast.emit('call:media-toggle', data);
  });

  /**
   * Call: Join a voice channel
   */
  socket.on('call:join-voice-channel', (data: { channelId: string }) => {
    if (!socket.authenticated || !socket.walletAddress) {
      socket.emit('call:error', { code: 'NOT_AUTHENTICATED', message: 'Please authenticate first' });
      return;
    }

    const roomId = `voice:${data.channelId}`;
    socket.join(roomId);

    io.to(roomId).emit('call:participant-joined', {
      callId: `voice-channel-${data.channelId}`,
      participant: {
        peerId: socket.walletAddress,
        joinedAt: Date.now(),
        mediaState: { audioEnabled: true, videoEnabled: false, screenSharing: false, audioMuted: false },
        audioLevel: 0,
        speaking: false,
        connectionQuality: { quality: 'good', packetLoss: 0, latency: 0, jitter: 0, bandwidth: 0 },
      },
    });
    console.log(`[Socket Server] User ${socket.walletAddress} joined voice channel ${data.channelId}`);
  });

  /**
   * Call: Leave a voice channel
   */
  socket.on('call:leave-voice-channel', (data: { channelId: string }) => {
    if (!socket.authenticated || !socket.walletAddress) return;

    const roomId = `voice:${data.channelId}`;

    io.to(roomId).emit('call:participant-left', {
      callId: `voice-channel-${data.channelId}`,
      peerId: socket.walletAddress,
    });

    socket.leave(roomId);
    console.log(`[Socket Server] User ${socket.walletAddress} left voice channel ${data.channelId}`);
  });

  /**
   * Handle errors
   */
  socket.on('error', (error) => {
    console.error(`[Socket Server] Socket error for ${socket.id}:`, error);
  });
});

/**
 * Clean up stale rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();
  rateLimits.forEach((entry, wallet) => {
    if (now - entry.windowStart > RATE_LIMIT.windowMs * 2) {
      rateLimits.delete(wallet);
    }
  });
}, RATE_LIMIT.windowMs);

/**
 * Clean up empty typing sets periodically
 */
setInterval(() => {
  typingUsers.forEach((users, roomId) => {
    if (users.size === 0) {
      typingUsers.delete(roomId);
    }
  });
}, 60000);

/**
 * Start the server
 */
httpServer.listen(PORT, () => {
  console.log(`[Socket Server] Running on port ${PORT}`);
  console.log(`[Socket Server] CORS enabled for: ${CORS_ORIGIN}`);
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  console.log('[Socket Server] SIGTERM received, shutting down...');

  io.close(() => {
    console.log('[Socket Server] All connections closed');
    httpServer.close(() => {
      console.log('[Socket Server] HTTP server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('[Socket Server] SIGINT received, shutting down...');

  io.close(() => {
    console.log('[Socket Server] All connections closed');
    httpServer.close(() => {
      console.log('[Socket Server] HTTP server closed');
      process.exit(0);
    });
  });
});

export { io, httpServer };
