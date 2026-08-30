/* HANKY — shared simulation.
   Runs unchanged in the browser (solo play, client prediction) and in Node
   (the authoritative server). No DOM, no canvas, no timers: feed it inputs,
   call step(), read the world. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---------------- constants ---------------- */

const WW = 2200, WH = 1300;                 /* fixed arena, same for everyone */
const G = 2600, SPD = 330, JUMP = 830;
const TICK = 1 / 60;

/* The ground is a grid of small blocks rather than a set of rectangles, so
   anything can be chewed out of it. CELL is the smallest bite. */
const CELL = 10;
const COLS = Math.ceil(WW / CELL), ROWS = Math.ceil(WH / CELL);
const GROUND_H = 96, PLAT_H = 28;
const BEDROCK = 3;                          /* bottom rows nothing can break */

/* how much each thing takes out */
const DIG_BULLET = 9, DIG_SLAM = 40, DIG_DEATH = 58, DIG_BRUTE = 30, DIG_ROOM = 34;

/* the four player colors */
const COLORS = [
  { id: 'red',    label: 'RED',    body: '#e8172a', hurt: '#ff8f9a', dark: '#a30f1d' },
  { id: 'orange', label: 'ORANGE', body: '#f0a010', hurt: '#ffd88a', dark: '#a86e07' },
  { id: 'green',  label: 'GREEN',  body: '#3ddc4a', hurt: '#adf3b4', dark: '#249a2e' },
  { id: 'blue',   label: 'BLUE',   body: '#3a8ff0', hurt: '#a9cffb', dark: '#2160a8' }
];
const colorOf = id => COLORS.find(c => c.id === id) || COLORS[0];

/* enemies stay grey-and-bone so colored blocks always read as players.
   The `lying` kinds are tanks: they cannot stand up, so they are drawn long
   and low, on treads, with the visor bar along the hull. */
const KINDS = ['walker', 'brute', 'hopper', 'flyer', 'tank', 'heavy', 'stanky'];
const TYPES = {
  walker: { w: 24, h: 40, hp: 45,  spd: 135, dmg: 8,  visor: '#e4e4e8', body: '#3a3a3d', pts: 120 },
  brute:  { w: 36, h: 56, hp: 115, spd: 78,  dmg: 15, visor: '#e4e4e8', body: '#232326', pts: 260 },
  hopper: { w: 22, h: 34, hp: 35,  spd: 190, dmg: 7,  visor: '#e4e4e8', body: '#4d4d54', pts: 150 },
  flyer:  { w: 26, h: 26, hp: 30,  spd: 95,  dmg: 10, visor: '#e4e4e8', body: '#5c5c66', pts: 200 },
  tank:   { w: 48, h: 26, hp: 60,  spd: 120, dmg: 9,  visor: '#141416', body: '#7a7a82', pts: 100, lying: true },
  heavy:  { w: 64, h: 32, hp: 130, spd: 85,  dmg: 15, visor: '#141416', body: '#55555c', pts: 220, lying: true },
  stanky: { w: 88, h: 40, hp: 320, spd: 380, dmg: 14, visor: '#141416', body: '#e8172a', pts: 0,   lying: true }
};

const LAYOUT = [
  [0.02, 0.815, 0.15], [0.22, 0.735, 0.10], [0.38, 0.855, 0.20], [0.645, 0.775, 0.13], [0.855, 0.700, 0.12],
  [0.07, 0.635, 0.12], [0.30, 0.585, 0.085], [0.455, 0.665, 0.14], [0.665, 0.545, 0.17], [0.895, 0.470, 0.10],
  [0.03, 0.455, 0.11], [0.235, 0.395, 0.19], [0.52, 0.425, 0.10], [0.735, 0.325, 0.15],
  [0.115, 0.245, 0.13], [0.375, 0.235, 0.16], [0.60, 0.150, 0.12], [0.86, 0.185, 0.11]
];

const VS_LIVES = 3;
const COOP_RESPAWN = 5, VS_RESPAWN = 3;

/* two slams on the same block inside the window and the attacker takes a
   victory lap: the victim is pinned in place while the attacker lines up
   behind them and gets very busy. Both are untouchable while it plays. */
const COMBO_WINDOW = 4, TAUNT_TIME = 1.5;

/* ---------------- world ---------------- */

function buildPlats() {
  const plats = [{ x: 0, y: WH - GROUND_H, w: WW, h: GROUND_H }];
  for (const [fx, fy, fw] of LAYOUT)
    plats.push({ x: Math.round(fx * WW), y: Math.round(fy * WH), w: Math.round(Math.max(70, fw * WW)), h: PLAT_H });
  return plats;
}

/* ---------------- terrain ---------------- */
/* One byte per cell, 1 = solid. The layout above is only the blueprint: once
   a round starts, the grid is the truth, and it only ever loses cells. */

function makeGrid() { return new Uint8Array(COLS * ROWS); }

function fillRect(g, x, y, w, h) {
  const c0 = Math.max(0, Math.floor(x / CELL)), c1 = Math.min(COLS - 1, Math.ceil((x + w) / CELL) - 1);
  const r0 = Math.max(0, Math.floor(y / CELL)), r1 = Math.min(ROWS - 1, Math.ceil((y + h) / CELL) - 1);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r * COLS + c] = 1;
}

/* the same blueprint on both ends, so a rebuild needs no data on the wire */
function baseTerrain(plats) {
  const g = makeGrid();
  for (const p of (plats || buildPlats())) fillRect(g, p.x, p.y, p.w, p.h);
  return g;
}

