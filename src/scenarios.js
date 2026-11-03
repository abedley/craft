// Preset boards for the debug UI. The first ones are player-vs-CPU matches;
// the rest are rule demos where every unit is on the player's team and
// orders are pre-queued so pressing End turn shows a specific rule.
//
// The board is flat-topped hexes (see engine/hex.js). Columns are straight
// up/down lines, so most demos run down column 3.

import { Game, move, attack } from './engine/index.js';

const W = 8;
const H = 8;

const P = 'player';
const C = 'cpu';
const GS = 'gunslinger';

const board = (units = [], terrain = null) => new Game({ width: W, height: H, units, terrain });

// Terrain maps: one string per row, one character per hex (src/data/terrain.json):
//   . grass   = road   f forest   s sand   ~ water (units can't walk on it)
const RIVER_MAP = [
  '.=......',
  '.=...ff.',
  '.=...ff.',
  '~=~~~~=~', // a river with two bridges
  '.s....=.',
  '.ff...=.',
  '.ff...=.',
  '......=.',
];

const LAKE_MAP = [
  '........',
  '........',
  '..~~~~..',
  '..~~~~..',
  '..~~~~..',
  '...ss...',
  '........',
  '........',
];

export const scenarios = {
  'Skirmish vs CPU': () => board([
    { x: 1, y: 7, type: GS, team: P }, { x: 3, y: 6, team: P }, { x: 4, y: 7, team: P }, { x: 6, y: 7, type: GS, team: P },
    { x: 1, y: 0, type: GS, team: C }, { x: 3, y: 0, team: C }, { x: 4, y: 0, team: C }, { x: 6, y: 0, type: GS, team: C },
  ], RIVER_MAP),

  'Open field vs CPU': () => board([
    { x: 1, y: 7, type: GS, team: P }, { x: 3, y: 6, team: P }, { x: 4, y: 7, team: P }, { x: 6, y: 7, type: GS, team: P },
    { x: 1, y: 0, type: GS, team: C }, { x: 3, y: 0, team: C }, { x: 4, y: 0, team: C }, { x: 6, y: 0, type: GS, team: C },
  ]),

  'Duel vs CPU': () => board([{ x: 0, y: 7, type: GS, team: P }, { x: 7, y: 0, type: GS, team: C }]),

  'Empty board': () => board(),

  'Sandbox': () => board([{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 1, y: 6 }, { x: 6, y: 6 }, { x: 3, y: 3 }]),

  'Terrain: walk around a lake': () => {
    // Units path around water; Preview shows the route bending round the lake.
    const g = board([{ x: 3, y: 0 }, { x: 4, y: 7, type: GS }], LAKE_MAP);
    g.queueOrder(1, move(3, 7));
    g.queueOrder(2, attack('up')); // shots fly over water
    return g;
  },

  'Contest (first ordered wins)': () => {
    const g = board([{ x: 3, y: 1 }, { x: 3, y: 3 }]);
    g.queueOrder(2, move(3, 2));
    g.queueOrder(1, move(3, 2));
    return g;
  },

  'Head-on swap': () => {
    const g = board([{ x: 3, y: 3 }, { x: 3, y: 4 }]);
    g.queueOrder(1, move(3, 7));
    g.queueOrder(2, move(3, 0));
    return g;
  },

  'Train': () => {
    const g = board([{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }]);
    for (const id of [1, 2, 3]) g.queueOrder(id, move(3, 7));
    return g;
  },

  'Blocked line': () => {
    const g = board([{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }]);
    for (const id of [1, 2, 3]) g.queueOrder(id, move(3, 7));
    return g;
  },

  'Rotation': () => {
    // Three mutually adjacent hexes; each unit steps into the next one's.
    const g = board([{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 }]);
    g.queueOrder(1, move(3, 4));
    g.queueOrder(2, move(4, 4));
    g.queueOrder(3, move(3, 3));
    return g;
  },

  'Fast arrives first': () => {
    // Unit 2 is ordered first, but speed-3 unit 1 reaches (3,3) at t=2/3,
    // before unit 2 gets there at t=1, so unit 1 keeps it.
    const g = board([{ x: 3, y: 1, speed: 3 }, { x: 3, y: 4 }]);
    g.queueOrder(2, move(3, 3));
    g.queueOrder(1, move(3, 3));
    return g;
  },

  'Fast behind slow': () => {
    const g = board([{ x: 3, y: 0, speed: 3 }, { x: 3, y: 1 }]);
    g.queueOrder(1, move(3, 7));
    g.queueOrder(2, move(3, 7));
    return g;
  },

  'Mixed speeds': () => {
    const g = board([{ x: 0, y: 0, speed: 3 }, { x: 7, y: 0, speed: 2 }, { x: 0, y: 7 }, { x: 7, y: 7, speed: 4 }]);
    g.queueOrder(1, move(7, 7));
    g.queueOrder(2, move(0, 7));
    g.queueOrder(3, move(7, 0));
    g.queueOrder(4, move(0, 0));
    return g;
  },

  'Gunslinger: shot': () => {
    const g = board([{ x: 3, y: 0, type: GS }, { x: 3, y: 6 }, { x: 3, y: 7 }]);
    g.queueOrder(1, attack('down')); // hits unit 2 at t=6/4; unit 3 is shielded
    return g;
  },

  'Gunslinger: dodge': () => {
    // Unit 2 steps out of the column at t=1; the shot reaches y=5 at t=5/4.
    // Unit 3 walks into the column at t=1, the instant the shot reaches (3,4).
    const g = board([{ x: 3, y: 0, type: GS }, { x: 3, y: 5 }, { x: 4, y: 4 }]);
    g.queueOrder(1, attack('down'));
    g.queueOrder(2, move(2, 5));
    g.queueOrder(3, move(3, 4));
    return g;
  },

  'Gunslinger: duel': () => {
    const g = board([{ x: 3, y: 0, type: GS }, { x: 3, y: 7, type: GS }, { x: 4, y: 3 }]);
    g.queueOrder(1, attack('down'));
    g.queueOrder(2, attack('up'));
    // Unit 3 steps into (3,3) at t=1, the same instant unit 2's shot gets
    // there, and takes the bullet. Unit 1's shot passed (3,3) at t=3/4 and
    // goes on to kill unit 2. Unit 1 survives.
    g.queueOrder(3, move(3, 3));
    return g;
  },

  'Pikeman: strike': () => {
    // Unit 1 strikes the two hexes below it at the end of the tick.
    // Unit 2 steps out of reach in time; unit 3 walks in and is hit
    // (all three are on the same team: friendly fire).
    const g = board([{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }]);
    g.queueOrder(1, attack('down'));
    g.queueOrder(2, move(2, 3));
    g.queueOrder(3, move(3, 4));
    return g;
  },

  'Crossroads': () => {
    const g = board([{ x: 0, y: 3 }, { x: 7, y: 4 }, { x: 3, y: 0 }, { x: 4, y: 7 }]);
    g.queueOrder(1, move(7, 3));
    g.queueOrder(2, move(0, 4));
    g.queueOrder(3, move(3, 7));
    g.queueOrder(4, move(4, 0));
    return g;
  },
};
