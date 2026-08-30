/* HANKY — everything that draws. Fed a plain view of the world, plus
   local-only sparkle (particles, floating text, screen shake). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Render = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

let cvs, ctx, W = 0, H = 0, DPR = 1;
let parts = [], pops = [], shake = 0;
const cam = { x: 0, y: 0, init: false };

/* the arena's own palette; story areas pass their own in */
const THEME = {
  sky: '#cfcfd1', glow: 'rgba(255,255,255,.8)',
  bg: '#c2c2c6', bgSide: '#b0b0b5', plat: '#57575a', platSide: '#2c2c2e',
  rock: '#43434a', ink: '#141416'
};

function init(canvas) {
  cvs = canvas; ctx = cvs.getContext('2d');
  resize();
}
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
function reset() { parts = []; pops = []; shake = 0; cam.init = false; }

/* fx events from the simulation; `mine` filters shake/hitstop to your own hits */
function fx(list, myId) {
  for (const f of list) {
    if (f.k === 'b') burst(f.x, f.y, f.c, f.n);
    else if (f.k === 't') pops.push({ x: f.x, y: f.y, txt: f.s, c: f.c, t: 0 });
    else if (f.k === 's' && (!f.p || f.p === myId)) shake = Math.max(shake, f.v);
  }
}
function burst(x, y, c, n) {
  for (let i = 0; i < (n || 6); i++)
    parts.push({ x, y, vx: (Math.random() - .5) * 300, vy: (Math.random() - .7) * 300,
      r: 3 + Math.random() * 5, life: .35 + Math.random() * .4, t: 0, c });
}

function tickFx(dt) {
  for (const q of parts) { q.t += dt; q.vy += 2600 * 0.4 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  parts = parts.filter(q => q.t < q.life);
  for (const t of pops) { t.t += dt; t.y -= 42 * dt; }
  pops = pops.filter(t => t.t < 1);
  if (shake > 0) shake -= dt * 40;
}

/* ---------------- pieces ---------------- */

function slab(x, y, w, h, face, side, d) {
  ctx.fillStyle = side; ctx.fillRect(x, y, w + d, h + d);
  ctx.fillStyle = face; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(x, y, w, 3);
}

/* ---------------- terrain ---------------- */
/* The ground is a grid of cells that get shot away, but drawing one rect per
   cell would be thousands of fills a frame. Merge each row into runs first —
   an untouched platform is a single rect, a chewed one a handful. */

const runs = { x: [], y: [], w: [], rock: [], n: 0 };
const caps = { x: [], y: [], w: [], n: 0 };

function scanTerrain(grid, S, camx, camy) {
  const CELL = S.CELL, COLS = S.COLS, ROWS = S.ROWS, deep = S.ROWS - S.BEDROCK;
  const c0 = Math.max(0, Math.floor(camx / CELL) - 1), c1 = Math.min(COLS - 1, Math.floor((camx + W) / CELL) + 1);
  const r0 = Math.max(0, Math.floor(camy / CELL) - 1), r1 = Math.min(ROWS - 1, Math.floor((camy + H) / CELL) + 1);
  runs.n = 0; caps.n = 0;
  for (let r = r0; r <= r1; r++) {
    const row = r * COLS, above = row - COLS;
    let s = -1, cs = -1;
    for (let c = c0; c <= c1 + 1; c++) {
      const solid = c <= c1 && grid[row + c] === 1;
      if (solid && s < 0) s = c;
      else if (!solid && s >= 0) {
        const i = runs.n++;
        runs.x[i] = s * CELL; runs.y[i] = r * CELL; runs.w[i] = (c - s) * CELL; runs.rock[i] = r >= deep;
        s = -1;
      }
      /* the lit top edge: solid cell with open sky directly above it */
      const cap = solid && !(r > 0 && grid[above + c] === 1);
      if (cap && cs < 0) cs = c;
      else if (!cap && cs >= 0) {
        const i = caps.n++;
        caps.x[i] = cs * CELL; caps.y[i] = r * CELL; caps.w[i] = (c - cs) * CELL;
        cs = -1;
      }
    }
  }
}

function drawTerrain(S, th) {
  const CELL = S.CELL, d = 7;
  ctx.fillStyle = th.platSide;
  for (let i = 0; i < runs.n; i++) ctx.fillRect(runs.x[i], runs.y[i], runs.w[i] + d, CELL + d);
  for (let i = 0; i < runs.n; i++) {
    /* bedrock reads denser; an area that names no rock colour just uses its own */
    ctx.fillStyle = runs.rock[i] ? (th.rock || th.plat) : th.plat;
    ctx.fillRect(runs.x[i], runs.y[i], runs.w[i], CELL);
  }
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  for (let i = 0; i < caps.n; i++) ctx.fillRect(caps.x[i], caps.y[i], caps.w[i], 3);
}

/* ---------------- what comes out of the holes ---------------- */
/* Same flat blocks and hard shadows as everything else, only these arrive
   in colour. `seed` keeps each one looking like itself on every client. */

const rnd = (seed, i) => { const t = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return t - Math.floor(t); };

/* Clip to the empty cells of the shaft so a pool fills the hole somebody
   actually dug instead of being painted flat over the ground beside it. */
const open = { x: [], y: [], w: [], n: 0 };

function clipToHole(grid, S, x0, y0, w, h) {
  const CELL = S.CELL, COLS = S.COLS, ROWS = S.ROWS;
  const c0 = Math.max(0, Math.floor(x0 / CELL)), c1 = Math.min(COLS - 1, Math.ceil((x0 + w) / CELL) - 1);
  const r0 = Math.max(0, Math.floor(y0 / CELL)), r1 = Math.min(ROWS - 1, Math.ceil((y0 + h) / CELL) - 1);
  open.n = 0;
  for (let r = r0; r <= r1; r++) {
    const row = r * COLS;
    let st = -1;
    for (let c = c0; c <= c1 + 1; c++) {
      const free = c <= c1 && grid[row + c] !== 1;
      if (free && st < 0) st = c;
      else if (!free && st >= 0) {
        const i = open.n++;
        open.x[i] = st * CELL; open.y[i] = r * CELL; open.w[i] = (c - st) * CELL;
        st = -1;
      }
    }
  }
  if (!open.n) return false;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < open.n; i++) ctx.rect(open.x[i], open.y[i], open.w[i], CELL);
  ctx.clip();
  return true;
}

