// Quick moves: each player unit's one-time move that jumps to the front of
// the order queue and so goes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, quickMove, attack, nextStep } from '../src/engine/index.js';
import { Match } from '../src/match.js';

const C = Teams.CPU;
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];

test('each player unit starts with one quick move; CPU units have none', () => {
  const g = new Game({ width: 4, height: 4, units: [{ x: 0, y: 0 }, { x: 3, y: 3, team: C }] });
  assert.equal(g.getUnit(1).quickMoves, 1);
  assert.equal(g.getUnit(2).quickMoves, 0);
  assert.throws(() => g.queueOrder(2, quickMove(3, 2)), /no quick move left/);
});

test('a quick move goes to the front of the queue, ahead of the CPU\'s staged orders', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }, { x: 2, y: 5 }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(3, move(2, 3));
  m.playerOrder(1, quickMove(0, 3));
  assert.deepEqual(g.queue.map((q) => q.unitId), [1, 2, 3]);
  assert.equal(g.queue[0].order.quick, true);
});

test('a quick move wins a same-instant contest the CPU would otherwise win', () => {
  // Same setup as the CPU-priority test in match.test.js: the CPU pikeman
  // and the player's unit step into the same hex at the same instant.
  const setup = () => {
    const g = new Game({ width: 3, height: 5, units: [{ x: 0, y: 2 }, { x: 1, y: 0, team: C }] });
    const m = new Match(g);
    m.startTurn();
    const cell = nextStep({ ...g.getUnit(2), order: g.queue[0].order }, g);
    return { g, m, cell };
  };

  const normal = setup();
  normal.m.playerOrder(1, move(normal.cell.x, normal.cell.y));
  normal.m.endTurn();
  assert.deepEqual(pos(normal.g, 2), [normal.cell.x, normal.cell.y], 'CPU wins without a quick move');

  const quick = setup();
  quick.m.playerOrder(1, quickMove(quick.cell.x, quick.cell.y));
  const events = quick.m.endTurn();
  assert.deepEqual(pos(quick.g, 1), [quick.cell.x, quick.cell.y], 'player wins with a quick move');
  assert.deepEqual(pos(quick.g, 2), [1, 0]);
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 2 && e.reason === 'contested' && e.by === 1));
});

test('the quick move is used up on tick, and only once', () => {
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, quickMove(0, 3));
  assert.equal(g.getUnit(1).quickMoves, 1, 'not spent until the turn runs');
  const events = g.tick();
  assert.ok(events.some((e) => e.type === 'quickMove' && e.unitId === 1 && e.remaining === 0));
  assert.equal(g.getUnit(1).quickMoves, 0);
  assert.throws(() => g.queueOrder(1, quickMove(0, 5)), /no quick move left/);
  // It's an ordinary standing move order from then on.
  g.tick();
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
});

test('replacing or clearing a queued quick move does not use it up', () => {
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0 }, { x: 0, y: 5, team: C }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(0, 2));
  m.playerOrder(1, move(0, 1)); // replaces it
  assert.equal(g.queue.filter((q) => q.unitId === 1).length, 1);
  assert.ok(!g.queue.some((q) => q.order.quick));
  m.playerOrder(1, quickMove(0, 2));
  m.clearPlayerOrders();
  m.endTurn();
  assert.equal(g.getUnit(1).quickMoves, 1);
});

test('a quick move outranks the CPU for the rest of its journey', () => {
  // Applied first, it gets the lowest order number, which it keeps while the
  // unit walks on in later turns.
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0 }, { x: 0, y: 5, team: C }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(0, 3));
  m.endTurn();
  const seq = g.getUnit(1).orderSeq;
  for (const u of g.units) if (u.id !== 1 && u.orderSeq !== null) assert.ok(seq < u.orderSeq);
});

test('quick moves stay in front when the CPU re-plans', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(0, 3));
  g.clearQueue(C); // e.g. the board was edited
  m.startTurn();
  assert.deepEqual(g.queue.map((q) => q.unitId), [1, 2]);
});

test('quick moves are move orders only, and survive a snapshot round-trip', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 0, y: 0, type: 'gunslinger' }] });
  assert.throws(() => g.queueOrder(1, { ...attack('down'), quick: true }), /Invalid order/);
  g.queueOrder(1, quickMove(0, 2));
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  copy.tick();
  assert.equal(copy.getUnit(1).quickMoves, 0);
});