function bedrockRow(r) { return r >= ROWS - BEDROCK; }
function cellSolid(g, c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS && g[r * COLS + c] === 1; }
function solidAt(g, x, y) { return cellSolid(g, Math.floor(x / CELL), Math.floor(y / CELL)); }

/* Take a circle out of the grid; returns how many cells actually went.
   `top` is the first row that may be dug at all — the arena passes 0, story
   levels pass their floor line so authored ledges cannot be cut away. The
   arena's is always 0, which is why replaying a crater without it agrees. */
function digGrid(g, x, y, r, top) {
  const c0 = Math.max(0, Math.floor((x - r) / CELL)), c1 = Math.min(COLS - 1, Math.floor((x + r) / CELL));
  const r0 = Math.max(top || 0, Math.floor((y - r) / CELL)), r1 = Math.min(ROWS - 1, Math.floor((y + r) / CELL));
  const rr = r * r;
  let n = 0;
  for (let ry = r0; ry <= r1; ry++) {
    if (bedrockRow(ry)) continue;
    const dy = (ry + 0.5) * CELL - y;
    for (let cx = c0; cx <= c1; cx++) {
      const i = ry * COLS + cx;
      if (!g[i]) continue;
      const dx = (cx + 0.5) * CELL - x;
      if (dx * dx + dy * dy <= rr) { g[i] = 0; n++; }
    }
  }
  return n;
}

/* The simulation's way in: records the crater for the wire and throws debris.
   Rounded before it digs, not after — the wire carries whole numbers, so
   digging with anything else would leave every client a cell out of step. */
function carve(w, x, y, r) {
  x = Math.round(x); y = Math.round(y); r = Math.round(r);
  const n = digGrid(w.grid, x, y, r, w.digTop);
  if (!n) return 0;
  w.dig.push([x, y, r]);
  burst(w, x, y, '#6b6b70', Math.min(16, 3 + Math.round(n / 3)));
  return n;
}

/* first solid point along a segment, for anything moving faster than a cell */
function rayHit(g, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (CELL * 0.6)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = x0 + dx * t, y = y0 + dy * t;
    if (solidAt(g, x, y)) return { x, y };
  }
  return null;
}

/* Between co-op waves the arena knits itself back together — otherwise an
   endless run ends with nothing left to stand on. Versus keeps its scars. */
function rebuildTerrain(w) {
  w.grid.set(baseTerrain(w.plats));
  w.rb++;
  w.dig.length = 0;                          /* craters before this are moot */
  for (const p of w.players) {
    if (p.dead || p.out) continue;
    carve(w, p.x + p.w / 2, p.y + p.h / 2, DIG_ROOM);   /* nobody gets walled in */
    popText(w, p.x + p.w / 2, p.y - 40, 'REBUILT', '#141416', p.id);
  }
  shake(w, 9);
}

/* RLE over the cells: a fresh arena is mostly empty, so this stays small */
function packTerrain(w) {
  const g = w.grid, runs = [];
  let cur = 0, n = 0;
  for (let i = 0; i < g.length; i++) {
    const v = g[i] ? 1 : 0;
    if (v === cur) n++;
    else { runs.push(n); cur = v; n = 1; }
  }
  runs.push(n);
  return runs;
}

function unpackTerrain(runs) {
  const g = makeGrid();
  let i = 0, v = 0;
  for (const n of (runs || [])) {
    if (v && n) g.fill(1, i, Math.min(g.length, i + n));
    i += n; v ^= 1;
  }
  return g;
}

function buildBg() {
  const bg = [];
  for (let i = 0; i < 26; i++)
    bg.push({
      x: Math.round(Math.random() * WW), y: Math.round(Math.random() * (WH - 150)),
      w: Math.round(80 + Math.random() * 220), h: Math.round(60 + Math.random() * 180)
    });
  return bg;
}

function createWorld(mode, seed) {
  const plats = (seed && seed.plats) || buildPlats();
  return {
    mode: mode === 'vs' ? 'vs' : mode === 'story' ? 'story' : 'coop',
    WW, WH,
    /* `plats` is the blueprint, not the collision: it says where to spawn
       things and where to rebuild from. Everything collides against `grid`,
       which is cut from whatever layout the caller seeded — story levels
       bring their own. */
    plats,
    grid: baseTerrain(plats), dig: [], rb: 0, digTop: 0,
    bg: (seed && seed.bg) || buildBg(),
    players: [], enemies: [], bullets: [], hearts: [],
    fx: [], nextId: 1,
    wave: 0, kills: 0, score: 0, spawnT: 0.6, heartT: 4,
    time: 0, over: false, result: null
  };
}

function makePlayer(w, opt) {
  const p = {
    id: opt.id, name: opt.name, color: opt.color || 'red',
    x: 0, y: 0, w: 26, h: 46, vx: 0, vy: 0, face: 1, aim: 0,
    onGround: false, jumps: 2,
    hp: 100, maxHp: 100, iframe: 0, tilt: 0, walk: 0,
    shootT: 0, melee: false, meleeT: 0, hitDone: false,
    cd1: 0, cd2: 0, hurtFlash: 0, dance: 0, cheer: 0, danceLock: false,
    comboOn: 0, comboN: 0, comboT: 0,
    taunt: 0, tauntOn: 0, held: 0, heldBy: 0,
    dead: false, respawn: 0, lives: w.mode === 'vs' ? VS_LIVES : Infinity,
    score: 0, kills: 0, deaths: 0, out: false,
    in: { x: 0, jump: false, a1: false, a2: false },
    prev: { x: 0, jump: false, a1: false, a2: false },
    pj: false, p1: false, p2: false, teleport: 0
  };
  spawnPoint(w, p);
  return p;
}

