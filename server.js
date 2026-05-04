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

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rosters (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      students   TEXT DEFAULT '',
      slides_url TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )
  `);
  const { rows } = await pool.query('SELECT COUNT(*) FROM rosters');
  if (parseInt(rows[0].count) === 0) {
    const id = Date.now().toString(36);
    await pool.query(
      'INSERT INTO rosters (id, name, students, slides_url, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [id, 'Period 1', '', '', 0]
    );
  }
}

async function getAllRosters() {
  const { rows } = await pool.query('SELECT * FROM rosters ORDER BY sort_order, name');
  const out = {};
  rows.forEach(r => { out[r.id] = { name: r.name, students: r.students, slidesUrl: r.slides_url }; });
  return out;
}

// ── Session state ─────────────────────────────────────────
const state = {
  timer: { duration: 300, remaining: 300, running: false },
  pick:  { name: null },
  slides: { url: '' },
  activeRosterId: null,
};

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
    state.activeRosterId = Object.keys(rosters)[0] || null;
  }
  socket.emit('state', { ...state, rosters });

  // Timer
  socket.on('timer:set', (seconds) => {
    clearInterval(timerInterval);
    state.timer = { duration: seconds, remaining: seconds, running: false };
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
    state.timer.remaining = state.timer.duration;
    state.timer.running = false;
    io.emit('timer:update', state.timer);
  });

  // Picker — server picks from active roster
  socket.on('pick:random', async () => {
    const rosters = await getAllRosters();
    const roster = rosters[state.activeRosterId];
    if (!roster) return;
    const names = roster.students.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) return;
    const name = names[Math.floor(Math.random() * names.length)];
    state.pick.name = name;
    io.emit('pick:show', name);
  });

  socket.on('pick:clear', () => {
    state.pick.name = null;
    io.emit('pick:clear');
  });

  // Rosters
  socket.on('roster:save', async ({ id, name, students, slidesUrl, sortOrder }) => {
    await pool.query(`
      INSERT INTO rosters (id, name, students, slides_url, sort_order)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET name=$2, students=$3, slides_url=$4, sort_order=$5
    `, [id, name, students, slidesUrl || '', sortOrder || 0]);
    const updated = await getAllRosters();
    io.emit('roster:all', updated);
  });

  socket.on('roster:delete', async (id) => {
    await pool.query('DELETE FROM rosters WHERE id=$1', [id]);
    const updated = await getAllRosters();
    if (!updated[state.activeRosterId]) {
      state.activeRosterId = Object.keys(updated)[0] || null;
    }
    io.emit('roster:all', updated);
    io.emit('roster:activated', state.activeRosterId);
  });

  socket.on('roster:activate', (id) => {
    state.activeRosterId = id;
    io.emit('roster:activated', id);
  });

  // Slides
  socket.on('slides:push', (url) => {
    state.slides.url = url;
    io.emit('slides:update', url);
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
