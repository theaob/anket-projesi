const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { openDatabase } = require('./db');

const app = express();
const server = http.createServer(app);
// Every legitimate message is small (at most 20 options of 200 characters).
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });

// Content-Security-Policy: scripts may only come from this server's own
// files, so even if poll text were ever rendered as HTML it could not run.
// Inline <style> blocks are still used by the pages, hence 'unsafe-inline'
// for styles only.
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
].join('; ');
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});

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
const POLL_CODE_RE = /^\d{4,5}$/;
// Anyone can create polls and the code space is finite (see generateCode),
// so cap how fast a single address can create them.
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

// Last resort. Socket handlers catch their own errors (see `on` below), so
// reaching this means something unexpected; the state may be inconsistent,
// so log, close the database cleanly and exit for the process manager
// (Docker --restart) to restart. All data is already in the database.
process.on('uncaughtException', (err) => {
    console.error('Beklenmeyen hata, sunucu kapanıyor:', err);
    try { db.close(); } catch (e) { /* already closed */ }
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    console.error('Yakalanmamış Promise hatası:', err);
});

// ── Poll helpers ───────────────────────────────────────────────
// Codes are 4 digits (9000 possible). Only when random picks keep colliding,
// i.e. the 4-digit space is nearly full, fall back to 5 digits (90000 more).
function generateCode() {
    for (const [min, span] of [[1000, 9000], [10000, 90000]]) {
        for (let attempt = 0; attempt < 50; attempt++) {
            const code = String(min + Math.floor(Math.random() * span));
            if (!polls.has(code)) return code;
        }
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
function sendInitToRoom(poll) {
    io.in(`poll:${poll.code}`).fetchSockets()
        .then(sockets => {
            for (const s of sockets) s.emit('init', voterView(poll, s.data.voterId));
        })
        .catch(err => console.error('Anket güncellemesi gönderilemedi:', err));
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
    let csvContent = "\uFEFF";
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

    // Registers a handler that can never take the server down: an error (a
    // malformed payload that slipped past validation, a database failure) is
    // logged, and a waiting client gets an error reply instead of hanging.
    const on = (event, handler) => socket.on(event, (...args) => {
        try {
            handler(...args);
        } catch (err) {
            console.error(`"${event}" işlenirken hata:`, err);
            reply(args[args.length - 1], { error: 'Sunucu hatası, lütfen tekrar deneyin.' });
        }
    });
    const ownedPoll = (code) => (socket.data.owned.has(code) ? polls.get(code) : null);

    // ── Owner events ───────────────────────────────────────────
    on('createPoll', (ack) => {
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
    on('manage', (secret, ack) => {
        const code = typeof secret === 'string' && MANAGE_SECRET_RE.test(secret)
            ? db.findCodeByManageHash(hashSecret(secret))
            : null;
        const poll = code && polls.get(code);
        if (!poll) return reply(ack, { error: 'Anket bulunamadı. Bağlantı hatalı olabilir ya da anket silinmiş olabilir.' });
        socket.data.owned.add(code);
        socket.join(`manage:${code}`);
        reply(ack, { poll: ownerView(poll) });
    });

    on('updatePoll', (payload) => {
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

    on('deletePoll', (code) => {
        const poll = ownedPoll(code);
        if (!poll) return;
        db.deletePoll(code);
        polls.delete(code);
        io.to(`poll:${code}`).emit('pollError', 'Bu anket silindi.');
        io.in(`poll:${code}`).socketsLeave(`poll:${code}`);
        io.to(`manage:${code}`).emit('pollDeleted', code);
        io.in(`manage:${code}`).socketsLeave(`manage:${code}`);
    });

    on('resetVotes', (code) => {
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
    on('exportCsv', (code, ack) => {
        const poll = ownedPoll(code);
        reply(ack, poll ? { csv: buildCsv(poll) } : { error: 'Anket bulunamadı.' });
    });

    // ── Voter events ───────────────────────────────────────────
    on('joinPoll', (code) => {
        const poll = typeof code === 'string' && POLL_CODE_RE.test(code) ? polls.get(code) : null;
        if (!poll) {
            socket.emit('pollError', 'Geçersiz anket kodu.');
            return;
        }
        if (socket.data.pollCode !== code) {
            const id = socket.data.voterId;
            // Database first: if the write fails, nothing in memory has changed
            // and the voter can simply try again.
            if (!poll.visitors.has(id)) {
                db.addVisitor(code, id);
                poll.visitors.set(id, { voted: false, choice: null });
            }
            const previous = leavePoll(socket);
            if (previous) notifyOwners(previous);
            socket.join(`poll:${code}`);
            socket.data.pollCode = code;
            poll.active.set(id, (poll.active.get(id) || 0) + 1);
        }
        socket.emit('init', voterView(poll, socket.data.voterId));
        notifyOwners(poll);
    });

    on('castVote', (payload) => {
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

    on('disconnect', () => {
        const poll = leavePoll(socket);
        if (poll) notifyOwners(poll);
    });
});

loadPolls();

server.listen(PORT, () => {
    console.log(`🚀 Sunucu Hazır: http://${localIp}:${PORT}`);
});
