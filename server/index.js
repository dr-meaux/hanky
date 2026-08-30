/* BLOCK BRAWL — authoritative game server.
   Serves the static game on the same port it accepts websockets on, so
   `npm start` and http://localhost:8080 is the whole setup. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('../game/sim.js');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');

const TICK_MS = 1000 / 60;
const SNAP_EVERY = 3;                 /* → 20 snapshots a second */
const MAX_PLAYERS = Sim.COLORS.length;
const MAX_ROOMS = 64;
const IDLE_ROOM_MS = 5 * 60 * 1000;

/* ---------------- static files ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || file.includes('node_modules')) { res.writeHead(403); return res.end('nope'); }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
});

/* ---------------- rooms ---------------- */

const rooms = new Map();
let nextId = 1;

function roomOf(code) {
  code = String(code || 'MAIN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'MAIN';
  let r = rooms.get(code);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = { code, players: [], mode: 'coop', state: 'lobby', world: null, timer: null, tick: 0, touched: Date.now() };
    rooms.set(code, r);
  }
  r.touched = Date.now();
  return r;
}

function freeColor(room, want) {
  const taken = new Set(room.players.map(p => p.color));
  if (want && !taken.has(want) && Sim.COLORS.some(c => c.id === want)) return want;
  const open = Sim.COLORS.find(c => !taken.has(c.id));
  return open ? open.id : Sim.COLORS[0].id;
}

function send(p, msg) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const p of room.players) if (p.ws.readyState === 1) p.ws.send(s); }

function lobbyMsg(room) {
  return {
    t: 'lobby', room: room.code, mode: room.mode, state: room.state,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, host: p.host, playing: p.playing }))
  };
}
function pushLobby(room) { broadcast(room, lobbyMsg(room)); }

/* who is in the fight right now — names and colors for the renderer */
function pushRoster(room) {
  if (!room.world) return;
  broadcast(room, { t: 'roster', players: room.world.players.map(p => ({ id: p.id, name: p.name, color: p.color })) });
}

function cleanName(s) {
  /* control characters out, everything printable stays */
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 12) || 'BLOCK';
}

/* ---------------- match flow ---------------- */

function startMatch(room) {
  if (room.state === 'playing') return;
  const roster = room.players.filter(p => p.ready || p.host);
  if (!roster.length) return;
  if (room.mode === 'vs' && roster.length < 2) {
    broadcast(room, { t: 'err', msg: 'Versus needs at least two players' });
    return;
  }
  const w = Sim.createWorld(room.mode);
  room.world = w;
  room.state = 'playing';
  room.tick = 0;
  for (const p of room.players) {
    p.playing = roster.includes(p);
    if (p.playing) Sim.addPlayer(w, { id: p.id, name: p.name, color: p.color });
  }
  broadcast(room, {
    t: 'begin', mode: w.mode, bg: w.bg, plats: w.plats,
    players: w.players.map(p => ({ id: p.id, name: p.name, color: p.color }))
  });
  pushLobby(room);
  room.last = Date.now();
  room.timer = setInterval(() => tick(room), TICK_MS);
}

function endMatch(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  const result = (room.world && room.world.result) || { mode: room.mode, players: room.world ? Sim.scoreboard(room.world) : [] };
  room.state = 'lobby';
  room.world = null;
  for (const p of room.players) { p.ready = false; p.playing = false; }
  broadcast(room, { t: 'end', result });
  pushLobby(room);
}

function tick(room) {
  const w = room.world;
  if (!w) return;
  const now = Date.now();
  let dt = (now - room.last) / 1000;
  room.last = now;
  dt = Math.min(dt, 0.1);

  /* fixed steps keep physics identical no matter how the timer drifts */
  room.acc = (room.acc || 0) + dt;
  let guard = 8;
  while (room.acc >= Sim.TICK && guard-- > 0) { Sim.step(w, Sim.TICK); room.acc -= Sim.TICK; }
  if (guard <= 0) room.acc = 0;

  if (++room.tick % SNAP_EVERY === 0 || w.over) {
    broadcast(room, { t: 's', d: Sim.encode(w) });
    w.fx.length = 0;
  }
  if (w.over) endMatch(room);
  room.touched = now;
}

function dropRoom(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  rooms.delete(room.code);
}

/* ---------------- sockets ---------------- */

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

