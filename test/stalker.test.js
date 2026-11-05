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
// A one-row board: units are given as [x, extra] (row 0).
const row = (width, units) => new Game({ width, height: 1, units: units.map(([x, extra = {}]) => ({ x, y: 0, ...extra })) });

test('the stalker comes from the unit JSON: no attack, a 3-hex teleport that leaves a mine', () => {
  const def = UnitTypes.stalker;
  assert.equal(def.attack, null);
  assert.deepEqual(def.teleport, { distance: 3, leavesMine: true, maxMines: 2, uses: null });
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0, type: S }, { x: 4, y: 4 }] });
  assert.equal(g.getUnit(1).teleports, null, 'unlimited');
  assert.equal(g.getUnit(2).teleports, 0);
  assert.throws(() => g.queueOrder(1, attack('right')), /Stalker units cannot attack/);
  assert.throws(() => g.queueOrder(2, teleport(2, 2)), /Pikeman units cannot teleport/);
});

test('teleport: jumps up to 3 hexes, ignoring what\'s in between, and leaves a mine behind', () => {
  // Water and a unit sit between the stalker and its landing hex.
  const g = new Game({ width: 6, height: 1, terrain: ['.~....'], units: [{ x: 0, y: 0, type: S }, { x: 2, y: 0 }] });
  g.queueOrder(1, teleport(3, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [3, 0]);
  assert.deepEqual(events.find((e) => e.type === 'teleported').from, [0, 0]);
  assert.deepEqual(g.mines.map((m) => [m.x, m.y, m.ownerId, m.team]), [[0, 0, 1, 'player']]);
  assert.deepEqual(g.queue, []);
});

test('teleport limits: range, landing terrain, own hex', () => {
  const g = new Game({ width: 6, height: 6, terrain: ['......', '......', '..~...', '......', '......', '......'], units: [{ x: 0, y: 0, type: S }] });
  assert.throws(() => g.queueOrder(1, teleport(4, 0)), /can teleport up to 3 hexes \(4,0 is 4 away\)/);
  assert.throws(() => g.queueOrder(1, teleport(2, 2)), /can't stand on Water/);
  assert.throws(() => g.queueOrder(1, teleport(0, 0)), /somewhere else/);
  assert.doesNotThrow(() => g.queueOrder(1, teleport(3, 0)));
  assert.doesNotThrow(() => g.queueOrder(1, teleport(1, 3)));
});

test('if the landing hex is taken earlier in the queue, nothing happens (no mine either)', () => {
  const g = row(6, [[0, { type: S }], [4]]);
  g.queueOrder(2, move(3, 0));
  g.queueOrder(1, teleport(3, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [0, 0]);
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 1 && e.by === 2));
  assert.deepEqual(g.mines, []);
});

test('a unit walking onto a mine is killed and the mine is used up', () => {
  const g = row(6, [[2, { type: S }], [4, { team: C }]]);
  g.queueOrder(1, teleport(5, 0)); // leaves a mine at (2,0)
  g.tick();
  g.queueOrder(2, move(3, 0));
  g.tick();
  g.queueOrder(2, move(2, 0));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  const boom = events.find((e) => e.type === 'mineExploded');
  assert.deepEqual([boom.at, boom.unitId], [[2, 0], 2]);
  assert.equal(events.find((e) => e.type === 'killed').hits[0].cause, 'mine');
  assert.deepEqual(g.mines, []);
});

test('walking THROUGH a mined hex sets it off too', () => {
  // A speed-2 unit's route passes over the mine at (2,0) on its way to (1,0).
  const g = row(6, [[2, { type: S }], [3, { speed: 2 }]]);
  g.queueOrder(1, teleport(5, 0));
  g.tick();
  g.queueOrder(2, move(1, 0));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual(events.find((e) => e.type === 'moved').path, [[3, 0], [2, 0]], 'stopped dead on the mine');
});

test('any unit sets it off: teammates, and the stalker itself', () => {
  const g = row(6, [[2, { type: S }]]);
  g.queueOrder(1, teleport(3, 0));
  g.tick();
  g.queueOrder(1, move(2, 0)); // back onto its own mine
  assert.deepEqual(kills(g.tick()), [1]);
});

test('charging through a mine kills the pikeman before it strikes', () => {
  const g = row(7, [[2, { type: S }], [0], [5, { team: C }]]);
  g.queueOrder(1, teleport(4, 0)); // mine at (2,0)
  g.tick();
  g.queueOrder(2, charge('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.ok(!events.some((e) => e.type === 'strike'));
});

test('teleporting onto a mine sets it off', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 0, y: 0, type: S }, { x: 5, y: 0, type: S }] });
  g.queueOrder(1, teleport(3, 0)); // mine at (0,0)
  g.tick();
  g.queueOrder(1, teleport(0, 0));
  assert.deepEqual(kills(g.tick()), [1]);
});

test('shots fly over mines', () => {
  const g = row(6, [[2, { type: S }], [0, { type: 'gunslinger' }], [3, { team: C }]]);
  g.queueOrder(1, teleport(5, 0)); // mine at (2,0), between the gunslinger and its target
  g.tick();
  g.queueOrder(2, attack('right'));
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
  assert.deepEqual(limited.teleport, { distance: 2, leavesMine: false, maxMines: null, uses: 1 });
  assert.throws(bad({ distance: 3, leavesMine: true, maxMines: 0 }), /"teleport.maxMines"/);
  assert.throws(bad({ distance: 3, maxMines: 2 }), /only makes sense with "leavesMine"/);
});

