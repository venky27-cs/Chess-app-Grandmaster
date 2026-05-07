// Core Engine
class Chess {
    constructor() {
        this.board = new Array(64).fill(null);
        this.turn = 'w'; // 'w' or 'b'
        this.history = [];
        this.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
        this.epSquare = null; // en passant target square index (-1 or null)
        this.halfMoves = 0; // fifty-move rule
        this.fullMoves = 1;

        this.kings = { w: 4, b: 60 };

        this.inCheck = false;
        this.isCheckmate = false;
        this.isStalemate = false;

        this.setupStartingPosition();
    }

    setupStartingPosition() {
        const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
        this.loadFen(fen);
    }

    loadFen(fen) {
        this.board = new Array(64).fill(null);
        let rows = fen.split('/');
        let file = 0, rank = 7;
        for (let row of rows) {
            file = 0;
            for (let char of row) {
                if (isNaN(parseInt(char))) {
                    let color = char === char.toUpperCase() ? 'w' : 'b';
                    let type = char.toLowerCase();
                    this.board[rank * 8 + file] = { type, color };
                    if (type === 'k') {
                        this.kings[color] = rank * 8 + file;
                    }
                    file++;
                } else {
                    file += parseInt(char);
                }
            }
            rank--;
        }
        this.updateGameState();
    }

    getPieceAt(sq) {
        if (sq < 0 || sq > 63) return null;
        return this.board[sq];
    }

    rank(sq) { return Math.floor(sq / 8); }
    file(sq) { return sq % 8; }

    getPiecePseudoMoves(sq) {
        let piece = this.board[sq];
        if (!piece) return [];
        let moves = [];
        let c = piece.color;
        let op = c === 'w' ? 'b' : 'w';

        let r = this.rank(sq);
        let f = this.file(sq);

        if (piece.type === 'p') {
            let dir = c === 'w' ? 8 : -8;
            let startRank = c === 'w' ? 1 : 6;
            let promoRank = c === 'w' ? 7 : 0;

            // Single step Forward
            let forwardSq = sq + dir;
            if (forwardSq >= 0 && forwardSq <= 63 && !this.board[forwardSq]) {
                this.addPawnMove(moves, sq, forwardSq, c, promoRank);
                // Double step
                if (r === startRank && !this.board[sq + dir * 2]) {
                    moves.push({ from: sq, to: sq + dir * 2, piece: 'p', color: c, flag: 'double' });
                }
            }

            // Captures
            let captures = [dir - 1, dir + 1];
            for (let offset of captures) {
                let targetSq = sq + offset;
                if (targetSq >= 0 && targetSq <= 63) {
                    if (Math.abs(this.file(targetSq) - f) === 1) { // valid diagonal
                        if (this.board[targetSq] && this.board[targetSq].color === op) {
                            this.addPawnMove(moves, sq, targetSq, c, promoRank, this.board[targetSq]);
                        } else if (targetSq === this.epSquare) {
                            moves.push({ from: sq, to: targetSq, piece: 'p', color: c, flag: 'ep', captured: { type: 'p', color: op } });
                        }
                    }
                }
            }
        } else if (piece.type === 'n') {
            const offsets = [15, 17, 6, 10, -15, -17, -6, -10];
            for (let offset of offsets) {
                let t = sq + offset;
                if (t >= 0 && t <= 63) {
                    let fileDiff = Math.abs(this.file(t) - f);
                    if ((Math.abs(offset) === 15 || Math.abs(offset) === 17) && fileDiff === 1 ||
                        (Math.abs(offset) === 6 || Math.abs(offset) === 10) && fileDiff === 2) {
                        if (!this.board[t] || this.board[t].color === op) {
                            moves.push({ from: sq, to: t, piece: 'n', color: c, captured: this.board[t] });
                        }
                    }
                }
            }
        } else if (piece.type === 'k') {
            const offsets = [8, -8, 1, -1, 9, -9, 7, -7];
            for (let offset of offsets) {
                let t = sq + offset;
                if (t >= 0 && t <= 63) {
                    let fileDiff = Math.abs(this.file(t) - f);
                    if (fileDiff <= 1) {
                        if (!this.board[t] || this.board[t].color === op) {
                            moves.push({ from: sq, to: t, piece: 'k', color: c, captured: this.board[t] });
                        }
                    }
                }
            }

            // Castling
            if (!this.inCheck) {
                let rights = this.castling[c];
                let rankBase = c === 'w' ? 0 : 56;
                // King side
                if (rights.k && !this.board[rankBase + 5] && !this.board[rankBase + 6]) {
                    if (!this.isSquareAttacked(rankBase + 5, op) && !this.isSquareAttacked(rankBase + 6, op)) {
                        moves.push({ from: sq, to: rankBase + 6, piece: 'k', color: c, flag: 'k-castle' });
                    }
                }
                // Queen side
                if (rights.q && !this.board[rankBase + 1] && !this.board[rankBase + 2] && !this.board[rankBase + 3]) {
                    if (!this.isSquareAttacked(rankBase + 2, op) && !this.isSquareAttacked(rankBase + 3, op)) {
                        moves.push({ from: sq, to: rankBase + 2, piece: 'k', color: c, flag: 'q-castle' });
                    }
                }
            }
        } else {
            // Sliding pieces (r, b, q)
            const dirs = [];
            if (piece.type === 'r' || piece.type === 'q') dirs.push(8, -8, 1, -1);
            if (piece.type === 'b' || piece.type === 'q') dirs.push(9, -9, 7, -7);

            for (let dir of dirs) {
                let t = sq;
                while (true) {
                    let prevFile = this.file(t);
                    t += dir;
                    if (t < 0 || t > 63) break;
                    let currFile = this.file(t);
                    // Wrap-around bounds check
                    if (dir === 1 || dir === -1) { if (Math.abs(currFile - prevFile) !== 1) break; }
                    else { if (Math.abs(currFile - prevFile) > 1) break; }

                    if (!this.board[t]) {
                        moves.push({ from: sq, to: t, piece: piece.type, color: c });
                    } else {
                        if (this.board[t].color === op) {
                            moves.push({ from: sq, to: t, piece: piece.type, color: c, captured: this.board[t] });
                        }
                        break;
                    }
                }
            }
        }
        return moves;
    }

