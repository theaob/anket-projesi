// Shared countdown for voting, used by the voter, manage and presenter pages.
// The server sends `{ phase, remainingMs, startsInMs, opensAt, closesAt }`;
// countdowns run against this page's own clock from the remaining time, so a
// device whose clock is wrong still counts down correctly.
(() => {
  // 0:42 · 12:05 · 1:02:09 · 3d 4h
  function format(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const days = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    if (days > 0) return h ? `${days}d ${h}h` : `${days}d`;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
    return `${m}:${sec}`;
  }

  // "Sep 24, 2:00 PM", or just "2:00 PM" for today.
  function formatDate(ms) {
    const d = new Date(ms);
    const today = d.toDateString() === new Date().toDateString();
    return d.toLocaleString('en-US', today
      ? { hour: 'numeric', minute: '2-digit' }
      : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  // onChange({ phase, open, remainingMs, startsInMs, text, opensAt, closesAt })
  // runs immediately on set() and then four times a second while a countdown
  // runs. `text` is the countdown to the start (scheduled) or to the end
  // (open with an end time). When the end countdown reaches zero it reports
  // 'closed' straight away; at the start it keeps 'scheduled' (at 0:00) until
  // the server says voting has opened, so no vote is sent too early.
  function create(onChange) {
    let state = null;
    let target = null; // performance.now() of the next start or end
    let interval = null;

    function stop() {
      clearInterval(interval);
      interval = null;
    }

    function tick() {
      const left = target === null ? null : Math.max(0, target - performance.now());
      let phase = state.phase;
      if (phase === 'open' && left === 0) phase = 'closed';
      onChange({
        phase,
        open: phase === 'open',
        remainingMs: phase === 'open' ? left : null,
        startsInMs: phase === 'scheduled' ? left : null,
        text: phase !== 'closed' && left !== null ? format(left) : '',
        opensAt: state.opensAt ?? null,
        closesAt: state.closesAt ?? null
      });
      if (phase === 'closed' || left === 0) stop();
    }

    return {
      set(voting) {
        stop();
        // Servers before scheduling only sent { open, remainingMs }.
        state = { ...voting, phase: voting.phase || (voting.open ? 'open' : 'closed') };
        const ms = state.phase === 'scheduled' ? state.startsInMs : state.phase === 'open' ? state.remainingMs : null;
        target = ms == null ? null : performance.now() + ms;
        tick();
        if (target !== null && target > performance.now() && state.phase !== 'closed') interval = setInterval(tick, 250);
      }
    };
  }

  window.VotingTimer = { create, format, formatDate };
})();