function addPlayer(w, opt) { const p = makePlayer(w, opt); w.players.push(p); return p; }
function removePlayer(w, id) { w.players = w.players.filter(p => p.id !== id); }
function getPlayer(w, id) { return w.players.find(p => p.id === id); }

function spawnPoint(w, p) {
  /* pick a platform, preferring one nobody is standing on */
  let best = null, bestD = -1;
  for (let i = 0; i < 6; i++) {
    const pl = w.plats[1 + Math.floor(Math.random() * (w.plats.length - 1))];
    const x = pl.x + 20 + Math.random() * Math.max(10, pl.w - 60), y = pl.y - 90;
    let d = 1e9;
    for (const o of w.players) if (o !== p && !o.dead) d = Math.min(d, Math.hypot(o.x - x, o.y - y));
    if (d > bestD) { bestD = d; best = { x, y }; }
    if (d > 420) break;
  }
  p.x = best.x; p.y = best.y; p.vx = 0; p.vy = 0;
  p.teleport = (p.teleport || 0) + 1;
}

/* ---------------- helpers ---------------- */

function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

/* any solid cell in column `c` between rows r0..r1, and the row equivalent */
function colSolid(g, c, r0, r1) {
  if (c < 0 || c >= COLS) return false;
  for (let r = r0; r <= r1; r++) if (g[r * COLS + c]) return true;
  return false;
}
function rowSolid(g, r, c0, c1) {
  if (r < 0 || r >= ROWS) return false;
  const o = r * COLS;
  for (let c = c0; c <= c1; c++) if (g[o + c]) return true;
  return false;
}
const lo = (v, max) => Math.max(0, Math.min(max, Math.floor(v / CELL)));

function moveBody(w, b, dt) {
  const g = w.grid;
  b.hitWall = false;

  b.x += b.vx * dt;
  {
    const r0 = lo(b.y, ROWS - 1), r1 = lo(b.y + b.h - 0.001, ROWS - 1);
    const c0 = lo(b.x, COLS - 1), c1 = lo(b.x + b.w - 0.001, COLS - 1);
    if (b.vx > 0) {
      for (let c = c0; c <= c1; c++) if (colSolid(g, c, r0, r1)) { b.x = c * CELL - b.w; b.hitWall = true; break; }
    } else if (b.vx < 0) {
      for (let c = c1; c >= c0; c--) if (colSolid(g, c, r0, r1)) { b.x = (c + 1) * CELL; b.hitWall = true; break; }
    }
  }

  b.vy += G * dt; b.y += b.vy * dt; b.onGround = false;
  {
    const c0 = lo(b.x, COLS - 1), c1 = lo(b.x + b.w - 0.001, COLS - 1);
    const r0 = lo(b.y, ROWS - 1), r1 = lo(b.y + b.h - 0.001, ROWS - 1);
    if (b.vy > 0) {
      for (let r = r0; r <= r1; r++) if (rowSolid(g, r, c0, c1)) { b.y = r * CELL - b.h; b.vy = 0; b.onGround = true; break; }
    } else if (b.vy < 0) {
      for (let r = r1; r >= r0; r--) if (rowSolid(g, r, c0, c1)) { b.y = (r + 1) * CELL; b.vy = 0; break; }
    }
  }

  if (b.x < 0) { b.x = 0; b.hitWall = true; }
  if (b.x + b.w > WW) { b.x = WW - b.w; b.hitWall = true; }
}

function groundAhead(w, e) {
  const px = e.vx > 0 ? e.x + e.w + 6 : e.x - 6;
  for (let d = 4; d <= 26; d += CELL) if (solidAt(w.grid, px, e.y + e.h + d)) return true;
  return false;
}

/* How far the thing in front rises above our feet. Ground enemies use it to
   tell a step they can scramble over from a wall they cannot — without it a
   crater is a prison, and a co-op wave that never clears never ends. */
function ledgeAhead(w, e) {
  const px = e.vx > 0 ? e.x + e.w + 6 : e.x - 6, feet = e.y + e.h;
  for (let d = 1; d <= 80; d += CELL) if (!solidAt(w.grid, px, feet - d)) return d;
  return 999;
}

function burst(w, x, y, c, n, who) { w.fx.push({ k: 'b', x: Math.round(x), y: Math.round(y), c, n: n || 6, p: who }); }
function popText(w, x, y, txt, c, who) { w.fx.push({ k: 't', x: Math.round(x), y: Math.round(y), s: txt, c, p: who }); }
function shake(w, v, who) { w.fx.push({ k: 's', v, p: who }); }

/* ---------------- enemies ---------------- */

function makeEnemy(w, kind, x, y, opt) {
  const T = TYPES[kind];
  opt = opt || {};
  const hp = opt.hp || T.hp;
  return {
    id: w.nextId++, kind, x, y, w: T.w, h: T.h,
    vx: (opt.face || (Math.random() < 0.5 ? -1 : 1)) * T.spd, vy: 0,
    hp, maxHp: hp, onGround: false,
    walk: Math.random() * 6, flash: 0, tilt: 0, hopT: Math.random(), bob: Math.random() * 6, stun: 0,
    /* story tanks are never destroyed: beaten down they lie there dazed,
       waiting for someone to stand them up. `ext` hands the brain to the
       story script instead of the patrol AI. */
    raise: !!opt.raise, dazed: 0, ext: !!opt.ext,
    climb: 0, pen: 0, anchor: x
  };
}

