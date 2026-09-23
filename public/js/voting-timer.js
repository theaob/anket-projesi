// Shared countdown for the voting timer, used by the voter, manage and
// presenter pages. The server sends `{ open, remainingMs }`; the deadline is
// kept relative to this page's own clock, so a device whose clock is wrong
// still counts down correctly.
(() => {
  function format(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // onChange({ open, remainingMs, text }) runs immediately on set() and then
  // four times a second while a timer is running. When the countdown reaches
  // zero it reports open: false straight away; the server's own close event
  // follows moments later.
  function create(onChange) {
    let open = false;
    let deadline = null;
    let interval = null;

    function stop() {
      clearInterval(interval);
      interval = null;
    }

    function tick() {
      const remainingMs = deadline === null ? null : Math.max(0, deadline - performance.now());
      const stillOpen = open && !(remainingMs !== null && remainingMs <= 0);
      onChange({ open: stillOpen, remainingMs, text: remainingMs === null ? '' : format(remainingMs) });
      if (!stillOpen) stop();
    }

    return {
      set(voting) {
        stop();
        open = !!voting.open;
        deadline = open && voting.remainingMs != null ? performance.now() + voting.remainingMs : null;
        tick();
        if (open && deadline !== null) interval = setInterval(tick, 250);
      }
    };
  }

  window.VotingTimer = { create, format };
})();
