/* HANKY — screens, lobby, and the loop that ties input, net and
   rendering together. Solo play runs the simulation locally; online play
   renders the server's world, interpolated, with your own block predicted
   locally so the stick still feels immediate. */
(function () {
'use strict';

const S = Sim;
const $ = id => document.getElementById(id);

const DELAY = 0.12;          /* render this far behind the server, for smooth interpolation */
const SEND_HZ = 30;

const overlay = $('overlay'), quitBtn = $('quit'), netInfo = $('netInfo');
const SCREENS = ['scrName', 'scrLobby', 'scrOver', 'scrBusy', 'scrStory', 'scrChapter'];

let phase = 'name';        /* name | busy | lobby | play | over | story | chapter */
let story = false;         /* the campaign is running, not the arena */
let online = false;
let world = null;                          /* solo: the real simulation */
let acc = 0;
let menu = S.createWorld('coop');          /* empty arena behind the menus */

let statics = { plats: menu.plats, bg: menu.bg };
let snaps = [], renderTime = 0, roster = {};
let pred = null, predWorld = null, predTele = -1, predLock = false;
let pendEdges = { jump: false, a1: false, a2: false }, sendAcc = 0;
let lobby = { players: [], mode: 'coop', state: 'lobby', room: '' };
let lastResult = null, waitMsg = '';

/* ---------------- screens ---------------- */

function show(which) {
  for (const id of SCREENS) $(id).hidden = (id !== which);
  overlay.classList.remove('hide');
  document.body.classList.add('hideControls');
  quitBtn.hidden = true;
  showUse(false);
}

/* the TALK button belongs to the story and nothing else; .btn carries
   display:grid, so the attribute alone would not hide it */
function showUse(on, label) {
  const el = $('bUse');
  el.style.display = on ? 'grid' : 'none';
  if (on && label) el.textContent = label;
}
function showGame() {
  overlay.classList.add('hide');
  document.body.classList.remove('hideControls');
  quitBtn.hidden = false;
  quitBtn.textContent = story ? 'CHAPTERS' : online ? 'LOBBY' : 'MENU';
  showUse(false);
}
/* the attack buttons wear your color, so you always know which block is you */
function paintControls(colorId) {
  const c = S.colorOf(colorId);
  $('bA1').style.background = c.body;
  $('bA2').style.background = c.dark;
}
function busy(title, msg, back) {
  $('busyTitle').textContent = title;
  $('busyMsg').textContent = msg;
  $('bBusyBack').hidden = !back;
  phase = 'busy'; show('scrBusy');
}

/* ---------------- solo ---------------- */

function startSolo() {
  online = false; story = false;
  Story.stop();
  Net.disconnect();
  world = S.createWorld('coop');
  S.addPlayer(world, { id: 1, name: nameField(), color: 'red' });
  paintControls('red');
  acc = 0;
  Render.reset();
  phase = 'play';
  showGame();
}

function stepSolo(dt, edges) {
  const p = world.players[0];
  if (p) {
    p.in.x = Input.state.x; p.in.jump = Input.state.jump; p.in.a1 = Input.state.a1; p.in.a2 = Input.state.a2;
    if (edges.jump) p.pj = true;
    if (edges.a1) p.p1 = true;
    if (edges.a2) p.p2 = true;
  }
  acc += dt;
  let guard = 8;
  while (acc >= S.TICK && guard-- > 0) { S.step(world, S.TICK); acc -= S.TICK; }
  if (guard <= 0) acc = 0;
  Render.fx(world.fx, p ? p.id : 0); world.fx.length = 0;
  if (world.over) { lastResult = world.result; showResult(); }
  return { view: world, me: p };
}

/* ---------------- story ---------------- */

/* The campaign is single player and entirely local: Story owns the world,
   main just hands it input and paints whatever it gives back. */
function openStory() {
  online = false; story = false;
  Net.disconnect();
  Story.stop();
  phase = 'story'; show('scrStory');
  drawChapters();
}

function drawChapters() {
  const list = $('storyList');
  list.innerHTML = '';
  const open = Story.unlocked();
  for (const area of Story.AREAS) {
    const box = document.createElement('div');
    box.className = 'chapter';
    const h = document.createElement('b');
    h.textContent = area.name;
    const s = document.createElement('span');
    s.textContent = area.blurb;
    box.append(h, s);
    const row = document.createElement('div');
    row.className = 'levels';
    for (const entry of Story.LEVELS.filter(e => e.area === area)) {
      const b = document.createElement('button');
      const locked = entry.flat > open;
      b.className = 'lvl' + (locked ? ' locked' : '') + (entry.flat === open ? ' next' : '');
      b.textContent = locked ? '🔒' : entry.level.name;
      b.disabled = locked;
      b.onclick = () => playLevel(entry.areaIdx, entry.levelIdx);
      row.append(b);
    }
    box.append(row);
    list.append(box);
  }
  $('storySub').textContent = open >= Story.LEVELS.length - 1
    ? 'The whole story is open. Play any part of it again.'
    : 'The first tank that ever stood up.';
}

function playLevel(ai, li) {
  Story.start(ai, li);
  story = true; online = false;
  paintControls('red');
  Render.reset();
  phase = 'play';
  showGame();
}

function stepStory(dt, edges) {
  /* the interact button doubles as "next line" while someone is talking */
  if (edges.use) Story.interact();
  const out = Story.step(dt, edges, Input.state);
  if (!out) return null;

  const t = Story.talking() ? null : Story.target();
  if (Story.talking()) showUse(true, 'NEXT');
  else if (t) showUse(true, t.label);
  else showUse(false);

  Render.fx(out.fx, out.me ? out.me.id : 0); out.fx.length = 0;
  if (Story.done()) showChapterEnd();
  return { view: out.view, me: out.me };
}

function showChapterEnd() {
  const st = Story.current(), nxt = Story.nextEntry();
  $('chTitle').textContent = st.level.end || (st.level.name + ' — DONE');
  $('chSub').textContent = nxt
    ? 'Next: ' + nxt.area.name + ' · ' + nxt.level.name
    : 'That is the whole story. Hanky stood, and then so did everybody else.';
  $('bChNext').hidden = !nxt;
  $('bChNext').onclick = () => { if (nxt) playLevel(nxt.areaIdx, nxt.levelIdx); };
  $('bChRetry').onclick = () => playLevel(st.entry.areaIdx, st.entry.levelIdx);
  phase = 'chapter'; show('scrChapter');
}

/* ---------------- online ---------------- */

function nameField() { return ($('fName').value || '').trim().slice(0, 12) || 'BLOCK'; }

function joinLobby() {
  const name = nameField(), room = ($('fRoom').value || 'MAIN').trim().toUpperCase() || 'MAIN';
  const server = $('fServer').value.trim();
  Net.store.set('bb.name', name);
  Net.store.set('bb.room', room);
  if (!server) { busy('NO SERVER', 'Enter the address of a HANKY server, or play solo.', true); return; }
  online = true; story = false;
  Story.stop();
  busy('CONNECTING', 'Reaching ' + Net.normalize(server) + '…', true);
  Net.connect(server, { name, room, color: Net.store.get('bb.color') });
}

Net.on('welcome', m => {
  lobby.room = m.room;
  phase = 'lobby'; show('scrLobby');
})
.on('lobby', m => {
  lobby = { players: m.players, mode: m.mode, state: m.state, room: m.room };
  const mine = m.players.find(p => p.id === Net.id);
  if (mine) Net.store.set('bb.color', mine.color);
  if (phase === 'lobby' || phase === 'busy') { phase = 'lobby'; show('scrLobby'); }
  drawLobby();
})
.on('begin', m => {
  statics = { plats: m.plats, bg: m.bg };
  roster = {};
  for (const p of m.players) roster[p.id] = p;
  snaps = []; renderTime = 0; pred = null; predTele = -1; predLock = false;
  predWorld = { plats: m.plats, WW: S.WW, WH: S.WH, bullets: [], fx: [], players: [], mode: m.mode };
  waitMsg = '';
  const mine = m.players.find(p => p.id === Net.id);
  paintControls(mine ? mine.color : 'red');
  Render.reset();
  phase = 'play';
  showGame();
})
.on('roster', m => { for (const p of m.players) roster[p.id] = p; })
.on('wait', m => { waitMsg = m.msg || ''; drawLobby(); })
.on('s', m => {
  const d = S.decode(m.d);
  d.flushed = false;
  snaps.push(d);
  if (snaps.length > 24) snaps.shift();
  if (!renderTime) renderTime = d.time - DELAY;
  reconcile(d);
})
.on('end', m => { if (phase !== 'play') return; lastResult = m.result; showResult(); })
.on('err', m => {
  if (m.fatal) { busy('NO ROOM', m.msg, true); Net.disconnect(); }
  else { waitMsg = m.msg; drawLobby(); }
})
.on('close', () => {
  if (!online) return;
  if (phase === 'play' || phase === 'lobby' || phase === 'busy')
    busy('DISCONNECTED', 'Lost the server. Check the address and try again.', true);
})
.on('error', msg => { if (phase === 'busy' || phase === 'lobby') busy('NO CONNECTION', msg + '.', true); });

/* --- prediction: your own block moves the instant you press, then eases
       back onto whatever the server says is true --- */

function initPred(sp) {
  pred = {
    x: sp.x, y: sp.y, w: 26, h: 46, vx: sp.vx, vy: 0, face: sp.face, aim: sp.aim,
    onGround: sp.onGround, jumps: 2, tilt: sp.tilt, walk: sp.walk,
    shootT: sp.shootT, melee: sp.melee, meleeT: sp.meleeT, hitDone: true,
    cd1: 0, cd2: 0, dance: sp.dance, cheer: sp.cheer, danceLock: false,
    iframe: sp.iframe, hurtFlash: sp.hurtFlash, hp: sp.hp, maxHp: 100,
    in: { x: 0, jump: false, a1: false, a2: false }
  };
}

function reconcile(d) {
  const sp = d.players.find(p => p.id === Net.id);
  if (!sp) { pred = null; return; }
  /* pinned or busy behind someone: the server owns you until it lets go */
  predLock = sp.taunt > 0 || sp.held > 0;
  if (!pred || sp.teleport !== predTele || sp.dead || sp.out || predLock) { initPred(sp); predTele = sp.teleport; return; }
  const dx = sp.x - pred.x, dy = sp.y - pred.y, err = Math.hypot(dx, dy);
  if (err > 140) { pred.x = sp.x; pred.y = sp.y; pred.vx = sp.vx; pred.vy = 0; }
  else if (err > 16) { pred.x += dx * 0.16; pred.y += dy * 0.16; }
}

function predict(dt, edges) {
  if (!pred || !predWorld || predLock) return;
  predWorld.bullets.length = 0; predWorld.fx.length = 0;   /* the server owns bullets and sparks */
  pred.in.x = Input.state.x; pred.in.jump = Input.state.jump;
  pred.in.a1 = Input.state.a1; pred.in.a2 = Input.state.a2;
  S.movePlayer(predWorld, pred, dt, { jump: edges.jump, a1: edges.a1, a2: edges.a2 });
  if (pred.melee) { pred.meleeT += dt; if (pred.meleeT > 0.42) { pred.melee = false; pred.meleeT = 0; } }
}

function mix(a, b, u) {
  const o = Object.assign({}, b);
  o.x = a.x + (b.x - a.x) * u;
  o.y = a.y + (b.y - a.y) * u;
  o.tilt = a.tilt + (b.tilt - a.tilt) * u;
  if (Math.abs(b.walk - a.walk) < 4) o.walk = a.walk + (b.walk - a.walk) * u;
  return o;
}
function blend(A, B, u) {
  if (!A) return B.slice();
  const byId = new Map(A.map(e => [e.id, e]));
  return B.map(b => { const a = byId.get(b.id); return a ? mix(a, b, u) : b; });
}

function stepOnline(dt, edges) {
  /* input goes out at a steady rate, edges carried along so taps survive */
  pendEdges.jump = pendEdges.jump || edges.jump;
  pendEdges.a1 = pendEdges.a1 || edges.a1;
  pendEdges.a2 = pendEdges.a2 || edges.a2;
  sendAcc += dt;
  if (sendAcc >= 1 / SEND_HZ) {
    sendAcc = 0;
    Net.sendInput(Input.state, pendEdges);
    pendEdges = { jump: false, a1: false, a2: false };
  }

  predict(dt, edges);

  if (!snaps.length) return { view: emptyView(), me: null };

  const latest = snaps[snaps.length - 1];
  const target = latest.time - DELAY;
  renderTime += dt;
  if (Math.abs(target - renderTime) > 0.5) renderTime = target;
  else renderTime += (target - renderTime) * Math.min(1, dt * 3);

  let a = snaps[0], b = snaps[snaps.length - 1], u = 1;
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].time <= renderTime && snaps[i + 1].time >= renderTime) {
      a = snaps[i]; b = snaps[i + 1];
      const span = b.time - a.time;
      u = span > 0 ? (renderTime - a.time) / span : 1;
      break;
    }
  }
  if (renderTime >= latest.time) { a = latest; b = latest; u = 1; }

  for (const s of snaps) if (!s.flushed && s.time <= renderTime + 0.001) { Render.fx(s.fx, Net.id); s.flushed = true; }

  const players = blend(a.players, b.players, u).map(p => {
    const info = roster[p.id] || {};
    return Object.assign({}, p, { name: info.name || '', color: info.color || 'red' });
  });

  let me = players.find(p => p.id === Net.id) || null;
  if (me && pred && !me.dead && !me.out && !predLock) {
    Object.assign(me, {
      x: pred.x, y: pred.y, vx: pred.vx, face: pred.face, aim: pred.face > 0 ? 0 : Math.PI,
      tilt: pred.tilt, walk: pred.walk, shootT: pred.shootT,
      melee: pred.melee, meleeT: pred.meleeT, dance: pred.dance
    });
  }

  return {
    view: {
      mode: b.mode, wave: b.wave, kills: b.kills, score: b.score,
      plats: statics.plats, bg: statics.bg, players,
      enemies: blend(a.enemies, b.enemies, u),
      bullets: blend(a.bullets, b.bullets, u),
      hearts: blend(a.hearts, b.hearts, u)
    },
    me
  };
}