/* knocked down rather than knocked out */
function dazeEnemy(w, e, by) {
  e.dazed = 1; e.hp = Math.max(1, Math.round(e.maxHp * 0.12));
  e.vx = 0; e.stun = 0.6; e.flash = 0.2;
  burst(w, e.x + e.w / 2, e.y + e.h / 2, '#8a8a90', 10);
  if (by) shake(w, 8, by.id);
}

/* Ground enemies can only walk their own platform, so drop them near someone
   — close enough to be a threat, far enough not to be a cheap shot. */
function platformNear(w) {
  const alive = w.players.filter(p => !p.dead && !p.out);
  const pick = () => w.plats[1 + Math.floor(Math.random() * (w.plats.length - 1))];
  if (!alive.length) return pick();
  const t = alive[Math.floor(Math.random() * alive.length)];
  let best = null, bestD = Infinity;
  for (let i = 0; i < 5; i++) {
    const p = pick();
    const d = Math.hypot(p.x + p.w / 2 - t.x, p.y - t.y);
    if (d < 240) continue;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best || pick();
}

function spawnWave(w) {
  w.wave++;
  const heads = Math.max(1, w.players.length);
  const n = Math.min(3 + w.wave + (heads - 1) * 2, 8 + heads * 3);
  for (let i = 0; i < n; i++) {
    let kind = 'walker';
    const r = Math.random();
    if (w.wave >= 2 && r < 0.22) kind = 'hopper';
    else if (w.wave >= 3 && r < 0.42) kind = 'brute';
    else if (w.wave >= 4 && r < 0.60) kind = 'flyer';
    let x, y;
    if (kind === 'flyer') { x = Math.random() * (WW - 60) + 30; y = WH * 0.15 + Math.random() * WH * 0.5; }
    else {
      const p = platformNear(w);
      x = p.x + 15 + Math.random() * Math.max(10, p.w - 50); y = p.y - 70;
    }
    w.enemies.push(makeEnemy(w, kind, x, y));
    burst(w, x, y, '#f0a010', 6);
  }
  for (let i = 0; i < 1 + w.players.length; i++) dropHeart(w);
}

function dropHeart(w, x, y, vy) {
  if (x === undefined) {
    const p = w.plats[1 + Math.floor(Math.random() * (w.plats.length - 1))];
    x = p.x + p.w / 2; y = p.y - 60; vy = 0;
  }
  w.hearts.push({ id: w.nextId++, x, y, vy: vy || 0, t: Math.random() * 6 });
}

function nearestPlayer(w, e) {
  let best = null, bd = 1e9;
  for (const p of w.players) {
    if (p.dead || p.out) continue;
    const d = Math.hypot((p.x + p.w / 2) - (e.x + e.w / 2), (p.y + p.h / 2) - (e.y + e.h / 2));
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/* ---------------- combat ---------------- */

function shoot(w, p) {
  const a = p.aim, sp = 760;
  const ox = p.x + p.w / 2 + Math.cos(a) * 22, oy = p.y + p.h * 0.40 + Math.sin(a) * 22;
  w.bullets.push({ id: w.nextId++, x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, owner: p.id, color: p.color });
  p.shootT = 0.13;
  p.vx -= Math.cos(a) * 40;
  burst(w, ox, oy, colorOf(p.color).body, 2);
}

function killEnemy(w, e, by) {
  if (e.raise && !e.dazed) { dazeEnemy(w, e, by); return; }   /* tanks go down, not out */
  if (e.raise) { e.hp = Math.max(1, e.hp); return; }
  e.dead = true; w.kills++;
  const gain = TYPES[e.kind].pts;
  w.score += gain;
  if (by) { by.score += gain; by.kills++; by.cheer = 0.75; popText(w, e.x + e.w / 2, e.y, '+' + gain, '#141416', by.id); }
  burst(w, e.x + e.w / 2, e.y + e.h / 2, '#57575a', 10);
  /* the heavy ones go off loudly enough to take the floor with them */
  if (e.kind === 'brute') { carve(w, e.x + e.w / 2, e.y + e.h / 2, DIG_BRUTE); shake(w, 8); }
  if (Math.random() < 0.28) dropHeart(w, e.x + e.w / 2, e.y, -150);
}

function hurtPlayer(w, p, dmg, kx, ky, by) {
  if (p.dead || p.out || p.iframe > 0 || p.held > 0) return false;
  p.hp -= dmg; p.iframe = 0.85; p.hurtFlash = 0.25; p.dance = 0;
  p.vx = kx; p.vy = ky;
  shake(w, 10, p.id);
  burst(w, p.x + p.w / 2, p.y + p.h / 2, colorOf(p.color).body, 8);
  if (p.hp <= 0) killPlayer(w, p, by);
  return true;
}

/* ---------------- double slam ---------------- */

/* stand the attacker up against the victim's back */
function placeBehind(o, p) {
  p.x = o.face > 0 ? o.x - p.w + 6 : o.x + o.w - 6;
  p.y = o.y + o.h - p.h;
  p.x = Math.max(0, Math.min(WW - p.w, p.x));
}

function startTaunt(w, p, o) {
  p.comboOn = 0; p.comboN = 0; p.comboT = 0;
  p.taunt = TAUNT_TIME; p.tauntOn = o.id;
  p.melee = false; p.meleeT = 0; p.hitDone = false; p.dance = 0; p.cheer = 0;
  p.vx = 0; p.vy = 0; p.face = o.face;
  /* a hair longer than the taunt so the attacker is always the one to let go */
  o.held = TAUNT_TIME + 0.1; o.heldBy = p.id;
  o.melee = false; o.meleeT = 0; o.hitDone = false; o.dance = 0;
  o.vx = 0; o.vy = 0;
  /* nobody gets a free shot at the pair while the show is running */
  p.iframe = Math.max(p.iframe, TAUNT_TIME + 0.2);
  o.iframe = Math.max(o.iframe, TAUNT_TIME + 0.8);
  placeBehind(o, p);
  p.score += 150;
  popText(w, o.x + o.w / 2, o.y - 26, 'SMASHED', colorOf(p.color).body);
  burst(w, o.x + o.w / 2, o.y + o.h / 2, colorOf(p.color).body, 10);
  shake(w, 12, p.id); shake(w, 12, o.id);
}

/* count slams landed on the same block; the second one starts the show */
function registerSlam(w, p, o) {
  if (p.comboOn === o.id && p.comboT > 0) p.comboN++;
  else { p.comboOn = o.id; p.comboN = 1; }
  p.comboT = COMBO_WINDOW;
  if (p.comboN >= 2 && !p.taunt && !p.held && !o.held && !o.dead && !o.out) startTaunt(w, p, o);
}

function endTaunt(w, p) {
  const o = getPlayer(w, p.tauntOn);
  p.taunt = 0; p.tauntOn = 0;
  if (o && o.heldBy === p.id) releaseHold(o);
}

function releaseHold(o) {
  o.held = 0; o.heldBy = 0;
  o.iframe = Math.max(o.iframe, 0.8);   /* a moment to get their bearings back */
}

/* the victim: rooted to the spot, still subject to gravity so they land */
function stepHeld(w, p, dt) {
  edgesOf(p);                                  /* buttons pressed while pinned go nowhere */
  p.held -= dt;
  p.vx = 0;
  moveBody(w, p, dt);
  p.tilt += (0 - p.tilt) * Math.min(1, dt * 8);
  if (p.iframe > 0) p.iframe -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (p.held <= 0) releaseHold(p);
}

/* the attacker: glued to the victim's back for the duration */
function stepTaunt(w, p, dt) {
  edgesOf(p);
  p.taunt -= dt;
  const o = getPlayer(w, p.tauntOn);
  if (!o || o.dead || o.out || o.heldBy !== p.id) p.taunt = 0;
  else { p.face = o.face; p.vx = 0; p.vy = 0; p.onGround = o.onGround; placeBehind(o, p); }
  p.tilt += (0 - p.tilt) * Math.min(1, dt * 8);
  if (p.iframe > 0) p.iframe -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (p.taunt <= 0) { endTaunt(w, p); p.cheer = 0.8; }
}

function killPlayer(w, p, by) {
  p.hp = 0; p.dead = true; p.deaths++; p.melee = false; p.dance = 0;
  p.comboOn = 0; p.comboN = 0; p.comboT = 0;
  if (p.taunt > 0) endTaunt(w, p);
  if (p.held > 0) releaseHold(p);
  for (const o of w.players) if (o.tauntOn === p.id && o.taunt > 0) endTaunt(w, o);
  burst(w, p.x + p.w / 2, p.y + p.h / 2, colorOf(p.color).body, 16);
  carve(w, p.x + p.w / 2, p.y + p.h / 2, DIG_DEATH);   /* blocks go out with a bang */
  shake(w, 14, p.id);
  if (w.mode === 'vs') {
    p.lives--;
    if (by && by !== p) { by.kills++; by.score += 500; by.cheer = 1.1; popText(w, p.x + p.w / 2, p.y, 'KO!', colorOf(by.color).body, by.id); }
    if (p.lives <= 0) { p.out = true; p.respawn = 0; popText(w, p.x + p.w / 2, p.y - 20, 'OUT', '#141416'); }
    else p.respawn = VS_RESPAWN;
  } else {
    p.respawn = COOP_RESPAWN;
  }
}

function revive(w, p, hp) {
  spawnPoint(w, p);
  p.dead = false; p.hp = hp || p.maxHp * 0.6; p.iframe = 1.4; p.jumps = 2;
  p.melee = false; p.meleeT = 0; p.hitDone = false; p.dance = 0; p.respawn = 0;
  p.taunt = 0; p.tauntOn = 0; p.held = 0; p.heldBy = 0;
  p.comboOn = 0; p.comboN = 0; p.comboT = 0;
  burst(w, p.x + p.w / 2, p.y + p.h / 2, colorOf(p.color).body, 12);
}

/* ---------------- per-player movement (also used for client prediction) --------------- */

function movePlayer(w, p, dt, edges) {
  p.aim = p.face > 0 ? 0 : Math.PI;

  /* dance: hold both attack buttons */
  if ((edges.a1 && p.in.a2) || (edges.a2 && p.in.a1)) {
    p.dance = 2.6; p.danceLock = true; p.melee = false; p.cd1 = 0.3; p.cd2 = 0.5;
    edges.a1 = edges.a2 = false;
  }
  if (p.danceLock && !p.in.a1 && !p.in.a2) p.danceLock = false;
  if (p.dance > 0) {
    p.dance -= dt;
    if (Math.abs(p.in.x) > 0.35 || edges.jump) p.dance = 0;
    if (!p.danceLock && (p.in.a1 || p.in.a2)) p.dance = 0;
  }
  if (p.cheer > 0) p.cheer -= dt;

  const tgt = p.in.x * SPD;
  p.vx += (tgt - p.vx) * (p.onGround ? 22 : 10) * dt;
  if (Math.abs(p.in.x) > 0.15) p.face = p.in.x > 0 ? 1 : -1;
  if (Math.abs(p.vx) > 20) p.walk += dt * 12;

  if (edges.jump && (p.onGround || p.jumps > 0)) {
    if (!p.onGround) p.jumps--;
    p.vy = -JUMP; p.onGround = false;
    burst(w, p.x + p.w / 2, p.y + p.h, '#ffffff', 4);
  }

  p.cd1 -= dt; p.cd2 -= dt;
  if (p.shootT > 0) p.shootT -= dt;
  if (p.dance <= 0) {
    if (p.in.a1 && p.cd1 <= 0 && !p.melee) { shoot(w, p); p.cd1 = 0.20; }
    if (edges.a2 && p.cd2 <= 0 && !p.melee) { p.melee = true; p.meleeT = 0; p.hitDone = false; p.cd2 = 0.85; p.vx += p.face * 200; }
  }

  moveBody(w, p, dt);
  if (p.onGround) p.jumps = 2;
  p.tilt += ((p.vx / SPD) * 0.24 - p.tilt) * Math.min(1, dt * 12);
  if (p.iframe > 0) p.iframe -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
}

function edgesOf(p) {
  const e = {
    jump: p.pj || (p.in.jump && !p.prev.jump),
    a1: p.p1 || (p.in.a1 && !p.prev.a1),
    a2: p.p2 || (p.in.a2 && !p.prev.a2)
  };
  p.pj = p.p1 = p.p2 = false;
  p.prev = { x: p.in.x, jump: p.in.jump, a1: p.in.a1, a2: p.in.a2 };
  return e;
}

/* ---------------- step ---------------- */

function step(w, dt) {
  if (w.over) return;
  w.time += dt;

  for (const p of w.players) {
    if (p.out) continue;
    if (p.dead) {
      p.respawn -= dt;
      if (p.respawn <= 0 && w.mode === 'vs') revive(w, p);
      if (p.respawn <= 0 && w.mode === 'coop' && w.players.some(o => !o.dead && !o.out)) revive(w, p);
      continue;
    }
    if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) { p.comboN = 0; p.comboOn = 0; } }
    if (p.held > 0 || p.taunt > 0) {
      if (p.held > 0) stepHeld(w, p, dt); else stepTaunt(w, p, dt);
      if (p.y > WH + 300) killPlayer(w, p, null);   /* pinned over a pit still counts */
      continue;
    }
    movePlayer(w, p, dt, edgesOf(p));

    /* slam */
    if (p.melee) {
      p.meleeT += dt;
      if (p.meleeT > 0.16 && p.meleeT < 0.30 && !p.hitDone) {
        const range = 76;
        const hb = { x: p.face > 0 ? p.x + p.w : p.x - range, y: p.y - 12, w: range, h: p.h + 24 };
        let hit = false;
        for (const e of w.enemies) {
          if (e.dead || !overlap(hb, e)) continue;
          e.hp -= 36; e.flash = 0.18; e.stun = 0.28;
          e.vx = ((e.x + e.w / 2) < (p.x + p.w / 2) ? -1 : 1) * 330; e.vy = -60;
          burst(w, e.x + e.w / 2, e.y + e.h / 2, '#57575a', 8); hit = true;
          if (e.hp <= 0) killEnemy(w, e, p);
        }
        if (w.mode === 'vs') for (const o of w.players) {
          if (o === p || o.dead || o.out || !overlap(hb, o)) continue;
          const dir = (o.x + o.w / 2) < (p.x + p.w / 2) ? -1 : 1;
          const landed = hurtPlayer(w, o, 34, dir * 430, -320, p);
          hit = true;
          if (landed) registerSlam(w, p, o);
          if (p.taunt > 0) break;                /* the show has started; stop swinging */
        }
        /* the swing lands on the scenery too — low and forward, so a slam
           takes a bite out of the ledge you are standing on. This is the
           digging tool: two of them punch clean through a platform. */
        if (carve(w, p.x + p.w / 2 + p.face * 46, p.y + p.h * 0.86, DIG_SLAM) > 0) hit = true;
        if (hit) { p.hitDone = true; shake(w, 12, p.id); w.fx.push({ k: 'h', p: p.id }); }
      }
      if (p.meleeT > 0.42) { p.melee = false; p.hitDone = false; }
    }

    if (p.y > WH + 300) killPlayer(w, p, null);
  }

  /* bullets */
  for (const b of w.bullets) {
    const px = b.x, py = b.y;
    b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < 0 || b.x > WW || b.y < 0 || b.y > WH) b.dead = true;
    if (!b.dead) {
      /* stepped along the path: a bullet outruns a cell in a single tick */
      const s = rayHit(w.grid, px, py, b.x, b.y);
      if (s) {
        b.dead = true; b.x = s.x; b.y = s.y;
        burst(w, s.x, s.y, '#8a8a90', 3);
        carve(w, s.x, s.y, DIG_BULLET);          /* enough shots and it gives */
      }
    }
    if (!b.dead) for (const e of w.enemies) {
      if (e.dead) continue;
      if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
        b.dead = true; e.hp -= 12; e.flash = 0.14; e.vx += Math.sign(b.vx) * 70;
        burst(w, b.x, b.y, b.color, 4);
        if (e.hp <= 0) killEnemy(w, e, getPlayer(w, b.owner));
        break;
      }
    }
    if (!b.dead && w.mode === 'vs') for (const o of w.players) {
      if (o.dead || o.out || o.id === b.owner || o.iframe > 0) continue;
      if (b.x > o.x && b.x < o.x + o.w && b.y > o.y && b.y < o.y + o.h) {
        b.dead = true;
        const src = getPlayer(w, b.owner);
        /* bullets sting but do not stun: small knock, short mercy window */
        o.hp -= 12; o.hurtFlash = 0.2; o.vx += Math.sign(b.vx) * 90; o.dance = 0;
        burst(w, b.x, b.y, b.color, 5);
        if (o.hp <= 0) killPlayer(w, o, src);
        break;
      }
    }
  }
  w.bullets = w.bullets.filter(b => !b.dead && b.t < 1.6);

  /* enemies (coop only) */
  for (const e of w.enemies) {
    const T = TYPES[e.kind];
    e.walk += dt * 8;
    if (e.flash > 0) e.flash -= dt;
    if (e.stun > 0) e.stun -= dt;
    const target = nearestPlayer(w, e);
    if (e.kind === 'flyer') {
      e.bob += dt * 3;
      if (e.stun <= 0 && target) {
        const dx = (target.x + target.w / 2) - (e.x + e.w / 2), dy = (target.y + target.h / 2) - (e.y + e.h / 2);
        const d = Math.hypot(dx, dy) || 1;
        e.vx += (dx / d * T.spd - e.vx) * dt * 2; e.vy += (dy / d * T.spd - e.vy) * dt * 2;
      } else { e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt); }
      e.x += e.vx * dt; e.y += (e.vy + Math.sin(e.bob) * 40) * dt;
      e.x = Math.max(0, Math.min(WW - e.w, e.x)); e.y = Math.max(0, Math.min(WH - e.h, e.y));
      e.tilt = e.vx / 700;
    } else {
      if (e.onGround && e.stun <= 0 && !e.ext && !e.dazed) {
        /* drift toward the nearest player instead of patrolling blindly */
        let dir = Math.sign(e.vx || 1);
        if (target && Math.random() < 0.02) dir = Math.sign((target.x - e.x) || 1);
        e.vx = dir * T.spd;
      }
      if (e.dazed && e.onGround) e.vx *= Math.pow(0.001, dt);   /* down and going nowhere */
      if (e.kind === 'hopper' && e.onGround && e.stun <= 0) {
        e.hopT -= dt;
        if (e.hopT <= 0) { e.vy = -560; e.hopT = 0.9 + Math.random() * 0.7; }
      }
      moveBody(w, e, dt);
      /* pacing the same few metres means walled in, not patrolling */
      if (e.climb > 0) e.climb -= dt;
      if (Math.abs(e.x - e.anchor) > 110) { e.anchor = e.x; e.pen = 0; } else e.pen += dt;
      if (e.onGround && e.stun <= 0 && !e.ext && !e.dazed && (e.hitWall || !groundAhead(w, e))) {
        /* walk off the edge when someone is down there; otherwise turn around */
        const dive = !e.hitWall && target && target.y > e.y + 90;
        if (e.hitWall && e.pen > 2.5 && e.climb <= 0 && ledgeAhead(w, e) <= 84) {
          e.vy = -700; e.climb = 0.8;            /* scramble out of the crater */
        } else if (!dive) e.vx *= -1;
      }
      e.tilt += ((e.vx / 420) * 0.22 - e.tilt) * Math.min(1, dt * 10);
    }
    if (!e.dead && !e.dazed) for (const p of w.players) {
      if (p.dead || p.out || p.iframe > 0) continue;
      if (overlap(e, p)) hurtPlayer(w, p, T.dmg, (p.x < e.x ? -1 : 1) * 360, -280, null);
    }
    if (e.y > WH + 250) e.dead = true;
  }
  w.enemies = w.enemies.filter(e => !e.dead);

  /* hearts */
  for (const h of w.hearts) {
    h.t += dt; h.vy += G * 0.55 * dt;
    const ny = h.y + h.vy * dt;
    if (h.vy > 0 && solidAt(w.grid, h.x, ny + 7)) { h.y = Math.floor((ny + 7) / CELL) * CELL - 7; h.vy = 0; }
    else h.y = Math.min(ny, WH - 7);
    for (const p of w.players) {
      if (p.dead || p.out || h.dead) continue;
      if (Math.abs(h.x - (p.x + p.w / 2)) < 26 && Math.abs(h.y - (p.y + p.h / 2)) < 32) {
        h.dead = true; p.hp = Math.min(p.maxHp, p.hp + 25);
        popText(w, h.x, h.y, '+25 HP', '#e8172a', p.id);
        burst(w, h.x, h.y, '#e8172a', 8);
      }
    }
  }
  w.hearts = w.hearts.filter(h => !h.dead);

  /* mode rules */
  if (w.mode === 'coop') {
    if (w.enemies.length === 0) {
      w.spawnT -= dt;
      if (w.spawnT <= 0) {
        if (w.wave > 0) {
          w.score += 250;
          for (const p of w.players) {
            if (p.out) continue;
            if (p.dead) revive(w, p); else p.hp = Math.min(p.maxHp, p.hp + 15);
          }
          rebuildTerrain(w);
        }
        spawnWave(w); w.spawnT = 1.5;
      }
    }
    const alive = w.players.filter(p => !p.dead && !p.out);
    if (w.players.length && alive.length === 0) {
      w.over = true;
      w.result = { mode: 'coop', wave: w.wave, kills: w.kills, score: w.score, players: scoreboard(w) };
    }
  } else if (w.mode === 'vs') {
    w.heartT -= dt;
    if (w.heartT <= 0) { if (w.hearts.length < 3) dropHeart(w); w.heartT = 7; }
    const standing = w.players.filter(p => !p.out);
    if (w.players.length > 1 && standing.length <= 1) {
      w.over = true;
      const win = standing[0] || null;
      w.result = { mode: 'vs', winner: win ? win.id : null, winnerName: win ? win.name : null, players: scoreboard(w) };
    }
  }

  return w;
}

