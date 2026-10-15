(function () {
  const LW = 1600, LH = 1200;
  const COLORS = ['#111827', '#2563eb', '#dc2626', '#16a34a', '#f97316'];
  const SIZES = [3, 6, 12];
  const HL = { c: '#fde047', a: 0.4, w: 30 };
  const MODES = [['slides', 'Slides'], ['board', 'Board'], ['split', 'Split'], ['annotate', 'Annotate']];
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function drawBackground(ctx, bg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LW, LH);
    if (bg === 'grid') {
      ctx.strokeStyle = '#d5dde8'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let x = 0; x <= LW; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, LH); }
      for (let y = 0; y <= LH; y += 50) { ctx.moveTo(0, y); ctx.lineTo(LW, y); }
      ctx.stroke();
    } else if (bg === 'lined') {
      ctx.strokeStyle = '#bcd0e8'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let y = 100; y < LH; y += 60) { ctx.moveTo(0, y); ctx.lineTo(LW, y); }
      ctx.stroke();
      ctx.strokeStyle = '#f0b4b4'; ctx.beginPath(); ctx.moveTo(150, 0); ctx.lineTo(150, LH); ctx.stroke();
    }
  }

  function drawStroke(ctx, s) {
    const p = s.p;
    if (!p || !p.length) return;
    ctx.save();
    ctx.globalAlpha = s.a || 1;
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = s.w;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (p.length === 1) {
      ctx.beginPath(); ctx.arc(p[0][0], p[0][1], s.w / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      }
      const l = p[p.length - 1];
      ctx.lineTo(l[0], l[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderToCanvas(bg, strokes, w) {
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.round(w * LH / LW);
    const ctx = c.getContext('2d');
    ctx.scale(c.width / LW, c.height / LH);
    drawBackground(ctx, bg);
    strokes.forEach(s => drawStroke(ctx, s));
    return c;
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function hitStroke(s, x, y, r) {
    const rr = r + s.w / 2;
    if (s.p.length === 1) return Math.hypot(x - s.p[0][0], y - s.p[0][1]) <= rr;
    for (let i = 1; i < s.p.length; i++) {
      if (distToSeg(x, y, s.p[i - 1][0], s.p[i - 1][1], s.p[i][0], s.p[i][1]) <= rr) return true;
    }
    return false;
  }

  const ICONS = {
    hl: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-5 5v4h4l5-5"/><path d="M14 6l4 4-7.5 7.5-4-4z"/><path d="M13 7l4-4 4 4-4 4"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20H8l-4.5-4.5a2 2 0 010-2.8L13 3.2a2 2 0 012.8 0l5 5a2 2 0 010 2.8L12 20"/><path d="M8.5 11.5l6 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    lined: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 14h18M3 19h18"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
    blank: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  };
  ICONS.undo = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>';
  ICONS.redo = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>';
  const BG_NEXT = { lined: 'grid', grid: 'blank', blank: 'lined' };
  const BG_LABEL = { lined: 'Lined', grid: 'Grid', blank: 'Blank' };

  const stamp = () => new Date().toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  function create({ socket, host, variant, onMode, barHost }) {
    const S = { pages: [], cur: 0, mode: 'slides', tool: 'pen', color: 0, size: 1, live: {}, erasing: null };
    host.classList.add('wb-root');
    if (variant) host.classList.add('wb-' + variant);
    host.innerHTML = `
      <div class="wb-toolbar">
        <div class="wb-group wb-modes">${MODES.map(([k, l]) => `<button class="wb-btn" data-mode="${k}">${l}</button>`).join('')}</div>
        <div class="wb-more">
        <div class="wb-group">
          ${COLORS.map((c, i) => `<button class="wb-swatch" data-color="${i}" style="background:${c}" title="Pen color"></button>`).join('')}
          <button class="wb-btn wb-ico" data-tool="hl" title="Highlighter">${ICONS.hl}</button>
          <button class="wb-btn wb-ico" data-tool="eraser" title="Eraser (removes whole strokes)">${ICONS.eraser}</button>
        </div>
        <div class="wb-group">
          ${SIZES.map((s, i) => `<button class="wb-size" data-size="${i}" title="Thickness"><i style="width:${s + 3}px;height:${s + 3}px"></i></button>`).join('')}
          <button class="wb-btn wb-ico" data-act="undo" title="Undo">${ICONS.undo}</button>
          <button class="wb-btn wb-ico" data-act="redo" title="Redo">${ICONS.redo}</button>
          <button class="wb-btn wb-ico" data-act="bg" title="Background"></button>
        </div>
        <div class="wb-group">
          <button class="wb-btn" data-act="prev" title="Previous page">‹</button>
          <span class="wb-page">1 / 1</span>
          <button class="wb-btn" data-act="next" title="Next page (adds a page at the end)">›</button>
          <button class="wb-btn wb-ico" data-act="del" title="Delete page">${ICONS.trash}</button>
        </div>
        <div class="wb-group">
          <button class="wb-btn wb-danger" data-act="clear" title="Save this page and clear it">Clear</button>
          <button class="wb-btn" data-act="saved">Saved</button>
        </div>
        </div>
      </div>
      <div class="wb-stage">
        <div class="wb-surface">
          <canvas class="wb-bgc"></canvas><canvas class="wb-ink"></canvas><canvas class="wb-livec"></canvas>
        </div>
      </div>
      <div class="wb-saved" hidden>
        <div class="wb-saved-box">
          <div class="wb-saved-head"><span>Saved boards</span><button class="wb-btn" data-act="saved-close">✕</button></div>
          <div class="wb-saved-list"></div>
        </div>
      </div>`;

    const $ = (s) => host.querySelector(s);
    const stage = $('.wb-stage'), surface = $('.wb-surface');
    const bgc = $('.wb-bgc'), ink = $('.wb-ink'), livec = $('.wb-livec');
    const savedPanel = $('.wb-saved'), savedList = $('.wb-saved-list');
    const bar = $('.wb-toolbar');
    // On the display the toolbar lives in its own permanent widget
    if (barHost) { barHost.appendChild(bar); bar.classList.add('wb-inline'); }
    const qa = (sel) => bar.querySelectorAll(sel);

    const page = () => S.pages[S.cur];

    function fit() {
      const r = stage.getBoundingClientRect();
      const topPad = (barHost || S.mode === 'annotate') ? 0 : bar.offsetHeight + 16;
      stage.style.paddingTop = topPad + 'px';
      const availW = r.width, availH = r.height - topPad;
      if (availW < 40 || availH < 40) return false;
      const w = Math.min(availW, availH * LW / LH), h = w * LH / LW;
      surface.style.width = w + 'px'; surface.style.height = h + 'px';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      [bgc, ink, livec].forEach(c => { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); });
      return true;
    }

    function prep(c) {
      const ctx = c.getContext('2d');
      ctx.setTransform(c.width / LW, 0, 0, c.height / LH, 0, 0);
      ctx.clearRect(0, 0, LW, LH);
      return ctx;
    }

    function redrawBg() {
      const ctx = prep(bgc);
      if (S.mode !== 'annotate' && page()) drawBackground(ctx, page().bg);
    }
    function redrawInk() {
      const ctx = prep(ink);
      const pg = page(); if (!pg) return;
      pg.strokes.forEach(s => { if (!S.erasing || !S.erasing.has(s.id)) drawStroke(ctx, s); });
    }
    let liveRaf = 0;
    function redrawLive() {
      liveRaf = 0;
      const ctx = prep(livec);
      Object.values(S.live).forEach(s => drawStroke(ctx, s));
    }
    const schedLive = () => { if (!liveRaf) liveRaf = requestAnimationFrame(redrawLive); };
    function redrawAll() { if (fit()) { redrawBg(); redrawInk(); redrawLive(); } }

    function updateUI() {
      host.classList.toggle('wb-annotate', S.mode === 'annotate');
      bar.classList.toggle('wb-slides', !!barHost && S.mode === 'slides');
      qa('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
      qa('[data-color]').forEach(b => b.classList.toggle('on', S.tool === 'pen' && +b.dataset.color === S.color));
      qa('[data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === S.size));
      qa('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
      const pg = page();
      const bgBtn = bar.querySelector('[data-act="bg"]');
      const curBg = (pg && pg.bg) || 'lined';
      bgBtn.innerHTML = ICONS[curBg];
      bgBtn.title = `Background: ${BG_LABEL[curBg]} (tap for ${BG_LABEL[BG_NEXT[curBg]]})`;
      bar.querySelector('.wb-page').textContent = `${S.cur + 1} / ${Math.max(S.pages.length, 1)}`;
    }

    // ── Applying server operations ──
    function applyOp(op) {
      const pg = S.pages.find(p => p.id === op.page);
      const byN = (a, b) => (a.n || 1e12) - (b.n || 1e12);
      if (op.t === 'add' && pg) {
        const ex = pg.strokes.find(s => s.id === op.stroke.id);
        if (ex) ex.n = op.stroke.n; else { pg.strokes.push(op.stroke); pg.strokes.sort(byN); }
        delete S.live[op.stroke.id];
      } else if (op.t === 'del' && pg) {
        const ids = new Set(op.ids);
        pg.strokes = pg.strokes.filter(s => !ids.has(s.id));
      } else if (op.t === 'ins' && pg) {
        op.strokes.forEach(s => { if (!pg.strokes.some(x => x.id === s.id)) pg.strokes.push(s); });
        pg.strokes.sort(byN);
      }
      if (pg && pg === page()) { redrawInk(); redrawLive(); }
    }

    socket.on('board:state', (st) => {
      S.pages = st.pages || []; S.cur = st.cur || 0; S.live = {};
      updateUI(); redrawAll();
    });
    socket.on('board:op', (op) => { applyOp(op); });
    socket.on('board:bg', ({ page: id, bg }) => {
      const pg = S.pages.find(p => p.id === id); if (!pg) return;
      pg.bg = bg; updateUI(); redrawBg();
    });
    socket.on('board:cur', (i) => { S.cur = Math.min(i, S.pages.length - 1); S.live = {}; updateUI(); redrawAll(); });
    socket.on('board:mode', (m) => {
      S.mode = m; updateUI(); redrawBg();
      if (onMode) onMode(m);
      setTimeout(redrawAll, 0);
    });
    socket.on('board:live', (d) => {
      if (!page() || d.page !== page().id) return;
      const s = S.live[d.id] || (S.live[d.id] = { id: d.id, c: d.c, w: d.w, a: d.a, p: [] });
      s.p.push(...d.pts); s.t = Date.now();
      schedLive();
      setTimeout(() => { if (S.live[d.id] && Date.now() - S.live[d.id].t > 3000 && !(active && active.st.id === d.id)) { delete S.live[d.id]; schedLive(); } }, 3200);
    });
    socket.on('board:saves:changed', () => { if (!savedPanel.hidden) loadSaved(); });

    // ── Drawing ──
    let active = null, lastPen = 0, pendingPts = [], flushTimer = 0;
    const toolStyle = () => S.tool === 'hl' ? HL : { c: COLORS[S.color], a: 1, w: SIZES[S.size] };

    function pt(e) {
      const r = surface.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width * LW, (e.clientY - r.top) / r.height * LH];
    }

    function flushLive() {
      flushTimer = 0;
      if (!active || active.type !== 'draw' || !pendingPts.length) return;
      const { c, w, a } = active.st;
      socket.emit('board:live', { page: active.page, id: active.st.id, c, w, a, pts: pendingPts });
      pendingPts = [];
    }

    function eraseAt(p) {
      const pg = page(); if (!pg) return;
      let changed = false;
      pg.strokes.forEach(s => {
        if (!S.erasing.has(s.id) && hitStroke(s, p[0], p[1], 14)) { S.erasing.add(s.id); changed = true; }
      });
      if (changed) redrawInk();
    }

    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') lastPen = Date.now();
      else if (e.pointerType === 'touch' && Date.now() - lastPen < 1500) return;
      if (active || (e.pointerType === 'mouse' && e.button !== 0) || !page()) return;
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch (_) {}
      const p = pt(e);
      if (S.tool === 'eraser') {
        active = { pid: e.pointerId, type: 'erase' };
        S.erasing = new Set();
        eraseAt(p);
      } else {
        const t = toolStyle();
        const st = { id: rid('s_'), c: t.c, w: t.w, a: t.a, p: [p] };
        S.live[st.id] = st;
        active = { pid: e.pointerId, type: 'draw', st, page: page().id };
        pendingPts = [p];
        flushTimer = flushTimer || setTimeout(flushLive, 50);
        schedLive();
      }
    });

    surface.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== active.pid) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach(ev => {
        const p = pt(ev);
        if (active.type === 'erase') { eraseAt(p); return; }
        const last = active.st.p[active.st.p.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5) {
          active.st.p.push(p); pendingPts.push(p);
        }
      });
      if (active.type === 'draw') { flushTimer = flushTimer || setTimeout(flushLive, 50); schedLive(); }
    });

    function endPointer(e) {
      if (!active || e.pointerId !== active.pid) return;
      const a = active; active = null;
      if (a.type === 'erase') {
        const ids = [...S.erasing]; S.erasing = null;
        if (ids.length) {
          applyOp({ t: 'del', page: page().id, ids });
          socket.emit('board:erase', { page: page().id, ids });
        } else redrawInk();
      } else {
        flushLive();
        delete S.live[a.st.id];
        const pg = S.pages.find(p => p.id === a.page);
        if (pg) pg.strokes.push(a.st);
        socket.emit('board:stroke', { page: a.page, stroke: a.st });
        if (pg === page()) redrawInk();
        schedLive();
      }
    }
    surface.addEventListener('pointerup', endPointer);
    surface.addEventListener('pointercancel', endPointer);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    // ── Toolbar ──
    function loadSaved() {
      socket.emit('board:saves:list', (list) => {
        savedList.innerHTML = '';
        if (!list.length) { savedList.innerHTML = '<div class="wb-empty">Nothing saved yet. Boards are saved automatically when you press Clear.</div>'; return; }
        list.forEach(item => {
          const row = document.createElement('div'); row.className = 'wb-saved-item';
          const thumb = renderToCanvas(item.bg, item.strokes, 220);
          thumb.className = 'wb-thumb';
          const meta = document.createElement('div'); meta.className = 'wb-saved-meta';
          meta.innerHTML = `<div class="wb-saved-name"></div>`;
          meta.firstChild.textContent = item.name;
          const btns = document.createElement('div'); btns.className = 'wb-saved-btns';
          const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'wb-btn'; b.textContent = label; b.onclick = fn; btns.appendChild(b); };
          mk('Download PNG', () => {
            renderToCanvas(item.bg, item.strokes, 1600).toBlob(blob => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'Whiteboard ' + item.name.replace(/[^\w\- ]+/g, '-') + '.png';
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            });
          });
          mk('Add as page', () => { socket.emit('board:save:restore', item.id); savedPanel.hidden = true; });
          mk('Delete', () => { if (confirm('Delete this saved board?')) socket.emit('board:save:delete', item.id); });
          meta.appendChild(btns);
          row.append(thumb, meta);
          savedList.appendChild(row);
        });
      });
    }

    const onClick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const pg = page();
      if (b.dataset.mode) { socket.emit('board:mode', b.dataset.mode); return; }
      if (b.dataset.color !== undefined) { S.tool = 'pen'; S.color = +b.dataset.color; updateUI(); return; }
      if (b.dataset.size !== undefined) { S.size = +b.dataset.size; if (S.tool !== 'pen') S.tool = 'pen'; updateUI(); return; }
      if (b.dataset.tool) { S.tool = S.tool === b.dataset.tool ? 'pen' : b.dataset.tool; updateUI(); return; }
      switch (b.dataset.act) {
        case 'undo': if (pg) socket.emit('board:undo', { page: pg.id }); break;
        case 'redo': if (pg) socket.emit('board:redo', { page: pg.id }); break;
        case 'prev': socket.emit('board:cur', S.cur - 1); break;
        case 'next': socket.emit(S.cur >= S.pages.length - 1 ? 'board:pageAdd' : 'board:cur', S.cur + 1); break;
        case 'bg': if (pg) socket.emit('board:bg', { page: pg.id, bg: BG_NEXT[pg.bg] || 'grid' }); break;
        case 'del':
          if (pg && S.pages.length > 1 && confirm('Delete this page? Anything on it is saved first.')) socket.emit('board:pageDel', { page: pg.id, name: stamp() });
          break;
        case 'clear': if (pg && pg.strokes.length) socket.emit('board:clear', { page: pg.id, name: stamp() }); break;
        case 'saved': savedPanel.hidden = false; loadSaved(); break;
        case 'saved-close': savedPanel.hidden = true; break;
      }
    };
    host.addEventListener('click', onClick);
    if (barHost) bar.addEventListener('click', onClick);

    if (window.ResizeObserver) { const ro = new ResizeObserver(() => redrawAll()); ro.observe(stage); if (!barHost) ro.observe(bar); }
    updateUI();
    return { refresh: redrawAll, getMode: () => S.mode };
  }

  window.Whiteboard = { create };
})();
