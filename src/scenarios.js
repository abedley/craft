// Preset boards for the debug UI. The first ones are player-vs-CPU matches;
// the rest are rule demos where every unit is on the player's team and
// orders are pre-queued so pressing End turn shows a specific rule.

import { Game, move, shoot } from './engine/index.js';

const SIZE = 8;

const P = 'player';
const C = 'cpu';
const GS = 'gunslinger';

export const scenarios = {
  'Skirmish vs CPU': () => new Game({
    width: SIZE, height: SIZE,
    units: [
      { x: 1, y: 7, type: GS, team: P }, { x: 3, y: 7, team: P }, { x: 4, y: 7, team: P }, { x: 6, y: 7, type: GS, team: P },
      { x: 1, y: 0, type: GS, team: C }, { x: 3, y: 0, team: C }, { x: 4, y: 0, team: C }, { x: 6, y: 0, type: GS, team: C },
    ],
  }),

  'Duel vs CPU': () => new Game({
    width: SIZE, height: SIZE,
    units: [{ x: 0, y: 7, type: GS, team: P }, { x: 7, y: 0, type: GS, team: C }],
  }),

  'Empty 8x8': () => new Game({ width: SIZE, height: SIZE }),

  'Sandbox': () => new Game({
    width: SIZE, height: SIZE,
    units: [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 1, y: 6 }, { x: 6, y: 6 }, { x: 3, y: 3 }],
  }),

  'Contest (first ordered wins)': () => {
    const g = new Game({ width: SIZE, height: SIZE, units: [{ x: 2, y: 3 }, { x: 4, y: 3 }] });
    g.queueOrder(2, move(3, 3));
    g.queueOrder(1, move(3, 3));
    return g;
  },

  'Head-on swap': () => {
    const g = new Game({ width: SIZE, height: SIZE, units: [{ x: 3, y: 3 }, { x: 4, y: 3 }] });
    g.queueOrder(1, move(7, 3));
    g.queueOrder(2, move(0, 3));
    return g;
  },

  'Train': () => {
    const g = new Game({ width: SIZE, height: SIZE, units: [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }] });
    for (const id of [1, 2, 3]) g.queueOrder(id, move(7, 3));
    return g;
  },

  'Blocked line': () => {
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 5, y: 3 }],
    });
    for (const id of [1, 2, 3]) g.queueOrder(id, move(7, 3));
    return g;
  },

  'Rotation': () => {
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }],
    });
    g.queueOrder(1, move(4, 3));
    g.queueOrder(2, move(4, 4));
    g.queueOrder(3, move(3, 4));
    g.queueOrder(4, move(3, 3));
    return g;
  },

  'Fast arrives first': () => {
    // Unit 2 is ordered first, but speed-3 unit 1 reaches (3,3) at t=2/3,
    // before unit 2 gets there at t=1, so unit 1 keeps it.
    const g = new Game({ width: SIZE, height: SIZE, units: [{ x: 1, y: 3, speed: 3 }, { x: 4, y: 3 }] });
    g.queueOrder(2, move(3, 3));
    g.queueOrder(1, move(3, 3));
    return g;
  },

  'Fast behind slow': () => {
    const g = new Game({ width: SIZE, height: SIZE, units: [{ x: 0, y: 3, speed: 3 }, { x: 1, y: 3 }] });
    g.queueOrder(1, move(7, 3));
    g.queueOrder(2, move(7, 3));
    return g;
  },

  'Mixed speeds': () => {
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 0, y: 0, speed: 3 }, { x: 7, y: 0, speed: 2 }, { x: 0, y: 7 }, { x: 7, y: 7, speed: 4 }],
    });
    g.queueOrder(1, move(7, 7));
    g.queueOrder(2, move(0, 7));
    g.queueOrder(3, move(7, 0));
    g.queueOrder(4, move(0, 0));
    return g;
  },

  'Gunslinger: shot': () => {
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 0, y: 3, type: 'gunslinger' }, { x: 6, y: 3 }, { x: 7, y: 3 }],
    });
    g.queueOrder(1, shoot('right')); // hits unit 2 at t=6/4; unit 3 is shielded
    return g;
  },

  'Gunslinger: dodge': () => {
    // Unit 2 steps out of the line at t=1; the shot reaches x=5 at t=5/4.
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 0, y: 3, type: 'gunslinger' }, { x: 5, y: 3 }, { x: 4, y: 4 }],
    });
    g.queueOrder(1, shoot('right'));
    g.queueOrder(2, move(5, 2));
    g.queueOrder(3, move(4, 3)); // ...but unit 3 walks into its path at t=1
    return g;
  },

  'Gunslinger: duel': () => {
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 0, y: 2, type: 'gunslinger' }, { x: 7, y: 2, type: 'gunslinger' }, { x: 3, y: 3 }],
    });
    g.queueOrder(1, shoot('right'));
    g.queueOrder(2, shoot('left'));
    // Unit 3 steps into (3,2) at t=1, the same instant unit 2's shot gets
    // there, and takes the bullet. Unit 1's shot passed (3,2) at t=3/4 and
    // goes on to kill unit 2. Unit 1 survives.
    g.queueOrder(3, move(3, 2));
    return g;
  },

  'Crossroads': () => {
    const g = new Game({
      width: SIZE, height: SIZE,
      units: [{ x: 0, y: 3 }, { x: 7, y: 4 }, { x: 3, y: 0 }, { x: 4, y: 7 }],
    });
    g.queueOrder(1, move(7, 3));
    g.queueOrder(2, move(0, 4));
    g.queueOrder(3, move(3, 7));
    g.queueOrder(4, move(4, 0));
    return g;
  },
};