/* a liquid surface: flat fill, blocky crust, a wobble along the top */
function pool(x, y, w, h, body, crust, t, seed, wob) {
  ctx.fillStyle = body;
  ctx.fillRect(x, y + 3, w, h - 3);
  const step = 8;
  for (let i = 0; i * step < w; i++) {
    const bw = Math.min(step, w - i * step);
    const lift = Math.round(Math.sin(t * 3.4 + i * 0.9 + seed) * wob);
    ctx.fillStyle = body; ctx.fillRect(x + i * step, y + 3 + lift, bw, 4);
    ctx.fillStyle = crust; ctx.fillRect(x + i * step, y + lift, bw, 4);
  }
}

function drawLava(v, t, grid, S) {
  const x = v.x - v.w / 2, up = Math.min(1, v.t / 0.55);
  const h = Math.max(4, v.h * up), y = v.y + v.h - h;
  /* the glow it throws on the walls of its own shaft */
  const g = ctx.createRadialGradient(v.x, y + h / 2, 6, v.x, y + h / 2, v.w);
  g.addColorStop(0, 'rgba(255,120,40,.45)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.fillRect(v.x - v.w, y - v.w / 2, v.w * 2, h + v.w);
  if (clipToHole(grid, S, x, y, v.w, h)) {
    pool(x, y, v.w, h, '#ff3b16', '#ffa22b', t, v.seed, 3);
    ctx.restore();
  }
  /* spatter thrown up out of the mouth */
  for (let i = 0; i < 5; i++) {
    const ph = (t * 1.3 + rnd(v.seed, i)) % 1;
    const bx = x + 10 + rnd(v.seed, i + 40) * (v.w - 20);
    const by = y - ph * 46, s = 5 - ph * 3;
    ctx.fillStyle = 'rgba(255,162,43,' + (1 - ph).toFixed(2) + ')';
    ctx.fillRect(bx, by, s, s);
  }
}

function drawBath(v, t, grid, S) {
  const x = v.x - v.w / 2, up = Math.min(1, v.t / 0.55);
  const h = Math.max(4, v.h * up), y = v.y + v.h - h;
  if (clipToHole(grid, S, x, y, v.w, h)) {
    pool(x, y, v.w, h, 'rgba(47,155,216,.82)', '#8fd6f2', t, v.seed, 2);
    ctx.restore();
  }
  /* steam off a hot spring */
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.5 + rnd(v.seed, i)) % 1;
    const bx = x + 12 + rnd(v.seed, i + 20) * (v.w - 24);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.34 * (1 - ph)).toFixed(2) + ')';
    ctx.fillRect(bx, y - ph * 40, 6, 6);
  }
}

/* one arm: a chain of blocks that narrows, curling as it goes */
function tentacle(bx, by, len, ang, curl, t, thick) {
  const segs = 9;
  let x = bx, y = by, a = ang;
  for (let i = 0; i < segs; i++) {
    const f = 1 - i / segs, s = Math.max(3, thick * f);
    ctx.fillStyle = 'rgba(20,20,22,.2)';
    ctx.fillRect(x - s / 2 + 3, y - s / 2 + 3, s, s);
    ctx.fillStyle = i % 2 ? '#5b3570' : '#4a2a5e';
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    if (i > 2 && i % 2 === 0) {                     /* suckers down one side */
      ctx.fillStyle = '#c9a6d8';
      ctx.fillRect(x - s / 2 + 1, y - s / 2 + 1, 3, 3);
    }
    a += curl + Math.sin(t * 4 + i * 0.7) * 0.10;
    const step = (len / segs);
    x += Math.cos(a) * step; y += Math.sin(a) * step;
  }
}

function drawTentacles(v, t) {
  const up = Math.min(1, v.t / 0.55), base = v.y + v.h, n = 5;
  for (let i = 0; i < n; i++) {
    /* spread across the mouth so they read as several arms, not one mass */
    const off = ((i + 0.5) / n - 0.5) * v.w * 0.86 + (rnd(v.seed, i) - 0.5) * 10;
    const lean = off / v.w * 1.7 + Math.sin(t * 1.6 + i * 1.3) * 0.42;
    tentacle(v.x + off, base - 4, v.h * (0.72 + rnd(v.seed, i + 10) * 0.34) * up,
      -Math.PI / 2 + lean, (rnd(v.seed, i + 30) - 0.5) * 0.2, t + i * 0.8, 11);
  }
}

function drawPortal(v, t) {
  const up = Math.min(1, v.t / 0.55);
  const rx = (v.w / 2) * up, ry = (v.h / 2) * up, cy = v.y + v.h / 2;
  ctx.save(); ctx.translate(v.x, cy); ctx.scale(1, ry / Math.max(1, rx));
  ctx.fillStyle = 'rgba(223,231,255,.35)';
  ctx.beginPath(); ctx.arc(0, 0, rx + 8, 0, 7); ctx.fill();
  ctx.fillStyle = '#141416';
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
  /* a couple of rings turning inside the mouth */
  for (let i = 1; i <= 3; i++) {
    ctx.strokeStyle = 'rgba(223,231,255,' + (0.9 - i * 0.22).toFixed(2) + ')';
    ctx.lineWidth = 3;
    const a0 = t * (1.6 + i * 0.8) + i;
    ctx.beginPath(); ctx.arc(0, 0, rx * (1 - i * 0.24), a0, a0 + 3.6); ctx.stroke();
  }
  ctx.restore();
  /* the sparks it drags upward, which is where it sends you */
  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.9 + rnd(v.seed, i)) % 1;
    ctx.fillStyle = 'rgba(223,231,255,' + (1 - ph).toFixed(2) + ')';
    ctx.fillRect(v.x - 12 + rnd(v.seed, i + 5) * 24, cy - ph * 70, 4, 4);
  }
}

