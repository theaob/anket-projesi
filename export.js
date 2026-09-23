// Poll exports: one report built from the live poll and its stored vote
// times, written out as an Excel workbook, CSV or JSON. The printable PDF
// report (report.html) renders the same report in the browser.
const { writeXlsx } = require('./xlsx');

const MINUTE = 60 * 1000;
// Candidate widths for the votes-over-time buckets; the smallest that fits
// the poll's voting span into MAX_BUCKETS is used.
const BUCKET_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 10080];
const MAX_BUCKETS = 40;

// The JSON export's format id. Importing accepts this file (only the question
// and options are used) or a bare { question, options } object.
const JSON_FORMAT = 'anket-projesi/poll';

// poll: the live poll; details: db.exportDetails(); stats: { abandoned,
// connected, voting: { phase, opensAt, closesAt } }; tzOffset: the client's
// Date#getTimezoneOffset(), used to align buckets and write local times.
function buildReport(poll, details, stats, tzOffset = 0) {
    const totalVotes = poll.votes.reduce((a, b) => a + b, 0);
    let voted = 0;
    for (const v of poll.visitors.values()) if (v.voted) voted++;
    const visitors = poll.visitors.size;
    const votes = details.votes.filter(v => v.option in poll.options);
    return {
        code: poll.code,
        question: poll.question,
        createdAt: details.createdAt,
        exportedAt: Date.now(),
        tzOffset,
        voting: stats.voting,
        options: poll.options.map((text, i) => ({
            text,
            votes: poll.votes[i] || 0,
            share: totalVotes ? (poll.votes[i] || 0) / totalVotes : 0
        })),
        totalVotes,
        funnel: {
            visitors,
            voted,
            abandoned: stats.abandoned,
            connected: stats.connected,
            participation: visitors ? voted / visitors : null
        },
        votes,
        firstVoteAt: votes.length ? votes[0].at : null,
        lastVoteAt: votes.length ? votes[votes.length - 1].at : null,
        timeline: timeline(votes, tzOffset)
    };
}

function timeline(votes, tzOffset) {
    if (!votes.length) return { bucketMinutes: null, buckets: [] };
    const shift = -tzOffset * MINUTE; // UTC → local
    const first = votes[0].at + shift;
    const last = votes[votes.length - 1].at + shift;
    const minutes = BUCKET_MINUTES.find(m => Math.floor(last / (m * MINUTE)) - Math.floor(first / (m * MINUTE)) < MAX_BUCKETS)
        ?? BUCKET_MINUTES[BUCKET_MINUTES.length - 1];
    const size = minutes * MINUTE;
    const start = Math.floor(first / size) * size;
    const counts = new Array(Math.floor(last / size) - start / size + 1).fill(0);
    for (const v of votes) counts[Math.floor((v.at + shift - start) / size)]++;
    let cumulative = 0;
    return {
        bucketMinutes: minutes,
        buckets: counts.map((count, i) => {
            cumulative += count;
            return { start: start + i * size - shift, votes: count, cumulative };
        })
    };
}

// ── Formatting helpers ─────────────────────────────────────────
const localMs = (ms, tzOffset) => ms - tzOffset * MINUTE;
const localText = (ms, tzOffset) => (ms === null ? '' : new Date(localMs(ms, tzOffset)).toISOString().slice(0, 19).replace('T', ' '));
const excelDate = (ms, tzOffset) => (ms === null ? null : localMs(ms, tzOffset) / 86400000 + 25569);
const isoText = (ms) => (ms === null ? null : new Date(ms).toISOString());

function votingText(voting) {
    if (voting.phase === 'closed') return 'Kapalı';
    if (voting.phase === 'scheduled') return 'Planlandı (henüz başlamadı)';
    return voting.closesAt ? 'Açık (bitiş zamanı var)' : 'Açık';
}

function fileName(report, ext) {
    return `anket_${report.code}_${localText(report.exportedAt, report.tzOffset).slice(0, 10)}.${ext}`;
}

