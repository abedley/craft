// Projectile combat on the hex grid. Straight lines used here run along a
// column (up/down), where cells (x, y) and (x, y + 1) are neighbours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, move, attack } from '../src/engine/index.js';

const G = 'gunslinger';
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => [e.unitId, e.time]);
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];

test('unit types: gunslinger moves 1/tick and shoots in all 6 hex directions; pikemen are the default', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 2, y: 2, type: G }, { x: 4, y: 4 }] });
  assert.equal(g.getUnit(1).speed, 1);
  assert.equal(g.getUnit(2).type, 'pikeman');
  assert.throws(() => g.queueOrder(1, attack('north')), /direction/);
  assert.throws(() => g.queueOrder(1, attack('right')), /direction/); // no straight left/right on flat-top hexes
  for (const dir of ['up', 'up-right', 'down-right', 'down', 'down-left', 'up-left']) {
    assert.doesNotThrow(() => g.queueOrder(1, attack(dir)));
  }
  assert.throws(() => g.addUnit(2, 2, undefined, { type: 'wizard' }), /Unknown unit type/);
});

test('projectile travels 4 cells per tick in a straight line and leaves the grid', () => {
  const g = new Game({ width: 1, height: 10, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('down'));
  let events = g.tick();
  assert.ok(events.some((e) => e.type === 'shot' && e.projectileId === 1));
  assert.deepEqual([g.projectiles[0].x, g.projectiles[0].y], [0, 4]);
  const pm = events.find((e) => e.type === 'projectileMoved');
  assert.deepEqual(pm.path, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
  g.tick();
  assert.equal(g.projectiles[0].y, 8);
  events = g.tick(); // 9, then off the grid
  assert.equal(g.projectiles.length, 0);
  assert.ok(events.some((e) => e.type === 'projectileExpired'));
});

test('projectiles fly straight along diagonal hex lines too', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('down-right'));
  const pm = g.tick().find((e) => e.type === 'projectileMoved');
  // odd-q: down-right from an even column keeps the row, from an odd column adds one.
  assert.deepEqual(pm.path, [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2]]);
});

test('shooting cancels a move order and the shooter holds still', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, move(0, 5));
  g.tick();
  g.queueOrder(1, attack('up-right'));
  g.tick();
  const u = g.getUnit(1);
  assert.deepEqual([u.x, u.y, u.order], [0, 1, null]);
});

test('only the last queued order per unit is carried out', () => {
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0, type: G }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(1, move(0, 3));
  g.tick();
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.getUnit(1).y, 1);
});

test('hit kills and removes the target; projectile is used up; shooter is unharmed', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 6 }] });
  g.queueOrder(1, attack('down'));
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
  const g = new Game({ width: 1, height: 5, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 1 }] });
  g.queueOrder(2, move(0, 4));
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), [[2, '1/4']]);
});

test('projectile hits only the first unit in its line', () => {
  const g = new Game({ width: 1, height: 8, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 2 }, { x: 0, y: 3 }] });
  g.queueOrder(1, attack('down'));
  assert.deepEqual(kills(g.tick()), [[2, '1/2']]);
  assert.ok(g.getUnit(3));
});

test('a unit that steps out of the line in time survives', () => {
  // The unit at (1,5) steps up-left at t=1; the projectile reaches y=5 at
  // t=1/4 of the next tick and finds the cell empty.
  const g = new Game({ width: 3, height: 8, units: [{ x: 1, y: 0, type: G }, { x: 1, y: 5 }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(2, move(0, 5));
  g.tick();
  assert.deepEqual(kills(g.tick()), []);
  assert.ok(g.getUnit(2));
});

test('a unit stepping into the projectile\'s cell at the same instant is hit', () => {
  const g = new Game({ width: 3, height: 12, units: [{ x: 1, y: 0, type: G }, { x: 0, y: 8 }] });
  g.queueOrder(1, attack('down'));
  g.tick(); // projectile at (1,4)
  g.queueOrder(2, move(1, 8)); // (0,8) -> (1,8) at t=1; the projectile reaches (1,8) at t=1
  assert.deepEqual(kills(g.tick()), [[2, '1']]);
});

test('unit and projectile passing through each other is a hit', () => {
  // Speed-4 runner heading up meets the projectile head-on.
  const g = new Game({ width: 1, height: 9, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 4, speed: 4 }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(2, move(0, 0));
  // t=1/4: projectile 0->1, runner 4->3. t=1/2: projectile 1->2, runner 3->2: same cell.
  assert.deepEqual(kills(g.tick()), [[2, '1/2']]);

  const g2 = new Game({ width: 1, height: 9, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 3, speed: 4 }] });
  g2.queueOrder(1, attack('down'));
  g2.queueOrder(2, move(0, 0));
  // t=1/4: projectile 0->1, runner 3->2. t=1/2: projectile 1->2, runner 2->1:
  // they swap cells, i.e. pass through each other.
  assert.deepEqual(kills(g2.tick()), [[2, '1/2']]);
});

test('killed unit frees its cell: a follower moves into it the same tick', () => {
  // Column 0: gunslinger (0,0), victim (0,1), fast follower (0,2) heading up.
  // t=1/4: the follower tries to enter (0,1), which the victim still holds,
  // so it's blocked; the projectile then kills the victim. t=1/2: (0,1) is
  // free and the follower moves in.
  const g = new Game({ width: 1, height: 5, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 1 }, { x: 0, y: 2, speed: 4 }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(3, move(0, 1));
  const events = g.tick();
  assert.deepEqual(kills(events), [[2, '1/4']]);
  assert.deepEqual(pos(g, 3), [0, 1]);
});

test('two gunslingers shooting each other both die', () => {
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 5, type: G }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(2, attack('up'));
  assert.deepEqual(kills(g.tick()), []); // shots pass each other mid-grid
  assert.deepEqual(kills(g.tick()), [[1, '1/4'], [2, '1/4']]); // 5 cells away
  assert.equal(g.units.length, 0);
});

test('projectiles pass through each other', () => {
  const g = new Game({ width: 9, height: 4, units: [{ x: 2, y: 0, type: G }, { x: 0, y: 2, type: G }] });
  g.queueOrder(1, attack('down')); // through (2,1), (2,2), (2,3), then off the 4-tall board
  g.queueOrder(2, attack('up-right')); // through (1,1), (2,1)... crossing the other shot
  g.tick();
  assert.equal(g.units.length, 2);
});

test('combat replay is deterministic and survives snapshot round-trip', () => {
  const setup = () => new Game({
    width: 8, height: 8,
    units: [{ x: 0, y: 0, type: G }, { x: 7, y: 7, type: G }, { x: 3, y: 0 }, { x: 7, y: 3, speed: 3 }],
  });
  const run = (g) => {
    g.queueOrder(1, attack('down-right'));
    g.queueOrder(2, move(7, 0));
    g.queueOrder(4, move(0, 3));
    g.tick();
    const mid = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
    mid.queueOrder(2, attack('up'));
    for (let i = 0; i < 4; i++) mid.tick();
    return mid.hash();
  };
  assert.equal(run(setup()), run(setup()));
});