wss.on('connection', ws => {
  const p = { ws, id: nextId++, name: 'BLOCK', color: 'red', ready: false, host: false, playing: false, room: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (p.room) return;
      const room = roomOf(m.room);
      if (!room) return send(p, { t: 'err', msg: 'Too many rooms right now' });
      if (room.players.length >= MAX_PLAYERS) return send(p, { t: 'err', msg: 'That lobby is full (4 players)', fatal: true });
      p.name = cleanName(m.name);
      p.color = freeColor(room, m.color);
      p.host = room.players.length === 0;
      p.room = room;
      room.players.push(p);
      send(p, { t: 'welcome', id: p.id, room: room.code, colors: Sim.COLORS, max: MAX_PLAYERS });
      /* coop lets latecomers drop straight into the fight */
      if (room.state === 'playing' && room.world && room.world.mode === 'coop') {
        p.playing = true;
        Sim.addPlayer(room.world, { id: p.id, name: p.name, color: p.color });
        send(p, {
          t: 'begin', mode: room.world.mode, bg: room.world.bg, plats: room.world.plats,
          players: room.world.players.map(q => ({ id: q.id, name: q.name, color: q.color }))
        });
        pushRoster(room);
      } else if (room.state === 'playing') {
        send(p, { t: 'wait', msg: 'Round in progress — you are up next' });
      }
      pushLobby(room);
      return;
    }

    const room = p.room;
    if (!room) return;
    room.touched = Date.now();

    switch (m.t) {
      case 'i': {
        const w = room.world; if (!w) return;
        const sp = Sim.getPlayer(w, p.id); if (!sp) return;
        sp.in.x = Math.max(-1, Math.min(1, Number(m.x) || 0));
        sp.in.jump = !!(m.f & 1); sp.in.a1 = !!(m.f & 2); sp.in.a2 = !!(m.f & 4);
        if (m.e & 1) sp.pj = true;
        if (m.e & 2) sp.p1 = true;
        if (m.e & 4) sp.p2 = true;
        return;
      }
      case 'color': {
        if (room.state === 'playing' && p.playing) return;
        const want = String(m.color || '');
        if (!Sim.COLORS.some(c => c.id === want)) return;
        if (room.players.some(o => o !== p && o.color === want)) return;
        p.color = want; pushLobby(room); return;
      }
      case 'name': { p.name = cleanName(m.name); pushLobby(room); return; }
      case 'ready': {
        p.ready = !!m.v;
        /* readying up during a co-op round drops you straight in */
        if (p.ready && !p.playing && room.state === 'playing' && room.world && room.world.mode === 'coop') {
          p.playing = true;
          Sim.addPlayer(room.world, { id: p.id, name: p.name, color: p.color });
          send(p, {
            t: 'begin', mode: room.world.mode, bg: room.world.bg, plats: room.world.plats,
            players: room.world.players.map(q => ({ id: q.id, name: q.name, color: q.color }))
          });
          pushRoster(room);
        }
        pushLobby(room); return;
      }
      case 'mode': {
        if (!p.host || room.state === 'playing') return;
        room.mode = m.v === 'vs' ? 'vs' : 'coop';
        for (const o of room.players) o.ready = false;
        pushLobby(room); return;
      }
      case 'start': { if (p.host) startMatch(room); return; }
      case 'leave': {
        if (room.world) Sim.removePlayer(room.world, p.id);
        p.playing = false; p.ready = false;
        /* the last one to walk out ends the round */
        if (room.state === 'playing' && room.world && room.world.players.length === 0) endMatch(room);
        else pushLobby(room);
        return;
      }
      case 'p': return send(p, { t: 'pong', ts: m.ts });
    }
  });

  ws.on('close', () => {
    const room = p.room;
    if (!room) return;
    room.players = room.players.filter(o => o !== p);
    if (room.world) Sim.removePlayer(room.world, p.id);
    if (p.host && room.players.length) { room.players[0].host = true; }
    if (!room.players.length) return dropRoom(room);
    /* nobody left in the fight → wrap the round up */
    if (room.state === 'playing' && room.world && room.world.players.length === 0) endMatch(room);
    else pushLobby(room);
  });
});

/* drop dead sockets and idle empty rooms */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const room of [...rooms.values()])
    if (!room.players.length && now - room.touched > IDLE_ROOM_MS) dropRoom(room);
}, 30000);

server.listen(PORT, () => {
  console.log('BLOCK BRAWL server on http://localhost:' + PORT);
});
