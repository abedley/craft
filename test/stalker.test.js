// Stalkers: no attack; teleport up to 3 hexes, leaving a mine behind. A mine
// kills any unit that walks, charges or teleports onto it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, attack, charge, teleport, distance, UnitTypes, defineUnitType } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const S = 'stalker';
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);
const col = (height, units) => new Game({ width: 1, height, units: units.map(([y, extra = {}]) => ({ x: 0, y, ...extra })) });

test('the stalker comes from the unit JSON: no attack, a 3-hex teleport that leaves a mine', () => {
  const def = UnitTypes.stalker;
  assert.equal(def.attack, null);
  assert.deepEqual(def.teleport, { distance: 3, leavesMine: true, uses: null });
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0, type: S }, { x: 4, y: 4 }] });
  assert.equal(g.getUnit(1).teleports, null, 'unlimited');
  assert.equal(g.getUnit(2).teleports, 0);
  assert.throws(() => g.queueOrder(1, attack('down')), /Stalker units cannot attack/);
  assert.throws(() => g.queueOrder(2, teleport(2, 2)), /Pikeman units cannot teleport/);
});

test('teleport: jumps up to 3 hexes, ignoring what\'s in between, and leaves a mine behind', () => {
  // Water and a unit sit between the stalker and its landing hex.
  const g = new Game({ width: 1, height: 6, terrain: ['.', '~', '.', '.', '.', '.'], units: [{ x: 0, y: 0, type: S }, { x: 0, y: 2 }] });
  g.queueOrder(1, teleport(0, 3));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 3]);
  assert.deepEqual(events.find((e) => e.type === 'teleported').from, [0, 0]);
  assert.deepEqual(g.mines.map((m) => [m.x, m.y, m.ownerId, m.team]), [[0, 0, 1, 'player']]);
  assert.deepEqual(g.queue, []);
});

test('teleport limits: range, landing terrain, own hex', () => {
  const g = new Game({ width: 6, height: 6, terrain: ['......', '......', '..~...', '......', '......', '......'], units: [{ x: 0, y: 0, type: S }] });
  assert.throws(() => g.queueOrder(1, teleport(0, 4)), /can teleport up to 3 hexes \(0,4 is 4 away\)/);
  assert.throws(() => g.queueOrder(1, teleport(2, 2)), /can't stand on Water/);
  assert.throws(() => g.queueOrder(1, teleport(0, 0)), /somewhere else/);
  assert.doesNotThrow(() => g.queueOrder(1, teleport(0, 3)));
  assert.doesNotThrow(() => g.queueOrder(1, teleport(3, 1)));
});

test('if the landing hex is taken earlier in the queue, nothing happens (no mine either)', () => {
  const g = col(6, [[0, { type: S }], [4]]);
  g.queueOrder(2, move(0, 3));
  g.queueOrder(1, teleport(0, 3));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 0]);
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 1 && e.by === 2));
  assert.deepEqual(g.mines, []);
});

test('a unit walking onto a mine is killed and the mine is used up', () => {
  const g = col(6, [[2, { type: S }], [4, { team: C }]]);
  g.queueOrder(1, teleport(0, 5)); // leaves a mine at (0,2)
  g.tick();
  g.queueOrder(2, move(0, 3));
  g.tick();
  g.queueOrder(2, move(0, 2));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  const boom = events.find((e) => e.type === 'mineExploded');
  assert.deepEqual([boom.at, boom.unitId], [[0, 2], 2]);
  assert.equal(events.find((e) => e.type === 'killed').hits[0].cause, 'mine');
  assert.deepEqual(g.mines, []);
});

test('walking THROUGH a mined hex sets it off too', () => {
  // A speed-2 unit's route passes over the mine at (0,2) on its way to (0,1).
  const g = col(6, [[2, { type: S }], [3, { speed: 2 }]]);
  g.queueOrder(1, teleport(0, 5));
  g.tick();
  g.queueOrder(2, move(0, 1));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[0, 3], [0, 2]], 'stopped dead on the mine');
});

test('any unit sets it off: teammates, and the stalker itself', () => {
  const g = col(6, [[2, { type: S }]]);
  g.queueOrder(1, teleport(0, 3));
  g.tick();
  g.queueOrder(1, move(0, 2)); // back onto its own mine
  assert.deepEqual(kills(g.tick()), [1]);
});

