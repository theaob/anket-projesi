// Shared floating-emoji burst effect for the voting and results screens.
(function () {
    const EMOJIS = ['🎉', '✨', '👍', '🔥', '⭐', '💜', '🙌'];

    function spawnEmojiBurst(x, y, count = 8) {
        for (let i = 0; i < count; i++) {
            const el = document.createElement('span');
            el.className = 'emoji-particle';
            el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

            const dx = (Math.random() - 0.5) * 160;
            const duration = 1800 + Math.random() * 800;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            el.style.setProperty('--dx', `${dx}px`);
            el.style.animationDuration = `${duration}ms`;

            document.body.appendChild(el);
            el.addEventListener('animationend', () => el.remove());
            // Safety net in case animationend never fires (e.g. tab backgrounded).
            setTimeout(() => el.remove(), duration + 500);
        }
    }

    window.spawnEmojiBurst = spawnEmojiBurst;
})();
