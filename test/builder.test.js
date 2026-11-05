// Builders: channel for 2 turns to put a building on their own hex. Allies
// can walk on or through buildings; enemies can't. Buildings do nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, attack, charge, teleport, build, UnitTypes, defineUnitType, distancesTo } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const B = 'builder';
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);
// A one-row board: units are given as [x, extra] (row 0).
const row = (width, units) => new Game({ width, height: 1, units: units.map(([x, extra = {}]) => ({ x, y: 0, ...extra })) });

/** Builds at the builder's hex over two turns. */
function buildHere(g, id) {
  g.queueOrder(id, build());
  g.tick();
  g.tick();
}

test('the builder comes from the unit JSON: no attack, builds in 2 turns', () => {
  assert.deepEqual(UnitTypes.builder.build, { turns: 2 });
  assert.equal(UnitTypes.builder.attack, null);
  const g = new Game({ width: 3, height: 3, units: [{ x: 0, y: 0, type: B }, { x: 2, y: 2 }] });
  assert.throws(() => g.queueOrder(1, attack('right')), /Builder units cannot attack/);
  assert.throws(() => g.queueOrder(2, build()), /Pikeman units cannot build/);
});

test('channel for two turns: turn 1 progress, turn 2 the building appears on its hex', () => {
  const g = row(4, [[1, { type: B }]]);
  g.queueOrder(1, build());
  let events = g.tick();
  const ch = events.find((e) => e.type === 'channeling');
  assert.deepEqual([ch.progress, ch.of], [1, 2]);
  assert.deepEqual(g.getUnit(1).channel, { kind: 'build', progress: 1 });
  assert.equal(g.buildings.length, 0);
  // The build order carries itself over to the next turn.
  assert.deepEqual(g.queue, [{ unitId: 1, order: build(), carried: true }]);
  events = g.tick();
  assert.ok(events.some((e) => e.type === 'built' && e.unitId === 1));
  assert.deepEqual(g.buildings.map((b) => [b.x, b.y, b.team, b.builderId]), [[1, 0, 'player', 1]]);
  assert.equal(g.getUnit(1).channel, null);
  assert.deepEqual(g.queue, []);
});

test('giving the builder another order breaks the channel and loses the progress', () => {
  const g = row(4, [[1, { type: B }]]);
  g.queueOrder(1, build());
  g.tick();
  g.queueOrder(1, move(2, 0)); // replaces the carried build
  const events = g.tick();
  assert.ok(events.some((e) => e.type === 'channelBroken' && e.unitId === 1));
  assert.equal(g.getUnit(1).channel, null);
  assert.equal(g.buildings.length, 0);
  // Starting again takes the full two turns.
  buildHere(g, 1);
  assert.equal(g.buildings.length, 1);
});

test('queue order decides whether a builder finishes before it is shot', () => {
  // Turn 2: the carried-over build is at the front of the queue, so the
  // building is up before a shot queued that turn arrives, and it shields
  // the builder standing on it.
  const g = row(6, [[3, { type: B }], [0, { type: 'gunslinger', team: C }]]);
  g.queueOrder(1, build());
  g.tick();
  g.queueOrder(2, attack('right'));
  const events = g.tick();
  assert.ok(events.find((e) => e.type === 'built').step < events.find((e) => e.type === 'projectileBlocked').step);
  assert.ok(g.getUnit(1), 'shielded by its new building');

  // Shot on turn 1, mid-channel: killed, nothing gets built.
  const h = row(6, [[3, { type: B }], [0, { type: 'gunslinger', team: C }]]);
  h.queueOrder(2, attack('right'));
  h.queueOrder(1, build());
  assert.deepEqual(kills(h.tick()), [1]);
  h.tick();
  assert.equal(h.buildings.length, 0);
});

test('can\'t build where there\'s already a building', () => {
  const g = row(3, [[1, { type: B }]]);
  buildHere(g, 1);
  assert.throws(() => g.queueOrder(1, build()), /already a building/);
});

