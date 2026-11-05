// Projectiles under the queue rules. A shot is fired when its entry runs and
// immediately flies its speed (4 hexes for gunslingers); if it's still in
// flight it gets an entry at the front of next turn's queue. Rows are
// straight left/right hex lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, move, attack } from '../src/engine/index.js';

const G = 'gunslinger';
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => [e.unitId, e.step]);
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];
// A one-row board: units are given as [x, extra] (row 0).
const row = (width, units) => new Game({ width, height: 1, units: units.map(([x, extra = {}]) => ({ x, y: 0, ...extra })) });

test('unit types: gunslinger moves 1 hex a turn and shoots in all 6 hex directions; pikemen are the default', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 2, y: 2, type: G }, { x: 4, y: 4 }] });
  assert.equal(g.getUnit(1).speed, 1);
  assert.equal(g.getUnit(2).type, 'pikeman');
  assert.throws(() => g.queueOrder(1, attack('north')), /direction/);
  assert.throws(() => g.queueOrder(1, attack('up')), /direction/); // no straight up/down on pointy-top hexes
  for (const dir of ['left', 'down-left', 'down-right', 'right', 'up-right', 'up-left']) {
    assert.doesNotThrow(() => g.queueOrder(1, attack(dir)));
  }
  assert.throws(() => g.addUnit(2, 2, undefined, { type: 'wizard' }), /Unknown unit type/);
});

test('a shot flies 4 hexes when fired, carries over to the front of next turn, and leaves the board', () => {
  const g = row(10, [[0, { type: G }]]);
  g.queueOrder(1, attack('right'));
  let events = g.tick();
  assert.ok(events.some((e) => e.type === 'shot' && e.projectileId === 1));
  assert.deepEqual(events.find((e) => e.type === 'projectileMoved').path, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  assert.deepEqual(g.queue, [{ projectileId: 1, carried: true }]);
  g.tick();
  assert.equal(g.projectiles[0].x, 8);
  events = g.tick(); // 9, then off the board
  assert.equal(g.projectiles.length, 0);
  assert.deepEqual(g.queue, []);
  assert.ok(events.some((e) => e.type === 'projectileExpired'));
});

test('shots fly straight along diagonal hex lines too', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('down-right'));
  const pm = g.tick().find((e) => e.type === 'projectileMoved');
  assert.deepEqual(pm.path, [[0, 0], [0, 1], [1, 2], [1, 3], [2, 4]]);
});

test('attacking replaces a queued move: the shooter stays put', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, move(1, 0));
  g.queueOrder(1, attack('down-right'));
  g.tick();
  assert.deepEqual(pos(g, 1), [0, 0]);
  assert.equal(g.orderFor(1), null);
});

test('a shot kills the first unit it meets, in its own queue step; the shooter is unharmed', () => {
  const g = row(8, [[0, { type: G }], [3], [4]]);
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, 1]]);
  assert.ok(g.getUnit(1) && g.getUnit(3), 'shooter and the unit behind survive');
  assert.equal(g.projectiles.length, 0);
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.by, k.shooterId, k.hits[0].cause], [[1], 1, 'projectile']);
});

test('a target beyond 4 hexes is hit next turn, when the carried shot flies first', () => {
  const g = row(8, [[0, { type: G }], [6]]);
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), []);
  g.queueOrder(2, move(7, 0)); // too late: the shot is at the front of the queue
  assert.deepEqual(kills(g.tick()), [[2, 1]]);
});

test('queue order decides a shot vs a dodge', () => {
  // Target 2 hexes along row 1; dodging means stepping up-left off the row.
  const setup = () => new Game({ width: 6, height: 3, units: [{ x: 0, y: 1, type: G }, { x: 2, y: 1 }] });

  const shotFirst = setup();
  shotFirst.queueOrder(1, attack('right'));
  shotFirst.queueOrder(2, move(2, 0));
  assert.deepEqual(kills(shotFirst.tick()), [[2, 1]]);

  const dodgeFirst = setup();
  dodgeFirst.queueOrder(2, move(2, 0));
  dodgeFirst.queueOrder(1, attack('right'));
  assert.deepEqual(kills(dodgeFirst.tick()), []);
  assert.deepEqual(pos(dodgeFirst, 2), [2, 0]);
});

test('walking into a hex where a shot is in flight is a hit', () => {
  // Fire along row 1; the shot ends the turn resting at (4,1).
  const g = new Game({ width: 10, height: 3, units: [{ x: 0, y: 1, type: G }, { x: 4, y: 0 }] });
  g.queueOrder(1, attack('right'));
  g.tick();
  assert.deepEqual([g.projectiles[0].x, g.projectiles[0].y], [4, 1]);
  // Normally the carried shot flies first next turn. Put the walk ahead of it
  // (as a quick move would be) and the unit steps into the shot.
  g.state.queue = [];
  g.queueOrder(2, move(4, 1));
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, 1]]);
  assert.equal(g.projectiles.length, 0);
});

test('two gunslingers facing each other: whoever is first in the queue wins', () => {
  const g = row(4, [[0, { type: G }], [3, { type: G }]]);
  g.queueOrder(2, attack('left'));
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [[1, 1]]);
  assert.ok(events.some((e) => e.type === 'orderDropped' && e.unitId === 1 && e.step === 2));
  assert.ok(g.getUnit(2));
});

test('a killed unit frees its hex for entries later in the queue', () => {
  const g = row(5, [[0, { type: G }], [1], [2]]);
  g.queueOrder(1, attack('right'));
  g.queueOrder(3, move(1, 0));
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, 1]]);
  assert.deepEqual(pos(g, 3), [1, 0]);
});

test('projectiles pass through each other', () => {
  const g = new Game({ width: 4, height: 9, units: [{ x: 0, y: 2, type: G }, { x: 2, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, attack('down-left')); // crosses the first shot's path at (1,2)
  g.tick();
  assert.equal(g.units.length, 2);
});