function emptyView() {
  return { mode: lobby.mode, wave: 0, kills: 0, score: 0, plats: statics.plats, bg: statics.bg, players: [], enemies: [], bullets: [], hearts: [] };
}

/* ---------------- lobby UI ---------------- */

function drawLobby() {
  $('lRoom').textContent = lobby.room || '';
  const me = lobby.players.find(p => p.id === Net.id);
  const host = !!(me && me.host);

  const ul = $('lPlayers');
  ul.innerHTML = '';
  for (const p of lobby.players) {
    const li = document.createElement('li');
    if (p.id === Net.id) li.className = 'you';
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.style.background = S.colorOf(p.color).body;
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = p.name + (p.id === Net.id ? ' (you)' : '');
    const st = document.createElement('span');
    st.className = 'st' + (p.ready || p.host ? ' rdy' : '');
    st.textContent = p.playing ? 'IN GAME' : p.host ? 'HOST' : p.ready ? 'READY' : 'WAITING';
    li.append(chip, nm, st);
    ul.append(li);
  }
  if (!lobby.players.length) ul.innerHTML = '<li>waiting for players…</li>';

  const sw = $('lColors');
  sw.innerHTML = '';
  for (const c of S.COLORS) {
    const taken = lobby.players.find(p => p.color === c.id);
    const b = document.createElement('button');
    b.style.background = c.body;
    b.title = c.label;
    b.disabled = !!(taken && taken.id !== Net.id);
    if (taken && taken.id === Net.id) b.className = 'sel';
    b.onclick = () => Net.send({ t: 'color', color: c.id });
    sw.append(b);
  }

  for (const b of document.querySelectorAll('.mode')) {
    b.classList.toggle('sel', b.dataset.mode === lobby.mode);
    b.disabled = !host || lobby.state === 'playing';
  }

  $('bReady').classList.toggle('on', !!(me && me.ready));
  $('bReady').textContent = me && me.ready ? 'READY ✓' : 'READY';
  const inRoster = lobby.players.filter(p => p.ready || p.host).length;
  const startable = host && lobby.state !== 'playing' && (lobby.mode === 'vs' ? inRoster >= 2 : inRoster >= 1);
  $('bStart').disabled = !startable;
  $('bStart').textContent = lobby.state === 'playing' ? 'IN PROGRESS' : 'START';

  $('lobbyNote').textContent = waitMsg ? waitMsg
    : lobby.state === 'playing' ? 'A round is running. Co-op lets you drop straight in.'
    : host ? (lobby.mode === 'vs' && inRoster < 2 ? 'Versus needs a second player to ready up.' : 'You are the host — pick a mode and start.')
    : 'Ready up. The host starts the round.';
}

