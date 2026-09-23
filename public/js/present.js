(() => {
  const $ = (id) => document.getElementById(id);
  const code = new URLSearchParams(location.search).get('code') || '';
  const optionsEl = $('options');
  let hidden = false;
  let lastTotal = null;
  let current = null;
  const formatInt = (v) => v.toLocaleString('tr-TR');
  const formatPct = (v) => v + '%';
  const formatVotes = (v) => v.toLocaleString('tr-TR') + ' oy';

  function showMessage(text) {
    $('stage').hidden = true;
    $('message').hidden = false;
    $('message').textContent = text;
  }

  // Option rows are rebuilt only when the options change, so that vote
  // updates animate the existing bars instead of redrawing them from zero.
  function buildOptions(options) {
    optionsEl.replaceChildren(...options.map((label) => {
      const opt = document.createElement('div');
      opt.className = 'opt';
      const head = document.createElement('div');
      head.className = 'opt-head';
      const name = document.createElement('span');
      name.className = 'opt-label';
      name.textContent = label;
      const num = document.createElement('span');
      num.className = 'opt-num';
      const pct = document.createElement('span');
      const count = document.createElement('small');
      Motion.setNumber(pct, 0, formatPct);
      Motion.setNumber(count, 0, formatVotes);
      num.append(pct, count);
      head.append(name, num);
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'fill';
      bar.appendChild(fill);
      opt.append(head, bar);
      return opt;
    }));
    if (options.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Seçenekler henüz eklenmedi.';
      optionsEl.appendChild(empty);
    }
  }

  // Shrinks the options (and, as a last resort, splits them into two
  // columns) until they all fit in the space left under the question.
  // Nothing to do in the stacked phone layout, where the page scrolls.
  function fit() {
    const rows = [...optionsEl.children];
    if (!rows.length) return;
    const overflows = () => {
      const tops = rows.map(r => r.getBoundingClientRect());
      const span = Math.max(...tops.map(r => r.bottom)) - Math.min(...tops.map(r => r.top));
      return span > optionsEl.getBoundingClientRect().height + 1;
    };
    // Largest scale at which everything fits in the given layout.
    const largestFit = (twoColumns) => {
      optionsEl.classList.toggle('cols2', twoColumns);
      for (let f = 1; f >= 0.45; f -= 0.05) {
        optionsEl.style.setProperty('--fit', f.toFixed(2));
        if (!overflows()) return f;
      }
      return 0.45;
    };
    const apply = (twoColumns, f) => {
      optionsEl.classList.toggle('cols2', twoColumns);
      optionsEl.style.setProperty('--fit', f.toFixed(2));
    };
    // One column reads best; switch to two only when one column would make
    // the text small and two columns allow it to be larger.
    const one = largestFit(false);
    if (one >= 0.7) return apply(false, one);
    const two = largestFit(true);
    if (two > one) apply(true, two); else apply(false, one);
  }
  addEventListener('resize', fit);

  // Countdown and open/closed state. When voting closes, results hidden with
  // H come back automatically: that is the moment to show them.
  let votingOpen = null;
  const votingTimer = VotingTimer.create(({ open, remainingMs, text }) => {
    const timed = open && remainingMs !== null;
    $('countdown').hidden = !timed;
    $('countdown-text').textContent = text;
    $('countdown').classList.toggle('urgent', timed && remainingMs <= 10000);
    document.body.classList.toggle('voting-closed', !open);
    $('join-title').textContent = open ? 'Katılmak için tarayın' : 'Oylama kapandı';
    $('live').textContent = open ? 'Canlı' : 'Oylama kapandı';
    if (votingOpen === true && !open && hidden) toggleHidden();
    votingOpen = open;
  });

  function render(poll) {
    const optionsChanged = !current || current.options.length !== poll.options.length
      || current.options.some((o, i) => o !== poll.options[i]);
    const questionChanged = !current || current.question !== poll.question;
    current = poll;
    document.title = `${poll.code} · Sunum Ekranı`;
    $('question').textContent = poll.question || 'Soru';
    $('code').textContent = poll.code;
    if (optionsChanged) buildOptions(poll.options);

    const total = poll.votes.reduce((a, b) => a + b, 0);
    const max = Math.max(0, ...poll.votes);
    const pcts = poll.votes.map(count => (total ? Math.round(count / total * 100) : 0));
    // Numbers first: they affect row height, which fit() measures. They count
    // up to their new value; the widest text (100%) is short enough that the
    // changing digits don't reflow the row.
    optionsEl.querySelectorAll('.opt').forEach((opt, i) => {
      const count = poll.votes[i] || 0;
      const [pctEl, countEl] = opt.querySelector('.opt-num').children;
      Motion.tweenNumber(pctEl, pcts[i], formatPct);
      Motion.tweenNumber(countEl, count, formatVotes);
      opt.classList.toggle('lead', count > 0 && count === max);
    });
    if (optionsChanged || questionChanged) fit();
    // Bars on the next frame, so a freshly built row paints at 0% and grows.
    requestAnimationFrame(() => {
      optionsEl.querySelectorAll('.fill').forEach((fill, i) => { fill.style.width = pcts[i] + '%'; });
    });

    const votesEl = $('votes');
    Motion.tweenNumber(votesEl, total, formatInt);
    if (lastTotal !== null && total > lastTotal) {
      votesEl.classList.remove('bump');
      void votesEl.offsetWidth;
      votesEl.classList.add('bump');
    }
    lastTotal = total;
    Motion.tweenNumber($('participants'), poll.participants, formatInt);
    votingTimer.set(poll.voting);
  }

  if (!/^\d{4,5}$/.test(code)) {
    showMessage('Sunum ekranı için anket kodu gerekli: /present?code=1234');
    return;
  }

  const socket = io();

  // Rejoin on every (re)connect; a new socket has no rooms.
  socket.on('connect', () => {
    $('conn').hidden = true;
    socket.emit('watchPoll', code, (res) => {
      if (res.error) return showMessage(res.error);
      $('message').hidden = true;
      $('stage').hidden = false;
      $('join-url').textContent = res.joinUrl.replace(/^https?:\/\//, '');
      // Cache-busting query so a reconnect after a restart refetches it.
      $('qr').src = `/qr/${encodeURIComponent(code)}.svg?t=${Date.now()}`;
      render(res.poll);
    });
  });
  socket.on('disconnect', () => { $('conn').hidden = false; });
  socket.on('watchPoll', render);
  socket.on('pollDeleted', () => showMessage('Bu anket silindi.'));

  // ── Controls ─────────────────────────────────────────────
  function toggleHidden() {
    hidden = !hidden;
    document.body.classList.toggle('hidden-results', hidden);
    $('btn-hide').firstChild.textContent = hidden ? 'Sonuçları göster' : 'Sonuçları gizle';
    fit();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    $('btn-full').firstChild.textContent = document.fullscreenElement ? 'Tam ekrandan çık' : 'Tam ekran';
  });

  $('btn-hide').addEventListener('click', toggleHidden);
  $('btn-full').addEventListener('click', toggleFullscreen);
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') toggleHidden();
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  // Hide the controls and cursor after a few seconds without mouse movement.
  let idleTimer;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  }
  addEventListener('mousemove', wake);
  addEventListener('keydown', wake);
  wake();
})();
