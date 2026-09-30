# 🍿 FriendWatch — Real-Time Web-Based Watch Party

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS-orange.svg)](https://peerjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-v4-black.svg)](https://socket.io/)

**FriendWatch** is a production-grade, real-time web application for synchronized movie nights and watch parties with friends. Built with a dark-mode UI inspired by Discord and Twitch, it features 1080p screen sharing with system audio, a 2x3 WebRTC webcam mesh grid for up to 6 participants, active speaker detection, and low-latency text chat.

---

## 🚀 Key Features

### 1. 🔐 Database & Persistent Authentication
- **User Authentication**: Secure user registration and login using salted **bcrypt** password hashes and **JWT** session tokens.
- **Persistent Storage**: Out-of-the-box zero-setup persistent storage with fallback support for MongoDB or Supabase via `.env`.
- **Lobby Navigation**: Intuitive room selection flow allowing users to either **Create a Room** (as Host) or **Join with a 6-character Room Code** (`FW-XXXX`).

### 2. 🛡️ User Roles & Strict Access Control
- **Host (Room Creator)**:
  - Exclusive access to trigger Screen Sharing (`navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`).
  - Controls playback stream, room settings, and member status.
- **Audience (Participants)**:
  - Strictly limited to a maximum of **6 participants** per watch party room (enforced at both the Socket.io server and UI levels).
  - Can view the Host's live screen share stream, participate in the 2x3 webcam grid, and interact via real-time chat.
  - Screen share functionality is strictly disabled and hidden for non-host participants.

### 3. 🎨 Twitch / Discord Inspired Split-Panel UI (`#0f172a` Palette)
- **Main Cinema Player (Left Panel — 70% to 75% width)**:
  - 16:9 aspect ratio container with clean letterboxing to prevent movie distortion.
  - Floating status badges: `LIVE 1080P`, `Opus Stereo 48kHz`, and Fullscreen cinema mode toggle.
  - Host control bar: Screen Share toggle, Microphone mute, Speaker mute, and Camera toggle.
- **Interactive Sidebar (Right Panel — 25% to 30% width)**:
  - **Top Webcam Grid (2x3 Mesh)**: Up to 6 participant feeds via PeerJS with user initials fallback, role tags (`HOST`, `YOU`), and mic mute indicators.
  - **Active Speaker Highlighting**: Web Audio API `AnalyserNode` monitoring real-time volume levels to apply an emerald glowing border to whoever is speaking.
  - **Bottom Chat Window**: Real-time Socket.io text feed with timestamps, username labels, system alerts (e.g., joins, leaves, screen shares), and auto-scroll.

### 4. 🎙️ Discord-Quality Voice & Audio Crispness
- WebRTC constraints tuned specifically so voices never get drowned out by loud movie explosions or background scores:
  - `echoCancellation: true`
  - `noiseSuppression: true`
  - `autoGainControl: true`
  - Opus codec stereo profile at 48kHz / 64kbps–128kbps.
- Tab and system audio captured alongside video during screen sharing (`audio: true`).

---

## 📁 Repository Structure

```text
friendwatch/
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore rules
├── App.jsx                   # Root deliverable React component
├── package.json              # Root project dependencies & runner scripts
├── prompt.md                 # Project architecture specifications
├── README.md                 # Complete documentation & setup instructions
├── server.js                 # Express + Socket.io + PeerServer + Auth backend
├── data/                     # Persistent storage directory
│   └── users.json            # Seeded persistent user credentials
└── client/                   # React frontend application
    ├── index.html            # Main HTML with Inter font & dark theme
    ├── package.json          # Frontend dependencies (React, Vite, Tailwind)
    ├── postcss.config.js     # PostCSS configuration
    ├── tailwind.config.js    # Tailwind configuration with Discord palette
    ├── vite.config.js        # Vite build configuration
    └── src/
        ├── App.jsx           # Main React component
        ├── index.css         # Custom scrollbars, glassmorphism, video letterbox
        └── main.jsx          # React DOM entrypoint
```

---

## 🛠️ Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [npm](https://www.npmjs.com/) `>= 10.0.0`

### Step 1: Clone the Repository
```bash
git clone https://github.com/Saicharantejapudi/friendwatch.git
cd friendwatch
```

### Step 2: Install Dependencies
Run the unified installer script to install both root server and client dependencies:
```bash
npm run install:all
```
*(Or install manually: `npm install && npm --prefix client install`)*

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default `.env` configuration:
```env
PORT=5000
JWT_SECRET=super_secret_jwt_key_friendwatch_2026
NODE_ENV=development
```

### Step 4: Run the Application in Development Mode
Start both the backend server and frontend development server concurrently:
```bash
npm run dev
```

- **Backend API & PeerJS Server**: [http://localhost:5000](http://localhost:5000)
- **Frontend Vite Application**: [http://localhost:5173](http://localhost:5173)

---

## 🧪 Testing Multi-User Watch Parties

To test multiple participants locally:
1. Open [http://localhost:5173](http://localhost:5173) in your primary browser window.
2. Register an account (e.g., `HostUser`) and click **"Create Room as Host"**.
3. Copy the 6-character room code (e.g., `FW-8K2A`).
4. Click **"Share Screen & Audio"** to start streaming a video or tab.
5. Open an **Incognito / Private** window or a second browser.
6. Register a second account (e.g., `AudienceUser`) and click **"Join with Room Code"**.
7. Enter the room code and join the watch party! Notice that the audience member:
   - Sees the host's screen share stream with 16:9 letterboxing.
   - Does **not** have access to the screen share button.
   - Can speak, chat, and toggle their webcam in the 2x3 grid.

---

## 📦 Production Deployment

To build and serve the production bundle through the Node.js Express server:
```bash
# Build the client
npm run build

# Start the unified production server
npm start
```
The Express server will automatically serve the compiled frontend from `client/dist` on port `5000`.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
