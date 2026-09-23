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
  ['Join', 'a', 'Poll'].forEach((word) => {
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
  const WAVE_PERIOD = 1800; // ms, one full bob cycle
  const WAVE_Y = 10;        // px, peak bob height
  const LETTER_STAGGER = 80; // ms between each letter's phase, makes the wave travel
  // Every few seconds a flip sweeps across the letters, one after another;
  // the rest of the time they stay upright and readable.
  const FLIP_EVERY = 6000;   // ms between flip waves
  const FLIP_DURATION = 700; // ms for one letter's full turn
  const FLIP_STAGGER = 60;   // ms between letters
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
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

  // Static pose (also the reduced-motion look): upright letters, gradient
  // spread evenly across the phrase.
  function rest() {
    letters.forEach((el) => {
      el.style.transform = '';
      el.style.backgroundPositionX = -el.offsetLeft + 'px';
    });
  }

  function waveFrame(now) {
    letters.forEach((el, i) => {
      const delay = i * LETTER_STAGGER;
      const t = (((now - delay) % WAVE_PERIOD) + WAVE_PERIOD) % WAVE_PERIOD / WAVE_PERIOD;
      const wave = Math.sin(t * Math.PI); // 0 at t=0, 1 at t=0.5, 0 at t=1
      const y = -WAVE_Y * wave;
      const flip = ((now % FLIP_EVERY) - i * FLIP_STAGGER) / FLIP_DURATION;
      const rotY = flip > 0 && flip < 1 ? 360 * easeInOut(flip) : 0;

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
  }

  const SWEEP_PERIOD = 2600; // ms for one full left-to-right (or back) sweep
  function sweepFrame(now) {
    const elapsed = now % (SWEEP_PERIOD * 2);
    const t = elapsed < SWEEP_PERIOD ? elapsed / SWEEP_PERIOD : (SWEEP_PERIOD * 2 - elapsed) / SWEEP_PERIOD; // 0→1→0 ping-pong
    const shift = t * width; // sweeps the gradient from the first letter to the last, then back
    letters.forEach((el) => {
      el.style.backgroundPositionX = (-Number(el.dataset.left) + shift - width) + 'px';
    });
  }

  // The animation only runs while someone can see it: not once a poll is open
  // (the visitor is reading or voting) and not while the title is scrolled
  // out of view. Hidden tabs are already paused by the browser.
  const pollEl = document.getElementById('poll');
  let titleVisible = true;
  let running = false;

  function frame(now) {
    if (!running) return;
    waveFrame(now);
    sweepFrame(now);
    requestAnimationFrame(frame);
  }

  function updateAnimation() {
    const shouldRun = !reduceMotion && titleVisible && !pollEl.hasAttribute('data-active');
    if (shouldRun && !running) {
      running = true;
      requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      rest();
    }
  }

  if (!reduceMotion) {
    addEventListener('pointermove', updatePointer);
    addEventListener('pointerdown', updatePointer);
    addEventListener('pointerleave', resetPointer);
    new IntersectionObserver(([entry]) => {
      titleVisible = entry.isIntersecting;
      updateAnimation();
    }).observe(titleEl);
    new MutationObserver(updateAnimation).observe(pollEl, { attributes: true, attributeFilter: ['data-active'] });
  }
  rest();
  updateAnimation();
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
          data.error = 'Could not load the security check, retrying…';
        }
      }
      token = undefined; // a Turnstile token can only be used once
      setIdentityMessage(data.error || 'Could not reach the server, retrying…');
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
      error.textContent = 'Allow cookies for this site to vote.';
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
  // 'scheduled' (not started yet), 'open' or 'closed', as last reported.
  let phase = 'open';
  let lastVotes = [];
  const liveEl = document.getElementById('poll-live');
  const srStatus = document.getElementById('sr-status');

  // Tells screen-reader users about events they can't see happen. The
  // countdown itself is not announced (it changes four times a second).
  function announce(text) {
    srStatus.textContent = '';
    setTimeout(() => { srStatus.textContent = text; }, 50);
  }

  function totalVotes(votes) {
    return Object.values(votes || {}).reduce((a, b) => a + b, 0);
  }

  // Results are shown once this browser has voted, or to everyone once
  // voting has closed.
  function revealed() {
    return voted || phase === 'closed';
  }

  // Status next to the question: not started yet (with when, and a countdown
  // to it), live (with the countdown to the end, if one is set) or closed.
  // Closing when the countdown hits zero locally locks the options straight
  // away instead of waiting for the server's message.
  const votingTimer = VotingTimer.create(({ phase: now, remainingMs, startsInMs, text, opensAt, closesAt }) => {
    poll.dataset.phase = now;
    liveEl.classList.toggle('closed', now !== 'open');
    liveEl.classList.toggle('urgent', now === 'open' && remainingMs !== null && remainingMs <= 10000);
    if (now === 'closed') liveEl.textContent = 'Voting closed';
    else if (now === 'scheduled') {
      liveEl.textContent = startsInMs > 0 ? `Starts ${VotingTimer.formatDate(opensAt)} · ${text}` : 'Voting is starting…';
    } else if (!text) liveEl.textContent = 'Live';
    else liveEl.textContent = remainingMs > 3600000 ? `Live · ends ${VotingTimer.formatDate(closesAt)}` : `Live · ${text}`;
    if (phase === 'open' && now === 'closed') {
      phase = 'closed';
      renderOptions(lastVotes);
      announce('Voting has closed. Showing the results.');
    }
  });

  // Option buttons are built once per set of options; live updates then only
  // change bar widths and numbers, so bars glide from their old value to the
  // new one instead of being rebuilt (and restarting from 0%) on every vote.
  let builtLabels = null;
  let resultsShown = false;

  function buildOptions() {
    builtLabels = options.slice();
    resultsShown = false;
    // Built with DOM APIs, never HTML strings: option labels are written by
    // whoever created the poll and must not be able to inject markup.
    optsEl.replaceChildren(...options.map((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'poll-opt';
      btn.dataset.i = i;
      const fill = document.createElement('span');
      fill.className = 'fill';
      const row = document.createElement('span');
      row.className = 'row2';
      const text = document.createElement('span');
      text.textContent = label;
      const pctEl = document.createElement('span');
      pctEl.className = 'pct';
      Motion.setNumber(pctEl, 0, (v) => v + '%');
      row.append(text, pctEl);
      btn.append(fill, row);
      btn.addEventListener('click', () => castVote(i));
      return btn;
    }));
  }

  function renderOptions(votes) {
    lastVotes = votes;
    if (!builtLabels || builtLabels.length !== options.length || builtLabels.some((l, i) => l !== options[i])) {
      buildOptions();
    }
    const t = totalVotes(votes);
    const show = revealed();
    // The first time results appear, bars grow from 0 one after another;
    // after that they move straight to each new value.
    const firstReveal = show && !resultsShown;
    resultsShown = show;
    poll.toggleAttribute('data-voted', show);

    const buttons = optsEl.querySelectorAll('.poll-opt');
    buttons.forEach((btn, i) => {
      const count = votes[i] || 0;
      const pct = t ? Math.round((count / t) * 100) : 0;
      btn.disabled = show || phase !== 'open';
      const fill = btn.querySelector('.fill');
      fill.style.setProperty('--bardelay', firstReveal ? (i * 0.08) + 's' : '0s');
      Motion.tweenNumber(btn.querySelector('.pct'), show ? pct : 0, (v) => v + '%');
      // The bar and percentage are visual; give screen readers the result.
      if (show) btn.setAttribute('aria-label', `${builtLabels[i]}: ${pct}%, ${count.toLocaleString('en-US')} ${count === 1 ? 'vote' : 'votes'}`);
      else btn.removeAttribute('aria-label');
    });
    Motion.tweenNumber(foot, t, (v) => v.toLocaleString('en-US') + (v === 1 ? ' vote' : ' votes'));

    // On the first reveal the bars are still at 0% in this frame; set the
    // widths in the next one so the CSS transition has a start to animate from.
    const setWidths = () => buttons.forEach((btn, i) => {
      btn.querySelector('.fill').style.width = (show && t ? Math.round(((votes[i] || 0) / t) * 100) : 0) + '%';
    });
    if (firstReveal) requestAnimationFrame(setWidths); else setWidths();
  }

  const EMOJIS = ['🎉', '✨', '🔥', '👍', '💜'];
  function burst() {
    if (Motion.reduced) return; // the "vote recorded" announcement still happens
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
    check.setAttribute('aria-hidden', 'true');
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
      el.setAttribute('aria-hidden', 'true');
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
    if (voted || phase !== 'open' || !currentCode) return;
    voted = true;
    optsEl.querySelectorAll('.poll-opt').forEach((b) => { b.disabled = true; });
    socket.emit('castVote', { code: currentCode, index });
    burst();
    announce('Your vote was recorded. Showing the results.');
  }

  // ── Live reactions ────────────────────────────────────────
  // Once results are showing, voters can send emoji reactions. Everyone's
  // reactions float up here and on the presenter screen. The server sends
  // them in batches, as a count per reaction.
  const REACTION_NAMES = { '👍': 'Like', '❤️': 'Love', '😂': 'Funny', '😮': 'Wow', '👏': 'Applause', '🤔': 'Thinking' };
  const reactionRow = document.getElementById('reaction-row');
  let reactions = [];
  // Our own reactions float up as soon as they're tapped. Until the server's
  // next batch (which includes them) arrives, they're counted here so that
  // they aren't shown a second time.
  let unechoed = [];

  function buildReactions(list) {
    if (reactions.length === list.length && reactions.every((r, i) => r === list[i])) return;
    reactions = list.slice();
    unechoed = list.map(() => 0);
    reactionRow.replaceChildren(...list.map((emoji, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.title = REACTION_NAMES[emoji] || emoji;
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', () => react(i, btn));
      return btn;
    }));
  }

  function react(i, btn) {
    if (!currentCode) return;
    const r = btn.getBoundingClientRect();
    Motion.floatEmoji(reactions[i], { x: r.left + r.width / 2, y: r.top, size: 32, rise: 240 });
    unechoed[i]++;
    socket.emit('react', { code: currentCode, reaction: i }, (res) => {
      if (!res?.ok) unechoed[i] = Math.max(0, unechoed[i] - 1);
    });
  }

  socket.on('reactions', (counts) => {
    if (!Array.isArray(counts)) return;
    // Not before voting: other people's reactions could sway the vote.
    const show = revealed();
    const r = reactionRow.getBoundingClientRect();
    counts.forEach((count, i) => {
      const own = Math.min(unechoed[i] || 0, count);
      unechoed[i] -= own;
      if (!show || !reactions[i]) return;
      // A batch can hold many of the same reaction; a handful already reads
      // as "lots", spread out over the batch interval.
      for (let k = 0; k < Math.min(count - own, 6); k++) {
        setTimeout(() => Motion.floatEmoji(reactions[i], {
          x: r.left + Math.random() * r.width, y: r.top, size: 22 + Math.random() * 10, rise: 180 + Math.random() * 80
        }), Math.random() * 300);
      }
    });
  });

  socket.on('init', (data) => {
    // Voting closed by the owner (not by our own countdown reaching zero,
    // which announces itself): tell screen-reader users.
    const next = data.voting.phase || (data.voting.open ? 'open' : 'closed');
    const closedNow = currentCode === data.code && phase !== 'closed' && next === 'closed';
    const openedNow = currentCode === data.code && phase === 'scheduled' && next === 'open';
    currentCode = data.code;
    options = data.options;
    // The server says whether this browser already voted in the current
    // round; if so, drop straight into the revealed, disabled results view.
    voted = data.voted;
    phase = next;
    error.textContent = '';
    questionEl.textContent = data.question;
    renderOptions(data.votes || {});
    buildReactions(data.reactions || []);
    votingTimer.set(data.voting);
    if (!poll.hasAttribute('data-active')) {
      // Cross-fade from the code form to the poll. Keyboard and screen-reader
      // users land on the question, not on a form that has just disappeared.
      Motion.transition(() => {
        poll.setAttribute('data-active', '');
        form.style.display = 'none';
        questionEl.focus();
      });
    }
    if (closedNow) announce('Voting has closed. Showing the results.');
    if (openedNow) announce('Voting has started.');
  });

  socket.on('updateVotes', (votes) => {
    if (revealed()) renderOptions(votes);
  });

  socket.on('pollError', (msg) => {
    // The poll may have been deleted while we were away; fall back to the form.
    currentCode = null;
    builtLabels = null;
    Motion.transition(() => {
      poll.removeAttribute('data-active');
      form.style.display = '';
    });
    error.textContent = msg;
  });

  // Socket.IO reconnects with a fresh socket that has no rooms, so rejoin the
  // poll we were on to keep receiving live updates.
  socket.on('connect', () => {
    conn.hidden = true;
    // Replies to reactions sent before the connection dropped never come.
    unechoed = unechoed.map(() => 0);
    if (currentCode) socket.emit('joinPoll', currentCode);
  });
  socket.on('disconnect', () => { conn.hidden = false; });

  function attemptJoin(code) {
    if (!/^\d{4,5}$/.test(code)) {
      error.textContent = 'Please enter the poll code.';
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

  // A new poll from a JSON file: this app's export, or a plain
  // { "question": "...", "options": [...] }. The server picks out the
  // question and options and rejects anything else.
  const importFile = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    createError.textContent = '';
    let template;
    try {
      if (file.size > 1024 * 1024) throw new Error('too big');
      template = JSON.parse(await file.text());
    } catch (e) {
      createError.textContent = 'Could not read this file; choose a JSON poll file.';
      return;
    }
    socket.emit('createPoll', { template }, (res) => {
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
