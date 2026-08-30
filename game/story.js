/* HANKY — the story mode: areas, levels, and the people in them.
   Single player, entirely local. It leans on the shared simulation for
   physics and fighting, and adds what a campaign needs on top: scripted
   dialogue in speech bubbles, characters to talk to, objectives, and the
   one move that matters — standing another tank up.

   Runs in the browser only (it needs no server), but keeps the same shape
   as the rest of the game: feed it input, call step(), read the view. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.Sim || (typeof require === 'function' && require('./sim.js')));
  else root.Story = factory(root.Sim);
})(typeof self !== 'undefined' ? self : this, function (S) {
'use strict';

const WW = S.WW, WH = S.WH;
const THICK = 18, GROUND = 64;

/* ---------------- looks ---------------- */

/* Each area repaints the world. Same flat blocks and hard shadows as the
   arena — only the palette moves. */
const THEMES = {
  scrapyard: { sky: '#cfcfd1', glow: 'rgba(255,255,255,.80)', bg: '#c2c2c6', bgSide: '#b0b0b5', plat: '#57575a', platSide: '#2c2c2e', ink: '#141416' },
  above:     { sky: '#f2f2f4', glow: 'rgba(255,255,255,.95)', bg: '#e6e6ea', bgSide: '#d8d8dd', plat: '#b9b9c2', platSide: '#8e8e99', ink: '#2a2a30' },
  flats:     { sky: '#d8cfc0', glow: 'rgba(255,248,232,.75)', bg: '#cbc2b2', bgSide: '#b9b0a0', plat: '#6b6154', platSide: '#3b352d', ink: '#141416' },
  foundry:   { sky: '#8c838b', glow: 'rgba(255,206,150,.42)', bg: '#7b737b', bgSide: '#665f68', plat: '#33303a', platSide: '#1b1a20', ink: '#141416' }
};

/* who says what, and in which color */
const VOICES = {
  HANKY:  '#e8172a',
  STANKY: '#a30f1d',
  GOD:    '#8a7a2a',
  TREADY: '#57575a',
  BOLT:   '#249a2e',
  TANK:   '#57575a',
  CROWD:  '#57575a'
};

/* ---------------- level helpers ---------------- */

/* platforms as [x, y, width] in fractions of the arena, like the arena's own
   layout table, so a level reads as a shape rather than a pile of numbers.
   A fourth number makes it a block instead of a ledge — a wall, a pillar.
   Ground level is 1236; a double jump climbs about 240, so keep each step
   under that or reach-test.js will say so. */
function plats(list, opt) {
  const out = (opt && opt.noFloor) ? [] : [{ x: 0, y: WH - GROUND, w: WW, h: GROUND }];
  for (const [fx, fy, fw, fh] of list)
    out.push({
      x: Math.round(fx * WW), y: Math.round(fy * WH),
      w: Math.round(Math.max(70, fw * WW)), h: fh ? Math.round(fh * WH) : THICK
    });
  return out;
}
const at = (fx, fy) => ({ x: Math.round(fx * WW), y: Math.round(fy * WH) });

/* the top of the first surface under a spot, so level data can be written by
   eye and everything still lands on something */
function ground(w, x, wide, y) {
  let top = WH + 400;
  for (const pl of w.plats) {
    if (pl.y < y - 4) continue;
    if (x + wide < pl.x || x > pl.x + pl.w) continue;
    if (pl.y < top) top = pl.y;
  }
  return top;
}

/* the gate stands on whatever is under it rather than hanging in the air */
function exitAt(w, spec) {
  const p = at(spec[0], spec[1]);
  return { x: p.x, y: ground(w, p.x - 27, 54, p.y) };
}

/* the drifting slabs in the far background */
function backdrop(n, seed) {
  const bg = []; let s = seed || 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++)
    bg.push({ x: Math.round(rnd() * WW), y: Math.round(rnd() * (WH - 150)),
      w: Math.round(80 + rnd() * 220), h: Math.round(60 + rnd() * 180) });
  return bg;
}

/* ---------------- the campaign ---------------- */

/* An npc is a block that stands (or lies) somewhere and has something to say.
   kind: 'tank' — a tank on its treads, the way tanks are
         'stand' — a tank that has been stood up, like Hanky
         'god'   — the voice above, a tall pale slab
         'wreck' — scenery */