// ── Excel ──────────────────────────────────────────────────────
function toXlsx(report) {
    const tz = report.tzOffset;
    const date = (ms) => ({ v: excelDate(ms, tz), style: 'date' });
    const f = report.funnel;

    const summary = {
        name: 'Özet',
        cols: [26, 60],
        rows: [
            [{ v: 'Anket raporu', style: 'title' }],
            [],
            [{ v: 'Soru', style: 'bold' }, report.question],
            [{ v: 'Anket kodu', style: 'bold' }, report.code],
            [{ v: 'Oluşturulma', style: 'bold' }, date(report.createdAt)],
            [{ v: 'Rapor tarihi', style: 'bold' }, date(report.exportedAt)],
            [{ v: 'Oylama', style: 'bold' }, votingText(report.voting)],
            ...(report.voting.opensAt ? [[{ v: 'Başlangıç', style: 'bold' }, date(report.voting.opensAt)]] : []),
            ...(report.voting.closesAt ? [[{ v: 'Bitiş', style: 'bold' }, date(report.voting.closesAt)]] : []),
            [],
            [{ v: 'Katılım', style: 'header' }, { v: '', style: 'header' }],
            ['Ziyaretçi', f.visitors],
            ['Oy veren', f.voted],
            ['Oy vermeden ayrılan', f.abandoned],
            ['Şu an bağlı', f.connected],
            ['Katılım oranı (oy veren / ziyaretçi)', f.participation === null ? '—' : { v: f.participation, style: 'percent' }],
            ['İlk oy', report.firstVoteAt === null ? '—' : date(report.firstVoteAt)],
            ['Son oy', report.lastVoteAt === null ? '—' : date(report.lastVoteAt)],
            [],
            ['Saatler, raporu indiren cihazın saat dilimindedir.']
        ]
    };

    const n = report.options.length;
    const results = {
        name: 'Sonuçlar',
        cols: [40, 10, 10],
        rows: [
            [{ v: 'Seçenek', style: 'header' }, { v: 'Oy', style: 'header' }, { v: 'Yüzde', style: 'header' }],
            ...report.options.map(o => [o.text, o.votes, { v: o.share, style: 'percent' }]),
            [{ v: 'Toplam', style: 'bold' }, { v: report.totalVotes, style: 'bold' }, { v: report.totalVotes ? 1 : 0, style: 'percent' }]
        ],
        charts: n ? [{
            title: 'Oy dağılımı', dir: 'bar', labels: true,
            cats: { col: 0, from: 1, to: n }, vals: { col: 1, from: 1, to: n },
            at: { col: 4, row: 1, cols: 8, rows: Math.max(12, n * 2 + 4) }
        }] : []
    };

    const voteSheet = {
        name: 'Oylar',
        cols: [8, 22, 40],
        rows: [
            [{ v: '#', style: 'header' }, { v: 'Zaman', style: 'header' }, { v: 'Seçenek', style: 'header' }],
            ...report.votes.map((v, i) => [i + 1, date(v.at), report.options[v.option].text])
        ]
    };

    const buckets = report.timeline.buckets;
    const withDay = buckets.length > 0
        && localText(buckets[0].start, tz).slice(0, 10) !== localText(buckets[buckets.length - 1].start, tz).slice(0, 10);
    const timeSheet = {
        name: 'Zaman',
        cols: [22, 12, 16],
        rows: [
            [{ v: `Aralık başlangıcı (${report.timeline.bucketMinutes ?? '—'} dk)`, style: 'header' },
                { v: 'Oy', style: 'header' }, { v: 'Toplam oy', style: 'header' }],
            ...buckets.map(b => [date(b.start), b.votes, b.cumulative])
        ],
        charts: buckets.length ? [{
            title: 'Zamana göre oylar', dir: 'col', dateFormat: withDay ? 'dd.mm hh:mm' : 'hh:mm',
            cats: { col: 0, from: 1, to: buckets.length }, vals: { col: 1, from: 1, to: buckets.length },
            at: { col: 4, row: 1, cols: 10, rows: 16 }
        }] : []
    };

    return writeXlsx([summary, results, voteSheet, timeSheet]);
}

// ── CSV ────────────────────────────────────────────────────────
// A quoted CSV cell. Text starting with = + - @ (or a tab/carriage return) is
// prefixed with an apostrophe so spreadsheets show it instead of running it
// as a formula; option text is written by whoever created the poll.
function csvCell(value) {
    if (typeof value === 'number') return String(value);
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(report) {
    const tz = report.tzOffset;
    const f = report.funnel;
    const pct = (share) => Math.round(share * 1000) / 10;
    const lines = [
        ['Soru', report.question],
        ['Anket kodu', report.code],
        ['Rapor tarihi', localText(report.exportedAt, tz)],
        ['Oylama', votingText(report.voting)],
        ...(report.voting.opensAt ? [['Başlangıç', localText(report.voting.opensAt, tz)]] : []),
        ...(report.voting.closesAt ? [['Bitiş', localText(report.voting.closesAt, tz)]] : []),
        [],
        ['Seçenek', 'Oy', 'Yüzde'],
        ...report.options.map(o => [o.text, o.votes, pct(o.share)]),
        ['Toplam', report.totalVotes, report.totalVotes ? 100 : 0],
        [],
        ['Ziyaretçi', f.visitors],
        ['Oy veren', f.voted],
        ['Oy vermeden ayrılan', f.abandoned],
        ['Şu an bağlı', f.connected],
        ['Katılım oranı (%)', f.participation === null ? '' : pct(f.participation)],
        [],
        ['Zaman', 'Seçenek'],
        ...report.votes.map(v => [localText(v.at, tz), report.options[v.option].text])
    ];
    // BOM so Excel reads the file as UTF-8 (Turkish characters).
    return '\uFEFF' + lines.map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ── JSON ───────────────────────────────────────────────────────
function toJson(report) {
    return JSON.stringify({
        format: JSON_FORMAT,
        version: 1,
        exportedAt: isoText(report.exportedAt),
        poll: {
            question: report.question,
            options: report.options.map(o => o.text)
        },
        results: {
            code: report.code,
            createdAt: isoText(report.createdAt),
            voting: votingText(report.voting),
            opensAt: isoText(report.voting.opensAt ?? null),
            closesAt: isoText(report.voting.closesAt ?? null),
            options: report.options.map(o => ({ text: o.text, votes: o.votes })),
            totalVotes: report.totalVotes,
            visitors: report.funnel.visitors,
            voted: report.funnel.voted,
            leftWithoutVoting: report.funnel.abandoned,
            votes: report.votes.map(v => ({ at: isoText(v.at), option: v.option }))
        }
    }, null, 2) + '\n';
}

const FORMATS = {
    xlsx: (r) => ({ filename: fileName(r, 'xlsx'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: toXlsx(r) }),
    csv: (r) => ({ filename: fileName(r, 'csv'), mime: 'text/csv;charset=utf-8', data: toCsv(r) }),
    json: (r) => ({ filename: fileName(r, 'json'), mime: 'application/json', data: toJson(r) }),
    // The printable report is drawn in the browser, which formats the
    // (UTC ms) times itself.
    report: (r) => ({ report: r })
};

module.exports = { buildReport, FORMATS, JSON_FORMAT, csvCell };
