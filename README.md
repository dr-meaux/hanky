# HANKY

A tiny brawler that runs in the browser — no build step, no bundler, plain
scripts. Shoot straight ahead, turn to face your target, slam anything that
gets close, grab hearts, and hold both attack buttons to dance.

## The story

Hanky is the first tank that ever learned to stand up: *Tankus Erectus*.
The other tanks cannot, and being different got him mocked, cornered and
frozen out of the scrapyard — most of it stirred up by Stanky, an ordinary
tank who could not stand and hated that Hanky could. Alone, Hanky ended it.

That is not where it stops. He is sent back with a job: get to Stanky before
Stanky turns every tank in the yard against every other one. Not by beating
them — by standing them up. Even Stanky, who keeps trying to put him back in
the ground.

**STORY** on the front screen plays it: eight levels across four places, with
tanks to talk to, and one move the arena does not have —
walking up to a tank you have knocked flat and standing it back on its treads.
Progress is remembered in the browser, so chapters unlock as you go.

Everything anybody says is drawn in one panel in the middle of the screen,
always the same place, with the speaker's name on it and a marker over their
head in the world. Nothing moves during a conversation, so the stick and the
attack buttons stand aside and leave the text a clear screen.

| | |
| --- | --- |
| THE SCRAPYARD | where he was built, and where they turned on him |
| THE WHITE ABOVE | what came after, and the job he was sent back with |
| THE RUST FLATS | the tank camps, and the first ones he stands up |
| STANKY'S FOUNDRY | the gate, the guard, and Stanky himself |

Nothing in the story mode dies. Tanks that are beaten down lie there dazed,
waiting for someone to pick them up — that is the entire point of the game,
and the simulation enforces it. Hanky cannot be lost either: knocked out, he
is set back on his treads at the start of the level.

## The arena

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
| Talk / stand a tank up | `TALK` (story only, when there is something to talk to) | `E` or `Enter` |
| Next line of dialogue | tap anywhere, or `NEXT` | `Space`, `E` or `Enter` |
| Back out | `CHAPTERS` / `LOBBY` | `Esc` |

## Installing it

The game is a PWA: open it and use your browser's "Install" / "Add to Home
Screen". It runs full screen, and the story and solo runs work offline after
the first visit. The icon is the player character — the block with the visor and the
turret arm.

## The server

`server/index.js` both serves the static game and runs the authoritative
simulation: clients send input, the server steps the world 60 times a second
and broadcasts 20 snapshots a second to everyone in the room. Clients render a
tenth of a second behind and interpolate, and predict their own block locally
so the stick still feels instant.

```sh
npm install
npm start            # http://localhost:8080, websockets on the same port
PORT=3000 npm start  # or wherever
```

It has one dependency (`ws`) and keeps no state on disk. Rooms are created on
demand by lobby code, capped at four players each, and disappear when empty.

## Layout

```
index.html             page shell: canvas, touch controls, menu screens
game/sim.js            the simulation — runs in the browser and in Node
game/story.js          the campaign: areas, levels, dialogue, objectives
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
once and both ends agree.

`game/story.js` sits on top of it and never touches the wire: the campaign is
single player and local, so it builds its own worlds in `story` mode, drives
them with the same `step()`, and adds dialogue, npcs and objectives around it.
A level is a small block of data — platforms as fractions of the arena, who
stands where, what everyone says, and what counts as done — so writing a new
one is editing a table, not writing code.

## Working on it

Serve the folder over HTTP (service workers do not run from `file://`) —
`npm start` does both jobs at once.

GitHub Pages serves the repository root of `main` directly, so pushing to
`main` also updates the Pages copy — that one can only play solo, since Pages
cannot host a websocket server. Render is the multiplayer copy.

When `index.html`, a `game/` file or an asset changes, bump `VERSION` in
`sw.js` so installed copies pick up the new build. The worker serves the
shell — html, js, css, manifest — network-first with the cache as the
offline fallback, so a deploy can never leave a new page running old code;
icons stay cache-first. The front screen prints the cached build name, so a
stale copy shows itself rather than turning into mystery bugs.

The icons are rendered from `icons/favicon.svg` and `icons/icon-maskable.svg`;
regenerate the PNGs from those sources if you redraw the character.