const AREAS = [
  {
    id: 'scrapyard', name: 'THE SCRAPYARD', theme: 'scrapyard',
    blurb: 'Where Hanky was built, and where they turned on him.',
    levels: [
      {
        id: 'yard-1', name: 'FIRST LIGHT',
        hint: 'Move with the stick. Jump the gaps. Walk up to a tank to talk.',
        plats: [[0.12, 0.80, 0.14], [0.34, 0.70, 0.12], [0.55, 0.78, 0.13], [0.76, 0.66, 0.14]],
        spawn: [0.05, 0.60],
        exit: [0.94, 0.72],
        goal: { k: 'talk', ids: ['tready'], label: 'TALK TO TREADY' },
        npcs: [
          { id: 'tready', name: 'TREADY', kind: 'tank', at: [0.36, 0.655], face: -1, lines: [
            { who: 'HANKY', text: 'Tready! You came back for me.' },
            { who: 'TREADY', text: 'I came to tell you to get down.' },
            { who: 'TREADY', text: 'Tanks do not stand. Tanks roll. You are making everyone nervous.' },
            { who: 'HANKY', text: 'I can see so much further up here. I could show you—' },
            { who: 'TREADY', text: 'Do not. Stanky is already talking about you.' }
          ] }
        ],
        intro: [
          { who: null, text: 'THE SCRAPYARD. FIRST LIGHT.' },
          { who: null, text: 'Every tank here was built the same way: low, flat, treads down.' },
          { who: 'HANKY', text: 'Except me. I woke up one morning and stood.' }
        ],
        outro: [
          { who: 'HANKY', text: 'He will come around. They all will.' }
        ]
      },
      {
        id: 'yard-2', name: 'THE CIRCLE',
        hint: 'They will not move. Hear all three out, then go.',
        plats: [[0.18, 0.78, 0.16], [0.44, 0.68, 0.14], [0.70, 0.78, 0.16]],
        spawn: [0.06, 0.62],
        exit: [0.95, 0.72],
        goal: { k: 'talk', ids: ['t1', 't2', 'stanky'], label: 'HEAR THEM OUT' },
        npcs: [
          { id: 't1', name: 'TANK', kind: 'tank', at: [0.22, 0.715], face: 1, lines: [
            { who: 'TANK', text: 'There he is. The tall one.' },
            { who: 'TANK', text: 'Stanky says you think you are better than us.' },
            { who: 'HANKY', text: 'I never said that.' },
            { who: 'TANK', text: 'You did not have to. You are standing there saying it.' }
          ] },
          { id: 't2', name: 'TANK', kind: 'tank', at: [0.48, 0.635], face: -1, lines: [
            { who: 'TANK', text: 'Do not look at me. I am not talking to you.' },
            { who: 'HANKY', text: 'We were built in the same week.' },
            { who: 'TANK', text: 'And I am staying down, where it is safe.' }
          ] },
          { id: 'stanky', name: 'STANKY', kind: 'tank', big: true, color: '#e8172a', at: [0.76, 0.715], face: -1, lines: [
            { who: 'STANKY', text: 'Hanky. Standing. In front of everyone.' },
            { who: 'HANKY', text: 'Stanky. You are telling them things about me that are not true.' },
            { who: 'STANKY', text: 'I am telling them what you are. A tank that thinks the ground is beneath him.' },
            { who: 'STANKY', text: 'Nobody wants you here. Say it back to me.' },
            { who: 'HANKY', text: '…Nobody wants me here.' },
            { who: 'STANKY', text: 'Good. Now roll along.' }
          ] }
        ],
        intro: [
          { who: null, text: 'They were waiting for him at the gate.' }
        ],
        outro: [
          { who: null, text: 'Hanky walked to the far end of the yard, where nothing is stacked.' },
          { who: null, text: 'He stood there a long time.' },
          { who: null, text: 'That night the scrapyard went quiet, and Hanky went with it.' },
          { who: null, text: 'That should have been the end of the story.' }
        ],
        end: 'AND THAT SHOULD HAVE BEEN THAT',
        fadeOut: '#ffffff'
      }
    ]
  },
  {
    id: 'above', name: 'THE WHITE ABOVE', theme: 'above',
    blurb: 'What came after. A voice, and a job.',
    levels: [
      {
        id: 'above-1', name: 'A SECOND CHANCE',
        hint: 'Nothing up here can hurt you. Stand the fallen tank back up.',
        noFloor: false,
        plats: [[0.14, 0.78, 0.16], [0.40, 0.66, 0.16], [0.66, 0.76, 0.16], [0.30, 0.50, 0.12], [0.58, 0.52, 0.14]],
        spawn: [0.04, 0.55],
        exit: [0.92, 0.66],
        goals: [
          { k: 'talk', ids: ['god'], label: 'HEAR WHAT YOU WERE SENT BACK FOR' },
          { k: 'raise', n: 1, label: 'STAND ONE TANK UP' }
        ],
        npcs: [
          { id: 'god', name: 'GOD', kind: 'god', at: [0.14, 0.836], face: 1, w: 54, h: 150, lines: [
            { who: 'GOD', text: 'Hanky.' },
            { who: 'HANKY', text: 'I know what I did.' },
            { who: 'GOD', text: 'You do. And it is not what I am going to talk about.' },
            { who: 'GOD', text: 'Down there Stanky is still speaking. Tank against tank, yard against yard.' },
            { who: 'GOD', text: 'Left alone he will have them tear each other to scrap, and himself with them.' },
            { who: 'HANKY', text: 'Send someone they like.' },
            { who: 'GOD', text: 'They do not need someone they like. They need someone who knows what the ground looks like from down there.' },
            { who: 'GOD', text: 'I am giving it back to you. Go and stop him.' },
            { who: 'HANKY', text: 'And the others? The ones who did this?' },
            { who: 'GOD', text: 'Stand them up. That is the whole mission, Hanky. Not one of them is an enemy — they are only tanks who have never been upright.' }
          ] }
        ],
        enemies: [ { kind: 'tank', at: [0.52, 0.90], dazed: true, raise: true } ],
        intro: [
          { who: null, text: 'No scrapyard. No rust. No noise.' },
          { who: null, text: 'Just white, and slabs of it to stand on.' }
        ],
        outro: [
          { who: 'GOD', text: 'That is it. That is the only weapon you need.' },
          { who: 'GOD', text: 'Now go down. And Hanky — Stanky counts too.' }
        ]
      }
    ]
  },
  {
    id: 'flats', name: 'THE RUST FLATS', theme: 'flats',
    blurb: 'Back in the dirt, where the tanks are camped and angry.',
    levels: [
      {
        id: 'flats-1', name: 'BACK IN THE DIRT',
        hint: 'SLAM knocks a tank down. Then walk up and stand it up.',
        plats: [[0.16, 0.80, 0.15], [0.42, 0.70, 0.14], [0.68, 0.80, 0.15]],
        spawn: [0.05, 0.60],
        exit: [0.94, 0.72],
        goal: { k: 'raise', n: 2, label: 'STAND UP 2 TANKS' },
        enemies: [ { kind: 'tank', at: [0.30, 0.70], raise: true }, { kind: 'tank', at: [0.62, 0.70], raise: true } ],
        intro: [
          { who: null, text: 'THE RUST FLATS.' },
          { who: 'HANKY', text: 'They will shoot at me before they listen.' },
          { who: 'HANKY', text: 'Fine. Knock them down first. Then pick them up.' }
        ],
        outro: [
          { who: 'BOLT', text: 'What did you do to them? They are… taller.' },
          { who: 'HANKY', text: 'That is the idea. Come on.' }
        ]
      },
      {
        id: 'flats-2', name: 'THE CAMP',
        hint: 'A heavy takes more slams. Nothing here dies — it only goes down.',
        plats: [[0.10, 0.80, 0.12], [0.30, 0.70, 0.14], [0.54, 0.78, 0.13], [0.74, 0.64, 0.16], [0.46, 0.52, 0.12]],
        spawn: [0.04, 0.62],
        exit: [0.93, 0.55],
        goal: { k: 'raise', n: 3, label: 'STAND UP 3 TANKS' },
        npcs: [
          { id: 'bolt', name: 'BOLT', kind: 'tank', color: '#8f8f98', at: [0.12, 0.755], face: 1, lines: [
            { who: 'BOLT', text: 'You are the one from the scrapyard. The standing one.' },
            { who: 'HANKY', text: 'Hanky.' },
            { who: 'BOLT', text: 'Stanky says you snapped and that we are next.' },
            { who: 'HANKY', text: 'Stanky says a lot. Watch what I actually do.' },
            { who: 'BOLT', text: '…I will watch. But I am not getting up. Not yet.' }
          ] }
        ],
        enemies: [
          { kind: 'tank', at: [0.34, 0.66], raise: true },
          { kind: 'tank', at: [0.58, 0.72], raise: true },
          { kind: 'heavy', at: [0.78, 0.58], raise: true }
        ],
        intro: [
          { who: null, text: 'A camp of tanks, parked in a ring, facing out.' }
        ],
        outro: [
          { who: 'BOLT', text: 'All right. All right. Show me how.' },
          { who: null, text: 'Bolt got his front end off the dirt. It took him four tries.' }
        ]
      },
      {
        id: 'flats-3', name: 'THE LONG RAMP',
        hint: 'You do not have to stand every tank up. Getting through is enough.',
        plats: [[0.14, 0.84, 0.10], [0.28, 0.74, 0.10], [0.42, 0.64, 0.10], [0.56, 0.54, 0.10], [0.70, 0.44, 0.10], [0.84, 0.34, 0.12]],
        spawn: [0.03, 0.66],
        exit: [0.90, 0.28],
        goal: { k: 'reach', label: 'CLIMB TO THE FOUNDRY ROAD' },
        enemies: [
          { kind: 'tank', at: [0.30, 0.68], raise: true },
          { kind: 'tank', at: [0.44, 0.58], raise: true },
          { kind: 'tank', at: [0.58, 0.48], raise: true },
          { kind: 'heavy', at: [0.72, 0.37], raise: true }
        ],
        intro: [
          { who: null, text: 'The road to the foundry goes up, and they are parked all the way along it.' }
        ],
        outro: [
          { who: 'HANKY', text: 'Every one I leave down there, he gets to keep.' }
        ]
      }
    ]
  },
  {
    id: 'foundry', name: 'STANKY’S FOUNDRY', theme: 'foundry',
    blurb: 'Where he builds the war. And where it ends.',
    levels: [
      {
        id: 'fnd-1', name: 'THE GATE',
        hint: 'Heavies hit hard. Hearts still heal. Keep standing them up.',
        plats: [[0.12, 0.78, 0.16], [0.38, 0.68, 0.14], [0.62, 0.76, 0.14], [0.82, 0.64, 0.14]],
        spawn: [0.04, 0.60],
        exit: [0.94, 0.54],
        goal: { k: 'raise', n: 3, label: 'STAND UP 3 OF HIS GUARD' },
        enemies: [
          { kind: 'heavy', at: [0.24, 0.70], raise: true },
          { kind: 'tank',  at: [0.44, 0.62], raise: true },
          { kind: 'heavy', at: [0.66, 0.68], raise: true },
          { kind: 'tank',  at: [0.84, 0.55], raise: true }
        ],
        intro: [
          { who: null, text: 'The foundry gate. Everything here is painted his colour.' },
          { who: 'STANKY', text: 'I HEAR YOU ARE COMING UP MY ROAD, HANKY.' },
          { who: 'STANKY', text: 'GOOD. I BURIED YOU ONCE.' }
        ],
        outro: [
          { who: 'HANKY', text: 'Stanky. I am at your gate.' }
        ]
      },
      {
        id: 'fnd-2', name: 'STANKY', boss: true, end: 'TANKUS ERECTUS',
        hint: 'He is faster than you. Take a ledge, or jump straight at him — then slam him while he is stuck in the wall.',
        plats: [[0.16, 0.80, 0.12], [0.72, 0.80, 0.12], [0.44, 0.66, 0.16],
                [0.03, 0.58, 0.035, 0.38], [0.935, 0.58, 0.035, 0.38]],
        spawn: [0.08, 0.60],
        goal: { k: 'boss', label: 'BRING STANKY DOWN' },
        hearts: [[0.20, 0.74], [0.70, 0.74]],
        intro: [
          { who: 'STANKY', text: 'You are supposed to be scrap.' },
          { who: 'HANKY', text: 'I was. I got sent back.' },
          { who: 'STANKY', text: 'Then I will do it properly this time.' }
        ],
        outro: [
          { who: null, text: 'Stanky lay on his side, treads turning at nothing.' },
          { who: 'STANKY', text: 'Finish it. That is what you came up here for.' },
          { who: 'HANKY', text: 'No.' },
          { who: null, text: 'Hanky got a shoulder under him and pushed.' },
          { who: 'STANKY', text: 'What are you— stop. STOP.' },
          { who: 'HANKY', text: 'You never hated me for standing. You hated that you thought you could not.' },
          { who: 'STANKY', text: '…It is very high up.' },
          { who: 'HANKY', text: 'You get used to it. Look — you can see the whole yard from here.' },
          { who: null, text: 'Below the gate, one by one, the tanks were getting their front ends off the ground.' },
          { who: null, text: 'TANKUS ERECTUS.' }
        ]
      }
    ]
  }
];

