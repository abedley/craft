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
  // Row 1: gunslinger at (1,1), target at (4,1); enemy pikeman beside it at (1,0).
  const g = new Game({ width: 7, height: 3, units: [{ x: 1, y: 1, type: G }, { x: 4, y: 1, team: C }, { x: 1, y: 0, team: C }] });
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), []);
  assert.equal(g.projectiles.length, 0);
  const b = events.find((e) => e.type === 'attackBlocked');
  assert.deepEqual([b.unitId, b.reason, b.by, b.step], [1, 'enemy adjacent', 3, 1]);
  assert.deepEqual(g.queue, [], 'the failed attack does not carry over');
});

test('it also stops shooting the adjacent enemy itself', () => {
  const g = new Game({ width: 4, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 1, y: 0, team: C }] });
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), []);
});

test('a teammate next to it doesn\'t stop it', () => {
  const g = new Game({ width: 7, height: 3, units: [{ x: 1, y: 1, type: G }, { x: 4, y: 1, team: C }, { x: 1, y: 0 }] });
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('if the gunslinger has already shot, an enemy arriving next to it is too late', () => {
  // The enemy pikeman steps next to the gunslinger AFTER the shot in the queue.
  const g = new Game({ width: 7, height: 3, units: [{ x: 1, y: 1, type: G }, { x: 4, y: 1, team: C }, { x: 3, y: 0, team: C }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(3, move(2, 0)); // one step, to a hex beside the gunslinger
  const events = g.tick();
  assert.deepEqual(kills(events), [2], 'the shot succeeded');
  assert.ok(events.some((e) => e.type === 'moved' && e.unitId === 3));
  assert.ok(!events.some((e) => e.type === 'attackBlocked'));
});

test('an enemy arriving BEFORE the shot in the queue blocks it', () => {
  const g = new Game({ width: 7, height: 3, units: [{ x: 1, y: 1, type: G }, { x: 4, y: 1, team: C }, { x: 3, y: 0, team: C }] });
  g.queueOrder(3, move(2, 0)); // one step, to a hex beside the gunslinger
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), []);
  assert.ok(events.some((e) => e.type === 'attackBlocked' && e.unitId === 1));
});

test('a shot still flying from an earlier turn keeps going after an enemy reaches the shooter', () => {
  const g = new Game({ width: 10, height: 3, units: [{ x: 0, y: 1, type: G }, { x: 7, y: 1, team: C }, { x: 2, y: 0, team: C }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // the shot is at (4,1), still flying
  g.queueOrder(3, move(1, 0)); // the pikeman reaches the gunslinger
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
});

test('an adjacent enemy that is killed or leaves earlier in the queue no longer blocks', () => {
  const g = new Game({ width: 7, height: 3, units: [{ x: 1, y: 1, type: G }, { x: 4, y: 1, team: C }, { x: 1, y: 0, team: C }] });
  g.queueOrder(3, move(0, 0)); // steps away (no longer adjacent) first
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('pikemen strike fine with an enemy next to them', () => {
  const g = new Game({ width: 3, height: 1, units: [{ x: 0, y: 0 }, { x: 1, y: 0, team: C }] });
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [2]);
});

test('the CPU doesn\'t plan a shot that would fail, and picks firing hexes away from enemies', () => {
  // CPU gunslinger with the player's pikeman right next to it, and another
  // player unit straight along its row.
  const g = new Game({ width: 8, height: 5, units: [{ x: 0, y: 2, type: G, team: C }, { x: 0, y: 1 }, { x: 5, y: 2 }] });
  const [[, order]] = planTurn(g, C);
  assert.equal(order.type, 'move', 'no doomed shot');
  // It heads for a firing hex that isn't next to an enemy: after walking
  // there (one hex a turn), it can shoot.
  const m = new Match(g, { vsCpu: true });
  let fired = false;
  for (let t = 0; t < 6 && !fired; t++) {
    m.startTurn();
    fired = g.queue.some((e) => e.unitId === 1 && e.order.type === 'attack');
    if (fired) {
      const u = g.getUnit(1);
      assert.ok(!neighbors(u.x, u.y).some(([, nx, ny]) => g.unitAt(nx, ny)?.team === Teams.PLAYER));
    } else {
      m.endTurn();
    }
  }
  assert.ok(fired, 'it got to a clear firing hex and shoots');

  // Nothing next to it: it shoots.
  const free = new Game({ width: 8, height: 5, units: [{ x: 0, y: 2, type: G, team: C }, { x: 5, y: 2 }] });
  assert.deepEqual(planTurn(free, C), [[1, attack('right')]]);
});

test('in a match: walking a pikeman up to a CPU gunslinger with a quick move stops its shot', () => {
  // The CPU gunslinger at the left end of row 1 has a shot staged at the
  // player's gunslinger 3 hexes to its right. The player's pikeman quick-moves next to it
  // first, so when the CPU's shot comes up it fails.
  const g = new Game({ width: 7, height: 3, units: [{ x: 3, y: 1, type: G }, { x: 2, y: 0 }, { x: 0, y: 1, type: G, team: C }] });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue[0], { unitId: 3, order: attack('right') });
  m.playerOrder(2, { type: 'move', x: 1, y: 0, quick: true });
  const events = m.endTurn();
  assert.ok(events.some((e) => e.type === 'attackBlocked' && e.unitId === 3));
  assert.ok(g.getUnit(1), 'our gunslinger survived');
});

// ---- One shot in flight at a time ----------------------------------------

test('a gunslinger can\'t shoot while its last shot is still flying', () => {
  const g = new Game({ width: 12, height: 1, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // shot at (4,0), still flying
  assert.equal(g.projectilesOf(1).length, 1);
  assert.equal(UnitTypes.gunslinger.attack.maxInFlight, 1);
  // Its carried-over shot flies first (to (8,0)), and is still in flight
  // when the new shot comes up, so the new one fails.
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  const b = events.find((e) => e.type === 'attackBlocked');
  assert.deepEqual([b.unitId, b.reason, b.by], [1, 'projectile in flight', 1]);
  assert.equal(g.projectiles.length, 1);
});

test('once that shot has hit or left the board it can shoot again, even earlier in the same queue', () => {
  // The carried-over shot leaves the board on its flight at the front of
  // the queue; the new shot later in the same queue is then allowed.
  const g = new Game({ width: 7, height: 1, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // shot at (4,0)
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.ok(events.some((e) => e.type === 'projectileExpired' && e.projectileId === 1));
  assert.ok(events.some((e) => e.type === 'shot' && e.projectileId === 2));
  assert.ok(!events.some((e) => e.type === 'attackBlocked'));
});

test('a shot that hits frees the gunslinger to shoot again next turn', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 3, y: 0, team: C }, { x: 4, y: 0, team: C }] });
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [2]);
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [3]);
});

test('other units\' shots don\'t count, and pikemen are unaffected', () => {
  const g = new Game({ width: 12, height: 3, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 2, type: G }] });
  g.queueOrder(1, attack('right'));
  g.tick();
  g.queueOrder(2, attack('right'));
  assert.ok(g.tick().some((e) => e.type === 'shot' && e.unitId === 2));
  assert.ok(!UnitTypes.pikeman.attack.maxInFlight, 'melee attacks have no in-flight limit');
});

test('maxInFlight is validated', () => {
  const bad = (n) => () => defineUnitType('x', { name: 'X', speed: 1, attack: { kind: 'projectile', speed: 2, directions: 'all', maxInFlight: n } });
  assert.throws(bad(0), /"attack.maxInFlight"/);
  assert.throws(bad(1.5), /"attack.maxInFlight"/);
});

test('the CPU doesn\'t plan a shot while its last one will still be flying', () => {
  const g = new Game({ width: 16, height: 1, units: [{ x: 0, y: 0, type: G, team: C }, { x: 15, y: 0 }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // its shot at (4,0); after its next flight it'll be at (8,0), still flying
  const plan = planTurn(g, C);
  assert.ok(!plan.some(([, o]) => o.type === 'attack'));

  // A shot that will hit on its next flight doesn't hold it back.
  const h = new Game({ width: 10, height: 1, units: [{ x: 0, y: 0, type: G, team: C }, { x: 7, y: 0 }] });
  h.queueOrder(1, attack('right'));
  h.tick(); // shot at (4,0); next flight reaches (7,0) and hits
  assert.deepEqual(planTurn(h, C), [[1, attack('right')]]);
});
