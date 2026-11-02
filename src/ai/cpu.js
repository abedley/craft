// CPU opponent.
//
// planTurn() looks at the board as it stands at the start of a turn, before
// the player has given any orders, and returns the orders for every unit on
// its team. It is deterministic: no randomness, units are considered in id
// order, and every tie is broken by a fixed rule, so the same board always
// produces the same plan (replays and undo stay exact).
//
// Behaviour comes from each unit's type definition (src/data/units.json), so
// new units defined in JSON get sensible play without code changes. Per unit,
// in priority order:
//   1. Dodge: if a projectile (anyone's: friendly fire is on) will reach this
//      unit within the next two ticks with nothing in between, and there's
//      still time to step out of its line, step sideways into a free cell.
//   2. Attack, by attack kind:
//      - projectile: fire if the first unit along an allowed direction, within
//        range, is an enemy (never when a teammate is first in line); nearest
//        enemy first.
//      - melee: strike in the allowed direction that catches the most enemies
//        within reach, as the board stands now, and never when a teammate
//        would be in the strike: either standing there or, for a teammate
//        already planned this turn, stepping in.
//   3. Move: projectile units walk toward the nearest free cell with a clear
//      shot (allowed direction, in range, nothing in between) at some enemy;
//      everyone else walks toward the nearest enemy.

import { move, attack, Directions, ORTHOGONAL } from '../engine/orders.js';
import { nextStep, strikeCells } from '../engine/game.js';
import { getUnitType, AttackKind } from '../engine/unitTypes.js';

// Fixed tie-break order for directions.
const DIR_PRIORITY = ['up', 'right', 'down', 'left', 'up-right', 'down-right', 'down-left', 'up-left'];
const OPPOSITE = {
  up: 'down', down: 'up', left: 'right', right: 'left',
  'up-left': 'down-right', 'down-right': 'up-left', 'up-right': 'down-left', 'down-left': 'up-right',
};
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inPriorityOrder = (dirs) => DIR_PRIORITY.filter((d) => dirs.includes(d));

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

  // Cells this team's units will occupy this turn (planned so far).
  const teamCells = new Set(mine.map((m) => `${m.x},${m.y}`));
  const planMove = (u, order) => {
    const next = nextStep({ ...u, order });
    teamCells.add(`${next.x},${next.y}`);
  };

  for (const u of mine) {
    const atk = getUnitType(u.type).attack;

    const dodge = dodgeCell(game, u);
    if (dodge) {
      plan.push([u.id, move(dodge[0], dodge[1])]);
      planMove(u, move(dodge[0], dodge[1]));
      continue;
    }

    const dir = atk && (atk.kind === AttackKind.MELEE
      ? bestStrike(game, u, atk, teamCells)
      : bestShot(game, u, atk));
    if (dir) {
      plan.push([u.id, attack(dir)]);
      continue;
    }

    const target = nearest(u, enemies);
    const dest = (atk?.kind === AttackKind.PROJECTILE && firingPosition(game, u, atk, enemies)) || [target.x, target.y];
    if (dest[0] !== u.x || dest[1] !== u.y) {
      plan.push([u.id, move(dest[0], dest[1])]);
      planMove(u, move(dest[0], dest[1]));
    }
  }
  return plan;
}

/** First unit along a straight line from (x, y), not counting (x, y). */
export function firstInLine(game, x, y, dir, maxDist = Infinity) {
  const [dx, dy] = Directions[dir];
  for (let cx = x + dx, cy = y + dy, d = 1; game.inBounds(cx, cy) && d <= maxDist; cx += dx, cy += dy, d++) {
    const hit = game.unitAt(cx, cy);
    if (hit) return { unit: hit, dist: d };
  }
  return null;
}

function bestShot(game, u, atk) {
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const hit = firstInLine(game, u.x, u.y, dir, atk.range ?? Infinity);
    if (!hit || hit.unit.team === u.team) continue;
    if (!best || hit.dist < best.dist) best = { dir, dist: hit.dist };
  }
  return best?.dir ?? null;
}

function bestStrike(game, u, atk, teamCells) {
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const cells = strikeCells(u, dir, atk.reach);
    if (cells.some(([x, y]) => teamCells.has(`${x},${y}`))) continue;
    const enemies = cells.filter(([x, y]) => {
      const occ = game.unitAt(x, y);
      return occ && occ.team !== u.team;
    }).length;
    if (enemies > 0 && (!best || enemies > best.enemies)) best = { dir, enemies };
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
 * Nearest free cell (to u) from which some enemy is the first unit along an
 * allowed firing direction, within range. Ties: nearer enemy, then lower y,
 * then lower x.
 */
function firingPosition(game, u, atk, enemies) {
  let best = null;
  for (const e of enemies) {
    for (const firing of inPriorityOrder(atk.directions)) {
      // A shooter firing `firing` at e stands on the opposite side of e.
      // Walk outward from e; each free cell passed has a clear line back to
      // it. Stop at the first unit (it would block the shot), except u
      // itself, which will have moved away.
      const [dx, dy] = Directions[OPPOSITE[firing]];
      for (let x = e.x + dx, y = e.y + dy, d = 1; game.inBounds(x, y) && d <= (atk.range ?? Infinity); x += dx, y += dy, d++) {
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
 * out of the way, return a free neighbouring cell off the projectile's line.
 */
function dodgeCell(game, u) {
  for (const p of game.projectiles) {
    const [dx, dy] = Directions[p.dir];
    // How many steps until p reaches u's cell (if it's on p's path at all)?
    const k = dx !== 0 ? (u.x - p.x) / dx : (u.y - p.y) / dy;
    if (!Number.isInteger(k) || k <= 0 || p.x + k * dx !== u.x || p.y + k * dy !== u.y) continue;
    if (p.range !== null && p.traveled + k > p.range) continue; // falls short
    // Something else in between will take the hit.
    const first = firstInLine(game, p.x, p.y, p.dir);
    if (!first || first.unit.id !== u.id) continue;
    const soon = k <= 2 * p.speed; // arrives within two ticks
    // The unit leaves its cell at t = 1/speed; the projectile arrives at
    // t = k/p.speed. Dodging only helps if the unit gets out first.
    const escapable = k * u.speed > p.speed;
    if (!soon || !escapable) continue;
    for (const side of ORTHOGONAL) {
      const [sx, sy] = Directions[side];
      const x = u.x + sx;
      const y = u.y + sy;
      const stillOnPath = sx * dy - sy * dx === 0; // moving along the line
      if (!stillOnPath && game.inBounds(x, y) && !game.unitAt(x, y)) return [x, y];
    }
  }
  return null;
}
