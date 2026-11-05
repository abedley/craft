// Pikemen's charge: a straight-line rush of up to 3 hexes at the front of the
// queue, ending with a strike in the same direction. Rows are straight
// left/right hex lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, quickMove, charge, attack, chargePlan, UnitTypes, defineUnitType } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);
// A one-row board: units are given as [x, extra] (row 0).
const row = (width, units) => new Game({ width, height: 1, units: units.map(([x, extra = {}]) => ({ x, y: 0, ...extra })) });

test('pikemen have one 3-hex charge (from the unit JSON), on either team; gunslingers have none', () => {
  assert.deepEqual(UnitTypes.pikeman.charge, { distance: 3, uses: 1 });
  assert.equal(UnitTypes.gunslinger.charge, null);
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0 }, { x: 4, y: 4, team: C }, { x: 2, y: 2, type: 'gunslinger' }] });
  assert.deepEqual([1, 2, 3].map((id) => g.getUnit(id).charges), [1, 1, 0]);
  assert.throws(() => g.queueOrder(3, charge('right')), /Gunslinger units can't charge/);
  assert.throws(() => g.queueOrder(1, charge('sideways')), /direction/);
});

test('with nothing in the way it rushes the full 3 hexes in a straight line, then strikes ahead', () => {
  // Unit 2 is 5 hexes away: just past the charge, but inside the closing strike.
  const g = row(8, [[0], [5, { team: C }]]);
  g.queueOrder(1, charge('right'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [3, 0]);
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(events.find((e) => e.type === 'chargeEnded').reason, 'full distance');
  assert.deepEqual(events.find((e) => e.type === 'strike').cells, [[4, 0], [5, 0]]);
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual(g.queue, [], 'nothing carries over');
  assert.equal(g.getUnit(1).charges, 0);
  assert.throws(() => g.queueOrder(1, charge('right')), /no charge left/);
});

test('it goes straight: diagonal charges follow the hex line', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, charge('down-right'));
  const events = g.tick();
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[0, 0], [0, 1], [1, 2], [1, 3]]);
});

