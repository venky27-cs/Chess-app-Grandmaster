const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
// Serve static files from the current directory
app.use(express.static(__dirname));

const isCatalyst = !!process.env.X_ZOHO_CATALYST_LISTEN_PORT;
const USERS_FILE = isCatalyst ? '/tmp/users.json' : path.join(__dirname, 'users.json');

function loadUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, JSON.stringify({}));
        }
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    } catch (e) {
        console.error("Error loading users:", e);
        return {};
    }
}

function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 4));
    } catch (e) {
        console.error("Error saving users:", e);
    }
}

const GAMES_FILE = isCatalyst ? '/tmp/games.json' : path.join(__dirname, 'games.json');

function loadGames() {
    try {
        if (!fs.existsSync(GAMES_FILE)) {
            fs.writeFileSync(GAMES_FILE, JSON.stringify([]));
        }
        return JSON.parse(fs.readFileSync(GAMES_FILE, 'utf-8'));
    } catch (e) {
        console.error("Error loading games:", e);
        return [];
    }
}

function saveGames(games) {
    try {
        fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 4));
    } catch (e) {
        console.error("Error saving games:", e);
    }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Auth endpoints
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    const users = loadUsers();
    if (users[username]) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    users[username] = {
        passwordHash: hashPassword(password),
        elo: 1000 // default persistent ELO
    };
    saveUsers(users);

    res.json({ message: 'Registration successful', username, elo: 1000 });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const users = loadUsers();
    const user = users[username];
    
    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ message: 'Login successful', username, elo: user.elo });
});

app.post('/api/social-login', (req, res) => {
    const { provider, email } = req.body;
    if (!provider || !email) return res.status(400).json({ error: 'Provider and email required' });

    // Mock username generation from email (e.g., test@gmail.com -> test_Google)
    const baseName = email.split('@')[0];
    const username = `${baseName}_${provider}`;

    const users = loadUsers();
    
    // Auto-register if doesn't exist
    if (!users[username]) {
        users[username] = {
            passwordHash: hashPassword(crypto.randomBytes(16).toString('hex')), // random dummy password
            elo: 1000
        };
        saveUsers(users);
    }

    res.json({ message: 'Social login successful', username, elo: users[username].elo });
});

app.get('/api/my-games', (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required' });
    
    const games = loadGames();
    const myGames = games.filter(g => g.white === username || g.black === username);
    res.json(myGames);
});

// In-memory Database
const players = {}; // socket.id -> { username, elo, socket, roomId, color, isAuth }
// Queue separated by time control (minutes)
const matchmakingQueues = {
    1: [], // Bullet
    5: [], // Blitz
    15: [], // Rapid
    90: [], // Classical
};
const activeRooms = {}; // roomId -> { white: socket.id, black: socket.id, state: {} }

