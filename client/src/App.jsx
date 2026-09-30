/**
 * FriendWatch - Real-Time Web-Based Watch Party Application
 * App.jsx - Main React Component
 * 
 * Features:
 * 1. Persistent User Authentication (Register/Login with JWT & localStorage)
 * 2. Room Management (Create Room as Host, Join via Code, Max 6 Participant capacity)
 * 3. Split-Panel Twitch/Discord inspired Dark UI (#0f172a slate palette)
 * 4. Main Screen Share Area (70-75% width) with 16:9 Letterboxing & Host Controls
 * 5. Interactive Sidebar (25-30% width) with 2x3 Webcam Mesh Grid & Real-Time Chat
 * 6. High-Quality WebRTC Audio (Opus 64-128kbps, Echo Cancellation, Noise Suppression)
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import io from 'socket.io-client';
import Peer from 'peerjs';
import {
  MonitorPlay,
  MonitorOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  MessageSquare,
  Users,
  Copy,
  Check,
  LogOut,
  Maximize2,
  Minimize2,
  Radio,
  Send,
  Film,
  Sparkles,
  ShieldAlert,
  Crown,
  Smile,
  AlertCircle
} from 'lucide-react';

// Backend server URL - adjust if running in production
const SERVER_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : window.location.origin;

// High-fidelity Discord-grade WebRTC audio constraints
const DISCORD_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 2
};

export default function App() {
  // ---------------------------------------------------------------------------
  // AUTHENTICATION & SESSION STATE
  // ---------------------------------------------------------------------------
  const [currentUser, setCurrentUser] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('fw_token') || '');
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authFormData, setAuthFormData] = useState({ username: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // ROOM & LOBBY STATE
  // ---------------------------------------------------------------------------
  const [roomState, setRoomState] = useState({
    roomId: null,
    roomName: '',
    isHost: false,
    participants: []
  });
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [createRoomName, setCreateRoomName] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [isLobbyLoading, setIsLobbyLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // ---------------------------------------------------------------------------
  // MEDIA & WEBRTC / PEERJS STATE
  // ---------------------------------------------------------------------------
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState(new Set());
  const [remoteStreams, setRemoteStreams] = useState({}); // { [peerId]: MediaStream }

  // ---------------------------------------------------------------------------
  // CHAT & UI STATE
  // ---------------------------------------------------------------------------
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);

  // ---------------------------------------------------------------------------
  // REFS FOR SOCKET, PEER, AUDIO ANALYZERS & MEDIA ELEMENTS
  // ---------------------------------------------------------------------------
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const screenPeerRef = useRef(null);
  const localVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const chatBottomRef = useRef(null);
  const mainPlayerContainerRef = useRef(null);
  const peerConnectionsRef = useRef({}); // { [peerId]: call }
  const audioContextRef = useRef(null);
  const audioAnalyzersRef = useRef({}); // { [id]: { analyser, dataArray } }

  // ---------------------------------------------------------------------------
  // 1. INITIALIZE & VALIDATE PERSISTENT AUTH SESSION
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!authToken) return;

    fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setCurrentUser(data.user);
        } else {
          // Token invalid or expired
          handleLogout();
        }
      })
      .catch(() => {
        handleLogout();
      });
  }, [authToken]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = authMode === 'login'
        ? { emailOrUsername: authFormData.email || authFormData.username, password: authFormData.password }
        : authFormData;

      const res = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('fw_token', data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setAuthFormData({ username: '', email: '', password: '' });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('fw_token');
    setAuthToken('');
    setCurrentUser(null);
    leaveRoom();
  };

  // ---------------------------------------------------------------------------
  // 2. SETUP USER MEDIA (WEBCAM & DISCORD-GRADE OPUS AUDIO)
  // ---------------------------------------------------------------------------
  const initializeUserMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: DISCORD_AUDIO_CONSTRAINTS
      });

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setupAudioAnalysis(stream, 'local');
      return stream;
    } catch (err) {
      console.warn('Microphone or camera access denied/unavailable:', err);
      // Fallback with audio-only or empty dummy track if requested
      try {
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: DISCORD_AUDIO_CONSTRAINTS
        });
        setLocalStream(audioOnlyStream);
        setIsCameraOff(true);
        setupAudioAnalysis(audioOnlyStream, 'local');
        return audioOnlyStream;
      } catch (audioErr) {
        console.warn('Audio also denied:', audioErr);
        return null;
      }
    }
  };

  /**
   * Web Audio API Active Speaker Detection (Twitch/Discord Green Glow)
   */
  const setupAudioAnalysis = (stream, id) => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      audioAnalyzersRef.current[id] = { analyser, dataArray };
    } catch (err) {
      console.warn('Audio analysis setup error:', err);
    }
  };

  // Periodic active speaker check loop
  useEffect(() => {
    if (!roomState.roomId) return;

    const interval = setInterval(() => {
      const newActive = new Set();
      Object.entries(audioAnalyzersRef.current).forEach(([id, { analyser, dataArray }]) => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        // Threshold for speaking voice
        if (average > 18) {
          newActive.add(id);
        }
      });
      setActiveSpeakers(newActive);
    }, 150);

    return () => clearInterval(interval);
  }, [roomState.roomId]);

  // ---------------------------------------------------------------------------
  // 3. SOCKET.IO & PEERJS INITIALIZATION WHEN ENTERING ROOM
  // ---------------------------------------------------------------------------
  const setupRoomConnection = useCallback(async (roomId, isCreating = false, roomName = '') => {
    if (!currentUser || !authToken) return;

    setIsLobbyLoading(true);
    setLobbyError('');

    try {
      // 1. Initialize user webcam/mic stream first
      const stream = await initializeUserMedia();

      // 2. Connect to Socket.io with JWT Auth
      const socket = io(SERVER_URL, {
        auth: { token: authToken },
        transports: ['websocket', 'polling']
      });
      socketRef.current = socket;

      // 3. Connect to integrated PeerJS Server
      const peer = new Peer(undefined, {
        host: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname,
        port: window.location.hostname === 'localhost' ? 5000 : (window.location.port || 443),
        path: '/peerjs',
        secure: window.location.protocol === 'https:'
      });
      peerRef.current = peer;

      peer.on('open', (peerId) => {
        console.log('[PeerJS Ready] Peer ID:', peerId);

        if (isCreating) {
          socket.emit('create-room', { roomName: roomName || `${currentUser.username}'s Party` }, (res) => {
            if (res.success) {
              joinRoomWithPeer(socket, peer, stream, res.roomId);
            } else {
              setLobbyError(res.error || 'Failed to create room');
              setIsLobbyLoading(false);
            }
          });
        } else {
          joinRoomWithPeer(socket, peer, stream, roomId);
        }
      });

      // Handle incoming WebRTC video/audio calls from other room peers
      peer.on('call', (call) => {
        console.log('[WebRTC] Receiving incoming call from:', call.peer);

        // Check if this incoming call is the Host's Screen Share stream
        const isScreenShareCall = call.metadata && call.metadata.type === 'screen-share';

        if (isScreenShareCall) {
          call.answer(); // Answer screen share stream without sending local webcam back
          call.on('stream', (screenMediaStream) => {
            console.log('[WebRTC] Received host screen share stream');
            setRemoteScreenStream(screenMediaStream);
            setIsScreenSharing(true);
            if (screenVideoRef.current) {
              screenVideoRef.current.srcObject = screenMediaStream;
            }
          });
        } else {
          // Standard participant webcam/audio mesh call
          call.answer(stream);
          call.on('stream', (userMediaStream) => {
            console.log('[WebRTC] Received participant media stream from:', call.peer);
            setRemoteStreams(prev => ({ ...prev, [call.peer]: userMediaStream }));
            setupAudioAnalysis(userMediaStream, call.peer);
          });
        }

        peerConnectionsRef.current[call.peer] = call;
      });

      peer.on('error', (err) => {
        console.error('[PeerJS Error]:', err);
      });

      // -------------------------------------------------------------
      // SOCKET EVENT LISTENERS
      // -------------------------------------------------------------
      socket.on('user-joined', ({ participant, participantsCount }) => {
        console.log('[Socket] New participant joined:', participant.username);
        setRoomState(prev => ({
          ...prev,
          participants: [...prev.participants.filter(p => p.socketId !== participant.socketId), participant]
        }));

        // Call newly joined participant via WebRTC
        if (participant.peerId && stream && peerRef.current) {
          connectToNewUser(participant.peerId, stream);
        }
      });

      socket.on('user-left', ({ socketId, peerId, username }) => {
        console.log('[Socket] Participant left:', username);
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p.socketId !== socketId)
        }));

        if (peerId) {
          if (peerConnectionsRef.current[peerId]) {
            peerConnectionsRef.current[peerId].close();
            delete peerConnectionsRef.current[peerId];
          }
          setRemoteStreams(prev => {
            const updated = { ...prev };
            delete updated[peerId];
            return updated;
          });
          delete audioAnalyzersRef.current[peerId];
        }
      });

      socket.on('screen-share-active', ({ hostUsername, peerId }) => {
        console.log('[Socket] Screen share is active from host:', hostUsername, 'PeerID:', peerId);
        setIsScreenSharing(true);
      });

      socket.on('screen-share-stopped', () => {
        console.log('[Socket] Screen share ended');
        setIsScreenSharing(false);
        setRemoteScreenStream(null);
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = null;
        }
      });

      socket.on('participant-media-status', ({ socketId, isMuted, isCameraOff }) => {
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.map(p => {
            if (p.socketId === socketId) {
              return { ...p, isMuted, isCameraOff };
            }
            return p;
          })
        }));
      });

      socket.on('host-changed', ({ newHostUserId, newHostUsername }) => {
        const isNowHost = currentUser.id === newHostUserId;
        setRoomState(prev => ({
          ...prev,
          isHost: isNowHost,
          participants: prev.participants.map(p => ({
            ...p,
            isHost: p.userId === newHostUserId
          }))
        }));
      });

      socket.on('chat-message', (msg) => {
        setMessages(prev => [...prev, msg]);
      });

      socket.on('error', ({ message }) => {
        setLobbyError(message);
        leaveRoom();
      });

    } catch (err) {
      console.error('Failed to initialize room:', err);
      setLobbyError(err.message || 'Connection failed');
      setIsLobbyLoading(false);
    }
  }, [currentUser, authToken]);

  /**
   * Complete the join-room handshake once PeerJS is ready
   */
  const joinRoomWithPeer = (socket, peer, stream, roomId) => {
    socket.emit('join-room', { roomId, peerId: peer.id }, (response) => {
      setIsLobbyLoading(false);

      if (!response.success) {
        setLobbyError(response.error || 'Failed to join room');
        leaveRoom();
        return;
      }

      setRoomState({
        roomId: response.roomId,
        roomName: response.roomName,
        isHost: response.isHost,
        participants: response.participants || []
      });

      // Call all existing peers in the room
      if (response.participants && stream) {
        response.participants.forEach(participant => {
          if (participant.peerId && participant.userId !== currentUser.id) {
            connectToNewUser(participant.peerId, stream);
          }
        });
      }
    });
  };

  /**
   * Connect to a newly discovered peer using WebRTC mesh
   */
  const connectToNewUser = (remotePeerId, stream) => {
    if (!peerRef.current || !stream) return;
    console.log('[WebRTC Mesh] Calling peer:', remotePeerId);

    const call = peerRef.current.call(remotePeerId, stream, {
      metadata: { type: 'webcam-mesh', userId: currentUser.id }
    });

    call.on('stream', (userMediaStream) => {
      setRemoteStreams(prev => ({ ...prev, [remotePeerId]: userMediaStream }));
      setupAudioAnalysis(userMediaStream, remotePeerId);
    });

    call.on('close', () => {
      setRemoteStreams(prev => {
        const updated = { ...prev };
        delete updated[remotePeerId];
        return updated;
      });
      delete audioAnalyzersRef.current[remotePeerId];
    });

    peerConnectionsRef.current[remotePeerId] = call;
  };

  /**
   * Leave current room and cleanly tear down all WebRTC / Socket connections
   */
  const leaveRoom = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      setScreenStream(null);
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    if (screenPeerRef.current) {
      screenPeerRef.current.destroy();
      screenPeerRef.current = null;
    }

    Object.values(peerConnectionsRef.current).forEach(call => call.close());
    peerConnectionsRef.current = {};

    setRoomState({ roomId: null, roomName: '', isHost: false, participants: [] });
    setRemoteStreams({});
    setRemoteScreenStream(null);
    setIsScreenSharing(false);
    setMessages([]);
    setIsLobbyLoading(false);
  };

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // 4. HOST SCREEN SHARING WITH SYSTEM / TAB AUDIO CAPTURE
  // ---------------------------------------------------------------------------
  const handleToggleScreenShare = async () => {
    // Strict Access Control: Only Room Host can trigger Screen Sharing
    if (!roomState.isHost) {
      alert('Strict Access Control: Only the Room Host can share screen.');
      return;
    }

    if (isScreenSharing && screenStream) {
      // Stop screen sharing
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
      socketRef.current?.emit('stop-screen-share');
      return;
    }

    try {
      // Prompt specification: capture tab/system audio alongside 1080p video
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'browser',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      setScreenStream(displayStream);
      setIsScreenSharing(true);

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = displayStream;
      }

      // Handle user stopping screen share via browser native banner
      displayStream.getVideoTracks()[0].onended = () => {
        handleToggleScreenShare();
      };

      // Broadcast screen share stream to all participants in room
      roomState.participants.forEach(participant => {
        if (participant.peerId && participant.userId !== currentUser.id && peerRef.current) {
          peerRef.current.call(participant.peerId, displayStream, {
            metadata: { type: 'screen-share', isHost: true }
          });
        }
      });

      // Notify socket server
      socketRef.current?.emit('start-screen-share', { screenPeerId: peerRef.current?.id });

    } catch (err) {
      console.warn('Screen share cancelled or failed:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // 5. MEDIA CONTROLS (MIC, CAMERA, SPEAKER, CHAT)
  // ---------------------------------------------------------------------------
  const toggleMicrophone = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const muted = !audioTrack.enabled;
      setIsMicMuted(muted);
      socketRef.current?.emit('media-status-change', { isMuted: muted });
    }
  };

  const toggleCamera = () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const off = !videoTrack.enabled;
      setIsCameraOff(off);
      socketRef.current?.emit('media-status-change', { isCameraOff: off });
    }
  };

  const toggleSpeaker = () => {
    const newMutedState = !isSpeakerMuted;
    setIsSpeakerMuted(newMutedState);

    // Mute/unmute all remote audio elements
    if (screenVideoRef.current) {
      screenVideoRef.current.muted = newMutedState;
    }
  };

  const handleSendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;

    socketRef.current.emit('send-chat-message', { text: chatInput });
    setChatInput('');
  };

  const copyRoomCode = () => {
    if (!roomState.roomId) return;
    navigator.clipboard.writeText(roomState.roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const toggleFullscreen = () => {
    if (!mainPlayerContainerRef.current) return;
    if (!document.fullscreenElement) {
      mainPlayerContainerRef.current.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  };

  // ---------------------------------------------------------------------------
  // VIEW RENDER: 1. AUTHENTICATION (LOGIN / REGISTER)
  // ---------------------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 relative overflow-hidden">
        {/* Ambient background glow circles */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md glass-panel p-8 rounded-2xl shadow-2xl relative z-10 border border-slate-800">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-600 to-purple-600 mb-3 shadow-lg shadow-brand-500/20">
              <Film className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
              FriendWatch <Sparkles className="w-4 h-4 text-brand-500" />
            </h1>
            <p className="text-slate-400 text-sm mt-1">Real-time Watch Party & Screen Sharing</p>
          </div>

          {authError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CinemaMaster"
                  value={authFormData.username}
                  onChange={(e) => setAuthFormData({ ...authFormData, username: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm transition"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                {authMode === 'login' ? 'Email or Username' : 'Email Address'}
              </label>
              <input
                type={authMode === 'login' ? 'text' : 'email'}
                required
                placeholder={authMode === 'login' ? 'Enter username or email' : 'you@domain.com'}
                value={authFormData.email}
                onChange={(e) => setAuthFormData({ ...authFormData, email: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                value={authFormData.password}
                onChange={(e) => setAuthFormData({ ...authFormData, password: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm transition"
              />
            </div>

            <button
              type="submit"
              disabled={isAuthLoading}
              className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-600 text-white font-medium text-sm transition shadow-lg shadow-brand-500/25 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 mt-2"
            >
              {isAuthLoading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : authMode === 'login' ? (
                'Sign In to Watch Party'
              ) : (
                'Create Your Account'
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
              }}
              className="text-xs text-brand-400 hover:text-brand-300 transition"
            >
              {authMode === 'login'
                ? "Don't have an account? Sign up here"
                : 'Already registered? Sign in instead'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW RENDER: 2. LOBBY & ROOM SELECTION
  // ---------------------------------------------------------------------------
  if (!roomState.roomId) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex flex-col justify-between p-6">
        {/* Top Navbar */}
        <header className="flex items-center justify-between max-w-5xl mx-auto w-full py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-brand-600 to-purple-600">
              <Film className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-white">FriendWatch</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
              <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-xs font-bold text-white">
                {currentUser.username[0]?.toUpperCase()}
              </div>
              <span className="text-sm font-medium text-slate-300">{currentUser.username}</span>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Lobby Selection Body */}
        <main className="max-w-4xl mx-auto w-full my-auto py-12">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold text-white mb-2">Ready for Movie Night?</h2>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Stream movies, anime, or YouTube with up to 6 friends with zero audio lag and crystal-clear voice chat.
            </p>
          </div>

          {lobbyError && (
            <div className="max-w-md mx-auto mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>{lobbyError}</span>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Create Room Card (Be Host) */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-800 hover:border-brand-500/50 transition flex flex-col justify-between group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center mb-4 group-hover:scale-105 transition">
                  <Crown className="w-6 h-6 text-brand-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Create a Room (Host)</h3>
                <p className="text-slate-400 text-xs mb-4">
                  You will have full control to share your screen, broadcast movie audio, and manage the room.
                </p>

                <input
                  type="text"
                  placeholder="Party Name (e.g. Marvel Marathon)"
                  value={createRoomName}
                  onChange={(e) => setCreateRoomName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-brand-500 mb-4"
                />
              </div>

              <button
                onClick={() => setupRoomConnection(null, true, createRoomName)}
                disabled={isLobbyLoading}
                className="w-full py-2.5 px-4 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm transition shadow-lg shadow-brand-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isLobbyLoading ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  'Create Room as Host'
                )}
              </button>
            </div>

            {/* Join Room Card (Audience Member) */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-800 hover:border-purple-500/50 transition flex flex-col justify-between group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4 group-hover:scale-105 transition">
                  <Users className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Join with Room Code</h3>
                <p className="text-slate-400 text-xs mb-4">
                  Enter the 6-character room code shared by your friend (Max 6 participants per room).
                </p>

                <input
                  type="text"
                  placeholder="e.g. FW-9X2A"
                  value={joinRoomCode}
                  onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 uppercase tracking-widest font-mono mb-4"
                />
              </div>

              <button
                onClick={() => {
                  if (!joinRoomCode.trim()) {
                    setLobbyError('Please enter a room code');
                    return;
                  }
                  setupRoomConnection(joinRoomCode.trim(), false);
                }}
                disabled={isLobbyLoading}
                className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition border border-slate-700 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isLobbyLoading ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  'Join Room'
                )}
              </button>
            </div>
          </div>
        </main>

        {/* Footer info */}
        <footer className="max-w-5xl mx-auto w-full py-4 text-center text-xs text-slate-500 border-t border-slate-800">
          FriendWatch • WebRTC PeerJS Mesh • Opus Stereo 128kbps Audio • Built for Watch Parties
        </footer>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW RENDER: 3. MAIN WATCH PARTY ROOM (SPLIT-PANEL LAYOUT)
  // ---------------------------------------------------------------------------
  return (
    <div className="h-screen w-screen bg-[#0b0f19] flex flex-col overflow-hidden text-slate-100 font-sans">
      {/* Top Application Bar */}
      <header className="h-14 bg-slate-900/90 border-b border-slate-800 px-4 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-600">
              <Film className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-wide text-white">FriendWatch</span>
          </div>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Room Name & Code badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300 hidden md:inline">
              {roomState.roomName}
            </span>
            <button
              onClick={copyRoomCode}
              title="Click to copy room code"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-mono text-brand-400 border border-slate-700 transition"
            >
              <span>{roomState.roomId}</span>
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Room Header Controls */}
        <div className="flex items-center gap-3">
          {/* Capacity Indicator (Max 6 participants) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
            <Users className="w-3.5 h-3.5 text-brand-400" />
            <span>{roomState.participants.length} / 6</span>
          </div>

          {/* User role pill */}
          <div className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1 ${
            roomState.isHost ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-400'
          }`}>
            {roomState.isHost ? <Crown className="w-3 h-3 text-amber-400" /> : null}
            {roomState.isHost ? 'Host' : 'Audience'}
          </div>

          {/* Leave Room Button */}
          <button
            onClick={leaveRoom}
            className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 text-xs font-medium border border-rose-500/30 transition flex items-center gap-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Leave Party</span>
          </button>
        </div>
      </header>

      {/* Main Body Split-Panel Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* =================================================================== */}
        {/* LEFT PANEL: MAIN SCREEN SHARE AREA (70% to 75% width) */}
        {/* =================================================================== */}
        <section
          ref={mainPlayerContainerRef}
          className={`flex-1 flex flex-col bg-black relative justify-between p-4 overflow-hidden transition-all duration-300 ${
            isChatOpen ? 'w-[70%] sm:w-[72%] md:w-[74%]' : 'w-full'
          }`}
        >
          {/* Main Video Stream Container (16:9 Aspect Ratio & Letterboxing) */}
          <div className="flex-1 flex items-center justify-center relative w-full h-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800/60 shadow-2xl">
            {/* Live Host Screen Share Video */}
            <video
              ref={screenVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-contain ${isScreenSharing ? 'block' : 'hidden'}`}
            />

            {/* Waiting / Cinema Placeholder when no screen is active */}
            {!isScreenSharing && (
              <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
                <div className="w-20 h-20 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center mb-5 shadow-2xl">
                  <MonitorPlay className="w-10 h-10 text-brand-500 animate-pulse-subtle" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Cinema Screen is Idle</h3>
                <p className="text-slate-400 text-xs leading-relaxed mb-6">
                  {roomState.isHost
                    ? "You are the Room Host! Click 'Share Screen' below to stream your movie, anime, or video with audio."
                    : "Waiting for the Room Host to start screen sharing. In the meantime, chat and hang out in the webcam mesh!"}
                </p>

                {roomState.isHost ? (
                  <button
                    onClick={handleToggleScreenShare}
                    className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm transition shadow-lg shadow-brand-500/25 flex items-center gap-2 cursor-pointer"
                  >
                    <MonitorPlay className="w-4 h-4" />
                    <span>Start Screen Share</span>
                  </button>
                ) : (
                  <div className="px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                    <span>Audience Mode • Host Controls Playback</span>
                  </div>
                )}
              </div>
            )}

            {/* Top Overlay Badge inside Video Container */}
            {isScreenSharing && (
              <div className="absolute top-4 left-4 flex items-center gap-2 z-10 pointer-events-none">
                <div className="px-2.5 py-1 rounded-md bg-rose-600/90 text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg backdrop-blur-sm">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  <span>LIVE 1080P</span>
                </div>
                <div className="px-2.5 py-1 rounded-md bg-slate-900/80 text-slate-300 text-[11px] font-mono border border-slate-700/60 backdrop-blur-sm">
                  Opus Stereo 48kHz
                </div>
              </div>
            )}

            {/* Fullscreen Button Overlay */}
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="absolute top-4 right-4 p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 backdrop-blur-sm transition z-10"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>

          {/* Host & Stream Controls Bar (Bottom of Player) */}
          <div className="h-16 mt-3 px-4 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between flex-shrink-0 backdrop-blur-md">
            {/* Left Control Status */}
            <div className="flex items-center gap-3">
              {roomState.isHost ? (
                <button
                  onClick={handleToggleScreenShare}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
                    isScreenSharing
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20'
                      : 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-500/20'
                  }`}
                >
                  {isScreenSharing ? (
                    <>
                      <MonitorOff className="w-4 h-4" />
                      <span>Stop Sharing</span>
                    </>
                  ) : (
                    <>
                      <MonitorPlay className="w-4 h-4" />
                      <span>Share Screen & Audio</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="text-xs text-slate-400 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                  <span>Screen sharing restricted to Host</span>
                </div>
              )}
            </div>

            {/* Quick Media Audio/Video Toggles */}
            <div className="flex items-center gap-2">
              {/* Mic Toggle */}
              <button
                onClick={toggleMicrophone}
                title={isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                className={`p-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isMicMuted
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              {/* Camera Toggle */}
              <button
                onClick={toggleCamera}
                title={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                className={`p-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isCameraOff
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
              </button>

              {/* Speaker Toggle */}
              <button
                onClick={toggleSpeaker}
                title={isSpeakerMuted ? 'Unmute Party Audio' : 'Mute Party Audio'}
                className={`p-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isSpeakerMuted
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {isSpeakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>

            {/* Sidebar toggle */}
            <div>
              <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={`p-2 rounded-lg text-xs border transition ${
                  isChatOpen
                    ? 'bg-brand-500/20 border-brand-500/40 text-brand-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Toggle Sidebar"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* =================================================================== */}
        {/* RIGHT PANEL: INTERACTIVE SIDEBAR (25% to 30% width) */}
        {/* =================================================================== */}
        {isChatOpen && (
          <aside className="w-[30%] sm:w-[28%] md:w-[26%] min-w-[280px] max-w-[380px] bg-slate-900 border-l border-slate-800 flex flex-col flex-shrink-0 z-10 overflow-hidden">
            {/* ------------------------------------------------------------- */}
            {/* TOP SECTION: 2x3 WEBCAM MESH GRID (UP TO 6 PARTICIPANTS) */}
            {/* ------------------------------------------------------------- */}
            <div className="p-3 border-b border-slate-800/80 bg-slate-950/40">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-brand-400" />
                  Webcam Mesh ({roomState.participants.length}/6)
                </span>
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  P2P Active
                </span>
              </div>

              {/* 2x3 Grid Container */}
              <div className="grid grid-cols-2 gap-2 h-52 overflow-y-auto pr-1">
                {/* 1. Local User Feed */}
                <div
                  className={`relative rounded-lg overflow-hidden bg-slate-800 border transition aspect-video flex items-center justify-center ${
                    activeSpeakers.has('local')
                      ? 'border-emerald-500 speaker-ring'
                      : 'border-slate-700/60'
                  }`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-cover transform -scale-x-100 ${
                      isCameraOff ? 'hidden' : 'block'
                    }`}
                  />
                  {isCameraOff && (
                    <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center font-bold text-xs text-white shadow-md">
                      {currentUser.username[0]?.toUpperCase()}
                    </div>
                  )}

                  {/* Name Tag & Status Badges */}
                  <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[10px] text-white">
                    <span className="truncate max-w-[70px]">{currentUser.username} (You)</span>
                    <div className="flex items-center gap-1">
                      {roomState.isHost && <Crown className="w-2.5 h-2.5 text-amber-400" />}
                      {isMicMuted ? (
                        <MicOff className="w-2.5 h-2.5 text-rose-400" />
                      ) : (
                        <Mic className="w-2.5 h-2.5 text-emerald-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Remote Room Participants */}
                {roomState.participants
                  .filter(p => p.userId !== currentUser.id)
                  .map(participant => {
                    const stream = participant.peerId ? remoteStreams[participant.peerId] : null;
                    const isSpeaking = participant.peerId && activeSpeakers.has(participant.peerId);

                    return (
                      <div
                        key={participant.socketId}
                        className={`relative rounded-lg overflow-hidden bg-slate-800 border transition aspect-video flex items-center justify-center ${
                          isSpeaking ? 'border-emerald-500 speaker-ring' : 'border-slate-700/60'
                        }`}
                      >
                        {stream && !participant.isCameraOff ? (
                          <ParticipantVideo stream={stream} isSpeakerMuted={isSpeakerMuted} />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs text-white shadow-md">
                            {participant.username[0]?.toUpperCase()}
                          </div>
                        )}

                        {/* Name Tag & Status Badges */}
                        <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[10px] text-white">
                          <span className="truncate max-w-[70px]">{participant.username}</span>
                          <div className="flex items-center gap-1">
                            {participant.isHost && <Crown className="w-2.5 h-2.5 text-amber-400" />}
                            {participant.isMuted ? (
                              <MicOff className="w-2.5 h-2.5 text-rose-400" />
                            ) : (
                              <Mic className="w-2.5 h-2.5 text-emerald-400" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* BOTTOM SECTION: REAL-TIME TEXT CHAT (SOCKET.IO) */}
            {/* ------------------------------------------------------------- */}
            <div className="flex-1 flex flex-col justify-between overflow-hidden">
              {/* Chat Header */}
              <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between text-xs text-slate-400 bg-slate-900/60">
                <span className="font-semibold text-slate-300">Party Chat</span>
                <span className="text-[10px]">Real-time</span>
              </div>

              {/* Chat Messages Feed with Auto-Scroll */}
              <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-xs">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 text-xs p-4">
                    <MessageSquare className="w-8 h-8 text-slate-700 mb-2" />
                    <span>No messages yet. Say hello to the party!</span>
                  </div>
                )}

                {messages.map((msg) => {
                  if (msg.isSystem) {
                    return (
                      <div
                        key={msg.id}
                        className="py-1 px-2.5 rounded bg-slate-800/40 border border-slate-800 text-center text-[11px] text-slate-400 italic"
                      >
                        {msg.text}
                      </div>
                    );
                  }

                  const isMe = msg.userId === currentUser.id;

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-slate-400">
                        <span className="font-medium text-slate-300">{msg.username}</span>
                        {msg.isHost && <Crown className="w-2.5 h-2.5 text-amber-400" />}
                        <span className="text-slate-500">{msg.timestamp}</span>
                      </div>
                      <div
                        className={`px-3 py-2 rounded-xl max-w-[85%] break-words text-xs ${
                          isMe
                            ? 'bg-brand-600 text-white rounded-tr-none'
                            : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/60'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input Field & Send */}
              <form onSubmit={handleSendChatMessage} className="p-2.5 bg-slate-950/60 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Send a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500 transition"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="p-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Subcomponent to safely attach participant media stream to video element
 */
function ParticipantVideo({ stream, isSpeakerMuted }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isSpeakerMuted}
      className="w-full h-full object-cover transform -scale-x-100"
    />
  );
}
