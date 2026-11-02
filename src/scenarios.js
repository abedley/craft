// Preset boards for exercising the engine from the debug UI. Each one sets
// up units and queues orders so pressing Tick shows a specific collision rule.

import { Game, move } from './engine/index.js';

const SIZE = 8;

export const scenarios = {
  'Empty 8x8': () => new Game({ width: SIZE, height: SIZE }),

  'Sandbox': () => new Game({
    width: SIZE, height: SIZE,
    units: [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 1, y: 6 }, { x: 6, y: 6 }, { x: 3, y: 3 }],
  }),

  'Contest (lowest id wins)': () => {
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
