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
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const dancing = p.dance > 0, cheering = p.cheer > 0 && !p.melee && p.shootT <= 0;
  const now = performance.now() / 1000;
  let tilt = p.tilt, bob = 0;
  if (dancing) { tilt = Math.sin(now * 13) * 0.42; bob = Math.abs(Math.sin(now * 13)) * -7; }
  else if (cheering) { tilt = Math.sin(now * 22) * 0.2; bob = Math.abs(Math.sin(now * 18)) * -4; }

  ctx.save(); ctx.translate(cx, cy + bob); ctx.scale(p.face, 1); ctx.rotate(tilt * p.face);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-p.w / 2 + 5, -p.h / 2 + 5, p.w, p.h);
  ctx.fillStyle = p.hurtFlash > 0 ? col.hurt : col.body; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.fillStyle = '#141416'; ctx.fillRect(-p.w / 2, -p.h / 2 + p.h * 0.16, p.w * 0.62, p.h * 0.14);
  if (isMe) { ctx.strokeStyle = '#141416'; ctx.lineWidth = 2; ctx.strokeRect(-p.w / 2 - 1, -p.h / 2 - 1, p.w + 2, p.h + 2); }
  ctx.restore();

  const sy = cy + bob - p.h * 0.06, f = p.face, sw = Math.sin(p.walk) * 0.7;
  if (dancing) {
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

  bar(cx - 22, p.y - 14, 44, 5, p.hp / (p.maxHp || 100), col.body);
  ctx.font = 'bold 11px "Courier New",monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(p.name || '', cx + 1, p.y - 21);
  ctx.fillStyle = '#141416'; ctx.fillText(p.name || '', cx, p.y - 22);
  if (p.dance > 0) { ctx.fillStyle = col.dark; ctx.font = 'bold 12px "Courier New",monospace'; ctx.fillText('~ DANCE ~', cx, p.y - 34); }
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

function drawEnemy(e, TYPES) {
  const T = TYPES[e.kind], cx = e.x + e.w / 2, cy = e.y + e.h / 2, ef = Math.sign(e.vx || 1);
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

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#cfcfd1'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

  ctx.save(); ctx.translate(-cam.x * 0.45, -cam.y * 0.45);
  for (const b of v.bg) slab(b.x, b.y, b.w, b.h, '#c2c2c6', '#b0b0b5', 6);
  ctx.restore();

  ctx.save(); ctx.translate(-cam.x, -cam.y);

  if (focus) {
    const g = ctx.createRadialGradient(focus.x + focus.w / 2, focus.y + focus.h / 2, 10,
      focus.x + focus.w / 2, focus.y + focus.h / 2, Math.max(W, H) * 0.45);
    g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(cam.x, cam.y, W, H);
  }

  for (const p of v.plats) slab(p.x, p.y, p.w, p.h, '#57575a', '#2c2c2e', 7);
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

  for (const p of v.players) {
    const col = S.colorOf(p.color);
    if (p.dead || p.out) { drawGhost(p, col); continue; }
    ctx.globalAlpha = (p.iframe > 0 && Math.floor(p.iframe * 20) % 2 === 0) ? 0.45 : 1;
    drawPlayer(p, col, me && p.id === me.id);
    ctx.globalAlpha = 1;
  }

  for (const t of pops) {
    ctx.globalAlpha = 1 - t.t; ctx.font = 'bold 16px "Courier New",monospace';
    ctx.textAlign = 'center'; ctx.fillStyle = t.c; ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();

  if (o.hud !== false) hud(v, o);
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