/* ---------------- results ---------------- */

function showResult() {
  const r = lastResult || {};
  const board = $('oBoard');
  board.innerHTML = '';
  for (const p of (r.players || [])) {
    const li = document.createElement('li');
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.style.background = S.colorOf(p.color).body;
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = p.name;
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = r.mode === 'vs' ? (p.kills + ' KO · ' + p.deaths + ' DOWN') : (p.kills + ' KILLS · ' + p.score);
    li.append(chip, nm, st);
    board.append(li);
  }
  if (r.mode === 'vs') {
    $('oTitle').textContent = r.winnerName ? r.winnerName.toUpperCase() + ' WINS' : 'NO WINNER';
    $('oSub').textContent = 'Last block standing.';
  } else {
    $('oTitle').textContent = 'ALL DOWN';
    $('oSub').textContent = 'Wave ' + (r.wave || 0) + ' · ' + (r.kills || 0) + ' knocked out · score ' + (r.score || 0);
  }
  $('bAgain').textContent = online ? 'BACK TO LOBBY' : 'AGAIN';
  phase = 'over';
  show('scrOver');
}

/* ---------------- loop ---------------- */

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  const edges = Input.takeEdges();

  let frame = null;
  if (phase === 'play') frame = story ? stepStory(dt, edges) : online ? stepOnline(dt, edges) : stepSolo(dt, edges);

  if (frame && frame.view) Render.frame(frame.view, { dt, me: frame.me, sim: S });
  else Render.frame({ mode: 'coop', wave: 0, kills: 0, score: 0, plats: menu.plats, bg: menu.bg, players: [], enemies: [], bullets: [], hearts: [] },
    { dt, me: null, sim: S, hud: false });

  if (phase === 'play' && online) {
    netInfo.hidden = false;
    netInfo.textContent = lobby.room + ' · ' + Net.ping + 'ms';
  } else {
    netInfo.hidden = true;
    if (online) Net.heartbeat();
  }

  requestAnimationFrame(loop);
}

