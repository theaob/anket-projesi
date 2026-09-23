// Integration tests: each suite runs a real server process and talks to it
// over HTTP and Socket.IO, the way browsers do.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, connect, call, once, wait, voterCookie, createPoll, joinAsVoter } = require('./helpers');

describe('HTTP', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('answers the health check', async () => {
        const res = await fetch(`${server.url}/healthz`);
        assert.equal(res.status, 200);
        assert.equal(await res.text(), 'ok');
    });

    it('sends security headers that only allow its own scripts', async () => {
        const res = await fetch(`${server.url}/`);
        assert.match(res.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });

    it('redirects the removed admin page to the home page', async () => {
        const res = await fetch(`${server.url}/admin.html`, { redirect: 'manual' });
        assert.equal(res.status, 302);
    });
});

describe('poll ownership', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('rejects a wrong manage secret', async () => {
        const s = await connect(server.url);
        const res = await call(s, 'manage', crypto.randomBytes(24).toString('base64url'));
        assert.ok(res.error);
        s.close();
    });

    it('ignores owner actions from a socket without the secret', async () => {
        const { owner, code, state } = await createPoll(server.url, 'Asıl soru', ['A', 'B']);
        const intruder = await connect(server.url);
        intruder.emit('updatePoll', { code, question: 'HACKED', options: ['x'] });
        intruder.emit('resetVotes', code);
        intruder.emit('setVoting', { code, open: false });
        intruder.emit('deletePoll', code);
        const exported = await call(intruder, 'exportCsv', code);
        await wait(200);
        const poll = await state();
        assert.equal(poll.question, 'Asıl soru');
        assert.equal(poll.voting.open, true);
        assert.ok(exported.error);
        owner.close(); intruder.close();
    });

    it('stores only a hash of the manage secret', async () => {
        const { owner, code, secret } = await createPoll(server.url);
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(require('path').join(server.dataDir, 'anket.db'), { readOnly: true });
        const row = db.prepare('SELECT * FROM polls WHERE code = ?').get(code);
        db.close();
        assert.equal(row.manage_hash, crypto.createHash('sha256').update(secret).digest('hex'));
        assert.ok(!Object.values(row).includes(secret));
        owner.close();
    });
});

describe('voting', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('refuses voters without a server-issued cookie', async () => {
        const { owner, code } = await createPoll(server.url);
        const forged = `anket_vid=${crypto.randomBytes(16).toString('hex')}.${crypto.randomBytes(32).toString('base64url')}`;
        for (const cookie of [undefined, forged]) {
            const { socket, error } = await joinAsVoter(server.url, code, cookie);
            assert.ok(error, `joined with cookie ${cookie}`);
            socket.close();
        }
        owner.close();
    });

    it('issues an HttpOnly cookie and counts one vote per voter', async () => {
        const { owner, code, state } = await createPoll(server.url);
        const { status, setCookie, cookie } = await voterCookie(server.url);
        assert.equal(status, 200);
        assert.match(setCookie, /HttpOnly/);
        assert.match(setCookie, /SameSite=Lax/);

        const { socket, poll } = await joinAsVoter(server.url, code, cookie);
        assert.equal(poll.voted, false);
        socket.emit('castVote', { code, index: 0 });
        socket.emit('castVote', { code, index: 0 });
        socket.emit('castVote', { code, index: 1 });
        await wait(200);
        assert.deepEqual((await state()).votes, [1, 0]);

        // A second tab with the same cookie is recognised as having voted.
        const again = await joinAsVoter(server.url, code, cookie);
        assert.equal(again.poll.voted, true);
        socket.close(); again.socket.close(); owner.close();
    });

    it('rejects invalid option indexes', async () => {
        const { owner, code, state } = await createPoll(server.url);
        const { cookie } = await voterCookie(server.url);
        const { socket } = await joinAsVoter(server.url, code, cookie);
        for (const index of [-1, 2, 1.5, '0', 'constructor', null]) socket.emit('castVote', { code, index });
        await wait(200);
        assert.deepEqual((await state()).votes, [0, 0]);
        socket.close(); owner.close();
    });

    it('keeps votes when only the question changes and resets them when options change', async () => {
        const { owner, code, state } = await createPoll(server.url, 'Soru', ['A', 'B']);
        const { cookie } = await voterCookie(server.url);
        const { socket } = await joinAsVoter(server.url, code, cookie);
        socket.emit('castVote', { code, index: 1 });
        await wait(150);

        owner.emit('updatePoll', { code, question: 'Soru (düzeltildi)', options: ['A', 'B'] });
        await wait(150);
        assert.deepEqual((await state()).votes, [0, 1]);

        const reset = once(socket, 'init');
        owner.emit('updatePoll', { code, question: 'Yeni', options: ['A', 'B', 'C'] });
        const init = await reset;
        assert.deepEqual(init.votes, [0, 0, 0]);
        assert.equal(init.voted, false);
        socket.close(); owner.close();
    });

    it('rejects votes while voting is closed', async () => {
        const { owner, code, state } = await createPoll(server.url);
        const { cookie } = await voterCookie(server.url);
        const { socket } = await joinAsVoter(server.url, code, cookie);
        const closed = once(socket, 'init');
        owner.emit('setVoting', { code, open: false });
        assert.equal((await closed).voting.open, false);
        socket.emit('castVote', { code, index: 0 });
        await wait(200);
        assert.deepEqual((await state()).votes, [0, 0]);
        socket.close(); owner.close();
    });

    it('closes voting automatically when the timer runs out', async () => {
        const { owner, code } = await createPoll(server.url);
        owner.emit('setVoting', { code, open: true, seconds: 5 });
        const started = await once(owner, 'managePoll');
        assert.equal(started.voting.open, true);
        assert.ok(started.voting.remainingMs > 4000);
        const closed = await new Promise((resolve) => {
            owner.on('managePoll', (p) => { if (!p.voting.open) resolve(p); });
        });
        assert.equal(closed.voting.open, false);
        owner.close();
    });
});

