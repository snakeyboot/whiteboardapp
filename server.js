const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/controller', (req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));
app.get('/display',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('');
  try {
    const target = new URL(url);
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    const contentType = r.headers.get('content-type') || 'text/html';
    const skip = new Set(['x-frame-options','content-security-policy','x-xss-protection','transfer-encoding','connection','keep-alive','content-encoding','content-length']);
    r.headers.forEach((v, k) => { if (!skip.has(k.toLowerCase())) { try { res.setHeader(k, v); } catch (_) {} } });
    res.setHeader('content-type', contentType);
    if (contentType.includes('text/html')) {
      let html = await r.text();
      // Inject <base> so relative URLs resolve against the original origin
      const base = target.href.replace(/\/[^/]*$/, '/');
      const baseTag = `<base href="${base}">`;
      // Inject anti-frame-busting script: override window.top/parent/frameElement
      // so JS frame-detection checks (window !== window.top) evaluate as false.
      const antiFrameBust = `<script>(function(){try{var d=Object.defineProperty,w=window;d(w,'top',{get:function(){return w},configurable:true});d(w,'parent',{get:function(){return w},configurable:true});d(w,'frameElement',{get:function(){return null},configurable:true});}catch(e){}}());<\/script>`;
      const headInjection = (html.includes('<base') ? '' : baseTag) + antiFrameBust;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, m => m + headInjection);
      } else {
        html = headInjection + html;
      }
      res.send(html);
    } else {
      res.send(Buffer.from(await r.arrayBuffer()));
    }
  } catch (e) {
    res.status(502).send(`<!DOCTYPE html><html><body style="background:#111;color:#475569;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;font-size:14px;flex-direction:column;gap:8px;"><span style="font-size:28px;">⚠</span><span>Could not load page</span></body></html>`);
  }
});