function scoreboard(w) {
  return w.players.map(p => ({
    id: p.id, name: p.name, color: p.color, score: p.score,
    kills: p.kills, deaths: p.deaths, lives: p.lives === Infinity ? null : Math.max(0, p.lives)
  })).sort((a, b) => (b.kills - a.kills) || (b.score - a.score));
}

/* ---------------- snapshots ---------------- */
/* Compact arrays keep the wire small; both ends agree on the index order here. */

const r1 = n => Math.round(n * 10) / 10;

function encode(w) {
  return {
    t: w.time,
    m: w.mode, o: w.over ? 1 : 0,
    wv: w.wave, ks: w.kills, sc: w.score,
    rb: w.rb, dg: w.dig,
    p: w.players.map(p => [
      p.id, Math.round(p.x), Math.round(p.y), Math.round(p.vx), p.face,
      Math.round(p.hp), r1(p.tilt), r1(p.walk), r1(p.shootT), r1(p.meleeT),
      r1(p.dance), r1(p.cheer), r1(p.iframe), r1(p.hurtFlash),
      (p.melee ? 1 : 0) | (p.dead ? 2 : 0) | (p.out ? 4 : 0) | (p.onGround ? 8 : 0),
      p.lives === Infinity ? -1 : Math.max(0, p.lives), p.score, p.kills,
      Math.ceil(Math.max(0, p.respawn)), p.teleport,
      r1(p.taunt), r1(p.held)
    ]),
    e: w.enemies.map(e => [
      e.id, KINDS.indexOf(e.kind), Math.round(e.x), Math.round(e.y), Math.round(e.vx),
      Math.round(e.hp), r1(e.tilt), r1(e.walk), r1(e.bob), r1(e.flash)
    ]),
    b: w.bullets.map(b => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.color]),
    h: w.hearts.map(h => [h.id, Math.round(h.x), Math.round(h.y), r1(h.t)]),
    fx: w.fx
  };
}

