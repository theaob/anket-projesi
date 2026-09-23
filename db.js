// SQLite storage for polls, options, visitors and votes.
//
// Uses Node's built-in `node:sqlite` (Node >= 22.13) so there is no native
// module to compile for each Docker platform. The server keeps a live copy of
// every poll in memory; this module is the durable source of truth that the
// copy is loaded from at startup and written through to on every change.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Each entry upgrades the schema by one version; PRAGMA user_version records
// how many have been applied.
const MIGRATIONS = [
    // 1: initial schema
    `
CREATE TABLE polls (
    code        TEXT PRIMARY KEY,
    question    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE options (
    poll_code   TEXT NOT NULL REFERENCES polls(code) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    text        TEXT NOT NULL,
    PRIMARY KEY (poll_code, position)
);
CREATE TABLE visitors (
    poll_code   TEXT NOT NULL REFERENCES polls(code) ON DELETE CASCADE,
    voter_id    TEXT NOT NULL,
    first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (poll_code, voter_id)
);
-- One row per vote; the primary key enforces one vote per voter per poll.
CREATE TABLE votes (
    poll_code   TEXT NOT NULL,
    voter_id    TEXT NOT NULL,
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (poll_code, voter_id),
    FOREIGN KEY (poll_code, voter_id) REFERENCES visitors(poll_code, voter_id) ON DELETE CASCADE
);
`,
    // 2: per-poll owners. Each poll is managed through a secret link; only the
    // secret's SHA-256 hash is stored. Polls from the shared-admin era have no
    // owner, so they are removed (cascading to options, visitors and votes).
    `
DELETE FROM polls;
ALTER TABLE polls ADD COLUMN manage_hash TEXT;
CREATE UNIQUE INDEX polls_manage_hash ON polls(manage_hash);
`,
    // 3: open/close voting. `closes_at` is the timer deadline in ms since the
    // epoch (NULL when no timer is running).
    `
ALTER TABLE polls ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE polls ADD COLUMN closes_at INTEGER;
`,
];
const SCHEMA_VERSION = MIGRATIONS.length;

function openDatabase(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, 'anket.db'));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) {
        throw new Error(`Veritabanı şeması (${version}) bu sürümden (${SCHEMA_VERSION}) daha yeni.`);
    }
    for (let v = version; v < SCHEMA_VERSION; v++) {
        transaction(db, () => {
            db.exec(MIGRATIONS[v]);
            db.exec(`PRAGMA user_version = ${v + 1}`);
        });
    }

    const stmt = {
        insertPoll: db.prepare('INSERT INTO polls (code, question, manage_hash) VALUES (?, ?, ?)'),
        codeByManageHash: db.prepare('SELECT code FROM polls WHERE manage_hash = ?'),
        setVoting: db.prepare('UPDATE polls SET closed = ?, closes_at = ? WHERE code = ?'),
        updateQuestion: db.prepare("UPDATE polls SET question = ?, updated_at = datetime('now') WHERE code = ?"),
        deletePoll: db.prepare('DELETE FROM polls WHERE code = ?'),
        deleteOptions: db.prepare('DELETE FROM options WHERE poll_code = ?'),
        insertOption: db.prepare('INSERT INTO options (poll_code, position, text) VALUES (?, ?, ?)'),
        insertVisitor: db.prepare('INSERT OR IGNORE INTO visitors (poll_code, voter_id) VALUES (?, ?)'),
        deleteVisitor: db.prepare('DELETE FROM visitors WHERE poll_code = ? AND voter_id = ?'),
        insertVote: db.prepare('INSERT OR IGNORE INTO votes (poll_code, voter_id, position) VALUES (?, ?, ?)'),
        deleteVotes: db.prepare('DELETE FROM votes WHERE poll_code = ?'),
        allPolls: db.prepare('SELECT code, question, closed, closes_at FROM polls ORDER BY created_at, code'),
        allOptions: db.prepare('SELECT poll_code, position, text FROM options ORDER BY poll_code, position'),
        allVisitors: db.prepare(`
            SELECT v.poll_code, v.voter_id, vo.position
            FROM visitors v
            LEFT JOIN votes vo ON vo.poll_code = v.poll_code AND vo.voter_id = v.voter_id`),
    };

    return {
        // Returns every poll as { code, question, options, votes, visitors,
        // closed, closesAt } where visitors is Map<voterId, { voted, choice }>.
        loadAll() {
            const polls = new Map();
            for (const p of stmt.allPolls.all()) {
                polls.set(p.code, {
                    code: p.code, question: p.question, options: [], votes: [], visitors: new Map(),
                    closed: p.closed === 1, closesAt: p.closes_at
                });
            }
            for (const o of stmt.allOptions.all()) {
                const poll = polls.get(o.poll_code);
                poll.options[o.position] = o.text;
                poll.votes[o.position] = 0;
            }
            for (const v of stmt.allVisitors.all()) {
                const poll = polls.get(v.poll_code);
                const voted = v.position !== null;
                poll.visitors.set(v.voter_id, { voted, choice: voted ? v.position : null });
                if (voted && v.position in poll.votes) poll.votes[v.position]++;
            }
            return [...polls.values()];
        },

        createPoll(code, question, manageHash) {
            stmt.insertPoll.run(code, question, manageHash);
        },

        // Returns the code of the poll a manage-secret hash belongs to, or null.
        findCodeByManageHash(manageHash) {
            return stmt.codeByManageHash.get(manageHash)?.code ?? null;
        },

        // Pass `options` only when they changed: that replaces the options and
        // clears the poll's votes, matching the server's "new round" rule.
        updatePoll(code, question, options) {
            transaction(db, () => {
                stmt.updateQuestion.run(question, code);
                if (options) {
                    stmt.deleteVotes.run(code);
                    stmt.deleteOptions.run(code);
                    options.forEach((text, i) => stmt.insertOption.run(code, i, text));
                }
            });
        },

        // closed: voting is shut; closesAt: timer deadline (ms) or null.
        setVoting(code, closed, closesAt) {
            stmt.setVoting.run(closed ? 1 : 0, closesAt, code);
        },

        deletePoll(code) {
            stmt.deletePoll.run(code);
        },

        addVisitor(code, voterId) {
            stmt.insertVisitor.run(code, voterId);
        },

        // Returns false if this voter already has a vote in this poll.
        castVote(code, voterId, position) {
            return stmt.insertVote.run(code, voterId, position).changes === 1;
        },

        // Clears all votes and forgets the visitors listed in `dropVoterIds`.
        resetVotes(code, dropVoterIds) {
            transaction(db, () => {
                stmt.deleteVotes.run(code);
                for (const id of dropVoterIds) stmt.deleteVisitor.run(code, id);
            });
        },

        close() {
            db.close();
        },
    };
}

function transaction(db, fn) {
    db.exec('BEGIN');
    try {
        fn();
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

module.exports = { openDatabase };