describe('CSV export', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('neutralises spreadsheet formulas in option text', async () => {
        const { owner, code } = await createPoll(server.url, 'Q', ['=HYPERLINK("http://x","y")', '+1', '-2', '@SUM(A1)', 'normal "quoted"']);
        const { csv } = await call(owner, 'exportCsv', code);
        assert.match(csv, /^\uFEFF/);
        assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""y"")",0`));
        assert.ok(csv.includes(`"'+1",0`));
        assert.ok(csv.includes(`"'-2",0`));
        assert.ok(csv.includes(`"'@SUM(A1)",0`));
        assert.ok(csv.includes(`"normal ""quoted""",0`));
        owner.close();
    });
});

describe('robustness', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('survives malformed messages on every event', async () => {
        const { owner, code, secret } = await createPoll(server.url);
        const s = await connect(server.url);
        await call(s, 'manage', secret);
        const junk = [undefined, null, 0, 1e308, '', 'x'.repeat(5000), [], {}, { code: {} },
            { code, options: [{}, 5, null] }, { code, index: 1.5 }, true];
        for (const event of ['createPoll', 'manage', 'updatePoll', 'deletePoll', 'resetVotes', 'setVoting',
            'exportCsv', 'joinPoll', 'watchPoll', 'castVote', 'react']) {
            for (const payload of junk) { s.emit(event, payload); s.emit(event, payload, payload); }
        }
        await wait(500);
        assert.ok(server.alive(), server.output());
        const res = await fetch(`${server.url}/healthz`);
        assert.equal(res.status, 200);
        s.close(); owner.close();
    });
});

describe('persistence', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('keeps polls, votes and voter identities across a restart', async () => {
        const { owner, code, secret } = await createPoll(server.url, 'Kalıcı mı?', ['Evet', 'Hayır']);
        const { cookie } = await voterCookie(server.url);
        const { socket } = await joinAsVoter(server.url, code, cookie);
        socket.emit('castVote', { code, index: 0 });
        await wait(200);
        socket.close(); owner.close();

        await server.restart();

        const o = await connect(server.url);
        const { poll } = await call(o, 'manage', secret);
        assert.equal(poll.question, 'Kalıcı mı?');
        assert.deepEqual(poll.votes, [1, 0]);
        const again = await joinAsVoter(server.url, code, cookie);
        assert.equal(again.poll.voted, true);
        again.socket.close(); o.close();
    });
});

describe('rate limits', () => {
    let server;
    before(async () => { server = await startServer({ VOTER_ID_BURST: '3', VOTER_ID_PER_HOUR: '1' }); });
    after(() => server.stop());

    it('limits new voter identities per client and ignores spoofed X-Forwarded-For', async () => {
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await voterCookie(server.url)).status);
        assert.deepEqual(statuses, [200, 200, 200, 429]);
        // TRUST_PROXY is not set, so a made-up client address must not help.
        const spoofed = await voterCookie(server.url, { 'X-Forwarded-For': '203.0.113.9' });
        assert.equal(spoofed.status, 429);
        assert.ok(spoofed.body.retryAfterSec > 0);
    });
});

describe('behind a trusted proxy', () => {
    let server;
    before(async () => { server = await startServer({ TRUST_PROXY: '1', VOTER_ID_BURST: '2', VOTER_ID_PER_HOUR: '1' }); });
    after(() => server.stop());

    it('limits each real client separately', async () => {
        const as = (ip) => voterCookie(server.url, { 'X-Forwarded-For': ip });
        assert.equal((await as('198.51.100.1')).status, 200);
        assert.equal((await as('198.51.100.1')).status, 200);
        assert.equal((await as('198.51.100.1')).status, 429);
        assert.equal((await as('198.51.100.2')).status, 200);
        // Only the proxy's own entry counts; a client-supplied prefix is ignored.
        assert.equal((await as('10.0.0.1, 198.51.100.1')).status, 429);
    });

    it('marks cookies Secure behind an HTTPS proxy', async () => {
        const { setCookie } = await voterCookie(server.url, { 'X-Forwarded-For': '198.51.100.3', 'X-Forwarded-Proto': 'https' });
        assert.match(setCookie, /; Secure/);
    });
});

