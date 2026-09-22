const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { openDatabase } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public', {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

const MAX_OPTIONS = 20;
const MAX_TEXT = 200;
const VOTER_ID_RE = /^[a-f0-9]{32}$/;

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
    const imported = db.importLegacyJson(path.join(DATA_DIR, 'polls.json'));
    if (imported) console.log(`📥 polls.json dosyasından ${imported} anket veritabanına aktarıldı`);
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

function abandonedCount(poll) {
    let n = 0;
    for (const [id, v] of poll.visitors) {
        if (!v.voted && !poll.active.get(id)) n++;
    }
    return n;
}

function adminView(poll) {
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

function getPollList() {
    return [...polls.values()].map(adminView);
}

function notifyAdmins() {
    io.to('admin').emit('pollList', getPollList());
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
    if (!code) return;
    socket.leave(`poll:${code}`);
    socket.data.pollCode = null;
    const poll = polls.get(code);
    if (!poll) return;
    const id = socket.data.voterId;
    const n = (poll.active.get(id) || 0) - 1;
    if (n > 0) poll.active.set(id, n);
    else poll.active.delete(id);
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

// CSV export for a specific poll
app.get('/export', (req, res) => {
    const code = req.query.code;
    const poll = polls.get(code);
    if (!poll) return res.status(404).send('Anket bulunamadı.');

    let csvContent = "\uFEFF";
    csvContent += "Secenek,Oy Sayisi\n";
    poll.options.forEach((opt, i) => {
        const text = String(opt).replace(/"/g, '""');
        csvContent += `"${text}",${poll.votes[i] || 0}\n`;
    });
    csvContent += `\nZiyaret,${poll.visitors.size}\n`;
    csvContent += `Oy Vermeden Ayrilan,${abandonedCount(poll)}\n`;
    res.setHeader('Content-disposition', `attachment; filename=anket_${code}.csv`);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.send(csvContent);
});

io.on('connection', (socket) => {
    // Voters identify themselves with a random per-browser ID so the server,
    // not localStorage, decides whether someone has already voted.
    const claimed = socket.handshake.auth?.voterId;
    socket.data.voterId = typeof claimed === 'string' && VOTER_ID_RE.test(claimed) ? claimed : `s:${socket.id}`;
    socket.data.pollCode = null;

    // ── Admin events ───────────────────────────────────────────
    socket.on('joinAdmin', () => {
        socket.join('admin');
        socket.emit('pollList', getPollList());
    });

    socket.on('createPoll', () => {
        const code = generateCode();
        if (!code) return;
        db.createPoll(code, 'Yeni Anket');
        polls.set(code, { code, question: 'Yeni Anket', options: [], votes: [], visitors: new Map(), active: new Map() });
        notifyAdmins();
        socket.emit('pollCreated', code);
    });

    socket.on('updatePoll', (payload) => {
        const poll = polls.get(payload?.code);
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
        notifyAdmins();
        sendInitToRoom(poll);
    });

    socket.on('deletePoll', (code) => {
        if (!polls.has(code)) return;
        db.deletePoll(code);
        polls.delete(code);
        notifyAdmins();
    });

    socket.on('resetVotes', (code) => {
        const poll = polls.get(code);
        if (!poll) return;
        // Visitors who aren't connected are forgotten, which resets the visit
        // and "left without voting" counters too.
        const dropped = [...poll.visitors.keys()].filter(id => !poll.active.get(id));
        db.resetVotes(code, dropped);
        resetRound(poll);
        for (const id of dropped) poll.visitors.delete(id);
        notifyAdmins();
        sendInitToRoom(poll);
    });

    // ── Voter events ───────────────────────────────────────────
    socket.on('joinPoll', (code) => {
        const poll = polls.get(code);
        if (!poll) {
            socket.emit('pollError', 'Geçersiz anket kodu.');
            return;
        }
        if (socket.data.pollCode !== code) {
            leavePoll(socket);
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
        notifyAdmins();
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
        notifyAdmins();
    });

    socket.on('disconnect', () => {
        if (!socket.data.pollCode) return;
        leavePoll(socket);
        notifyAdmins();
    });
});

loadPolls();

server.listen(PORT, () => {
    console.log(`🚀 Sunucu Hazır: http://${localIp}:${PORT}`);
    console.log(`🛠 Admin Paneli: http://${localIp}:${PORT}/admin.html`);
});
