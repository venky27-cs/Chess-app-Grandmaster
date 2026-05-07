# Grandmaster: Real-Time Multiplayer Chess & Analysis

Grandmaster is a feature-rich, real-time multiplayer chess web application built with a Node.js backend and a modern vanilla JavaScript frontend. It features live matchmaking, persistent Elo tracking, and on-demand, post-game PDF analysis powered directly by the Stockfish chess engine in the browser.

## Features
- 🌍 **Real-Time Multiplayer**: Play online with a fully synchronized game state via Socket.io.
- ⏱️ **Matchmaking Queues**: Join queues based on time controls (Bullet, Blitz, Rapid, Classical).
- 📈 **Persistent User Profiles**: Built-in authentication system with persistent Elo rating tracking across sessions.
- 🤖 **Stockfish Engine Analysis**: Integrated Stockfish WebAssembly allows for instant, client-side game evaluations without server lag.
- 📄 **PDF Analysis Reports**: Automatically generate and download beautiful post-game PDF reports highlighting blunders, mistakes, great moves, and phase-by-phase accuracy.
- 📜 **Game History**: Automatically logs every match to a persistent database so users can browse their historical games and download analysis reports at any time.
- 🔐 **Social Login Integration**: Mock Google and Microsoft OAuth flows designed for rapid prototyping and testing.

## Tech Stack
- **Frontend**: HTML5, Vanilla JavaScript, CSS3
- **Backend**: Node.js, Express
- **Real-Time Communication**: Socket.io
- **Engine**: Stockfish.js (WebAssembly)
- **PDF Generation**: jsPDF

## Local Development
To run this project locally on your machine:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YourUsername/chess-game.git
   cd chess-game
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   node server.js
   ```

4. **Play!**
   Open your browser and navigate to `http://localhost:3000` to start playing.

## License
MIT License
