const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let pollData = {
    question: "Henüz bir soru oluşturulmadı.",
    options: [],
    votes: {},
};

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


app.get('/export', (req, res) => {
    let csvContent = "\uFEFF"; // UTF-8 BOM for Excel Turkish chars
    csvContent += "Secenek,Oy Sayisi\n";
    pollData.options.forEach((opt, i) => {
        csvContent += `"${opt}",${pollData.votes[i] || 0}\n`;
    });
    res.setHeader('Content-disposition', 'attachment; filename=anket_sonuclari.csv');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.send(csvContent);
});

io.on('connection', (socket) => {
    socket.emit('init', pollData);
    socket.on('updatePoll', (data) => {
        pollData.question = data.question;
        pollData.options = data.options;
        pollData.votes = {};
        data.options.forEach((_, i) => pollData.votes[i] = 0);
        io.emit('init', pollData);
    });
    socket.on('castVote', (index) => {
        if (pollData.votes[index] !== undefined) {
            pollData.votes[index]++;
            io.emit('updateVotes', pollData.votes);
        }
    });
    socket.on('resetVotes', () => {
        Object.keys(pollData.votes).forEach(v => pollData.votes[v] = 0);
        io.emit('updateVotes', pollData.votes);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Sunucu Hazır: http://${localIp}:${PORT}`);
    console.log(`🛠 Admin Paneli: http://${localIp}:${PORT}/admin.html`);
});