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
    if (voting.phase === 'closed') return 'Closed';
    if (voting.phase === 'scheduled') return 'Scheduled (not started yet)';
    return voting.closesAt ? 'Open (with an end time)' : 'Open';
}

function fileName(report, ext) {
    return `poll_${report.code}_${localText(report.exportedAt, report.tzOffset).slice(0, 10)}.${ext}`;
}

// ── Excel ──────────────────────────────────────────────────────
function toXlsx(report) {
    const tz = report.tzOffset;
    const date = (ms) => ({ v: excelDate(ms, tz), style: 'date' });
    const f = report.funnel;

    const summary = {
        name: 'Summary',
        cols: [26, 60],
        rows: [
            [{ v: 'Poll report', style: 'title' }],
            [],
            [{ v: 'Question', style: 'bold' }, report.question],
            [{ v: 'Poll code', style: 'bold' }, report.code],
            [{ v: 'Created', style: 'bold' }, date(report.createdAt)],
            [{ v: 'Report date', style: 'bold' }, date(report.exportedAt)],
            [{ v: 'Voting', style: 'bold' }, votingText(report.voting)],
            ...(report.voting.opensAt ? [[{ v: 'Start', style: 'bold' }, date(report.voting.opensAt)]] : []),
            ...(report.voting.closesAt ? [[{ v: 'End', style: 'bold' }, date(report.voting.closesAt)]] : []),
            [],
            [{ v: 'Participation', style: 'header' }, { v: '', style: 'header' }],
            ['Visitors', f.visitors],
            ['Voted', f.voted],
            ['Left without voting', f.abandoned],
            ['Connected now', f.connected],
            ['Participation rate (voted / visitors)', f.participation === null ? '—' : { v: f.participation, style: 'percent' }],
            ['First vote', report.firstVoteAt === null ? '—' : date(report.firstVoteAt)],
            ['Last vote', report.lastVoteAt === null ? '—' : date(report.lastVoteAt)],
            [],
            ['Times are in the time zone of the device that downloaded the report.']
        ]
    };

    const n = report.options.length;
    const results = {
        name: 'Results',
        cols: [40, 10, 10],
        rows: [
            [{ v: 'Option', style: 'header' }, { v: 'Votes', style: 'header' }, { v: 'Share', style: 'header' }],
            ...report.options.map(o => [o.text, o.votes, { v: o.share, style: 'percent' }]),
            [{ v: 'Total', style: 'bold' }, { v: report.totalVotes, style: 'bold' }, { v: report.totalVotes ? 1 : 0, style: 'percent' }]
        ],
        charts: n ? [{
            title: 'Votes by option', dir: 'bar', labels: true,
            cats: { col: 0, from: 1, to: n }, vals: { col: 1, from: 1, to: n },
            at: { col: 4, row: 1, cols: 8, rows: Math.max(12, n * 2 + 4) }
        }] : []
    };

    const voteSheet = {
        name: 'Votes',
        cols: [8, 22, 40],
        rows: [
            [{ v: '#', style: 'header' }, { v: 'Time', style: 'header' }, { v: 'Option', style: 'header' }],
            ...report.votes.map((v, i) => [i + 1, date(v.at), report.options[v.option].text])
        ]
    };

    const buckets = report.timeline.buckets;
    const withDay = buckets.length > 0
        && localText(buckets[0].start, tz).slice(0, 10) !== localText(buckets[buckets.length - 1].start, tz).slice(0, 10);
    const timeSheet = {
        name: 'Timeline',
        cols: [22, 12, 16],
        rows: [
            [{ v: `Interval start (${report.timeline.bucketMinutes ?? '—'} min)`, style: 'header' },
                { v: 'Votes', style: 'header' }, { v: 'Total votes', style: 'header' }],
            ...buckets.map(b => [date(b.start), b.votes, b.cumulative])
        ],
        charts: buckets.length ? [{
            title: 'Votes over time', dir: 'col', dateFormat: withDay ? 'mmm d hh:mm' : 'hh:mm',
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
        ['Question', report.question],
        ['Poll code', report.code],
        ['Report date', localText(report.exportedAt, tz)],
        ['Voting', votingText(report.voting)],
        ...(report.voting.opensAt ? [['Start', localText(report.voting.opensAt, tz)]] : []),
        ...(report.voting.closesAt ? [['End', localText(report.voting.closesAt, tz)]] : []),
        [],
        ['Option', 'Votes', 'Share (%)'],
        ...report.options.map(o => [o.text, o.votes, pct(o.share)]),
        ['Total', report.totalVotes, report.totalVotes ? 100 : 0],
        [],
        ['Visitors', f.visitors],
        ['Voted', f.voted],
        ['Left without voting', f.abandoned],
        ['Connected now', f.connected],
        ['Participation rate (%)', f.participation === null ? '' : pct(f.participation)],
        [],
        ['Time', 'Option'],
        ...report.votes.map(v => [localText(v.at, tz), report.options[v.option].text])
    ];
    // BOM so Excel reads the file as UTF-8 (accented characters, emoji).
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
            voting: report.voting.phase,
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
