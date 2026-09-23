// Printable poll report (/report#<manage secret>). The browser's print dialog
// turns it into a PDF.
(() => {
  const $ = (id) => document.getElementById(id);
  const secret = location.hash.slice(1);
  const SVG = 'http://www.w3.org/2000/svg';

  const int = (n) => n.toLocaleString('tr-TR');
  const pct = (share) => '%' + (Math.round(share * 1000) / 10).toLocaleString('tr-TR');
  const dateTime = (ms) => new Date(ms).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  const time = (ms, withDay) => new Date(ms).toLocaleString('tr-TR', withDay
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });

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
    document.title = `${r.code} · Anket Raporu`;
    $('question').textContent = r.question;
    const status = { closed: 'Kapalı', scheduled: 'Planlandı', open: 'Açık' }[r.voting.phase];
    const meta = [['Kod', r.code], ['Oylama', status], ['Rapor', dateTime(r.exportedAt)]];
    if (r.voting.closesAt) meta.splice(2, 0, ['Bitiş', dateTime(r.voting.closesAt)]);
    if (r.voting.opensAt) meta.splice(2, 0, ['Başlangıç', dateTime(r.voting.opensAt)]);
    if (r.createdAt) meta.splice(2, 0, ['Oluşturulma', dateTime(r.createdAt)]);
    $('meta').replaceChildren(...meta.map(([k, v]) => el('span', {}, k + ': ', el('strong', { textContent: v }))));

    const f = r.funnel;
    const tiles = [
      ['Ziyaretçi', int(f.visitors)],
      ['Oy veren', int(f.voted)],
      ['Katılım oranı', f.participation === null ? '—' : pct(f.participation)],
      ['Oy vermeden ayrılan', int(f.abandoned)]
    ];
    $('tiles').replaceChildren(...tiles.map(([k, v]) => el('div', { className: 'tile' },
      el('span', { textContent: k }), el('strong', { textContent: v }))));

    // Bars scale to the largest option, so the leader spans the track.
    $('total').textContent = `${int(r.totalVotes)} oy`;
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
    $('table-total-pct').textContent = r.totalVotes ? '%100' : '%0';

    renderTimeline(r.timeline);
    $('foot').textContent = 'Saatler bu cihazın saat dilimindedir. Oy saatleri ve ayrıntılar için Excel dışa aktarımını kullanın.';
    $('message').hidden = true;
    $('page').hidden = false;
    $('toolbar').hidden = false;
  }

  // Column chart of votes per interval: one hue, 4px rounded tops, a hairline
  // grid on clean ticks, the peak labelled; a tooltip per column on hover.
  function renderTimeline(t) {
    const box = $('timeline');
    if (!t.buckets.length) {
      box.replaceChildren(el('p', { className: 'empty', textContent: 'Henüz oy verilmedi.' }));
      $('bucket').textContent = '';
      return;
    }
    $('bucket').textContent = `${t.bucketMinutes} dakikalık aralıklarla`;
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
    svg.setAttribute('aria-label', `Zamana göre oylar: en yoğun aralıkta ${peak} oy`);
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
        tip.textContent = `${time(b.start, withDay)}: ${b.votes} oy (toplam ${b.cumulative})`;
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
    showMessage('Rapor bağlantısı eksik. Raporu anketin yönetim sayfasından açın.');
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
