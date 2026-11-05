// The game's colour palette (our own). Light comes from the top left; most
// materials have a light / base / dark shade.

export const OUTLINE = '#2b2433'; // deep plum: outlines and the darkest shade

export const C = {
  outline: OUTLINE,
  white: '#ffffff',
  shadow: '#2b2433',

  grass: ['#8fd067', '#6cb24a', '#4d8c37'], // light, base, dark
  grassEdge: '#3d7230',
  forest: ['#6aa64c', '#4f8a3b', '#3a6b2e'],
  forestEdge: '#2f5a27',
  road: ['#e6d4a8', '#cbb487', '#9c855c'],
  roadEdge: '#7f6a47',
  sand: ['#f6e6ad', '#e3cd8a', '#bfa565'],
  sandEdge: '#a08a4e',
  water: ['#7cc8ef', '#4aa3dc', '#2d78b8'],
  waterEdge: '#1f5687',
  foam: '#e3f6fd',
  earth: ['#b48a5e', '#8e6843', '#674a2f'],
  stone: ['#a9b4bf', '#7f8b98', '#5c6672'],

  canopy: ['#9bd977', '#5db35a', '#3c8a45', '#2a6634'], // highlight, light, base, dark
  trunk: ['#8a5f3a', '#5f3f25'],
  flowerY: '#ffe25c',
  flowerW: '#fff7ea',

  skin: ['#f6cfa6', '#d79c72'],
  metal: ['#eef1f6', '#c3c9d4', '#8a93a3'],
  wood: ['#c08a52', '#9a6a3a', '#6e4a28'],
  leather: ['#8a5a36', '#5e3b22'],
  cloth: ['#5b4a63', '#3e3245'], // trousers
  hardhat: ['#ffe066', '#f2b632', '#b37f1b'],
  wall: ['#f1e9d8', '#cfc4ae', '#a39882'],
  window: ['#9fd0f0', '#3b5578'],

  danger: '#ff9b30',
  dangerEdge: '#e2581c',
  target: '#e8332a',
  targetAlt: '#ffd23f',
  select: '#ffd23f',
  reach: '#3f7fe6',
  reachTint: '#c9dcff',
  eyes: '#ffe14d',

  board: '#dcebf2', // the board's backdrop
  boardDither: '#e8f3f8',
};

// Units: a muted, earthy set. Each ramp runs light -> dark and ends in its
// "edge" shade, which outlines that material instead of a black line.
export const U = {
  skin: ['#ecc9a2', '#c99a76', '#8a5e4a'],
  metal: ['#e1e0d8', '#aeb0ab', '#7c7f84', '#4d4b57'],
  glass: ['#b4d0d6', '#57768a', '#33435a'],
  wood: ['#a98257', '#7e5d3f', '#4f3a2a'],
  leather: ['#8f6a4a', '#674b36', '#3f2e24'],
  cloth: ['#615664', '#3b3242'],
  hood: ['#2a2230'],
  glow: ['#f5dc7a', '#c79f3c'],
  spark: ['#fff6d8', '#c79f3c'],
};

/** Team colours: main, light, dark, plus marker colours for its orders. */
export const TEAM = {
  player: { main: '#3f7fe6', light: '#86b6ff', dark: '#24508f', order: '#2f6fe0', plate: '#3f7fe6',
    unit: ['#93b2da', '#5f83bb', '#41608f', '#2c3f63'] },
  cpu: { main: '#dc4b3c', light: '#ff8f72', dark: '#8f2b23', order: '#e23b2e', plate: '#dc4b3c',
    unit: ['#e5a08a', '#c3654f', '#8e4437', '#5c2c26'] },
};

/** Every unit ramp (all but the team ones), for edge lookups and tests. */
export const UNIT_RAMPS = Object.values(U);

export const teamOf = (team) => TEAM[team] ?? TEAM.cpu;
