// The core rule: the order queue runs front to back, and each entry happens
// in full before the next one starts. Columns are straight up/down hex lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, move, attack } from '../src/engine/index.js';

const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
const col = (height, units) => new Game({ width: 1, height, units: units.map(([y, extra = {}]) => ({ x: 0, y, ...extra })) });
const blocked = (events) => events.filter((e) => e.type === 'blocked').map((e) => [e.unitId, e.reason, e.by]);

test('a move walks up to `speed` hexes per turn, then carries over until it arrives', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, move(3, 3)); // 5 hexes away, speed 1
  const path = [];
  let events;
  for (let i = 0; i < 5; i++) {
    events = g.tick();
    path.push(pos(g, 1));
    if (i < 4) assert.deepEqual(g.queue, [{ unitId: 1, order: move(3, 3), carried: true }]);
  }
  assert.deepEqual(path, [[1, 0], [1, 1], [2, 2], [2, 3], [3, 3]]);
  assert.deepEqual(g.queue, []);
  assert.ok(events.some((e) => e.type === 'arrived' && e.unitId === 1));
});

test('orders do nothing until the turn runs; a new order replaces the unit\'s old one', () => {
  const g = col(5, [[2]]);
  g.queueOrder(1, move(0, 0));
  g.queueOrder(1, move(0, 4));
  assert.equal(g.queue.length, 1);
  assert.deepEqual(pos(g, 1), [0, 2]);
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
});

test('invalid orders are rejected', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 0, y: 0 }] });
  assert.throws(() => g.queueOrder(1, move(3, 0)), /out of bounds/);
  assert.throws(() => g.queueOrder(1, move(1.5, 0)), /integers/);
  assert.throws(() => g.queueOrder(99, move(1, 1)), /No unit/);
});

test('the earlier entry gets the hex; the later one is blocked', () => {
  for (const first of [1, 2]) {
    const g = col(5, [[1], [3]]);
    const other = 3 - first;
    g.queueOrder(first, move(0, 2));
    g.queueOrder(other, move(0, 2));
    const events = g.tick();
    assert.equal(g.unitAt(0, 2).id, first);
    assert.deepEqual(blocked(events), [[other, 'occupied', first]]);
  }
});

test('two units swapping places: neither can move', () => {
  const g = col(4, [[1], [2]]);
  g.queueOrder(1, move(0, 2));
  g.queueOrder(2, move(0, 1));
  const events = g.tick();
  assert.deepEqual([pos(g, 1), pos(g, 2)], [[0, 1], [0, 2]]);
  assert.deepEqual(blocked(events), [[1, 'occupied', 2], [2, 'occupied', 1]]);
});

test('a line moves together only if the front unit goes first', () => {
  const frontFirst = col(6, [[0], [1], [2]]);
  for (const id of [3, 2, 1]) frontFirst.queueOrder(id, move(0, 5));
  frontFirst.tick();
  assert.deepEqual([1, 2, 3].map((id) => pos(frontFirst, id)[1]), [1, 2, 3]);

  const backFirst = col(6, [[0], [1], [2]]);
  for (const id of [1, 2, 3]) backFirst.queueOrder(id, move(0, 5));
  const events = backFirst.tick();
  assert.deepEqual([1, 2, 3].map((id) => pos(backFirst, id)[1]), [0, 1, 3]);
  assert.deepEqual(blocked(events), [[1, 'occupied', 2], [2, 'occupied', 3]]);
});

test('speed: a fast unit covers several hexes in its entry and stops early when blocked', () => {
  const g = col(8, [[0, { speed: 3 }], [5]]);
  g.queueOrder(1, move(0, 7));
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 4], 'stopped next to the unit at (0,5)');
  assert.deepEqual(blocked(events), [[1, 'occupied', 2]]);
});

test('speed does not buy priority: the queue does', () => {
  // A speed-3 unit queued after a speed-1 unit loses the hex they both want.
  const g = col(8, [[0, { speed: 3 }], [4]]);
  g.queueOrder(2, move(0, 3));
  g.queueOrder(1, move(0, 3));
  g.tick();
  assert.deepEqual(pos(g, 2), [0, 3]);
  assert.deepEqual(pos(g, 1), [0, 2]);
});

test('carried-over entries come first next turn, in the order they ran', () => {
  const g = col(10, [[0], [9]]);
  g.queueOrder(2, move(0, 5));
  g.queueOrder(1, move(0, 3));
  g.tick();
  assert.deepEqual(g.queue.map((e) => [e.unitId, e.carried]), [[2, true], [1, true]]);
  g.queueOrder(2, move(0, 9)); // a new order replaces unit 2's carried walk and goes to the back
  assert.deepEqual(g.queue.map((e) => e.unitId), [1, 2]);
});

test('events say which queue step caused them', () => {
  const g = col(6, [[0, { type: 'gunslinger' }], [3]]);
  g.queueOrder(2, move(0, 5));
  g.queueOrder(1, attack('down'));
  const events = g.tick();
  assert.deepEqual(events.filter((e) => e.type === 'moved' || e.type === 'shot').map((e) => [e.type, e.step]), [['moved', 1], ['shot', 2]]);
});

test('speed validation', () => {
  const g = new Game({ width: 3, height: 3 });
  assert.throws(() => g.addUnit(0, 0, undefined, { speed: 0 }), /Speed/);
  assert.throws(() => g.addUnit(0, 0, undefined, { speed: 1.5 }), /Speed/);
});

test('replaying the same orders gives the same state; snapshots round-trip', () => {
  const run = () => {
    const g = new Game({
      width: 6, height: 6,
      units: [{ x: 0, y: 0 }, { x: 5, y: 5, speed: 2 }, { x: 0, y: 5, type: 'gunslinger' }, { x: 5, y: 0 }],
    });
    g.queueOrder(1, move(5, 5));
    g.queueOrder(2, move(0, 0));
    g.queueOrder(3, attack('up-right'));
    g.queueOrder(4, move(0, 5));
    g.tick();
    const mid = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
    assert.equal(mid.hash(), g.hash());
    for (let i = 0; i < 6; i++) mid.tick();
    return mid.hash();
  };
  assert.equal(run(), run());
});

test('saves from the old turn rules are rejected with a clear error', () => {
  const old = { grid: 'hex', width: 3, height: 3, tick: 0, nextUnitId: 1, units: [], queue: [], projectiles: [] };
  assert.throws(() => Game.fromSnapshot(old), /older version of the turn rules/);
});
