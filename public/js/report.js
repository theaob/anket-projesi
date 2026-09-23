// Printable poll report (/report#<manage secret>). The browser's print dialog
// turns it into a PDF.
(() => {
  const $ = (id) => document.getElementById(id);
  const secret = location.hash.slice(1);
  const SVG = 'http://www.w3.org/2000/svg';

  const int = (n) => n.toLocaleString('en-US');
  const pct = (share) => (Math.round(share * 1000) / 10).toLocaleString('en-US') + '%';
  const votesText = (n) => `${int(n)} ${n === 1 ? 'vote' : 'votes'}`;
  const dateTime = (ms) => new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const time = (ms, withDay) => new Date(ms).toLocaleString('en-US', withDay
    ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  function showMessage(text) {
    $('page').hidden = true;
    $('message').hidden = false;
    $('message').textContent = text;
  }

  function render(r) {
    document.title = `${r.code} · Poll Report`;
    $('question').textContent = r.question;
    const status = { closed: 'Closed', scheduled: 'Scheduled', open: 'Open' }[r.voting.phase];
    const meta = [['Code', r.code], ['Voting', status], ['Report', dateTime(r.exportedAt)]];
    if (r.voting.closesAt) meta.splice(2, 0, ['Ends', dateTime(r.voting.closesAt)]);
    if (r.voting.opensAt) meta.splice(2, 0, ['Starts', dateTime(r.voting.opensAt)]);
    if (r.createdAt) meta.splice(2, 0, ['Created', dateTime(r.createdAt)]);
    $('meta').replaceChildren(...meta.map(([k, v]) => el('span', {}, k + ': ', el('strong', { textContent: v }))));

    const f = r.funnel;
    const tiles = [
      ['Visitors', int(f.visitors)],
      ['Voted', int(f.voted)],
      ['Participation rate', f.participation === null ? '—' : pct(f.participation)],
      ['Left without voting', int(f.abandoned)]
    ];
    $('tiles').replaceChildren(...tiles.map(([k, v]) => el('div', { className: 'tile' },
      el('span', { textContent: k }), el('strong', { textContent: v }))));

    // Bars scale to the largest option, so the leader spans the track.
    $('total').textContent = votesText(r.totalVotes);
    const max = Math.max(1, ...r.options.map(o => o.votes));
    $('bars').replaceChildren(...r.options.flatMap(o => [
      el('div', { className: 'label', textContent: o.text }),
      el('div', { className: 'track' },
        Object.assign(el('div', { className: 'fill' }), { style: `width:${(o.votes / max) * 82}%` }),
        el('span', { className: 'value' }, int(o.votes), el('small', { textContent: pct(o.share) })))
    ]));
    $('no-options').hidden = r.options.length > 0;

    $('table').replaceChildren(...r.options.map(o => el('tr', {},
      el('td', { textContent: o.text }),
      el('td', { className: 'num', textContent: int(o.votes) }),
      el('td', { className: 'num', textContent: pct(o.share) }))));
    $('table-total').textContent = int(r.totalVotes);
    $('table-total-pct').textContent = r.totalVotes ? '100%' : '0%';

    renderTimeline(r.timeline);
    $('foot').textContent = 'Times are in this device\'s time zone. For vote times and more detail, use the Excel export.';
    $('message').hidden = true;
    $('page').hidden = false;
    $('toolbar').hidden = false;
  }

  // Column chart of votes per interval: one hue, 4px rounded tops, a hairline
  // grid on clean ticks, the peak labelled; a tooltip per column on hover.
  function renderTimeline(t) {
    const box = $('timeline');
    if (!t.buckets.length) {
      box.replaceChildren(el('p', { className: 'empty', textContent: 'No votes yet.' }));
      $('bucket').textContent = '';
      return;
    }
    $('bucket').textContent = `in ${t.bucketMinutes}-minute intervals`;
    const W = 720, H = 220, left = 34, right = 8, top = 18, bottom = 28;
    const plotW = W - left - right, plotH = H - top - bottom;
    const n = t.buckets.length;
    const peak = Math.max(...t.buckets.map(b => b.votes));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => peak / s <= 4) || Math.ceil(peak / 4);
    const yMax = Math.max(step, Math.ceil(peak / step) * step);
    const y = (v) => top + plotH - (v / yMax) * plotH;
    const slot = plotW / n;
    const barW = Math.min(24, slot * 0.7);
    const first = t.buckets[0].start, last = t.buckets[n - 1].start;
    const withDay = new Date(first).toDateString() !== new Date(last).toDateString();

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Votes over time: ${votesText(peak)} in the busiest interval`);
    const add = (tag, attrs, text) => {
      const node = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text !== undefined) node.textContent = text;
      svg.appendChild(node);
      return node;
    };

    for (let v = 0; v <= yMax; v += step) {
      add('line', { x1: left, x2: W - right, y1: y(v), y2: y(v), class: 'grid' });
      add('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, int(v));
    }
    // About six time labels, evenly spaced.
    const every = Math.max(1, Math.ceil(n / 6));
    let peakLabelled = false;
    t.buckets.forEach((b, i) => {
      const cx = left + slot * i + slot / 2;
      if (b.votes > 0) {
        const h = y(0) - y(b.votes);
        const r = Math.min(4, barW / 2, h);
        const x0 = cx - barW / 2, x1 = cx + barW / 2, yb = y(0), yt = y(b.votes);
        // Rounded at the top (data end), square at the baseline.
        const bar = add('path', {
          class: 'col',
          d: `M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z`
        });
        const tip = document.createElementNS(SVG, 'title');
        tip.textContent = `${time(b.start, withDay)}: ${votesText(b.votes)} (total ${b.cumulative})`;
        bar.appendChild(tip);
        if (b.votes === peak && !peakLabelled) {
          peakLabelled = true;
          add('text', { x: cx, y: yt - 5, 'text-anchor': 'middle', style: 'fill: var(--ink); font-weight: 600' }, int(b.votes));
        }
      }
      if (i % every === 0) add('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, time(b.start, withDay));
    });
    box.replaceChildren(svg);
  }

  if (!secret) {
    showMessage('The report link is incomplete. Open the report from the poll\'s manage page.');
    return;
  }
  $('back').href = '/manage#' + secret;
  $('btn-print').addEventListener('click', () => print());

  const socket = io();
  socket.on('connect', () => {
    socket.emit('manage', secret, (res) => {
      if (res.error) return showMessage(res.error);
      socket.emit('exportPoll', { code: res.poll.code, format: 'report', tzOffset: new Date().getTimezoneOffset() }, (out) => {
        if (out.error) return showMessage(out.error);
        render(out.report);
        // The report is a snapshot; no need to stay connected.
        socket.disconnect();
      });
    });
  });
})();