describe('live updates', () => {
    let server;
    before(async () => { server = await startServer({ VOTER_ID_BURST: '100' }); });
    after(() => server.stop());

    it('batches updates under a burst of votes without losing any', async () => {
        const { owner, code, state } = await createPoll(server.url, 'Q', ['A', 'B']);
        let ownerUpdates = 0;
        owner.on('managePoll', () => { ownerUpdates++; });

        // A voter who has already voted sees results, so it receives updateVotes.
        const { cookie: watcherCookie } = await voterCookie(server.url);
        const watcher = await joinAsVoter(server.url, code, watcherCookie);
        watcher.socket.emit('castVote', { code, index: 1 });
        await wait(400);
        let voterUpdates = 0;
        let lastVotes = null;
        watcher.socket.on('updateVotes', (votes) => { voterUpdates++; lastVotes = votes; });
        ownerUpdates = 0;

        const voters = [];
        for (let i = 0; i < 40; i++) {
            const { cookie } = await voterCookie(server.url);
            voters.push(await joinAsVoter(server.url, code, cookie));
        }
        ownerUpdates = 0;
        for (const v of voters) v.socket.emit('castVote', { code, index: 0 });
        await wait(1000);

        assert.deepEqual((await state()).votes, [40, 1]);
        assert.deepEqual(lastVotes, [40, 1], 'the last update carries the final counts');
        assert.ok(voterUpdates >= 1 && voterUpdates < 20, `voter got ${voterUpdates} updates for 40 votes`);
        assert.ok(ownerUpdates >= 1 && ownerUpdates < 20, `owner got ${ownerUpdates} updates for 40 votes`);
    });

    it('counts a visitor as "left without voting" only after the grace period', async () => {
        const { owner, code, state } = await createPoll(server.url);

        // Leaves and comes back quickly (a reload): never counted.
        const { cookie: quick } = await voterCookie(server.url);
        (await joinAsVoter(server.url, code, quick)).socket.close();
        await wait(300);
        assert.equal((await state()).abandoned, 0);
        const back = await joinAsVoter(server.url, code, quick);

        // Leaves for good: counted once the grace period (10 s) is over, and
        // the managers are told without any other event happening.
        const { cookie: gone } = await voterCookie(server.url);
        (await joinAsVoter(server.url, code, gone)).socket.close();
        await wait(300);
        assert.equal((await state()).abandoned, 0);
        const counted = await new Promise((resolve) => {
            owner.on('managePoll', (p) => { if (p.abandoned === 1) resolve(p); });
        });
        assert.equal(counted.abandoned, 1);
        assert.equal(counted.visits, 2);
        back.socket.close();
    });
});

describe('reactions', () => {
    let server;
    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it('sends reactions to voters and presenter screens in batches', async () => {
        const { owner, code } = await createPoll(server.url);
        const presenter = await connect(server.url);
        const { reactions } = await call(presenter, 'watchPoll', code);
        assert.ok(reactions.length >= 2);
        const alice = await joinAsVoter(server.url, code, (await voterCookie(server.url)).cookie);
        const bob = await joinAsVoter(server.url, code, (await voterCookie(server.url)).cookie);
        assert.deepEqual(alice.poll.reactions, reactions);

        const seen = [];
        presenter.on('reactions', (counts) => seen.push(counts));
        const bobSeen = [];
        bob.socket.on('reactions', (counts) => bobSeen.push(counts));
        const replies = [];
        for (let i = 0; i < 5; i++) replies.push(await call(alice.socket, 'react', { code, reaction: 1 }));
        replies.push(await call(bob.socket, 'react', { code, reaction: 0 }));
        await wait(700);

        assert.ok(replies.every((r) => r.ok));
        const total = (list) => list.reduce((sum, counts) => counts.map((n, i) => n + (sum[i] || 0)), []);
        assert.equal(total(seen)[1], 5);
        assert.equal(total(seen)[0], 1);
        assert.deepEqual(total(bobSeen), total(seen));
        assert.ok(seen.length < 6, `expected batching, got ${seen.length} messages`);
        owner.close(); presenter.close(); alice.socket.close(); bob.socket.close();
    });

    it('rejects invalid reactions, outsiders and floods', async () => {
        const { owner, code } = await createPoll(server.url);
        const outsider = await connect(server.url, { cookie: (await voterCookie(server.url)).cookie });
        assert.equal((await call(outsider, 'react', { code, reaction: 0 })).ok, false);

        const { socket } = await joinAsVoter(server.url, code, (await voterCookie(server.url)).cookie);
        for (const reaction of [-1, 99, 1.5, '0', null]) {
            assert.equal((await call(socket, 'react', { code, reaction })).ok, false);
        }
        const results = [];
        for (let i = 0; i < 20; i++) results.push((await call(socket, 'react', { code, reaction: 0 })).ok);
        // A burst of 10, plus at most one refilled while the loop ran.
        const accepted = results.filter(Boolean).length;
        assert.ok(accepted >= 10 && accepted <= 11, `accepted ${accepted}`);
        owner.close(); outsider.close(); socket.close();
    });
});
