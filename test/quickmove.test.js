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
  assert.throws(() => g.queueOrder(2, quickMove(2, 3)), /no quick move left/);
});

test('a quick move goes to the front of the queue, ahead of the CPU\'s staged orders', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }, { x: 5, y: 2 }] });
  g.getUnit(2).charges = 0; // keep it simple: no CPU charge (see charge.test.js)
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(3, move(4, 2));
  m.playerOrder(1, quickMove(1, 0));
  assert.deepEqual(g.queue.map((q) => q.unitId), [1, 2, 3]);
  assert.equal(g.queue[0].order.quick, true);
});

test('a quick move beats the CPU to a hex it would otherwise win', () => {
  // The CPU pikeman and the player's unit both head for the same hex.
  const setup = () => {
    const g = new Game({ width: 5, height: 3, units: [{ x: 2, y: 0 }, { x: 0, y: 1, team: C }] });
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
  assert.deepEqual(pos(quick.g, 2), [0, 1]);
  // The quick move runs first, so the hex is occupied when the CPU unit's turn comes.
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 2 && e.reason === 'occupied' && e.by === 1));
});

test('the quick move is used up on tick, and only once', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, quickMove(1, 0));
  assert.equal(g.getUnit(1).quickMoves, 1, 'not spent until the turn runs');
  const events = g.tick();
  assert.ok(events.some((e) => e.type === 'quickMove' && e.unitId === 1 && e.remaining === 0));
  assert.equal(g.getUnit(1).quickMoves, 0);
  assert.deepEqual(g.queue, [], 'nothing carries over');
  assert.throws(() => g.queueOrder(1, quickMove(2, 0)), /no quick move left/);
});

test('replacing or clearing a queued quick move does not use it up', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0 }, { x: 5, y: 0, team: C }] });
  g.getUnit(2).charges = 0; // keep the CPU pikeman from charging in (charge.test.js covers that)
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(1, 0));
  m.playerOrder(1, move(1, 0)); // replaces it
  assert.equal(g.queue.filter((q) => q.unitId === 1).length, 1);
  assert.ok(!g.queue.some((q) => q.order.quick));
  m.playerOrder(1, quickMove(1, 0));
  m.clearPlayerOrders();
  m.endTurn();
  assert.equal(g.getUnit(1).quickMoves, 1);
});

test('quick moves stay in front when the CPU re-plans', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(1, 0));
  g.clearQueue(C); // e.g. the board was edited
  m.startTurn();
  assert.deepEqual(g.queue.map((q) => q.unitId), [1, 2]);
});

test('quick moves are move orders only, and survive a snapshot round-trip', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 0, y: 0, type: 'gunslinger' }] });
  assert.throws(() => g.queueOrder(1, { ...attack('right'), quick: true }), /Invalid order/);
  g.queueOrder(1, quickMove(1, 0));
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  copy.tick();
  assert.equal(copy.getUnit(1).quickMoves, 0);
});

// ---- Quick moves go first in time: dodging a shot -------------------------

const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('a quick move steps out of a CPU shot that would land this turn; a normal move is too late', () => {
  // CPU gunslinger at the left end of row 1 shoots right at the player's unit
  // d hexes along (within the shot's 4-hex flight). The CPU's order is ahead
  // of the player's normal move in the queue, so the shot lands first; a
  // quick move is ahead of the CPU, so the unit is gone before it fires.
  // (At range 1 the target is next to the gunslinger, which can't shoot at
  // all; see gunslinger.test.js.)
  for (let d = 2; d <= 4; d++) {
    const setup = () => {
      const g = new Game({ width: 7, height: 3, units: [{ x: 0, y: 1, type: 'gunslinger', team: C }, { x: d, y: 1 }] });
      g.queueOrder(1, attack('right'));
      return g;
    };
    const side = [d, 0]; // up-left of an odd row: off the shot's line

    const plain = setup();
    plain.queueOrder(2, move(...side));
    assert.deepEqual(kills(plain.tick()), [2], `range ${d}: normal move is too late`);

    const quick = setup();
    quick.queueOrder(2, quickMove(...side));
    const events = quick.tick();
    assert.deepEqual(kills(events), [], `range ${d}: the quick move dodges`);
    assert.deepEqual(pos(quick, 2), side);
  }
});

test('a quick move also gets out of the way of a shot already in flight', () => {
  const g = new Game({ width: 10, height: 3, units: [{ x: 0, y: 1, type: 'gunslinger', team: C }, { x: 6, y: 1 }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // shot at (4,1), 2 hexes short; it flies first next turn
  g.queueOrder(2, quickMove(6, 0));
  assert.deepEqual(kills(g.tick()), []);
});

test('a quick move goes as far as a normal move: up to the unit\'s speed', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 0, y: 0 }, { x: 7, y: 0, speed: 2 }] });
  assert.throws(() => g.queueOrder(1, quickMove(2, 0)), /too far/);
  g.queueOrder(1, quickMove(1, 0));
  g.queueOrder(2, quickMove(5, 0));
  const events = g.tick();
  assert.deepEqual(events.find((e) => e.type === 'moved' && e.unitId === 1).path, [[0, 0], [1, 0]]);
  assert.deepEqual(events.find((e) => e.type === 'moved' && e.unitId === 2).path, [[7, 0], [6, 0], [5, 0]]);
});

test('a quick move along the shot\'s line doesn\'t help', () => {
  const g = new Game({ width: 8, height: 3, units: [{ x: 0, y: 1, type: 'gunslinger', team: C }, { x: 2, y: 1 }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, quickMove(3, 1));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('in a match: seeing the CPU\'s staged shot, a quick move saves the unit', () => {
  const g = new Game({ width: 7, height: 3, units: [{ x: 4, y: 1 }, { x: 0, y: 1, type: 'gunslinger', team: C }] });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue[0], { unitId: 2, order: attack('right') }, 'the CPU plan is visible');
  m.playerOrder(1, quickMove(4, 2)); // up-right of an odd row: off the line
  m.endTurn();
  assert.ok(g.getUnit(1), 'survived');
});
