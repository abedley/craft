// Pikemen's charge: a straight-line rush of up to 3 hexes at the front of the
// queue, ending with a strike in the same direction. Columns are straight
// up/down hex lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, quickMove, charge, attack, chargePlan, UnitTypes, defineUnitType } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);
const col = (height, units) => new Game({ width: 1, height, units: units.map(([y, extra = {}]) => ({ x: 0, y, ...extra })) });

test('pikemen have one 3-hex charge (from the unit JSON), on either team; gunslingers have none', () => {
  assert.deepEqual(UnitTypes.pikeman.charge, { distance: 3, uses: 1 });
  assert.equal(UnitTypes.gunslinger.charge, null);
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0 }, { x: 4, y: 4, team: C }, { x: 2, y: 2, type: 'gunslinger' }] });
  assert.deepEqual([1, 2, 3].map((id) => g.getUnit(id).charges), [1, 1, 0]);
  assert.throws(() => g.queueOrder(3, charge('down')), /Gunslinger units can't charge/);
  assert.throws(() => g.queueOrder(1, charge('sideways')), /direction/);
});

test('with nothing in the way it rushes the full 3 hexes in a straight line, then strikes ahead', () => {
  // Unit 2 is 5 hexes away: just past the charge, but inside the closing strike.
  const g = col(8, [[0], [5, { team: C }]]);
  g.queueOrder(1, charge('down'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[0, 0], [0, 1], [0, 2], [0, 3]]);
  assert.deepEqual(events.find((e) => e.type === 'chargeEnded').reason, 'full distance');
  assert.deepEqual(events.find((e) => e.type === 'strike').cells, [[0, 4], [0, 5]]);
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual(g.queue, [], 'nothing carries over');
  assert.equal(g.getUnit(1).charges, 0);
  assert.throws(() => g.queueOrder(1, charge('down')), /no charge left/);
});

test('it goes straight: diagonal charges follow the hex line', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, charge('down-right'));
  const events = g.tick();
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[0, 0], [1, 0], [2, 1], [3, 1]]);
});

test('colliding with a unit stops the charge and strikes it', () => {
  const g = col(8, [[0], [2, { team: C }], [3, { team: C }]]);
  g.queueOrder(1, charge('down'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 1], 'stopped in front of unit 2');
  const end = events.find((e) => e.type === 'chargeEnded');
  assert.deepEqual([end.reason, end.by], ['collided', 2]);
  assert.deepEqual(kills(events), [2, 3], 'the strike hits the unit it ran into, and the hex behind');
});

test('a unit right next to it: no movement, straight to the strike', () => {
  const g = col(5, [[0], [1, { team: C }]]);
  g.queueOrder(1, charge('down'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 0]);
  assert.deepEqual(kills(events), [2]);
});

test('friendly fire: colliding with a teammate strikes it too', () => {
  const g = col(6, [[0], [2]]);
  g.queueOrder(1, charge('down'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('water or the board edge stops the charge early; it still strikes ahead', () => {
  const g = new Game({ width: 1, height: 7, terrain: ['.', '.', '~', '.', '.', '.', '.'], units: [{ x: 0, y: 0 }, { x: 0, y: 3, team: C }] });
  g.queueOrder(1, charge('down'));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 1], 'stopped at the water');
  assert.equal(events.find((e) => e.type === 'chargeEnded').reason, 'terrain');
  assert.deepEqual(kills(events), [2], 'the strike reaches across the water');

  const edge = col(3, [[1]]);
  edge.queueOrder(1, charge('down'));
  edge.tick();
  assert.deepEqual(pos(edge, 1), [0, 2]);
});

test('charging into a shot in flight is a hit', () => {
  const g = new Game({ width: 3, height: 10, units: [{ x: 1, y: 0, type: 'gunslinger', team: C }, { x: 0, y: 4 }] });
  g.queueOrder(1, attack('down'));
  g.tick(); // shot resting at (1,4)
  g.state.queue = []; // (normally it would fly first; put the charge ahead of it)
  g.queueOrder(2, charge('down-right')); // (0,4) -> (1,4): into the shot
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.ok(!events.some((e) => e.type === 'strike'), 'no strike after dying');
});

test('a charge goes to the front of the queue, sharing it with quick moves in the order given', () => {
  const g = new Game({ width: 6, height: 8, units: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 3, y: 7 }] });
  g.queueOrder(2, move(5, 5));
  g.queueOrder(3, move(3, 5));
  g.queueOrder(1, charge('down'));
  assert.deepEqual(g.queue.map((e) => e.unitId), [1, 2, 3]);
  g.queueOrder(3, quickMove(3, 6));
  assert.deepEqual(g.queue.map((e) => e.unitId), [1, 3, 2]);
});

