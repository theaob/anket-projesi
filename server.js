const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const proxyaddr = require('proxy-addr');
const { openDatabase } = require('./db');
const { createIdentity, verifyTurnstile } = require('./identity');
const { clientKey, createLimiter: createLimiter_ } = require('./rate-limit');
const exporter = require('./export');

// ── Configuration (environment variables, see README) ──────────
const envInt = (name, fallback) => {
    const n = Number.parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
// Behind a reverse proxy (needed for HTTPS online), the client's real address
// is in X-Forwarded-For. It is only trusted when TRUST_PROXY says how many
// proxies to trust (e.g. 1) or which addresses they have (e.g. "loopback"),
// because otherwise any client could fake it and dodge the rate limits.
const TRUST_PROXY = /^\d+$/.test(process.env.TRUST_PROXY || '')
    ? Number(process.env.TRUST_PROXY)
    : (process.env.TRUST_PROXY || false);
// New voter identities per client: a burst, refilled at a steady hourly rate.
const VOTER_ID_BURST = envInt('VOTER_ID_BURST', 30);
const VOTER_ID_PER_HOUR = envInt('VOTER_ID_PER_HOUR', 360);
// Optional Cloudflare Turnstile bot check before a voter identity is issued.
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);

const app = express();
app.set('trust proxy', TRUST_PROXY);
const trustProxy = app.get('trust proxy fn');
const server = http.createServer(app);
// Every legitimate message is small (at most 20 options of 200 characters).
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });

// The client's address, for rate limiting, honouring TRUST_PROXY.
function clientIp(req) {
    return proxyaddr(req, trustProxy);
}

// Content-Security-Policy: scripts may only come from this server's own
// files, so even if poll text were ever rendered as HTML it could not run.
// Inline <style> blocks are still used by the pages, hence 'unsafe-inline'
// for styles only. Turnstile, when enabled, needs Cloudflare's script and
// frame.
const CLOUDFLARE = 'https://challenges.cloudflare.com';
const CSP = [
    "default-src 'self'",
    `script-src 'self'${TURNSTILE ? ' ' + CLOUDFLARE : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${TURNSTILE ? CLOUDFLARE : "'none'"}`,
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

// A proxy is forwarding client addresses but TRUST_PROXY is not set: every
// client then looks like the proxy and shares one rate limit. Warn once.
let warnedAboutProxy = false;
app.use((req, res, next) => {
    if (!TRUST_PROXY && !warnedAboutProxy && req.headers['x-forwarded-for']) {
        warnedAboutProxy = true;
        console.warn('⚠️  X-Forwarded-For başlığı alındı ama TRUST_PROXY ayarlı değil; tüm istemciler vekil sunucunun adresinden geliyor sayılacak. README\'deki "İnternette yayınlama" bölümüne bakın.');
    }
    next();
});

// ── Voter identity ─────────────────────────────────────────────
// The voter page calls this before connecting. A browser that already has a
// valid cookie keeps it; otherwise a new identity is issued, subject to the
// per-client limit and, when enabled, a Turnstile check.
app.post('/api/voter', express.json({ limit: '4kb' }), async (req, res) => {
    try {
        if (identity.fromCookieHeader(req.headers.cookie)) return res.json({ ok: true });
        const ip = clientIp(req);
        if (TURNSTILE) {
            const token = req.body?.turnstileToken;
            if (!token) return res.status(401).json({ challenge: 'turnstile', siteKey: TURNSTILE_SITE_KEY });
            if (!(await verifyTurnstile(TURNSTILE_SECRET_KEY, token, ip))) {
                return res.status(403).json({ error: 'Doğrulama başarısız oldu, lütfen tekrar deneyin.' });
            }
        }
        const limit = voterIdLimiter.take(clientKey(ip));
        if (!limit.ok) {
            res.set('Retry-After', String(limit.retryAfterSec));
            return res.status(429).json({
                error: 'Bu ağdan çok fazla yeni katılımcı geldi. Lütfen biraz sonra tekrar deneyin.',
                retryAfterSec: limit.retryAfterSec
            });
        }
        const { cookieValue } = identity.issue();
        res.set('Set-Cookie', identity.cookieHeader(cookieValue, req.secure));
        res.json({ ok: true });
    } catch (err) {
        console.error('Katılımcı kimliği oluşturulamadı:', err);
        res.status(500).json({ error: 'Sunucu hatası, lütfen tekrar deneyin.' });
    }
});

// Liveness check for Docker's HEALTHCHECK and load balancers.
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// The shared admin panel was replaced by per-poll manage links.
app.get('/admin.html', (req, res) => res.redirect('/'));
app.get('/manage', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manage.html'), {
    headers: { 'Cache-Control': 'no-cache' }
}));
app.get('/present', (req, res) => res.sendFile(path.join(__dirname, 'public', 'present.html'), {
    headers: { 'Cache-Control': 'no-cache' }
}));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, 'public', 'report.html'), {
    headers: { 'Cache-Control': 'no-cache' }
}));