test('charging through a mine kills the pikeman before it strikes', () => {
  const g = col(7, [[2, { type: S }], [0], [5, { team: C }]]);
  g.queueOrder(1, teleport(0, 4)); // mine at (0,2)
  g.tick();
  g.queueOrder(2, charge('down'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.ok(!events.some((e) => e.type === 'strike'));
});

test('teleporting onto a mine sets it off', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0, type: S }, { x: 0, y: 5, type: S }] });
  g.queueOrder(1, teleport(0, 3)); // mine at (0,0)
  g.tick();
  g.queueOrder(1, teleport(0, 0));
  assert.deepEqual(kills(g.tick()), [1]);
});

test('shots fly over mines', () => {
  const g = col(6, [[2, { type: S }], [0, { type: 'gunslinger' }], [3, { team: C }]]);
  g.queueOrder(1, teleport(0, 5)); // mine at (0,2), between the gunslinger and its target
  g.tick();
  g.queueOrder(2, attack('down'));
  const events = g.tick();
  assert.deepEqual(kills(events), [3]);
  assert.equal(g.mines.length, 1);
});

test('teleport definitions are validated; uses can be limited', () => {
  const bad = (t) => () => defineUnitType('x', { name: 'X', speed: 1, teleport: t });
  assert.throws(bad({ distance: 0 }), /"teleport.distance"/);
  assert.throws(bad({ distance: 3, leavesMine: 'yes' }), /"teleport.leavesMine"/);
  assert.throws(bad({ distance: 3, uses: 0 }), /"teleport.uses"/);
  assert.throws(bad({ distance: 3, range: 2 }), /unknown field "teleport.range"/);
  const limited = defineUnitType('x', { name: 'X', speed: 1, teleport: { distance: 2, uses: 1 } });
  assert.deepEqual(limited.teleport, { distance: 2, leavesMine: false, uses: 1 });
});

test('mines survive a snapshot round-trip', () => {
  const g = col(6, [[0, { type: S }]]);
  g.queueOrder(1, teleport(0, 3));
  g.tick();
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  assert.deepEqual(copy.mines, g.mines);
});

test('the CPU stalker teleports away from an enemy that gets close, leaving a mine', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 3, y: 2, type: S, team: C }, { x: 3, y: 4 }] });
  const [[id, order]] = planTurn(g, C);
  assert.equal(id, 1);
  assert.equal(order.type, 'teleport');
  // It lands further from the enemy (hex distance) than it was.
  assert.ok(distance(order.x, order.y, 3, 4) > distance(3, 2, 3, 4));
  // Far away: it walks closer instead; at about 3 it waits.
  const far = new Game({ width: 8, height: 8, units: [{ x: 3, y: 0, type: S, team: C }, { x: 3, y: 7 }] });
  assert.equal(planTurn(far, C)[0][1].type, 'move');
  const mid = new Game({ width: 8, height: 8, units: [{ x: 3, y: 1, type: S, team: C }, { x: 3, y: 4 }] });
  assert.deepEqual(planTurn(mid, C), []);
});

test('CPU units don\'t walk onto mines', () => {
  // A player stalker's mine sits right between a CPU pikeman and its target.
  const g = col(8, [[3, { type: S }], [0, { team: C }], [7]]);
  g.queueOrder(1, teleport(0, 6)); // mine at (0,3)
  g.tick();
  g.getUnit(2).charges = 0;
  for (let t = 0; t < 6; t++) {
    for (const [id, o] of planTurn(g, C)) g.queueOrder(id, o);
    const events = g.tick();
    assert.ok(!events.some((e) => e.type === 'mineExploded'), `turn ${t}`);
  }
  assert.ok(g.getUnit(2).y < 3, 'it never crossed the mine (a 1-wide column has no way round)');
});

test('in a match: an enemy chasing the CPU stalker walks into its mine', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 5 }, { x: 0, y: 3, type: S, team: C }] });
  g.getUnit(1).charges = 0;
  const m = new Match(g);
  m.startTurn();
  assert.equal(g.queue[0].order.type, 'teleport', 'the stalker hops away from us');
  m.endTurn();
  assert.deepEqual(g.mines.map((mine) => [mine.x, mine.y]), [[0, 3]]);
  m.playerOrder(1, move(0, 4));
  m.endTurn();
  m.playerOrder(1, move(0, 3)); // chase it, onto the mine
  const events = m.endTurn();
  assert.ok(events.some((e) => e.type === 'mineExploded' && e.unitId === 1));
});
