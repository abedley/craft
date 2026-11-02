import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, move } from '../src/engine/index.js';

const pos = (game, id) => {
  const u = game.getUnit(id);
  return [u.x, u.y];
};
const line = (units) => new Game({ width: 8, height: 1, units: units.map(([x, speed]) => ({ x, y: 0, speed })) });
const blockedEvents = (events) => events.filter((e) => e.type === 'blocked').map((e) => [e.unitId, e.reason, e.by]);

test('a speed-3 unit moves 3 cells in one tick and reports its path', () => {
  const g = line([[0, 3]]);
  g.queueOrder(1, move(7, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [3, 0]);
  const moved = events.find((e) => e.type === 'moved');
  assert.deepEqual(moved.path, [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('a fast unit stops at its target mid-tick', () => {
  const g = line([[0, 4]]);
  g.queueOrder(1, move(2, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [2, 0]);
  assert.equal(g.getUnit(1).order, null);
  assert.ok(events.some((e) => e.type === 'arrived'));
});

test('the unit that physically arrives first keeps the cell, even if ordered later', () => {
  // Unit 2 (speed 1) is ordered first, but unit 1 (speed 3) reaches (2,0)
  // at t=2/3, before unit 2 gets there at t=1.
  const g = line([[0, 3], [3, 1]]);
  g.queueOrder(2, move(2, 0));
  g.queueOrder(1, move(2, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [2, 0]);
  assert.deepEqual(pos(g, 2), [3, 0]);
  assert.deepEqual(blockedEvents(events), [[2, 'occupied', 1]]);
});

test('same-instant arrival with mixed speeds: first ordered wins', () => {
  // Unit 1 (speed 2) and unit 2 (speed 1) both reach (2,0) at t=1.
  const g = line([[0, 2], [3, 1]]);
  g.queueOrder(2, move(2, 0));
  g.queueOrder(1, move(2, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 2), [2, 0]);
  assert.deepEqual(pos(g, 1), [1, 0]); // got halfway, then lost the contest
  assert.deepEqual(blockedEvents(events), [[1, 'contested', 2]]);
});

test('a fast unit cannot jump over a unit in its way', () => {
  const g = line([[0, 3], [2, 1]]);
  g.queueOrder(1, move(5, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [1, 0]);
  assert.deepEqual(pos(g, 2), [2, 0]);
  assert.deepEqual(blockedEvents(events), [[1, 'occupied', 2]]);
});

test('fast unit behind a slow one is held to the slow pace', () => {
  // t=1/2: unit 1 steps into unit 2's cell while 2 stands still -> blocked.
  // t=1:   both step; 2 leaves its cell so 1 can follow (train).
  const g = line([[0, 2], [1, 1]]);
  g.queueOrder(1, move(7, 0));
  g.queueOrder(2, move(7, 0));
  g.tick();
  assert.deepEqual(pos(g, 1), [1, 0]);
  assert.deepEqual(pos(g, 2), [2, 0]);
});

test('mid-tick head-on swap blocks both', () => {
  // t=1/2: unit 1 steps to (1,0). t=1: 1 wants (2,0), 2 wants (1,0) -> swap.
  const g = line([[0, 2], [2, 1]]);
  g.queueOrder(1, move(7, 0));
  g.queueOrder(2, move(0, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [1, 0]);
  assert.deepEqual(pos(g, 2), [2, 0]);
  assert.deepEqual(blockedEvents(events), [[1, 'swap', 2], [2, 'swap', 1]]);
});

test('a blocked fast unit retries at its next step within the tick', () => {
  // Unit 2 (speed 1) leaves (1,0) at t=1. Unit 1 (speed 4) is blocked at
  // t=1/4, 2/4, 3/4 and follows into (1,0) at t=1.
  const g = line([[0, 4], [1, 1]]);
  g.queueOrder(1, move(7, 0));
  g.queueOrder(2, move(7, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [1, 0]);
  assert.deepEqual(pos(g, 2), [2, 0]);
  const b = events.find((e) => e.type === 'blocked');
  assert.equal(b.time, '1/4'); // first time it was blocked
});

test('speed validation', () => {
  const g = new Game({ width: 3, height: 3 });
  assert.throws(() => g.addUnit(0, 0, undefined, { speed: 0 }), /Speed/);
  assert.throws(() => g.addUnit(0, 0, undefined, { speed: 1.5 }), /Speed/);
});

test('mixed-speed replay is deterministic', () => {
  const run = () => {
    const g = new Game({
      width: 8, height: 8,
      units: [{ x: 0, y: 0, speed: 3 }, { x: 7, y: 7, speed: 2 }, { x: 0, y: 7 }, { x: 7, y: 0, speed: 4 }, { x: 3, y: 3, speed: 5 }],
    });
    g.queueOrder(1, move(7, 7));
    g.queueOrder(2, move(0, 0));
    g.queueOrder(3, move(7, 0));
    g.queueOrder(4, move(0, 7));
    g.queueOrder(5, move(3, 4));
    for (let i = 0; i < 10; i++) g.tick();
    return g.hash();
  };
  assert.equal(run(), run());
});
