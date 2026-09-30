/**
 * FriendWatch - Real-Time Web-Based Watch Party Server
 * Built with Node.js, Express, Socket.io, PeerJS Server, and JWT Authentication.
 * 
 * Features:
 * - Persistent User Registration & Login with bcrypt and JWT
 * - Room Management with strictly enforced 6-participant limit
 * - Role-Based Access Control: Room Host vs Audience permissions
 * - WebRTC & PeerJS integrated signaling mesh
 * - Screen Share state coordination (Host-exclusive)
 * - Real-time chat & system event announcements
 */

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { ExpressPeerServer } from 'peer';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const PEER_PORT = process.env.PEER_PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'friendwatch_ultra_secure_jwt_secret_2026';
const MAX_PARTICIPANTS_PER_ROOM = 6;

// Ensure persistent storage directory exists
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]), 'utf-8');
}

/**
 * Helper to read persistent users list
 */
function readUsers() {
  try {
    const content = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('Error reading users file:', err);
    return [];
  }
}

/**
 * Helper to write persistent users list
 */
function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing users file:', err);
  }
}

// Initialize Express App and HTTP Server
const app = express();
const server = http.createServer(app);

// CORS configuration for REST API and WebSockets
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Initialize Socket.io Server with WebSocket fallback
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 30000,
  pingInterval: 10000
});

