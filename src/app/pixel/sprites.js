// Pixel sprites, written as text. One character per pixel:
//   .  clear        O  outline (dark)      L  always light     D  always dark
//   B  team body (player: light, CPU: dark)
//   H  team detail (player: dark, CPU: light)
//   x  dark on a checkerboard (shading), clear elsewhere
//   s  body shading (player: checkerboard dark/light, CPU: dark)
// Unit sprites are 15 wide by 22 tall and face right; their feet are on row
// 20. CPU sprites are mirrored so the two sides face each other.

import { LIGHT, DARK } from './raster.js';

export const FOOT_ROW = 20;

export const UNITS = {
  pikeman: [
    '...........O...',
    '..........OLO..',
    '..........OLO..',
    '...........O...',
    '....OOO....O...',
    '...OBBBO...O...',
    '..OOOOOOO..O...',
    '....OBBO...O...',
    '....OBBO...O...',
    '...OOOOOO..O...',
    '..OBBHBBBO.O...',
    '..OBBHBBBOOO...',
    '..OBBHBBBO.O...',
    '..OBBHBBsO.O...',
    '...OBHBsO..O...',
    '...OOOOOO..O...',
    '...OBOOBO..O...',
    '...OBOOBO..O...',
    '...OBOOBO..O...',
    '...OBOOBO..O...',
    '..OOOOOOOO.O...',
    '...............',
  ],
  gunslinger: [
    '...............',
    '...............',
    '...............',
    '....OOOO.......',
    '....OBBO.......',
    '..OOOOOOOO.....',
    '....OBBO.......',
    '....OHHO.......',
    '...OOOOOO......',
    '..OBBBBBBO.....',
    '..OBHBBBBOOOOO.',
    '..OBHBBBBOOOOOO',
    '..OBHBBBBO.OO..',
    '..OHHHHHHO.....',
    '..OBBBBBsO.....',
    '.OBBBBBBssO....',
    '.OOOOOOOOOO....',
    '...OBOOBO......',
    '...OBOOBO......',
    '...OBOOBO......',
    '..OOOOOOOO.....',
    '...............',
  ],
  stalker: [
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '.....OOOO......',
    '....OBBBBO.....',
    '...OBBBDDDO....',
    '...OBBDLDLO....',
    '...OBBDDDDO....',
    '..OBBBBBBO.....',
    '..OBsBBBBBO....',
    '.OBsBBBBBBO....',
    '.OBsBBBBBBBO...',
    'OBsBBBBBBBBO...',
    'OBssBBBBBBBBO..',
    'OBssBBBBBBBBO..',
    'OBsssBBBBBBBBO.',
    'OOOOOOOOOOOOOO.',
    '...............',
  ],
  builder: [
    '...............',
    '............OOO',
    '...........OOOO',
    '............OO.',
    '......OOOO..O..',
    '.....OBBBBO.O..',
    '....OOOOOOOOO..',
    '......OBBO..O..',
    '......OBBO.O...',
    '.....OOOOOOO...',
    '....OBHBBHBO...',
    '....OBHBBHBO...',
    '....OBHHHHBO...',
    '....OBHBBHsO...',
    '.....OBBBsO....',
    '.....OOOOOO....',
    'OOOO.OBOOBO....',
    'OLDO.OBOOBO....',
    'ODLO.OBOOBO....',
    'OLDO.OBOOBO....',
    'OOOOOOOOOOOO...',
    '...............',
  ],
  generic: [
    '...............',
    '...............',
    '...............',
    '...............',
    '.....OOOO......',
    '....OBBBBO.....',
    '....OBBBBO.....',
    '....OBBBBO.....',
    '.....OOOO......',
    '...OOOOOOOO....',
    '..OBBBBBBBBO...',
    '..OBBBHHBBBO...',
    '..OBBHHHHBBO...',
    '..OBBBHHBBsO...',
    '...OBBBBBsO....',
    '...OOOOOOOO....',
    '....OBOOBO.....',
    '....OBOOBO.....',
    '....OBOOBO.....',
    '....OBOOBO.....',
    '...OOOOOOOO....',
    '...............',
  ],
};

export const TREE = [
  '...OOOOO...',
  '..OLLLLLO..',
  '.OLLLLLLLO.',
  'OLLLLLLLxLO',
  'OLLLLLLxLxO',
  'OLLLLLxLxxO',
  '.OLLxLxxxO.',
  '..OOOOOOO..',
  '....OLO....',
  '....ODO....',
  '...OOOOO...',
];

export const MINE = [
  '..O.O..',
  '.OBBBO.',
  'OOBHBOO',
  '.OBBBO.',
  '..O.O..',
];

export const STAR = [
  '...O...',
  '..OLO..',
  'OOOLOOO',
  'OLLLLLO',
  '.OLLLO.',
  '.OLOLO.',
  'OO...OO',
];

export const DIES = [
  'OOOOOOOOO',
  'ODDDDDDDO',
  'ODLDDDLDO',
  'ODDLDLDDO',
  'ODDDLDDDO',
  'ODDLDLDDO',
  'ODLDDDLDO',
  'ODDDDDDDO',
  'OOOOOOOOO',
];

export const GOAL_FLAG = [
  'OOOOOOOO..',
  'OLDLDLDLO.',
  'ODLDLDLDLO',
  'OLDLDLDLO.',
  'OOOOOOOO..',
  'O.........',
  'O.........',
  'O.........',
  'O.........',
  'O.........',
  'O.........',
  'O.........',
  'O.........',
  'OO........',
];

export const BULLET = [
  'x.xOO.',
  '.xOLLO',
  'x.xOO.',
];

const cache = new Map();

/** Colour of one sprite character for a team (null = clear). */
export function colorOf(ch, team, x, y) {
  const cpu = team === 'cpu';
  switch (ch) {
    case 'O': case 'D': return DARK;
    case 'L': return LIGHT;
    case 'B': return cpu ? DARK : LIGHT;
    case 'H': return cpu ? LIGHT : DARK;
    case 'x': return ((x + y) & 1) === 0 ? DARK : null;
    case 's': return cpu || ((x + y) & 1) === 0 ? DARK : LIGHT;
    default: return null;
  }
}

/** The sprite as a canvas (cached), mirrored if asked. */
export function spriteCanvas(rows, { team = 'player', mirror = false, key = rows } = {}) {
  const id = `${typeof key === 'string' ? key : rows.join('/')}|${team}|${mirror}`;
  if (cache.has(id)) return cache.get(id);
  const w = rows[0].length;
  const h = rows.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = colorOf(ch, team, x, y);
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(mirror ? w - 1 - x : x, y, 1, 1);
    });
  });
  cache.set(id, c);
  return c;
}

/** A unit's sprite canvas (CPU units face left). */
export function unitSprite(type, team) {
  const rows = UNITS[type] ?? UNITS.generic;
  return spriteCanvas(rows, { team, mirror: team === 'cpu', key: `unit:${UNITS[type] ? type : 'generic'}` });
}

export const SPRITE_KEYS = new Set(['.', 'O', 'L', 'D', 'B', 'H', 'x', 's']);
export const ALL_SPRITES = { ...Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [`unit:${k}`, v])), TREE, MINE, STAR, DIES, GOAL_FLAG, BULLET };