    addPawnMove(moves, from, to, color, promoRank, captured = null) {
        if (this.rank(to) === promoRank) {
            ['q', 'r', 'b', 'n'].forEach(p => {
                moves.push({ from, to, piece: 'p', color, flag: 'promo', promoType: p, captured });
            });
        } else {
            moves.push({ from, to, piece: 'p', color, captured });
        }
    }

    isSquareAttacked(sq, attackerColor) {
        let f = this.file(sq);

        // Check knights
        const nOffsets = [15, 17, 6, 10, -15, -17, -6, -10];
        for (let offset of nOffsets) {
            let t = sq + offset;
            if (t >= 0 && t <= 63 && Math.abs(this.file(t) - f) <= 2) {
                let p = this.board[t];
                if (p && p.color === attackerColor && p.type === 'n') return true;
            }
        }

        // Check kings
        const kOffsets = [8, -8, 1, -1, 9, -9, 7, -7];
        for (let offset of kOffsets) {
            let t = sq + offset;
            if (t >= 0 && t <= 63 && Math.abs(this.file(t) - f) <= 1) {
                let p = this.board[t];
                if (p && p.color === attackerColor && p.type === 'k') return true;
            }
        }

        // Check pawns
        let pawnDir = attackerColor === 'w' ? -8 : 8;
        let pCaptures = [pawnDir - 1, pawnDir + 1];
        for (let offset of pCaptures) {
            let t = sq + offset;
            if (t >= 0 && t <= 63 && Math.abs(this.file(t) - f) === 1) {
                let p = this.board[t];
                if (p && p.color === attackerColor && p.type === 'p') return true;
            }
        }

        // Check sliding
        const dirs = [8, -8, 1, -1, 9, -9, 7, -7];
        for (let dir of dirs) {
            let t = sq;
            while (true) {
                let prevFile = this.file(t);
                t += dir;
                if (t < 0 || t > 63) break;
                if (Math.abs(this.file(t) - prevFile) > 1) break;

                let p = this.board[t];
                if (p) {
                    if (p.color === attackerColor) {
                        let isDiag = Math.abs(dir) === 7 || Math.abs(dir) === 9;
                        if (isDiag && (p.type === 'b' || p.type === 'q')) return true;
                        if (!isDiag && (p.type === 'r' || p.type === 'q')) return true;
                    }
                    break;
                }
            }
        }

        return false;
    }

    isKingInCheck(color) {
        return this.isSquareAttacked(this.kings[color], color === 'w' ? 'b' : 'w');
    }

    getAllLegalMoves(color) {
        let allMoves = [];
        for (let sq = 0; sq < 64; sq++) {
            let piece = this.board[sq];
            if (piece && piece.color === color) {
                let pMoves = this.getLegalMovesForSquare(sq);
                allMoves.push(...pMoves);
            }
        }
        return allMoves;
    }