/* Pure scenery: a palm planted on the lip of the hole, two big coconuts at
   its foot, and white doves leaving the opening at the top. It does nothing
   and blocks nothing — it is a postcard that turned up in a fight. */
function drawPalm(v, t) {
  const up = Math.min(1, v.t / 0.55);
  const base = v.y + v.h, h = v.h * up, top = base - h;
  const sway = Math.sin(t * 0.6) * 0.12;
  const bend = f => Math.sin(f * 1.35 + sway) * 26;      /* the trunk's lean */
  const cx = v.x + bend(1);

  /* trunk: stacked blocks, narrowing and leaning as they climb */
  for (let i = 0; i <= 13; i++) {
    const f = i / 13, y = base - h * f, tw = 19 - f * 7;
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillRect(v.x + bend(f) - tw / 2 + 5, y - h / 13 + 5, tw, h / 13 + 2);
  }
  for (let i = 0; i <= 13; i++) {
    const f = i / 13, y = base - h * f, tw = 19 - f * 7;
    ctx.fillStyle = i % 2 ? '#8a683f' : '#70522f';
    ctx.fillRect(v.x + bend(f) - tw / 2, y - h / 13, tw, h / 13 + 2);
  }

  /* Six fronds arcing out of the crown and drooping at the tips. The step is
     shorter than the block, so the segments overlap into one leaf instead of
     a dotted line. Drawn shadows-first so no frond shades its neighbour. */
  const FR = 10, LIFT = [1.05, 0.62, 0.18];
  const frond = (i, paint) => {
    const side = i < 3 ? -1 : 1, lift = LIFT[i % 3];
    let fx = cx, fy = top + 6;
    let fa = side > 0 ? -lift : Math.PI + lift;
    const droop = 0.17 + (2 - (i % 3)) * 0.02;
    for (let k = 0; k < FR; k++) {
      const s2 = 15 - k * 1.1;
      paint(fx, fy, s2, k);
      fa += side * droop + Math.sin(t * 1.2 + i) * 0.01;
      fx += Math.cos(fa) * 9; fy += Math.sin(fa) * 9;
    }
  };
  for (let i = 0; i < 6; i++) frond(i, (fx, fy, s2) => {
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillRect(fx - s2 / 2 + 4, fy - s2 / 2 + 4, s2, s2);
  });
  for (let i = 0; i < 6; i++) frond(i, (fx, fy, s2, k) => {
    ctx.fillStyle = k < 4 ? '#3ab557' : k < 7 ? '#2fa249' : '#24893a';
    ctx.fillRect(fx - s2 / 2, fy - s2 / 2, s2, s2);
  });

  /* the opening the birds come out of */
  ctx.fillStyle = '#141416'; ctx.fillRect(cx - 11, top - 4, 22, 12);
  ctx.fillStyle = '#3d2816'; ctx.fillRect(cx - 8, top - 1, 16, 6);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(cx - 11, top - 4, 22, 3);

  /* Two big coconuts at the foot of the trunk, sat just clear of the ground
     line — brown on dark grey needs the light rim to read at all. */
  for (const dx of [-25, 25]) {
    const bx = v.x + dx, by = base - 32;
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(bx - 14 + 5, by + 5, 28, 28);
    ctx.fillStyle = '#e6dcc8'; ctx.fillRect(bx - 15, by - 1, 30, 30);     /* rim */
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(bx - 14, by, 28, 28);
    ctx.fillStyle = '#8a6234'; ctx.fillRect(bx - 10, by + 4, 12, 6);      /* husk shine */
    ctx.fillStyle = '#2b1c0f';                                            /* the three eyes */
    ctx.fillRect(bx - 8, by + 14, 5, 5);
    ctx.fillRect(bx + 3, by + 14, 5, 5);
    ctx.fillRect(bx - 3, by + 21, 5, 4);
  }

  /* doves leaving the opening, forever */
  for (let i = 0; i < 6; i++) {
    const ph = (t * 0.3 + rnd(v.seed, i)) % 1;
    const ang = -0.5 - rnd(v.seed, i + 7) * 2.1;
    const dx = cx + Math.cos(ang) * ph * 190;
    const dy = top - 2 + Math.sin(ang) * ph * 150 + Math.sin(t * 3 + i) * 4;
    const flap = Math.sin(t * 12 + i * 2) > 0 ? 1 : -1;
    ctx.globalAlpha = Math.max(0, Math.min(1, (1 - ph) * 1.6));
    ctx.fillStyle = 'rgba(20,20,22,.18)';
    ctx.fillRect(dx - 4 + 3, dy - 2 + 3, 10, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(dx - 4, dy - 2, 10, 5);                       /* body */
    ctx.fillRect(dx - 9, dy - 2 - flap * 4, 8, 4);             /* wings */
    ctx.fillRect(dx + 4, dy - 2 + flap * 4, 8, 4);
    ctx.fillStyle = '#f0a010'; ctx.fillRect(dx + 6, dy - 1, 3, 2);   /* beak */
    ctx.globalAlpha = 1;
  }
}

/* Pools, the portal and the palm sit behind the blocks standing in them;
   the tentacles are drawn over the top, because they have hold of you. */
function drawVentsBack(list, grid, S) {
  const t = performance.now() / 1000;
  for (const v of list) {
    if (v.kind === 'lava') drawLava(v, t, grid, S);
    else if (v.kind === 'bath') drawBath(v, t, grid, S);
    else if (v.kind === 'portal') drawPortal(v, t);
    else if (v.kind === 'palm') drawPalm(v, t);
  }
}
function drawVentsFront(list) {
  const t = performance.now() / 1000;
  for (const v of list) if (v.kind === 'tentacle') drawTentacles(v, t);
}

function bar(x, y, w, h, frac, col) {
  const seg = 3, gap = 1.5, n = Math.floor(w / (seg + gap));
  const on = Math.round(n * Math.max(0, Math.min(1, frac)));
  for (let i = 0; i < n; i++) { ctx.fillStyle = i < on ? col : 'rgba(255,255,255,.65)'; ctx.fillRect(x + i * (seg + gap), y, seg, h); }
}
const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
function drawHeart(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let r = 0; r < HEART.length; r++) for (let c = 0; c < 7; c++)
    if (HEART[r][c] === '1') ctx.fillRect(x - 3.5 * s + c * s + 2, y - 3 * s + r * s + 2, s, s);
  ctx.fillStyle = '#e8172a';
  for (let r = 0; r < HEART.length; r++) for (let c = 0; c < 7; c++)
    if (HEART[r][c] === '1') ctx.fillRect(x - 3.5 * s + c * s, y - 3 * s + r * s, s, s);
}
function arm(cx, cy, ang, len, thick) {
  ctx.lineWidth = thick; ctx.lineCap = 'round'; ctx.strokeStyle = '#141416';
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); ctx.stroke();
}

