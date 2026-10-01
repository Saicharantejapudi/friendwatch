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
  AlertCircle,
  Pin,
  PinOff,
  Settings,
  ChevronDown,
  Headphones
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
  const [authMode, setAuthMode] = useState('guest'); // 'guest' | 'login' | 'register'
  const [guestName, setGuestName] = useState('');
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
  const [screenVolume, setScreenVolume] = useState(1);
  const [screenAudioAlert, setScreenAudioAlert] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState(new Set());
  const [remoteStreams, setRemoteStreams] = useState({}); // { [peerId]: MediaStream }

  // ---------------------------------------------------------------------------
  // HARDWARE MEDIA DEVICES (MIC, CAMERA, SPEAKER SWITCHING)
  // ---------------------------------------------------------------------------
  const [audioInputs, setAudioInputs] = useState([]);
  const [videoInputs, setVideoInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [selectedVideoInput, setSelectedVideoInput] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(null); // 'mic' | 'camera' | 'speaker' | 'all' | null

  // ---------------------------------------------------------------------------
  // CHAT & UI & PINNING STATE
  // ---------------------------------------------------------------------------
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [pinnedUser, setPinnedUser] = useState(null); // { userId, username, peerId, isLocal }
  const [mainStageView, setMainStageView] = useState('auto'); // 'auto' | 'screen' | 'pin'

  // ---------------------------------------------------------------------------
  // REFS FOR SOCKET, PEER, AUDIO ANALYZERS & MEDIA ELEMENTS
  // ---------------------------------------------------------------------------
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const screenPeerRef = useRef(null);
  const localVideoRef = useRef(null);
  const pinnedLocalVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const remoteScreenAudioRef = useRef(null);
  const chatBottomRef = useRef(null);
  const mainPlayerContainerRef = useRef(null);
  const peerConnectionsRef = useRef({}); // { [peerId]: call }
  const audioContextRef = useRef(null);
  const audioAnalyzersRef = useRef({}); // { [id]: { analyser, dataArray } }

  // Live mutable refs to eliminate stale closure bugs across WebRTC callbacks
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const roomStateRef = useRef(roomState);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
  }, [screenStream]);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  // Keep local video elements attached to local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
    if (pinnedLocalVideoRef.current && localStream) {
      pinnedLocalVideoRef.current.srcObject = localStream;
    }
  }, [localStream, pinnedUser]);

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

  const handleGuestSubmit = async (e) => {
    e.preventDefault();
    if (!guestName.trim()) {
      setAuthError('Please enter a display name');
      return;
    }
    setAuthError('');
    setIsAuthLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: guestName.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to enter party');
      }

      localStorage.setItem('fw_token', data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setGuestName('');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

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

  // Load and refresh available hardware devices (Mics, Cameras, Speakers)
  const loadMediaDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const aInputs = devices.filter(d => d.kind === 'audioinput');
      const vInputs = devices.filter(d => d.kind === 'videoinput');
      const aOutputs = devices.filter(d => d.kind === 'audiooutput');

      setAudioInputs(aInputs);
      setVideoInputs(vInputs);
      setAudioOutputs(aOutputs);

      // Auto-select current active device if not yet set
      setSelectedAudioInput(prev => prev || (aInputs[0]?.deviceId || ''));
      setSelectedVideoInput(prev => prev || (vInputs[0]?.deviceId || ''));
      setSelectedAudioOutput(prev => prev || (aOutputs[0]?.deviceId || ''));
    } catch (err) {
      console.warn('Could not enumerate media devices:', err);
    }
  }, []);

  useEffect(() => {
    loadMediaDevices();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', loadMediaDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', loadMediaDevices);
      };
    }
  }, [loadMediaDevices]);

  // Switch Microphone hardware
  const switchAudioInput = async (deviceId) => {
    setSelectedAudioInput(deviceId);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...DISCORD_AUDIO_CONSTRAINTS,
          deviceId: deviceId ? { exact: deviceId } : undefined
        }
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      const currentStream = localStreamRef.current;
      if (currentStream) {
        const oldTrack = currentStream.getAudioTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          currentStream.removeTrack(oldTrack);
        }
        currentStream.addTrack(newTrack);
        newTrack.enabled = !isMicMuted;
      }

      // Replace audio track in all active webcam peer connections (ignore screen share)
      Object.entries(peerConnectionsRef.current).forEach(([key, call]) => {
        if (key.startsWith('screen-') || call.metadata?.type === 'screen-share') return;
        try {
          const senders = call.peerConnection?.getSenders() || [];
          const audioSender = senders.find(s => s.track?.kind === 'audio');
          if (audioSender) {
            audioSender.replaceTrack(newTrack);
          }
        } catch (e) {
          console.warn('Error replacing audio track on mic switch:', e);
        }
      });

      if (currentStream) {
        setupAudioAnalysis(currentStream, 'local');
      }
    } catch (err) {
      console.error('Failed to switch microphone:', err);
    }
  };

  // Switch Camera hardware
  const switchVideoInput = async (deviceId) => {
    setSelectedVideoInput(deviceId);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          deviceId: deviceId ? { exact: deviceId } : undefined
        }
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      const currentStream = localStreamRef.current;
      if (currentStream) {
        const oldTrack = currentStream.getVideoTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          currentStream.removeTrack(oldTrack);
        }
        currentStream.addTrack(newTrack);
        newTrack.enabled = !isCameraOff;
      }

      if (localVideoRef.current && currentStream) {
        localVideoRef.current.srcObject = currentStream;
      }

      // Replace video track in all active webcam peer connections (ignore screen share)
      Object.entries(peerConnectionsRef.current).forEach(([key, call]) => {
        if (key.startsWith('screen-') || call.metadata?.type === 'screen-share') return;
        try {
          const senders = call.peerConnection?.getSenders() || [];
          const videoSender = senders.find(s => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(newTrack);
          }
        } catch (e) {
          console.warn('Error replacing video track on camera switch:', e);
        }
      });
    } catch (err) {
      console.error('Failed to switch camera:', err);
    }
  };

  // Switch Speaker / Headphones hardware
  const switchAudioOutput = async (deviceId) => {
    setSelectedAudioOutput(deviceId);
    if (!('setSinkId' in HTMLMediaElement.prototype)) {
      console.warn('Browser does not support setSinkId');
      return;
    }
    try {
      if (remoteScreenAudioRef.current && 'setSinkId' in remoteScreenAudioRef.current) {
        await remoteScreenAudioRef.current.setSinkId(deviceId);
      }
      const participantAudios = document.querySelectorAll('audio[data-participant-audio]');
      participantAudios.forEach(async el => {
        try {
          if ('setSinkId' in el) await el.setSinkId(deviceId);
        } catch (e) {
          console.warn('Error setting sinkId on participant audio:', e);
        }
      });
    } catch (err) {
      console.warn('Failed to switch speaker output:', err);
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
  // 3. PRE-CONNECT SOCKET WHEN LOGGED IN FOR INSTANT ACTIONS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUser || !authToken) return;

    if (!socketRef.current || socketRef.current.disconnected) {
      const socket = io(SERVER_URL, {
        auth: { token: authToken },
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 30000
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('[Socket Connected] Connected to server with ID:', socket.id);
      });

      socket.on('connect_error', (err) => {
        console.warn('[Socket Connect Error]:', err.message);
      });
    }
  }, [currentUser, authToken]);

  // ---------------------------------------------------------------------------
  // WEBRTC OPTIMIZATION: ULTRA-LOW LATENCY & STUDIO STEREO AUDIO FIDELITY
  // ---------------------------------------------------------------------------
  const optimizePeerConnection = useCallback((pc, isScreenShare = false) => {
    if (!pc) return;

    // Helper: Modifies SDP to force Opus into 48kHz Full-Band Stereo CELT Mode (Music Mode)
    // Prevents WebRTC from treating system/movie audio as voice (which wipes out BGM & music)
    const enableStereoOpusInSdp = (sdp) => {
      if (!sdp) return sdp;
      return sdp.replace(/a=fmtp:(\d+) (.*)/g, (line, payload, params) => {
        if (params.includes('minptime') || params.includes('useinbandfec')) {
          let newParams = params;
          if (!newParams.includes('stereo=1')) newParams += ';stereo=1';
          if (!newParams.includes('sprop-stereo=1')) newParams += ';sprop-stereo=1';
          if (!newParams.includes('maxaveragebitrate=')) newParams += ';maxaveragebitrate=256000';
          if (!newParams.includes('cbr=1')) newParams += ';cbr=1';
          return `a=fmtp:${payload} ${newParams}`;
        }
        return line;
      });
    };

    if (isScreenShare) {
      try {
        const origCreateOffer = pc.createOffer.bind(pc);
        pc.createOffer = async (options) => {
          const offer = await origCreateOffer(options);
          if (offer && offer.sdp) {
            offer.sdp = enableStereoOpusInSdp(offer.sdp);
          }
          return offer;
        };

        const origCreateAnswer = pc.createAnswer.bind(pc);
        pc.createAnswer = async (options) => {
          const answer = await origCreateAnswer(options);
          if (answer && answer.sdp) {
            answer.sdp = enableStereoOpusInSdp(answer.sdp);
          }
          return answer;
        };

        const origSetLocalDescription = pc.setLocalDescription.bind(pc);
        pc.setLocalDescription = async (desc) => {
          if (desc && desc.sdp) {
            desc.sdp = enableStereoOpusInSdp(desc.sdp);
          }
          return origSetLocalDescription(desc);
        };
      } catch (err) {
        console.warn('SDP hook warning:', err);
      }
    }

    // 1. Ultra-Low Latency with Wi-Fi Jitter Protection: 150ms playout target prevents dropouts/stutter
    const configureReceivers = () => {
      try {
        pc.getReceivers().forEach(receiver => {
          if ('playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = isScreenShare ? 0.15 : 0.08; // 150ms buffer for seamless movie audio
          }
          if ('jitterBufferTarget' in receiver) {
            receiver.jitterBufferTarget = isScreenShare ? 150 : 80;
          }
        });
      } catch (e) {
        console.warn('Receiver low-latency tuning warning:', e);
      }
    };

    configureReceivers();
    pc.addEventListener('track', () => {
      setTimeout(configureReceivers, 100);
    });

    // 2. High Bitrate & Encoding Tuning: Prevents bufferbloat and ensures pristine stereo movie audio
    const configureSenders = () => {
      try {
        pc.getSenders().forEach(sender => {
          if (!sender.track) return;
          const kind = sender.track.kind;
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }

          if (kind === 'video') {
            if (isScreenShare) {
              params.encodings[0].maxBitrate = 3500000; // 3.5 Mbps cap for crisp 1080p without network saturation
              params.encodings[0].priority = 'high';
              params.encodings[0].networkPriority = 'high';
              params.degradationPreference = 'maintain-framerate';
            } else {
              params.encodings[0].maxBitrate = 500000; // 500 kbps for webcam mesh
              params.encodings[0].priority = 'low';
              params.degradationPreference = 'balanced';
            }
          } else if (kind === 'audio') {
            if (isScreenShare) {
              params.encodings[0].maxBitrate = 256000; // 256 kbps studio stereo audio for system / movie audio
              params.encodings[0].priority = 'high';
              params.encodings[0].networkPriority = 'high';
            } else {
              params.encodings[0].maxBitrate = 64000; // 64 kbps voice audio
              params.encodings[0].priority = 'high';
            }
          }

          sender.setParameters(params).catch(e => console.warn('setParameters tuning notice:', e));
        });
      } catch (e) {
        console.warn('Sender tuning warning:', e);
      }
    };

    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      configureSenders();
    } else {
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          configureSenders();
        }
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // 4. WEBRTC PEER INITIALIZATION WITH GLOBAL STUN SERVERS
  // ---------------------------------------------------------------------------
  const initPeer = useCallback(() => {
    return new Promise((resolve) => {
      if (peerRef.current && !peerRef.current.destroyed) {
        return resolve(peerRef.current);
      }

      const isLocal = window.location.hostname === 'localhost';
      const peerOptions = isLocal ? {
        host: 'localhost',
        port: 5000,
        path: '/peerjs',
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
          ]
        }
      } : {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
          ]
        }
      };

      const peer = new Peer(undefined, peerOptions);
      peerRef.current = peer;

      peer.on('open', (peerId) => {
        console.log('[PeerJS Ready] Peer ID assigned:', peerId);
        if (socketRef.current?.connected) {
          socketRef.current.emit('update-peer-id', {
            peerId,
            roomId: roomStateRef.current.roomId
          });
        }
        resolve(peer);
      });

      peer.on('error', (err) => {
        console.warn('[PeerJS Notice]:', err);
        resolve(peer);
      });

      // Handle incoming WebRTC calls (Webcam mesh or Host Screen Share)
      peer.on('call', (call) => {
        console.log('[WebRTC Incoming Call] from:', call.peer, 'Metadata:', call.metadata);
        const isScreenShareCall = call.metadata && call.metadata.type === 'screen-share';
        optimizePeerConnection(call.peerConnection, isScreenShareCall);

        if (isScreenShareCall) {
          call.answer();
          call.on('stream', (screenMediaStream) => {
            console.log('[WebRTC Screen] Remote screen stream received. Audio tracks:', screenMediaStream.getAudioTracks().length);
            setRemoteScreenStream(screenMediaStream);
            setIsScreenSharing(true);
            if (screenVideoRef.current) {
              screenVideoRef.current.srcObject = screenMediaStream;
              screenVideoRef.current.play().catch(e => console.warn('Screen autoplay error:', e));
            }
          });

          // Also catch delayed audio tracks via RTCPeerConnection ontrack event
          call.peerConnection?.addEventListener('track', (evt) => {
            if (evt.streams && evt.streams[0]) {
              console.log('[WebRTC Screen ontrack event]', evt.track.kind, 'Audio count:', evt.streams[0].getAudioTracks().length);
              setRemoteScreenStream(evt.streams[0]);
              if (screenVideoRef.current && screenVideoRef.current.srcObject !== evt.streams[0]) {
                screenVideoRef.current.srcObject = evt.streams[0];
                screenVideoRef.current.play().catch(e => console.warn('Screen play error:', e));
              }
            }
          });

          peerConnectionsRef.current[`screen-${call.peer}`] = call;
        } else {
          // Answer webcam call with current local stream if available
          const currentStream = localStreamRef.current;
          call.answer(currentStream || undefined);
          call.on('stream', (userMediaStream) => {
            console.log('[WebRTC Mesh] Received remote stream from:', call.peer);
            setRemoteStreams(prev => ({ ...prev, [call.peer]: userMediaStream }));
            setupAudioAnalysis(userMediaStream, call.peer);
          });
          call.peerConnection?.addEventListener('track', (evt) => {
            if (evt.streams && evt.streams[0]) {
              console.log('[WebRTC Mesh ontrack event]', call.peer, evt.track.kind);
              setRemoteStreams(prev => ({ ...prev, [call.peer]: evt.streams[0] }));
            }
          });
          peerConnectionsRef.current[call.peer] = call;
        }
      });
    });
  }, [optimizePeerConnection]);

  // ---------------------------------------------------------------------------
  // 5. ENTER ROOM (CREATE AS HOST OR JOIN WITH CODE)
  // ---------------------------------------------------------------------------
  const setupRoomConnection = useCallback(async (roomId, isCreating = false, roomName = '') => {
    if (!currentUser || !authToken) return;

    setIsLobbyLoading(true);
    setLobbyError('');

    // Safety timeout to prevent infinite spinner
    const timeoutTimer = setTimeout(() => {
      setIsLobbyLoading(false);
      setLobbyError('Connection took too long. Please try again.');
    }, 15000);

    try {
      // 1. Initialize user webcam/mic & PeerJS in parallel
      const streamPromise = initializeUserMedia();
      const peerPromise = initPeer();
      const [stream, peer] = await Promise.all([streamPromise, peerPromise]);

      // 2. Get or initialize Socket.io
      let socket = socketRef.current;
      if (!socket || socket.disconnected) {
        socket = io(SERVER_URL, {
          auth: { token: authToken },
          transports: ['polling', 'websocket'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          timeout: 30000
        });
        socketRef.current = socket;
      }

      // 3. Socket room event handlers
      socket.off('user-joined');
      socket.on('user-joined', ({ participant }) => {
        console.log('[Socket] New participant joined:', participant.username, 'PeerID:', participant.peerId);
        setRoomState(prev => ({
          ...prev,
          participants: [...prev.participants.filter(p => p.socketId !== participant.socketId), participant]
        }));

        const currentStream = localStreamRef.current;
        if (participant.peerId && currentStream && peerRef.current) {
          connectToNewUser(participant.peerId, currentStream);
        }

        // If host is already screen sharing, call the new user with the screen stream!
        if (participant.peerId && screenStreamRef.current && roomStateRef.current.isHost && peerRef.current) {
          console.log('[WebRTC Screen] Calling joining user with screen share:', participant.peerId);
          const call = peerRef.current.call(participant.peerId, screenStreamRef.current, {
            metadata: { type: 'screen-share', isHost: true }
          });
          if (call) {
            optimizePeerConnection(call.peerConnection, true);
          }
        }
      });

      // Crucial: Handle when peer finishes initializing their PeerJS ID
      socket.off('peer-id-updated');
      socket.on('peer-id-updated', ({ socketId, peerId }) => {
        console.log('[Socket] Participant peer ID updated:', socketId, peerId);
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.map(p =>
            p.socketId === socketId ? { ...p, peerId } : p
          )
        }));

        const currentStream = localStreamRef.current;
        if (peerId && currentStream && peerRef.current) {
          connectToNewUser(peerId, currentStream);
        }

        // If host is already screen sharing, send screen stream to newly ready peer
        if (peerId && screenStreamRef.current && roomStateRef.current.isHost && peerRef.current) {
          console.log('[WebRTC Screen] Calling newly ready peer with screen share:', peerId);
          const call = peerRef.current.call(peerId, screenStreamRef.current, {
            metadata: { type: 'screen-share', isHost: true }
          });
          if (call) {
            optimizePeerConnection(call.peerConnection, true);
          }
        }
      });

      socket.off('user-left');
      socket.on('user-left', ({ socketId, peerId, userId, username }) => {
        console.log('[Socket] Participant left:', username);
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p.socketId !== socketId)
        }));

        // Clean up pinning if leaving user was pinned
        setPinnedUser(prev => {
          if (prev && (prev.userId === userId || prev.peerId === peerId)) {
            return null;
          }
          return prev;
        });

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

      socket.off('screen-share-active');
      socket.on('screen-share-active', ({ hostUsername, peerId }) => {
        console.log('[Socket] Screen share active from host:', hostUsername, 'PeerID:', peerId);
        setIsScreenSharing(true);
      });

      socket.off('screen-share-stopped');
      socket.on('screen-share-stopped', () => {
        console.log('[Socket] Screen share ended');
        setIsScreenSharing(false);
        setRemoteScreenStream(null);
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = null;
        }
      });

      socket.off('participant-media-status');
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

      socket.off('host-changed');
      socket.on('host-changed', ({ newHostUserId }) => {
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

      socket.off('chat-message');
      socket.on('chat-message', (msg) => {
        setMessages(prev => [...prev, msg]);
      });

      socket.off('error');
      socket.on('error', ({ message }) => {
        setLobbyError(message);
        leaveRoom();
      });

      // 4. Execute action immediately or once connected
      const executeAction = () => {
        if (isCreating) {
          socket.emit('create-room', { roomName: roomName || `${currentUser.username}'s Party` }, (res) => {
            clearTimeout(timeoutTimer);
            if (res.success) {
              joinRoomWithPeer(socket, peer, stream, res.roomId);
            } else {
              setLobbyError(res.error || 'Failed to create room');
              setIsLobbyLoading(false);
            }
          });
        } else {
          clearTimeout(timeoutTimer);
          joinRoomWithPeer(socket, peer, stream, roomId);
        }
      };

      if (socket.connected) {
        executeAction();
      } else {
        socket.once('connect', executeAction);
        socket.once('connect_error', (err) => {
          clearTimeout(timeoutTimer);
          console.error('[Socket Error]:', err);
          setLobbyError('Server connection error: ' + (err.message || 'Could not connect to party server'));
          setIsLobbyLoading(false);
        });
      }
    } catch (err) {
      console.error('Failed to initialize room:', err);
      setLobbyError(err.message || 'Connection failed');
      setIsLobbyLoading(false);
    }
  }, [currentUser, authToken, initPeer]);

  /**
   * Complete the join-room handshake once PeerJS is ready
   */
  const joinRoomWithPeer = (socket, peer, stream, roomId) => {
    socket.emit('join-room', { roomId, peerId: peer?.id || null }, (response) => {
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
   * Connect to a peer using WebRTC mesh
   */
  const connectToNewUser = (remotePeerId, stream) => {
    if (!peerRef.current || !stream || !remotePeerId) return;
    if (peerConnectionsRef.current[remotePeerId]) {
      console.log('[WebRTC Mesh] Already connected to peer:', remotePeerId);
      return;
    }
    console.log('[WebRTC Mesh] Calling peer:', remotePeerId);

    try {
      const call = peerRef.current.call(remotePeerId, stream, {
        metadata: { type: 'webcam-mesh', userId: currentUser.id }
      });

      if (!call) return;
      optimizePeerConnection(call.peerConnection, false);

      call.on('stream', (userMediaStream) => {
        console.log('[WebRTC Mesh] Call stream established with:', remotePeerId);
        setRemoteStreams(prev => ({ ...prev, [remotePeerId]: userMediaStream }));
        setupAudioAnalysis(userMediaStream, remotePeerId);
      });

      call.peerConnection?.addEventListener('track', (evt) => {
        if (evt.streams && evt.streams[0]) {
          console.log('[WebRTC Mesh ontrack event]', remotePeerId, evt.track.kind);
          setRemoteStreams(prev => ({ ...prev, [remotePeerId]: evt.streams[0] }));
        }
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
    } catch (err) {
      console.warn('[WebRTC Call Error]:', err);
    }
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

    Object.values(peerConnectionsRef.current).forEach(call => {
      try { call.close(); } catch (_) {}
    });
    peerConnectionsRef.current = {};

    setRoomState({ roomId: null, roomName: '', isHost: false, participants: [] });
    setRemoteStreams({});
    setRemoteScreenStream(null);
    setIsScreenSharing(false);
    setScreenAudioAlert(false);
    setMessages([]);
    setIsLobbyLoading(false);
    setPinnedUser(null);
    setMainStageView('auto');
  };

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // 6. HOST SCREEN SHARING WITH SYSTEM / TAB AUDIO CAPTURE
  // ---------------------------------------------------------------------------
  const handleToggleScreenShare = async () => {
    if (!roomState.isHost) {
      alert('Strict Access Control: Only the Room Host can share screen.');
      return;
    }

    if (isScreenSharing && screenStream) {
      // Stop screen sharing
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
      setScreenAudioAlert(false);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
      socketRef.current?.emit('stop-screen-share');
      return;
    }

    try {
      // High-performance screen capture: 1080p@30fps caps & crystal clear stereo audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'browser',
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include'
      });

      const audioTracks = displayStream.getAudioTracks();
      const videoTracks = displayStream.getVideoTracks();

      if (audioTracks.length === 0) {
        console.warn('[Screen Share] No system/tab audio track detected from display picker');
        setScreenAudioAlert(true);
      } else {
        console.log('[Screen Share] Audio track active:', audioTracks[0].label);
        setScreenAudioAlert(false);
        audioTracks.forEach(track => {
          track.enabled = true;
          if ('contentHint' in track) {
            track.contentHint = 'music'; // Keeps high frequencies & stereo fidelity for movies/music
          }
        });
      }

      if (videoTracks.length > 0 && 'contentHint' in videoTracks[0]) {
        videoTracks[0].contentHint = 'motion'; // Prioritize smooth 30fps motion
      }

      setScreenStream(displayStream);
      setIsScreenSharing(true);

      if (screenVideoRef.current) {
        // Strip audio tracks completely from host local preview video to prevent any comb filtering / double audio
        const videoOnlyStream = new MediaStream(displayStream.getVideoTracks());
        screenVideoRef.current.srcObject = videoOnlyStream;
        screenVideoRef.current.muted = true;
        screenVideoRef.current.play().catch(e => console.warn('Screen play error:', e));
      }

      displayStream.getVideoTracks()[0].onended = () => {
        handleToggleScreenShare();
      };

      // Broadcast screen share stream to all participants in room with optimized RTCPeerConnection
      roomState.participants.forEach(participant => {
        if (participant.peerId && participant.userId !== currentUser.id && peerRef.current) {
          const call = peerRef.current.call(participant.peerId, displayStream, {
            metadata: { type: 'screen-share', isHost: true }
          });
          if (call) {
            optimizePeerConnection(call.peerConnection, true);
            peerConnectionsRef.current[`screen-${participant.peerId}`] = call;
          }
        }
      });

      socketRef.current?.emit('start-screen-share', { screenPeerId: peerRef.current?.id });
    } catch (err) {
      console.warn('Screen share cancelled or failed:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // 7. MEDIA CONTROLS (MIC, CAMERA, SPEAKER, PINNING)
  // ---------------------------------------------------------------------------
  const toggleMicrophone = async () => {
    let stream = localStreamRef.current;

    // If no stream or no audio track exists yet, dynamically request microphone
    if (!stream || stream.getAudioTracks().length === 0) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: DISCORD_AUDIO_CONSTRAINTS
        });
        const newAudioTrack = audioStream.getAudioTracks()[0];

        if (stream) {
          stream.addTrack(newAudioTrack);
        } else {
          stream = audioStream;
          setLocalStream(stream);
        }

        // Add/replace track in active webcam/mic peer connections ONLY (NEVER touch screen share)
        Object.entries(peerConnectionsRef.current).forEach(([key, call]) => {
          if (key.startsWith('screen-') || call.metadata?.type === 'screen-share') return;
          try {
            const senders = call.peerConnection?.getSenders() || [];
            const audioSender = senders.find(s => s.track?.kind === 'audio');
            if (audioSender) {
              audioSender.replaceTrack(newAudioTrack);
            } else if (call.peerConnection?.addTrack) {
              call.peerConnection.addTrack(newAudioTrack, stream);
            }
          } catch (e) {
            console.warn('Error replacing audio track in peer connection:', e);
          }
        });

        setIsMicMuted(false);
        socketRef.current?.emit('media-status-change', { isMuted: false });
        setupAudioAnalysis(stream, 'local');
        return;
      } catch (err) {
        console.error('Failed to get microphone track:', err);
        alert('Could not access microphone: ' + (err.message || 'Permission denied'));
        return;
      }
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const nextMuted = !isMicMuted;
      audioTrack.enabled = !nextMuted;
      setIsMicMuted(nextMuted);
      socketRef.current?.emit('media-status-change', { isMuted: nextMuted });
    }
  };

  const toggleCamera = async () => {
    let stream = localStreamRef.current;

    // If no stream or no video track exists yet, dynamically request camera
    if (!stream || stream.getVideoTracks().length === 0) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
          }
        });
        const newVideoTrack = videoStream.getVideoTracks()[0];

        if (stream) {
          stream.addTrack(newVideoTrack);
        } else {
          stream = videoStream;
          setLocalStream(stream);
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Add/replace track in active webcam peer connections ONLY (NEVER touch screen share)
        Object.entries(peerConnectionsRef.current).forEach(([key, call]) => {
          if (key.startsWith('screen-') || call.metadata?.type === 'screen-share') return;
          try {
            const senders = call.peerConnection?.getSenders() || [];
            const videoSender = senders.find(s => s.track?.kind === 'video');
            if (videoSender) {
              videoSender.replaceTrack(newVideoTrack);
            } else if (call.peerConnection?.addTrack) {
              call.peerConnection.addTrack(newVideoTrack, stream);
            }
          } catch (e) {
            console.warn('Error replacing video track in peer connection:', e);
          }
        });

        setIsCameraOff(false);
        socketRef.current?.emit('media-status-change', { isCameraOff: false });
        return;
      } catch (err) {
        console.error('Failed to get camera track:', err);
        alert('Could not access camera: ' + (err.message || 'Permission denied'));
        return;
      }
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const nextCameraOff = !isCameraOff;
      videoTrack.enabled = !nextCameraOff;
      setIsCameraOff(nextCameraOff);
      socketRef.current?.emit('media-status-change', { isCameraOff: nextCameraOff });
    }
  };

  const toggleSpeaker = () => {
    const newMutedState = !isSpeakerMuted;
    setIsSpeakerMuted(newMutedState);

    if (remoteScreenAudioRef.current && !roomState.isHost) {
      remoteScreenAudioRef.current.muted = newMutedState;
    }
  };

  // Sync screen audio volume and mute status for audience
  useEffect(() => {
    if (remoteScreenAudioRef.current && !roomState.isHost) {
      remoteScreenAudioRef.current.volume = screenVolume;
      remoteScreenAudioRef.current.muted = isSpeakerMuted;
    }
  }, [screenVolume, isSpeakerMuted, roomState.isHost]);

  // Sync remote screen stream to video & dedicated audio elements for audience
  useEffect(() => {
    if (!roomState.isHost && remoteScreenStream) {
      if (screenVideoRef.current && screenVideoRef.current.srcObject !== remoteScreenStream) {
        screenVideoRef.current.srcObject = remoteScreenStream;
        screenVideoRef.current.muted = true; // Video element is always muted; audio element handles playback
        screenVideoRef.current.play().catch(e => console.warn('Screen video sync error:', e));
      }
      if (remoteScreenAudioRef.current && remoteScreenAudioRef.current.srcObject !== remoteScreenStream) {
        remoteScreenAudioRef.current.srcObject = remoteScreenStream;
        remoteScreenAudioRef.current.volume = screenVolume;
        remoteScreenAudioRef.current.muted = isSpeakerMuted;
        remoteScreenAudioRef.current.play().catch(e => console.warn('Remote screen audio sync error:', e));
      }
    }
  }, [remoteScreenStream, roomState.isHost, screenVolume, isSpeakerMuted]);

  const handleTogglePin = (userToPin) => {
    if (pinnedUser && pinnedUser.userId === userToPin.userId) {
      // Toggle off if already pinned
      setPinnedUser(null);
      setMainStageView('auto');
    } else {
      setPinnedUser(userToPin);
      setMainStageView('pin');
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
  // VIEW RENDER: 1. AUTHENTICATION & INSTANT GUEST ENTRY
  // ---------------------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 relative overflow-hidden">
        {/* Ambient background glow circles */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md glass-panel p-8 rounded-2xl shadow-2xl relative z-10 border border-slate-800">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-600 to-purple-600 mb-3 shadow-lg shadow-brand-500/20">
              <Film className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
              FriendWatch <Sparkles className="w-4 h-4 text-brand-500" />
            </h1>
            <p className="text-slate-400 text-sm mt-1">Real-time Watch Party & Screen Sharing</p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex rounded-xl bg-slate-900/90 p-1 mb-6 border border-slate-800">
            <button
              type="button"
              onClick={() => { setAuthMode('guest'); setAuthError(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                authMode === 'guest'
                  ? 'bg-brand-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Instant Guest (No Password)
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('login'); setAuthError(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                authMode !== 'guest'
                  ? 'bg-slate-800 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Account Login
            </button>
          </div>

          {authError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* 1. INSTANT GUEST ENTRY FORM */}
          {authMode === 'guest' ? (
            <form onSubmit={handleGuestSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Your Display Name / Nickname
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Charan or Alex"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm transition"
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  No password or email required. Hop straight into the watch party!
                </p>
              </div>

              <button
                type="submit"
                disabled={isAuthLoading}
                className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 text-white font-medium text-sm transition shadow-lg shadow-brand-500/25 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 mt-4"
              >
                {isAuthLoading ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  'Jump into Watch Party 🚀'
                )}
              </button>
            </form>
          ) : (
            /* 2. REGULAR ACCOUNT FORM (LOGIN / REGISTER) */
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
                  'Sign In with Account'
                ) : (
                  'Create Your Account'
                )}
              </button>

              <div className="pt-2 text-center">
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
            </form>
          )}
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
              muted={true}
              className={`w-full h-full object-contain ${isScreenSharing ? 'block' : 'hidden'}`}
            />

            {/* Audio Alert Banner if Host Forgot to Check "Share Audio" */}
            {screenAudioAlert && roomState.isHost && isScreenSharing && (
              <div className="absolute top-16 left-4 right-4 z-20 bg-amber-500/95 text-slate-950 p-4 rounded-xl shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-300 backdrop-blur-md animate-fade-in">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 text-slate-950 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-bold text-sm text-slate-950">⚠️ No Audio Detected from Screen Share!</p>
                    <p className="text-slate-900 text-[11px] leading-relaxed mt-0.5">
                      Windows <strong>cannot capture audio if you select 'Window'</strong>. To share YouTube with full sound & BGM:
                      <br />
                      👉 <strong>Option A (Best for YouTube):</strong> Choose <strong>"Chrome Tab"</strong> and check <strong>"Share tab audio"</strong>.
                      <br />
                      👉 <strong>Option B (Full Screen Apps):</strong> Choose <strong>"Entire Screen"</strong> and check <strong>"Also share system audio"</strong> (bottom-left).
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                  <button
                    onClick={handleToggleScreenShare}
                    className="px-3.5 py-2 rounded-lg bg-slate-950 hover:bg-slate-900 text-white text-xs font-semibold shadow transition cursor-pointer"
                  >
                    Re-share with Audio
                  </button>
                  <button
                    onClick={() => setScreenAudioAlert(false)}
                    className="p-1.5 rounded-lg hover:bg-amber-600/30 text-slate-950 transition cursor-pointer text-xs font-bold"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

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
              className="absolute top-4 right-4 p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 backdrop-blur-sm transition z-10 cursor-pointer"
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


            {/* Media Audio/Video Toggles with Device Switcher Dropdowns */}
            <div className="flex items-center gap-1.5 relative">
              {/* Audience Independent Movie Volume Slider */}
              {!roomState.isHost && isScreenSharing && (
                <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-700/60 mr-1 shadow-sm">
                  <Volume2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                  <span className="text-[10px] text-slate-300 font-medium hidden sm:inline">Movie:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={screenVolume}
                    onChange={(e) => setScreenVolume(parseFloat(e.target.value))}
                    className="w-14 sm:w-20 h-1 accent-brand-500 bg-slate-700 rounded cursor-pointer"
                    title={`Movie Volume: ${Math.round(screenVolume * 100)}%`}
                  />
                </div>
              )}

              {/* 1. Microphone Split Button & Dropdown */}
              <div className="relative flex items-center rounded-lg bg-slate-800 border border-slate-700/80 shadow-sm">
                <button
                  onClick={toggleMicrophone}
                  title={isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                  className={`p-2 sm:p-2.5 rounded-l-lg text-xs font-medium transition cursor-pointer ${
                    isMicMuted
                      ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                      : 'text-emerald-400 hover:bg-slate-700/60'
                  }`}
                >
                  {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setDeviceDropdownOpen(deviceDropdownOpen === 'mic' ? null : 'mic')}
                  title="Select Microphone Input"
                  className="px-1 py-2 sm:py-2.5 rounded-r-lg hover:bg-slate-700 text-slate-400 hover:text-white transition border-l border-slate-700/60 cursor-pointer"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {/* 2. Camera Split Button & Dropdown */}
              <div className="relative flex items-center rounded-lg bg-slate-800 border border-slate-700/80 shadow-sm">
                <button
                  onClick={toggleCamera}
                  title={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                  className={`p-2 sm:p-2.5 rounded-l-lg text-xs font-medium transition cursor-pointer ${
                    isCameraOff
                      ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                      : 'text-blue-400 hover:bg-slate-700/60'
                  }`}
                >
                  {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setDeviceDropdownOpen(deviceDropdownOpen === 'camera' ? null : 'camera')}
                  title="Select Camera Input"
                  className="px-1 py-2 sm:py-2.5 rounded-r-lg hover:bg-slate-700 text-slate-400 hover:text-white transition border-l border-slate-700/60 cursor-pointer"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {/* 3. Speaker / Output Split Button & Dropdown */}
              <div className="relative flex items-center rounded-lg bg-slate-800 border border-slate-700/80 shadow-sm">
                <button
                  onClick={toggleSpeaker}
                  title={isSpeakerMuted ? 'Unmute Party Audio' : 'Mute Party Audio'}
                  className={`p-2 sm:p-2.5 rounded-l-lg text-xs font-medium transition cursor-pointer ${
                    isSpeakerMuted
                      ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                      : 'text-slate-200 hover:bg-slate-700/60'
                  }`}
                >
                  {isSpeakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setDeviceDropdownOpen(deviceDropdownOpen === 'speaker' ? null : 'speaker')}
                  title="Select Speaker / Headphones Output"
                  className="px-1 py-2 sm:py-2.5 rounded-r-lg hover:bg-slate-700 text-slate-400 hover:text-white transition border-l border-slate-700/60 cursor-pointer"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {/* 4. Full Device Settings Quick Modal Button */}
              <button
                onClick={() => setDeviceDropdownOpen(deviceDropdownOpen === 'all' ? null : 'all')}
                title="Hardware Device Settings"
                className={`p-2 sm:p-2.5 rounded-lg text-xs border transition cursor-pointer ${
                  deviceDropdownOpen === 'all'
                    ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border-slate-700'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>

              {/* Backdrop Click to close dropdowns */}
              {deviceDropdownOpen && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setDeviceDropdownOpen(null)}
                />
              )}

              {/* FLOATING DROPDOWN: MICROPHONE */}
              {deviceDropdownOpen === 'mic' && (
                <div className="absolute bottom-16 left-0 sm:left-auto right-auto z-50 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 text-xs backdrop-blur-md animate-fade-in">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-emerald-400" />
                      Select Microphone
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{audioInputs.length} detected</span>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {audioInputs.length === 0 ? (
                      <div className="text-[11px] text-slate-500 py-2 text-center">No microphones detected</div>
                    ) : (
                      audioInputs.map(dev => (
                        <button
                          key={dev.deviceId || dev.label}
                          onClick={() => {
                            switchAudioInput(dev.deviceId);
                            setDeviceDropdownOpen(null);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition flex items-center justify-between cursor-pointer ${
                            selectedAudioInput === dev.deviceId
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium'
                              : 'hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="truncate pr-2">{dev.label || `Microphone ${dev.deviceId.slice(0, 5)}`}</span>
                          {selectedAudioInput === dev.deviceId && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* FLOATING DROPDOWN: CAMERA */}
              {deviceDropdownOpen === 'camera' && (
                <div className="absolute bottom-16 left-0 sm:left-auto right-auto z-50 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 text-xs backdrop-blur-md animate-fade-in">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5 text-blue-400" />
                      Select Camera
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{videoInputs.length} detected</span>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {videoInputs.length === 0 ? (
                      <div className="text-[11px] text-slate-500 py-2 text-center">No cameras detected</div>
                    ) : (
                      videoInputs.map(dev => (
                        <button
                          key={dev.deviceId || dev.label}
                          onClick={() => {
                            switchVideoInput(dev.deviceId);
                            setDeviceDropdownOpen(null);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition flex items-center justify-between cursor-pointer ${
                            selectedVideoInput === dev.deviceId
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium'
                              : 'hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="truncate pr-2">{dev.label || `Camera ${dev.deviceId.slice(0, 5)}`}</span>
                          {selectedVideoInput === dev.deviceId && <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* FLOATING DROPDOWN: SPEAKER / OUTPUT */}
              {deviceDropdownOpen === 'speaker' && (
                <div className="absolute bottom-16 right-0 z-50 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 text-xs backdrop-blur-md animate-fade-in">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Headphones className="w-3.5 h-3.5 text-brand-400" />
                      Select Speaker / Headphones
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{audioOutputs.length} detected</span>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {audioOutputs.length === 0 ? (
                      <div className="text-[11px] text-slate-500 py-2 text-center">Default System Output</div>
                    ) : (
                      audioOutputs.map(dev => (
                        <button
                          key={dev.deviceId || dev.label}
                          onClick={() => {
                            switchAudioOutput(dev.deviceId);
                            setDeviceDropdownOpen(null);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition flex items-center justify-between cursor-pointer ${
                            selectedAudioOutput === dev.deviceId
                              ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30 font-medium'
                              : 'hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="truncate pr-2">{dev.label || `Speaker ${dev.deviceId.slice(0, 5)}`}</span>
                          {selectedAudioOutput === dev.deviceId && <Check className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* FULL HARDWARE SETTINGS MODAL / POPOVER */}
              {deviceDropdownOpen === 'all' && (
                <div className="absolute bottom-16 right-0 z-50 w-80 sm:w-96 rounded-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl p-4 text-xs backdrop-blur-lg animate-fade-in">
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
                    <span className="font-bold text-sm text-white flex items-center gap-2">
                      <Settings className="w-4 h-4 text-brand-400" />
                      Audio & Video Devices
                    </span>
                    <button
                      onClick={() => setDeviceDropdownOpen(null)}
                      className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-3.5">
                    {/* Microphone Select */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                        <Mic className="w-3 h-3 text-emerald-400" />
                        Microphone (Audio Input)
                      </label>
                      <select
                        value={selectedAudioInput}
                        onChange={(e) => switchAudioInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:ring-1 focus:ring-brand-500 outline-none"
                      >
                        {audioInputs.map(dev => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Microphone ${dev.deviceId.slice(0, 5)}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Camera Select */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                        <Video className="w-3 h-3 text-blue-400" />
                        Camera (Video Input)
                      </label>
                      <select
                        value={selectedVideoInput}
                        onChange={(e) => switchVideoInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:ring-1 focus:ring-brand-500 outline-none"
                      >
                        {videoInputs.map(dev => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Camera ${dev.deviceId.slice(0, 5)}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Speaker Select */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                        <Headphones className="w-3 h-3 text-brand-400" />
                        Speaker / Headphones (Audio Output)
                      </label>
                      <select
                        value={selectedAudioOutput}
                        onChange={(e) => switchAudioOutput(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:ring-1 focus:ring-brand-500 outline-none"
                      >
                        {audioOutputs.map(dev => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Speaker ${dev.deviceId.slice(0, 5)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar toggle */}
            <div>
              <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={`p-2 rounded-lg text-xs border transition cursor-pointer ${
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
                  {pinnedUser ? `Pinned: ${pinnedUser.username}` : `People (${roomState.participants.length}/6)`}
                </span>
                <div className="flex items-center gap-2">
                  {pinnedUser && (
                    <button
                      onClick={() => setPinnedUser(null)}
                      className="text-[10px] text-rose-400 hover:text-rose-300 font-medium flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 cursor-pointer transition"
                    >
                      <PinOff className="w-3 h-3" />
                      <span>Unpin</span>
                    </button>
                  )}
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    P2P
                  </span>
                </div>
              </div>

              {/* 1. PINNED VIEW IN PEOPLE SECTION (PINNED PERSON BIG + MY SMALL VIDEO) */}
              {pinnedUser ? (
                <div className="space-y-2">
                  {/* Big Featured Video Container */}
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-brand-500/50 aspect-video w-full flex items-center justify-center shadow-xl group">
                    {pinnedUser.isLocal ? (
                      <>
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
                          <div className="flex flex-col items-center justify-center p-4">
                            <div className="w-12 h-12 rounded-full bg-brand-600 flex items-center justify-center font-bold text-lg text-white shadow-md mb-2">
                              {currentUser.username[0]?.toUpperCase()}
                            </div>
                            <span className="text-xs text-slate-300 font-semibold">{currentUser.username} (You)</span>
                            <span className="text-[10px] text-slate-500">Camera is off</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {(() => {
                          const stream = pinnedUser.peerId ? remoteStreams[pinnedUser.peerId] : null;
                          const participantInfo = roomState.participants.find(p => p.userId === pinnedUser.userId);
                          const isCamOff = participantInfo ? participantInfo.isCameraOff : false;

                          if (stream && !isCamOff) {
                            return (
                              <ParticipantVideo stream={stream} isSpeakerMuted={isSpeakerMuted} />
                            );
                          }

                          return (
                            <div className="flex flex-col items-center justify-center p-4">
                              <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center font-bold text-lg text-white shadow-md mb-2">
                                {pinnedUser.username[0]?.toUpperCase()}
                              </div>
                              <span className="text-xs text-slate-300 font-semibold">{pinnedUser.username}</span>
                              <span className="text-[10px] text-slate-500">
                                {isCamOff ? 'Camera is turned off' : 'Waiting for video...'}
                              </span>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    {/* Top Left Pinned Badge */}
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-[10px] font-semibold text-brand-300 border border-brand-500/30">
                      <Pin className="w-3 h-3 text-brand-400" />
                      <span className="truncate max-w-[110px]">{pinnedUser.username}</span>
                    </div>

                    {/* Top Right Unpin Button */}
                    <button
                      onClick={() => setPinnedUser(null)}
                      title="Unpin person"
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-black/70 hover:bg-black/90 text-slate-300 hover:text-rose-400 transition backdrop-blur-xs border border-slate-700/60 cursor-pointer"
                    >
                      <PinOff className="w-3.5 h-3.5 text-rose-400" />
                    </button>

                    {/* Name Tag Bottom-Left */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[10px] text-white">
                      <span className="font-semibold">{pinnedUser.username}</span>
                      {pinnedUser.userId === currentUser.id && <span className="text-slate-400">(You)</span>}
                    </div>

                    {/* Small Floating Video of Current User ("my small video") when someone else is pinned */}
                    {!pinnedUser.isLocal && (
                      <div className="absolute bottom-2 right-2 w-24 sm:w-28 aspect-video rounded-lg overflow-hidden bg-slate-950 border-2 border-slate-700 shadow-2xl flex items-center justify-center z-10">
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
                          <div className="w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center font-bold text-[10px] text-white">
                            {currentUser.username[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="absolute bottom-0.5 left-1 right-1 flex items-center justify-between text-[8px] text-white bg-black/70 px-1 py-0.2 rounded">
                          <span className="truncate max-w-[50px]">You</span>
                          {isMicMuted ? (
                            <MicOff className="w-2 h-2 text-rose-400" />
                          ) : (
                            <Mic className="w-2 h-2 text-emerald-400" />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Compact thumbnails for any other friends in room */}
                  {roomState.participants.filter(p => p.userId !== currentUser.id && p.userId !== pinnedUser.userId).length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                      {roomState.participants
                        .filter(p => p.userId !== currentUser.id && p.userId !== pinnedUser.userId)
                        .map(participant => {
                          const stream = participant.peerId ? remoteStreams[participant.peerId] : null;
                          return (
                            <div
                              key={participant.socketId}
                              onClick={() => handleTogglePin({
                                userId: participant.userId,
                                username: participant.username,
                                peerId: participant.peerId,
                                isLocal: false
                              })}
                              title={`Click to pin ${participant.username}`}
                              className="w-20 aspect-video rounded-md overflow-hidden bg-slate-800 border border-slate-700/80 flex-shrink-0 relative cursor-pointer hover:border-brand-500 transition flex items-center justify-center"
                            >
                              {stream && !participant.isCameraOff ? (
                                <ParticipantVideo stream={stream} isSpeakerMuted={isSpeakerMuted} />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-white">
                                  {participant.username[0]?.toUpperCase()}
                                </div>
                              )}
                              <div className="absolute bottom-0.5 left-0.5 right-0.5 px-1 bg-black/70 text-[8px] text-white truncate rounded">
                                {participant.username}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              ) : (
                /* 2. STANDARD 2x3 GRID CONTAINER (WHEN NO ONE IS PINNED) */
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {/* 1. Local User Feed */}
                  <div
                    className={`relative rounded-lg overflow-hidden bg-slate-800 border transition aspect-video flex items-center justify-center group ${
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

                    {/* Pin Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin({
                          userId: currentUser.id,
                          username: currentUser.username,
                          peerId: peerRef.current?.id,
                          isLocal: true
                        });
                      }}
                      title="Pin yourself"
                      className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-black/90 text-slate-300 hover:text-white transition backdrop-blur-xs z-10 cursor-pointer"
                    >
                      <Pin className="w-3 h-3" />
                    </button>

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
                          className={`relative rounded-lg overflow-hidden bg-slate-800 border transition aspect-video flex items-center justify-center group ${
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

                          {/* Pin Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTogglePin({
                                userId: participant.userId,
                                username: participant.username,
                                peerId: participant.peerId,
                                isLocal: false
                              });
                            }}
                            title={`Pin ${participant.username}`}
                            className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-black/90 text-slate-300 hover:text-white transition backdrop-blur-xs z-10 cursor-pointer"
                          >
                            <Pin className="w-3 h-3" />
                          </button>

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
              )}

              {/* Dedicated Personal Media Controls Bar (Sidebar Dock - never obstructed by Chrome's bottom banner) */}
              <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <div className="w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                    {currentUser.username[0]?.toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-semibold text-slate-200 truncate max-w-[80px]">
                      {currentUser.username}
                    </span>
                    <span className="text-[9px] text-slate-400 leading-tight">
                      {isMicMuted ? 'Muted' : 'Voice Connected'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Mic Toggle */}
                  <button
                    onClick={toggleMicrophone}
                    title={isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                    className={`p-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isMicMuted
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700'
                    }`}
                  >
                    {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>

                  {/* Camera Toggle */}
                  <button
                    onClick={toggleCamera}
                    title={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                    className={`p-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isCameraOff
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700'
                    }`}
                  >
                    {isCameraOff ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                  </button>

                  {/* Deafen Toggle */}
                  <button
                    onClick={toggleSpeaker}
                    title={isSpeakerMuted ? 'Unmute Audio' : 'Deafen Audio'}
                    className={`p-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isSpeakerMuted
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    }`}
                  >
                    {isSpeakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
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
      {/* Dedicated audio receivers for all remote webcam/mic streams so speech is never cut off */}
      <div className="hidden" aria-hidden="true">
        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <audio
            key={`remote-audio-${peerId}`}
            data-participant-audio="true"
            ref={el => {
              if (el && el.srcObject !== stream) {
                el.srcObject = stream;
                if (selectedAudioOutput && 'setSinkId' in el) {
                  el.setSinkId(selectedAudioOutput).catch(e => console.warn('setSinkId error:', e));
                }
                el.play().catch(e => console.warn('Remote mic audio play error:', e));
              }
            }}
            autoPlay
            playsInline
            muted={isSpeakerMuted}
          />
        ))}

        {/* Dedicated audio receiver for Screen Share System / Movie Audio (Full 48kHz Stereo) */}
        {!roomState.isHost && (
          <audio
            ref={remoteScreenAudioRef}
            autoPlay
            playsInline
            muted={isSpeakerMuted}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Subcomponent to safely attach participant media stream to video element
 */
function ParticipantVideo({ stream, isSpeakerMuted, className = "w-full h-full object-cover" }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !stream) return;

    videoEl.srcObject = stream;
    const playVideo = () => {
      videoEl.play().catch(err => {
        console.warn('Autoplay notice on participant video:', err);
      });
    };

    playVideo();

    stream.addEventListener('addtrack', playVideo);
    stream.getVideoTracks().forEach(track => {
      track.addEventListener('unmute', playVideo);
    });

    return () => {
      stream.removeEventListener('addtrack', playVideo);
      stream.getVideoTracks().forEach(track => {
        track.removeEventListener('unmute', playVideo);
      });
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={true}
      className={className}
    />
  );
}