// QR code for a poll's join link, drawn on the server so it works without
// internet access.
app.get('/qr/:code.svg', (req, res) => {
    const { code } = req.params;
    if (!POLL_CODE_RE.test(code) || !polls.has(code)) return res.status(404).end();
    QRCode.toString(joinUrl(req.protocol, req.get('host'), code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
        .then(svg => {
            res.set('Content-Type', 'image/svg+xml');
            res.set('Cache-Control', 'no-cache');
            res.send(svg);
        })
        .catch(() => res.status(500).end());
});

app.use(express.static('public', {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

const MAX_OPTIONS = 20;
const MAX_TEXT = 200;
const MANAGE_SECRET_RE = /^[A-Za-z0-9_-]{32}$/;
const POLL_CODE_RE = /^\d{4,5}$/;
// Anyone can create polls and the code space is finite (see generateCode),
// so cap how fast a single client can create them.
const createLimiter = createLimiter_({ burst: 20, perHour: 20 });
const voterIdLimiter = createLimiter_({ burst: VOTER_ID_BURST, perHour: VOTER_ID_PER_HOUR });
// Live reactions voters can send; clients refer to them by index. Each voter
// may send a quick burst, then about one a second.
const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🤔'];
const reactionLimiter = createLimiter_({ burst: 10, perHour: 3600 });

// polls: Map<code: string, poll>
// poll: { code, question, options: string[], votes: number[],
//         visitors: Map<voterId, { voted: boolean, choice: number|null }>,
//         closed: boolean, opensAt / closesAt: number|null  (scheduled start
//         and end, ms),
//         active: Map<voterId, number>  (live socket count, not persisted),
//         leftAt: Map<voterId, ms>  (when their last socket closed, not persisted),
//         timer  (pending auto-close timeout, not persisted),
//         update: { timer, pending, votesChanged }  (live-update batching) }
const polls = new Map();

// ── Persistence ────────────────────────────────────────────────
// Every change is written straight to SQLite (see db.js); `polls` is the live
// in-memory copy used for fast reads and broadcasts.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const db = openDatabase(DATA_DIR);
// Signs voter cookies; kept in the database so cookies survive restarts.
const identity = createIdentity(db.getOrCreateSetting('voterCookieSecret', () => crypto.randomBytes(32).toString('hex')));

function loadPolls() {
    for (const p of db.loadAll()) {
        const poll = { ...p, active: new Map(), timer: null };
        polls.set(p.code, poll);
        // An end time that passed while the server was down closes the poll
        // now; a start or end still ahead is scheduled again.
        if (!poll.closed && votingPhase(poll) === 'closed') closeVoting(poll);
        else scheduleVoting(poll);
    }
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

// ── Open/close voting ──────────────────────────────────────────
const MIN_TIMER_SEC = 5;
const MAX_TIMER_SEC = 60 * 60;

// Longest schedule: a start or end date at most this far ahead.
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1000;

// 'scheduled' (a start time is set and not reached yet), 'open' or 'closed'.
function votingPhase(poll, now = Date.now()) {
    if (poll.closed || (poll.closesAt && now >= poll.closesAt)) return 'closed';
    if (poll.opensAt && now < poll.opensAt) return 'scheduled';
    return 'open';
}

function isOpen(poll) {
    return votingPhase(poll) === 'open';
}

// Sent to every client. Countdowns use the time remaining rather than the
// deadline, so a device whose clock is wrong still counts down correctly;
// opensAt/closesAt are only for showing the date and time.
function votingView(poll) {
    const now = Date.now();
    const phase = votingPhase(poll, now);
    return {
        phase,
        open: phase === 'open',
        remainingMs: phase === 'open' && poll.closesAt ? poll.closesAt - now : null,
        startsInMs: phase === 'scheduled' ? poll.opensAt - now : null,
        opensAt: phase === 'scheduled' ? poll.opensAt : null,
        closesAt: phase === 'closed' ? null : poll.closesAt
    };
}

// setTimeout can't wait longer than about 24.8 days, and schedules can be
// set up to a year ahead: long waits are done in steps of at most a day.
const MAX_TIMER_STEP_MS = 24 * 60 * 60 * 1000;

// Runs the next scheduled change (start or end) when its time comes.
function scheduleVoting(poll) {
    clearTimeout(poll.timer);
    poll.timer = null;
    const phase = votingPhase(poll);
    const next = phase === 'scheduled' ? poll.opensAt : phase === 'open' ? poll.closesAt : null;
    if (!next) return;
    poll.timer = setTimeout(() => {
        try {
            if (polls.get(poll.code) !== poll) return;
            if (Date.now() < next) return scheduleVoting(poll); // a step of a long wait
            if (votingPhase(poll) === 'closed') closeVoting(poll);
            else scheduleVoting(poll);
            notifyAll(poll);
        } catch (err) {
            console.error('Oylama zamanlayıcısı çalışamadı:', err);
        }
    }, Math.min(MAX_TIMER_STEP_MS, Math.max(0, next - Date.now())));
}

// Database first, then memory, like every other change.
function setVoting(poll, { closed, opensAt = null, closesAt = null }) {
    db.setVoting(poll.code, closed, opensAt, closesAt);
    poll.closed = closed;
    poll.opensAt = opensAt;
    poll.closesAt = closesAt;
    scheduleVoting(poll);
}

// Closing clears any schedule: reopening starts from a clean state.
function closeVoting(poll) {
    setVoting(poll, { closed: true });
}

// The manage secret is only ever shown to the poll's creator; the database
// keeps its hash so a copy of the database file can't be used to take over
// polls.
function hashSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
}

// A visitor only counts as "left without voting" once they have been gone
// this long, so a page reload or a brief network drop doesn't show up there.
const LEFT_GRACE_MS = 10 * 1000;

function abandonedCount(poll) {
    const now = Date.now();
    let n = 0;
    for (const [id, v] of poll.visitors) {
        if (v.voted || poll.active.get(id)) continue;
        const leftAt = poll.leftAt?.get(id);
        if (leftAt === undefined || now - leftAt >= LEFT_GRACE_MS) n++;
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
        abandoned: abandonedCount(poll),
        voting: votingView(poll)
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
        choice: visitor?.choice ?? null,
        voting: votingView(poll),
        reactions: REACTIONS
    };
}

// What a presenter screen shows: the same results voters see after voting,
// plus how many voters are connected right now.
function publicView(poll) {
    return {
        code: poll.code,
        question: poll.question,
        options: poll.options,
        votes: poll.votes,
        participants: poll.active.size,
        voting: votingView(poll)
    };
}

// Live updates (vote counts for voters who see results, stats for managers
// and presenter screens) are sent at most every UPDATE_INTERVAL_MS per poll.
// Sending one per vote to everyone would grow with the square of the audience.
// The first change goes out at once; later ones within the interval are
// merged into one update carrying the latest state, so none are lost.
const UPDATE_INTERVAL_MS = 250;

function scheduleUpdate(poll, { votesChanged = false } = {}) {
    poll.update ??= { timer: null, pending: false, votesChanged: false };
    poll.update.pending = true;
    if (votesChanged) poll.update.votesChanged = true;
    if (!poll.update.timer) flushUpdate(poll);
}

function flushUpdate(poll) {
    const u = poll.update;
    if (!u.pending || polls.get(poll.code) !== poll) {
        u.timer = null;
        return;
    }
    u.pending = false;
    if (u.votesChanged) {
        u.votesChanged = false;
        io.to(`poll:${poll.code}`).emit('updateVotes', poll.votes);
    }
    io.to(`manage:${poll.code}`).emit('managePoll', ownerView(poll));
    io.to(`watch:${poll.code}`).emit('watchPoll', publicView(poll));
    u.timer = setTimeout(() => flushUpdate(poll), UPDATE_INTERVAL_MS);
}

// Reactions are counted and sent to voters and presenter screens at most every
// REACTION_INTERVAL_MS per poll, as counts per reaction, so a room full of
// people tapping away costs one small message per interval.
const REACTION_INTERVAL_MS = 300;

function addReaction(poll, index) {
    poll.reactions ??= { timer: null, counts: null };
    poll.reactions.counts ??= REACTIONS.map(() => 0);
    poll.reactions.counts[index]++;
    if (!poll.reactions.timer) flushReactions(poll);
}

function flushReactions(poll) {
    const r = poll.reactions;
    if (!r.counts || polls.get(poll.code) !== poll) {
        r.timer = null;
        return;
    }
    io.to([`poll:${poll.code}`, `watch:${poll.code}`]).emit('reactions', r.counts);
    r.counts = null;
    r.timer = setTimeout(() => flushReactions(poll), REACTION_INTERVAL_MS);
}

// Everyone watching a poll: managers, presenter screens and voters.
function notifyAll(poll) {
    scheduleUpdate(poll);
    sendInitToRoom(poll);
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

// Question and options for a new poll, from an imported JSON file (our own
// export, or a bare { question, options }) or a poll being duplicated.
// Returns null if there is nothing usable.
function pollTemplate(value) {
    const source = value?.poll && typeof value.poll === 'object' ? value.poll : value;
    if (!source || typeof source !== 'object' || !Array.isArray(source.options)) return null;
    const options = source.options.slice(0, MAX_OPTIONS * 5).map(cleanText).filter(Boolean).slice(0, MAX_OPTIONS);
    const question = cleanText(source.question);
    return question || options.length ? { question: question || 'Yeni Anket', options } : null;
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
    if (n > 0) {
        poll.active.set(id, n);
    } else {
        poll.active.delete(id);
        // Refresh the managers' "left without voting" count once the grace
        // period is over, if the visitor hasn't come back by then.
        (poll.leftAt ??= new Map()).set(id, Date.now());
        setTimeout(() => {
            if (polls.get(poll.code) === poll) scheduleUpdate(poll);
        }, LEFT_GRACE_MS + 50).unref();
    }
    return poll;
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
const PORT = envInt('PORT', 3000);
// Base address put in join links and QR codes. Set PUBLIC_URL when the
// server is reached through a proxy or a DNS name (e.g. http://anket.firma.local).
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// The join link for a poll, as seen from the browser that asked. A presenter
// who opened the page as "localhost" would otherwise put a link on screen
// that no phone in the room can reach, so loopback hosts become the LAN IP.
function joinUrl(protocol, host, code) {
    if (PUBLIC_URL) return `${PUBLIC_URL}/?code=${code}`;
    const valid = typeof host === 'string' && /^[A-Za-z0-9.-]+(:\d+)?$|^\[[0-9A-Fa-f:.]+\](:\d+)?$/.test(host);
    const loopback = !valid || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/.test(host);
    const origin = loopback ? `${localIp}:${host?.match(/:(\d+)$/)?.[1] || PORT}` : host;
    return `${loopback || protocol !== 'https' ? 'http' : 'https'}://${origin}/?code=${code}`;
}

// The scheme the browser used, which is the proxy's scheme behind a trusted
// reverse proxy (X-Forwarded-Proto).
function socketProtocol(socket) {
    const forwarded = String(socket.request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (TRUST_PROXY && forwarded) return forwarded;
    return socket.request.socket.encrypted ? 'https' : 'http';
}

io.on('connection', (socket) => {
    // The voter identity comes from the signed cookie issued by /api/voter;
    // without one this socket can watch and manage polls but not vote.
    socket.data.voterId = identity.fromCookieHeader(socket.request.headers.cookie);
    socket.data.ip = clientIp(socket.request);
    // Lets the voter page notice a connection made before its cookie arrived.
    socket.emit('session', { voter: Boolean(socket.data.voterId) });
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
    // createPoll(ack) makes an empty poll; createPoll({ template }, ack)
    // starts it with a question and options (JSON import, duplicating).
    on('createPoll', (...args) => {
        const ack = args[args.length - 1];
        const payload = args.length > 1 ? args[0] : null;
        let template = null;
        if (payload?.template !== undefined) {
            template = pollTemplate(payload.template);
            if (!template) return reply(ack, { error: 'Dosyada soru veya seçenek bulunamadı.' });
        }
        if (!createLimiter.take(clientKey(socket.data.ip)).ok) {
            return reply(ack, { error: 'Çok fazla anket oluşturuldu, lütfen daha sonra tekrar deneyin.' });
        }
        const code = generateCode();
        if (!code) return reply(ack, { error: 'Şu anda boş anket kodu yok, lütfen daha sonra tekrar deneyin.' });
        const secret = crypto.randomBytes(24).toString('base64url');
        const question = template?.question ?? 'Yeni Anket';
        const options = template?.options ?? [];
        db.createPoll(code, question, hashSecret(secret));
        if (options.length) db.updatePoll(code, question, options);
        polls.set(code, {
            code, question, options, votes: options.map(() => 0), visitors: new Map(),
            closed: false, opensAt: null, closesAt: null, active: new Map(), timer: null
        });
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
        scheduleUpdate(poll);
        sendInitToRoom(poll);
    });

    on('deletePoll', (code) => {
        const poll = ownedPoll(code);
        if (!poll) return;
        db.deletePoll(code);
        clearTimeout(poll.timer);
        clearTimeout(poll.update?.timer);
        clearTimeout(poll.reactions?.timer);
        polls.delete(code);
        io.to(`poll:${code}`).emit('pollError', 'Bu anket silindi.');
        io.in(`poll:${code}`).socketsLeave(`poll:${code}`);
        io.to(`manage:${code}`).emit('pollDeleted', code);
        io.in(`manage:${code}`).socketsLeave(`manage:${code}`);
        io.to(`watch:${code}`).emit('pollDeleted', code);
        io.in(`watch:${code}`).socketsLeave(`watch:${code}`);
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
        scheduleUpdate(poll);
        sendInitToRoom(poll);
    });

    // Opens or closes voting. With `seconds`, voting opens (or stays open)
    // and closes automatically when the timer runs out; starting a timer
    // while one is running replaces it.
    on('setVoting', (payload) => {
        const poll = ownedPoll(payload?.code);
        if (!poll) return;
        if (payload.open !== true) {
            closeVoting(poll);
        } else if (payload.seconds === undefined || payload.seconds === null) {
            setVoting(poll, { closed: false });
        } else {
            const seconds = payload.seconds;
            if (!Number.isInteger(seconds) || seconds < MIN_TIMER_SEC || seconds > MAX_TIMER_SEC) return;
            setVoting(poll, { closed: false, closesAt: Date.now() + seconds * 1000 });
        }
        notifyAll(poll);
    });

    // Schedules voting by date and time: { code, opensAt, closesAt }, each
    // ms since the epoch or null. A start in the past (or none) opens voting
    // now; no end keeps it open until closed by hand.
    on('setSchedule', (payload, ack) => {
        const poll = ownedPoll(payload?.code);
        if (!poll) return reply(ack, { error: 'Anket bulunamadı.' });
        const now = Date.now();
        const valid = (t) => t === null || t === undefined || (Number.isSafeInteger(t) && t <= now + MAX_SCHEDULE_MS);
        if (!valid(payload.opensAt) || !valid(payload.closesAt)) return reply(ack, { error: 'Geçersiz tarih.' });
        const opensAt = payload.opensAt > now ? payload.opensAt : null;
        const closesAt = payload.closesAt ?? null;
        if (opensAt === null && closesAt === null) return reply(ack, { error: 'Başlangıç veya bitiş zamanı seçin.' });
        if (closesAt !== null && closesAt < (opensAt ?? now) + MIN_TIMER_SEC * 1000) {
            return reply(ack, { error: opensAt ? 'Bitiş, başlangıçtan sonra olmalı.' : 'Bitiş zamanı gelecekte olmalı.' });
        }
        setVoting(poll, { closed: false, opensAt, closesAt });
        notifyAll(poll);
        reply(ack, { ok: true });
    });

    // Returned over the socket rather than from a URL so the manage secret
    // never has to appear in a link or a server log.
    // Results as a file ({ filename, mime, data }) in the requested format,
    // or, for 'report', the data the printable report page draws.
    on('exportPoll', (payload, ack) => {
        const poll = ownedPoll(payload?.code);
        const format = Object.hasOwn(exporter.FORMATS, payload?.format) ? exporter.FORMATS[payload.format] : null;
        if (!poll || !format) return reply(ack, { error: 'Anket bulunamadı.' });
        const tz = Number.isInteger(payload.tzOffset) && Math.abs(payload.tzOffset) <= 14 * 60 ? payload.tzOffset : 0;
        const { phase, opensAt, closesAt } = votingView(poll);
        const report = exporter.buildReport(poll, db.exportDetails(poll.code), {
            abandoned: abandonedCount(poll),
            connected: poll.active.size,
            voting: { phase, opensAt, closesAt }
        }, tz);
        reply(ack, format(report));
    });

    // ── Presenter screen ───────────────────────────────────────
    // Read-only and does not count as a visit.
    on('watchPoll', (code, ack) => {
        const poll = typeof code === 'string' && POLL_CODE_RE.test(code) ? polls.get(code) : null;
        if (!poll) return reply(ack, { error: 'Geçersiz anket kodu.' });
        socket.join(`watch:${code}`);
        reply(ack, {
            poll: publicView(poll),
            joinUrl: joinUrl(socketProtocol(socket), socket.handshake.headers.host, code),
            reactions: REACTIONS
        });
    });

    // ── Voter events ───────────────────────────────────────────
    on('joinPoll', (code) => {
        const poll = typeof code === 'string' && POLL_CODE_RE.test(code) ? polls.get(code) : null;
        if (!poll) {
            socket.emit('pollError', 'Geçersiz anket kodu.');
            return;
        }
        if (!socket.data.voterId) {
            socket.emit('pollError', 'Katılımcı doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.');
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
            if (previous) scheduleUpdate(previous);
            socket.join(`poll:${code}`);
            socket.data.pollCode = code;
            poll.active.set(id, (poll.active.get(id) || 0) + 1);
            poll.leftAt?.delete(id);
        }
        socket.emit('init', voterView(poll, socket.data.voterId));
        scheduleUpdate(poll);
    });

    on('castVote', (payload) => {
        const code = payload?.code;
        const index = payload?.index;
        const poll = polls.get(code);
        if (!poll || socket.data.pollCode !== code) return;
        const visitor = poll.visitors.get(socket.data.voterId);
        if (!isOpen(poll) || !visitor || visitor.voted || !Number.isInteger(index) || index < 0 || index >= poll.options.length) {
            // Resync the client, e.g. a second tab that already voted.
            socket.emit('init', voterView(poll, socket.data.voterId));
            return;
        }
        if (!db.castVote(code, socket.data.voterId, index)) return;
        poll.votes[index]++;
        visitor.voted = true;
        visitor.choice = index;
        scheduleUpdate(poll, { votesChanged: true });
    });

    // A reaction from a voter in the poll. The reply says whether it was
    // accepted, so the sender (who shows their own reaction straight away)
    // knows whether it will come back in the next broadcast.
    on('react', (payload, ack) => {
        const code = payload?.code;
        const index = payload?.reaction;
        const poll = polls.get(code);
        const ok = Boolean(poll) && socket.data.pollCode === code
            && Number.isInteger(index) && index >= 0 && index < REACTIONS.length
            && reactionLimiter.take(socket.data.voterId).ok;
        if (ok) addReaction(poll, index);
        reply(ack, { ok });
    });

    on('disconnect', () => {
        const poll = leavePoll(socket);
        if (poll) scheduleUpdate(poll);
    });
});

loadPolls();

server.listen(PORT, () => {
    console.log(`🚀 Sunucu Hazır: ${PUBLIC_URL || `http://${localIp}:${PORT}`}`);
});
