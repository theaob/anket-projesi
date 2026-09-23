# 📊 Anket Projesi

A live polling app for meetings, classes and events. It runs on a closed network (intranet) with no internet connection, and can also be served on the internet behind an HTTPS reverse proxy.

[![CI](https://github.com/theaob/anket-projesi/actions/workflows/ci.yml/badge.svg)](https://github.com/theaob/anket-projesi/actions/workflows/ci.yml)
[![Build and Push to DockerHub](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml)

## ✨ Features

* **💎 Modern interface:** Animated, mobile-friendly UI that works with a keyboard and screen readers (WCAG 2 AA colour contrast).
* **📡 Live results:** Instant chart updates over Socket.IO.
* **⏱ Open/close voting and timers:** Open and close voting by hand, start it with a countdown, or schedule a start and end date and time in advance. Voting opens and closes on its own, and the results are then shown to everyone.
* **🖥 Presenter view:** Full-screen live results for a projector, with a QR code and the poll code to join.
* **😀 Live reactions:** After voting, participants can send emoji reactions that float up on everyone's results and on the presenter view.
* **👥 Everyone creates their own polls:** No accounts. Whoever creates a poll gets a secret manage link; only people with that link can edit, reset or delete the poll.
* **📊 Exports:** Excel (summary, charts, vote times, timeline), a printable PDF report, CSV and JSON.
* **📥 JSON import and duplicating:** Create a poll from an exported JSON file (or `{ "question": "...", "options": [...] }`), or duplicate an existing poll.
* **🔒 Works offline:** No internet connection needed on a closed network (no external services are used, apart from the optional Cloudflare Turnstile).
* **🌐 Ready for the internet:** Signed participant cookies, per-network rate limits and optional bot checks protect against vote stuffing.
* **🚀 GitHub automation:** Versioning and automatic GitHub releases.
* **🐳 Docker ready:** A consistent setup anywhere with a single command.

## 🚀 Quick start

### Local setup (development)
1. Install dependencies: `npm install`
2. Start the server: `node server.js` (Node.js 22.13+)
3. Open `http://localhost:3000` in a browser (change the port with the `PORT` environment variable)
4. Run the tests and linter: `npm test`, `npm run lint` (they also run in GitHub Actions on every push and pull request)

### Releasing
1. In `CHANGELOG.md`, rename the `## [Unreleased]` heading to the new version (e.g. `## [2.1.1] - 2026-09-23`), commit and push to `main`.
2. Run `npm run release:patch` (or `release:minor` / `release:major`). The script first checks that you are on `main`, that the working tree is clean and in sync with GitHub, and that the CHANGELOG has a section for the new version; then it bumps the version, tags it and pushes. GitHub Actions publishes the Docker image and the release notes. To only run the checks: `npm run release:patch -- --dry-run`.

Merging a pull request that changes the version in `package.json` into `main` also tags and publishes that version automatically.

## 🗳 Usage
1. On the home page, press **"Create a new poll"**. You are taken to the poll's manage page (`/manage#<secret>`).
2. Enter the question and options, then press **Publish**.
3. Share the poll code or the join link (`/?code=1234`) with participants. Codes have 4 digits; once 4-digit codes are nearly used up, new polls get 5-digit codes.
4. Follow the results live on the manage page; reset the votes, export the results as Excel/PDF/CSV/JSON, duplicate the poll or delete it. "Import from a JSON file" on the home page creates a new poll from a saved one.
5. In the **Voting** section you can close and reopen voting, or start it with a timer (30 sec, 1, 2 or 5 min; "+30 sec" extends a running timer). When the time is up voting closes automatically, no more votes are accepted and the results are shown to all participants. "Schedule by date and time" sets a start and/or end time (up to a year ahead): before the start, participants see the poll and a countdown but can't vote yet; with no end, voting stays open until you close it. "Start now" opens voting without waiting, and closing by hand removes the schedule. New polls start open; timers and schedules carry on after a server restart.
6. For the screen in the room, use **"Open presenter view"** on the manage page (`/present?code=1234`).

### 🖥 Presenter view
Shows the question, live result bars, the number of connected participants, and a QR code and the poll code for joining. It is read-only and does not count as a visit; it contains no manage secret, so it is safe to project.

* **F**: full screen. **H**: hide/show results (so participants aren't swayed until voting ends). Hidden results are shown automatically when voting closes.
* While a timer runs, a large countdown is shown; it turns red in the last 10 seconds. Before a scheduled start, the start time and a countdown to it are shown.
* The buttons and cursor hide when the mouse is idle.
* With more options the text gets smaller, and if needed the options split into two columns.
* The QR code is generated on the server, so no internet connection is needed.

The address in the QR code comes from the address the presenter view was opened at; if it was opened via `localhost`, the server's network IP address is used so phones can reach it. If the server is reached through a domain name or a reverse proxy, set the address with the `PUBLIC_URL` environment variable, e.g. `PUBLIC_URL=http://polls.example.local`.

**Keep the manage link safe:** it is the only way to manage the poll and can't be recovered if lost. Anyone with the link can manage the poll, so share it only with people you manage it with. Polls you created in the same browser are listed on the home page under "Polls you created in this browser". The server stores only a hash (SHA-256) of the secret.

To limit abuse, at most 20 polls per hour can be created from the same address.

### Docker
```bash
docker build -t poll-app .
docker run -d -p 80:3000 -v anket-data:/app/data --restart unless-stopped --name poll-system poll-app
```

Inside the container the server runs as the unprivileged `node` user (ownership of the data directory is fixed on start-up). The image has a `HEALTHCHECK` that polls `/healthz`; `docker ps` shows the container's health.

### Data persistence
Polls, options, visitors and votes are stored in a SQLite database (`data/anket.db`) and restored when the server restarts. Change the location with the `DATA_DIR` environment variable. Node.js's built-in `node:sqlite` module is used, so there is no separate database server or native package to compile; **Node.js 22.13 or later** is required.

In Docker, mount a volume at `/app/data` as above so the data isn't lost. To take a backup, even while the server is running: `sqlite3 data/anket.db ".backup backup.db"`.

When upgrading from the old version with a shared admin panel, existing polls without an owner and their results are deleted from the database.

## 🌐 Serving on the internet

### HTTPS and a reverse proxy
Don't expose the app to the internet directly; put a reverse proxy that provides HTTPS in front of it (nginx, Caddy, Cloudflare, etc.) and set these environment variables:

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (default `3000`). |
| `TRUST_PROXY` | Number of proxies in front of the app (usually `1`). If unset, every visitor appears to come from the proxy's address and they all share the rate limits; the server logs a warning in that case. **Don't set it** without a proxy, or clients could bypass the limits with a fake `X-Forwarded-For` header. |
| `PUBLIC_URL` | Public address for join links and the QR code, e.g. `https://polls.example.com`. |
| `VOTER_ID_BURST` | How many new participant identities one network can get in a row (default `30`). |
| `VOTER_ID_PER_HOUR` | How fast that allowance refills, in identities per hour (default `360`, i.e. 6 per minute). |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile bot check (see below). |

nginx example (WebSocket headers are required for Socket.IO):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### One person, one vote
Each browser gets a participant cookie signed by the server that JavaScript can't read (HttpOnly). Votes are accepted only with a valid cookie, and each cookie can vote once per poll. The main safeguard is that **new** cookies are handed out at a limited rate per network (IP address; /64 block for IPv6): someone who deletes their cookie and comes back, or a script, gets at most 30 identities from one network with the default settings, then 6 per minute. A visitor who hits the limit sees a notice and joins automatically once the wait is over.

**Crowded events sharing one Wi-Fi:** If everyone in the room goes out through a single public IP address, this limit can make real participants wait. In that case, turn on Turnstile and raise `VOTER_ID_BURST` to match the number of participants (e.g. `300`).

### Cloudflare Turnstile (recommended)
Turnstile is a free, mostly invisible bot check. When it's on, a new participant identity is only issued to browsers that pass the check, which largely stops scripted vote stuffing. Create a site for your domain in the Cloudflare dashboard (Turnstile → Add site) and set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. When it's on, the pages load Cloudflare's script; the Content Security Policy is widened for it automatically.

These measures can't completely stop a determined attacker (for example, many devices on different networks); true "one vote per person" needs user sign-in.