function drawPlayer(p, col, isMe) {
  const cy = p.y + p.h / 2;
  const dancing = p.dance > 0, cheering = p.cheer > 0 && !p.melee && p.shootT <= 0;
  const taunting = p.taunt > 0, pinned = p.held > 0, grabbed = p.grab > 0;
  const now = performance.now() / 1000;
  let tilt = p.tilt, bob = 0, push = 0;
  if (taunting) {
    /* hips do the work: a fast shove forward, a slow ease back */
    const t = Math.sin(now * 16);
    push = p.face * (t > 0 ? t * t : 0) * 10;
    tilt = 0.12 + Math.max(0, t) * 0.14;
    bob = -Math.max(0, t) * 3;
  } else if (pinned) { tilt = Math.sin(now * 16) * 0.05; bob = 0; }
  else if (grabbed) { tilt = Math.sin(now * 24) * 0.22; bob = Math.sin(now * 19) * 3; }
  else if (dancing) { tilt = Math.sin(now * 13) * 0.42; bob = Math.abs(Math.sin(now * 13)) * -7; }
  else if (cheering) { tilt = Math.sin(now * 22) * 0.2; bob = Math.abs(Math.sin(now * 18)) * -4; }
  const cx = p.x + p.w / 2 + push;

  if (taunting) {
    /* speed lines trailing off the back */
    ctx.strokeStyle = 'rgba(20,20,22,' + (0.10 + Math.abs(push) * 0.02).toFixed(3) + ')';
    ctx.lineWidth = 2; ctx.lineCap = 'butt';
    for (let i = 0; i < 3; i++) {
      const yy = cy - 9 + i * 9, back = cx - p.face * (p.w / 2 + 4);
      ctx.beginPath(); ctx.moveTo(back, yy);
      ctx.lineTo(back - p.face * (10 + Math.abs(push) * 1.4), yy); ctx.stroke();
    }
  }

  ctx.save(); ctx.translate(cx, cy + bob); ctx.scale(p.face, 1); ctx.rotate(tilt * p.face);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-p.w / 2 + 5, -p.h / 2 + 5, p.w, p.h);
  ctx.fillStyle = p.hurtFlash > 0 ? col.hurt : col.body; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.fillStyle = '#141416'; ctx.fillRect(-p.w / 2, -p.h / 2 + p.h * 0.16, p.w * 0.62, p.h * 0.14);
  if (isMe) { ctx.strokeStyle = '#141416'; ctx.lineWidth = 2; ctx.strokeRect(-p.w / 2 - 1, -p.h / 2 - 1, p.w + 2, p.h + 2); }
  ctx.restore();

  const sy = cy + bob - p.h * 0.06, f = p.face, sw = Math.sin(p.walk) * 0.7;
  if (taunting) {
    /* both arms forward, holding on */
    const a0 = f > 0 ? 0.30 : Math.PI - 0.30;
    arm(cx + f * 2, sy - 3, a0, 15, 3.6);
    arm(cx + f * 2, sy + 7, a0, 15, 3.6);
  } else if (pinned) {
    /* arms out, going nowhere */
    arm(cx - 9, sy, Math.PI / 2 + 1.15, 14, 3.4);
    arm(cx + 9, sy, Math.PI / 2 - 1.15, 14, 3.4);
  } else if (grabbed) {
    /* both arms up, thrashing */
    arm(cx - 8, sy, -Math.PI / 2 - 0.6 + Math.sin(now * 24) * 0.5, 16, 3.6);
    arm(cx + 8, sy, -Math.PI / 2 + 0.6 - Math.sin(now * 24) * 0.5, 16, 3.6);
  } else if (dancing) {
    arm(cx - 8, sy, -Math.PI / 2 + Math.sin(now * 13) * 0.9, 17, 3.6);
    arm(cx + 8, sy, -Math.PI / 2 - Math.sin(now * 13) * 0.9, 17, 3.6);
  } else if (cheering) {
    arm(cx - 8, sy, -Math.PI / 2 - 0.5 + Math.sin(now * 22) * 0.3, 15, 3.6);
    arm(cx + 8, sy, -Math.PI / 2 + 0.5 - Math.sin(now * 22) * 0.3, 15, 3.6);
  } else {
    arm(cx - f * 9, sy, Math.PI / 2 - sw * 0.6, 14, 3.4);
    if (p.melee) {
      const pr = Math.sin(Math.min(1, p.meleeT / 0.36) * Math.PI);
      arm(cx + f * 8, sy, p.aim, 16 + pr * 36, 4 + pr * 2.5);
      if (pr > 0.4) {
        ctx.fillStyle = 'rgba(20,20,22,.18)';
        ctx.beginPath(); ctx.arc(cx + Math.cos(p.aim) * 46, sy + Math.sin(p.aim) * 46, 26 * pr, 0, 7); ctx.fill();
      }
    } else {
      const rec = p.shootT > 0 ? p.shootT / 0.13 : 0, len = 20 - rec * 6;
      arm(cx + f * 6, sy, p.aim, len, 4);
      const mx = cx + f * 6 + Math.cos(p.aim) * len, my = sy + Math.sin(p.aim) * len;
      ctx.fillStyle = rec > 0 ? col.body : '#141416';
      ctx.beginPath(); ctx.arc(mx, my, rec > 0 ? 5 : 3.2, 0, 7); ctx.fill();
    }
  }

  /* the pair stands on top of each other, so only the pinned block wears the
     tag — the attacker's would land right on it */
  if (taunting) return;

  /* tag and health bar stay put while the block moves under them */
  const bx = p.x + p.w / 2;
  bar(bx - 22, p.y - 14, 44, 5, p.hp / (p.maxHp || 100), col.body);
  ctx.font = 'bold 11px "Courier New",monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(p.name || '', bx + 1, p.y - 21);
  ctx.fillStyle = '#141416'; ctx.fillText(p.name || '', bx, p.y - 22);
  ctx.font = 'bold 12px "Courier New",monospace';
  if (pinned) { ctx.fillStyle = col.dark; ctx.fillText('~ SMASHED ~', bx, p.y - 34); }
  else if (grabbed) { ctx.fillStyle = '#5b3570'; ctx.fillText('~ HELP ~', bx, p.y - 34); }
  else if (p.dance > 0) { ctx.fillStyle = col.dark; ctx.fillText('~ DANCE ~', bx, p.y - 34); }
}

