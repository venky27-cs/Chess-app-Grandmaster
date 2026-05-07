document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const boardEl = document.getElementById('chessboard');
    const turnIndicator = document.getElementById('turn-indicator');
    const gameMessage = document.getElementById('game-message');
    const playerEloInfo = document.getElementById('player-elo-info');
    const historyEl = document.getElementById('move-history');

    // Captures
    const bCap = document.getElementById('captured-black'); // captured BY white
    const wCap = document.getElementById('captured-white'); // captured BY black

    // Modals & Controls
    const promoModal = document.getElementById('promotion-modal');
    const promoDomPieces = document.querySelectorAll('.promo-piece');
    const gameOverModal = document.getElementById('game-over-modal');
    const endTitle = document.getElementById('end-title');
    const endDesc = document.getElementById('end-desc');

    // Mode Selection Modal
    const modeSelectModal = document.getElementById('mode-select-modal');
    
    // Auth Modal DOM
    const authModal = document.getElementById('auth-modal');
    const authUsernameInput = document.getElementById('auth-username');
    const authPasswordInput = document.getElementById('auth-password');
    const btnAuthSubmit = document.getElementById('btn-auth-submit');
    const authToggleBtn = document.getElementById('auth-toggle-btn');
    const authToggleText = document.getElementById('auth-toggle-text');
    const authTitle = document.getElementById('auth-title');
    const authError = document.getElementById('auth-error');
    const welcomeMessage = document.getElementById('welcome-message');
    const btnAuthGoogle = document.getElementById('btn-auth-google');
    const btnAuthMicrosoft = document.getElementById('btn-auth-microsoft');

    let isLoginMode = true;
    let authSession = { username: null, elo: 1000 };
    const btnPlayOnline = document.getElementById('btn-play-online');
    const btnPlayLocal = document.getElementById('btn-play-local');
    const mainModeOptions = document.getElementById('main-mode-options');
    const onlineTimeSelectPane = document.getElementById('online-time-select-pane');
    const onlineTimeControlSelect = document.getElementById('online-time-control-select');
    const btnFindMatch = document.getElementById('btn-find-match');
    const btnCancelOnlineSetup = document.getElementById('btn-cancel-online-setup');
    const matchmakingStatus = document.getElementById('matchmaking-status');
    const btnCancelSearch = document.getElementById('btn-cancel-search');
    
    // Games History Modal
    const btnMyGames = document.getElementById('btn-my-games');
    const gamesHistoryModal = document.getElementById('games-history-modal');
    const btnCloseGames = document.getElementById('btn-close-games');
    const gamesListContainer = document.getElementById('games-list-container');

    const btnRestart = document.getElementById('btn-restart');
    const btnUndo = document.getElementById('btn-undo');
    const btnPlayAgain = document.getElementById('btn-play-again');
    const btnDownloadReport = document.getElementById('btn-download-report');
    
    const btnOfferDraw = document.getElementById('btn-offer-draw');
    const btnResign = document.getElementById('btn-resign');
    const drawOfferModal = document.getElementById('draw-offer-modal');
    const btnAcceptDraw = document.getElementById('btn-accept-draw');
    const btnDeclineDraw = document.getElementById('btn-decline-draw');

    // Stockfish Evaluation Pool
    let stockfishPool = {
        workers: [],
        queue: [], // Job Array
        size: Math.min(16, navigator.hardwareConcurrency || 8),
        init() {
            if (typeof Worker === 'undefined') return;
            for (let i = 0; i < this.size; i++) {
                const w = new Worker('stockfish.js');
                w.postMessage('uci');
                const workerObj = {
                    worker: w,
                    busy: false,
                    resolver: null,
                    currentEval: null,
                    timeout: null
                };
                this.workers.push(workerObj);
                
                w.onmessage = (event) => {
                    const line = event.data;
                    if (line.match(/^info depth \d+ .*score (cp|mate) (-?\d+)/)) {
                        const match = line.match(/score (cp|mate) (-?\d+)/);
                        if (match) {
                            let score = parseInt(match[2], 10);
                            if (match[1] === 'mate') {
                                score = score > 0 ? 9999 - score : -9999 - score;
                            }
                            workerObj.currentEval = score;
                        }
                    } else if (line.startsWith('bestmove')) {
                        if (workerObj.resolver) {
                            if (workerObj.timeout) clearTimeout(workerObj.timeout);
                            const res = workerObj.resolver;
                            const ev = workerObj.currentEval;
                            workerObj.resolver = null;
                            workerObj.busy = false;
                            workerObj.currentEval = null;
                            res(ev || 0);
                            this.processQueue(); // Automatically pull next job
                        }
                    }
                };
            }
        },
        processQueue() {
            if (this.queue.length === 0) return;
            const freeWorker = this.workers.find(w => !w.busy);
            if (!freeWorker) return; // Wait for a worker to finish
            
            const job = this.queue.shift(); // Get next job
            freeWorker.busy = true;

            const timeout = setTimeout(() => {
                console.warn("Stockfish worker timed out for position:", job.moveListStr);
                freeWorker.busy = false;
                job.resolve(0);
                this.processQueue(); // Release worker and move on
            }, 10000); // 10s timeout

            freeWorker.timeout = timeout;
            freeWorker.resolver = job.resolve;

            const cmd = job.moveListStr.trim() === "" ? "position startpos" : "position startpos moves " + job.moveListStr;
            freeWorker.worker.postMessage(cmd);
            freeWorker.worker.postMessage('go depth 10');
            
            // Check if there are more jobs AND more free workers simultaneously
            this.processQueue(); 
        },
        async evaluate(moveListStr) {
            // For now, let Stockfish handle the position evaluation.
            // Avoid using undefined tempGame.move() which breaks the promise string.
            return new Promise((resolve) => {
                this.queue.push({ moveListStr, resolve });
                this.processQueue(); // Trigger queue check
            });
        }
    };
    stockfishPool.init();

    // Original manager kept for single-move UI evals if needed, but pointed to pool
    let stockfishManager = {
        async evaluatePosition(moveListStr) {
            return stockfishPool.evaluate(moveListStr);
        }
    };

    // Unicode mapping
    const unicodePieces = {
        'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
    };

    let game = new Chess();
    let selectedSq = null;
    let legalMovesForSelected = [];
    let pendingPromoMove = null;

    // Mode State
    let isOnline = false;
    let myColor = 'w';
    let myElo = 100;
    let opponentName = '';

    // Timers
    let timerInterval = null;
    let timeLimitSeconds = null;
    let timeRemaining = { w: 0, b: 0 };

    // Socket.io
    let socket = null;
    if (typeof io !== 'undefined') {
        socket = io();

        socket.on('match_found', (data) => {
            isOnline = true;
            myColor = data.color;
            opponentName = data.opponentName;

            playerEloInfo.textContent = `You vs ${opponentName} (ELO: ${data.opponentElo})`;

            // Lock UI for online play
            btnUndo.style.display = 'none';
            btnRestart.style.display = 'none';
            btnOfferDraw.style.display = 'inline-block';
            btnResign.style.display = 'inline-block';

            // Show timers online
            document.querySelector('.timers').style.display = 'flex';

            hideModals();
            modeSelectModal.classList.add('hidden');

            timeLimitSeconds = data.timeControl * 60;
            initGame(true); // true = skip mode selection reset
        });

        socket.on('opponent_move', (moveData) => {
            executeMove(moveData, true); // true = received from opponent
        });

        socket.on('opponent_disconnected', () => {
            if (!game.isCheckmate && !game.isStalemate) {
                endGame("Opponent Disconnected", "You Win!", 'abandon');
            }
        });

        socket.on('opponent_resigned', () => {
            if (!game.isCheckmate && !game.isStalemate) {
                endGame("Opponent Resigned", "You Win!", myColor);
            }
        });

        socket.on('draw_offered', () => {
            if (!game.isCheckmate && !game.isStalemate) {
                drawOfferModal.classList.remove('hidden');
            }
        });

        socket.on('draw_accepted', () => {
            endGame("Draw Agreed", "Opponent accepted your draw offer.", 'draw');
        });

        socket.on('time_sync', (serverTime) => {
            timeRemaining = serverTime;
            updateTimersDisplay();
        });

        socket.on('draw_declined', () => {
            alert("Your opponent declined the draw offer.");
        });

        socket.on('elo_update', (data) => {
            myElo = data.newElo;
            if (isOnline) {
                playerEloInfo.textContent = `Your new ELO: ${myElo}`;
            }
        });
    }

    // --- Mode Handlers ---
    btnPlayOnline.addEventListener('click', () => {
        if (!socket) return alert('Server is not running. Online mode unavailable.');
        mainModeOptions.style.display = 'none';
        onlineTimeSelectPane.style.display = 'flex';
    });

    // --- Auth Handlers ---
    authToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        authTitle.textContent = isLoginMode ? 'Login' : 'Register';
        btnAuthSubmit.innerHTML = isLoginMode ? '<i class="fa-solid fa-right-to-bracket"></i> Login' : '<i class="fa-solid fa-user-plus"></i> Register';
        authToggleText.textContent = isLoginMode ? 'Need an account?' : 'Already have an account?';
        authToggleBtn.textContent = isLoginMode ? 'Register' : 'Login';
        authError.style.display = 'none';
    });

    btnAuthSubmit.addEventListener('click', async () => {
        const username = authUsernameInput.value.trim();
        const password = authPasswordInput.value.trim();
        
        if (!username || !password) {
            authError.textContent = "Username and password required.";
            authError.style.display = 'block';
            return;
        }

        btnAuthSubmit.disabled = true;
        const endpoint = isLoginMode ? '/api/login' : '/api/register';
        
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            
            if (res.ok) {
                authSession.username = data.username;
                authSession.elo = data.elo;
                myElo = data.elo;
                
                if (socket) {
                    socket.emit('authenticate', { username: data.username, token: 'dummy_token' });
                }

                authModal.classList.add('hidden');
                welcomeMessage.textContent = `Welcome, ${data.username}!`;
                modeSelectModal.classList.remove('hidden');
            } else {
                authError.textContent = data.error || "Authentication failed.";
                authError.style.display = 'block';
            }
        } catch (err) {
            authError.textContent = "Network error.";
            authError.style.display = 'block';
        }
        btnAuthSubmit.disabled = false;
    });

    async function handleSocialLogin(provider) {
        // Mock a user profile instead of a real OAuth flow
        const dummyEmail = `user${Math.floor(Math.random() * 10000)}@example.com`;
        
        try {
            const res = await fetch('/api/social-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, email: dummyEmail })
            });
            const data = await res.json();
            
            if (res.ok) {
                authSession.username = data.username;
                authSession.elo = data.elo;
                myElo = data.elo;
                
                if (socket) {
                    socket.emit('authenticate', { username: data.username, token: 'mock_social_token' });
                }

                authModal.classList.add('hidden');
                welcomeMessage.textContent = `Welcome, ${data.username}!`;
                modeSelectModal.classList.remove('hidden');
            } else {
                authError.textContent = data.error || `${provider} login failed.`;
                authError.style.display = 'block';
            }
        } catch (err) {
            authError.textContent = "Network error during social login.";
            authError.style.display = 'block';
        }
    }

    if (btnAuthGoogle) {
        btnAuthGoogle.addEventListener('click', () => handleSocialLogin('Google'));
    }
    
    if (btnAuthMicrosoft) {
        btnAuthMicrosoft.addEventListener('click', () => handleSocialLogin('Microsoft'));
    }

    btnCancelOnlineSetup.addEventListener('click', () => {
        onlineTimeSelectPane.style.display = 'none';
        mainModeOptions.style.display = 'flex';
    });

    btnFindMatch.addEventListener('click', () => {
        const username = authSession.username || 'Player';
        const timeControl = parseInt(onlineTimeControlSelect.value);
        if (socket) socket.emit('set_username', username);
        socket.emit('join_queue', timeControl);

        onlineTimeSelectPane.style.display = 'none';
        matchmakingStatus.classList.remove('hidden');
    });

    btnCancelSearch.addEventListener('click', () => {
        if (!socket) return;
        socket.emit('leave_queue');
        matchmakingStatus.classList.add('hidden');
        mainModeOptions.style.display = 'flex';
    });

    btnMyGames.addEventListener('click', async () => {
        if (!authSession.username) {
            alert("Please login first to view your games.");
            return;
        }

        try {
            const res = await fetch(`/api/my-games?username=${authSession.username}`);
            const games = await res.json();
            
            gamesListContainer.innerHTML = '';
            if (games.length === 0) {
                gamesListContainer.innerHTML = '<p style="text-align:center; color:var(--text-secondary);">No games found.</p>';
            } else {
                // Sort newest first
                games.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                games.forEach(g => {
                    const el = document.createElement('div');
                    el.style.display = 'flex';
                    el.style.justifyContent = 'space-between';
                    el.style.alignItems = 'center';
                    el.style.padding = '0.75rem';
                    el.style.border = '1px solid var(--panel-border)';
                    el.style.borderRadius = '8px';
                    el.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                    
                    const dateStr = new Date(g.date).toLocaleDateString();
                    const resultText = g.winner === 'draw' ? 'Draw' : 
                                      (g.winner === 'w' ? 'White Won' : 
                                      (g.winner === 'b' ? 'Black Won' : 'Abandoned'));
                                      
                    el.innerHTML = `
                        <div style="text-align: left;">
                            <strong>${g.white} (${g.whiteElo}) vs ${g.black} (${g.blackElo})</strong><br>
                            <small style="color: var(--text-secondary);">${dateStr} &bull; ${resultText} &bull; ${g.moves.length} moves</small>
                        </div>
                        <button class="btn secondary-btn btn-dl-historical" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-file-pdf"></i> Download Analysis</button>
                    `;
                    
                    const btnDl = el.querySelector('.btn-dl-historical');
                    btnDl.addEventListener('click', async () => {
                        btnDl.disabled = true;
                        btnDl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
                        
                        // Reconstruct SAN and UCI
                        let tempGame = new Chess();
                        let tempUci = [];
                        let tempSan = [];
                        
                        for (let m of g.moves) {
                            // chess.js 'makeMove' expects a structured object.
                            // However, we just need SAN string. The simplest way to get SAN is using our getSan function, but we need the exact state object which we can mock or rebuild.
                            tempGame.makeMove(m);
                            let st = tempGame.history[tempGame.history.length - 1];
                            tempSan.push(getSan(st));
                            
                            const from = indexToCoord(m.from);
                            const to = indexToCoord(m.to);
                            const promo = m.promoType || '';
                            tempUci.push(from + to + promo);
                        }
                        
                        await generateGameReportPDF(g.white, g.black, tempUci, tempSan, btnDl);
                    });
                    
                    gamesListContainer.appendChild(el);
                });
            }
            
            modeSelectModal.classList.add('hidden');
            gamesHistoryModal.classList.remove('hidden');
            
        } catch (err) {
            console.error(err);
            alert("Failed to load games.");
        }
    });

    btnCloseGames.addEventListener('click', () => {
        gamesHistoryModal.classList.add('hidden');
        modeSelectModal.classList.remove('hidden');
    });

    btnPlayLocal.addEventListener('click', () => {
        isOnline = false;
        myColor = 'w'; // Playing both sides
        modeSelectModal.classList.add('hidden');

        // Restore UI
        btnUndo.style.display = 'flex';
        btnRestart.style.display = 'flex';
        playerEloInfo.textContent = "Analysis Mode";

        // Hide timers in analysis mode
        document.querySelector('.timers').style.display = 'none';

        timeLimitSeconds = null;

        initGame(true);
    });

    function initGame(skipModeReset = false) {
        game = new Chess();
        selectedSq = null;
        legalMovesForSelected = [];
        pendingPromoMove = null;

        if (!isOnline && !skipModeReset) {
            // modeSelectModal.classList.remove('hidden'); // Do not show this automatically here if auth modal is active
            if (authSession.username) {
                modeSelectModal.classList.remove('hidden');
            } else {
                authModal.classList.remove('hidden');
            }
            return;
        }

        if (timeLimitSeconds) {
            timeRemaining = { w: timeLimitSeconds, b: timeLimitSeconds };
        } else {
            document.getElementById('timer-white').textContent = '--:--';
            document.getElementById('timer-black').textContent = '--:--';
            document.getElementById('timer-white').classList.remove('active', 'danger');
            document.getElementById('timer-black').classList.remove('active', 'danger');
        }

        if (timerInterval) clearInterval(timerInterval);
        if (timeLimitSeconds) {
            timerInterval = setInterval(tickTimer, 1000);
            updateTimersDisplay();
        }

        hideModals();
        renderBoard();
        updateUI();

        if (isOnline && myColor === 'b') {
            // we are black, board is rendered from white's perspective un-flipped for now
            // Optionally: flip board visually
            boardEl.parentElement.style.transform = "rotate(180deg)";
            Array.from(document.getElementsByClassName('square')).forEach(sq => sq.style.transform = "rotate(-180deg)");
        } else {
            boardEl.parentElement.style.transform = "rotate(0deg)";
            Array.from(document.getElementsByClassName('square')).forEach(sq => sq.style.transform = "rotate(0deg)");
        }
    }

    function indexToCoord(sq) {
        const file = String.fromCharCode(97 + (sq % 8)); // 97 is 'a'
        const rank = Math.floor(sq / 8) + 1;
        return `${file}${rank}`;
    }

    function renderBoard() {
        boardEl.innerHTML = '';

        let lastMove = game.history.length > 0 ? game.history[game.history.length - 1].move : null;

        for (let rank = 7; rank >= 0; rank--) {
            for (let file = 0; file < 8; file++) {
                const sqIndex = rank * 8 + file;
                const square = document.createElement('div');
                square.className = `square ${(rank + file) % 2 !== 0 ? 'light' : 'dark'}`;
                square.dataset.index = sqIndex;

                // Keep piece upright if board is Flipped
                if (isOnline && myColor === 'b') {
                    square.style.transform = "rotate(-180deg)";
                }

                // Highlights
                if (selectedSq === sqIndex) {
                    square.classList.add('selected');
                }

                if (lastMove && (lastMove.from === sqIndex || lastMove.to === sqIndex)) {
                    square.classList.add('last-move');
                }

                let isLegalMoveTarget = legalMovesForSelected.some(m => m.to === sqIndex);
                if (isLegalMoveTarget) {
                    let pieceAtTarget = game.getPieceAt(sqIndex);
                    // Special case for En Passant Capture highlight
                    let isEp = legalMovesForSelected.some(m => m.to === sqIndex && m.flag === 'ep');
                    if (pieceAtTarget || isEp) {
                        square.classList.add('legal-capture');
                    } else {
                        square.classList.add('legal-move');
                    }
                }

                const piece = game.getPieceAt(sqIndex);
                if (piece) {
                    const pieceEl = document.createElement('div');
                    pieceEl.className = `piece ${piece.color}`;
                    pieceEl.innerHTML = unicodePieces[piece.type];
                    square.appendChild(pieceEl);

                    if (piece.type === 'k' && piece.color === game.turn && game.inCheck) {
                        square.classList.add('in-check');
                    }
                }

                square.addEventListener('click', () => onSquareClick(sqIndex));
                boardEl.appendChild(square);
            }
        }
    }

    function onSquareClick(sqIndex) {
        if (game.isCheckmate || game.isStalemate) return;
        if (isOnline && game.turn !== myColor) return; // Prevent clicking on opponent's turn

        let piece = game.getPieceAt(sqIndex);

        // If a square is already selected, check if this click is a legal move
        if (selectedSq !== null) {
            let possibleMoves = legalMovesForSelected.filter(m => m.to === sqIndex);

            if (possibleMoves.length > 0) {
                let move = possibleMoves[0]; // Take first match

                // Handle Promotion
                if (move.flag === 'promo') {
                    pendingPromoMove = possibleMoves; // Save all promo options for this dest
                    promoModal.classList.remove('hidden');
                    return;
                }

                executeMove(move);
                return;
            }
        }

        // If clicking own piece, select it
        if (piece && piece.color === game.turn) {
            selectedSq = sqIndex;
            legalMovesForSelected = game.getLegalMovesForSquare(sqIndex);
            renderBoard();
        } else {
            // Unselect
            selectedSq = null;
            legalMovesForSelected = [];
            renderBoard();
        }
    }

    promoDomPieces.forEach(el => {
        el.addEventListener('click', (e) => {
            if (!pendingPromoMove) return;
            let pType = e.target.dataset.piece;
            let moveToExecute = pendingPromoMove.find(m => m.promoType === pType);
            promoModal.classList.add('hidden');
            pendingPromoMove = null;
            if (moveToExecute) {
                executeMove(moveToExecute);
            }
        });
    });

    function executeMove(move, isFromNetwork = false) {
        if (isOnline && !isFromNetwork) {
            socket.emit('make_move', move);
        }

        game.makeMove(move);
        selectedSq = null;
        legalMovesForSelected = [];

        updateUI();
    }

    function updateUI() {
        renderBoard();
        updateGameStatus();
        updateMoveHistory();
        updateCaptures();
        updateTimersDisplay();
        btnUndo.disabled = game.history.length === 0 || isOnline;
    }

    function updateGameStatus() {
        if (game.isCheckmate) {
            endGame("Checkmate!", game.turn === 'w' ? "Black wins!" : "White wins!", game.turn === 'w' ? 'b' : 'w');
        } else if (game.isStalemate) {
            endGame("Stalemate", "Draw", 'draw');
        } else {
            turnIndicator.textContent = game.turn === 'w' ? "White's Turn" : "Black's Turn";
            turnIndicator.style.color = "var(--text-primary)";
            if (game.inCheck) {
                gameMessage.textContent = "Check!";
                gameMessage.style.color = "var(--highlight-check)";
            } else {
                gameMessage.textContent = "";
            }
        }
    }

    function endGame(title, desc, winner) {
        game.isCheckmate = true; // halt interaction
        turnIndicator.textContent = title;
        turnIndicator.style.color = "var(--highlight-check)";
        gameMessage.textContent = desc;
        endTitle.textContent = title;
        endDesc.textContent = desc;

        if (timerInterval) clearInterval(timerInterval);

        if (isOnline) {
            btnPlayAgain.textContent = "Return to Menu";
            if (winner) socket.emit('game_over', { winner });
        } else {
            btnPlayAgain.textContent = "Play Again";
        }

        btnDownloadReport.style.display = 'inline-block';
        btnDownloadReport.classList.remove('hidden');
        btnDownloadReport.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download Analysis Report';
        btnDownloadReport.disabled = false;

        gameOverModal.classList.remove('hidden');
    }

    function formatTime(seconds) {
        let m = Math.floor(seconds / 60);
        let s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function updateTimersDisplay() {
        if (!timeLimitSeconds) return;
        const wTimer = document.getElementById('timer-white');
        const bTimer = document.getElementById('timer-black');

        wTimer.textContent = formatTime(timeRemaining.w);
        bTimer.textContent = formatTime(timeRemaining.b);

        wTimer.classList.remove('active', 'danger');
        bTimer.classList.remove('active', 'danger');

        if (game.isCheckmate || game.isStalemate) {
            if (timerInterval) clearInterval(timerInterval);
            return;
        }

        const activeTimer = game.turn === 'w' ? wTimer : bTimer;
        activeTimer.classList.add('active');

        if (timeRemaining[game.turn] <= 30 && timeLimitSeconds > 0) {
            activeTimer.classList.add('danger');
        }
    }

    function tickTimer() {
        if (game.isCheckmate || game.isStalemate) {
            clearInterval(timerInterval);
            return;
        }

        timeRemaining[game.turn]--;
        updateTimersDisplay();

        if (timeRemaining[game.turn] <= 0) {
            clearInterval(timerInterval);
            handleTimeout();
        }
    }

    function handleTimeout() {
        endGame("Time Out!", game.turn === 'w' ? "Black wins!" : "White wins!", game.turn === 'w' ? 'b' : 'w');
    }

    function getSan(state) {
        let m = state.move;

        // Basic SAN. We skip ambiguity resolution for simplicity in this MVP snippet.
        if (m.flag === 'k-castle') return 'O-O';
        if (m.flag === 'q-castle') return 'O-O-O';

        let p = m.piece === 'p' ? '' : m.piece.toUpperCase();
        let cap = m.captured ? 'x' : '';
        if (m.piece === 'p' && m.captured) {
            cap = String.fromCharCode(97 + (m.from % 8)) + 'x';
        }

        let dest = indexToCoord(m.to);
        let promo = m.promoType ? '=' + m.promoType.toUpperCase() : '';

        return `${p}${cap}${dest}${promo}`;
    }

    function updateMoveHistory() {
        historyEl.innerHTML = '';
        let moves = game.history;

        let movePair = '';
        let index = 1;

        for (let i = 0; i < moves.length; i += 2) {
            let row = document.createElement('div');
            row.className = 'move-row';

            let num = document.createElement('div');
            num.className = 'move-number';
            num.textContent = `${index}.`;

            let wMove = document.createElement('div');
            wMove.className = 'move';
            wMove.textContent = getSan(moves[i]);

            let bMove = document.createElement('div');
            bMove.className = 'move';
            if (moves[i + 1]) {
                bMove.textContent = getSan(moves[i + 1]);
            }

            if (i === moves.length - 1 || i + 1 === moves.length - 1) {
                let mNodes = [wMove, bMove];
                mNodes[moves.length - 1 - i].classList.add('active');
            }

            row.appendChild(num);
            row.appendChild(wMove);
            row.appendChild(bMove);
            historyEl.appendChild(row);

            index++;
        }

        historyEl.scrollTop = historyEl.scrollHeight;
    }

    function updateCaptures() {
        // Collect dead pieces by parsing history or tracking missing fen elements
        let deadW = [];
        let deadB = [];

        game.history.forEach(state => {
            let cap = state.move.captured;
            if (cap) {
                if (cap.color === 'w') deadW.push(cap.type);
                if (cap.color === 'b') deadB.push(cap.type);
            }
            // ep captures
            if (state.move.flag === 'ep' && state.epCaptured) {
                if (state.epCaptured.color === 'w') deadW.push('p');
                if (state.epCaptured.color === 'b') deadB.push('p');
            }
        });

        const pieceSortMap = { 'q': 1, 'r': 2, 'b': 3, 'n': 4, 'p': 5 };
        deadW.sort((a, b) => pieceSortMap[a] - pieceSortMap[b]);
        deadB.sort((a, b) => pieceSortMap[a] - pieceSortMap[b]);

        bCap.innerHTML = deadB.map(p => `<span class="piece b">${unicodePieces[p]}</span>`).join('');
        wCap.innerHTML = deadW.map(p => `<span class="piece w">${unicodePieces[p]}</span>`).join('');
    }

    function hideModals() {
        promoModal.classList.add('hidden');
        gameOverModal.classList.add('hidden');
        drawOfferModal.classList.add('hidden');
    }

    btnRestart.addEventListener('click', () => initGame(true));
    btnPlayAgain.addEventListener('click', () => {
        if (isOnline) {
            isOnline = false;
            onlineTimeSelectPane.style.display = 'none';
            matchmakingStatus.classList.add('hidden');
            mainModeOptions.style.display = 'flex';
            
            btnOfferDraw.style.display = 'none';
            btnResign.style.display = 'none';
            btnUndo.style.display = 'inline-block';
            btnRestart.style.display = 'inline-block';

            initGame(false); // return to mode select
        } else {
            initGame(true);
        }
    });

    btnUndo.addEventListener('click', () => {
        if (isOnline) return;
        if (game.history.length > 0) {
            game.undoMove();
            selectedSq = null;
            legalMovesForSelected = [];
            updateUI();
        }
    });

    btnResign.addEventListener('click', () => {
        if (!isOnline) return;
        if (confirm("Are you sure you want to resign?")) {
            socket.emit('resign');
            let winner = myColor === 'w' ? 'b' : 'w';
            endGame("You Resigned", "Opponent Wins!", winner);
        }
    });

    btnOfferDraw.addEventListener('click', () => {
        if (!isOnline) return;
        socket.emit('offer_draw');
        alert("Draw offer sent to opponent.");
    });

    btnAcceptDraw.addEventListener('click', () => {
        drawOfferModal.classList.add('hidden');
        socket.emit('accept_draw');
        endGame("Draw Agreed", "You accepted the draw offer.", 'draw');
    });

    // Global variables for PDF report so the download button can access them
    let cacheReportMoves = [];
    let cacheReportData = {};

    btnDownloadReport.addEventListener('click', async () => {
        const uciMoves = game.history.map(s => {
            const from = indexToCoord(s.move.from);
            const to = indexToCoord(s.move.to);
            const promo = s.move.promoType || '';
            return from + to + promo;
        });

        const sanMoves = game.history.map(s => getSan({move: s.move}));

        const whiteName = myColor === 'w' ? (authSession.username || 'You') : (opponentName || 'White');
        const blackName = myColor === 'b' ? (authSession.username || 'You') : (opponentName || 'Black');

        await generateGameReportPDF(whiteName, blackName, uciMoves, sanMoves, btnDownloadReport);
    });

    async function generateGameReportPDF(whiteName, blackName, uciMoves, sanMoves, buttonEl) {
        if (uciMoves.length === 0) {
            alert("No moves were played in this game to analyze.");
            if (buttonEl) {
                buttonEl.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download Analysis Report';
                buttonEl.disabled = false;
            }
            return;
        }

        if (buttonEl) {
            buttonEl.disabled = true;
            buttonEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing & Generating PDF...';
        }

        let wMistakes = 0; let bMistakes = 0;
        let wBlunders = 0; let bBlunders = 0;
        let wGreat = 0; let bGreat = 0;
        let totalWhiteMoves = 0;
        let totalBlackMoves = 0;

        let wPhaseStats = { early: {moves:0, err:0}, mid: {moves:0, err:0}, late: {moves:0, err:0} };
        let bPhaseStats = { early: {moves:0, err:0}, mid: {moves:0, err:0}, late: {moves:0, err:0} };

        // Efficient parallel evaluation
        const evalPromises = [];
        let evalHistory = [""]; // Start with initial pos
        let tempMoves = "";
        for (let i = 0; i < uciMoves.length; i++) {
            tempMoves += uciMoves[i] + " ";
            evalHistory.push(tempMoves.trim());
        }

        // Run all in parallel via pool
        const evals = await Promise.all(evalHistory.map(m => stockfishPool.evaluate(m)));
        
        let moveAnnotations = [];

        for (let i = 0; i < uciMoves.length; i++) {
            let evalBefore = evals[i];
            let evalAfter = evals[i+1];
            let evalDiff = (-evalAfter) - evalBefore;
            
            let isWhiteTurn = i % 2 === 0;

            // Phase detection
            let phase = 'late';
            if (i < 20) phase = 'early';
            else if (i < 60) phase = 'mid';

            let annotation = "";
            let sanMove = sanMoves[i] || uciMoves[i];
            let errVal = 0;

            if (isWhiteTurn) {
                totalWhiteMoves++;
                wPhaseStats[phase].moves++;
            } else {
                totalBlackMoves++;
                bPhaseStats[phase].moves++;
            }
                
            let mistakeThreshold = (phase === 'early') ? -150 : -100;
            
            if (evalDiff < -200) { 
                annotation = "?? (Blunder)"; errVal = 18; 
                if (isWhiteTurn) wBlunders++; else bBlunders++;
            } else if (evalDiff < mistakeThreshold) { 
                annotation = "? (Mistake)"; errVal = 8; 
                if (isWhiteTurn) wMistakes++; else bMistakes++;
            } else if (evalDiff > 50) { 
                annotation = "! (Great)"; 
                if (isWhiteTurn) wGreat++; else bGreat++;
            }

            if (isWhiteTurn) wPhaseStats[phase].err += errVal;
            else bPhaseStats[phase].err += errVal;
            
            moveAnnotations.push({
                moveNum: Math.floor(i / 2) + 1,
                color: isWhiteTurn ? "W" : "B",
                san: sanMove,
                annotation: annotation
            });
        }
        const calcAcc = (errs, total) => {
            if (total === 0) return null;
            let acc = Math.max(0, Math.min(100, Math.round(100 - (errs / total))));
            if (errs === 0) acc = 99; // Cap unless completely perfect, for realism
            return acc;
        }

        let wAccuracy = calcAcc(wPhaseStats.early.err + wPhaseStats.mid.err + wPhaseStats.late.err, totalWhiteMoves) || 100;
        let bAccuracy = calcAcc(bPhaseStats.early.err + bPhaseStats.mid.err + bPhaseStats.late.err, totalBlackMoves) || 100;

        let wEarlyAcc = calcAcc(wPhaseStats.early.err, wPhaseStats.early.moves);
        let wMidAcc = calcAcc(wPhaseStats.mid.err, wPhaseStats.mid.moves);
        let wLateAcc = calcAcc(wPhaseStats.late.err, wPhaseStats.late.moves);

        let bEarlyAcc = calcAcc(bPhaseStats.early.err, bPhaseStats.early.moves);
        let bMidAcc = calcAcc(bPhaseStats.mid.err, bPhaseStats.mid.moves);
        let bLateAcc = calcAcc(bPhaseStats.late.err, bPhaseStats.late.moves);

        let summary = "";
        let wWeakPhase = "None"; let wMinAcc = 100;
        let bWeakPhase = "None"; let bMinAcc = 100;

        if (wPhaseStats.early.moves > 0 && wEarlyAcc < wMinAcc) { wMinAcc = wEarlyAcc; wWeakPhase = "Opening"; }
        if (wPhaseStats.mid.moves > 0 && wMidAcc < wMinAcc) { wMinAcc = wMidAcc; wWeakPhase = "Middlegame"; }
        if (wPhaseStats.late.moves > 0 && wLateAcc < wMinAcc) { wMinAcc = wLateAcc; wWeakPhase = "Endgame"; }

        if (bPhaseStats.early.moves > 0 && bEarlyAcc < bMinAcc) { bMinAcc = bEarlyAcc; bWeakPhase = "Opening"; }
        if (bPhaseStats.mid.moves > 0 && bMidAcc < bMinAcc) { bMinAcc = bMidAcc; bWeakPhase = "Middlegame"; }
        if (bPhaseStats.late.moves > 0 && bLateAcc < bMinAcc) { bMinAcc = bLateAcc; bWeakPhase = "Endgame"; }

        let totalBlunders = wBlunders + bBlunders;
        if (totalBlunders === 0) summary = "A very clean and tactical game by both players!";
        else if (wBlunders > bBlunders) summary = "White struggled with tactical blunders, giving Black the edge.";
        else if (bBlunders > wBlunders) summary = "Black struggled with tactical blunders, giving White the edge.";
        else summary = "Both players had a similar tactical performance with some mistakes.";

        cacheReportMoves = moveAnnotations;
        cacheReportData = { 
            whiteName, blackName, 
            wAccuracy, bAccuracy, 
            wGreat, wMistakes, wBlunders,
            bGreat, bMistakes, bBlunders,
            wEarlyAcc, wMidAcc, wLateAcc,
            bEarlyAcc, bMidAcc, bLateAcc,
            wWeakPhase, bWeakPhase,
            summary 
        };

        generatePDF(buttonEl);
    }

    function generatePDF(buttonEl) {
        const { jsPDF } = window.jspdf;
        const doc = new window.jspdf.jsPDF();
        
        let d = cacheReportData;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("Game Analysis Report", 105, 20, null, null, "center");
        
        doc.setFontSize(14);
        doc.setFont("helvetica", "normal");
        
        doc.text(`White: ${d.whiteName}`, 20, 40);
        doc.text(`Black: ${d.blackName}`, 20, 50);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(`${d.whiteName}'s Performance:`, 20, 70);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(`Overall Accuracy: ${d.wAccuracy}%`, 30, 80);
        
        let wPhases = `Opening: ${d.wEarlyAcc !== null ? d.wEarlyAcc + '%' : 'N/A'} | `;
        wPhases += `Middle: ${d.wMidAcc !== null ? d.wMidAcc + '%' : 'N/A'} | `;
        wPhases += `End: ${d.wLateAcc !== null ? d.wLateAcc + '%' : 'N/A'}`;
        
        doc.text(wPhases, 30, 90);
        doc.text(`Great/Mistakes/Blunders: ${d.wGreat} / ${d.wMistakes} / ${d.wBlunders}`, 30, 100);
        doc.text(`Area for Improvement: ${d.wWeakPhase}`, 30, 110);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(`${d.blackName}'s Performance:`, 110, 70);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(`Overall Accuracy: ${d.bAccuracy}%`, 120, 80);
        
        let bPhases = `Opening: ${d.bEarlyAcc !== null ? d.bEarlyAcc + '%' : 'N/A'} | `;
        bPhases += `Middle: ${d.bMidAcc !== null ? d.bMidAcc + '%' : 'N/A'} | `;
        bPhases += `End: ${d.bLateAcc !== null ? d.bLateAcc + '%' : 'N/A'}`;
        
        doc.text(bPhases, 120, 90);
        doc.text(`Great/Mistakes/Blunders: ${d.bGreat} / ${d.bMistakes} / ${d.bBlunders}`, 120, 100);
        doc.text(`Area for Improvement: ${d.bWeakPhase}`, 120, 110);

        doc.setFont("helvetica", "italic");
        doc.text(`Summary: ${d.summary}`, 20, 130);

        // Print Moves
        doc.setFont("helvetica", "bold");
        doc.text("Move Log", 20, 150);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);

        let yPos = 160;
        let xPos = 20;

        for (let i = 0; i < cacheReportMoves.length; i++) {
            let m = cacheReportMoves[i];
            let moveText = `${m.color === 'W' ? m.moveNum + '.' : ''} ${m.san} ${m.annotation}`;
            
            if (m.annotation.includes('Blunder')) doc.setTextColor(200, 0, 0);       // Red
            else if (m.annotation.includes('Mistake')) doc.setTextColor(200, 150, 0); // Orange
            else if (m.annotation.includes('Great')) doc.setTextColor(0, 150, 0);     // Green
            else doc.setTextColor(0, 0, 0);

            doc.text(moveText, xPos, yPos);
            doc.setTextColor(0, 0, 0); // reset

            xPos += 45;
            if (xPos > 180) {
                xPos = 20;
                yPos += 8;
                if (yPos > 280) {
                    doc.addPage();
                    yPos = 20;
                }
            }
        }
        doc.save("Chess_Analysis_Report.pdf");
        
        if (buttonEl) {
            buttonEl.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download Analysis Report';
            buttonEl.disabled = false;
        }
    }

    // Start Phase
    initGame(false); // Initially false, so the modal displays
});