// Mount integrated PeerJS Server
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});
app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
  console.log(`[PeerJS] Client connected with Peer ID: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`[PeerJS] Client disconnected with Peer ID: ${client.getId()}`);
});

// -------------------------------------------------------------
// IN-MEMORY ACTIVE ROOM STATE
// -------------------------------------------------------------
// Structure:
// rooms[roomId] = {
//   roomId: string,
//   roomName: string,
//   hostId: string (userId),
//   hostSocketId: string,
//   isScreenSharing: boolean,
//   screenSharingPeerId: string | null,
//   participants: Map<socketId, { socketId, userId, username, peerId, isHost, isMuted, isCameraOff }>
//   createdAt: string
// }
const rooms = new Map();

/**
 * Authentication Middleware for REST Endpoints
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// -------------------------------------------------------------
// AUTHENTICATION REST API ROUTES
// -------------------------------------------------------------

/**
 * POST /api/auth/register
 * Body: { username, email, password }
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const users = readUsers();
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.trim();

    const existingUser = users.find(
      u => u.email.toLowerCase() === normalizedEmail || u.username.toLowerCase() === normalizedUsername.toLowerCase()
    );

    if (existingUser) {
      return res.status(409).json({ error: 'User with that email or username already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'Registration successful',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        createdAt: newUser.createdAt
      },
      token
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
});

/**
 * POST /api/auth/login
 * Body: { emailOrUsername, password }
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Email/Username and password are required' });
    }

    const users = readUsers();
    const target = emailOrUsername.toLowerCase().trim();

    const user = users.find(
      u => u.email.toLowerCase() === target || u.username.toLowerCase() === target
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

/**
 * GET /api/auth/me
 * Validate current user session
 */
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt
    }
  });
});

/**
 * GET /api/rooms/:roomId
 * Check room status and current participant count
 */
app.get('/api/rooms/:roomId', authenticateToken, (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);

  if (!room) {
    return res.status(404).json({ error: 'Room does not exist' });
  }

  const participantCount = room.participants.size;
  return res.json({
    roomId: room.roomId,
    roomName: room.roomName,
    participantCount,
    maxParticipants: MAX_PARTICIPANTS_PER_ROOM,
    isFull: participantCount >= MAX_PARTICIPANTS_PER_ROOM,
    hostUsername: room.hostUsername,
    isScreenSharing: room.isScreenSharing
  });
});

// -------------------------------------------------------------
// SOCKET.IO REAL-TIME SIGNALING & ROOM MANAGEMENT
// -------------------------------------------------------------

// Authenticate socket connections using JWT token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.token;
  if (!token) {
    return next(new Error('Authentication error: Missing token'));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
    socket.user = decoded; // { id, username, email }
    next();
  });
});

io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.user.username} (${socket.id})`);

  let currentRoomId = null;

  /**
   * Event: create-room
   * Payload: { roomName }
   * Creates a new watch party room with the user as Host
   */
  socket.on('create-room', ({ roomName }, callback) => {
    try {
      // Generate clean 6-character room code (e.g., 'FW-7X9A')
      const code = 'FW-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const roomId = code;

      const newRoom = {
        roomId,
        roomName: roomName || `${socket.user.username}'s Watch Party`,
        hostId: socket.user.id,
        hostUsername: socket.user.username,
        hostSocketId: socket.id,
        isScreenSharing: false,
        screenSharingPeerId: null,
        participants: new Map(),
        createdAt: new Date().toISOString()
      };

      rooms.set(roomId, newRoom);
      console.log(`[Room Created] Room ID: ${roomId} by Host: ${socket.user.username}`);

      if (typeof callback === 'function') {
        callback({ success: true, roomId, roomName: newRoom.roomName });
      }
    } catch (err) {
      console.error('Error creating room:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Failed to create room' });
      }
    }
  });

  /**
   * Event: join-room
   * Payload: { roomId, peerId }
   * Enforces strict 6-participant limit and registers peer
   */
  socket.on('join-room', ({ roomId, peerId }, callback) => {
    try {
      const room = rooms.get(roomId);

      if (!room) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: 'Room does not exist' });
        }
        return socket.emit('error', { message: 'Room does not exist' });
      }

      // Check max participants constraint
      if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM && !room.participants.has(socket.id)) {
        console.warn(`[Room Full] User ${socket.user.username} rejected from room ${roomId} (Max ${MAX_PARTICIPANTS_PER_ROOM})`);
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: `Room is at maximum capacity (${MAX_PARTICIPANTS_PER_ROOM} participants allowed)`
          });
        }
        return socket.emit('error', { message: 'Room is full' });
      }

      currentRoomId = roomId;
      socket.join(roomId);

      const isHost = (room.hostId === socket.user.id);
      if (isHost) {
        room.hostSocketId = socket.id;
      }

      const participantInfo = {
        socketId: socket.id,
        userId: socket.user.id,
        username: socket.user.username,
        peerId: peerId || null,
        isHost,
        isMuted: false,
        isCameraOff: false,
        joinedAt: new Date().toISOString()
      };

      room.participants.set(socket.id, participantInfo);

      console.log(`[User Joined] ${socket.user.username} (${isHost ? 'HOST' : 'AUDIENCE'}) joined ${roomId} with PeerID: ${peerId}`);

      // Send initial room state to joining participant
      const existingParticipants = Array.from(room.participants.values());
      
      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          roomName: room.roomName,
          isHost,
          isScreenSharing: room.isScreenSharing,
          screenSharingPeerId: room.screenSharingPeerId,
          participants: existingParticipants
        });
      }

      // Broadcast to other room members that a new participant joined
      socket.to(roomId).emit('user-joined', {
        participant: participantInfo,
        participantsCount: room.participants.size
      });

      // System chat announcement
      io.to(roomId).emit('chat-message', {
        id: 'sys_' + Date.now(),
        isSystem: true,
        text: `${socket.user.username} joined the party.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      // If room is already actively sharing screen, let the new user know
      if (room.isScreenSharing && room.screenSharingPeerId) {
        socket.emit('screen-share-active', {
          hostUsername: room.hostUsername,
          peerId: room.screenSharingPeerId
        });
      }

    } catch (err) {
      console.error('Error joining room:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Could not join room' });
      }
    }
  });

  /**
   * Event: update-peer-id
   * Update or sync PeerJS ID once generated on client
   */
  socket.on('update-peer-id', ({ peerId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.peerId = peerId;
      socket.to(currentRoomId).emit('peer-id-updated', {
        socketId: socket.id,
        peerId
      });
    }
  });

  /**
   * Event: start-screen-share
   * Strict Access Control: Only Room Host can trigger screen share
   */
  socket.on('start-screen-share', ({ screenPeerId }, callback) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    // Verify host permission
    if (room.hostId !== socket.user.id) {
      console.warn(`[Permission Denied] Non-host ${socket.user.username} attempted to start screen share`);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Permission Denied: Only Room Host can share screen.' });
      }
      return;
    }

    room.isScreenSharing = true;
    room.screenSharingPeerId = screenPeerId;

    console.log(`[Screen Share Started] Host ${socket.user.username} in room ${currentRoomId} (Peer: ${screenPeerId})`);

    // Broadcast to room that screen sharing is now live
    socket.to(currentRoomId).emit('screen-share-active', {
      hostUsername: socket.user.username,
      peerId: screenPeerId
    });

    // System announcement
    io.to(currentRoomId).emit('chat-message', {
      id: 'sys_' + Date.now(),
      isSystem: true,
      text: `Host ${socket.user.username} started sharing their screen. Grab your popcorn!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  /**
   * Event: stop-screen-share
   * Host stops sharing screen
   */
  socket.on('stop-screen-share', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (room.hostId !== socket.user.id) return;

    room.isScreenSharing = false;
    room.screenSharingPeerId = null;

    console.log(`[Screen Share Stopped] Host ${socket.user.username} stopped sharing in ${currentRoomId}`);

    io.to(currentRoomId).emit('screen-share-stopped');

    io.to(currentRoomId).emit('chat-message', {
      id: 'sys_' + Date.now(),
      isSystem: true,
      text: `Screen sharing has ended.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  /**
   * Event: media-status-change
   * Broadcast microphone mute/unmute or video on/off toggle
   */
  socket.on('media-status-change', ({ isMuted, isCameraOff }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (participant) {
      if (typeof isMuted === 'boolean') participant.isMuted = isMuted;
      if (typeof isCameraOff === 'boolean') participant.isCameraOff = isCameraOff;

      socket.to(currentRoomId).emit('participant-media-status', {
        socketId: socket.id,
        isMuted: participant.isMuted,
        isCameraOff: participant.isCameraOff
      });
    }
  });

  /**
   * Event: send-chat-message
   * Real-time text chat message broadcast
   */
  socket.on('send-chat-message', ({ text }) => {
    if (!currentRoomId || !text || !text.trim()) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const message = {
      id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 6),
      userId: socket.user.id,
      username: socket.user.username,
      isHost: room.hostId === socket.user.id,
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.to(currentRoomId).emit('chat-message', message);
  });

  /**
   * Handle Disconnect and Cleanup
   */
  socket.on('disconnect', () => {
    console.log(`[Socket] User disconnected: ${socket.user?.username} (${socket.id})`);

    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const leavingParticipant = room.participants.get(socket.id);
        room.participants.delete(socket.id);

        if (leavingParticipant) {
          // Notify other participants of user departure
          socket.to(currentRoomId).emit('user-left', {
            socketId: socket.id,
            peerId: leavingParticipant.peerId,
            username: leavingParticipant.username,
            remainingCount: room.participants.size
          });

          io.to(currentRoomId).emit('chat-message', {
            id: 'sys_' + Date.now(),
            isSystem: true,
            text: `${leavingParticipant.username} left the party.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }

        // If host left, stop screen sharing and optionally elect new host or close room
        if (room.hostSocketId === socket.id) {
          if (room.isScreenSharing) {
            room.isScreenSharing = false;
            room.screenSharingPeerId = null;
            io.to(currentRoomId).emit('screen-share-stopped');
          }

          if (room.participants.size > 0) {
            // Elect the first remaining participant as the new host
            const [newHostSocketId, newHostInfo] = room.participants.entries().next().value;
            room.hostId = newHostInfo.userId;
            room.hostUsername = newHostInfo.username;
            room.hostSocketId = newHostSocketId;
            newHostInfo.isHost = true;

            io.to(currentRoomId).emit('host-changed', {
              newHostSocketId,
              newHostUserId: newHostInfo.userId,
              newHostUsername: newHostInfo.username
            });

            io.to(currentRoomId).emit('chat-message', {
              id: 'sys_' + Date.now(),
              isSystem: true,
              text: `${newHostInfo.username} is now the Host of the room.`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
          } else {
            // Empty room cleanup
            rooms.delete(currentRoomId);
            console.log(`[Room Destroyed] Room ${currentRoomId} is now empty and cleaned up.`);
          }
        } else if (room.participants.size === 0) {
          rooms.delete(currentRoomId);
          console.log(`[Room Destroyed] Room ${currentRoomId} is now empty and cleaned up.`);
        }
      }
    }
  });
});

// Basic Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeRooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

// Serve frontend production build if available
const clientBuildPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 FriendWatch Server running on http://localhost:${PORT}`);
  console.log(`📡 PeerJS signaling server mounted at /peerjs`);
  console.log(`👥 Max participants per room: ${MAX_PARTICIPANTS_PER_ROOM}`);
  console.log(`=======================================================`);
});
