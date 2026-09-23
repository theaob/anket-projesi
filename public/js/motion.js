// Small animation helpers shared by the voter, manage and presenter pages.
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;

  // Counts the number shown in `el` from its current value to `to`. The first
  // call just sets the value (nothing to count from) unless a start value was
  // given with setNumber(). With reduced motion the number is set directly.
  function tweenNumber(el, to, format, duration = 600) {
    const from = el._shownValue ?? to;
    cancelAnimationFrame(el._tweenFrame);
    el._tweenTarget = to;
    if (from === to || reducedMotion.matches) {
      el._shownValue = to;
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el._shownValue = Math.round(from + (to - from) * easeOutCubic(t));
      el.textContent = format(el._shownValue);
      if (t < 1) el._tweenFrame = requestAnimationFrame(step);
    };
    el._tweenFrame = requestAnimationFrame(step);
  }

  // Sets the value a later tweenNumber() counts from, without animating.
  function setNumber(el, value, format) {
    cancelAnimationFrame(el._tweenFrame);
    el._shownValue = value;
    el.textContent = format(value);
  }

  // Runs a DOM change as a cross-fade where the browser supports view
  // transitions (and motion is allowed); otherwise just runs it.
  function transition(change) {
    if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(change);
    else change();
  }

  window.Motion = { tweenNumber, setNumber, transition, get reduced() { return reducedMotion.matches; } };
})();