app.get('/api/reader', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('');
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    const html = await r.text();
    const dom  = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article) throw new Error('No article content found');

    // Rewrite links so clicking them loads the linked page in reader mode
    const contentDom = new JSDOM(`<!DOCTYPE html><html><body>${article.content}</body></html>`);
    contentDom.window.document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        a.setAttribute('href', `/api/reader?url=${encodeURIComponent(href)}`);
      }
    });
    const rewrittenContent = contentDom.window.document.body.innerHTML;

    const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(article.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{background:#0f172a;color:#cbd5e1;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.75;padding:52px 24px 80px}
    .wrap{max-width:680px;margin:0 auto}
    h1.art-title{font-size:30px;font-weight:700;color:#f1f5f9;line-height:1.3;margin-bottom:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .art-byline{font-size:13px;color:#475569;margin-bottom:4px;font-family:-apple-system,sans-serif}
    .art-src{font-size:11px;color:#334155;margin-bottom:32px;font-family:monospace;word-break:break-all}
    .art-back{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#475569;font-family:sans-serif;text-decoration:none;margin-bottom:28px;padding:4px 0;cursor:pointer}
    .art-back:hover{color:#94a3b8}
    .art-body h1,.art-body h2,.art-body h3,.art-body h4{color:#e2e8f0;margin:32px 0 12px;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .art-body h1{font-size:24px}.art-body h2{font-size:22px}.art-body h3{font-size:20px}.art-body h4{font-size:18px}
    .art-body p{margin-bottom:20px}
    .art-body a{color:#60a5fa;text-decoration:underline}
    .art-body img{max-width:100%;height:auto;border-radius:8px;margin:20px 0;display:block}
    .art-body figure{margin:20px 0}.art-body figcaption{font-size:13px;color:#64748b;margin-top:6px;font-family:sans-serif}
    .art-body blockquote{border-left:3px solid #334155;padding:4px 0 4px 18px;color:#94a3b8;margin:24px 0;font-style:italic}
    .art-body ul,.art-body ol{margin:0 0 20px 28px}.art-body li{margin-bottom:6px}
    .art-body pre{background:#0a0f1e;border:1px solid #1e293b;border-radius:8px;padding:16px;overflow-x:auto;margin:20px 0}
    .art-body code{font-family:'Courier New',monospace;font-size:15px;background:#0a0f1e;padding:2px 6px;border-radius:4px}
    .art-body pre code{background:none;padding:0}
    .art-body table{width:100%;border-collapse:collapse;margin:24px 0;font-size:16px}
    .art-body th,.art-body td{border:1px solid #1e293b;padding:9px 13px;text-align:left}
    .art-body th{background:#1e293b;color:#e2e8f0;font-family:sans-serif}
    .art-body hr{border:none;border-top:1px solid #1e293b;margin:32px 0}
  </style>
</head>
<body>
  <div class="wrap">
    <a class="art-back" onclick="history.length>1&&history.back()" href="javascript:void(0)">&#8592; Back</a>
    <h1 class="art-title">${esc(article.title)}</h1>
    ${article.byline ? `<div class="art-byline">${esc(article.byline)}</div>` : ''}
    <div class="art-src">${esc(url)}</div>
    <div class="art-body">${rewrittenContent}</div>
  </div>
</body>
</html>`);
  } catch (e) {
    res.status(502).send(`<!DOCTYPE html><html><body style="background:#0f172a;color:#475569;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;font-size:14px;flex-direction:column;gap:8px;"><span style="font-size:28px;">⚠</span><span>Could not extract article content</span><span style="font-size:11px;margin-top:4px">${e.message}</span></body></html>`);
  }
});

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

app.get('/api/define', async (req, res) => {
  const { word } = req.query;
  if (!word) return res.json({ definition: '', partOfSpeech: '' });
  try {
    const r = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim().toLowerCase())}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return res.json({ definition: '', partOfSpeech: '' });
    const data = await r.json();
    const meaning = data?.[0]?.meanings?.[0];
    const definition  = meaning?.definitions?.[0]?.definition || '';
    const partOfSpeech = meaning?.partOfSpeech || '';
    res.json({ definition, partOfSpeech });
  } catch {
    res.json({ definition: '', partOfSpeech: '' });
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS word_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      words TEXT DEFAULT '[]'
    )
  `);
  await pool.query(`ALTER TABLE rosters ADD COLUMN IF NOT EXISTS word_wall TEXT DEFAULT '[]'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
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

async function getAllWordLists() {
  const { rows } = await pool.query('SELECT * FROM word_lists ORDER BY name');
  return rows.map(r => ({ id: r.id, name: r.name, words: r.words }));
}

async function getAllPresets() {
  const { rows } = await pool.query('SELECT * FROM material_presets ORDER BY name');
  return rows.map(r => ({ id: r.id, name: r.name, materials: r.materials }));
}

async function getAllRosters() {
  const { rows } = await pool.query('SELECT * FROM rosters ORDER BY sort_order, name');
  const out = {};
  rows.forEach(r => { out[r.id] = { name: r.name, students: r.students, slidesUrl: r.slides_url, grades: r.grades || '{}', materials: r.materials || '[]', wordWall: r.word_wall || '[]' }; });
  return out;
}

function parseStudents(raw) {
  if (!raw) return [];
  const base = { firstName:'', lastName:'', attendance:'present', anchor:false, enl:false, introvert:false, gender:'', conflict:'', distractor:false, picks:0, lexile:'' };
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

// ── Spotify ────────────────────────────────────────────────
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI
  || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/auth/spotify/callback`
    : 'https://whiteboardapp-production-744e.up.railway.app/auth/spotify/callback');

let spotifyTokens      = null; // { accessToken, refreshToken, expiresAt }
let spotifyPlayerState = null;
let spotifyDeviceId    = null; // display Web Playback SDK device_id
let spotifyPollInterval = null;

async function loadSpotifyTokens() {
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key='spotify_tokens'");
    if (rows.length && rows[0].value) {
      spotifyTokens = JSON.parse(rows[0].value);
      console.log('Spotify tokens loaded from DB');
    }
  } catch (e) { console.error('loadSpotifyTokens', e); }
}

async function saveSpotifyTokens(tokens) {
  spotifyTokens = tokens;
  try {
    await pool.query(
      "INSERT INTO app_config (key,value) VALUES ('spotify_tokens',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [JSON.stringify(tokens)]
    );
  } catch (e) { console.error('saveSpotifyTokens', e); }
}

async function getSpotifyToken() {
  if (!spotifyTokens) return null;
  if (Date.now() >= (spotifyTokens.expiresAt - 60000)) {
    try {
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: spotifyTokens.refreshToken,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('refresh status ' + r.status);
      const d = await r.json();
      await saveSpotifyTokens({
        accessToken:  d.access_token,
        refreshToken: d.refresh_token || spotifyTokens.refreshToken,
        expiresAt:    Date.now() + (d.expires_in * 1000),
      });
    } catch (e) { console.error('spotify token refresh', e); return null; }
  }
  return spotifyTokens.accessToken;
}

async function spotifyFetch(path, options = {}) {
  const token = await getSpotifyToken();
  if (!token) return null;
  try {
    const r = await fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 204 || r.status === 202) return {};
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function pollSpotify() {
  try {
    const data = await spotifyFetch('/me/player?additional_types=track');
    if (data && data.item) {
      const track = data.item;
      spotifyPlayerState = {
        isPlaying:    !!data.is_playing,
        trackName:    track.name,
        artistName:   (track.artists || []).map(a => a.name).join(', '),
        albumName:    track.album?.name || '',
        albumArt:     track.album?.images?.[0]?.url || '',
        albumArtMed:  track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
        albumArtSmall:track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || '',
        duration:     track.duration_ms || 0,
        progress:     data.progress_ms  || 0,
        volume:       data.device?.volume_percent ?? 50,
        deviceId:     data.device?.id   || '',
        deviceName:   data.device?.name || '',
        uri:          track.uri,
      };
      io.emit('spotify:player', spotifyPlayerState);
    } else if (data !== null && data !== undefined) {
      spotifyPlayerState = null;
      io.emit('spotify:player', null);
    }
  } catch { /* ignore */ }
}

function startSpotifyPoll() {
  if (spotifyPollInterval) return;
  spotifyPollInterval = setInterval(pollSpotify, 3000);
}

// ── Spotify OAuth routes ────────────────────────────────────
app.get('/auth/spotify', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return res.status(500).send('SPOTIFY_CLIENT_ID env var not set. Add it in Railway.');
  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    scope,
    redirect_uri:  SPOTIFY_REDIRECT_URI,
    state:         Math.random().toString(36).slice(2),
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/auth/spotify/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/controller?spotify=error');
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    await saveSpotifyTokens({
      accessToken:  d.access_token,
      refreshToken: d.refresh_token,
      expiresAt:    Date.now() + (d.expires_in * 1000),
    });
    io.emit('spotify:connected', true);
    startSpotifyPoll();
    res.redirect('/controller?spotify=connected');
  } catch (e) {
    console.error('spotify callback error', e);
    res.redirect('/controller?spotify=error');
  }
});

app.get('/api/spotify/token', async (req, res) => {
  const token = await getSpotifyToken();
  if (!token) return res.status(401).json({ error: 'Not connected' });
  res.json({ token });
});

app.get('/api/spotify/playlists', async (req, res) => {
  const data = await spotifyFetch('/me/playlists?limit=50');
  if (!data) return res.status(401).json({ error: 'Not connected' });
  res.json(data);
});

app.get('/api/spotify/queue', async (req, res) => {
  const data = await spotifyFetch('/me/player/queue');
  if (!data) return res.status(401).json({ error: 'Not connected' });
  res.json(data);
});

// ── Session state ─────────────────────────────────────────
const state = {
  timer: { duration: 120, remaining: 120, running: false },
  pick: { name: null },
  slides: { url: '', slide: 1 },
  activeRosterId: null,
  activeRosterName: '',
  wordWall: { words: [], listName: '' },
  forcedGroups: {},    // rosterId → [[name,…],…] | deleted key = none
  lastGroupResult: null, // [[name,…],…] — last confirmed groups from display
  award: { mode: 'sotd', names: [], active: false, revealed: false },
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
  // Restore word wall from the active roster's DB row (survives server restarts)
  if (state.activeRosterId && rosters[state.activeRosterId]) {
    try {
      const ww = JSON.parse(rosters[state.activeRosterId].wordWall || '[]');
      state.wordWall = { words: ww, listName: '' };
    } catch {}
  }
  socket.emit('state', { ...state, rosters, deckRemaining: pickDeck.length, deckTotal });
  socket.emit('presets:all', await getAllPresets());
  socket.emit('wordlists:all', await getAllWordLists());
  socket.emit('wordwall:update', state.wordWall);

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
      if (changed) {
        try {
          const ww = JSON.parse(rosters[id]?.wordWall || '[]');
          state.wordWall = { words: ww, listName: '' };
          io.emit('wordwall:update', state.wordWall);
        } catch {}
      }
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
    // Do NOT emit slides:navigate — preserve existing iframe position
  });

  socket.on('material:reload', (url) => {
    io.emit('material:reload', url);
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

  // ── Word Wall ──
  socket.on('wordwall:set-words', async (payload) => {
    state.wordWall = { words: payload.words || [], listName: payload.listName || '' };
    io.emit('wordwall:update', state.wordWall);
    if (state.activeRosterId) {
      try {
        await pool.query('UPDATE rosters SET word_wall=$1 WHERE id=$2',
          [JSON.stringify(payload.words || []), state.activeRosterId]);
      } catch (e) { console.error('wordwall persist', e); }
    }
  });

  socket.on('wordwall:save-list', async ({ id, name, words }) => {
    try {
      await pool.query(
        `INSERT INTO word_lists (id,name,words) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name=$2, words=$3`,
        [id, name, words]
      );
      io.emit('wordlists:all', await getAllWordLists());
    } catch (e) { console.error('wordwall:save-list', e); }
  });

  socket.on('wordwall:delete-list', async (id) => {
    try {
      await pool.query('DELETE FROM word_lists WHERE id=$1', [id]);
      io.emit('wordlists:all', await getAllWordLists());
    } catch (e) { console.error('wordwall:delete-list', e); }
  });

  // ── Spotify ──
  // ── Forced Groups ──
  socket.emit('groups:forced:all', state.forcedGroups);
  if (state.lastGroupResult) socket.emit('groups:result', state.lastGroupResult);

  // ── Awards ──
  socket.emit('award:state', state.award);
  socket.on('award:launch', (data) => {
    state.award = { ...data, active: true, revealed: false };
    io.emit('award:launch', state.award);
  });
  socket.on('award:reveal', () => {
    state.award.revealed = true;
    io.emit('award:reveal');
  });
  socket.on('award:close', () => {
    state.award.active = false;
    io.emit('award:close');
  });

  socket.on('groups:result', (groups) => {
    state.lastGroupResult = groups;
    io.emit('groups:result', groups);
  });

  socket.on('groups:forced:save', ({ rosterId, groups }) => {
    state.forcedGroups[rosterId] = groups;
    io.emit('groups:forced:update', { rosterId, groups });
  });

  socket.on('groups:forced:clear', ({ rosterId }) => {
    delete state.forcedGroups[rosterId];
    io.emit('groups:forced:update', { rosterId, groups: null });
  });

  socket.emit('spotify:connected', !!spotifyTokens);
  if (spotifyPlayerState) socket.emit('spotify:player', spotifyPlayerState);

  socket.on('spotify:play', async (payload) => {
    const { uri, deviceId } = payload || {};
    const body = {};
    if (uri) {
      if (uri.startsWith('spotify:track:')) body.uris = [uri];
      else body.context_uri = uri;
    }
    const qp = (deviceId || spotifyDeviceId) ? `?device_id=${deviceId || spotifyDeviceId}` : '';
    await spotifyFetch(`/me/player/play${qp}`, {
      method: 'PUT',
      body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    });
    setTimeout(pollSpotify, 600);
  });

  socket.on('spotify:pause', async () => {
    await spotifyFetch('/me/player/pause', { method: 'PUT' });
    setTimeout(pollSpotify, 600);
  });

  socket.on('spotify:next', async () => {
    await spotifyFetch('/me/player/next', { method: 'POST' });
    setTimeout(pollSpotify, 900);
  });

  socket.on('spotify:prev', async () => {
    await spotifyFetch('/me/player/previous', { method: 'POST' });
    setTimeout(pollSpotify, 900);
  });

  socket.on('spotify:volume', async (vol) => {
    await spotifyFetch(`/me/player/volume?volume_percent=${Math.round(vol)}`, { method: 'PUT' });
  });

  socket.on('spotify:seek', async (posMs) => {
    await spotifyFetch(`/me/player/seek?position_ms=${Math.round(posMs)}`, { method: 'PUT' });
    setTimeout(pollSpotify, 400);
  });

  socket.on('spotify:transfer', async (deviceId) => {
    spotifyDeviceId = deviceId;
    await spotifyFetch('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    });
    setTimeout(pollSpotify, 1200);
  });

  socket.on('spotify:device-ready', (deviceId) => {
    spotifyDeviceId = deviceId;
    io.emit('spotify:device-id', deviceId);
    console.log('Spotify display device registered:', deviceId);
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
  .then(() => loadSpotifyTokens())
  .then(() => {
    if (spotifyTokens) startSpotifyPoll();
  })
  .then(() => server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nClassroom app running:`);
    console.log(`  Controller: http://localhost:${PORT}/controller`);
    console.log(`  Display:    http://localhost:${PORT}/display\n`);
  }))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
