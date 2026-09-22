// SQLite storage for polls, options, visitors and votes.
//
// Uses Node's built-in `node:sqlite` (Node >= 22.13) so there is no native
// module to compile for each Docker platform. The server keeps a live copy of
// every poll in memory; this module is the durable source of truth that the
// copy is loaded from at startup and written through to on every change.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

const SCHEMA = `
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
`;

function openDatabase(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, 'anket.db'));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version === 0) {
        transaction(db, () => {
            db.exec(SCHEMA);
            db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        });
    } else if (version > SCHEMA_VERSION) {
        throw new Error(`Veritabanı şeması (${version}) bu sürümden (${SCHEMA_VERSION}) daha yeni.`);
    }

    const stmt = {
        insertPoll: db.prepare('INSERT INTO polls (code, question) VALUES (?, ?)'),
        updateQuestion: db.prepare("UPDATE polls SET question = ?, updated_at = datetime('now') WHERE code = ?"),
        deletePoll: db.prepare('DELETE FROM polls WHERE code = ?'),
        deleteOptions: db.prepare('DELETE FROM options WHERE poll_code = ?'),
        insertOption: db.prepare('INSERT INTO options (poll_code, position, text) VALUES (?, ?, ?)'),
        insertVisitor: db.prepare('INSERT OR IGNORE INTO visitors (poll_code, voter_id) VALUES (?, ?)'),
        deleteVisitor: db.prepare('DELETE FROM visitors WHERE poll_code = ? AND voter_id = ?'),
        insertVote: db.prepare('INSERT OR IGNORE INTO votes (poll_code, voter_id, position) VALUES (?, ?, ?)'),
        deleteVotes: db.prepare('DELETE FROM votes WHERE poll_code = ?'),
        allPolls: db.prepare('SELECT code, question FROM polls ORDER BY created_at, code'),
        allOptions: db.prepare('SELECT poll_code, position, text FROM options ORDER BY poll_code, position'),
        allVisitors: db.prepare(`
            SELECT v.poll_code, v.voter_id, vo.position
            FROM visitors v
            LEFT JOIN votes vo ON vo.poll_code = v.poll_code AND vo.voter_id = v.voter_id`),
        pollCount: db.prepare('SELECT COUNT(*) AS n FROM polls'),
    };

    return {
        // Returns every poll as { code, question, options, votes, visitors }
        // where visitors is Map<voterId, { voted, choice }>.
        loadAll() {
            const polls = new Map();
            for (const p of stmt.allPolls.all()) {
                polls.set(p.code, { code: p.code, question: p.question, options: [], votes: [], visitors: new Map() });
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

        createPoll(code, question) {
            stmt.insertPoll.run(code, question);
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

        // One-time import of the polls.json file written by the previous
        // file-based storage. Only runs into an empty database.
        importLegacyJson(file) {
            if (!fs.existsSync(file) || stmt.pollCount.get().n > 0) return 0;
            const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
            transaction(db, () => {
                for (const p of legacy) {
                    stmt.insertPoll.run(p.code, p.question);
                    p.options.forEach((text, i) => stmt.insertOption.run(p.code, i, text));
                    for (const [id, v] of p.visitors) {
                        stmt.insertVisitor.run(p.code, id);
                        if (v.voted && Number.isInteger(v.choice)) stmt.insertVote.run(p.code, id, v.choice);
                    }
                }
            });
            fs.renameSync(file, file + '.imported');
            return legacy.length;
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