// Basic ELO calculation
function calculateElo(ratingA, ratingB, scoreA) {
    const K = 32;
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    return Math.round(ratingA + K * (scoreA - expectedA));
}

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Default player registration
    players[socket.id] = {
        username: 'Guest_' + socket.id.substring(0, 4),
        elo: 100,
        socket: socket,
        roomId: null,
        color: null
    };

    socket.on('set_username', (username) => {
        if (players[socket.id] && !players[socket.id].isAuth) {
            players[socket.id].username = username || players[socket.id].username;
        }
    });

    socket.on('authenticate', ({ username, token }) => {
        // In a real app we would verify a token. For this MVP, if the client emits authenticate
        // with a username, we assume they successfully hit the login API.
        const users = loadUsers();
        if (users[username]) {
            players[socket.id].username = username;
            players[socket.id].elo = users[username].elo;
            players[socket.id].isAuth = true;
            console.log(socket.id, 'authenticated as', username);
        }
    });

    socket.on('join_queue', (timeControl) => {
        console.log(socket.id, 'joined queue for', timeControl, 'min');
        if (!matchmakingQueues[timeControl]) return; // Invalid time control

        // Ensure player isn't in any queue already
        for (const tc in matchmakingQueues) {
            matchmakingQueues[tc] = matchmakingQueues[tc].filter(id => id !== socket.id);
        }

        matchmakingQueues[timeControl].push(socket.id);
        tryMatchmaking(timeControl);
    });

    socket.on('leave_queue', () => {
        console.log(socket.id, 'left queue');
        for (const tc in matchmakingQueues) {
            matchmakingQueues[tc] = matchmakingQueues[tc].filter(id => id !== socket.id);
        }
    });

    socket.on('make_move', (moveData) => {
        const p = players[socket.id];
        if (p && p.roomId && activeRooms[p.roomId]) {
            let room = activeRooms[p.roomId];
            
            if (!room.moves) room.moves = [];
            room.moves.push(moveData);

            let now = Date.now();
            let elapsed = Math.round((now - room.lastMoveTime) / 1000);
            
            room.timeRemaining[room.turn] -= elapsed;
            if (room.timeRemaining[room.turn] < 0) room.timeRemaining[room.turn] = 0;
            
            room.turn = room.turn === 'w' ? 'b' : 'w';
            room.lastMoveTime = now;

            // Broadcast to the other person in the room
            socket.to(p.roomId).emit('opponent_move', moveData);
            
            // Broadcast authoritative time sync
            io.to(p.roomId).emit('time_sync', room.timeRemaining);
        }
    });

    socket.on('resign', () => {
        const p = players[socket.id];
        if (p && p.roomId && activeRooms[p.roomId]) {
            socket.to(p.roomId).emit('opponent_resigned');
        }
    });

    socket.on('offer_draw', () => {
        const p = players[socket.id];
        if (p && p.roomId && activeRooms[p.roomId]) {
            socket.to(p.roomId).emit('draw_offered');
        }
    });

    socket.on('accept_draw', () => {
        const p = players[socket.id];
        if (p && p.roomId && activeRooms[p.roomId]) {
            socket.to(p.roomId).emit('draw_accepted');
        }
    });

    socket.on('decline_draw', () => {
        const p = players[socket.id];
        if (p && p.roomId && activeRooms[p.roomId]) {
            socket.to(p.roomId).emit('draw_declined');
        }
    });

    socket.on('game_over', (result) => {
        const p = players[socket.id];
        if (!p || !p.roomId) return;

        const room = activeRooms[p.roomId];
        if (!room) return;

        // Result: { winner: 'w' | 'b' | 'draw' }
        if (room.white && room.black) {
            let pWhite = players[room.white];
            let pBlack = players[room.black];

            if (pWhite && pBlack) {
                let scoreW = 0.5, scoreB = 0.5;
                if (result.winner === 'w') { scoreW = 1; scoreB = 0; }
                else if (result.winner === 'b') { scoreW = 0; scoreB = 1; }
                else if (result.winner === 'abandon') {
                    if (p.color === 'w') { scoreW = 0; scoreB = 1; }
                    else { scoreW = 1; scoreB = 0; }
                }

                let newEloW = calculateElo(pWhite.elo, pBlack.elo, scoreW);
                let newEloB = calculateElo(pBlack.elo, pWhite.elo, scoreB);

                pWhite.elo = newEloW;
                pBlack.elo = newEloB;

                io.to(pWhite.socket.id).emit('elo_update', { newElo: newEloW });
                io.to(pBlack.socket.id).emit('elo_update', { newElo: newEloB });

                // Persist ELO
                const users = loadUsers();
                let dirty = false;
                if (pWhite.isAuth && users[pWhite.username]) {
                    users[pWhite.username].elo = newEloW;
                    dirty = true;
                }
                if (pBlack.isAuth && users[pBlack.username]) {
                    users[pBlack.username].elo = newEloB;
                    dirty = true;
                }
                if (dirty) saveUsers(users);

                // Persist Game
                const games = loadGames();
                games.push({
                    id: p.roomId,
                    date: new Date().toISOString(),
                    white: pWhite.username,
                    black: pBlack.username,
                    whiteElo: pWhite.elo, // updated Elo
                    blackElo: pBlack.elo,
                    winner: result.winner, // 'w', 'b', 'draw', or 'abandon'
                    moves: room.moves || []
                });
                saveGames(games);
            }
        }

        // Cleanup room
        if (room.white && players[room.white]) players[room.white].roomId = null;
        if (room.black && players[room.black]) players[room.black].roomId = null;
        delete activeRooms[p.roomId];
    });

    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);

        // Remove from queues
        for (const tc in matchmakingQueues) {
            matchmakingQueues[tc] = matchmakingQueues[tc].filter(id => id !== socket.id);
        }

        // Handle active games
        const p = players[socket.id];
        if (p && p.roomId && activeRooms[p.roomId]) {
            socket.to(p.roomId).emit('opponent_disconnected');
            // Clean up the room
            const room = activeRooms[p.roomId];
            let opponentId = p.color === 'w' ? room.black : room.white;
            if (opponentId && players[opponentId]) players[opponentId].roomId = null;
            delete activeRooms[p.roomId];
        }

        delete players[socket.id];
    });
});

function tryMatchmaking(timeControl) {
    let queue = matchmakingQueues[timeControl];
    if (!queue) return;

    while (queue.length >= 2) {
        const player1Id = queue.shift();
        const player2Id = queue.shift();

        const p1 = players[player1Id];
        const p2 = players[player2Id];

        if (p1 && p2) {
            const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            activeRooms[roomId] = {
                white: player1Id,
                black: player2Id,
                state: {},
                timeRemaining: { w: timeControl * 60, b: timeControl * 60 },
                lastMoveTime: Date.now(),
                turn: 'w'
            };

            p1.roomId = roomId;
            p1.color = 'w';
            p1.socket.join(roomId);

            p2.roomId = roomId;
            p2.color = 'b';
            p2.socket.join(roomId);

            // Send back the agreed-upon time control as well
            p1.socket.emit('match_found', { color: 'w', opponentName: p2.username, opponentElo: p2.elo, timeControl });
            p2.socket.emit('match_found', { color: 'b', opponentName: p1.username, opponentElo: p1.elo, timeControl });

            console.log(`Matched ${p1.username} (White) vs ${p2.username} (Black) in ${roomId} [${timeControl} min]`);
        }
    }
}

const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
