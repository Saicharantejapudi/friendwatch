Act as a Senior Full-Stack Software Engineer. Help me build a complete, real-time web-based Watch Party application using React, Tailwind CSS, Node.js, Express, Socket.io, WebRTC (PeerJS), and Supabase (or MongoDB).

### 1. Database & Authentication System
- Authentication: Support user registration and login using persistent user sessions (e.g., Supabase Auth or JWT with MongoDB).
- User Model/Table:
  - User ID, Username, Email, Password Hash, Created At.
- Flow:
  - Provide a clean, dark-themed Login / Register page as the entry point.
  - Upon successful login, store session tokens and display the Room Selection screen (Create New Room or Join Existing Room via Room Code).

### 2. User Roles & Strict Access Control
- Room Creator (Host):
  - Sole permission to trigger Screen Sharing (`navigator.mediaDevices.getDisplayMedia()`) inside the main player container.
  - Controls room configuration and playback/stream settings.
- Audience (Participants):
  - Maximum of 6 participants total allowed in a single watch party room.
  - Can view the host's screen share stream, participate in WebRTC video/audio chat, and send text messages.
  - MUST NOT have access to the Screen Share button or functionality.

### 3. UI Layout & Split-Panel Structure
Implement a sleek, dark-mode UI (inspired by Twitch/Discord, `#0f172a` slate/dark gray palette) with a strict split-panel container layout:

- Main Screen Share Area (Left Panel - 70% to 75% width):
  - Dedicated video container that renders the host's screen share stream directly inside the web page (NOT in a separate floating browser window).
  - Proper aspect ratio adjustment (16:9, letterbox handling) so shared movies fit cleanly without distortion or stretching.
  - Host Controls Overlay: Share Screen button, Microphone Toggle, Speaker Toggle, and Stream Info badge.

- Interactive Sidebar (Right Panel - 25% to 30% width):
  - Top Section (Webcam Grid): Vertical 2x3 grid rendering up to 6 participant webcam feeds via PeerJS. Includes user avatar fallback, active speaker highlighted border, name tag overlays, and mic mute status badges.
  - Bottom Section (Chat Window): Real-time text chat feed using Socket.io, displaying timestamps, usernames, system event announcements (e.g., "User joined"), and auto-scroll functionality.
  - Footer Control Bar: Quick toggles for Voice Chat (On/Off), Video Chat (On/Off), and Text Chat visibility.

### 4. Audio Quality & Voice Crispness (Discord-Quality Audio)
- Configure WebRTC audio constraints to ensure crisp voice quality that does not get muted or drowned out by movie background audio:
  - Echo Cancellation: Enabled
  - Noise Suppression: Enabled
  - Auto Gain Control: Enabled
  - High Bitrate Audio Encoding: Force Opus audio codec with a target bitrate of 64kbps–128kbps stereo for maximum voice clarity alongside movie sound.
- When sharing screens via `getDisplayMedia()`, ensure tab/system audio capture is explicitly configured (`audio: true`).

### 5. Technical Deliverables Requested
Provide fully commented, production-grade code files:
1. `server.js`: Node.js Express server with Socket.io room management, user authentication token validation, and signaling logic.
2. `App.jsx`: Full React frontend component integrating layout grids, Socket.io event listeners, WebRTC/PeerJS webcam mesh, screen share stream handling, and responsive Tailwind CSS styling.
3. Step-by-step instructions on setting up environment variables and running the project locally.