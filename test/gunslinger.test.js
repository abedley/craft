// Gunslingers can't shoot with an enemy next to them. The check happens when
// the shot's queue entry runs; a shot already fired is unaffected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, attack, UnitTypes, defineUnitType, neighbors } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const G = 'gunslinger';
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('the rule comes from the unit JSON: gunslingers have it, pikemen don\'t', () => {
  assert.equal(UnitTypes.gunslinger.attack.blockedByAdjacentEnemy, true);
  assert.equal(UnitTypes.pikeman.attack.blockedByAdjacentEnemy, false);
  assert.throws(
    () => defineUnitType('x', { name: 'X', speed: 1, attack: { kind: 'melee', reach: 1, directions: 'all', blockedByAdjacentEnemy: 'yes' } }),
    /blockedByAdjacentEnemy" must be true or false/,
  );
});

test('with an enemy next to it, a gunslinger\'s shot fails and nothing is fired', () => {
  // Column 1: gunslinger at (1,1), target at (1,4); enemy pikeman beside it at (0,1).
  const g = new Game({ width: 3, height: 7, units: [{ x: 1, y: 1, type: G }, { x: 1, y: 4, team: C }, { x: 0, y: 1, team: C }] });
  g.queueOrder(1, attack('down'));
  const events = g.tick();
  assert.deepEqual(kills(events), []);
  assert.equal(g.projectiles.length, 0);
  const b = events.find((e) => e.type === 'attackBlocked');
  assert.deepEqual([b.unitId, b.reason, b.by, b.step], [1, 'enemy adjacent', 3, 1]);
  assert.deepEqual(g.queue, [], 'the failed attack does not carry over');
});

test('it also stops shooting the adjacent enemy itself', () => {
  const g = new Game({ width: 1, height: 4, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 1, team: C }] });
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), []);
});

test('a teammate next to it doesn\'t stop it', () => {
  const g = new Game({ width: 3, height: 7, units: [{ x: 1, y: 1, type: G }, { x: 1, y: 4, team: C }, { x: 0, y: 1 }] });
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('if the gunslinger has already shot, an enemy arriving next to it is too late', () => {
  // The enemy pikeman steps next to the gunslinger AFTER the shot in the queue.
  const g = new Game({ width: 3, height: 7, units: [{ x: 1, y: 1, type: G }, { x: 1, y: 4, team: C }, { x: 0, y: 3, team: C }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(3, move(0, 1));
  const events = g.tick();
  assert.deepEqual(kills(events), [2], 'the shot succeeded');
  assert.ok(events.some((e) => e.type === 'moved' && e.unitId === 3));
  assert.ok(!events.some((e) => e.type === 'attackBlocked'));
});

test('an enemy arriving BEFORE the shot in the queue blocks it', () => {
  const g = new Game({ width: 3, height: 7, units: [{ x: 1, y: 1, type: G }, { x: 1, y: 4, team: C }, { x: 0, y: 3, team: C }] });
  g.queueOrder(3, move(0, 1));
  g.queueOrder(1, attack('down'));
  const events = g.tick();
  assert.deepEqual(kills(events), []);
  assert.ok(events.some((e) => e.type === 'attackBlocked' && e.unitId === 1));
});

test('a shot still flying from an earlier turn keeps going after an enemy reaches the shooter', () => {
  const g = new Game({ width: 3, height: 10, units: [{ x: 1, y: 0, type: G }, { x: 1, y: 7, team: C }, { x: 0, y: 2, team: C }] });
  g.queueOrder(1, attack('down'));
  g.tick(); // the shot is at (1,4), still flying
  g.queueOrder(3, move(0, 0)); // the pikeman reaches the gunslinger
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
});

test('an adjacent enemy that is killed or leaves earlier in the queue no longer blocks', () => {
  const g = new Game({ width: 3, height: 7, units: [{ x: 1, y: 1, type: G }, { x: 1, y: 4, team: C }, { x: 0, y: 1, team: C }] });
  g.queueOrder(3, move(0, 0)); // steps away (no longer adjacent) first
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('pikemen strike fine with an enemy next to them', () => {
  const g = new Game({ width: 1, height: 3, units: [{ x: 0, y: 0 }, { x: 0, y: 1, team: C }] });
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('the CPU doesn\'t plan a shot that would fail, and picks firing hexes away from enemies', () => {
  // CPU gunslinger with the player's pikeman right next to it, and another
  // player unit straight down its column.
  const g = new Game({ width: 5, height: 8, units: [{ x: 2, y: 0, type: G, team: C }, { x: 1, y: 0 }, { x: 2, y: 5 }] });
  const [[, order]] = planTurn(g, C);
  assert.equal(order.type, 'move', 'no doomed shot');
  const enemyNear = (x, y) => neighbors(x, y).some(([, nx, ny]) => g.unitAt(nx, ny)?.team === Teams.PLAYER);
  assert.ok(!enemyNear(order.x, order.y), `firing hex ${order.x},${order.y} is not next to an enemy`);

  // Nothing next to it: it shoots.
  const free = new Game({ width: 5, height: 8, units: [{ x: 2, y: 0, type: G, team: C }, { x: 2, y: 5 }] });
  assert.deepEqual(planTurn(free, C), [[1, attack('down')]]);
});

test('in a match: walking a pikeman up to a CPU gunslinger with a quick move stops its shot', () => {
  // The CPU gunslinger at the top of column 1 has a shot staged at the
  // player's gunslinger 3 below. The player's pikeman quick-moves next to it
  // first, so when the CPU's shot comes up it fails.
  const g = new Game({ width: 3, height: 7, units: [{ x: 1, y: 3, type: G }, { x: 0, y: 2 }, { x: 1, y: 0, type: G, team: C }] });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue[0], { unitId: 3, order: attack('down') });
  m.playerOrder(2, { type: 'move', x: 0, y: 1, quick: true });
  const events = m.endTurn();
  assert.ok(events.some((e) => e.type === 'attackBlocked' && e.unitId === 3));
  assert.ok(g.getUnit(1), 'our gunslinger survived');
});