test('colliding with a unit stops the charge and strikes it', () => {
  const g = row(8, [[0], [2, { team: C }], [3, { team: C }]]);
  g.queueOrder(1, charge('right'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [1, 0], 'stopped in front of unit 2');
  const end = events.find((e) => e.type === 'chargeEnded');
  assert.deepEqual([end.reason, end.by], ['collided', 2]);
  assert.deepEqual(kills(events), [2, 3], 'the strike hits the unit it ran into, and the hex behind');
});

test('a unit right next to it: no movement, straight to the strike', () => {
  const g = row(5, [[0], [1, { team: C }]]);
  g.queueOrder(1, charge('right'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 0]);
  assert.deepEqual(kills(events), [2]);
});

test('friendly fire: colliding with a teammate strikes it too', () => {
  const g = row(6, [[0], [2]]);
  g.queueOrder(1, charge('right'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('water or the board edge stops the charge early; it still strikes ahead', () => {
  const g = new Game({ width: 7, height: 1, terrain: ['..~....'], units: [{ x: 0, y: 0 }, { x: 3, y: 0, team: C }] });
  g.queueOrder(1, charge('right'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [1, 0], 'stopped at the water');
  assert.equal(events.find((e) => e.type === 'chargeEnded').reason, 'terrain');
  assert.deepEqual(kills(events), [2], 'the strike reaches across the water');

  const edge = row(3, [[1]]);
  edge.queueOrder(1, charge('right'));
  edge.tick();
  assert.deepEqual(pos(edge, 1), [2, 0]);
});

test('charging into a shot in flight is a hit', () => {
  const g = new Game({ width: 10, height: 3, units: [{ x: 0, y: 1, type: 'gunslinger', team: C }, { x: 4, y: 0 }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // shot resting at (4,1)
  g.state.queue = []; // (normally it would fly first; put the charge ahead of it)
  g.queueOrder(2, charge('down-right')); // (4,0) -> (4,1): into the shot
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.ok(!events.some((e) => e.type === 'strike'), 'no strike after dying');
});

test('a charge is added to the very front of the queue; a later fast order goes in front of it', () => {
  const g = new Game({ width: 8, height: 6, units: [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 7, y: 3 }] });
  g.queueOrder(2, move(1, 5));
  g.queueOrder(3, move(6, 3));
  g.queueOrder(1, charge('right'));
  assert.deepEqual(g.queue.map((e) => e.unitId), [1, 2, 3]);
  g.queueOrder(3, quickMove(7, 4)); // fast: to the front; unit 3's old entry is removed
  assert.deepEqual(g.queue.map((e) => e.unitId), [3, 1, 2]);
});

test('replacing or clearing a queued charge does not use it up', () => {
  const g = row(8, [[0], [7, { team: C }]]);
  g.getUnit(2).charges = 0;
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, charge('right'));
  m.playerOrder(1, move(1, 0));
  m.playerOrder(1, charge('right'));
  m.clearPlayerOrders();
  m.endTurn();
  assert.equal(g.getUnit(1).charges, 1);
});

test('charging up to a CPU gunslinger before it shoots: the strike kills it', () => {
  // The CPU gunslinger at the left end of row 1 has a shot staged at our
  // gunslinger. Our pikeman charges left along row 1 from 4 hexes to its right.
  const g = new Game({
    width: 8, height: 3,
    units: [{ x: 4, y: 2, type: 'gunslinger' }, { x: 4, y: 1 }, { x: 0, y: 1, type: 'gunslinger', team: C }],
  });
  const m = new Match(g);
  m.startTurn();
  assert.equal(g.queue[0].unitId, 3);
  m.playerOrder(2, charge('left'));
  assert.equal(g.queue[0].unitId, 2, 'the charge is first');
  const events = m.endTurn();
  assert.deepEqual(kills(events), [3]);
  assert.ok(g.getUnit(1), 'our gunslinger survived');
});

test('chargePlan previews exactly what the charge will do', () => {
  const g = row(8, [[0], [3, { team: C }]]);
  const plan = chargePlan(g, g.getUnit(1), 'right');
  assert.deepEqual(plan.path, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual([plan.reason, plan.by], ['collided', 2]);
  assert.deepEqual(plan.strike, [[3, 0], [4, 0]]);
});

test('the CPU charges when the closing strike would hit an enemy, never a teammate', () => {
  // Enemy 5 hexes away along the row: a normal move or strike can't reach, a charge can.
  const g = row(8, [[0, { team: C }], [5]]);
  assert.deepEqual(planTurn(g, C), [[1, charge('right')]]);
  // Enemy right there: it strikes normally and keeps its charge.
  const near = row(8, [[0, { team: C }], [2]]);
  assert.deepEqual(planTurn(near, C), [[1, attack('right')]]);
  // A teammate in the way: no charge.
  const blocked = row(8, [[0, { team: C }], [3, { team: C }], [5]]);
  assert.ok(!planTurn(blocked, C).some(([id, o]) => id === 1 && o.type === 'charge'));
  // Too far for charge + strike: it walks.
  const far = row(8, [[0, { team: C }], [7]]);
  assert.equal(planTurn(far, C)[0][1].type, 'move');
});

test('in a match: the CPU stages its charge first, so a quick move added later goes in front of it', () => {
  const g = row(8, [[7], [0, { team: C }], [5]]);
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue.map((e) => [e.unitId, e.order.type]), [[2, 'charge']]);
  m.playerOrder(1, quickMove(6, 0));
  assert.deepEqual(g.queue.map((e) => [e.unitId, e.order.type]), [[1, 'move'], [2, 'charge']]);
});

test('charge definitions are validated', () => {
  const bad = (c) => () => defineUnitType('x', { name: 'X', speed: 1, charge: c });
  assert.throws(bad({ distance: 0, uses: 1 }), /"charge.distance"/);
  assert.throws(bad({ distance: 3, uses: 0 }), /"charge.uses"/);
  assert.throws(bad({ distance: 3, uses: 1, cooldown: 2 }), /unknown field "charge.cooldown"/);
  assert.equal(defineUnitType('x', { name: 'X', speed: 1, charge: { distance: 4, uses: 2 } }).charge.uses, 2);
});

test('charges survive a snapshot round-trip', () => {
  const g = row(8, [[0]]);
  g.queueOrder(1, charge('right'));
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  copy.tick();
  assert.deepEqual([copy.getUnit(1).x, copy.getUnit(1).charges], [3, 0]);
});
