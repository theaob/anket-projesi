# Project Audit — anket-projesi (v1.4.2)

**Date:** 2026-09-22
**Scope:** `server.js`, `public/index.html`, `public/admin.html`, `public/style.css`, `Dockerfile`, `.github/workflows/*`, `package.json`, `README.md`, `CHANGELOG.md`

> **Status update (after v2.0.0):** all critical and high findings are resolved (C2 no longer applies, since the shared admin panel was replaced by per-poll manage links). All medium findings are fixed. All low findings are fixed as well. The server now has an integration test suite that runs in CI on every push and pull request, together with a Docker smoke test. See the ✅ notes below.

Findings marked **(verified)** were reproduced against a running server or checked on GitHub. The others come from reading the code.

---

## Summary

| Severity | Count | Headline |
|---|---|---|
| 🔴 Critical | 4 | One bad socket message crashes the server; no admin auth; stored XSS; code space can run out and hang the server |
| 🟠 High | 5 | Unlimited votes; data is lost on restart; Save silently wipes votes; no rejoin after reconnect; empty GitHub release notes |
| 🟡 Medium | 8 | CSV formula injection, lockouts from the stale `voted_` flag, inflated metrics, Docker hardening, and more |
| 🔵 Low | 9 | Outdated README, config hard-coded in the source, tooling gaps, and minor clean-ups |

For an app meant to run on a closed intranet, the top priority is the first two critical items. Anyone on the network can currently take the server down, or delete and rewrite every poll.

---

## 🔴 Critical

### C1. A malformed `updatePoll` event crashes the whole process (verified) — ✅ fixed
`server.js:82` runs `options.map(...)` without checking the input. Emitting `updatePoll` with no `options` array throws `TypeError: Cannot read properties of undefined (reading 'map')`. The exception is uncaught, so Node exits. Because all state is in memory (see H2), **every poll and vote is lost**.

*Reproduced:* `socket.emit('updatePoll', { code, question: 'x' })` → server log shows the TypeError, and `curl localhost:3000` then gets connection refused.

> ✅ **Fixed:** payloads are validated, and every socket handler runs inside a wrapper that logs errors and sends an error reply instead of letting them escape. Database writes happen before in-memory changes, so a failed write leaves no partial state. Messages are capped at 64 KB. As a last resort, an uncaught exception closes the database and exits for Docker to restart. Tested with 270 malformed messages and a simulated disk failure; the server stayed up.

**Fix:**
- Validate every socket payload: types, array lengths, string lengths, and that `index` is an integer in range.
- Wrap handlers in a `safe(fn)` helper that catches errors and logs them.
- Add a `process.on('uncaughtException')` logger as a last resort, and run the container with `--restart unless-stopped`.

### C2. The admin interface has no authentication — ✅ no longer applies
`admin.html` is served publicly, and the server trusts every socket for `joinAdmin`, `createPoll`, `updatePoll`, `deletePoll` and `resetVotes` (`server.js:65-102`). Any voter can open the browser console and delete or rewrite every poll. `joinAdmin` also sends every poll's full data to whoever asks.

**Fix:**
- Require an `ADMIN_TOKEN` (env var) or a password login.
- Check it in a Socket.IO namespace middleware, for example `io.of('/admin').use(...)`, and move the admin events into that namespace.
- Protect `/admin.html` and `/export` with the same check.

> ✅ The shared admin panel and `/export` were removed. Anyone can create a poll and receives a secret manage link (`/manage#<secret>`); only the SHA-256 hash of the secret is stored. The server rejects every owner action (edit, reset, export, delete) from a socket that hasn't unlocked that poll with its secret.

### C3. Stored XSS in the voter page and the admin panel — ✅ fixed
Poll text written by one user is inserted into other users' pages as raw HTML:
- `public/index.html:279`: option labels are concatenated into `innerHTML`, so script runs on **every voter's device**.
- `public/admin.html:281`: `${p.question}` goes into `innerHTML` in the poll list.
- `public/admin.html:319`: `value="${text}"` lets an option break out of the attribute.

Combined with C2, anyone can inject script into the admin's browser.

