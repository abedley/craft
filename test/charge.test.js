// Pikemen's charge: a move of up to 3 hexes that goes to the front of the queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, quickMove, charge, attack, UnitTypes, defineUnitType } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('pikemen have one charge of 3 hexes (from the unit JSON), on either team; gunslingers have none', () => {
  assert.deepEqual(UnitTypes.pikeman.charge, { distance: 3, uses: 1 });
  assert.equal(UnitTypes.gunslinger.charge, null);
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0 }, { x: 4, y: 4, team: C }, { x: 2, y: 2, type: 'gunslinger' }] });
  assert.equal(g.getUnit(1).charges, 1);
  assert.equal(g.getUnit(2).charges, 1);
  assert.equal(g.getUnit(3).charges, 0);
  assert.throws(() => g.queueOrder(3, charge(2, 4)), /Gunslinger units can't charge/);
  assert.throws(() => g.queueOrder(1, { ...charge(0, 3), quick: true }), /both quick and a charge/);
  assert.throws(() => g.queueOrder(1, { ...attack('down'), charge: true }), /only move orders can be charges/);
});

test('a charge covers 3 hexes in one entry, then any rest of the walk carries over as normal', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, charge(0, 5));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
  assert.ok(events.some((e) => e.type === 'charge' && e.unitId === 1 && e.remaining === 0));
  assert.equal(g.getUnit(1).charges, 0);
  assert.deepEqual(g.queue, [{ unitId: 1, order: move(0, 5), carried: true }]);
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 4], 'back to 1 hex a turn');
  assert.throws(() => g.queueOrder(1, charge(0, 7)), /no charge left/);
});

test('a charge goes to the front of the queue', () => {
  const g = new Game({ width: 6, height: 8, units: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 3, y: 7 }] });
  g.queueOrder(2, move(5, 5));
  g.queueOrder(3, move(3, 5));
  g.queueOrder(1, charge(0, 4));
  assert.deepEqual(g.queue.map((e) => e.unitId), [1, 2, 3]);
  // Quick moves and charges share the front, in the order they're given.
  g.queueOrder(3, quickMove(3, 6));
  assert.deepEqual(g.queue.map((e) => e.unitId), [1, 3, 2]);
});

test('a charge stops early at an occupied hex (whoever is there got there first)', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0 }, { x: 0, y: 2 }] });
  g.queueOrder(1, charge(0, 6));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 1]);
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 1 && e.by === 2));
});

test('replacing or clearing a queued charge does not use it up', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0 }, { x: 0, y: 7, team: C }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, charge(0, 3));
  m.playerOrder(1, move(0, 1));
  m.playerOrder(1, charge(0, 3));
  m.clearPlayerOrders();
  m.endTurn();
  assert.equal(g.getUnit(1).charges, 1);
});

test('charging next to a CPU gunslinger before it shoots stops the shot', () => {
  // The CPU gunslinger at the top of column 1 has a shot staged at our
  // gunslinger. Our pikeman, 3 hexes away, charges next to it first.
  const g = new Game({
    width: 3, height: 8,
    units: [{ x: 1, y: 3, type: 'gunslinger' }, { x: 0, y: 4 }, { x: 1, y: 0, type: 'gunslinger', team: C }],
  });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue[0], { unitId: 3, order: attack('down') });
  m.playerOrder(2, charge(0, 1)); // 3 hexes up the column, next to the CPU gunslinger
  assert.equal(g.queue[0].unitId, 2, 'the charge is first');
  const events = m.endTurn();
  assert.deepEqual(pos(g, 2), [0, 1]);
  assert.ok(events.some((e) => e.type === 'attackBlocked' && e.unitId === 3));
  assert.ok(g.getUnit(1), 'our gunslinger survived');
});

test('a charge then a strike: closing 3 hexes and striking next turn', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0 }, { x: 0, y: 5, team: C }] });
  g.queueOrder(1, charge(0, 5));
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('the CPU charges when a normal move can\'t reach the nearest enemy but a charge can', () => {
  for (const [d, expectCharge] of [[2, false], [3, true], [4, true], [5, false]]) {
    const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0, team: C }, { x: 0, y: d, type: 'gunslinger' }] });
    const [[, order]] = planTurn(g, C);
    if (d === 2) {
      assert.equal(order.type, 'attack', 'in reach: strikes instead');
      continue;
    }
    assert.equal(!!order.charge, expectCharge, `distance ${d}`);
  }
  // No charges left: it just walks.
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0, team: C }, { x: 0, y: 4 }] });
  g.getUnit(1).charges = 0;
  const [[, order]] = planTurn(g, C);
  assert.deepEqual(order, move(0, 4));
});

test('in a match, the CPU\'s charge leads the front of the queue', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 7 }, { x: 0, y: 0, team: C }, { x: 0, y: 3 }] });
  // CPU pikeman at the top, our units at 3 and 7: it charges at the one at 3.
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(0, 6));
  assert.deepEqual(g.queue.map((e) => e.unitId), [2, 1]);
  assert.equal(g.queue[0].order.charge, true);
});

test('charge definitions are validated', () => {
  const bad = (charge) => () => defineUnitType('x', { name: 'X', speed: 1, charge });
  assert.throws(bad({ distance: 0, uses: 1 }), /"charge.distance"/);
  assert.throws(bad({ distance: 3, uses: 0 }), /"charge.uses"/);
  assert.throws(bad({ distance: 3, uses: 1, cooldown: 2 }), /unknown field "charge.cooldown"/);
  assert.equal(defineUnitType('x', { name: 'X', speed: 1, charge: { distance: 4, uses: 2 } }).charge.uses, 2);
});

test('charges survive a snapshot round-trip', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, charge(0, 6));
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  copy.tick();
  assert.deepEqual([copy.getUnit(1).y, copy.getUnit(1).charges], [3, 0]);
});