function drawGhost(p, col) {
  /* a knocked-out player waiting to come back */
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = col.body;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.globalAlpha = 1;
  ctx.font = 'bold 12px "Courier New",monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = col.dark;
  const tag = p.out ? 'OUT' : p.respawn > 0 ? String(p.respawn) : '…';
  ctx.fillText(p.name + ' ' + tag, p.x + p.w / 2, p.y - 10);
}

/* A tank: long, low, on treads, with the visor bar laid along the hull —
   the shape Hanky used to be. Knocked down it lies over on its side. */
function drawTank(x, y, w, h, body, opt) {
  const o = opt || {}, f = o.face || 1, cx = x + w / 2, cy = y + h / 2;
  const tip = o.dazed ? (f > 0 ? 0.42 : -0.42) : (o.tilt || 0);
  ctx.save(); ctx.translate(cx, cy + (o.dazed ? h * 0.18 : 0)); ctx.rotate(tip);
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w, h);
  ctx.fillStyle = o.flash ? '#e6e6ea' : body; ctx.fillRect(-w / 2, -h / 2, w, h);
  /* visor along the hull, facing the way it points */
  ctx.fillStyle = '#141416';
  ctx.fillRect(f > 0 ? w / 2 - w * 0.46 : -w / 2, -h / 2 + h * 0.20, w * 0.46, h * 0.26);
  /* stubby barrel */
  ctx.fillRect(f > 0 ? w / 2 : -w / 2 - w * 0.16, -h / 2 + h * 0.30, w * 0.16, h * 0.14);
  /* treads */
  ctx.fillStyle = 'rgba(20,20,22,.55)';
  const tw = w / 5;
  for (let i = 0; i < 5; i++) ctx.fillRect(-w / 2 + i * tw + 2, h / 2 - 5, tw - 4, 5);
  ctx.restore();
}

function drawEnemy(e, TYPES) {
  const T = TYPES[e.kind], cx = e.x + e.w / 2, cy = e.y + e.h / 2, ef = Math.sign(e.vx || 1);
  if (T.lying) {
    drawTank(e.x, e.y, e.w, e.h, e.flash > 0 ? '#e6e6ea' : T.body,
      { face: ef, tilt: e.tilt * 0.5, dazed: e.dazed, flash: e.flash > 0 });
    if (e.dazed) {
      ctx.font = 'bold 11px "Courier New",monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(20,20,22,.55)';
      ctx.fillText('· · ·', cx, e.y - 10);
    } else bar(cx - e.w * 0.26, e.y - 10, e.w * 0.52, 4, e.hp / e.maxHp, '#57575a');
    return;
  }
  ctx.save(); ctx.translate(cx, cy); ctx.scale(ef, 1); ctx.rotate(e.tilt * ef);
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-e.w / 2 + 5, -e.h / 2 + 5, e.w, e.h);
  ctx.fillStyle = e.flash > 0 ? '#c9c9cc' : T.body; ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
  ctx.fillStyle = T.visor; ctx.fillRect(-e.w / 2, -e.h / 2 + e.h * 0.18, e.w * 0.62, e.h * 0.15);
  ctx.restore();
  const sw = Math.sin(e.walk) * 0.7, sy = cy - e.h * 0.08;
  if (e.kind === 'flyer') {
    arm(cx - e.w * 0.4, sy, Math.PI / 2 + 0.6 + Math.sin(e.bob * 2) * 0.3, 11, 3);
    arm(cx + e.w * 0.4, sy, Math.PI / 2 - 0.6 - Math.sin(e.bob * 2) * 0.3, 11, 3);
  } else {
    arm(cx - ef * e.w * 0.4, sy, Math.PI / 2 - sw * 0.7, e.h * 0.34, 3.2);
    arm(cx + ef * e.w * 0.4, sy, Math.PI / 2 + sw * 0.7, e.h * 0.34, 3.2);
  }
  bar(cx - 13, e.y - 10, 26, 4, e.hp / e.maxHp, '#57575a');
}

/* ---------------- story pieces ---------------- */

