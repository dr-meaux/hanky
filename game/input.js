/* HANKY — thumbstick, buttons, keyboard.
   Holds current button state plus "was pressed since you last looked" edges,
   so a tap is never lost between two network sends. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Input = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const state = { x: 0, jump: false, a1: false, a2: false, use: false };
const edge = { jump: false, a1: false, a2: false, use: false };

function press(key) { if (!state[key]) edge[key] = true; state[key] = true; }
function release(key) { state[key] = false; }
function takeEdges() {
  const e = { jump: edge.jump, a1: edge.a1, a2: edge.a2, use: edge.use };
  edge.jump = edge.a1 = edge.a2 = edge.use = false;
  return e;
}
function clear() {
  state.x = 0; state.jump = state.a1 = state.a2 = state.use = false;
  edge.jump = edge.a1 = edge.a2 = edge.use = false;
}

function attach() {
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  const zone = document.getElementById('stickZone');
  let stickId = null, sx = 0, sy = 0; const R = 52;

  function stickStart(id, x, y) { stickId = id; sx = x; sy = y; stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.classList.add('on'); }
  function stickMove(x, y) {
    let dx = x - sx, dy = y - sy; const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.left = (65 + dx) + 'px'; knob.style.top = (65 + dy) + 'px';
    state.x = Math.max(-1, Math.min(1, dx / (R * 0.7)));
  }
  function stickStop() { stickId = null; state.x = 0; knob.style.left = '50%'; knob.style.top = '50%'; stick.classList.remove('on'); }

  zone.addEventListener('touchstart', e => {
    e.preventDefault(); if (stickId !== null) return;
    const t = e.changedTouches[0]; stickStart(t.identifier, t.clientX, t.clientY);
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) stickMove(t.clientX, t.clientY);
  }, { passive: false });
  const tEnd = e => { for (const t of e.changedTouches) if (t.identifier === stickId) stickStop(); };
  zone.addEventListener('touchend', tEnd); zone.addEventListener('touchcancel', tEnd);

  let md = false;
  zone.addEventListener('mousedown', e => { md = true; stickStart('m', e.clientX, e.clientY); });
  addEventListener('mousemove', e => { if (md) stickMove(e.clientX, e.clientY); });
  addEventListener('mouseup', () => { if (md) { md = false; stickStop(); } });

  function bindBtn(id, key) {
    const el = document.getElementById(id);
    const on = e => { if (e.cancelable) e.preventDefault(); el.classList.add('on'); press(key); };
    const off = e => { if (e && e.cancelable) e.preventDefault(); el.classList.remove('on'); release(key); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on);
    addEventListener('mouseup', off);
  }
  bindBtn('bJump', 'jump'); bindBtn('bA1', 'a1'); bindBtn('bA2', 'a2'); bindBtn('bUse', 'use');

  addEventListener('keydown', e => {
    if (e.repeat || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'arrowleft') state.x = -1;
    if (k === 'd' || k === 'arrowright') state.x = 1;
    if (k === 'w' || k === ' ') press('jump');
    if (k === 'j') press('a1');
    if (k === 'k') press('a2');
    if (k === 'e' || k === 'enter') press('use');
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if ((k === 'a' || k === 'arrowleft') && state.x < 0) state.x = 0;
    if ((k === 'd' || k === 'arrowright') && state.x > 0) state.x = 0;
    if (k === 'w' || k === ' ') release('jump');
    if (k === 'j') release('a1');
    if (k === 'k') release('a2');
    if (k === 'e' || k === 'enter') release('use');
  });
  addEventListener('blur', clear);
}

return { state, attach, takeEdges, clear };
});
