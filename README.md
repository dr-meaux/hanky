# HANKY

A tiny arena brawler that runs in the browser — no build step, no bundler,
plain scripts. Shoot straight ahead, turn to face your target, slam anything
that gets close, grab hearts, and hold both attack buttons to dance.

The arena is not scenery. Every platform and every metre of ground is made of
small blocks that come apart, Worms-style — see [Digging](#digging).

Up to four blocks — red, orange, green and blue — share one arena over a
websocket connection, in either of two modes:

- **CO-OP** — everyone against the waves. Downed players come back when a
  teammate is still standing, and again at the start of every wave. The run
  ends when the whole team is down at once.
- **VERSUS** — three lives each, friendly fire very much on. Bullets sting,
  slams send you flying, hearts still heal. Last block standing wins. Land two
  slams on the same block in a row and you get a moment to gloat: they are
  pinned where they stand while you line up behind them and go to town. Worth
  150 points, and nobody can touch either of you until it is over.

## Digging

Nothing you stand on is permanent. The arena is a grid of ten-pixel blocks
rather than a set of solid slabs, and four things take bites out of it:

| | Takes out |
| --- | --- |
| A bullet | a chip where it lands — a burst of fire wears a platform down |
| A slam | a crater in front of you, deep enough to punch through a platform |
| A block going down | a wide blast where it stood |
| A brute going down | a crater under it |

So you can dig a foxhole in the ground and fight from it, drop the floor out
from under someone standing on a ledge, chew an escape route down through a
platform, or wall yourself off from whatever is chasing you. Anything that
falls in a hole — you, an enemy, a heart — has to climb back out. The bottom
of the arena is bedrock and never breaks, so there is always a floor.

**Co-op** rebuilds the arena between waves; it would otherwise be worn to
nothing by wave ten, and the blocks standing in it are given room so nobody is
buried by the repair. **Versus** keeps every scar for the whole round — the
map you finish on is the one you made.

## Playing together

Open the game from a running HANKY server and the server address fills in by
itself — type a name, pick a lobby code, and you are in. The lobby lists
everyone in the room; pick a color, ready up, and the host picks the mode and
starts.

Anyone joining a co-op room mid-round drops straight into the fight — and so
does anyone who hits READY while a co-op round is running. Versus rounds seat
latecomers until the next round.

`?server=ws://host:port` in the URL prefills a different address, and the last
one used is remembered, so a shared link is enough for the next session.

## Deploying to Render

`render.yaml` is a blueprint: in Render, **New → Blueprint**, point it at this
repo, and it creates a web service that serves the game and runs the matches
on one port. The defaults are the Node defaults, so a plain **New → Web
Service** works too:

| | |
| --- | --- |
| Root directory | *(blank — the repo root)* |
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |

Nothing else to set: the server reads `PORT` from the environment, listens on
all interfaces, keeps no state on disk, and Render's proxy passes websockets
through as-is. Change `region:` in `render.yaml` to whichever is closest to
your players — it can't be changed after the service is created.

On Render's free plan the instance sleeps after about 15 idle minutes, so the
first visit after a quiet spell takes some seconds to wake and any lobby left
open is dropped. Everything else is the same as a paid instance.

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

The game is a PWA: open it and use your browser's "Install" / "Add to Home
Screen". It runs full screen, and solo runs work offline after the first
visit. The icon is the player character — the block with the visor and the
turret arm.

## The server

`server/index.js` both serves the static game and runs the authoritative
simulation: clients send input, the server steps the world 60 times a second
and broadcasts 20 snapshots a second to everyone in the room. Clients render a
tenth of a second behind and interpolate, and predict their own block locally
so the stick still feels instant.

The arena itself is sent once when a round starts, run-length encoded — under
half a kilobyte, so dropping into a round in progress is cheap. After that the
snapshots carry only craters, three numbers each, which every client digs out
of its own copy. Terrain is applied the moment it arrives rather than on the
interpolation delay, because it is what you and the server both collide
against. A co-op rebuild is a counter, not a payload: both ends already know
the blueprint.

```sh
npm install
npm start            # http://localhost:8080, websockets on the same port
PORT=3000 npm start  # or wherever
```

It has one dependency (`ws`) and keeps no state on disk. Rooms are created on
demand by lobby code, capped at four players each, and disappear when empty.

## Layout

```
index.html             page shell: canvas, touch controls, lobby screens
game/sim.js            the simulation and the terrain grid — browser and Node
game/render.js         canvas drawing
game/input.js          stick, buttons, keyboard
game/net.js            websocket client
game/main.js           screens, lobby, and the frame loop
game/style.css         all the styling
server/index.js        static files + authoritative game server
package.json           start script and the one dependency
render.yaml            Render blueprint
manifest.webmanifest   PWA metadata (name, colors, icons)
sw.js                  service worker — caches the shell for offline play
icons/                 favicon + app icons, drawn from the character
```

`game/sim.js` is the single source of truth for how the game behaves; the
server requires it, the page loads it with a `<script>` tag. Change a rule
once and both ends agree. That includes the terrain: the server and every
client dig with the same rounded numbers, so their arenas stay identical
cell for cell.

## Working on it

Serve the folder over HTTP (service workers do not run from `file://`) —
`npm start` does both jobs at once.

GitHub Pages serves the repository root of `main` directly, so pushing to
`main` also updates the Pages copy — that one can only play solo, since Pages
cannot host a websocket server. Render is the multiplayer copy.

When `index.html`, a `game/` file or an asset changes, bump `VERSION` in
`sw.js` so installed copies pick up the new build.

The icons are rendered from `icons/favicon.svg` and `icons/icon-maskable.svg`;
regenerate the PNGs from those sources if you redraw the character.