/* flat list, so progress is one number */
const LEVELS = [];
AREAS.forEach((a, ai) => a.levels.forEach((l, li) => LEVELS.push({ area: a, areaIdx: ai, levelIdx: li, level: l, flat: LEVELS.length })));
const levelAt = (ai, li) => LEVELS.find(e => e.areaIdx === ai && e.levelIdx === li);

/* ---------------- progress ---------------- */

const KEY = 'hanky.story';
/* localStorage throws in some privacy modes — never let it break the game */
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function unlocked() {
  const n = parseInt(safeGet(KEY) || '0', 10);
  return isNaN(n) ? 0 : Math.max(0, Math.min(LEVELS.length - 1, n));
}
function unlock(flat) { if (flat > unlocked()) safeSet(KEY, String(flat)); }
function resetProgress() { safeSet(KEY, '0'); }

/* ---------------- runtime ---------------- */

let st = null;

function build(entry, opt) {
  const L = entry.level;
  const w = S.createWorld('story', {
    plats: plats(L.plats || [], { noFloor: !!L.noFloor }),
    bg: backdrop(entry.area.id === 'above' ? 10 : 24, entry.flat * 91 + 13)
  });
  const p = S.addPlayer(w, { id: 1, name: 'HANKY', color: 'red' });
  const sp = at(L.spawn[0], L.spawn[1]);
  p.x = sp.x; p.y = sp.y; p.vx = p.vy = 0; p.face = 1;

  const npcs = (L.npcs || []).map(n => {
    const pos = at(n.at[0], n.at[1]);
    const size = n.kind === 'god' ? { w: n.w || 54, h: n.h || 150 }
      : n.kind === 'stand' ? { w: 26, h: 46 }
      : { w: n.big ? 74 : 48, h: n.big ? 34 : 26 };
    const o = {
      id: n.id, name: n.name, kind: n.kind, color: n.color || null,
      x: pos.x, y: pos.y, w: size.w, h: size.h, face: n.face || 1,
      lines: n.lines || [], talked: false, bob: Math.random() * 6
    };
    if (n.kind !== 'god') o.y = ground(w, o.x, o.w, o.y) - o.h;   /* park them on the floor under them */
    return o;
  });

  for (const h of (L.hearts || [])) {
    const hp2 = at(h[0], h[1]);
    S.dropHeart(w, hp2.x, hp2.y, 0);
  }

  for (const e of (L.enemies || [])) {
    const pos = at(e.at[0], e.at[1]);
    const T = S.TYPES[e.kind];
    const en = S.makeEnemy(w, e.kind, pos.x, ground(w, pos.x, T.w, pos.y) - T.h - 2,
      { raise: e.raise !== false, ext: !!e.ext, face: e.face });
    if (e.dazed) { en.dazed = 1; en.vx = 0; }
    w.enemies.push(en);
  }

  st = {
    entry, level: L, area: entry.area, theme: THEMES[entry.area.theme],
    world: w, me: p, npcs,
    raised: 0, talked: {}, phase: 'play',
    dlg: null, queue: [], banner: L.hint || '', bannerT: 5,
    exit: L.exit ? exitAt(w, L.exit) : null,
    exitOpen: false, deathT: 0, fade: 0, fadeCol: '#ffffff', endT: 0,
    boss: null, bossState: '', bossT: 0, bossAdds: 0, done: false
  };
  if (L.boss) spawnBoss();
  if (!opt || !opt.silent) say(L.intro || []);
  else say([{ who: null, text: 'Back on your treads. Again.' }]);
  return st;
}

