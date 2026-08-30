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

/* the four player colors */
const COLORS = [
  { id: 'red',    label: 'RED',    body: '#e8172a', hurt: '#ff8f9a', dark: '#a30f1d' },
  { id: 'orange', label: 'ORANGE', body: '#f0a010', hurt: '#ffd88a', dark: '#a86e07' },
  { id: 'green',  label: 'GREEN',  body: '#3ddc4a', hurt: '#adf3b4', dark: '#249a2e' },
  { id: 'blue',   label: 'BLUE',   body: '#3a8ff0', hurt: '#a9cffb', dark: '#2160a8' }
];
const colorOf = id => COLORS.find(c => c.id === id) || COLORS[0];

/* enemies stay grey-and-bone so colored blocks always read as players */
const KINDS = ['walker', 'brute', 'hopper', 'flyer'];
const TYPES = {
  walker: { w: 24, h: 40, hp: 45,  spd: 135, dmg: 8,  visor: '#e4e4e8', body: '#3a3a3d', pts: 120 },
  brute:  { w: 36, h: 56, hp: 115, spd: 78,  dmg: 15, visor: '#e4e4e8', body: '#232326', pts: 260 },
  hopper: { w: 22, h: 34, hp: 35,  spd: 190, dmg: 7,  visor: '#e4e4e8', body: '#4d4d54', pts: 150 },
  flyer:  { w: 26, h: 26, hp: 30,  spd: 95,  dmg: 10, visor: '#e4e4e8', body: '#5c5c66', pts: 200 }
};

const LAYOUT = [
  [0.02, 0.815, 0.15], [0.22, 0.735, 0.10], [0.38, 0.855, 0.20], [0.645, 0.775, 0.13], [0.855, 0.700, 0.12],
  [0.07, 0.635, 0.12], [0.30, 0.585, 0.085], [0.455, 0.665, 0.14], [0.665, 0.545, 0.17], [0.895, 0.470, 0.10],
  [0.03, 0.455, 0.11], [0.235, 0.395, 0.19], [0.52, 0.425, 0.10], [0.735, 0.325, 0.15],
  [0.115, 0.245, 0.13], [0.375, 0.235, 0.16], [0.60, 0.150, 0.12], [0.86, 0.185, 0.11]
];

const VS_LIVES = 3;
const COOP_RESPAWN = 5, VS_RESPAWN = 3;

/* ---------------- world ---------------- */

