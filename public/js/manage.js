(() => {
    const $ = (id) => document.getElementById(id);
    const secret = location.hash.slice(1);
    let poll = null;

    // Polls created or managed in this browser, listed on the home page.
    function loadMyPolls() {
        try { return JSON.parse(localStorage.getItem('myPolls')) || []; } catch (e) { return []; }
    }
    function saveMyPolls(list) {
        try { localStorage.setItem('myPolls', JSON.stringify(list)); } catch (e) {}
    }
    function rememberPoll(p) {
        const list = loadMyPolls().filter(item => item.secret !== secret);
        list.unshift({ code: p.code, secret, question: p.question });
        saveMyPolls(list);
    }
    function forgetPoll() {
        saveMyPolls(loadMyPolls().filter(item => item.secret !== secret));
    }

    function showError(msg) {
        $('editor').hidden = true;
        $('error').hidden = false;
        $('error').textContent = msg;
    }

    function totalVotes(p) {
        return p.votes.reduce((a, b) => a + b, 0);
    }

    function renderStats() {
        const stats = $('stats');
        stats.replaceChildren();
        [['👁 Ziyaret', poll.visits], ['✔ Oy', totalVotes(poll)], ['✗ Oy vermeden ayrılan', poll.abandoned]]
            .forEach(([label, value]) => {
                const span = document.createElement('span');
                const strong = document.createElement('strong');
                strong.textContent = value;
                span.append(label + ': ', strong);
                stats.appendChild(span);
            });
    }

    function renderResults() {
        const results = $('results');
        results.replaceChildren();
        if (poll.options.length === 0) {
            const p = document.createElement('p');
            p.className = 'empty-state';
            p.textContent = 'Henüz seçenek yok. Aşağıdan soru ve seçenekleri ekleyip yayınlayın.';
            results.appendChild(p);
            return;
        }
        const total = totalVotes(poll);
        poll.options.forEach((label, i) => {
            const count = poll.votes[i] || 0;
            const pct = total ? Math.round(count / total * 100) : 0;
            const row = document.createElement('div');
            row.className = 'label-row';
            const name = document.createElement('span');
            name.textContent = label;
            const value = document.createElement('span');
            value.textContent = `${count} oy · %${pct}`;
            row.append(name, value);
            const bar = document.createElement('div');
            bar.className = 'bar-container';
            const fill = document.createElement('div');
            fill.className = 'bar';
            fill.style.width = pct + '%';
            bar.appendChild(fill);
            results.append(row, bar);
        });
    }

    function addOption(text = '') {
        const row = document.createElement('div');
        row.className = 'option-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Seçenek...';
        input.maxLength = 200;
        input.value = text;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-remove';
        remove.textContent = '✕';
        remove.setAttribute('aria-label', 'Seçeneği kaldır');
        remove.addEventListener('click', () => row.remove());
        row.append(input, remove);
        $('options-list').appendChild(row);
    }

    function fillEditor() {
        $('question').value = poll.question || '';
        $('options-list').replaceChildren();
        if (poll.options.length) poll.options.forEach(opt => addOption(opt));
        else { addOption(); addOption(); }
    }

    // Voting state as last reported by the countdown.
    let voting = { open: true, remainingMs: null };
    const votingTimer = VotingTimer.create((state) => {
        voting = state;
        const timed = state.open && state.remainingMs !== null;
        const status = $('voting-status');
        status.classList.toggle('closed', !state.open);
        status.classList.toggle('urgent', timed && state.remainingMs <= 10000);
        status.textContent = !state.open ? 'Oylama kapalı' : timed ? `Oylama açık · ${state.text} kaldı` : 'Oylama açık';
        const toggle = $('btn-voting');
        toggle.textContent = state.open ? '■ Oylamayı kapat' : '▶ Oylamayı aç';
        toggle.className = state.open ? 'btn-close' : 'btn-open';
        $('timer-running').hidden = !timed;
    });

    function setVoting(open, seconds) {
        if (poll) socket.emit('setVoting', { code: poll.code, open, seconds });
    }

    function showPoll(p, { refillEditor }) {
        poll = p;
        $('error').hidden = true;
        $('editor').hidden = false;
        $('code').textContent = p.code;
        $('share-link').value = `${location.origin}/?code=${p.code}`;
        $('present-link').href = `/present?code=${p.code}`;
        $('manage-link').value = location.href;
        document.title = `${p.code} · Anketi Yönet`;
        renderStats();
        renderResults();
        votingTimer.set(p.voting);
        if (refillEditor) fillEditor();
        rememberPoll(p);
    }

    if (!secret) {
        showError('Yönetim bağlantısı eksik. Ana sayfadan yeni bir anket oluşturabilirsiniz.');
        return;
    }

    // Opening a different manage link in this tab only changes the hash.
    addEventListener('hashchange', () => location.reload());

    const socket = io();

    // Re-authorise on every (re)connect: a new socket starts with no rights.
    socket.on('connect', () => {
        $('conn').hidden = true;
        socket.emit('manage', secret, (res) => {
            if (res.error) return showError(res.error);
            showPoll(res.poll, { refillEditor: !poll });
        });
    });
    socket.on('disconnect', () => { $('conn').hidden = false; });

    // Live stats and results; the editor is left alone so typing isn't lost.
    socket.on('managePoll', (p) => showPoll(p, { refillEditor: false }));

    socket.on('pollDeleted', () => {
        forgetPoll();
        showError('Bu anket silindi.');
    });

    $('btn-add').addEventListener('click', () => addOption());

    $('btn-voting').addEventListener('click', () => setVoting(!voting.open));
    document.querySelectorAll('#timer-presets button').forEach((btn) => {
        btn.addEventListener('click', () => setVoting(true, Number(btn.dataset.seconds)));
    });
    $('btn-extend').addEventListener('click', () => {
        if (voting.remainingMs === null) return;
        setVoting(true, Math.min(3600, Math.ceil(voting.remainingMs / 1000) + 30));
    });
    $('btn-untimed').addEventListener('click', () => setVoting(true));

    $('btn-save').addEventListener('click', () => {
        if (!poll) return;
        const question = $('question').value.trim();
        const options = [...document.querySelectorAll('#options-list input')]
            .map(input => input.value.trim())
            .filter(text => text !== '');
        // Changing the options resets the votes on the server, so warn first.
        const optionsChanged = options.length !== poll.options.length
            || options.some((opt, i) => opt !== poll.options[i]);
        if (optionsChanged && totalVotes(poll) > 0
            && !confirm('Seçenekler değişti; mevcut oylar sıfırlanacak. Devam edilsin mi?')) return;
        socket.emit('updatePoll', { code: poll.code, question, options });
    });

    $('btn-reset').addEventListener('click', () => {
        if (poll && confirm('Oylar sıfırlanacak. Emin misiniz?')) socket.emit('resetVotes', poll.code);
    });

    $('btn-delete').addEventListener('click', () => {
        if (poll && confirm(`${poll.code} kodlu anket ve tüm sonuçları kalıcı olarak silinecek. Emin misiniz?`)) {
            socket.emit('deletePoll', poll.code);
        }
    });

    $('btn-export').addEventListener('click', () => {
        if (!poll) return;
        socket.emit('exportCsv', poll.code, (res) => {
            if (res.error) return alert(res.error);
            const url = URL.createObjectURL(new Blob([res.csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `anket_${poll.code}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    });

    document.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const input = $(btn.dataset.copy);
            try {
                await navigator.clipboard.writeText(input.value);
            } catch (e) {
                // Clipboard API needs HTTPS; fall back for plain-HTTP intranets.
                input.select();
                document.execCommand('copy');
            }
            const old = btn.textContent;
            btn.textContent = 'Kopyalandı';
            setTimeout(() => { btn.textContent = old; }, 1500);
        });
    });
})();
