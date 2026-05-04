const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/controller', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Shared state
const state = {
  timer: { duration: 300, remaining: 300, running: false },
  pick: { name: null, animating: false },
  slides: { url: '' },
};

io.on('connection', (socket) => {
  // Send current state to newly connected client
  socket.emit('state', state);

  socket.on('timer:set', (seconds) => {
    state.timer.duration = seconds;
    state.timer.remaining = seconds;
    state.timer.running = false;
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:start', () => {
    state.timer.running = true;
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:pause', () => {
    state.timer.running = false;
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:reset', () => {
    state.timer.remaining = state.timer.duration;
    state.timer.running = false;
    io.emit('timer:update', state.timer);
  });

  socket.on('timer:tick', (remaining) => {
    state.timer.remaining = remaining;
    // Broadcast to display clients only (not back to controller)
    socket.broadcast.emit('timer:tick', remaining);
  });

  socket.on('pick:student', (name) => {
    state.pick = { name, animating: true };
    io.emit('pick:show', name);
  });

  socket.on('pick:clear', () => {
    state.pick = { name: null, animating: false };
    io.emit('pick:clear');
  });

  socket.on('slides:set', (url) => {
    state.slides.url = url;
    io.emit('slides:update', url);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nClassroom app running at:`);
  console.log(`  Controller: http://localhost:${PORT}/controller`);
  console.log(`  Display:    http://localhost:${PORT}/display`);
  console.log(`\nOn your local network, replace "localhost" with this machine's IP address.\n`);
});