test('allies walk on and through their own buildings', () => {
  const g = row(6, [[1, { type: B }], [0, { speed: 3 }]]);
  buildHere(g, 1);
  for (const y of [2, 3, 4]) { // the builder walks off along the row
    g.queueOrder(1, move(y, 0));
    g.tick();
  }
  g.queueOrder(2, move(3, 0)); // through the building at (1,0)
  const events = g.tick();
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  g.queueOrder(2, move(1, 0)); // and back onto it
  g.tick();
  assert.deepEqual(pos(g, 2), [1, 0]);
});

test('enemies can\'t enter a building: it\'s impassable to them, like water', () => {
  // Row with a player building at (2,0): a CPU unit can't get past.
  const g = row(5, [[2, { type: B }], [4, { team: C }]]);
  buildHere(g, 1);
  g.queueOrder(1, move(1, 0));
  g.tick();
  assert.equal(g.isWalkable(2, 0, C), false);
  assert.equal(g.isWalkable(2, 0, Teams.PLAYER), true);
  assert.throws(() => g.queueOrder(2, move(2, 0)), /can't walk on an enemy building/);
  // On a wider board, enemies path around it.
  const w = new Game({ width: 5, height: 3, units: [{ x: 2, y: 1, type: B }, { x: 4, y: 1, team: C, speed: 5 }] });
  buildHere(w, 1);
  w.queueOrder(1, move(3, 2)); // the builder steps off, out of the way
  w.tick();
  w.queueOrder(2, move(0, 1));
  const events = w.tick();
  const path = events.find((e) => e.type === 'moved' && e.unitId === 2).path;
  assert.ok(!path.some(([x, y]) => x === 2 && y === 1), 'went round the building');
  assert.deepEqual(pos(w, 2), [0, 1]);
  assert.equal(distancesTo(w, 0, 1, C).get('4,1'), 5, 'one hex longer than straight along the row');
});

test('enemy charges stop at a building; enemy teleports can\'t land on one', () => {
  const g = row(7, [[3, { type: B }], [0, { team: C }], [6, { type: 'stalker', team: C }]]);
  buildHere(g, 1);
  g.queueOrder(1, move(4, 0)); // builder steps off its building
  g.tick();
  g.queueOrder(2, charge('right'));
  const events = g.tick();
  assert.deepEqual(pos(g, 2), [2, 0], 'stopped in front of the building');
  assert.equal(events.find((e) => e.type === 'chargeEnded').reason, 'terrain');
  assert.throws(() => g.queueOrder(3, teleport(3, 0)), /enemy building/);
});

test('strikes and mines ignore buildings', () => {
  // A pikeman strike reaches a unit standing on a building.
  const g = row(5, [[2, { type: B }], [0, { team: C }]]);
  buildHere(g, 1);
  g.getUnit(2).charges = 0;
  g.queueOrder(2, attack('right')); // strikes (1,0) and (2,0)
  assert.deepEqual(kills(g.tick()), [1]);
  assert.equal(g.buildings.length, 1, 'the building stays');
});

test('clearing your orders keeps a channel going; build definitions are validated', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 0, y: 0, type: B }, { x: 7, y: 0, team: C }] });
  g.getUnit(2).charges = 0;
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, build());
  m.endTurn();
  m.clearPlayerOrders();
  m.endTurn();
  assert.equal(g.buildings.length, 1);

  assert.throws(() => defineUnitType('x', { name: 'X', speed: 1, build: { turns: 0 } }), /"build.turns"/);
  assert.throws(() => defineUnitType('x', { name: 'X', speed: 1, build: { turns: 2, cost: 3 } }), /unknown field "build.cost"/);
});

test('buildings survive a snapshot round-trip', () => {
  const g = row(3, [[1, { type: B }]]);
  g.queueOrder(1, build());
  g.tick();
  const mid = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(mid.hash(), g.hash());
  mid.tick();
  assert.equal(mid.buildings.length, 1);
});

