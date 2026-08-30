# BLOCK BRAWL

A tiny arena brawler that runs entirely in the browser — no build step, no
dependencies, one HTML file. Shoot straight ahead, turn to face your target,
slam anything that gets close, grab hearts, and hold both attack buttons to
dance.

**Play:** https://dr-meaux.github.io/hanky/

## Controls

| | Touch | Keyboard |
| --- | --- | --- |
| Move | left half of the screen (virtual stick) | `A` / `D` |
| Jump (double) | `JUMP` | `W` or space |
| Shoot | `SHOOT` | `J` |
| Slam | `SLAM` | `K` |
| Dance | hold `SHOOT` + `SLAM` | `J` + `K` |

## Installing it

The game is a PWA: open the link and use your browser's "Install" / "Add to
Home Screen". It runs full screen and works offline after the first visit.
The icon is the player character — the red block with the visor and the
turret arm.

## Layout

```
index.html             the whole game
manifest.webmanifest   PWA metadata (name, colors, icons)
sw.js                  service worker — caches the shell for offline play
icons/                 favicon + app icons, drawn from the character
.github/workflows/     Pages deployment
```

## Working on it

Serve the folder over HTTP (service workers do not run from `file://`):

```sh
npx serve .
```

Ship a change by pushing to `main` — the Pages workflow redeploys. When
`index.html` or an asset changes, bump `VERSION` in `sw.js` so installed
copies pick up the new build.

The icons are rendered from `icons/favicon.svg` and `icons/icon-maskable.svg`;
regenerate the PNGs from those sources if you redraw the character.
