const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// polls: Map<code: string, pollData>
const polls = new Map();

function generateCode() {
    let code;
    do {
        code = String(Math.floor(1000 + Math.random() * 9000));
    } while (polls.has(code));
    return code;
}

function getPollList() {
    return [...polls.values()].map(p => ({
        code: p.code,
        question: p.question,
        options: p.options,
        votes: p.votes
    }));
}

const getLocalIp = () => {
    const os = require('os');
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
        csvContent += `"${opt}",${poll.votes[i] || 0}\n`;
    });
    res.setHeader('Content-disposition', `attachment; filename=anket_${code}.csv`);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.send(csvContent);
});

io.on('connection', (socket) => {

    // ── Admin events ───────────────────────────────────────────
    socket.on('joinAdmin', () => {
        socket.join('admin');
        socket.emit('pollList', getPollList());
    });

    socket.on('createPoll', () => {
        const code = generateCode();
        polls.set(code, { code, question: 'Yeni Anket', options: [], votes: {} });
        io.to('admin').emit('pollList', getPollList());
        socket.emit('pollCreated', code);
    });

    socket.on('updatePoll', ({ code, question, options }) => {
        const poll = polls.get(code);
        if (!poll) return;
        poll.question = question;
        poll.options = options;
        poll.votes = {};
        options.forEach((_, i) => poll.votes[i] = 0);
        io.to('admin').emit('pollList', getPollList());
        io.to(`poll:${code}`).emit('init', poll);
    });

    socket.on('deletePoll', (code) => {
        polls.delete(code);
        io.to('admin').emit('pollList', getPollList());
    });

    socket.on('resetVotes', (code) => {
        const poll = polls.get(code);
        if (!poll) return;
        Object.keys(poll.votes).forEach(v => poll.votes[v] = 0);
        io.to(`poll:${code}`).emit('updateVotes', poll.votes);
        io.to('admin').emit('pollList', getPollList());
    });

    // ── Voter events ───────────────────────────────────────────
    socket.on('joinPoll', (code) => {
        const poll = polls.get(code);
        if (!poll) {
            socket.emit('pollError', 'Geçersiz anket kodu.');
            return;
        }
        socket.join(`poll:${code}`);
        socket.emit('init', poll);
    });

    socket.on('castVote', ({ code, index }) => {
        const poll = polls.get(code);
        if (!poll || poll.votes[index] === undefined) return;
        poll.votes[index]++;
        io.to(`poll:${code}`).emit('updateVotes', poll.votes);
        io.to('admin').emit('pollList', getPollList());
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Sunucu Hazır: http://${localIp}:${PORT}`);
    console.log(`🛠 Admin Paneli: http://${localIp}:${PORT}/admin.html`);
});