test('mines survive a snapshot round-trip', () => {
  const g = row(6, [[0, { type: S }]]);
  g.queueOrder(1, teleport(3, 0));
  g.tick();
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.equal(copy.hash(), g.hash());
  assert.deepEqual(copy.mines, g.mines);
});

test('the CPU stalker teleports away from an enemy that gets close, leaving a mine', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 2, y: 3, type: S, team: C }, { x: 4, y: 3 }] });
  const [[id, order]] = planTurn(g, C);
  assert.equal(id, 1);
  assert.equal(order.type, 'teleport');
  // It lands further from the enemy (hex distance) than it was.
  assert.ok(distance(order.x, order.y, 4, 3) > distance(2, 3, 4, 3));
  // Far away: it walks closer instead; at about 3 it waits.
  const far = new Game({ width: 8, height: 8, units: [{ x: 0, y: 3, type: S, team: C }, { x: 7, y: 3 }] });
  assert.equal(planTurn(far, C)[0][1].type, 'move');
  const mid = new Game({ width: 8, height: 8, units: [{ x: 1, y: 3, type: S, team: C }, { x: 4, y: 3 }] });
  assert.deepEqual(planTurn(mid, C), []);
});

test('CPU units don\'t walk onto mines', () => {
  // A player stalker's mine sits right between a CPU pikeman and its target.
  const g = row(8, [[3, { type: S }], [0, { team: C }], [7]]);
  g.queueOrder(1, teleport(6, 0)); // mine at (3,0)
  g.tick();
  g.getUnit(2).charges = 0;
  for (let t = 0; t < 6; t++) {
    for (const [id, o] of planTurn(g, C)) g.queueOrder(id, o);
    const events = g.tick();
    assert.ok(!events.some((e) => e.type === 'mineExploded'), `turn ${t}`);
  }
  assert.ok(g.getUnit(2).x < 3, 'it never crossed the mine (a 1-tall row has no way round)');
});

test('in a match: an enemy chasing the CPU stalker walks into its mine', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 5, y: 0 }, { x: 3, y: 0, type: S, team: C }] });
  g.getUnit(1).charges = 0;
  const m = new Match(g);
  m.startTurn();
  assert.equal(g.queue[0].order.type, 'teleport', 'the stalker hops away from us');
  m.endTurn();
  assert.deepEqual(g.mines.map((mine) => [mine.x, mine.y]), [[3, 0]]);
  m.playerOrder(1, move(4, 0));
  m.endTurn();
  m.playerOrder(1, move(3, 0)); // chase it, onto the mine
  const events = m.endTurn();
  assert.ok(events.some((e) => e.type === 'mineExploded' && e.unitId === 1));
});

// ---- At most 2 mines; no mine, no teleport --------------------------------

test('a stalker can have at most 2 mines; with 2 down it can\'t teleport (it couldn\'t lay a mine)', () => {
  const g = row(10, [[0, { type: S }]]);
  g.queueOrder(1, teleport(3, 0));
  g.tick(); // mine 1 at (0,0)
  g.queueOrder(1, teleport(6, 0));
  g.tick(); // mine 2 at (3,0)
  assert.equal(g.minesOf(1).length, 2);
  g.queueOrder(1, teleport(9, 0));
  const events = g.tick();
  assert.deepEqual(pos(g, 1), [6, 0], 'stayed put');
  assert.ok(events.some((e) => e.type === 'blocked' && e.unitId === 1 && e.reason === 'mine limit'));
  assert.equal(g.mines.length, 2, 'no third mine');
  // It can still walk.
  g.queueOrder(1, move(7, 0));
  g.tick();
  assert.deepEqual(pos(g, 1), [7, 0]);
});

test('once one of its mines goes off, it can teleport again; even if that happens earlier in the same queue', () => {
  const g = new Game({ width: 10, height: 1, units: [{ x: 0, y: 0, type: S }, { x: 9, y: 0, team: C }] });
  g.queueOrder(1, teleport(3, 0));
  g.tick(); // mine at (0,0)
  g.queueOrder(1, teleport(6, 0));
  g.tick(); // mine at (3,0); stalker at (6,0)
  g.getUnit(2).x = 4; // (put the enemy next to the mine at (3,0))
  g.queueOrder(2, move(3, 0)); // sets off mine 2, earlier in the queue...
  g.queueOrder(1, teleport(8, 0)); // ...so this teleport is allowed
  const events = g.tick();
  assert.ok(events.some((e) => e.type === 'mineExploded' && e.unitId === 2));
  assert.deepEqual(pos(g, 1), [8, 0]);
  assert.equal(g.minesOf(1).length, 2);
});

test('mine limits are per stalker', () => {
  const g = row(12, [[0, { type: S }], [11, { type: S }]]);
  for (const [a, b] of [[3, 8], [6, 5]]) {
    g.queueOrder(1, teleport(a, 0));
    g.queueOrder(2, teleport(b, 0));
    g.tick();
  }
  assert.deepEqual([g.minesOf(1).length, g.minesOf(2).length], [2, 2]);
});

test('the CPU stalker at its mine limit doesn\'t try to teleport; it walks away instead', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 2, y: 3, type: S, team: C }, { x: 4, y: 3 }] });
  g.state.mines.push({ id: 1, x: 0, y: 0, ownerId: 1, team: C }, { id: 2, x: 7, y: 7, ownerId: 1, team: C });
  const plan = planTurn(g, C);
  assert.equal(plan.length, 1);
  assert.equal(plan[0][1].type, 'move');
  assert.ok(distance(plan[0][1].x, plan[0][1].y, 4, 3) > 2, 'away from the enemy');
});