> ✅ **Fixed:** the voter page builds option buttons with `textContent`, and `manage.html` never inserts user text as HTML. The inline scripts moved to `public/js/`, and the server sends a `Content-Security-Policy` with `script-src 'self'`, so injected inline script is refused by the browser (verified). Styles still allow `'unsafe-inline'`.

**Fix:**
- Build these elements with `textContent` and `createElement` instead of HTML strings, or escape the text.
- Add a Content-Security-Policy header that blocks inline script. This requires moving the inline `<script>` blocks into files, which also removes the `onclick=` attributes in `admin.html`.

### C4. `generateCode()` loops forever once all 9000 codes are used — ✅ fixed
`server.js:18-24` retries random 4-digit codes until it finds a free one. With 9000 polls there is no free code, and the loop blocks the event loop permanently. `createPoll` has no auth or rate limit, so a script can reach that state in seconds. Each poll also costs memory with no limit.

> ✅ **Fixed:** `generateCode()` never loops forever. When the 4-digit codes are nearly used up it falls back to 5-digit codes (99,000 codes in total), and it returns an error only if both are full. Creation is limited to 20 polls per hour per address. Old polls are still never removed automatically; that was left out on purpose, because polls and results are meant to be kept.

**Fix:** cap the number of polls or the creation rate, and fail with an error after N attempts. Longer codes (5–6 digits) and removing old polls automatically would also help.

---

## 🟠 High

### H1. Vote limits are enforced only in the browser — ✅ fixed
The one-vote rule lives in `localStorage` in the browser. The server accepts `castVote` from any socket, any number of times, even without a prior `joinPoll` (`server.js:119-126`). A loop in the console, a private window or a different browser can stuff the ballot.

> ✅ The server records who has voted per poll and round, rejects second votes and votes from sockets that haven't joined, and checks the option index. **Update (online hardening):** voter IDs are no longer chosen by the browser. The server issues a signed HttpOnly cookie, and only at a limited rate per client network (IPv4 address or IPv6 /64). An optional Cloudflare Turnstile check can be required first, and `TRUST_PROXY` gives correct client addresses behind a reverse proxy. Measured before the change: one script cast 838 votes in 1.8 s. After: 0 votes without a cookie, and 30 identities then 6 per minute from one network. **Remaining limit:** an attacker with many networks or devices can still vote several times; only user accounts would stop that.

**Fix:**
- Track voters on the server per poll, by socket or by a signed cookie / device ID, and reject a second vote.
- Require the socket to have joined that poll.
- Add a rate limit per connection and per IP.

### H2. All data is in memory only — ✅ fixed
A restart, crash (C1), redeploy or container update erases every poll.

**Fix:** save state to a JSON file on a Docker volume (write on change, with a debounce), or use SQLite (`better-sqlite3`). Document the volume in the README.

### H3. "Save" silently wipes the votes and metrics — ✅ fixed
`updatePoll` always resets `votes`, `visits` and `abandoned` (`server.js:82-84`), even when the admin only fixes a typo in the question. There is no warning in the UI.

**Fix:** reset only when the options really changed, and ask for confirmation first. Or keep each option's votes by a stable option ID.

### H4. Clients don't recover from a disconnect — ✅ fixed
Socket.IO reconnects with a new socket that has no rooms. `index.html` only joins through the form, and `admin.html:237` emits `joinAdmin` once. After a Wi-Fi drop or a server restart, voters and the admin see frozen data with no indication.

**Fix:**
- Do the join or `joinAdmin` inside `socket.on('connect', ...)`.
- Show a "connection lost / reconnecting" badge while disconnected.

### H5. GitHub release notes are always empty (verified) — ✅ fixed
`docker-publish.yml:286` sets `VERSION=v1.4.2`, but the CHANGELOG headings are `## [1.4.2]` without the `v`. The `sed` range never matches, so `release_notes.md` is empty. The v1.4.0, v1.4.1 and v1.4.2 releases on GitHub all have empty bodies.

**Fix:** match on the version without the prefix (`sed -n "/## \[${VERSION#v}\]/,/## \[/p"`). Also escape the dots in the version, and handle the last section, where no next heading follows.

