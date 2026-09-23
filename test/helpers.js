// Starts real server processes for the integration tests, each on a free
// port with its own temporary data directory.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');

// Every socket a test opens, so a failed assertion (which skips the test's
// own close() calls) can't leave sockets reconnecting and hang the run.
const sockets = new Set();

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

// Returns { url, dataDir, stop(), restart() }. The data directory survives restart()
// so persistence can be tested; stop() removes it.
async function startServer(env = {}) {
    const port = await freePort();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anket-test-'));
    let child;

    async function launch() {
        child = spawn(process.execPath, ['--no-warnings', 'server.js'], {
            cwd: ROOT,
            env: { ...process.env, ...env, PORT: String(port), DATA_DIR: dataDir },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', (d) => { output += d; });
        child.stderr.on('data', (d) => { output += d; });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10000);
            child.stdout.on('data', () => {
                if (output.includes('Server ready')) { clearTimeout(timer); resolve(); }
            });
            child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
        });
        child.output = () => output;
    }

    async function kill() {
        if (!child || child.exitCode !== null) return;
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
    }

    await launch();
    return {
        url: `http://127.0.0.1:${port}`,
        dataDir,
        output: () => child.output(),
        alive: () => child.exitCode === null,
        async restart() { await kill(); await launch(); },
        async stop() {
            for (const s of sockets) s.close();
            sockets.clear();
            await kill();
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    };
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const call = (socket, event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url, { cookie, headers } = {}) {
    const socket = io(url, {
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
        extraHeaders: { ...(cookie ? { cookie } : {}), ...headers }
    });
    sockets.add(socket);
    await once(socket, 'connect');
    return socket;
}

// Asks the server for a voter identity; returns { status, cookie, body }.
async function voterCookie(url, headers = {}) {
    const res = await fetch(`${url}/api/voter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: '{}'
    });
    const setCookie = res.headers.get('set-cookie') || '';
    return { status: res.status, setCookie, cookie: setCookie.split(';')[0], body: await res.json() };
}

// Creates a poll with the given options and returns an owner socket for it.
async function createPoll(url, question = 'Soru?', options = ['A', 'B']) {
    const owner = await connect(url);
    const { code, secret } = await call(owner, 'createPoll');
    const updated = once(owner, 'managePoll');
    await call(owner, 'manage', secret);
    owner.emit('updatePoll', { code, question, options });
    await updated;
    return { owner, code, secret, state: async () => (await call(owner, 'manage', secret)).poll };
}

// Connects a voter with the given cookie and joins the poll; resolves with
// the socket and the init payload (or the pollError message).
async function joinAsVoter(url, code, cookie) {
    const socket = await connect(url, { cookie });
    const result = await new Promise((resolve) => {
        socket.once('init', (poll) => resolve({ poll }));
        socket.once('pollError', (error) => resolve({ error }));
        socket.emit('joinPoll', code);
    });
    return { socket, ...result };
}

module.exports = { startServer, connect, call, once, wait, voterCookie, createPoll, joinAsVoter };
