// ==========================================================
// voice.js (v4.24) - Input Barang dengan SUARA (Daftar Sementara)
// File terpisah: dimuat SETELAH main.js & keyboard.js.
// Tidak mengubah file lain. Hanya memakai fungsi/variabel yang sudah ada:
//   inventory, cart, units, calculateSmartSubtotal, renderCart,
//   showToast, playTick, playCekring, formatRp
// Cara kerja: tekan tombol mic -> sebut barang + jumlah -> muncul di
// DAFTAR SEMENTARA -> atur jumlah / pilih jenis -> KONFIRMASI -> masuk keranjang.
// ==========================================================
(function () {
    'use strict';
    const root = typeof window !== 'undefined' ? window : globalThis;
    const SR = root.SpeechRecognition || root.webkitSpeechRecognition;

    // ---------- HELPER UMUM ----------
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const r3 = (n) => Math.round(n * 1000) / 1000;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const fmt = (n) => (typeof formatRp === 'function' ? formatRp(n) : Number(n).toLocaleString('id-ID'));
    const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'success'); };
    const inv = () => (typeof inventory !== 'undefined' && Array.isArray(inventory) ? inventory : []);

    // ---------- SATUAN ----------
    const GROUPS = {
        bks: ['bks', 'bungkus', 'bungkusan', 'pak', 'pack', 'sachet'],
        kg: ['kg', 'kilo', 'kilogram', 'kiloan'],
        ons: ['ons'],
        gram: ['gram', 'gr'],
        liter: ['liter', 'lt', 'ltr'],
        pcs: ['pcs', 'pc', 'biji', 'buah', 'butir', 'potong']
    };
    const ALIAS = Object.create(null);
    Object.keys(GROUPS).forEach((k) => GROUPS[k].forEach((w) => { ALIAS[w] = k; }));
    const W = Object.assign(Object.create(null), { kg: 1000, ons: 100, gram: 1 }); // berat (gram)

    function unitGroup(u) {
        u = String(u || '').toLowerCase().trim();
        return ALIAS[u] || u;
    }
    function unitOf(tok) {
        if (ALIAS[tok]) return ALIAS[tok];
        try { if (typeof units !== 'undefined' && units.some((u) => String(u).toLowerCase() === tok)) return tok; } catch (e) {}
        return null;
    }
    function validUnits(it) {
        const seen = new Set(); const r = [];
        [it.unit, it.eceranUnit, it.eceranUnit2].filter(Boolean).forEach((u) => {
            const k = String(u).toLowerCase();
            if (!seen.has(k)) { seen.add(k); r.push(u); }
        });
        return r;
    }

    // ---------- ANGKA DALAM BAHASA INDONESIA ----------
    const NW = Object.assign(Object.create(null), { nol: 0, kosong: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11, seratus: 100 });

    function readNumber(t, i) {
        let cur = null, j = i, digits = false;
        while (j < t.length) {
            const w = t[j];
            if (/^\d+(\.\d+)?$/.test(w)) { if (cur !== null) break; cur = parseFloat(w); digits = true; j++; continue; }
            if (w === 'setengah' || w === 'stengah') { cur = (cur || 0) + 0.5; j++; break; }
            if (w === 'seperempat') { cur = (cur || 0) + 0.25; j++; break; }
            if (w === 'belas' && cur !== null && cur < 10) { cur += 10; j++; continue; }
            if (w === 'puluh' && cur !== null && cur < 10) { cur *= 10; j++; continue; }
            if (w === 'ratus' && cur !== null && cur < 10) { cur *= 100; j++; continue; }
            if (NW[w] !== undefined) {
                const n = NW[w];
                if (cur === null) { cur = n; j++; continue; }
                if (cur >= 20 && cur < 100 && cur % 10 === 0 && n >= 1 && n <= 9) { cur += n; j++; continue; }
                break;
            }
            break;
        }
        return cur === null ? null : { value: cur, next: j, digits: digits };
    }

    function readQty(t, i) {
        const n = readNumber(t, i);
        if (n) {
            let u = null, next = n.next;
            if (next < t.length) { const gu = unitOf(t[next]); if (gu) { u = gu; next++; } }
            if (n.digits && n.value >= 100 && !u) return null; // "Aqua 600" = bagian nama, bukan jumlah
            return { qty: n.value, unit: u, next: next };
        }
        const w = t[i];
        if (w && w.length > 3 && w.indexOf('se') === 0) { // sekilo, seons, sebungkus, seliter ...
            const gu = unitOf(w.slice(2));
            if (gu) return { qty: 1, unit: gu, next: i + 1 };
        }
        return null;
    }

    // ---------- PEMECAH KALIMAT ----------
    const SEP = new Set(['lalu', 'terus', 'kemudian', 'selanjutnya', 'berikutnya', 'dan', 'tambah', 'tambahkan']);
    const STOP = new Set(['beli', 'ambil', 'minta', 'tolong', 'yang', 'itu', 'dong', 'ya', 'nih', 'aja', 'saja', 'masukkan', 'pesan', 'mau']);

    function normalizeText(s) {
        return String(s).toLowerCase()
            .replace(/½/g, ' setengah ')
            .replace(/\b1\s*\/\s*2\b/g, ' setengah ')
            .replace(/(\d),(\d)/g, '$1.$2')
            .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
            .replace(/(?<!\d)\./g, ' ')
            .replace(/\.(?!\d)/g, ' ')
            .replace(/(\d)(\p{L})/gu, '$1 $2')
            .replace(/\s+/g, ' ').trim();
    }

    // "indomie kaldu 2 bungkus kopi setengah ons" -> [{name,qty,unit}, ...]
    function parseUtterance(text) {
        const toks = normalizeText(text).split(' ').filter(Boolean);
        const segs = []; let cur = [];
        toks.forEach((w) => { if (SEP.has(w)) { if (cur.length) segs.push(cur); cur = []; } else cur.push(w); });
        if (cur.length) segs.push(cur);

        const out = [];
        segs.forEach((seg) => {
            let nameTok = [], pend = null, i = 0;
            const flush = (q) => {
                out.push({ name: nameTok.filter((w) => !STOP.has(w)).join(' ').trim(), qty: q ? q.qty : null, unit: q ? q.unit : null });
                nameTok = [];
            };
            while (i < seg.length) {
                const q = readQty(seg, i);
                if (q) {
                    if (nameTok.length) { if (pend) { flush(pend); pend = q; } else flush(q); }
                    else pend = q;
                    i = q.next;
                } else { nameTok.push(seg[i]); i++; }
            }
            if (nameTok.length) flush(pend);
            else if (pend) out.push({ name: '', qty: pend.qty, unit: pend.unit });
        });
        return out;
    }

    // ---------- PENCOCOKAN NAMA BARANG (TOLERAN SALAH DENGAR) ----------
    const SYN = Object.assign(Object.create(null), { mi: 'mie', indomi: 'indomie', indomy: 'indomie', telor: 'telur', gula: 'gula' });

    function lev(a, b) {
        const m = a.length, n = b.length;
        if (Math.abs(m - n) > 2) return 9;
        const dp = [];
        for (let i = 0; i <= m; i++) { dp[i] = [i]; }
        for (let j = 1; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        return dp[m][n];
    }
    function tokMatch(q, t) {
        if (q === t) return 1;
        if (q.length >= 3 && t.indexOf(q) === 0) return 0.9;
        if (t.length >= 3 && q.indexOf(t) === 0) return 0.8;
        if (q.length >= 4 && t.length >= 4) {
            const d = lev(q, t);
            if (d <= 1) return 0.85;
            if (d <= 2 && q.length >= 7 && t.length >= 7) return 0.7;
        }
        return 0;
    }

    function matchItems(name) {
        const q = String(name || '').split(' ').filter(Boolean).map((w) => SYN[w] || w);
        if (!q.length) return { list: [], auto: null, weak: false };
        const qJoined = q.join(' ');
        const scored = [];
        inv().forEach((it) => {
            const itT = normalizeText(it.name).split(' ').filter(Boolean).map((w) => SYN[w] || w);
            if (!itT.length) return;
            const exact = itT.join(' ') === qJoined;
            let sum = 0; const used = new Set();
            q.forEach((w) => {
                let best = 0, bi = -1;
                itT.forEach((t, ix) => { const s = tokMatch(w, t); if (s > best) { best = s; bi = ix; } });
                sum += best; if (bi >= 0 && best >= 0.7) used.add(bi);
            });
            scored.push({ it: it, score: exact ? 1 : sum / q.length, cov: exact ? 1 : used.size / itT.length, len: itT.length, exact: exact });
        });
        const sorter = (a, b) => b.score - a.score || b.cov - a.cov || a.len - b.len;
        let cand = scored.filter((s) => s.score >= 0.6).sort(sorter);
        let weak = false;
        if (!cand.length) { cand = scored.filter((s) => s.score >= 0.4).sort(sorter); weak = cand.length > 0; }
        let auto = null;
        if (!weak && cand.length) {
            const ex = cand.filter((s) => s.exact);
            const strong = cand.filter((s) => s.score >= 0.85);
            if (ex.length === 1) auto = ex[0].it;
            else if (strong.length === 1) auto = strong[0].it;
        }
        return { list: cand.slice(0, 8).map((s) => s.it), auto: auto, weak: weak };
    }

    // ---------- DAFTAR SEMENTARA ----------
    let drafts = []; let uid = 0;

    function setItem(d, it) {
        d.item = it;
        const vu = validUnits(it);
        let qty = (d.rawQty != null && d.rawQty > 0) ? d.rawQty : 1;
        let unit = it.unit, note = '';
        if (d.rawUnit) {
            const m = vu.find((u) => unitGroup(u) === d.rawUnit);
            const baseG = unitGroup(it.unit);
            if (m) unit = m;
            else if (W[d.rawUnit] && W[baseG]) qty = qty * W[d.rawUnit] / W[baseG]; // mis. setengah ons -> 0.05 Kg
            else note = 'Satuan "' + d.rawUnit + '" tidak ada di barang ini, dipakai ' + it.unit;
        }
        d.qty = r3(qty); d.unit = unit; d.note = note;
    }

    function mergeDup(d) {
        const o = drafts.find((x) => x !== d && x.item && d.item && x.item.id === d.item.id && x.unit === d.unit);
        if (o) { o.qty = r3(o.qty + d.qty); drafts.splice(drafts.indexOf(d), 1); }
    }

    function addParsed(p) {
        if (!p.name) { // hanya jumlah ("tiga") -> ubah jumlah barang terakhir
            const last = drafts[drafts.length - 1];
            if (last && last.item && p.qty > 0) { last.qty = r3(p.qty); return; }
            return;
        }
        const d = { uid: ++uid, spoken: p.name, rawQty: p.qty, rawUnit: p.unit, item: null, qty: 1, unit: '', cands: [], weak: false, note: '' };
        const res = matchItems(p.name);
        d.cands = res.list; d.weak = res.weak;
        drafts.push(d);
        if (res.auto) { setItem(d, res.auto); mergeDup(d); }
    }

    function addFromText(text) {
        const items = parseUtterance(text);
        if (!items.length) return;
        items.forEach(addParsed);
        if (typeof playTick === 'function') playTick();
    }

    // ---------- SUARA ----------
    let rec = null, listening = false, lastFinal = '', lastFinalAt = 0, idleTimer = null;
    let ui = { status: null, render: function () {}, listenUI: function () {} };

    function armIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { if (listening) { stopListen(); toast('Mikrofon dimatikan otomatis (tidak ada suara)', 'warning'); } }, 25000);
    }
    function stopListen() {
        listening = false; clearTimeout(idleTimer);
        try { if (rec) rec.stop(); } catch (e) {}
        ui.listenUI();
    }
    function startListen() {
        if (!SR) { toast('Browser ini belum mendukung suara. Pakai Chrome (Android/Laptop) atau ketik manual.', 'warning'); return; }
        if (listening) return;
        rec = new SR();
        rec.lang = 'id-ID'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
        rec.onresult = function (e) {
            let fin = '', interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) fin += r[0].transcript + ' '; else interim += r[0].transcript;
            }
            if (interim && ui.status) ui.status('🎧 ' + interim);
            fin = fin.trim();
            if (fin) {
                const now = Date.now();
                if (fin === lastFinal && now - lastFinalAt < 1500) return; // cegah hasil dobel
                lastFinal = fin; lastFinalAt = now;
                if (ui.status) ui.status('✓ ' + fin);
                addFromText(fin); ui.render(); armIdle();
            }
        };
        rec.onerror = function (e) {
            const er = e && e.error;
            if (er === 'not-allowed' || er === 'service-not-allowed') { stopListen(); if (ui.status) ui.status('⚠ Izin mikrofon ditolak. Aktifkan di pengaturan situs/aplikasi.'); }
            else if (er === 'network') { stopListen(); if (ui.status) ui.status('⚠ Butuh internet untuk mengenali suara.'); }
            else if (er === 'audio-capture') { stopListen(); if (ui.status) ui.status('⚠ Mikrofon tidak ditemukan.'); }
        };
        rec.onend = function () {
            if (listening) setTimeout(() => { if (listening) { try { rec.start(); } catch (e) {} } }, 150);
            else ui.listenUI();
        };
        listening = true;
        try { rec.start(); } catch (e) {}
        if (ui.status) ui.status('🎤 Silakan bicara... (contoh: "indomie kaldu dua bungkus")');
        armIdle(); ui.listenUI();
    }

    // ---------- KONFIRMASI -> KERANJANG ----------
    function confirmAll() {
        if (!drafts.length) { toast('Daftar sementara masih kosong', 'warning'); return false; }
        if (drafts.some((d) => !d.item)) { toast('Masih ada barang yang belum dipilih jenisnya', 'warning'); return false; }
        if (typeof cart === 'undefined' || typeof calculateSmartSubtotal !== 'function') { toast('Fungsi keranjang belum siap', 'error'); return false; }
        const t = Date.now(); let n = 0;
        drafts.forEach((d, ix) => {
            const it = d.item;
            const ex = cart.find((x) => x.name === it.name && !x.isManual && x.unit === d.unit);
            if (ex) { ex.qty = r3(ex.qty + d.qty); ex.subtotal = calculateSmartSubtotal(ex.name, ex.unit, ex.qty); }
            else cart.push({ id: t + ix, name: it.name, price: it.price, qty: d.qty, unit: d.unit, subtotal: calculateSmartSubtotal(it.name, d.unit, d.qty), isManual: false });
            n++;
        });
        drafts = [];
        if (typeof renderCart === 'function') renderCart();
        if (typeof playCekring === 'function') playCekring();
        toast(n + ' barang masuk keranjang!');
        return true;
    }

    // ---------- TAMPILAN ----------
    function initUI() {
        const css = `
#vcFab{position:fixed;right:16px;bottom:18px;z-index:9000;width:62px;height:62px;padding:0;border-radius:50%;background:var(--accent,#3498db);color:#fff;font-size:28px;box-shadow:0 6px 18px rgba(0,0,0,.35);border:3px solid #fff;display:flex;align-items:center;justify-content:center}
#vcFab .vc-badge{position:absolute;top:-6px;right:-6px;min-width:22px;height:22px;border-radius:11px;background:var(--danger,#e74c3c);color:#fff;font-size:.75rem;font-weight:900;display:none;align-items:center;justify-content:center;padding:0 5px}
#vcPanel{position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;background:rgba(0,0,0,.55);display:none;align-items:flex-end;justify-content:center}
#vcPanel.open{display:flex}
#vcPanel .vc-sheet{background:#fff;width:100%;max-width:560px;max-height:92vh;max-height:92dvh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;overflow:hidden}
#vcPanel button{width:auto;padding:10px 14px;font-size:.9rem;border-radius:10px;text-transform:none;box-shadow:none;gap:4px}
#vcPanel input{padding:10px;font-size:1rem;border-radius:8px;min-width:0}
.vc-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--primary,#1a252f);color:#fff;font-weight:900}
#vcPanel .vc-x{background:rgba(255,255,255,.15);color:#fff;padding:6px 12px}
.vc-body{padding:12px 14px 0;display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}
.vc-status{font-size:.85rem;font-weight:700;color:var(--primary,#1a252f);background:#e8f4fd;border:1px dashed var(--accent,#3498db);border-radius:8px;padding:8px 10px;min-height:36px;word-break:break-word}
#vcPanel .vc-mic{width:100%;background:var(--success,#2ecc71);color:#fff;font-size:1.05rem;font-weight:900;padding:14px;box-shadow:0 4px 0 #27ae60}
#vcPanel .vc-mic.on{background:var(--danger,#e74c3c);box-shadow:0 4px 0 #c0392b;animation:vcPulse 1.2s infinite}
@keyframes vcPulse{0%,100%{opacity:1}50%{opacity:.7}}
.vc-typed{display:flex;gap:6px}
.vc-typed input{flex:1;border:2px solid var(--border,#dcdde1)}
#vcPanel .vc-addbtn{background:var(--primary,#1a252f);color:#fff;font-weight:900}
.vc-list{overflow-y:auto;flex:1;min-height:90px;display:flex;flex-direction:column;gap:8px;padding-bottom:6px}
.vc-empty{font-size:.85rem;color:#666;text-align:center;padding:18px 6px;font-weight:700}
.vc-row{border:2px solid var(--border,#dcdde1);border-radius:10px;padding:8px 10px;background:#fafafa}
.vc-row.warn{border-color:var(--warning,#f39c12);background:#fff8e1}
.vc-name{font-weight:900;color:var(--primary,#1a252f);text-transform:capitalize}
.vc-price{font-size:.75rem;color:#666;font-weight:700}
.vc-line{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
#vcPanel .vc-step{width:38px;height:38px;padding:0;background:#eee;color:#222;font-size:1.2rem;font-weight:900;border:1px solid #ccc}
#vcPanel .vc-qty{width:68px;text-align:center;font-weight:900;border:2px solid var(--primary,#1a252f);padding:6px}
#vcPanel .vc-unit{background:var(--accent,#3498db);color:#fff;font-weight:900;padding:8px 10px}
.vc-sub{margin-left:auto;font-weight:900;color:var(--primary,#1a252f)}
#vcPanel .vc-del{background:var(--danger,#e74c3c);color:#fff;padding:8px 11px;font-weight:900}
#vcPanel .vc-chg{background:transparent;color:var(--accent,#3498db);text-decoration:underline;padding:2px 4px;font-size:.75rem}
.vc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
#vcPanel .vc-chip{background:#fff;border:2px solid var(--success,#2ecc71);color:var(--primary,#1a252f);font-weight:800;padding:8px 10px;flex-direction:column;align-items:flex-start;text-align:left}
#vcPanel .vc-chip small{font-weight:700;color:#666;font-size:.7rem}
.vc-hint,.vc-note{font-size:.72rem;font-weight:700;color:var(--warning,#f39c12)}
#vcPanel .vc-find{width:100%;margin-top:6px;border:2px dashed var(--warning,#f39c12);padding:8px;font-size:.9rem}
.vc-foot{display:flex;gap:8px;align-items:center;padding:10px 14px 14px;border-top:2px dashed var(--border,#dcdde1);background:#fff}
.vc-total{font-weight:900;color:var(--primary,#1a252f);font-size:.95rem;flex:1}
#vcPanel .vc-clr{background:var(--border,#dcdde1);color:#333;font-weight:900}
#vcPanel .vc-ok{background:var(--success,#2ecc71);color:#fff;font-weight:900;font-size:1rem;box-shadow:0 4px 0 #27ae60;padding:12px 16px}
#vcPanel .vc-ok.off{opacity:.5}
@media print{#vcFab,#vcPanel{display:none!important}}`;
        const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

        const wrap = document.createElement('div');
        wrap.innerHTML = `
<button id="vcFab" type="button" aria-label="Input suara">🎤<span class="vc-badge" id="vcBadge">0</span></button>
<div id="vcPanel"><div class="vc-sheet">
  <div class="vc-head"><span>🎤 INPUT SUARA</span><button type="button" class="vc-x" id="vcClose">TUTUP ✕</button></div>
  <div class="vc-body">
    <div class="vc-status" id="vcStatus">Tekan tombol di bawah lalu sebutkan barang.</div>
    <button type="button" class="vc-mic" id="vcMic">🎤 MULAI BICARA</button>
    <div class="vc-typed"><input type="text" id="vcText" placeholder="Atau ketik: indomie kaldu 2 bks" autocomplete="off"><button type="button" class="vc-addbtn" id="vcAdd">+</button></div>
    <div class="vc-list" id="vcList"></div>
  </div>
  <div class="vc-foot">
    <div class="vc-total" id="vcTotal">Total: Rp 0</div>
    <button type="button" class="vc-clr" id="vcClear">KOSONGKAN</button>
    <button type="button" class="vc-ok" id="vcOk">KONFIRMASI</button>
  </div>
</div></div>`;
        while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

        const $ = (id) => document.getElementById(id);
        const panel = $('vcPanel');

        const chipsHtml = (d) => d.cands.map((it) =>
            `<button type="button" class="vc-chip" data-act="pick" data-uid="${d.uid}" data-id="${esc(it.id)}">${esc(it.name)}<small>Rp ${fmt(it.price)}/${esc(it.unit)}</small></button>`).join('');

        function stepOf(d) { return unitGroup(d.unit) === 'kg' ? 0.1 : 1; }

        function rowHtml(d) {
            if (!d.item) {
                const head = d.cands.length
                    ? (d.weak ? 'Mungkin maksud Anda:' : 'Pilih jenis:')
                    : 'Tidak ditemukan, cari manual:';
                return `<div class="vc-row warn" data-uid="${d.uid}">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                        <div><span class="vc-name">“${esc(d.spoken)}”</span> <span class="vc-price">${d.rawQty != null ? esc(d.rawQty) + ' ' + esc(d.rawUnit || '') : ''}</span><br><span class="vc-price">${head}</span></div>
                        <button type="button" class="vc-del" data-act="remove" data-uid="${d.uid}">✕</button>
                    </div>
                    <div class="vc-chips" id="vcChips-${d.uid}">${chipsHtml(d)}</div>
                    <input type="text" class="vc-find" data-act="find" data-uid="${d.uid}" placeholder="Cari barang lain..." autocomplete="off">
                </div>`;
            }
            const it = d.item;
            const sub = typeof calculateSmartSubtotal === 'function' ? calculateSmartSubtotal(it.name, d.unit, d.qty) : 0;
            const multi = validUnits(it).length > 1;
            const hint = unitGroup(d.unit) === 'kg' ? `<span class="vc-hint">≈ ${r3(d.qty * 10)} ons</span>` : '';
            return `<div class="vc-row" data-uid="${d.uid}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
                    <div><span class="vc-name">${esc(it.name)}</span><br><span class="vc-price">Rp ${fmt(it.price)}/${esc(it.unit)}</span>
                    <button type="button" class="vc-chg" data-act="change" data-uid="${d.uid}">ganti jenis</button></div>
                    <button type="button" class="vc-del" data-act="remove" data-uid="${d.uid}">✕</button>
                </div>
                <div class="vc-line">
                    <button type="button" class="vc-step" data-act="minus" data-uid="${d.uid}">−</button>
                    <input type="text" class="vc-qty" inputmode="decimal" data-act="qty" data-uid="${d.uid}" value="${r3(d.qty)}">
                    <button type="button" class="vc-step" data-act="plus" data-uid="${d.uid}">+</button>
                    <button type="button" class="vc-unit" data-act="unit" data-uid="${d.uid}">${esc(d.unit)}${multi ? ' ▾' : ''}</button>
                    ${hint}
                    <span class="vc-sub">Rp ${fmt(sub)}</span>
                </div>
                ${d.note ? `<div class="vc-note">${esc(d.note)}</div>` : ''}
            </div>`;
        }

        function render() {
            const box = $('vcList');
            box.innerHTML = drafts.length ? drafts.map(rowHtml).join('')
                : '<div class="vc-empty">Belum ada barang.<br>Tekan 🎤 lalu sebut, misal:<br><b>“Indomie kaldu dua bungkus”</b><br><b>“Kopi setengah ons”</b></div>';
            let total = 0, ok = 0;
            drafts.forEach((d) => { if (d.item) { ok++; total += calculateSmartSubtotal(d.item.name, d.unit, d.qty); } });
            $('vcTotal').textContent = 'Total: Rp ' + fmt(Math.round(total));
            const okBtn = $('vcOk');
            okBtn.textContent = 'KONFIRMASI (' + drafts.length + ')';
            okBtn.classList.toggle('off', ok !== drafts.length || !drafts.length);
            const b = $('vcBadge');
            b.textContent = drafts.length; b.style.display = drafts.length ? 'flex' : 'none';
            if (panel.classList.contains('open')) box.scrollTop = box.scrollHeight;
        }

        ui.status = (t) => { $('vcStatus').textContent = t; };
        ui.render = render;
        ui.listenUI = () => {
            const m = $('vcMic');
            m.classList.toggle('on', listening);
            m.textContent = listening ? '⏹ BERHENTI BICARA' : '🎤 MULAI BICARA';
            if (!listening && $('vcStatus').textContent.indexOf('Silakan bicara') > -1) $('vcStatus').textContent = 'Mikrofon mati. Tekan tombol untuk bicara lagi.';
        };

        function openPanel() {
            panel.classList.add('open'); render();
            if (SR) startListen(); else ui.status('Browser ini tidak mendukung suara — pakai kotak ketik di bawah, atau buka lewat Chrome.');
            if (root.matchMedia && root.matchMedia('(hover: hover) and (pointer: fine)').matches) setTimeout(() => $('vcText').focus(), 50);
        }
        function closePanel() { stopListen(); panel.classList.remove('open'); render(); }
        root.addEventListener('beforeunload', stopListen);

        $('vcFab').addEventListener('click', openPanel);
        $('vcClose').addEventListener('click', closePanel);
        panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
        $('vcMic').addEventListener('click', () => { if (listening) stopListen(); else startListen(); });
        $('vcClear').addEventListener('click', () => { drafts = []; render(); });
        $('vcOk').addEventListener('click', () => { if (confirmAll()) closePanel(); });
        const submitText = () => { const v = $('vcText').value.trim(); if (!v) return; addFromText(v); $('vcText').value = ''; render(); };
        $('vcAdd').addEventListener('click', submitText);
        $('vcText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitText(); } });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) closePanel(); });

        const byUid = (id) => drafts.find((x) => String(x.uid) === String(id));

        $('vcList').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-act]'); if (!btn) return;
            const d = byUid(btn.dataset.uid); if (!d) return;
            const act = btn.dataset.act;
            if (typeof playTick === 'function') playTick();
            if (act === 'remove') { drafts.splice(drafts.indexOf(d), 1); }
            else if (act === 'pick') {
                const it = inv().find((x) => String(x.id) === btn.dataset.id);
                if (it) { setItem(d, it); mergeDup(d); }
            }
            else if (act === 'change') {
                d.item = null;
                const res = matchItems(d.spoken); d.cands = res.list; d.weak = res.weak;
            }
            else if (act === 'plus') { d.qty = r3(d.qty + stepOf(d)); }
            else if (act === 'minus') {
                const nq = r3(d.qty - stepOf(d));
                if (nq <= 0) drafts.splice(drafts.indexOf(d), 1); else d.qty = nq;
            }
            else if (act === 'unit') {
                const vu = validUnits(d.item);
                if (vu.length > 1) {
                    const ix = vu.findIndex((u) => u.toLowerCase() === String(d.unit).toLowerCase());
                    d.unit = vu[(ix + 1) % vu.length]; d.note = '';
                }
            }
            render();
        });

        $('vcList').addEventListener('change', (e) => {
            const el = e.target; if (!el.matches || !el.matches('input[data-act="qty"]')) return;
            const d = byUid(el.dataset.uid); if (!d) return;
            const v = parseFloat(String(el.value).replace(',', '.'));
            if (v > 0) d.qty = r3(v);
            render();
        });

        $('vcList').addEventListener('input', (e) => {
            const el = e.target; if (!el.matches || !el.matches('input[data-act="find"]')) return;
            const d = byUid(el.dataset.uid); if (!d) return;
            const q = el.value.trim().toLowerCase();
            d.cands = q ? inv().filter((i) => i.name.toLowerCase().indexOf(q) > -1).slice(0, 8) : [];
            d.weak = false;
            const ch = $('vcChips-' + d.uid); if (ch) ch.innerHTML = chipsHtml(d);
        });

        render();
        root.VoiceKasir = { open: openPanel, close: closePanel, parse: parseUtterance, match: matchItems };
    }

    if (typeof document !== 'undefined' && document.body) {
        try { initUI(); } catch (err) { console.log('voice.js gagal dimuat:', err); }
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { parseUtterance, matchItems, setItem, addParsed, _drafts: () => drafts };
})();
