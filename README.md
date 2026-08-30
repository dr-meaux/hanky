# BLOCK BRAWL

A tiny arena brawler that runs in the browser — no build step, no bundler,
plain scripts. Shoot straight ahead, turn to face your target, slam anything
that gets close, grab hearts, and hold both attack buttons to dance.

Up to four blocks — red, orange, green and blue — share one arena over a
websocket connection, in either of two modes:

- **CO-OP** — everyone against the waves. Downed players come back when a
  teammate is still standing, and again at the start of every wave. The run
  ends when the whole team is down at once.
- **VERSUS** — three lives each, friendly fire very much on. Bullets sting,
  slams send you flying, hearts still heal. Last block standing wins.

**Play:** https://dr-meaux.github.io/hanky/ — solo works straight from that
link and offline; multiplayer needs a server (below).

## Playing together

1. Start a server (`cd server && npm install && npm start`).
2. Everyone opens the game, types a name, a lobby code, and the server
   address — e.g. `ws://192.168.1.20:8080` on a LAN, or just leave it as-is
   when you opened the game from the server itself.
3. The lobby lists everyone in the room. Pick a color, ready up; the host
   picks the mode and starts.

Anyone joining a co-op room mid-round drops straight into the fight — and so
does anyone who hits READY while a co-op round is running. Versus rounds seat
latecomers until the next round.

`?server=ws://host:port` in the URL prefills the address, and the last one
used is remembered, so a shared link is enough for the next session.

## Controls

| | Touch | Keyboard |
| --- | --- | --- |
| Move | left half of the screen (virtual stick) | `A` / `D` |
| Jump (double) | `JUMP` | `W` or space |
| Shoot | `SHOOT` | `J` |
| Slam | `SLAM` | `K` |
| Dance | hold `SHOOT` + `SLAM` | `J` + `K` |
| Back to the lobby | `LOBBY` | `Esc` |

## Installing it

The game is a PWA: open the link and use your browser's "Install" / "Add to
Home Screen". It runs full screen, and solo runs work offline after the first
visit. The icon is the player character — the block with the visor and the
turret arm.

## The server

`server/` is a small Node process that both serves the static game and runs
the authoritative simulation: clients send input, the server steps the world
60 times a second and broadcasts 20 snapshots a second to everyone in the
room. Clients render a tenth of a second behind and interpolate, and predict
their own block locally so the stick still feels instant.

```sh
cd server
npm install
npm start            # http://localhost:8080, websockets on the same port
PORT=3000 npm start  # or wherever
```

It has one dependency (`ws`) and keeps no state on disk. Rooms are created on
demand by lobby code, capped at four players each, and disappear when empty.
Any host that terminates TLS in front of it works for `wss://`.

## Layout

```
index.html             page shell: canvas, touch controls, lobby screens
game/sim.js            the simulation — runs in the browser and in Node
game/render.js         canvas drawing
game/input.js          stick, buttons, keyboard
game/net.js            websocket client
game/main.js           screens, lobby, and the frame loop
game/style.css         all the styling
server/index.js        static files + authoritative game server
manifest.webmanifest   PWA metadata (name, colors, icons)
sw.js                  service worker — caches the shell for offline play
icons/                 favicon + app icons, drawn from the character
```

`game/sim.js` is the single source of truth for how the game behaves; the
server requires it, the page loads it with a `<script>` tag. Change a rule
once and both ends agree.

## Working on it

Serve the folder over HTTP (service workers do not run from `file://`) —
running the server is the easiest way, since it does both jobs:

```sh
cd server && npm start
```

Pages serves the repository root of `main` directly, so pushing to `main` is
the deploy for the game itself. When `index.html`, a `game/` file or an asset
changes, bump `VERSION` in `sw.js` so installed copies pick up the new build.

The icons are rendered from `icons/favicon.svg` and `icons/icon-maskable.svg`;
regenerate the PNGs from those sources if you redraw the character.
