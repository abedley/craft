// Preset boards for the debug UI. The first ones are player-vs-CPU matches;
// the rest are rule demos where every unit is on the player's team and
// orders are pre-queued so pressing End turn shows a specific rule.
//
// The board is flat-topped hexes (see engine/hex.js). Columns are straight
// up/down lines, so most demos run down column 3.

import { Game, move, attack, charge } from './engine/index.js';

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

  'Queue: first come, first served': () => {
    // Both want (3,2). Unit 2 is first in the queue, so it gets there; when
    // unit 1's turn comes the hex is occupied.
    const g = board([{ x: 3, y: 1 }, { x: 3, y: 3 }]);
    g.queueOrder(2, move(3, 2));
    g.queueOrder(1, move(3, 2));
    return g;
  },

  'Queue: swap is blocked': () => {
    // Each wants the other's hex; whichever goes first finds it occupied, and
    // so does the other.
    const g = board([{ x: 3, y: 3 }, { x: 3, y: 4 }]);
    g.queueOrder(1, move(3, 7));
    g.queueOrder(2, move(3, 0));
    return g;
  },

  'Queue: line, front first': () => {
    // The front unit is first in the queue, so each one frees the hex for the next.
    const g = board([{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }]);
    for (const id of [3, 2, 1]) g.queueOrder(id, move(3, 7));
    return g;
  },

  'Queue: line, back first': () => {
    // The back unit goes first and walks into the one ahead: blocked. Only
    // the front unit moves this turn.
    const g = board([{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }]);
    for (const id of [1, 2, 3]) g.queueOrder(id, move(3, 7));
    return g;
  },

  'Queue: fast unit stuck behind slow': () => {
    // Speed 3 doesn't help if you're queued behind the unit in your way.
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
    // The shot flies 4 hexes when fired, keeps flying next turn (first in the
    // queue), and hits unit 2. Unit 3 behind it is shielded.
    const g = board([{ x: 3, y: 0, type: GS }, { x: 3, y: 6 }, { x: 3, y: 7 }]);
    g.queueOrder(1, attack('down'));
    return g;
  },

  'Gunslinger: dodge by queue order': () => {
    // Unit 2 steps off the column BEFORE the shot in the queue: safe.
    // Unit 3 steps into the column AFTER the shot has passed: also safe.
    // Unit 4 tries to step away after the shot: too late, it's hit.
    const g = board([{ x: 3, y: 0, type: GS }, { x: 3, y: 2 }, { x: 4, y: 4 }, { x: 3, y: 3 }]);
    g.queueOrder(2, move(2, 2));
    g.queueOrder(1, attack('down'));
    g.queueOrder(3, move(3, 4));
    g.queueOrder(4, move(4, 3));
    return g;
  },

  'Gunslinger: duel': () => {
    // Facing each other 3 apart: unit 2 is first in the queue, so its shot
    // lands and unit 1 never fires.
    const g = board([{ x: 3, y: 1, type: GS }, { x: 3, y: 4, type: GS }]);
    g.queueOrder(2, attack('up'));
    g.queueOrder(1, attack('down'));
    return g;
  },

  'Gunslinger: enemy next to it': () => {
    // Left: an enemy is beside gunslinger 1 when its shot comes up: the shot fails.
    // Right: enemy 6 steps beside gunslinger 4 only AFTER its shot: too late,
    // the shot was already fired and hits.
    const g = board([
      { x: 1, y: 1, type: GS }, { x: 1, y: 5, team: C }, { x: 0, y: 1, team: C },
      { x: 5, y: 1, type: GS }, { x: 5, y: 5, team: C }, { x: 6, y: 3, team: C },
    ]);
    g.queueOrder(1, attack('down'));
    g.queueOrder(4, attack('down'));
    g.queueOrder(6, move(6, 1));
    return g;
  },

  'Pikeman: charge': () => {
    // Gunslinger 3 (CPU team) is about to shoot down at gunslinger 1. Pikeman
    // 2 charges 3 hexes up next to it: the charge is at the front of the
    // queue, so when the shot comes up an enemy is beside the gunslinger and
    // the shot fails.
    const g = board([{ x: 1, y: 3, type: GS }, { x: 0, y: 4 }, { x: 1, y: 0, type: GS, team: C }]);
    g.queueOrder(3, attack('down'));
    g.queueOrder(2, charge(0, 1));
    return g;
  },

  'Pikeman: strike': () => {
    // Unit 2 steps out before the strike (earlier in the queue): safe.
    // Unit 3 steps into the struck hexes after the strike: also safe.
    // Unit 4 stays put in reach: hit (friendly fire).
    const g = board([{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }]);
    g.queueOrder(2, move(2, 3));
    g.queueOrder(1, attack('down'));
    g.queueOrder(3, move(3, 3));
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