/* ---------------- wiring ---------------- */

Render.init($('c'));
Input.attach();
addEventListener('resize', () => Render.resize());

$('fName').value = Net.store.get('bb.name') || '';
$('fRoom').value = Net.store.get('bb.room') || 'MAIN';
$('fServer').value = Net.defaultUrl();
$('fServer').placeholder = 'ws://localhost:8080';

$('bJoin').onclick = joinLobby;
$('bSolo').onclick = startSolo;
$('bStory').onclick = openStory;
$('bStoryBack').onclick = () => { phase = 'name'; show('scrName'); };
$('bStoryReset').onclick = () => { Story.resetProgress(); drawChapters(); };
$('bChMenu').onclick = openStory;

/* while someone is talking, a tap anywhere moves the line along */
$('c').addEventListener('pointerdown', () => { if (phase === 'play' && story) Story.advance(); });
addEventListener('keydown', e => {
  /* E and Enter already come through as the interact edge; space is the spare */
  if (phase !== 'play' || !story || e.repeat || e.target.tagName === 'INPUT') return;
  if (e.key === ' ') Story.advance();
});
$('fName').addEventListener('keydown', e => { if (e.key === 'Enter') joinLobby(); });
$('fRoom').addEventListener('keydown', e => { if (e.key === 'Enter') joinLobby(); });
$('fServer').addEventListener('keydown', e => { if (e.key === 'Enter') joinLobby(); });

