import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, shoot, thrust } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('pikeman thrust kills both cells in a row, in any of 8 directions', () => {
  const g = new Game({
    width: 5, height: 5,
    units: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
  });
  g.queueOrder(1, thrust('down-right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2, 3]); // reach 2: unit 4 at distance 3 survives
  assert.ok(g.getUnit(4));
  const t = events.find((e) => e.type === 'thrust');
  assert.deepEqual(t.cells, [[1, 1], [2, 2]]);
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.time, k.hits[0].cause, k.hits[0].attackerId], ['1', 'thrust', 1]);
});

test('thrust direction validation', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 1, y: 1 }] });
  assert.throws(() => g.queueOrder(1, thrust('sideways')), /direction/);
  assert.doesNotThrow(() => g.queueOrder(1, thrust('up-left')));
});

test('thrust lands at the end of the tick: units that step out escape', () => {
  const g = new Game({ width: 5, height: 3, units: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });
  g.queueOrder(1, thrust('right')); // strikes (1,1) and (2,1)
  g.queueOrder(2, move(1, 0)); // steps out at t=1
  // Moves at t=1 resolve before the strike lands, so unit 2 is already gone.
  assert.deepEqual(kills(g.tick()), []);
});

test('units walking into the strike zone are hit', () => {
  const g = new Game({ width: 5, height: 3, units: [{ x: 0, y: 1 }, { x: 2, y: 0 }] });
  g.queueOrder(1, thrust('right'));
  g.queueOrder(2, move(2, 1));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('friendly fire: the thrust kills teammates too, and the thruster holds still', () => {
  const g = new Game({ width: 5, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0, team: C }] });
  g.queueOrder(1, move(4, 0));
  g.tick(); // unit 1 -> (1,0)
  g.queueOrder(1, thrust('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual([g.getUnit(1).x, g.getUnit(1).order], [1, null]);
});

test('a pikeman killed earlier in the tick does not strike', () => {
  const g = new Game({ width: 4, height: 2, units: [{ x: 0, y: 0, type: 'gunslinger' }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
  g.queueOrder(1, shoot('right')); // kills unit 2 at t=1/4
  g.queueOrder(2, thrust('down')); // would have killed unit 3 at t=1
  assert.deepEqual(kills(g.tick()), [2]);
  assert.ok(g.getUnit(3));
});

test('a pikeman shot at t=1 still strikes (simultaneous)', () => {
  const g = new Game({ width: 6, height: 2, units: [{ x: 0, y: 0, type: 'gunslinger' }, { x: 4, y: 0 }, { x: 4, y: 1 }] });
  g.queueOrder(1, shoot('right')); // reaches x=4 at t=1
  g.queueOrder(2, thrust('down'));
  assert.deepEqual(kills(g.tick()), [2, 3]);
});

test('two pikemen thrusting at each other both die', () => {
  const g = new Game({ width: 4, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0, team: C }] });
  g.queueOrder(1, thrust('right'));
  g.queueOrder(2, thrust('left'));
  assert.deepEqual(kills(g.tick()), [1, 2]);
});

test('old saves with "basic" units load as pikemen', () => {
  const snap = { width: 3, height: 3, tick: 0, nextUnitId: 2, queue: [], units: [{ id: 1, x: 0, y: 0, type: 'basic', order: null }] };
  assert.equal(Game.fromSnapshot(snap).getUnit(1).type, 'pikeman');
});

test('CPU pikeman thrusts at an enemy in reach, picking the direction with the most enemies', () => {
  const g = new Game({
    width: 6, height: 6,
    units: [{ x: 2, y: 2, team: C }, { x: 2, y: 0 }, { x: 4, y: 4 }, { x: 3, y: 3 }],
  });
  assert.deepEqual(planTurn(g, C), [[1, thrust('down-right')]]);
});

test('CPU pikeman never thrusts through a teammate', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0, team: C }, { x: 1, y: 0, team: C }, { x: 2, y: 0 }] });
  const plan = planTurn(g, C);
  assert.ok(!plan.some(([id, o]) => id === 1 && o.type === 'thrust'));
  assert.deepEqual(plan.find(([id]) => id === 2), [2, thrust('right')]);
});

test('CPU pikeman avoids striking where a teammate is about to step', () => {
  // The CPU gunslinger (planned first) heads for its firing cell (2,0).
  // The pikeman's only strike at the enemy, 'up', covers (2,1) and (2,0),
  // so it holds off rather than spear its teammate.
  const g = new Game({ width: 5, height: 3, units: [{ x: 1, y: 0, team: C, type: 'gunslinger' }, { x: 2, y: 2, team: C }, { x: 2, y: 1 }] });
  const plan = planTurn(g, C);
  assert.deepEqual(plan.find(([id]) => id === 1)[1], move(2, 0));
  assert.notEqual(plan.find(([id]) => id === 2)?.[1].type, 'thrust');
});

test('CPU plan is staged before the player and visible in the queue', () => {
  const g = new Game({ width: 5, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0, team: C }] });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue, [{ unitId: 2, order: thrust('left') }]);
  // The player sees the thrust coming. On a 1-row board there's nowhere to
  // step out of it, so they thrust back and both pikemen die.
  m.playerOrder(1, thrust('right'));
  m.endTurn();
  assert.equal(g.units.length, 0);
});