function buildPlats() {
  const gh = 64, t = 18;
  const plats = [{ x: 0, y: WH - gh, w: WW, h: gh }];
  for (const [fx, fy, fw] of LAYOUT)
    plats.push({ x: Math.round(fx * WW), y: Math.round(fy * WH), w: Math.round(Math.max(70, fw * WW)), h: t });
  return plats;
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
  return {
    mode: mode === 'vs' ? 'vs' : 'coop',
    WW, WH,
    plats: buildPlats(),
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

function moveBody(w, b, dt) {
  b.hitWall = false;
  b.x += b.vx * dt;
  for (const p of w.plats) if (overlap(b, p)) {
    if (b.vx > 0) b.x = p.x - b.w; else if (b.vx < 0) b.x = p.x + p.w;
    b.hitWall = true;
  }
  b.vy += G * dt; b.y += b.vy * dt; b.onGround = false;
  for (const p of w.plats) if (overlap(b, p)) {
    if (b.vy > 0) { b.y = p.y - b.h; b.vy = 0; b.onGround = true; }
    else if (b.vy < 0) { b.y = p.y + p.h; b.vy = 0; }
  }
  if (b.x < 0) { b.x = 0; b.hitWall = true; }
  if (b.x + b.w > WW) { b.x = WW - b.w; b.hitWall = true; }
}

function groundAhead(w, e) {
  const px = e.vx > 0 ? e.x + e.w + 6 : e.x - 6, py = e.y + e.h + 8;
  return w.plats.some(p => px > p.x && px < p.x + p.w && py > p.y && py < p.y + p.h + 12);
}

function burst(w, x, y, c, n, who) { w.fx.push({ k: 'b', x: Math.round(x), y: Math.round(y), c, n: n || 6, p: who }); }
function popText(w, x, y, txt, c, who) { w.fx.push({ k: 't', x: Math.round(x), y: Math.round(y), s: txt, c, p: who }); }
function shake(w, v, who) { w.fx.push({ k: 's', v, p: who }); }

/* ---------------- enemies ---------------- */

function makeEnemy(w, kind, x, y) {
  const T = TYPES[kind];
  return {
    id: w.nextId++, kind, x, y, w: T.w, h: T.h,
    vx: (Math.random() < 0.5 ? -1 : 1) * T.spd, vy: 0,
    hp: T.hp, maxHp: T.hp, onGround: false,
    walk: Math.random() * 6, flash: 0, tilt: 0, hopT: Math.random(), bob: Math.random() * 6, stun: 0
  };
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
  e.dead = true; w.kills++;
  const gain = TYPES[e.kind].pts;
  w.score += gain;
  if (by) { by.score += gain; by.kills++; by.cheer = 0.75; popText(w, e.x + e.w / 2, e.y, '+' + gain, '#141416', by.id); }
  burst(w, e.x + e.w / 2, e.y + e.h / 2, '#57575a', 10);
  if (Math.random() < 0.28) dropHeart(w, e.x + e.w / 2, e.y, -150);
}

function hurtPlayer(w, p, dmg, kx, ky, by) {
  if (p.dead || p.out || p.iframe > 0) return;
  p.hp -= dmg; p.iframe = 0.85; p.hurtFlash = 0.25; p.dance = 0;
  p.vx = kx; p.vy = ky;
  shake(w, 10, p.id);
  burst(w, p.x + p.w / 2, p.y + p.h / 2, colorOf(p.color).body, 8);
  if (p.hp <= 0) killPlayer(w, p, by);
}

function killPlayer(w, p, by) {
  p.hp = 0; p.dead = true; p.deaths++; p.melee = false; p.dance = 0;
  burst(w, p.x + p.w / 2, p.y + p.h / 2, colorOf(p.color).body, 16);
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
          hurtPlayer(w, o, 34, dir * 430, -320, p); hit = true;
        }
        if (hit) { p.hitDone = true; shake(w, 12, p.id); w.fx.push({ k: 'h', p: p.id }); }
      }
      if (p.meleeT > 0.42) { p.melee = false; p.hitDone = false; }
    }

    if (p.y > WH + 300) killPlayer(w, p, null);
  }

  /* bullets */
  for (const b of w.bullets) {
    b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < 0 || b.x > WW || b.y < 0 || b.y > WH) b.dead = true;
    for (const pl of w.plats) if (b.x > pl.x && b.x < pl.x + pl.w && b.y > pl.y && b.y < pl.y + pl.h) {
      b.dead = true; burst(w, b.x, b.y, '#8a8a90', 3);
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
      if (e.onGround && e.stun <= 0) {
        /* drift toward the nearest player instead of patrolling blindly */
        let dir = Math.sign(e.vx || 1);
        if (target && Math.random() < 0.02) dir = Math.sign((target.x - e.x) || 1);
        e.vx = dir * T.spd;
      }
      if (e.kind === 'hopper' && e.onGround && e.stun <= 0) {
        e.hopT -= dt;
        if (e.hopT <= 0) { e.vy = -560; e.hopT = 0.9 + Math.random() * 0.7; }
      }
      moveBody(w, e, dt);
      if (e.onGround && e.stun <= 0 && (e.hitWall || !groundAhead(w, e))) {
        /* walk off the edge when someone is down there; otherwise turn around */
        const dive = !e.hitWall && target && target.y > e.y + 90;
        if (!dive) e.vx *= -1;
      }
      e.tilt += ((e.vx / 420) * 0.22 - e.tilt) * Math.min(1, dt * 10);
    }
    if (!e.dead) for (const p of w.players) {
      if (p.dead || p.out || p.iframe > 0) continue;
      if (overlap(e, p)) hurtPlayer(w, p, T.dmg, (p.x < e.x ? -1 : 1) * 360, -280, null);
    }
    if (e.y > WH + 250) e.dead = true;
  }
  w.enemies = w.enemies.filter(e => !e.dead);

  /* hearts */
  for (const h of w.hearts) {
    h.t += dt; h.vy += G * 0.55 * dt; h.y += h.vy * dt;
    for (const pl of w.plats) if (h.x > pl.x && h.x < pl.x + pl.w && h.y + 7 > pl.y && h.y + 7 < pl.y + pl.h + 14 && h.vy > 0) {
      h.y = pl.y - 7; h.vy = 0;
    }
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
        }
        spawnWave(w); w.spawnT = 1.5;
      }
    }
    const alive = w.players.filter(p => !p.dead && !p.out);
    if (w.players.length && alive.length === 0) {
      w.over = true;
      w.result = { mode: 'coop', wave: w.wave, kills: w.kills, score: w.score, players: scoreboard(w) };
    }
  } else {
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
    p: w.players.map(p => [
      p.id, Math.round(p.x), Math.round(p.y), Math.round(p.vx), p.face,
      Math.round(p.hp), r1(p.tilt), r1(p.walk), r1(p.shootT), r1(p.meleeT),
      r1(p.dance), r1(p.cheer), r1(p.iframe), r1(p.hurtFlash),
      (p.melee ? 1 : 0) | (p.dead ? 2 : 0) | (p.out ? 4 : 0) | (p.onGround ? 8 : 0),
      p.lives === Infinity ? -1 : Math.max(0, p.lives), p.score, p.kills,
      Math.ceil(Math.max(0, p.respawn)), p.teleport
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
    players: s.p.map(a => ({
      id: a[0], x: a[1], y: a[2], vx: a[3], face: a[4], hp: a[5], maxHp: 100,
      tilt: a[6], walk: a[7], shootT: a[8], meleeT: a[9], dance: a[10], cheer: a[11],
      iframe: a[12], hurtFlash: a[13],
      melee: !!(a[14] & 1), dead: !!(a[14] & 2), out: !!(a[14] & 4), onGround: !!(a[14] & 8),
      lives: a[15] < 0 ? null : a[15], score: a[16], kills: a[17], respawn: a[18], teleport: a[19],
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
  colorOf, createWorld, addPlayer, removePlayer, getPlayer, spawnPoint, revive,
  step, movePlayer, edgesOf, moveBody, overlap, scoreboard, encode, decode, buildBg
};
});