function spawnBoss() {
  const w = st.world;
  const pos = at(0.80, 0.62);
  /* raise:true so no amount of damage can ever destroy him — the story does
     not allow it, and neither does the simulation */
  const b = S.makeEnemy(w, 'stanky', pos.x, ground(w, pos.x, S.TYPES.stanky.w, pos.y) - S.TYPES.stanky.h - 2,
    { ext: true, raise: true, face: -1 });
  b.vx = 0;
  w.enemies.push(b);
  st.boss = b; st.bossState = 'wait'; st.bossT = 1.2;
}

/* ---------------- dialogue ---------------- */

function say(lines) {
  if (!lines || !lines.length) return;
  st.queue = st.queue.concat(lines);
  if (!st.dlg) next();
}
function next() {
  const line = st.queue.shift();
  if (!line) { st.dlg = null; return; }
  st.dlg = { who: line.who, text: line.text, at: line.at || null, chars: 0, t: 0 };
}
/* tap or key: finish the reveal first, then move on */
function advance() {
  if (!st || !st.dlg) return false;
  if (st.dlg.chars < st.dlg.text.length) { st.dlg.chars = st.dlg.text.length; return true; }
  next();
  return true;
}
function talking() { return !!(st && st.dlg); }

/* where the bubble hangs: the speaker, if the speaker is in the room */
function anchor(dlg) {
  if (!dlg.who) return null;
  if (dlg.who === 'HANKY') return st.me;
  if (dlg.at) {
    const n = st.npcs.find(o => o.id === dlg.at);
    if (n) return n;
  }
  const n = st.npcs.find(o => o.name === dlg.who);
  if (n) return n;
  if (dlg.who === 'STANKY' && st.boss && !st.boss.dead) return st.boss;
  return null;
}

