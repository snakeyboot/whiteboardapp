const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/controller', (req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));
app.get('/display',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

app.get('/api/fetch-title', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ title: '' });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const raw = m ? m[1].trim() : '';
    // Google appends " - Google Slides / Docs / Drive" — strip it
    const title = raw.replace(/\s*[-–—]\s*Google (Slides|Docs|Drive|Sheets|Forms)$/i, '').trim();
    res.json({ title });
  } catch {
    res.json({ title: '' });
  }
});

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rosters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      students TEXT DEFAULT '[]',
      slides_url TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )
  `);
  await pool.query(`ALTER TABLE rosters ADD COLUMN IF NOT EXISTS grades TEXT DEFAULT '{}'`);
  await pool.query(`ALTER TABLE rosters ADD COLUMN IF NOT EXISTS materials TEXT DEFAULT '[]'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      materials TEXT DEFAULT '[]'
    )
  `);
  const { rows } = await pool.query('SELECT COUNT(*) FROM rosters');
  if (parseInt(rows[0].count) === 0) {
    const id = Date.now().toString(36);
    await pool.query(
      'INSERT INTO rosters (id,name,students,slides_url,sort_order) VALUES ($1,$2,$3,$4,$5)',
      [id, 'Period 1', '[]', '', 0]
    );
  }
}

async function getAllPresets() {
  const { rows } = await pool.query('SELECT * FROM material_presets ORDER BY name');
  return rows.map(r => ({ id: r.id, name: r.name, materials: r.materials }));
}

async function getAllRosters() {
  const { rows } = await pool.query('SELECT * FROM rosters ORDER BY sort_order, name');
  const out = {};
  rows.forEach(r => { out[r.id] = { name: r.name, students: r.students, slidesUrl: r.slides_url, grades: r.grades || '{}', materials: r.materials || '[]' }; });
  return out;
}

function parseStudents(raw) {
  if (!raw) return [];
  const base = { firstName:'', lastName:'', attendance:'present', anchor:false, enl:false, introvert:false, gender:'', conflict:'', distractor:false, picks:0 };
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map(s => {
      if (typeof s === 'string') {
        const w = s.trim().split(/\s+/);
        return { ...base, firstName: w[0]||'', lastName: w.slice(1).join(' ') };
      }
      let student;
      if (s.name && !s.firstName) {
        const w = (s.name||'').trim().split(/\s+/);
        student = { ...base, firstName: w[0]||'', lastName: w.slice(1).join(' '), ...s };
      } else {
        student = { ...base, ...s };
      }
      // Migrate old present:false → attendance:absent
      if (s.present === false && !s.attendance) student.attendance = 'absent';
      return student;
    });
  } catch {}
  return raw.split('\n').map(s => s.trim()).filter(Boolean).map(name => {
    const w = name.split(/\s+/);
    return { ...base, firstName: w[0]||'', lastName: w.slice(1).join(' ') };
  });
}

function fullName(s) {
  if (!s) return '';
  if (s.firstName || s.lastName) return [s.firstName, s.lastName].filter(Boolean).join(' ');
  return s.name || '';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Session state ─────────────────────────────────────────
const state = {
  timer: { duration: 120, remaining: 120, running: false },
  pick: { name: null },
  slides: { url: '', slide: 1 },
  activeRosterId: null,
  activeRosterName: '',
};

// Deck — shuffled list ensuring no repeats until everyone is called
let pickDeck  = [];
let deckTotal = 0;

async function buildDeck(rosterId) {
  try {
    const rosters = await getAllRosters();
    const roster  = rosters[rosterId];
    if (!roster) { pickDeck = []; deckTotal = 0; }
    else {
      const present = parseStudents(roster.students).filter(s => (s.attendance || 'present') !== 'absent').map(s => fullName(s));
      pickDeck  = shuffle(present);
      deckTotal = present.length;
    }
  } catch (e) { console.error('buildDeck', e); pickDeck = []; deckTotal = 0; }
  io.emit('deck:update', { remaining: pickDeck.length, total: deckTotal });
}

// ── Server-side timer ─────────────────────────────────────
let timerInterval = null;

function startTicking() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (state.timer.remaining > 0) {
      state.timer.remaining--;
      io.emit('timer:tick', state.timer.remaining);
    } else {
      state.timer.running = false;
      clearInterval(timerInterval);
      io.emit('timer:done');
      io.emit('timer:update', state.timer);
    }
  }, 1000);
}

// ── Sockets ───────────────────────────────────────────────
io.on('connection', async (socket) => {
  const rosters = await getAllRosters();
  if (!state.activeRosterId || !rosters[state.activeRosterId]) {
    state.activeRosterId   = Object.keys(rosters)[0] || null;
    state.activeRosterName = state.activeRosterId ? (rosters[state.activeRosterId]?.name || '') : '';
    if (state.activeRosterId && pickDeck.length === 0) await buildDeck(state.activeRosterId);
  }
  socket.emit('state', { ...state, rosters, deckRemaining: pickDeck.length, deckTotal });
  socket.emit('presets:all', await getAllPresets());

  // ── Timer ──
  socket.on('timer:set', (seconds) => {
    clearInterval(timerInterval);
    state.timer = { duration: seconds, remaining: seconds, running: false };
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:set-start', (seconds) => {
    clearInterval(timerInterval);
    state.timer = { duration: seconds, remaining: seconds, running: true };
    io.emit('timer:update', state.timer);
    startTicking();
  });

  socket.on('timer:add', (seconds) => {
    state.timer.remaining = Math.max(0, state.timer.remaining + seconds);
    if (state.timer.remaining > state.timer.duration) state.timer.duration = state.timer.remaining;
    if (state.timer.running) { clearInterval(timerInterval); startTicking(); }
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:start', () => {
    if (state.timer.remaining <= 0) return;
    state.timer.running = true;
    io.emit('timer:update', state.timer);
    startTicking();
  });

  socket.on('timer:pause', () => {
    state.timer.running = false;
    clearInterval(timerInterval);
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:reset', () => {
    clearInterval(timerInterval);
    state.timer.remaining = 0;
    state.timer.running   = false;
    io.emit('timer:update', state.timer);
  });

  // ── Picker (deck shuffle — no repeats until everyone called) ──
  socket.on('pick:random', async () => {
    try {
      const rosters = await getAllRosters();
      const roster  = rosters[state.activeRosterId];
      if (!roster) { socket.emit('pick:error', 'No active class.'); return; }

      const presentSet = new Set(
        parseStudents(roster.students).filter(s => (s.attendance || 'present') !== 'absent').map(s => fullName(s))
      );
      if (presentSet.size === 0) { socket.emit('pick:error', 'No students are marked present.'); return; }

      // Remove newly-absent students from deck
      pickDeck = pickDeck.filter(n => presentSet.has(n));

      // Rebuild deck when exhausted
      if (pickDeck.length === 0) {
        pickDeck  = shuffle([...presentSet]);
        deckTotal = pickDeck.length;
      }

      const name = pickDeck.pop();
      state.pick.name = name;

      // Track pick count on the student object
      const allStudents = parseStudents(roster.students);
      const updated = allStudents.map(s => fullName(s) === name ? { ...s, picks: (s.picks || 0) + 1 } : s);
      await pool.query('UPDATE rosters SET students=$1 WHERE id=$2', [JSON.stringify(updated), state.activeRosterId]);

      io.emit('pick:show', name);
      io.emit('deck:update', { remaining: pickDeck.length, total: deckTotal });
      io.emit('pick:stats', { rosterId: state.activeRosterId, students: JSON.stringify(updated) });
    } catch (e) { console.error('pick:random', e); }
  });

  socket.on('pick:reset-deck', async () => { await buildDeck(state.activeRosterId); });

  socket.on('pick:reset-stats', async () => {
    try {
      const rosters = await getAllRosters();
      const roster  = rosters[state.activeRosterId];
      if (!roster) return;
      const allStudents = parseStudents(roster.students).map(s => ({ ...s, picks: 0 }));
      await pool.query('UPDATE rosters SET students=$1 WHERE id=$2', [JSON.stringify(allStudents), state.activeRosterId]);
      io.emit('pick:stats', { rosterId: state.activeRosterId, students: JSON.stringify(allStudents) });
    } catch (e) { console.error('pick:reset-stats', e); }
  });

  socket.on('pick:clear', () => {
    state.pick.name = null;
    io.emit('pick:clear');
  });

  // ── Rosters ──
  socket.on('roster:save', async ({ id, name, students, slidesUrl, sortOrder, materials }) => {
    try {
      await pool.query(`
        INSERT INTO rosters (id,name,students,slides_url,sort_order,materials)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name=$2,students=$3,slides_url=$4,sort_order=$5,materials=$6
      `, [id, name, students, slidesUrl || '', sortOrder || 0, materials || '[]']);
      const updated = await getAllRosters();
      io.emit('roster:all', updated);
    } catch (e) {
      console.error('roster:save', e);
      socket.emit('roster:error', 'Failed to save.');
    }
  });

  socket.on('roster:delete', async (id) => {
    try {
      await pool.query('DELETE FROM rosters WHERE id=$1', [id]);
      const updated = await getAllRosters();
      if (!updated[state.activeRosterId]) {
        state.activeRosterId   = Object.keys(updated)[0] || null;
        state.activeRosterName = state.activeRosterId ? (updated[state.activeRosterId]?.name || '') : '';
        await buildDeck(state.activeRosterId);
      }
      io.emit('roster:all', updated);
      io.emit('roster:activated', { id: state.activeRosterId, name: state.activeRosterName });
    } catch (e) { console.error('roster:delete', e); }
  });

  socket.on('roster:activate', async (id) => {
    const changed = id !== state.activeRosterId;
    state.activeRosterId = id;
    try {
      const rosters = await getAllRosters();
      state.activeRosterName = rosters[id]?.name || '';
    } catch {}
    if (changed) await buildDeck(id);
    io.emit('roster:activated', { id, name: state.activeRosterName });
  });

  // ── Grades ──
  socket.on('grades:save', async ({ id, grades }) => {
    try {
      await pool.query('UPDATE rosters SET grades=$1 WHERE id=$2', [grades, id]);
    } catch (e) { console.error('grades:save', e); }
  });

  // ── Slides ──
  socket.on('slides:push', (url) => {
    state.slides.url   = url;
    state.slides.slide = 1;
    io.emit('slides:update', url);
    io.emit('slides:navigate', 1);
  });

  socket.on('slides:prev', () => {
    if (state.slides.slide > 1) state.slides.slide--;
    io.emit('slides:navigate', state.slides.slide);
  });

  socket.on('slides:next', () => {
    state.slides.slide++;
    io.emit('slides:navigate', state.slides.slide);
  });

  // ── Material Presets ──
  socket.on('presets:save', async ({ id, name, materials }) => {
    try {
      await pool.query(
        `INSERT INTO material_presets (id,name,materials) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name=$2, materials=$3`,
        [id, name, materials]
      );
      io.emit('presets:all', await getAllPresets());
    } catch (e) { console.error('presets:save', e); }
  });

  socket.on('presets:delete', async (id) => {
    try {
      await pool.query('DELETE FROM material_presets WHERE id=$1', [id]);
      io.emit('presets:all', await getAllPresets());
    } catch (e) { console.error('presets:delete', e); }
  });

  // ── Force Pick ──
  socket.on('pick:force', async (name) => {
    try {
      const rosters = await getAllRosters();
      const roster  = rosters[state.activeRosterId];
      if (!roster) return;
      state.pick.name = name;
      const allStudents = parseStudents(roster.students);
      const updated = allStudents.map(s => fullName(s) === name ? { ...s, picks: (s.picks||0)+1 } : s);
      await pool.query('UPDATE rosters SET students=$1 WHERE id=$2', [JSON.stringify(updated), state.activeRosterId]);
      pickDeck = pickDeck.filter(n => n !== name);
      io.emit('pick:show', name);
      io.emit('deck:update', { remaining: pickDeck.length, total: deckTotal });
      io.emit('pick:stats', { rosterId: state.activeRosterId, students: JSON.stringify(updated) });
    } catch (e) { console.error('pick:force', e); }
  });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
initDB()
  .then(() => server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nClassroom app running:`);
    console.log(`  Controller: http://localhost:${PORT}/controller`);
    console.log(`  Display:    http://localhost:${PORT}/display\n`);
  }))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
