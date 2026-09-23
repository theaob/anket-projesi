(() => {
  const input = document.getElementById('join-code');
  const boxes = Array.from(document.querySelectorAll('.digit-box'));
  function sync() {
    const digits = input.value.replace(/\D/g, '');
    boxes.forEach((box, i) => {
      // Codes are 4 digits; the 5th box only appears for the longer codes the
      // server hands out once the 4-digit space is nearly full.
      if (i >= 4) box.hidden = digits.length <= 4;
      const had = box.classList.contains('filled');
      const has = i < digits.length;
      box.textContent = digits[i] || '';
      box.classList.toggle('filled', has);
      box.classList.toggle('active', i === digits.length);
      if (has && !had) {
        box.classList.remove('pop');
        void box.offsetWidth;
        box.classList.add('pop');
      }
    });
  }
  input.addEventListener('input', sync);
  input.addEventListener('focus', sync);
  input.addEventListener('blur', sync);
  document.querySelector('.digit-row').addEventListener('click', () => input.focus());
  sync();
})();
(() => {
  const titleEl = document.getElementById('title');
  const letters = [];
  let li = 0;
  ['Ankete', 'Katıl'].forEach((word) => {
    const wordEl = document.createElement('span');
    wordEl.className = 'word';
    word.split('').forEach((ch) => {
      const span = document.createElement('span');
      span.className = 'letter'; span.textContent = ch;
      span.dataset.delayIndex = li++;
      letters.push(span);
      wordEl.appendChild(span);
    });
    titleEl.appendChild(wordEl);
  });
  // Drive one continuous gradient across the whole phrase: each letter samples
  // the same background image, offset by its own position, so the color reads
  // as flowing text rather than per-letter cycling.
  function layout() {
    const w = titleEl.clientWidth || 1;
    letters.forEach((el) => {
      el.dataset.left = el.offsetLeft;
      el.style.backgroundSize = w + 'px 100%';
    });
    return w;
  }
  let width = layout();

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Idle wave/flip + pointer-pull boost, combined into a single JS-driven loop.
  // A CSS @keyframes animation and a JS-set inline transform can't share the
  // `transform` property peacefully (the animation wins every frame, silently
  // dropping the pointer-driven part) so both effects are computed together here.
  const WAVE_PERIOD = 1800; // ms, one full bob-and-flip cycle
  const WAVE_Y = 14;        // px, peak bob height
  const LETTER_STAGGER = 80; // ms between each letter's phase, makes the wave travel
  const PULL_RADIUS = 110, PULL_STRENGTH = 30;

  let centers = [];
  function measureCenters() {
    centers = letters.map((el) => {
      const prevTransform = el.style.transform;
      el.style.transform = 'none';
      const r = el.getBoundingClientRect();
      el.style.transform = prevTransform;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  }
  measureCenters();

  addEventListener('resize', () => { width = layout(); measureCenters(); });

  let mouseX = -9999, mouseY = -9999, pointerActive = false;
  function updatePointer(e) { mouseX = e.clientX; mouseY = e.clientY; pointerActive = true; }
  function resetPointer() { pointerActive = false; }

  if (!reduceMotion) {
    addEventListener('pointermove', updatePointer);
    addEventListener('pointerdown', updatePointer);
    addEventListener('pointerleave', resetPointer);

    function tick(now) {
      letters.forEach((el, i) => {
        const delay = i * LETTER_STAGGER;
        const t = (((now - delay) % WAVE_PERIOD) + WAVE_PERIOD) % WAVE_PERIOD / WAVE_PERIOD;
        const wave = Math.sin(t * Math.PI); // 0 at t=0, 1 at t=0.5, 0 at t=1
        const y = -WAVE_Y * wave;
        const rotY = 180 * wave;

        let pullX = 0, pullY = 0, scale = 1;
        if (pointerActive) {
          const c = centers[i];
          const dx = mouseX - c.x, dy = mouseY - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist < PULL_RADIUS && dist > 0.1) {
            const pull = (1 - dist / PULL_RADIUS) * PULL_STRENGTH;
            pullX = dx / dist * pull;
            pullY = dy / dist * pull;
            scale = 1 + pull / 90;
          }
        }

        el.style.transform = `translate(${pullX.toFixed(2)}px, ${(y + pullY).toFixed(2)}px) rotateY(${rotY.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (reduceMotion) {
    letters.forEach((el) => { el.style.backgroundPositionX = -el.offsetLeft + 'px'; });
  } else {
    const period = 2600; // ms for one full left-to-right (or back) sweep
    let start = null;
    function sweepTick(ts) {
      if (start === null) start = ts;
      const elapsed = (ts - start) % (period * 2);
      const t = elapsed < period ? elapsed / period : (period * 2 - elapsed) / period; // 0→1→0 ping-pong
      const shift = t * width; // sweeps the gradient from the first letter to the last, then back
      letters.forEach((el) => {
        el.style.backgroundPositionX = (-Number(el.dataset.left) + shift - width) + 'px';
      });
      requestAnimationFrame(sweepTick);
    }
    requestAnimationFrame(sweepTick);
  }
})();
(() => {
  const form = document.getElementById('join-form');
  const input = document.getElementById('join-code');
  const error = document.getElementById('join-error');
  const poll = document.getElementById('poll');
  const questionEl = document.getElementById('poll-q');
  const optsEl = document.getElementById('poll-options');
  const foot = document.getElementById('poll-foot');
  const conn = document.getElementById('conn');

  const socket = io();
  let currentCode = null;

  // ── Voter identity ────────────────────────────────────────
  // The server issues each browser a signed voter cookie (/api/voter), which
  // is what limits everyone to one vote. It may first ask for a Cloudflare
  // Turnstile check, or ask us to wait if this network created many voters
  // recently; both are handled here, retrying until an identity is issued.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const turnstileBox = document.getElementById('turnstile');
  let turnstileScript = null;
  // Shown while waiting for an identity; kept when other code clears errors.
  let identityMessage = '';
  function setIdentityMessage(text) {
    identityMessage = text;
    error.textContent = text;
  }

  function loadTurnstile() {
    if (!turnstileScript) {
      turnstileScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => resolve(window.turnstile);
        script.onerror = () => { turnstileScript = null; reject(new Error('turnstile')); };
        document.head.appendChild(script);
      });
    }
    return turnstileScript;
  }

  // Runs the check; usually invisible, it only shows a box when Cloudflare
  // wants the visitor to click.
  async function turnstileToken(siteKey) {
    const turnstile = await loadTurnstile();
    turnstileBox.replaceChildren();
    turnstileBox.hidden = false;
    try {
      return await new Promise((resolve, reject) => {
        turnstile.render(turnstileBox, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: resolve,
          'error-callback': () => reject(new Error('turnstile'))
        });
      });
    } finally {
      turnstileBox.hidden = true;
    }
  }

  async function obtainIdentity() {
    let token;
    for (let attempt = 1; ; attempt++) {
      let res = null;
      let data = {};
      try {
        res = await fetch('/api/voter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(token ? { turnstileToken: token } : {})
        });
        data = await res.json().catch(() => ({}));
      } catch (e) { /* offline or server down: retry below */ }
      if (res && res.ok) {
        if (identityMessage) setIdentityMessage('');
        return;
      }
      if (res && res.status === 401 && data.challenge === 'turnstile') {
        try {
          token = await turnstileToken(data.siteKey);
          continue;
        } catch (e) {
          data.error = 'Güvenlik doğrulaması yüklenemedi, tekrar deneniyor…';
        }
      }
      token = undefined; // a Turnstile token can only be used once
      setIdentityMessage(data.error || 'Sunucuya ulaşılamadı, tekrar deneniyor…');
      await sleep(res && res.status === 429 ? (data.retryAfterSec || 10) * 1000 : Math.min(30000, 2000 * attempt));
    }
  }

  // The socket connects straight away (creating a poll needs no identity).
  // The server says on each connection whether it saw a voter cookie; if the
  // cookie arrived after the handshake, reconnect once so the server sees it.
  // Joining a poll waits until the server has confirmed a voter connection.
  let haveIdentity = false;
  let voterConnected;
  const voterReady = new Promise((resolve) => { voterConnected = resolve; });
  let socketIsVoter = null;
  let reconnectedForIdentity = false;
  function syncIdentity() {
    if (!haveIdentity || socketIsVoter !== false) return;
    if (reconnectedForIdentity) {
      error.textContent = 'Oy vermek için bu sitede çerezlere izin verin.';
      return;
    }
    reconnectedForIdentity = true;
    socket.disconnect();
    socket.connect();
  }
  socket.on('session', ({ voter }) => {
    socketIsVoter = voter;
    if (voter) voterConnected();
    syncIdentity();
  });
  obtainIdentity().then(() => {
    haveIdentity = true;
    syncIdentity();
  });
  let options = [];
  let voted = false;
  let votingOpen = true;
  let lastVotes = [];
  const liveEl = document.getElementById('poll-live');

  function totalVotes(votes) {
    return Object.values(votes || {}).reduce((a, b) => a + b, 0);
  }

  // Results are shown once this browser has voted, or to everyone once
  // voting has closed.
  function revealed() {
    return voted || !votingOpen;
  }

  // Status next to the question: live (with the countdown when a timer is
  // running) or closed. Closing when the countdown hits zero locally locks
  // the options straight away instead of waiting for the server's message.
  const votingTimer = VotingTimer.create(({ open, remainingMs, text }) => {
    liveEl.classList.toggle('closed', !open);
    liveEl.classList.toggle('urgent', open && remainingMs !== null && remainingMs <= 10000);
    liveEl.textContent = !open ? 'Oylama kapandı' : text ? `Canlı · ${text}` : 'Canlı';
    if (votingOpen && !open) {
      votingOpen = false;
      poll.toggleAttribute('data-voted', true);
      renderOptions(lastVotes);
    }
  });

  // Renders the option buttons. Fill bars always start at width:0% here; when
  // results are revealed a follow-up frame bumps them to the real percentage
  // so the CSS width transition actually has something to animate from.
  function renderOptions(votes) {
    lastVotes = votes;
    const t = totalVotes(votes);
    // Built with DOM APIs, never HTML strings: option labels are written by
    // whoever created the poll and must not be able to inject markup.
    optsEl.replaceChildren(...options.map((label, i) => {
      const pct = t ? Math.round(((votes[i] || 0) / t) * 100) : 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'poll-opt';
      btn.dataset.i = i;
      btn.disabled = revealed();
      const fill = document.createElement('span');
      fill.className = 'fill';
      fill.style.width = '0%';
      fill.style.setProperty('--bardelay', (i * 0.12) + 's');
      const row = document.createElement('span');
      row.className = 'row2';
      const text = document.createElement('span');
      text.textContent = label;
      const pctEl = document.createElement('span');
      pctEl.className = 'pct';
      pctEl.textContent = pct + '%';
      row.append(text, pctEl);
      btn.append(fill, row);
      return btn;
    }));
    foot.textContent = t.toLocaleString('tr-TR') + ' oy verildi';

    if (!revealed()) {
      optsEl.querySelectorAll('.poll-opt').forEach((btn) => {
        btn.addEventListener('click', () => castVote(Number(btn.dataset.i), btn));
      });
      return;
    }

    requestAnimationFrame(() => {
      optsEl.querySelectorAll('.poll-opt').forEach((btn, i) => {
        const pct = t ? Math.round(((votes[i] || 0) / t) * 100) : 0;
        const fill = btn.querySelector('.fill');
        if (fill) fill.style.width = pct + '%';
      });
    });
  }

  const EMOJIS = ['🎉', '✨', '🔥', '👍', '💜'];
  function burst() {
    const rect = document.querySelector('.card').getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const check = document.createElement('span');
    check.textContent = '✅';
    check.style.position = 'fixed';
    check.style.left = cx + 'px';
    check.style.top = cy + 'px';
    check.style.fontSize = '30px';
    check.style.pointerEvents = 'none';
    check.style.zIndex = '999';
    check.style.transform = 'translate(-50%, -50%) scale(0)';
    document.body.appendChild(check);
    check.animate([
      { transform: 'translate(-50%, -50%) scale(0)' },
      { transform: 'translate(-50%, -50%) scale(1.3)', offset: 0.45 },
      { transform: 'translate(-50%, -50%) scale(1)', offset: 0.55 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0, offset: 1 },
    ], { duration: 1400, easing: 'ease-in-out' }).onfinish = () => check.remove();
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('span');
      el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      el.style.position = 'fixed';
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      el.style.fontSize = (18 + Math.random() * 14) + 'px';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '999';
      el.style.willChange = 'transform, opacity';
      document.body.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 110;
      const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist - 40;
      const spin = (Math.random() - 0.5) * 480;
      const anim = el.animate([
        { transform: 'translate(-50%, -50%) rotate(0deg) scale(0.6)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin}deg) scale(1)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(.2,.7,.3,1)' });
      anim.onfinish = () => el.remove();
    }
  }

  function castVote(index) {
    if (voted || !votingOpen || !currentCode) return;
    voted = true;
    poll.setAttribute('data-voted', '');
    optsEl.querySelectorAll('.poll-opt').forEach((b) => { b.disabled = true; });
    socket.emit('castVote', { code: currentCode, index });
    burst();
  }

  socket.on('init', (data) => {
    currentCode = data.code;
    options = data.options;
    // The server says whether this browser already voted in the current
    // round; if so, drop straight into the revealed, disabled results view.
    voted = data.voted;
    votingOpen = data.voting.open;
    error.textContent = '';
    questionEl.textContent = data.question;
    poll.toggleAttribute('data-voted', revealed());
    renderOptions(data.votes || {});
    votingTimer.set(data.voting);
    poll.setAttribute('data-active', '');
    form.style.display = 'none';
  });

  socket.on('updateVotes', (votes) => {
    if (revealed()) renderOptions(votes);
  });

  socket.on('pollError', (msg) => {
    // The poll may have been deleted while we were away; fall back to the form.
    currentCode = null;
    poll.removeAttribute('data-active');
    form.style.display = '';
    error.textContent = msg;
  });

  // Socket.IO reconnects with a fresh socket that has no rooms, so rejoin the
  // poll we were on to keep receiving live updates.
  socket.on('connect', () => {
    conn.hidden = true;
    if (currentCode) socket.emit('joinPoll', currentCode);
  });
  socket.on('disconnect', () => { conn.hidden = false; });

  function attemptJoin(code) {
    if (!/^\d{4,5}$/.test(code)) {
      error.textContent = 'Anket kodunu gir lütfen.';
      input.focus();
      return;
    }
    error.textContent = identityMessage;
    voterReady.then(() => socket.emit('joinPoll', code));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attemptJoin(input.value.trim());
  });

  // ── Poll creation ─────────────────────────────────────────
  // There are no accounts: creating a poll returns a secret manage link, and
  // this browser remembers its links so they can be found again here.
  const createBtn = document.getElementById('btn-create');
  const createError = document.getElementById('create-error');

  function loadMyPolls() {
    try { return JSON.parse(localStorage.getItem('myPolls')) || []; } catch (e) { return []; }
  }

  function renderMyPolls() {
    const list = loadMyPolls();
    const ul = document.getElementById('my-polls-list');
    ul.replaceChildren(...list.map((p) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '/manage#' + encodeURIComponent(p.secret);
      const code = document.createElement('span');
      code.className = 'code';
      code.textContent = p.code;
      const q = document.createElement('span');
      q.className = 'q';
      q.textContent = p.question || '—';
      a.append(code, q);
      li.appendChild(a);
      return li;
    }));
    document.getElementById('my-polls').hidden = list.length === 0;
  }
  renderMyPolls();

  createBtn.addEventListener('click', () => {
    createBtn.disabled = true;
    createError.textContent = '';
    socket.emit('createPoll', (res) => {
      createBtn.disabled = false;
      if (res.error) {
        createError.textContent = res.error;
        return;
      }
      location.href = '/manage#' + res.secret;
    });
  });

  const urlParams = new URLSearchParams(location.search);
  const urlCode = urlParams.get('code');
  if (urlCode) {
    input.value = urlCode;
    input.dispatchEvent(new Event('input'));
    setTimeout(() => attemptJoin(urlCode), 500);
  }
})();
