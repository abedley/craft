// CPU opponent.
//
// planTurn() looks at the board as it stands at the start of a turn, before
// the player has given any orders, and returns the orders for every unit on
// its team. It is deterministic: no randomness, units are considered in id
// order, and every tie is broken by a fixed rule, so the same board always
// produces the same plan (replays and undo stay exact).
//
// Per unit, in priority order:
//   1. Dodge: if a projectile (anyone's: friendly fire is on) will reach this
//      unit within the next two ticks with nothing in between, and there's
//      still time to step out of its line, step sideways into a free cell.
//   2. Shoot: a shooter fires if the first unit along some direction is an
//      enemy (it never fires when a teammate is first in line). The nearest
//      such enemy is chosen.
//   3. Move: shooters walk toward the nearest free cell that has a clear
//      straight shot at some enemy (same row or column, nothing in between);
//      other units, or shooters with no such cell, walk toward the nearest
//      enemy.

import { move, shoot, Directions, OrderType } from '../engine/orders.js';
import { getUnitType } from '../engine/unitTypes.js';

const DIR_ORDER = ['up', 'right', 'down', 'left']; // fixed tie-break order
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * @param {import('../engine/game.js').Game} game
 * @param {string} team the team to plan for
 * @returns {Array<[number, object]>} [unitId, order] pairs, in unit id order
 */
export function planTurn(game, team) {
  const plan = [];
  const mine = game.units.filter((u) => u.team === team);
  const enemies = game.units.filter((u) => u.team !== team);
  if (enemies.length === 0) return plan;

  for (const u of mine) {
    const canShoot = getUnitType(u.type).orders.includes(OrderType.SHOOT);

    const dodge = dodgeCell(game, u);
    if (dodge) {
      plan.push([u.id, move(dodge[0], dodge[1])]);
      continue;
    }

    if (canShoot) {
      const dir = bestShot(game, u);
      if (dir) {
        plan.push([u.id, shoot(dir)]);
        continue;
      }
    }

    const target = nearest(u, enemies);
    const dest = (canShoot && firingPosition(game, u, enemies)) || [target.x, target.y];
    if (dest[0] !== u.x || dest[1] !== u.y) plan.push([u.id, move(dest[0], dest[1])]);
  }
  return plan;
}

/** First unit along a straight line from (x, y), not counting (x, y). */
export function firstInLine(game, x, y, dir) {
  const [dx, dy] = Directions[dir];
  for (let cx = x + dx, cy = y + dy, d = 1; game.inBounds(cx, cy); cx += dx, cy += dy, d++) {
    const hit = game.unitAt(cx, cy);
    if (hit) return { unit: hit, dist: d };
  }
  return null;
}

function bestShot(game, u) {
  let best = null;
  for (const dir of DIR_ORDER) {
    const hit = firstInLine(game, u.x, u.y, dir);
    if (!hit || hit.unit.team === u.team) continue;
    if (!best || hit.dist < best.dist) best = { dir, dist: hit.dist };
  }
  return best?.dir ?? null;
}

function nearest(u, others) {
  let best = null;
  for (const o of others) {
    const d = manhattan(u, o);
    if (!best || d < best.d) best = { o, d };
  }
  return best.o;
}

/**
 * Nearest free cell (to u) from which some enemy is the first unit in a
 * straight line. Ties: nearer enemy, then lower y, then lower x.
 */
function firingPosition(game, u, enemies) {
  let best = null;
  for (const e of enemies) {
    for (const dir of DIR_ORDER) {
      // Walk outward from the enemy; each free cell passed has a clear line
      // back to it. Stop at the first unit (it would block the shot), except
      // u itself, which will have moved away.
      const [dx, dy] = Directions[dir];
      for (let x = e.x + dx, y = e.y + dy; game.inBounds(x, y); x += dx, y += dy) {
        const occ = game.unitAt(x, y);
        if (occ && occ.id !== u.id) break;
        if (occ) continue; // u's own cell: if a shot existed bestShot would have fired
        const cand = { x, y, d: manhattan(u, { x, y }), de: manhattan(u, e) };
        if (!best || cand.d < best.d || (cand.d === best.d && (cand.de < best.de
          || (cand.de === best.de && (y < best.y || (y === best.y && x < best.x)))))) {
          best = cand;
        }
      }
    }
  }
  return best && [best.x, best.y];
}

/**
 * If an incoming projectile threatens this unit soon and it can still get
 * out of the way, return a free cell perpendicular to the projectile's line.
 */
function dodgeCell(game, u) {
  for (const p of game.projectiles) {
    const [dx, dy] = Directions[p.dir];
    // Is u ahead of p on its line?
    const along = dx !== 0 ? (u.x - p.x) * dx : (u.y - p.y) * dy;
    const onLine = dx !== 0 ? u.y === p.y : u.x === p.x;
    if (!onLine || along <= 0) continue;
    // Something else in between will take the hit.
    const first = firstInLine(game, p.x, p.y, p.dir);
    if (!first || first.unit.id !== u.id) continue;
    const d = along;
    const soon = d <= 2 * p.speed; // arrives within two ticks
    // The unit leaves its cell at t = 1/speed; the projectile arrives at
    // t = d/p.speed. Dodging only helps if the unit gets out first.
    const escapable = d * u.speed > p.speed;
    if (!soon || !escapable) continue;
    const sides = dx !== 0 ? ['up', 'down'] : ['left', 'right'];
    for (const side of sides) {
      const [sx, sy] = Directions[side];
      const x = u.x + sx;
      const y = u.y + sy;
      if (game.inBounds(x, y) && !game.unitAt(x, y)) return [x, y];
    }
  }
  return null;
}