    getLegalMovesForSquare(sq) {
        let piece = this.board[sq];
        if (!piece || piece.color !== this.turn) return [];

        let pseudo = this.getPiecePseudoMoves(sq);
        let legal = [];
        for (let move of pseudo) {
            this.makeMove(move, true);
            if (!this.isKingInCheck(piece.color)) {
                legal.push(move); // Append to list
            }
            this.undoMove();
        }
        return legal;
    }

    makeMove(move, isTemp = false) {
        let { from, to, piece, color, flag, promoType, captured } = move;

        // save state for undo
        let state = {
            move: move,
            castling: { 
                w: { k: this.castling.w.k, q: this.castling.w.q }, 
                b: { k: this.castling.b.k, q: this.castling.b.q } 
            },
            epSquare: this.epSquare,
            halfMoves: this.halfMoves,
            boardFrom: this.board[from],
            boardTo: this.board[to],
            epCaptured: null,
            isTemp: isTemp
        };

        // Move piece
        this.board[to] = this.board[from];
        this.board[from] = null;

        // Flags
        if (flag === 'promo') {
            this.board[to] = { type: promoType, color };
        } else if (flag === 'ep') {
            let epCapSq = color === 'w' ? to - 8 : to + 8;
            state.epCaptured = this.board[epCapSq]; // Save captured ep pawn explicitly
            this.board[epCapSq] = null;
        } else if (flag === 'k-castle') {
            let rFrom = to + 1;
            let rTo = to - 1;
            this.board[rTo] = this.board[rFrom];
            this.board[rFrom] = null;
        } else if (flag === 'q-castle') {
            let rFrom = to - 2;
            let rTo = to + 1;
            this.board[rTo] = this.board[rFrom];
            this.board[rFrom] = null;
        }

        // Update Kings
        if (piece === 'k') this.kings[color] = to;

        // Castling rights update
        if (piece === 'k') {
            this.castling[color].k = false;
            this.castling[color].q = false;
        }
        if (piece === 'r') {
            if (from === 0) this.castling.w.q = false;
            if (from === 7) this.castling.w.k = false;
            if (from === 56) this.castling.b.q = false;
            if (from === 63) this.castling.b.k = false;
        }
        if (to === 0) this.castling.w.q = false;
        if (to === 7) this.castling.w.k = false;
        if (to === 56) this.castling.b.q = false;
        if (to === 63) this.castling.b.k = false;

        // EP Square updates
        this.epSquare = null;
        if (flag === 'double') {
            this.epSquare = color === 'w' ? to - 8 : to + 8;
        }

        // Move clocks
        if (piece === 'p' || captured) {
            this.halfMoves = 0;
        } else {
            this.halfMoves++;
        }

        if (color === 'b') {
            this.fullMoves++;
        }

        this.history.push(state);

        if (!isTemp) {
            this.turn = this.turn === 'w' ? 'b' : 'w';
            this.updateGameState();
        }
    }

    undoMove() {
        if (this.history.length === 0) return;
        let state = this.history.pop();
        let m = state.move;

        let c = m.color;

        this.board[m.from] = state.boardFrom;
        this.board[m.to] = state.boardTo;

        if (m.flag === 'ep') {
            let epCapSq = c === 'w' ? m.to - 8 : m.to + 8;
            this.board[epCapSq] = state.epCaptured;
        } else if (m.flag === 'k-castle') {
            let rFrom = m.to + 1;
            let rTo = m.to - 1;
            this.board[rFrom] = this.board[rTo];
            this.board[rTo] = null;
        } else if (m.flag === 'q-castle') {
            let rFrom = m.to - 2;
            let rTo = m.to + 1;
            this.board[rFrom] = this.board[rTo];
            this.board[rTo] = null;
        }

        if (m.piece === 'k') {
            this.kings[c] = m.from;
        }

        this.castling = state.castling;
        this.epSquare = state.epSquare;
        this.halfMoves = state.halfMoves;

        if (!state.isTemp) {
            this.turn = this.turn === 'w' ? 'b' : 'w';
            if (c === 'b') this.fullMoves--;
            this.updateGameState();
        }
    }

    updateGameState() {
        this.inCheck = this.isKingInCheck(this.turn);
        let moves = this.getAllLegalMoves(this.turn);

        if (moves.length === 0) {
            if (this.inCheck) {
                this.isCheckmate = true;
            } else {
                this.isStalemate = true;
            }
        } else {
            this.isCheckmate = false;
            this.isStalemate = false;
            if (this.halfMoves >= 100) {
                this.isStalemate = true;
            }
        }
    }
}

// Export for testing or module usage if needed
if (typeof module !== 'undefined') {
    module.exports = Chess;
}