test('replacing or clearing a queued charge does not use it up', () => {
  const g = col(8, [[0], [7, { team: C }]]);
  g.getUnit(2).charges = 0;
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, charge('down'));
  m.playerOrder(1, move(0, 1));
  m.playerOrder(1, charge('down'));
  m.clearPlayerOrders();
  m.endTurn();
  assert.equal(g.getUnit(1).charges, 1);
});

test('charging up to a CPU gunslinger before it shoots: the strike kills it', () => {
  // The CPU gunslinger at the top of column 1 has a shot staged at our
  // gunslinger. Our pikeman charges up column 1 from 4 hexes below it.
  const g = new Game({
    width: 3, height: 8,
    units: [{ x: 2, y: 4, type: 'gunslinger' }, { x: 1, y: 4 }, { x: 1, y: 0, type: 'gunslinger', team: C }],
  });
  const m = new Match(g);
  m.startTurn();
  assert.equal(g.queue[0].unitId, 3);
  m.playerOrder(2, charge('up'));
  assert.equal(g.queue[0].unitId, 2, 'the charge is first');
  const events = m.endTurn();
  assert.deepEqual(kills(events), [3]);
  assert.ok(g.getUnit(1), 'our gunslinger survived');
});

test('chargePlan previews exactly what the charge will do', () => {
  const g = col(8, [[0], [3, { team: C }]]);
  const plan = chargePlan(g, g.getUnit(1), 'down');
  assert.deepEqual(plan.path, [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual([plan.reason, plan.by], ['collided', 2]);
  assert.deepEqual(plan.strike, [[0, 3], [0, 4]]);
});

test('the CPU charges when the closing strike would hit an enemy, never a teammate', () => {
  // Enemy 5 hexes down: a normal move or strike can't reach, a charge can.
  const g = col(8, [[0, { team: C }], [5]]);
  assert.deepEqual(planTurn(g, C), [[1, charge('down')]]);
  // Enemy right there: it strikes normally and keeps its charge.
  const near = col(8, [[0, { team: C }], [2]]);
  assert.deepEqual(planTurn(near, C), [[1, attack('down')]]);
  // A teammate in the way: no charge.
  const blocked = col(8, [[0, { team: C }], [3, { team: C }], [5]]);
  assert.ok(!planTurn(blocked, C).some(([id, o]) => id === 1 && o.type === 'charge'));
  // Too far for charge + strike: it walks.
  const far = col(8, [[0, { team: C }], [7]]);
  assert.equal(planTurn(far, C)[0][1].type, 'move');
});

test('in a match, the CPU\'s charge leads the front of the queue', () => {
  const g = col(8, [[7], [0, { team: C }], [5]]);
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, quickMove(0, 6));
  assert.deepEqual(g.queue.map((e) => [e.unitId, e.order.type]), [[2, 'charge'], [1, 'move']]);
});

test('charge definitions are validated', () => {
  const bad = (c) => () => defineUnitType('x', { name: 'X', speed: 1, charge: c });
  assert.throws(bad({ distance: 0, uses: 1 }), /"charge.distance"/);
  assert.throws(bad({ distance: 3, uses: 0 }), /"charge.uses"/);
  assert.throws(bad({ distance: 3, uses: 1, cooldown: 2 }), /unknown field "charge.cooldown"/);
  assert.equal(defineUnitType('x', { name: 'X', speed: 1, charge: { distance: 4, uses: 2 } }).charge.uses, 2);
});

test('charges survive a snapshot round-trip', () => {
  const g = col(8, [[0]]);
  g.queueOrder(1, charge('down'));
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  copy.tick();
  assert.deepEqual([copy.getUnit(1).y, copy.getUnit(1).charges], [3, 0]);
});