function drawNpc(n) {
  const cx = n.x + n.w / 2;
  if (n.kind === 'god') {
    /* not a block with a face — a tall pane of light with a slow pulse */
    const a = 0.55 + Math.sin(n.bob * 1.4) * 0.12;
    ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
    ctx.fillRect(n.x - 10, n.y - 10, n.w + 20, n.h + 20);
    ctx.fillStyle = '#fbf7e4'; ctx.fillRect(n.x, n.y, n.w, n.h);
    ctx.fillStyle = 'rgba(212,186,92,.55)'; ctx.fillRect(n.x, n.y, n.w, 6);
    ctx.fillStyle = 'rgba(212,186,92,.35)'; ctx.fillRect(n.x, n.y + n.h - 6, n.w, 6);
    return;
  }
  if (n.kind === 'stand') {
    /* a tank that has been stood up: the same silhouette as Hanky */
    const rise = n.risen === undefined ? 1 : n.risen;
    const h = n.h * (0.45 + rise * 0.55), y = n.y + n.h - h;
    const wob = rise < 1 ? Math.sin(rise * 22) * 0.12 * (1 - rise) : 0;
    ctx.save(); ctx.translate(cx, y + h / 2); ctx.rotate(wob);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-n.w / 2 + 5, -h / 2 + 5, n.w, h);
    ctx.fillStyle = n.color || '#3ddc4a'; ctx.fillRect(-n.w / 2, -h / 2, n.w, h);
    ctx.fillStyle = '#141416'; ctx.fillRect(-n.w / 2, -h / 2 + h * 0.16, n.w * 0.62, h * 0.14);
    ctx.restore();
    const sy = y + h * 0.44;
    arm(cx - 9, sy, Math.PI / 2 - 0.5, 13, 3.2);
    arm(cx + 9, sy, Math.PI / 2 + 0.5, 13, 3.2);
    return;
  }
  drawTank(n.x, n.y, n.w, n.h, n.color || '#7a7a82', { face: n.face, tilt: Math.sin(n.bob * 1.2) * 0.02 });
}

function nameTag(x, y, txt, col) {
  ctx.font = 'bold 11px "Courier New",monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(txt, x + 1, y + 1);
  ctx.fillStyle = col || '#141416'; ctx.fillText(txt, x, y);
}

