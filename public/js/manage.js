(() => {
    const $ = (id) => document.getElementById(id);
    const secret = location.hash.slice(1);
    let poll = null;

    // Polls created or managed in this browser, listed on the home page.
    function loadMyPolls() {
        try { return JSON.parse(localStorage.getItem('myPolls')) || []; } catch (e) { return []; }
    }
    function saveMyPolls(list) {
        try { localStorage.setItem('myPolls', JSON.stringify(list)); } catch (e) { /* storage blocked: the list is only a convenience */ }
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

    const formatInt = (v) => v.toLocaleString('tr-TR');

    // Stats and results are built once and then updated in place, so numbers
    // count to their new value and bars glide instead of being redrawn.
    let statEls = null;
    function renderStats() {
        if (!statEls) {
            statEls = [['👁 Ziyaret'], ['✔ Oy'], ['✗ Oy vermeden ayrılan']].map(([label]) => {
                const span = document.createElement('span');
                const strong = document.createElement('strong');
                span.append(label + ': ', strong);
                $('stats').appendChild(span);
                return strong;
            });
        }
        [poll.visits, totalVotes(poll), poll.abandoned]
            .forEach((value, i) => Motion.tweenNumber(statEls[i], value, formatInt));
    }

    let resultLabels = null;
    let resultRows = [];
    function renderResults() {
        const results = $('results');
        const changed = !resultLabels || resultLabels.length !== poll.options.length
            || resultLabels.some((label, i) => label !== poll.options[i]);
        if (changed) {
            resultLabels = poll.options.slice();
            if (poll.options.length === 0) {
                const p = document.createElement('p');
                p.className = 'empty-state';
                p.textContent = 'Henüz seçenek yok. Aşağıdan soru ve seçenekleri ekleyip yayınlayın.';
                results.replaceChildren(p);
                resultRows = [];
                return;
            }
            resultRows = poll.options.map((label) => {
                const row = document.createElement('div');
                row.className = 'label-row';
                const name = document.createElement('span');
                name.textContent = label;
                const value = document.createElement('span');
                const count = document.createElement('span');
                const pct = document.createElement('span');
                Motion.setNumber(count, 0, formatInt);
                Motion.setNumber(pct, 0, (v) => '%' + v);
                value.append(count, ' oy · ', pct);
                row.append(name, value);
                const bar = document.createElement('div');
                bar.className = 'bar-container';
                const fill = document.createElement('div');
                fill.className = 'bar';
                bar.appendChild(fill);
                return { elements: [row, bar], count, pct, fill };
            });
            results.replaceChildren(...resultRows.flatMap((r) => r.elements));
        }
        const total = totalVotes(poll);
        // New rows paint at 0% first, so their bars grow in.
        const apply = () => resultRows.forEach((r, i) => {
            const count = poll.votes[i] || 0;
            const pct = total ? Math.round(count / total * 100) : 0;
            Motion.tweenNumber(r.count, count, formatInt);
            Motion.tweenNumber(r.pct, pct, (v) => '%' + v);
            r.fill.style.width = pct + '%';
        });
        if (changed) requestAnimationFrame(apply); else apply();
    }

    function addOption(text = '') {
        const row = document.createElement('div');
        row.className = 'option-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Seçenek...';
        input.setAttribute('aria-label', 'Seçenek');
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
    let voting = { phase: 'open', open: true, remainingMs: null, opensAt: null, closesAt: null };
    const votingTimer = VotingTimer.create((state) => {
        voting = state;
        const timed = state.open && state.remainingMs !== null;
        const status = $('voting-status');
        status.classList.toggle('closed', state.phase !== 'open');
        status.classList.toggle('urgent', timed && state.remainingMs <= 10000);
        const end = state.closesAt ? `, bitiş ${VotingTimer.formatDate(state.closesAt)}` : '';
        if (state.phase === 'closed') status.textContent = 'Oylama kapalı';
        else if (state.phase === 'scheduled') {
            status.textContent = `Planlandı · ${VotingTimer.formatDate(state.opensAt)} başlangıç`
                + (state.startsInMs > 0 ? ` (${state.text} sonra)` : '') + end;
        } else status.textContent = timed ? `Oylama açık · ${state.text} kaldı${state.remainingMs > 3600000 ? end : ''}` : 'Oylama açık';
        const toggle = $('btn-voting');
        toggle.textContent = { open: '■ Oylamayı kapat', scheduled: '▶ Şimdi başlat', closed: '▶ Oylamayı aç' }[state.phase];
        toggle.className = state.phase === 'open' ? 'btn-close' : 'btn-open';
        $('timer-running').hidden = !timed;
    });

    // ── Scheduling by date and time ──────────────────────────
    // datetime-local inputs work in this device's local time.
    function toInputValue(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function fromInputValue(value) {
        if (!value) return null;
        const ms = new Date(value).getTime();
        return Number.isNaN(ms) ? undefined : ms;
    }

    // Shows the saved schedule in the form, unless the owner is editing it.
    let scheduleDirty = false;
    function fillSchedule(v) {
        $('sched-start').min = $('sched-end').min = toInputValue(Date.now());
        if (scheduleDirty) return;
        $('sched-start').value = toInputValue(v.phase === 'scheduled' ? v.opensAt : null);
        $('sched-end').value = toInputValue(v.phase !== 'closed' ? v.closesAt : null);
    }
    ['sched-start', 'sched-end'].forEach((id) => $(id).addEventListener('input', () => { scheduleDirty = true; }));

    function saveSchedule(opensAt, closesAt, onDone) {
        socket.emit('setSchedule', { code: poll.code, opensAt, closesAt }, (res) => {
            $('schedule-status').textContent = res.error || '';
            if (onDone) onDone(res);
        });
    }

    $('schedule-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!poll) return;
        const opensAt = fromInputValue($('sched-start').value);
        const closesAt = fromInputValue($('sched-end').value);
        if (opensAt === undefined || closesAt === undefined) {
            $('schedule-status').textContent = 'Tarih ve saati eksiksiz girin.';
            return;
        }
        saveSchedule(opensAt, closesAt, (res) => {
            if (res.error) return;
            scheduleDirty = false;
            $('schedule-status').textContent = opensAt && opensAt > Date.now()
                ? `Plan kaydedildi. Oylama kendiliğinden açılacak: ${VotingTimer.formatDate(opensAt)}.`
                : 'Plan kaydedildi.';
        });
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
        $('report-link').href = `/report#${secret}`;
        $('manage-link').value = location.href;
        document.title = `${p.code} · Anketi Yönet`;
        renderStats();
        renderResults();
        votingTimer.set(p.voting);
        fillSchedule(p.voting);
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

    // "Start now" on a scheduled poll keeps its end time.
    $('btn-voting').addEventListener('click', () => {
        if (voting.phase === 'scheduled' && voting.closesAt) saveSchedule(null, voting.closesAt);
        else setVoting(voting.phase !== 'open');
    });
    document.querySelectorAll('#timer-presets button').forEach((btn) => {
        btn.addEventListener('click', () => setVoting(true, Number(btn.dataset.seconds)));
    });
    // Moves the end 30 seconds later, whether it came from a countdown or a date.
    $('btn-extend').addEventListener('click', () => {
        if (poll && voting.closesAt) saveSchedule(null, voting.closesAt + 30000);
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

    // ── Export ──────────────────────────────────────────────
    // The server builds the file; times in it are written in this device's
    // time zone.
    function download(filename, mime, data) {
        const url = URL.createObjectURL(new Blob([data], { type: mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    document.querySelectorAll('[data-export]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!poll) return;
            btn.disabled = true;
            $('export-status').textContent = 'Hazırlanıyor…';
            socket.timeout(15000).emit('exportPoll',
                { code: poll.code, format: btn.dataset.export, tzOffset: new Date().getTimezoneOffset() },
                (err, res) => {
                    btn.disabled = false;
                    if (err || res.error) {
                        $('export-status').textContent = res?.error || 'Dışa aktarılamadı, lütfen tekrar deneyin.';
                        return;
                    }
                    download(res.filename, res.mime, res.data);
                    $('export-status').textContent = `${res.filename} indirildi.`;
                });
        });
    });

    // ── Import and duplicate ─────────────────────────────────
    // Question and options from a JSON file: this app's export, or a plain
    // { "question": "...", "options": ["...", ...] }. Returns null if unusable.
    function readTemplate(text) {
        let data;
        try { data = JSON.parse(text); } catch (e) { return null; }
        const source = data && typeof data.poll === 'object' && data.poll ? data.poll : data;
        if (!source || !Array.isArray(source.options)) return null;
        const options = source.options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim());
        const question = typeof source.question === 'string' ? source.question.trim() : '';
        return question || options.length ? { question, options } : null;
    }

    // Loads a file into the editor; nothing changes until "Yayınla".
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async () => {
        const file = $('import-file').files[0];
        $('import-file').value = '';
        if (!file) return;
        const template = file.size <= 1024 * 1024 ? readTemplate(await file.text()) : null;
        if (!template) {
            $('import-status').textContent = 'Bu dosyada soru veya seçenek bulunamadı.';
            return;
        }
        $('question').value = template.question;
        $('options-list').replaceChildren();
        template.options.forEach(opt => addOption(opt));
        if (template.options.length < 2) addOption();
        $('import-status').textContent = `${file.name} yüklendi. Kaydetmek için "Yayınla"ya basın.`;
    });

    // A new poll with this one's question and options (and no votes), opened
    // in this tab; this poll stays in the home page list.
    $('btn-duplicate').addEventListener('click', () => {
        if (!poll) return;
        socket.emit('createPoll', { template: { question: poll.question, options: poll.options } }, (res) => {
            if (res.error) {
                $('import-status').textContent = res.error;
                return;
            }
            location.hash = res.secret;
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