/* ---------------- interaction ---------------- */

const TALK_R = 62, RAISE_R = 52;

/* gap between two boxes, not between their middles — a tall slab and a long
   tank should both be talkable from the same arm's length */
function near(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/* the nearest thing worth pressing the button for */
function target() {
  if (!st || st.phase !== 'play' || st.dlg) return null;
  const p = st.me;
  if (p.dead) return null;
  let best = null, bd = Infinity;
  for (const n of st.npcs) {
    if (!n.lines.length) continue;
    const d = near(p, n);
    if (d < TALK_R && d < bd) { bd = d; best = { k: 'talk', npc: n, x: n.x + n.w / 2, y: n.y, label: 'TALK' }; }
  }
  for (const e of st.world.enemies) {
    if (!e.dazed || e.dead || e === st.boss) continue;
    const d = near(p, e);
    if (d < RAISE_R && d < bd) { bd = d; best = { k: 'raise', enemy: e, x: e.x + e.w / 2, y: e.y, label: 'STAND UP' }; }
  }
  if (st.boss && st.bossState === 'down' && !st.boss.dead && near(p, st.boss) < RAISE_R + 20)
    best = { k: 'boss', enemy: st.boss, x: st.boss.x + st.boss.w / 2, y: st.boss.y, label: 'STAND HIM UP' };
  return best;
}

const RISEN = [
  'Oh. Oh, that is high.',
  'I can see over the wall.',
  'Nobody told us we could do this.',
  'My treads feel strange. Good strange.',
  'Stanky said this was impossible.',
  'Show the others. Show all of them.'
];

function interact() {
  if (!st) return false;
  if (st.dlg) return advance();
  const t = target();
  if (!t) return false;
  if (t.k === 'talk') {
    t.npc.talked = true; st.talked[t.npc.id] = true;
    say(t.npc.lines);
    return true;
  }
  if (t.k === 'raise') { raise(t.enemy); return true; }
  if (t.k === 'boss') { st.bossState = 'raised'; finish(); return true; }
  return false;
}

/* the whole point of the game: a tank goes from lying down to standing */
function raise(e) {
  const w = st.world;
  e.dead = true;
  w.enemies = w.enemies.filter(o => o !== e);
  const cx = e.x + e.w / 2;
  st.npcs.push({
    id: 'risen' + (st.raised + 1), name: 'TANK', kind: 'stand', color: '#3ddc4a',
    x: Math.round(cx - 13), y: Math.round(e.y + e.h - 46), w: 26, h: 46,
    face: st.me.x < e.x ? -1 : 1, lines: [], talked: false, bob: 0, risen: 0
  });
  st.raised++;
  S.burst(w, cx, e.y, '#3ddc4a', 14);
  S.popText(w, cx, e.y - 10, 'UPRIGHT', '#249a2e');
  S.shake(w, 8, st.me.id);
  st.me.cheer = 1;
  st.bubbleFree = { text: RISEN[(st.raised - 1) % RISEN.length], x: cx, y: e.y + e.h - 74, t: 0 };
}

/* ---------------- goals ---------------- */

/* a level asks for one thing, or a short list of them */
function goals() {
  const L = st.level;
  return L.goals || (L.goal ? [L.goal] : []);
}
function oneDone(g) {
  if (g.k === 'talk') return g.ids.every(id => st.talked[id]);
  if (g.k === 'raise') return st.raised >= g.n;
  if (g.k === 'clear') return st.world.enemies.every(e => e.dazed || e.dead);
  if (g.k === 'boss') return st.bossState === 'raised';
  return true;   /* 'reach' — the exit is the goal */
}
function goalDone() { return goals().every(oneDone); }
function goalText() {
  if (st.exitOpen) return 'GO TO THE GATE';
  const g = goals().find(o => !oneDone(o)) || goals()[0];
  if (!g) return '';
  if (g.k === 'raise') return g.label + '  ' + Math.min(st.raised, g.n) + '/' + g.n;
  if (g.k === 'talk') return g.label + '  ' + g.ids.filter(id => st.talked[id]).length + '/' + g.ids.length;
  return g.label;
}

function finish() {
  if (st.done) return;
  st.done = true;
  st.phase = 'outro';
  unlock(st.entry.flat + 1);
  say(st.level.outro || []);
  if (st.level.fadeOut) st.fadeCol = st.level.fadeOut;
}

/* ---------------- the boss ---------------- */

/* Stanky is driven from here rather than by the patrol AI: he lines up,
   charges, and buries himself in a wall, which is the only time he is
   worth hitting. Three times, and he stays down. */
function stepBoss(dt) {
  const b = st.boss, p = st.me, w = st.world;
  if (!b || b.dead) return;
  const hurt = 1 - b.hp / b.maxHp;
  st.bossT -= dt;

  if (st.bossState === 'down') { b.vx = 0; b.dazed = 1; return; }
  b.dazed = 0;

  if (st.bossState === 'wait') {
    b.vx = 0;
    b.face = p.x < b.x ? -1 : 1;
    if (st.bossT <= 0) {
      if (hurt > 0.5 && st.bossAdds < 1) { call(); return; }
      st.bossState = 'charge'; st.bossT = 5;   /* long enough to cross the floor */
      b.vx = (p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1) * S.TYPES.stanky.spd;
      S.popText(w, b.x + b.w / 2, b.y - 16, 'RRRRRR', '#a30f1d');
    }
    return;
  }

  if (st.bossState === 'charge') {
    /* a wall, a ledge or a timeout all end the run */
    if (b.hitWall || st.bossT <= 0) {
      st.bossState = 'stuck'; st.bossT = 3; b.vx = 0; b.stun = 3;
      S.shake(w, 18, p.id); S.burst(w, b.x + b.w / 2, b.y + b.h, '#8a8a90', 14);
      S.popText(w, b.x + b.w / 2, b.y - 16, 'CLANG', '#a30f1d');
    }
    return;
  }

  if (st.bossState === 'stuck') {
    /* buried in the wall: harmless to touch, and the only time he can be hit */
    b.vx = 0; b.dazed = 1;
    if (hurt >= 0.82) { down(); return; }
    if (st.bossT <= 0) { st.bossState = 'wait'; st.bossT = 0.9; }
    return;
  }
}

function call() {
  const w = st.world, b = st.boss;
  st.bossAdds++;
  st.bossState = 'wait'; st.bossT = 1.4;
  for (let i = 0; i < 2; i++) {
    const e = S.makeEnemy(w, 'tank', 200 + i * 260, WH - GROUND - 26 - 200, { raise: true, face: 1 });
    w.enemies.push(e);
    S.burst(w, e.x + e.w / 2, e.y, '#a30f1d', 8);
  }
  say([{ who: 'STANKY', text: 'UP! GET UP AND ROLL OVER HIM!' }]);
}

function down() {
  st.bossState = 'down'; st.boss.dazed = 1; st.boss.vx = 0;
  S.shake(st.world, 20, st.me.id);
  S.burst(st.world, st.boss.x + st.boss.w / 2, st.boss.y + st.boss.h / 2, '#a30f1d', 20);
  st.banner = 'STAND HIM UP'; st.bannerT = 6;
}

/* ---------------- step ---------------- */

function step(dt, edges, inp) {
  if (!st) return null;
  const w = st.world, p = st.me;

  /* bubbles reveal a character at a time and hold the world still */
  if (st.dlg) {
    st.dlg.t += dt;
    st.dlg.chars = Math.min(st.dlg.text.length, st.dlg.chars + dt * 46);
    tickFree(dt);
    if (st.phase === 'outro' && st.level.fadeOut && !st.queue.length) st.fade = Math.min(1, st.fade + dt * 0.5);
    return view();
  }
  if (st.phase === 'outro') { st.phase = 'done'; return view(); }
  if (st.phase === 'done') { if (st.level.fadeOut) st.fade = Math.min(1, st.fade + dt * 0.5); return view(); }

  if (st.bannerT > 0) st.bannerT -= dt;
  tickFree(dt);

  /* input goes to Hanky */
  p.in.x = inp.x; p.in.jump = inp.jump; p.in.a1 = inp.a1; p.in.a2 = inp.a2;
  if (edges.jump) p.pj = true;
  if (edges.a1) p.p1 = true;
  if (edges.a2) p.p2 = true;

  if (st.boss) stepBoss(dt);
  S.step(w, S.TICK);

  /* knocked out is never the end of it — that is the whole premise */
  if (p.dead) {
    st.deathT += dt;
    if (st.deathT > 1.4) restart();
    return view();
  }

  /* npcs stand on their platforms and do not take part in the physics */
  for (const n of st.npcs) { n.bob += dt; if (n.risen !== undefined) n.risen = Math.min(1, n.risen + dt * 2); }

  if (!st.exitOpen && goalDone()) {
    st.exitOpen = true;
    if (!st.exit) finish();
    else { st.banner = 'THE WAY OUT IS OPEN'; st.bannerT = 3.5; }
  }
  if (st.exitOpen && st.exit && !st.done) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (Math.abs(cx - st.exit.x) < 60 && Math.abs(cy - (st.exit.y - 40)) < 90) finish();
  }

  return view();
}