function decode(s) {
  return {
    time: s.t, mode: s.m, over: !!s.o, wave: s.wv, kills: s.ks, score: s.sc,
    rb: s.rb || 0, dig: s.dg || [],
    players: s.p.map(a => ({
      id: a[0], x: a[1], y: a[2], vx: a[3], face: a[4], hp: a[5], maxHp: 100,
      tilt: a[6], walk: a[7], shootT: a[8], meleeT: a[9], dance: a[10], cheer: a[11],
      iframe: a[12], hurtFlash: a[13],
      melee: !!(a[14] & 1), dead: !!(a[14] & 2), out: !!(a[14] & 4), onGround: !!(a[14] & 8),
      lives: a[15] < 0 ? null : a[15], score: a[16], kills: a[17], respawn: a[18], teleport: a[19],
      taunt: a[20], held: a[21],
      w: 26, h: 46, aim: a[4] > 0 ? 0 : Math.PI
    })),
    enemies: s.e.map(a => ({
      id: a[0], kind: KINDS[a[1]], x: a[2], y: a[3], vx: a[4], hp: a[5],
      maxHp: TYPES[KINDS[a[1]]].hp, tilt: a[6], walk: a[7], bob: a[8], flash: a[9],
      w: TYPES[KINDS[a[1]]].w, h: TYPES[KINDS[a[1]]].h
    })),
    bullets: s.b.map(a => ({ id: a[0], x: a[1], y: a[2], vx: a[3], vy: a[4], color: a[5] })),
    hearts: s.h.map(a => ({ id: a[0], x: a[1], y: a[2], t: a[3] })),
    fx: s.fx || []
  };
}

return {
  WW, WH, G, SPD, JUMP, TICK, COLORS, TYPES, KINDS, VS_LIVES,
  CELL, COLS, ROWS, BEDROCK,
  colorOf, createWorld, addPlayer, removePlayer, getPlayer, spawnPoint, revive,
  step, movePlayer, edgesOf, moveBody, overlap, scoreboard, encode, decode, buildBg,
  makeEnemy, dazeEnemy, burst, popText, shake, dropHeart,
  baseTerrain, packTerrain, unpackTerrain, digGrid, solidAt, cellSolid
};
});
