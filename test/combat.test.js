import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, move, attack } from '../src/engine/index.js';

const G = 'gunslinger';
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => [e.unitId, e.time]);

test('unit types: gunslinger moves 1/tick and shoots in 4 directions; pikemen are the default', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 0, y: 0, type: G }, { x: 4, y: 4 }] });
  assert.equal(g.getUnit(1).speed, 1);
  assert.equal(g.getUnit(2).type, 'pikeman');
  assert.throws(() => g.queueOrder(1, attack('north')), /direction/);
  assert.throws(() => g.queueOrder(1, attack('up-left')), /direction/); // gunslingers: orthogonal only
  assert.doesNotThrow(() => g.queueOrder(2, attack('up-left'))); // pikemen: all 8
  assert.throws(() => g.addUnit(2, 2, undefined, { type: 'wizard' }), /Unknown unit type/);
});

test('projectile travels 4 cells per tick in a straight line and leaves the grid', () => {
  const g = new Game({ width: 10, height: 1, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  let events = g.tick();
  assert.ok(events.some((e) => e.type === 'shot' && e.projectileId === 1));
  assert.deepEqual([g.projectiles[0].x, g.projectiles[0].y], [4, 0]);
  const pm = events.find((e) => e.type === 'projectileMoved');
  assert.deepEqual(pm.path, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  g.tick();
  assert.equal(g.projectiles[0].x, 8);
  events = g.tick(); // 9, then off the grid
  assert.equal(g.projectiles.length, 0);
  assert.ok(events.some((e) => e.type === 'projectileExpired'));
});

test('shooting cancels a move order and the shooter holds still', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, move(5, 0));
  g.tick();
  g.queueOrder(1, attack('down'));
  g.tick();
  const u = g.getUnit(1);
  assert.deepEqual([u.x, u.y, u.order], [1, 0, null]);
});

test('only the last queued order per unit is carried out', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(1, move(3, 0));
  g.tick();
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.getUnit(1).x, 1);
});

test('hit kills and removes the target; projectile is used up; shooter is unharmed', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 6, y: 0 }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // projectile at 4
  const events = g.tick(); // 5 at t=1/4, 6 at t=1/2 -> hit
  assert.deepEqual(kills(events), [[2, '1/2']]);
  assert.equal(g.getUnit(2), null);
  assert.ok(g.getUnit(1));
  assert.equal(g.projectiles.length, 0);
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.by, k.shooterId], [[1], 1]);
});

test('adjacent target is hit at t=1/4 even if it tries to walk away', () => {
  const g = new Game({ width: 5, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 1, y: 0 }] });
  g.queueOrder(2, move(4, 0));
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, '1/4']]);
});

test('projectile hits only the first unit in its line', () => {
  const g = new Game({ width: 8, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 2, y: 0 }, { x: 3, y: 0 }] });
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, '1/2']]);
  assert.ok(g.getUnit(3));
});

test('a unit that steps out of the line in time survives', () => {
  // The unit at (5,0) steps down at t=1; the projectile reaches x=5 at
  // t=1/4 of the next tick and finds the cell empty.
  const g = new Game({ width: 8, height: 2, units: [{ x: 0, y: 0, type: G }, { x: 5, y: 0 }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, move(5, 1));
  g.tick();
  const events = g.tick();
  assert.deepEqual(kills(events), []);
  assert.ok(g.getUnit(2));
});

test('a unit stepping into the projectile\'s cell at the same instant is hit', () => {
  const g = new Game({ width: 12, height: 2, units: [{ x: 0, y: 0, type: G }, { x: 8, y: 1 }] });
  g.queueOrder(1, attack('right'));
  g.tick(); // projectile at (4,0)
  g.queueOrder(2, move(8, 0)); // unit steps into (8,0) at t=1, projectile reaches (8,0) at t=1
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, '1']]);
});

test('unit and projectile passing through each other is a hit', () => {
  // Speed-4 runner heading left meets the projectile head-on between cells.
  const g = new Game({
    width: 9, height: 1,
    units: [{ x: 0, y: 0, type: G }, { x: 4, y: 0, speed: 4 }],
  });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, move(0, 0));
  const events = g.tick();
  // t=1/4: projectile 0->1, runner 4->3. t=1/2: projectile 1->2, runner 3->2:
  // they meet in cell 2.
  assert.deepEqual(kills(events), [[2, '1/2']]);

  const g2 = new Game({
    width: 9, height: 1,
    units: [{ x: 0, y: 0, type: G }, { x: 3, y: 0, speed: 4 }],
  });
  g2.queueOrder(1, attack('right'));
  g2.queueOrder(2, move(0, 0));
  // t=1/4: projectile 0->1, runner 3->2. t=1/2: projectile 1->2, runner 2->1:
  // they swap cells, i.e. pass through each other.
  assert.deepEqual(kills(g2.tick()), [[2, '1/2']]);
});

test('killed unit frees its cell for units behind it in the same tick', () => {
  const g = new Game({
    width: 8, height: 3,
    units: [{ x: 3, y: 0, type: G }, { x: 3, y: 1 }, { x: 4, y: 1, speed: 4 }],
  });
  g.queueOrder(1, attack('down')); // kills unit 2 at t=1/4
  g.queueOrder(3, move(0, 1)); // blocked by unit 2 at t=1/4, then free
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, '1/4']]);
  assert.deepEqual([g.getUnit(3).x, g.getUnit(3).y], [1, 1]);
});

test('two gunslingers shooting each other both die', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 5, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, attack('left'));
  assert.deepEqual(kills(g.tick()), []); // shots pass each other mid-grid
  assert.deepEqual(kills(g.tick()), [[1, '1/4'], [2, '1/4']]); // 5 cells away
  assert.equal(g.units.length, 0);
});

test('projectiles pass through each other', () => {
  const g = new Game({ width: 9, height: 3, units: [{ x: 0, y: 1, type: G }, { x: 4, y: 0, type: G }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, attack('down'));
  g.tick();
  assert.equal(g.projectiles.length, 1); // the downward one left the 3-tall grid
  assert.equal(g.projectiles[0].x, 4);
});

test('combat replay is deterministic and survives snapshot round-trip', () => {
  const setup = () => new Game({
    width: 8, height: 8,
    units: [{ x: 0, y: 0, type: G }, { x: 7, y: 7, type: G }, { x: 3, y: 0 }, { x: 7, y: 3, speed: 3 }],
  });
  const run = (g) => {
    g.queueOrder(1, attack('right'));
    g.queueOrder(2, move(7, 0));
    g.queueOrder(4, move(0, 3));
    g.tick();
    const mid = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
    mid.queueOrder(2, attack('left'));
    for (let i = 0; i < 4; i++) mid.tick();
    return mid.hash();
  };
  assert.equal(run(setup()), run(setup()));
});
