/* HANKY — websocket client. Plain JSON over a plain WebSocket:
   the client sends input, the server sends the truth. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Net = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

let ws = null, handlers = {}, myId = null, ping = 0, lastPing = 0;

function on(type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); return Net; }
function emit(type, data) { for (const fn of (handlers[type] || [])) fn(data); }

/* localStorage throws in some privacy modes — never let it break the game */
function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

/* Where the server lives: ?server=… wins, then a remembered address, then
   this page's own origin when it is not a static host like GitHub Pages. */
function defaultUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return normalize(q);
  const saved = get('bb.server');
  if (saved) return saved;
  if (location.protocol.startsWith('http') && !/github\.io$/i.test(location.hostname))
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  return '';
}
function normalize(u) {
  u = (u || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/^wss?:\/\//i.test(u)) return u;
  if (/^https:\/\//i.test(u)) return 'wss://' + u.slice(8);
  if (/^http:\/\//i.test(u)) return 'ws://' + u.slice(7);
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + u;
}

function connect(url, join) {
  disconnect();
  url = normalize(url);
  if (!url) { emit('error', 'No server address'); return; }
  set('bb.server', url);
  try { ws = new WebSocket(url); }
  catch (err) { emit('error', 'Bad server address'); return; }

  ws.onopen = () => { send({ t: 'join', name: join.name, room: join.room, color: join.color }); emit('open'); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'welcome') myId = m.id;
    if (m.t === 'pong') { ping = Math.round(performance.now() - m.ts); return; }
    emit(m.t, m);
  };
  ws.onclose = () => { ws = null; emit('close'); };
  ws.onerror = () => emit('error', 'Could not reach the server');
}
function disconnect() { if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} ws = null; } }
function connected() { return !!ws && ws.readyState === 1; }
function send(o) { if (connected()) ws.send(JSON.stringify(o)); }

/* held buttons and freshly pressed edges packed into two small bitfields */
function sendInput(state, edges) {
  if (!connected()) return;
  send({
    t: 'i',
    x: Math.round(state.x * 100) / 100,
    f: (state.jump ? 1 : 0) | (state.a1 ? 2 : 0) | (state.a2 ? 4 : 0),
    e: (edges.jump ? 1 : 0) | (edges.a1 ? 2 : 0) | (edges.a2 ? 4 : 0)
  });
  const now = performance.now();
  if (now - lastPing > 2000) { lastPing = now; send({ t: 'p', ts: now }); }
}

/* between rounds nothing else is sent — keep the socket warm so proxies
   (Render's included) do not drop an idle lobby */
function heartbeat() {
  if (!connected()) return;
  const now = performance.now();
  if (now - lastPing > 15000) { lastPing = now; send({ t: 'p', ts: now }); }
}

const Net = {
  on, connect, disconnect, connected, send, sendInput, heartbeat, defaultUrl, normalize,
  store: { get, set },
  get id() { return myId; },
  get ping() { return ping; }
};
return Net;
});