test('the CPU builder builds when safe, keeps channelling, and steps away from close enemies', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 3, type: B, team: C }, { x: 7, y: 3 }] });
  assert.deepEqual(planTurn(g, C), [[1, build()]]);
  g.queueOrder(1, build());
  g.tick();
  assert.deepEqual(planTurn(g, C), [], 'mid-channel: leaves its carried build alone');
  const m = new Match(g, { vsCpu: true });
  m.startTurn();
  assert.deepEqual(g.queue, [{ unitId: 1, order: build(), carried: true }]);
  m.endTurn();
  assert.equal(g.buildings.length, 1);
  // Its hex is built on now: it moves to a fresh one.
  assert.equal(planTurn(g, C)[0][1].type, 'move');
  // An enemy within 2: it steps away.
  const near = new Game({ width: 8, height: 8, units: [{ x: 3, y: 3, type: B, team: C }, { x: 5, y: 3 }] });
  assert.equal(planTurn(near, C)[0][1].type, 'move');
});

// ---- Buildings stop projectiles ------------------------------------------

test('a shot that flies into a building stops there; the unit behind is safe', () => {
  // Player building at (2,0); CPU gunslinger at the left end shoots right at (4,0).
  const g = row(6, [[2, { type: B }], [0, { type: 'gunslinger', team: C }], [4]]);
  buildHere(g, 1);
  g.queueOrder(1, move(3, 0)); // builder steps off
  g.tick();
  g.queueOrder(2, attack('right'));
  const events = g.tick();
  const blocked = events.find((e) => e.type === 'projectileBlocked');
  assert.deepEqual([blocked.at, blocked.buildingId], [[2, 0], 1]);
  assert.deepEqual(kills(events), []);
  assert.equal(g.projectiles.length, 0, 'used up');
  assert.equal(g.buildings.length, 1, 'the building is unharmed');
});

test('a unit standing on a building is shielded from shots', () => {
  const g = row(6, [[2, { type: B }], [0, { type: 'gunslinger', team: C }]]);
  buildHere(g, 1);
  g.queueOrder(2, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [], 'the builder on its building survives');
  assert.ok(events.some((e) => e.type === 'projectileBlocked'));
});

test('buildings of either team stop shots, including your own side\'s', () => {
  const g = row(6, [[2, { type: B }], [0, { type: 'gunslinger' }], [4, { team: C }]]);
  buildHere(g, 1);
  g.queueOrder(1, move(3, 0));
  g.tick();
  g.queueOrder(2, attack('right')); // our own building is in the way
  assert.deepEqual(kills(g.tick()), []);
});

test('a gunslinger standing on a building can still shoot out of it', () => {
  // Column 1 of a 3-wide board: the builder builds at (1,1), steps aside to
  // (1,0); our gunslinger steps onto the building and fires along the row.
  const g = new Game({ width: 7, height: 3, units: [{ x: 1, y: 1, type: B }, { x: 0, y: 1, type: 'gunslinger' }, { x: 5, y: 1, team: C }] });
  buildHere(g, 1);
  g.queueOrder(1, move(1, 0));
  g.tick();
  g.queueOrder(2, move(1, 1));
  g.tick();
  assert.ok(g.buildingAt(1, 1) && g.unitAt(1, 1).id === 2);
  g.queueOrder(2, attack('right'));
  assert.deepEqual(kills(g.tick()), [3]);
});

test('the CPU doesn\'t shoot into buildings or at units standing on one', () => {
  const g = row(8, [[3, { type: B }], [0, { type: 'gunslinger', team: C }], [6]]);
  buildHere(g, 1);
  // The building at (3,0) is between the CPU gunslinger and both our units.
  assert.ok(!planTurn(g, C).some(([, o]) => o.type === 'attack'));
});