/* wrap once per string and keep it — the reveal walks the same lines */
const wrapCache = new Map();
function wrap(txt, max) {
  const key = txt + '|' + max;
  let hit = wrapCache.get(key);
  if (hit) return hit;
  const words = txt.split(' '), lines = [];
  let line = '';
  for (const word of words) {
    const t = line ? line + ' ' + word : word;
    if (ctx.measureText(t).width > max && line) { lines.push(line); line = word; }
    else line = t;
  }
  if (line) lines.push(line);
  if (wrapCache.size > 400) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

/* a speech bubble in world space, pointing down at whoever is talking */
function bubble(b) {
  const PAD = 11, LH = 17, MAX = 300;
  ctx.font = 'bold 13px "Courier New",monospace';
  const lines = wrap(b.text, MAX);
  let left = b.chars;
  const shown = lines.map(l => { const s = l.slice(0, Math.max(0, left)); left -= l.length + 1; return s; });
  let wide = 0;
  for (const l of lines) wide = Math.max(wide, ctx.measureText(l).width);
  const bw = wide + PAD * 2, bh = lines.length * LH + PAD * 2 + 12;
  const a = b.anchor;
  let bx = (a ? a.x + a.w / 2 : b.x) - bw / 2;
  let by = (a ? a.y : b.y) - bh - 16;
  bx = Math.max(12, Math.min(2200 - bw - 12, bx));
  by = Math.max(12, by);

  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(bx + 6, by + 6, bw, bh);
  ctx.fillStyle = '#fbfbfc'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#141416'; ctx.lineWidth = 3; ctx.strokeRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
  /* the name sits in the top border, like a label taped on */
  if (b.who) {
    ctx.fillStyle = b.color || '#141416';
    const nw = ctx.measureText(b.who).width + 12;
    ctx.fillRect(bx + 8, by - 9, nw, 18);
    ctx.strokeRect(bx + 9.5, by - 7.5, nw - 3, 15);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 11px "Courier New",monospace';
    ctx.fillText(b.who, bx + 14, by + 4);
    ctx.font = 'bold 13px "Courier New",monospace';
  }
  ctx.fillStyle = '#141416'; ctx.textAlign = 'left';
  for (let i = 0; i < shown.length; i++) ctx.fillText(shown[i], bx + PAD, by + PAD + 13 + i * LH);

  /* tail */
  if (a) {
    const tx = Math.max(bx + 14, Math.min(bx + bw - 14, a.x + a.w / 2));
    ctx.fillStyle = '#fbfbfc';
    ctx.beginPath(); ctx.moveTo(tx - 8, by + bh - 2); ctx.lineTo(tx + 8, by + bh - 2); ctx.lineTo(tx, by + bh + 14); ctx.fill();
    ctx.strokeStyle = '#141416'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(tx - 8, by + bh - 1.5); ctx.lineTo(tx, by + bh + 14); ctx.lineTo(tx + 8, by + bh - 1.5); ctx.stroke();
  }
  if (b.more) {
    ctx.fillStyle = '#141416'; ctx.textAlign = 'center';
    ctx.fillText('▼', bx + bw - 16, by + bh - 9);
  }
}

/* narration has nobody to point at, so it sits at the foot of the screen */
function caption(b) {
  const PAD = 14, LH = 19;
  ctx.font = 'bold 14px "Courier New",monospace';
  const max = Math.min(560, W - 60);
  const lines = wrap(b.text, max - PAD * 2);
  let left = b.chars;
  const shown = lines.map(l => { const s = l.slice(0, Math.max(0, left)); left -= l.length + 1; return s; });
  let wide = 0;
  for (const l of lines) wide = Math.max(wide, ctx.measureText(l).width);
  const bw = wide + PAD * 2, bh = lines.length * LH + PAD * 2;
  const bx = Math.round(W / 2 - bw / 2), by = Math.round(H - bh - 26);

  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(bx + 6, by + 6, bw, bh);
  ctx.fillStyle = '#fbfbfc'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#141416'; ctx.lineWidth = 3; ctx.strokeRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
  /* a voice with no body in the room still gets its name on the box */
  if (b.who) {
    ctx.font = 'bold 11px "Courier New",monospace'; ctx.textAlign = 'left';
    const nw = ctx.measureText(b.who).width + 12;
    ctx.fillStyle = b.color || '#141416'; ctx.fillRect(bx + 10, by - 9, nw, 18);
    ctx.strokeRect(bx + 11.5, by - 7.5, nw - 3, 15);
    ctx.fillStyle = '#fff'; ctx.fillText(b.who, bx + 16, by + 4);
    ctx.font = 'bold 14px "Courier New",monospace';
  }
  ctx.fillStyle = '#141416'; ctx.textAlign = 'left';
  for (let i = 0; i < shown.length; i++) ctx.fillText(shown[i], bx + PAD, by + PAD + 14 + i * LH);
  if (b.more) { ctx.textAlign = 'center'; ctx.fillText('▼', bx + bw - 16, by + bh - 10); }
}

function exitGate(g, theme) {
  const w = 54, h = 96, x = g.x - w / 2, y = g.y - h;
  const t = performance.now() / 1000;
  if (g.open) {
    const a = 0.35 + Math.sin(t * 3) * 0.15;
    ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
    ctx.fillRect(x - 12, y - 12, w + 24, h + 24);
  }
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(x + 6, y + 6, w, h);
  ctx.fillStyle = g.open ? '#fbf7e4' : (theme ? theme.plat : '#57575a');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#141416'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.fillStyle = g.open ? '#141416' : 'rgba(20,20,22,.35)';
  ctx.fillRect(x + 12, y + 16, w - 24, 6);
  ctx.font = 'bold 10px "Courier New",monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = g.open ? '#141416' : 'rgba(20,20,22,.4)';
  ctx.fillText(g.open ? 'OPEN' : 'SHUT', g.x, y - 8);
}

/* ---------------- frame ---------------- */

function frame(v, o) {
  const dt = o.dt, me = o.me, S = o.sim;
  tickFx(dt);

  /* camera follows you, or whoever is still fighting once you are down */
  let focus = me;
  if (!focus || focus.dead || focus.out) {
    const alive = v.players.filter(p => !p.dead && !p.out);
    focus = alive[0] || focus || v.players[0];
  }
  if (focus) {
    const tx = focus.x + focus.w / 2 - W / 2 + (focus.vx || 0) * 0.16;
    const ty = focus.y + focus.h / 2 - H / 2;
    if (!cam.init) { cam.x = tx; cam.y = ty; cam.init = true; }
    cam.x += (tx - cam.x) * Math.min(1, dt * 7);
    cam.y += (ty - cam.y) * Math.min(1, dt * 6);
  }
  cam.x = S.WW <= W ? (S.WW - W) / 2 : Math.max(0, Math.min(S.WW - W, cam.x));
  cam.y = S.WH <= H ? (S.WH - H) / 2 : Math.max(0, Math.min(S.WH - H, cam.y));

  /* every area repaints the same shapes */
  const th = v.theme || THEME;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = th.sky; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

  ctx.save(); ctx.translate(-cam.x * 0.45, -cam.y * 0.45);
  for (const b of v.bg) slab(b.x, b.y, b.w, b.h, th.bg, th.bgSide, 6);
  ctx.restore();

  ctx.save(); ctx.translate(-cam.x, -cam.y);

  if (focus) {
    const g = ctx.createRadialGradient(focus.x + focus.w / 2, focus.y + focus.h / 2, 10,
      focus.x + focus.w / 2, focus.y + focus.h / 2, Math.max(W, H) * 0.45);
    g.addColorStop(0, th.glow); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(cam.x, cam.y, W, H);
  }

  if (v.grid) { scanTerrain(v.grid, S, cam.x, cam.y); drawTerrain(S, th); }
  if (v.vents && v.grid) drawVentsBack(v.vents, v.grid, S);
  if (v.exit) exitGate(v.exit, th);
  if (v.npcs) for (const n of v.npcs) drawNpc(n);
  for (const h of v.hearts) drawHeart(h.x, h.y + Math.sin(h.t * 4) * 3, 3);

  for (const q of parts) {
    ctx.globalAlpha = 1 - q.t / q.life; ctx.fillStyle = q.c;
    ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const b of v.bullets) {
    ctx.strokeStyle = 'rgba(20,20,22,.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.stroke();
    ctx.fillStyle = '#141416'; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 7); ctx.fill();
    ctx.fillStyle = S.colorOf(b.color).body; ctx.beginPath(); ctx.arc(b.x, b.y, 1.8, 0, 7); ctx.fill();
  }

  for (const e of v.enemies) drawEnemy(e, S.TYPES);

  /* a pinned block draws over the one working away behind it */
  const layer = p => (p.held > 0 ? 2 : p.taunt > 0 ? 0 : 1);
  for (const p of v.players.slice().sort((a, b) => layer(a) - layer(b))) {
    const col = S.colorOf(p.color);
    if (p.dead || p.out) { drawGhost(p, col); continue; }
    const blink = p.iframe > 0 && !(p.taunt > 0) && !(p.held > 0) && Math.floor(p.iframe * 20) % 2 === 0;
    ctx.globalAlpha = blink ? 0.45 : 1;
    drawPlayer(p, col, me && p.id === me.id);
    ctx.globalAlpha = 1;
  }

  if (v.vents) drawVentsFront(v.vents);

  for (const t of pops) {
    ctx.globalAlpha = 1 - t.t; ctx.font = 'bold 16px "Courier New",monospace';
    ctx.textAlign = 'center'; ctx.fillStyle = t.c; ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  /* names over the people worth talking to, then whatever is being said */
  if (v.npcs) for (const n of v.npcs) {
    if (n.kind === 'god' || !n.name) continue;
    nameTag(n.x + n.w / 2, n.y - 12, n.name, n.talked ? 'rgba(20,20,22,.45)' : '#141416');
  }
  if (v.prompt) {
    const t = performance.now() / 1000;
    ctx.font = 'bold 12px "Courier New",monospace'; ctx.textAlign = 'center';
    const y = v.prompt.y - 30 + Math.sin(t * 5) * 3;
    const w2 = ctx.measureText(v.prompt.label).width + 18;
    ctx.fillStyle = '#141416'; ctx.fillRect(v.prompt.x - w2 / 2, y - 13, w2, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(v.prompt.label, v.prompt.x, y + 2);
  }
  if (v.aside) bubble({ text: v.aside.text, chars: 999, x: v.aside.x, y: v.aside.y, anchor: null, who: null, more: false });
  if (v.bubble && v.bubble.anchor) bubble(v.bubble);

  ctx.restore();
  ctx.restore();

  /* a line with nobody to say it is drawn over the whole scene instead */
  if (v.bubble && !v.bubble.anchor) caption(v.bubble);

  if (v.fade && v.fade.a > 0) {
    ctx.globalAlpha = Math.min(1, v.fade.a); ctx.fillStyle = v.fade.col;
    ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  }

  if (o.hud === false) return;
  if (v.mode === 'story') storyHud(v, o); else hud(v, o);
}

/* one line of what to do, one bar of how you are doing */
function storyHud(v, o) {
  const me = o.me;
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px "Courier New",monospace';
  ctx.fillStyle = 'rgba(20,20,22,.5)';
  ctx.fillText(v.title || '', 16, 26);

  if (v.objective) {
    ctx.font = 'bold 15px "Courier New",monospace';
    ctx.fillStyle = '#141416';
    ctx.fillText(v.objective, 16, 48);
  }

  if (me) {
    ctx.fillStyle = 'rgba(20,20,22,.45)';
    ctx.font = 'bold 10px "Courier New",monospace';
    ctx.fillText('HANKY', 16, 68);
    bar(16, 74, 120, 7, me.dead ? 0 : me.hp / (me.maxHp || 100), '#e8172a');
  }

  /* hints sit high, clear of the thumb controls */
  if (v.banner && !v.bubble) {
    ctx.textAlign = 'center'; ctx.font = 'bold 13px "Courier New",monospace';
    const wid = Math.min(W - 24, ctx.measureText(v.banner).width + 26);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(W / 2 - wid / 2, 96, wid, 26);
    ctx.strokeStyle = '#141416'; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - wid / 2 + 1, 97, wid - 2, 24);
    ctx.fillStyle = '#141416'; ctx.fillText(v.banner, W / 2, 114);
  }
  if (v.down) {
    ctx.textAlign = 'center'; ctx.font = 'bold 20px "Courier New",monospace';
    ctx.fillStyle = '#141416'; ctx.fillText('DOWN AGAIN', W / 2, H / 2 - 10);
    ctx.font = 'bold 12px "Courier New",monospace';
    ctx.fillStyle = 'rgba(20,20,22,.6)'; ctx.fillText('you do not get to stay down', W / 2, H / 2 + 12);
  }
}

function hud(v, o) {
  const S = o.sim, coop = v.mode === 'coop';
  ctx.font = 'bold 18px "Courier New",monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#141416';
  ctx.fillText(coop ? 'WAVE ' + Math.max(1, v.wave) : 'VERSUS', 16, 30);
  ctx.textAlign = 'right';
  if (coop) {
    ctx.fillText(String(v.score).padStart(6, '0'), W - 16, 30);
    ctx.font = 'bold 13px "Courier New",monospace';
    ctx.fillStyle = 'rgba(20,20,22,.55)';
    ctx.fillText(v.kills + ' DOWN', W - 16, 50);
  } else {
    ctx.font = 'bold 13px "Courier New",monospace';
    ctx.fillStyle = 'rgba(20,20,22,.55)';
    ctx.fillText('LAST ONE STANDING', W - 16, 30);
  }

  if (!o.me && v.players.length) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(20,20,22,.55)';
    ctx.font = 'bold 13px "Courier New",monospace';
    ctx.fillText('SPECTATING — YOU ARE IN NEXT ROUND', W / 2, H - 18);
  }

  /* everyone in the match, colored, with hp and lives */
  const list = v.players.slice().sort((a, b) => (b.kills - a.kills) || (b.score - a.score));
  let y = 54;
  ctx.textAlign = 'left';
  for (const p of list) {
    const col = S.colorOf(p.color);
    ctx.globalAlpha = (p.out ? 0.4 : 1);
    ctx.fillStyle = col.body; ctx.fillRect(16, y - 9, 10, 10);
    ctx.fillStyle = '#141416'; ctx.fillRect(16, y - 6, 6, 3);
    ctx.font = 'bold 12px "Courier New",monospace';
    ctx.fillStyle = '#141416';
    ctx.fillText((p.name || '').slice(0, 10).toUpperCase(), 32, y);
    bar(32, y + 4, 60, 4, p.dead ? 0 : p.hp / (p.maxHp || 100), col.body);
    ctx.fillStyle = 'rgba(20,20,22,.6)';
    if (coop) ctx.fillText(String(p.kills), 100, y);
    else ctx.fillText((p.lives === null ? '' : '♥'.repeat(Math.max(0, p.lives))) + '  ' + p.kills + 'K', 100, y);
    ctx.globalAlpha = 1;
    y += 22;
  }
}

return { init, resize, reset, frame, fx, burst, cam, get width() { return W; }, get height() { return H; } };
});
