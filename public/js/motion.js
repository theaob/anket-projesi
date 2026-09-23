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

  // Floats an emoji up from (x, y), in viewport pixels, drifting sideways and
  // fading out. With reduced motion it fades in and out where it starts.
  // Past MAX_FLOATING on screen, new ones are dropped: a flood of reactions
  // still looks busy, but can't pile up thousands of elements.
  const MAX_FLOATING = 60;
  let floating = 0;
  function floatEmoji(emoji, { x, y, size = 28, rise = 200, duration = 2000 }) {
    if (floating >= MAX_FLOATING) return;
    const el = document.createElement('span');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;font-size:${size}px;line-height:1;`
      + 'pointer-events:none;z-index:999;will-change:transform,opacity;transform:translate(-50%,-50%);opacity:0';
    document.body.appendChild(el);
    floating++;
    const frames = reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : (() => {
        const drift = (Math.random() - 0.5) * 80;
        const tilt = (Math.random() - 0.5) * 40;
        const at = (p, opacity, scale) => ({
          transform: `translate(calc(-50% + ${(drift * p + Math.sin(p * Math.PI * 2) * 12).toFixed(1)}px), `
            + `calc(-50% - ${(rise * p).toFixed(1)}px)) rotate(${(tilt * p).toFixed(1)}deg) scale(${scale})`,
          opacity, offset: p
        });
        return [at(0, 0, 0.4), at(0.12, 1, 1.15), at(0.25, 1, 1), at(0.7, 1, 1), at(1, 0, 0.9)];
      })();
    el.animate(frames, { duration, easing: 'cubic-bezier(.3,.6,.4,1)' }).onfinish = () => {
      el.remove();
      floating--;
    };
  }

  window.Motion = { tweenNumber, setNumber, transition, floatEmoji, get reduced() { return reducedMotion.matches; } };
})();