$('bReady').onclick = () => {
  const me = lobby.players.find(p => p.id === Net.id);
  Net.send({ t: 'ready', v: !(me && me.ready) });
};
$('bStart').onclick = () => Net.send({ t: 'start' });
for (const b of document.querySelectorAll('.mode')) b.onclick = () => Net.send({ t: 'mode', v: b.dataset.mode });
$('bLeave').onclick = () => { Net.disconnect(); online = false; phase = 'name'; show('scrName'); };
$('bBusyBack').onclick = () => { Net.disconnect(); online = false; phase = 'name'; show('scrName'); };
$('bAgain').onclick = () => {
  if (online) { phase = 'lobby'; show('scrLobby'); drawLobby(); }
  else startSolo();
};
quitBtn.onclick = () => {
  if (story) openStory();
  else if (online) { Net.send({ t: 'leave' }); phase = 'lobby'; show('scrLobby'); drawLobby(); }
  else { phase = 'name'; show('scrName'); }
};
addEventListener('keydown', e => { if (e.key === 'Escape' && phase === 'play') quitBtn.onclick(); });

show('scrName');
requestAnimationFrame(loop);

/* Which build is actually cached, so a stale copy is visible rather than
   mysterious: an old name here means the page is running old code. */
if (typeof caches !== 'undefined' && caches.keys) {
  caches.keys()
    .then(keys => {
      const mine = keys.filter(k => k.indexOf('hanky-') === 0);
      if (mine.length) $('buildTag').textContent = 'build ' + mine.sort().join(' + ').replace(/hanky-/g, '');
    })
    .catch(() => {});
}

if ('serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
