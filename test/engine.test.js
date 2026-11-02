import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, move, resolveMoves } from '../src/engine/index.js';

const pos = (game, id) => {
  const u = game.getUnit(id);
  return [u.x, u.y];
};

test('move order walks one cell per tick and clears on arrival', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, move(2, 1));
  g.tick();
  assert.deepEqual(pos(g, 1), [1, 0]);
  g.tick();
  assert.deepEqual(pos(g, 1), [2, 0]); // tie on axis gap -> x first
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [2, 1]);
  assert.equal(g.getUnit(1).order, null);
  assert.ok(events.some((e) => e.type === 'arrived' && e.unitId === 1));
});

test('orders do nothing until tick and last queued order wins', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 2, y: 2 }] });
  g.queueOrder(1, move(0, 2));
  g.queueOrder(1, move(4, 2));
  assert.deepEqual(pos(g, 1), [2, 2]);
  g.tick();
  assert.deepEqual(pos(g, 1), [3, 2]);
  assert.equal(g.queue.length, 0);
});

test('invalid orders are rejected', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 0, y: 0 }] });
  assert.throws(() => g.queueOrder(1, move(3, 0)), /out of bounds/);
  assert.throws(() => g.queueOrder(1, move(1.5, 0)), /integers/);
  assert.throws(() => g.queueOrder(99, move(1, 1)), /No unit/);
});

test('contested cell: lowest id wins regardless of queue order', () => {
  const g = new Game({ width: 3, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0 }] });
  g.queueOrder(2, move(1, 0));
  g.queueOrder(1, move(1, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [1, 0]);
  assert.deepEqual(pos(g, 2), [2, 0]);
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 2 && e.reason === 'contested' && e.by === 1));
});

test('head-on swap: both units blocked', () => {
  const g = new Game({ width: 2, height: 1, units: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
  g.queueOrder(1, move(1, 0));
  g.queueOrder(2, move(0, 0));
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 0]);
  assert.deepEqual(pos(g, 2), [1, 0]);
});

test('train: a line of units moves together when the front is free', () => {
  const g = new Game({ width: 4, height: 1, units: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] });
  for (const id of [1, 2, 3]) g.queueOrder(id, move(3, 0));
  g.tick();
  assert.deepEqual([pos(g, 1), pos(g, 2), pos(g, 3)], [[1, 0], [2, 0], [3, 0]]);
});

test('blocked front blocks the whole line behind it', () => {
  const g = new Game({ width: 3, height: 1, units: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] });
  g.queueOrder(1, move(1, 0));
  g.queueOrder(2, move(2, 0)); // unit 3 is stationary
  const events = g.tick();
  assert.deepEqual([pos(g, 1), pos(g, 2), pos(g, 3)], [[0, 0], [1, 0], [2, 0]]);
  const reasons = events.filter((e) => e.type === 'blocked').map((e) => [e.unitId, e.reason, e.by]);
  assert.deepEqual(reasons, [[1, 'occupied', 2], [2, 'occupied', 3]]);
});

test('contest loser stays and blocks units entering its cell', () => {
  // 1 and 2 contest cell (1,0); 2 loses; 3 tries to enter 2's cell.
  const out = resolveMoves([
    { id: 1, x: 0, y: 0, tx: 1, ty: 0 },
    { id: 2, x: 2, y: 0, tx: 1, ty: 0 },
    { id: 3, x: 3, y: 0, tx: 2, ty: 0 },
  ]);
  assert.equal(out.get(1).moved, true);
  assert.deepEqual(out.get(2).blocked, { reason: 'contested', by: 1 });
  assert.deepEqual(out.get(3).blocked, { reason: 'occupied', by: 2 });
});

test('rotation of 3+ units all move', () => {
  const out = resolveMoves([
    { id: 1, x: 0, y: 0, tx: 1, ty: 0 },
    { id: 2, x: 1, y: 0, tx: 1, ty: 1 },
    { id: 3, x: 1, y: 1, tx: 0, ty: 1 },
    { id: 4, x: 0, y: 1, tx: 0, ty: 0 },
  ]);
  for (const id of [1, 2, 3, 4]) assert.equal(out.get(id).moved, true);
});

test('resolution is independent of input order', () => {
  const intents = [
    { id: 1, x: 0, y: 0, tx: 1, ty: 0 },
    { id: 2, x: 2, y: 0, tx: 1, ty: 0 },
    { id: 3, x: 1, y: 1, tx: 1, ty: 0 },
    { id: 4, x: 3, y: 0, tx: 2, ty: 0 },
    { id: 5, x: 1, y: 0, tx: 1, ty: 1 },
    { id: 6, x: 0, y: 1, tx: 1, ty: 1 },
  ];
  const expected = [...resolveMoves(intents)];
  // A few fixed permutations (no randomness in tests either).
  const perms = [[5, 4, 3, 2, 1, 0], [2, 0, 4, 1, 5, 3], [3, 5, 1, 0, 2, 4]];
  for (const p of perms) {
    assert.deepEqual([...resolveMoves(p.map((i) => intents[i]))], expected);
  }
});

test('replaying the same orders yields the same state hash', () => {
  const setup = () => new Game({
    width: 6, height: 6,
    units: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 5, y: 0 }],
  });
  const script = [
    [[1, move(5, 5)], [2, move(0, 0)], [3, move(5, 0)], [4, move(0, 5)]],
    [],
    [[1, move(3, 3)]],
    [], [], [], [], [], [],
  ];
  const run = () => {
    const g = setup();
    for (const batch of script) {
      for (const [id, o] of batch) g.queueOrder(id, o);
      g.tick();
    }
    return g;
  };
  const a = run();
  const b = run();
  assert.equal(a.hash(), b.hash());
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('snapshot round-trip preserves state and hash', () => {
  const g = new Game({ width: 4, height: 4, units: [{ x: 0, y: 0 }, { x: 3, y: 3 }] });
  g.queueOrder(1, move(3, 0));
  g.tick();
  g.queueOrder(2, move(0, 3));
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  g.tick();
  copy.tick();
  assert.equal(copy.hash(), g.hash());
});