function tickFree(dt) {
  if (st.bubbleFree) { st.bubbleFree.t += dt; if (st.bubbleFree.t > 3.2) st.bubbleFree = null; }
}

function restart() {
  const e = st.entry;
  build(e, { silent: true });
}

/* ---------------- the view handed to the renderer ---------------- */

function view() {
  const w = st.world, t = target();
  const dlg = st.dlg ? {
    who: st.dlg.who, text: st.dlg.text, chars: Math.floor(st.dlg.chars),
    color: VOICES[st.dlg.who] || '#141416',
    anchor: anchor(st.dlg),
    more: st.dlg.chars >= st.dlg.text.length
  } : null;

  return {
    view: {
      mode: 'story', wave: 0, kills: 0, score: 0,
      plats: w.plats, bg: w.bg, players: w.players, enemies: w.enemies,
      bullets: w.bullets, hearts: w.hearts,
      theme: st.theme, npcs: st.npcs,
      exit: st.exit ? { x: st.exit.x, y: st.exit.y, open: st.exitOpen } : null,
      bubble: dlg, aside: st.bubbleFree,
      prompt: t ? { x: t.x, y: t.y, label: t.label } : null,
      objective: goalText(),
      banner: st.bannerT > 0 ? st.banner : '',
      title: st.area.name + ' · ' + st.level.name,
      fade: st.fade > 0 ? { col: st.fadeCol, a: st.fade } : null,
      down: st.me.dead
    },
    me: st.me,
    fx: w.fx
  };
}

/* ---------------- api ---------------- */

function start(areaIdx, levelIdx) {
  const e = levelAt(areaIdx, levelIdx);
  if (!e) return null;
  build(e);
  return st;
}
function current() { return st; }
function done() { return !!st && st.phase === 'done'; }
function nextEntry() {
  if (!st) return null;
  return LEVELS[st.entry.flat + 1] || null;
}
function stop() { st = null; }

return {
  AREAS, LEVELS, THEMES, VOICES,
  start, step, advance, interact, talking, target, current, done, nextEntry, stop,
  unlocked, unlock, resetProgress, levelAt
};
});
