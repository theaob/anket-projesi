const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { openDatabase } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// The shared admin panel was replaced by per-poll manage links.
app.get('/admin.html', (req, res) => res.redirect('/'));
app.get('/manage', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manage.html'), {
    headers: { 'Cache-Control': 'no-cache' }
}));

app.use(express.static('public', {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

const MAX_OPTIONS = 20;
const MAX_TEXT = 200;
const VOTER_ID_RE = /^[a-f0-9]{32}$/;
const MANAGE_SECRET_RE = /^[A-Za-z0-9_-]{32}$/;
// Anyone can create polls and there are only 9000 four-digit codes, so cap
// how fast a single address can create them.
const CREATE_LIMIT = 20;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

// polls: Map<code: string, poll>
// poll: { code, question, options: string[], votes: number[],
//         visitors: Map<voterId, { voted: boolean, choice: number|null }>,
//         active: Map<voterId, number>  (live socket count, not persisted) }
const polls = new Map();

// ── Persistence ────────────────────────────────────────────────
// Every change is written straight to SQLite (see db.js); `polls` is the live
// in-memory copy used for fast reads and broadcasts.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const db = openDatabase(DATA_DIR);

function loadPolls() {
    for (const p of db.loadAll()) polls.set(p.code, { ...p, active: new Map() });
    console.log(`📂 ${polls.size} anket yüklendi (${path.join(DATA_DIR, 'anket.db')})`);
}

function shutdown() {
    db.close();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Poll helpers ───────────────────────────────────────────────
function generateCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
        const code = String(Math.floor(1000 + Math.random() * 9000));
        if (!polls.has(code)) return code;
    }
    return null;
}

// The manage secret is only ever shown to the poll's creator; the database
// keeps its hash so a copy of the database file can't be used to take over
// polls.
function hashSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
}

function abandonedCount(poll) {
    let n = 0;
    for (const [id, v] of poll.visitors) {
        if (!v.voted && !poll.active.get(id)) n++;
    }
    return n;
}

function ownerView(poll) {
    return {
        code: poll.code,
        question: poll.question,
        options: poll.options,
        votes: poll.votes,
        visits: poll.visitors.size,
        abandoned: abandonedCount(poll)
    };
}

function voterView(poll, voterId) {
    const visitor = poll.visitors.get(voterId);
    return {
        code: poll.code,
        question: poll.question,
        options: poll.options,
        votes: poll.votes,
        voted: !!visitor?.voted,
        choice: visitor?.choice ?? null
    };
}

function notifyOwners(poll) {
    io.to(`manage:${poll.code}`).emit('managePoll', ownerView(poll));
}

// Every voter gets their own `voted` flag, so a plain room broadcast won't do.
async function sendInitToRoom(poll) {
    const sockets = await io.in(`poll:${poll.code}`).fetchSockets();
    for (const s of sockets) s.emit('init', voterView(poll, s.data.voterId));
}

function resetRound(poll) {
    poll.votes = poll.options.map(() => 0);
    for (const v of poll.visitors.values()) {
        v.voted = false;
        v.choice = null;
    }
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

function sameOptions(a, b) {
    return a.length === b.length && a.every((opt, i) => opt === b[i]);
}

function leavePoll(socket) {
    const code = socket.data.pollCode;
    if (!code) return null;
    socket.leave(`poll:${code}`);
    socket.data.pollCode = null;
    const poll = polls.get(code);
    if (!poll) return null;
    const id = socket.data.voterId;
    const n = (poll.active.get(id) || 0) - 1;
    if (n > 0) poll.active.set(id, n);
    else poll.active.delete(id);
    return poll;
}

function buildCsv(poll) {
    let csvContent = "﻿";
    csvContent += "Secenek,Oy Sayisi\n";
    poll.options.forEach((opt, i) => {
        const text = String(opt).replace(/"/g, '""');
        csvContent += `"${text}",${poll.votes[i] || 0}\n`;
    });
    csvContent += `\nZiyaret,${poll.visitors.size}\n`;
    csvContent += `Oy Vermeden Ayrilan,${abandonedCount(poll)}\n`;
    return csvContent;
}

const createLog = new Map(); // address -> recent creation timestamps
function allowCreate(address) {
    const now = Date.now();
    const recent = (createLog.get(address) || []).filter(t => now - t < CREATE_WINDOW_MS);
    const allowed = recent.length < CREATE_LIMIT;
    if (allowed) recent.push(now);
    createLog.set(address, recent);
    return allowed;
}

const getLocalIp = () => {
    const interfaces = os.networkInterfaces();
    for (let iface in interfaces) {
        for (let details of interfaces[iface]) {
            if (details.family === 'IPv4' && !details.internal) return details.address;
        }
    }
    return 'localhost';
};

const localIp = getLocalIp();
const PORT = 3000;

io.on('connection', (socket) => {
    // Voters identify themselves with a random per-browser ID so the server,
    // not localStorage, decides whether someone has already voted.
    const claimed = socket.handshake.auth?.voterId;
    socket.data.voterId = typeof claimed === 'string' && VOTER_ID_RE.test(claimed) ? claimed : `s:${socket.id}`;
    socket.data.pollCode = null;
    // Codes of the polls this socket has proven (with the secret) it may manage.
    socket.data.owned = new Set();

    const reply = (ack, value) => { if (typeof ack === 'function') ack(value); };
    const ownedPoll = (code) => (socket.data.owned.has(code) ? polls.get(code) : null);

    // ── Owner events ───────────────────────────────────────────
    socket.on('createPoll', (ack) => {
        if (!allowCreate(socket.handshake.address)) {
            return reply(ack, { error: 'Çok fazla anket oluşturuldu, lütfen daha sonra tekrar deneyin.' });
        }
        const code = generateCode();
        if (!code) return reply(ack, { error: 'Şu anda boş anket kodu yok, lütfen daha sonra tekrar deneyin.' });
        const secret = crypto.randomBytes(24).toString('base64url');
        db.createPoll(code, 'Yeni Anket', hashSecret(secret));
        polls.set(code, { code, question: 'Yeni Anket', options: [], votes: [], visitors: new Map(), active: new Map() });
        reply(ack, { code, secret });
    });

    // Unlocks management of one poll for this socket.
    socket.on('manage', (secret, ack) => {
        const code = typeof secret === 'string' && MANAGE_SECRET_RE.test(secret)
            ? db.findCodeByManageHash(hashSecret(secret))
            : null;
        const poll = code && polls.get(code);
        if (!poll) return reply(ack, { error: 'Anket bulunamadı. Bağlantı hatalı olabilir ya da anket silinmiş olabilir.' });
        socket.data.owned.add(code);
        socket.join(`manage:${code}`);
        reply(ack, { poll: ownerView(poll) });
    });

    socket.on('updatePoll', (payload) => {
        const poll = ownedPoll(payload?.code);
        if (!poll || !Array.isArray(payload.options)) return;
        const options = payload.options.map(cleanText).filter(Boolean).slice(0, MAX_OPTIONS);
        const question = cleanText(payload.question);
        // Only a change to the options invalidates the votes; fixing a typo in
        // the question keeps them.
        const optionsChanged = !sameOptions(options, poll.options);
        db.updatePoll(poll.code, question, optionsChanged ? options : null);
        poll.question = question;
        if (optionsChanged) {
            poll.options = options;
            resetRound(poll);
        }
        notifyOwners(poll);
        sendInitToRoom(poll);
    });

    socket.on('deletePoll', (code) => {
        const poll = ownedPoll(code);
        if (!poll) return;
        db.deletePoll(code);
        polls.delete(code);
        io.to(`poll:${code}`).emit('pollError', 'Bu anket silindi.');
        io.in(`poll:${code}`).socketsLeave(`poll:${code}`);
        io.to(`manage:${code}`).emit('pollDeleted', code);
        io.in(`manage:${code}`).socketsLeave(`manage:${code}`);
    });

    socket.on('resetVotes', (code) => {
        const poll = ownedPoll(code);
        if (!poll) return;
        // Visitors who aren't connected are forgotten, which resets the visit
        // and "left without voting" counters too.
        const dropped = [...poll.visitors.keys()].filter(id => !poll.active.get(id));
        db.resetVotes(code, dropped);
        resetRound(poll);
        for (const id of dropped) poll.visitors.delete(id);
        notifyOwners(poll);
        sendInitToRoom(poll);
    });

    // Returned over the socket rather than from a URL so the manage secret
    // never has to appear in a link or a server log.
    socket.on('exportCsv', (code, ack) => {
        const poll = ownedPoll(code);
        reply(ack, poll ? { csv: buildCsv(poll) } : { error: 'Anket bulunamadı.' });
    });

    // ── Voter events ───────────────────────────────────────────
    socket.on('joinPoll', (code) => {
        const poll = polls.get(code);
        if (!poll) {
            socket.emit('pollError', 'Geçersiz anket kodu.');
            return;
        }
        if (socket.data.pollCode !== code) {
            const previous = leavePoll(socket);
            if (previous) notifyOwners(previous);
            socket.join(`poll:${code}`);
            socket.data.pollCode = code;
            const id = socket.data.voterId;
            poll.active.set(id, (poll.active.get(id) || 0) + 1);
            if (!poll.visitors.has(id)) {
                db.addVisitor(code, id);
                poll.visitors.set(id, { voted: false, choice: null });
            }
        }
        socket.emit('init', voterView(poll, socket.data.voterId));
        notifyOwners(poll);
    });

    socket.on('castVote', (payload) => {
        const code = payload?.code;
        const index = payload?.index;
        const poll = polls.get(code);
        if (!poll || socket.data.pollCode !== code) return;
        const visitor = poll.visitors.get(socket.data.voterId);
        if (!visitor || visitor.voted || !Number.isInteger(index) || index < 0 || index >= poll.options.length) {
            // Resync the client, e.g. a second tab that already voted.
            socket.emit('init', voterView(poll, socket.data.voterId));
            return;
        }
        if (!db.castVote(code, socket.data.voterId, index)) return;
        poll.votes[index]++;
        visitor.voted = true;
        visitor.choice = index;
        io.to(`poll:${code}`).emit('updateVotes', poll.votes);
        notifyOwners(poll);
    });

    socket.on('disconnect', () => {
        const poll = leavePoll(socket);
        if (poll) notifyOwners(poll);
    });
});

loadPolls();

server.listen(PORT, () => {
    console.log(`🚀 Sunucu Hazır: http://${localIp}:${PORT}`);
});