---

## 🟡 Medium

| # | Finding | Location | Suggested fix |
|---|---|---|---|
| M1 | ✅ fixed — **CSV formula injection.** An option starting with `=`, `+`, `-` or `@` runs as a formula when the file is opened in Excel. | `server.js:52` | Prefix such cells with `'`. |
| M2 | ✅ fixed — **Voters get locked out after a reset or a new question.** The `voted_<code>` flag in `localStorage` is never cleared, so after `resetVotes` or `updatePoll` earlier voters can't vote on the new question. | `index.html:346,358,384` | Give each poll a `version` or `round` ID that changes on reset or edit, and key the flag on `code+round`. |
| M3 | ✅ fixed (unique visitors per browser; a visitor counts as "left without voting" only after 10 s away) — **Metrics are easy to inflate or skew.** Repeated `joinPoll` calls on one socket count as many visits. A page refresh counts as one abandonment plus one new visit. If a socket joins two polls, only the last one is tracked. | `server.js:105-146` | Count each socket or device once per poll, and ignore a quick reconnect from the same device. |
| M4 | ✅ fixed — **Unvalidated vote index.** `index: "constructor"` passes the `!== undefined` check, so a `"constructor": NaN` key is written into `votes`. | `server.js:121` (verified) | Use `Number.isInteger(index) && index >= 0 && index < poll.options.length`, and store votes as an array. |
| M5 | ✅ fixed (shared admin panel removed; updates go only to that poll's viewers and are batched to at most one per 250 ms per poll) — **Every vote sends all polls to all admins.** On each vote the server sends the full list of polls to every admin. With a big audience this floods the network. | `server.js:125` | Throttle to about 4 updates per second, or send only the changed poll. |
| M6 | ✅ fixed — **Deleting a poll doesn't notify voters.** Voters stay on a poll that no longer exists. | `server.js:89` | Emit `pollClosed` to the `poll:<code>` room. |
| M7 | ✅ fixed (Node 22, `npm ci` with a committed lockfile, `.dockerignore`, runs as `node`, `HEALTHCHECK`) — **Docker image hygiene.** `node:18` is end-of-life (April 2025). `npm install --production` is deprecated. There is no lockfile, so builds aren't reproducible. There is no `.dockerignore`, so `COPY . .` also copies `.git`. The container runs as root and has no `HEALTHCHECK`. | `Dockerfile` | Use `node:22-alpine`, commit `package-lock.json` and run `npm ci --omit=dev`, add `.dockerignore`, add `USER node`, and add a `HEALTHCHECK`. |
| M8 | ✅ fixed (all actions on Node 24 versions, read-only permissions except the release job, CI on push/PR) — **Workflow issues.** `auto-tag.yml` uses `actions/checkout@v3`, which runs on a deprecated Node version. The build job gets `contents: write` when it only needs read access. No workflow runs checks on PRs. | `.github/workflows/*` | Upgrade to `@v4`, give each job the least permissions it needs, and add a CI workflow (see L4). |

---

## 🔵 Low

- ✅ fixed — **L1. The README is out of date.** It advertises "Weighted Scoring" (removed in 1.2.0) and a results screen that no longer exists. It doesn't mention poll codes, the `?code=` link or metrics. The "Mentimeter Clone" wording may raise trademark concerns.
- ✅ fixed — **L2. Port and bind address are hard-coded.** `PORT = 3000` (`server.js:41`) should read `process.env.PORT`. `getLocalIp()` returns the first non-internal interface, which in Docker is the container IP, so the printed URL is misleading.
- ✅ fixed — **L3. No `.gitignore`.** `node_modules/` can be committed by accident.
- ✅ fixed (tests, ESLint and CI; no formatter) — **L4. No tests, linting or formatting.** Add ESLint and Prettier, plus a few `node:test` + `socket.io-client` integration tests for create, vote, reset and export, and for the validation cases above. Run them in CI on PRs.
- ✅ fixed (`private`, name `anket-projesi`, `engines`; `release:*` runs `scripts/release.js`, which checks branch, clean tree, sync with GitHub and the CHANGELOG section) — **L5. `package.json` gaps.** Add `"private": true` and `"engines": { "node": ">=20" }`, and make the `name` match the repo. The `release:*` scripts push `HEAD` from whatever branch is checked out; add a guard that only allows `main`.
- ✅ fixed (browsers already pause animation frames in hidden tabs; the real cost was running nonstop while visible, so it now stops when a poll is open or the title is scrolled away) — **L6. The title animation never stops.** Two `requestAnimationFrame` loops in `index.html` run forever, even when the tab is in the background or the card is showing results. This drains battery on phones. Pause them on `visibilitychange` or once a poll is shown.
- ✅ fixed (scripts moved to `public/js/`) — **L7. Code structure.** All voter JS and CSS is inline in `index.html` (406 lines), while `style.css` is used only by the admin page. Moving them into files helps with CSP (C3), caching and maintenance.
- ✅ fixed — **L8. `localStorage` access isn't guarded.** It can throw (for example in some private-browsing modes or when storage is blocked), which would break voting. Wrap it in `try/catch`.
- ✅ fixed (axe-core reports no WCAG 2 A/AA violations on any page state; focus rings, labels, landmarks, contrast, screen-reader labels and announcements) — **L9. Accessibility.** Add a visible focus style to the option buttons, announce the result percentages to screen readers (`aria-label` on each bar), and check colour contrast on the gradient title.

---

## Suggested fix order

1. **C1, M4:** input validation and a safe wrapper for all handlers. Small change, stops the crashes.
2. **C3:** remove unsafe `innerHTML` use.
3. **C2:** admin token.
4. **C4, H1:** rate limits and a server-side vote check.
5. **H4, H3, M2:** reconnect handling and safe editing.
6. **H2:** persistence.
7. **H5, M7, M8, L4:** release, Docker and CI fixes.
8. The remaining medium and low items.

---

## Suggested features

### Poll types and content
- **More question types:** multiple choice (pick N), word cloud / open text, rating scale (1–5 or NPS), ranking, and Q&A with upvotes.
- **Multi-question sessions:** a presentation made of several slides that the presenter steps through, with voters following along automatically.
- **Images and emoji in options.**
- **Poll templates:** duplicate an existing poll, or import and export polls as JSON.

### Presenter experience
- ✅ **Presenter / projector view:** a full-screen, large-type live results page for the room screen. *Done: `/present?code=…`, with bars only; pie charts and word clouds are not built yet.*
- ✅ **QR code and join link:** show `http://<host>/?code=1234` as a QR code in the presenter view, rendered on the server so it also works offline. *Done.*
- ✅ **Open / close voting:** a start/stop toggle, an optional countdown timer, and "hide results until closed" to avoid bandwagon voting. *Done: manual open/close, timer presets, and results on the presenter screen can be hidden until voting closes. Voters who have voted still see results straight away.*
- **Live participant count:** how many people are connected, plus a votes-per-minute sparkline.
- **Keyboard shortcuts** for presenting: next question, show or hide results, and so on.

### Admin and data
- **Admin login** with roles, and polls owned by their creator.
- **Persistent history:** archived polls, results over time, and comparisons between sessions.
- **Richer export:** XLSX and PDF summaries with charts, timestamps per vote, and the funnel metrics in one sheet.
- **Poll expiry and cleanup:** delete polls automatically after N days.
- **Audit log:** who created, edited, reset or deleted what, and when.

### Voter experience
- **Change vote** before the poll closes, if the admin allows it.
- **Anonymous nickname or reactions:** live emoji reactions that float on the presenter screen.
- **PWA / offline shell:** an installable app with a clear screen when the connection is lost.
- **Language toggle:** Turkish and English; strings are currently hard-coded in Turkish.
- **Dark mode**, following `prefers-color-scheme`.

### Operations
- **`/healthz` endpoint and Prometheus `/metrics`.**
- **Configuration through environment variables:** port, admin token, data directory, poll limits.
- **docker-compose.yml** with a data volume and restart policy, for one-command intranet deployment.
- **Scaling across instances** with the Socket.IO Redis adapter, for events with many concurrent voters.
