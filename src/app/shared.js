// Helpers shared by the game UI (src/app) and the debug UI (src/ui).

import { step, distance } from '../engine/hex.js';
import { nextStep, distancesTo } from '../engine/game.js';

// Tie-break when a tap is exactly between two allowed directions.
const TAP_PRIORITY = ['up', 'down', 'up-right', 'down-right', 'down-left', 'up-left'];

/**
 * The allowed hex direction closest in angle to the on-screen line from a
 * unit to a tapped hex. `center(x, y)` gives a hex's screen position; each
 * direction's screen angle is measured from the unit to its neighbour in
 * that direction, so this works for any projection (flat or isometric).
 */
export function nearestDirection(center, u, x, y, allowed) {
  const [ax, ay] = center(u.x, u.y);
  const [bx, by] = center(x, y);
  const target = Math.atan2(by - ay, bx - ax);
  let best = null;
  for (const dir of TAP_PRIORITY.filter((d) => allowed.includes(d))) {
    const [nx, ny] = step(u.x, u.y, dir);
    const [cx, cy] = center(nx, ny);
    let diff = Math.abs(target - Math.atan2(cy - ay, cx - ax));
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (!best || diff < best.diff - 1e-9) best = { dir, diff };
  }
  return best.dir;
}

/**
 * What the next turn will do if it ran now: runs it on a throwaway copy.
 * Returns the raw events plus quick lookups.
 */
export function previewOf(game) {
  const events = game.clone().tick();
  const moved = new Map();
  const blocked = new Map();
  const projectiles = [];
  const killed = new Set();
  const attackBlocked = new Set();
  const struck = [];
  for (const e of events) {
    if (e.type === 'moved') moved.set(e.unitId, e.path);
    if (e.type === 'blocked') blocked.set(e.unitId, e.reason);
    if (e.type === 'projectileMoved') projectiles.push(e.path);
    if (e.type === 'killed') killed.add(e.unitId);
    if (e.type === 'attackBlocked') attackBlocked.add(e.unitId);
    if (e.type === 'strike') struck.push(...e.cells);
  }
  return { events, moved, blocked, projectiles, killed, attackBlocked, struck };
}

/** Short text for an order. */
export function fmtOrder(o) {
  if (o.type === 'move') return `${o.quick ? 'QUICK ' : ''}move(${o.x}, ${o.y})`;
  if (o.type === 'charge') return `CHARGE ${o.dir}`;
  if (o.type === 'teleport') return `TELEPORT to ${o.x},${o.y}`;
  if (o.type === 'build') return 'BUILD';
  if (o.type === 'attack') return `attack(${o.dir})`;
  return o.type;
}

/**
 * The hexes a move order will walk through from where the unit stands now,
 * ignoring other units (they may block it when it runs): [[x, y], ...]
 * starting with the unit's own hex.
 */
export function movePath(game, unit, tx, ty, steps = unit.speed) {
  const order = { type: 'move', x: tx, y: ty };
  const path = [[unit.x, unit.y]];
  let cur = { x: unit.x, y: unit.y, team: unit.team, order };
  for (let k = 0; k < steps; k++) {
    const next = nextStep(cur, game.state ?? game);
    if (next.x === cur.x && next.y === cur.y) break;
    cur = { ...cur, x: next.x, y: next.y };
    path.push([cur.x, cur.y]);
  }
  return path;
}

/**
 * Hexes a shot from (x, y) flies through in `dir`, up to `max` of them,
 * stopping at the board edge or at the first building (included).
 */
export function rayCells(game, x, y, dir, max = Infinity) {
  const cells = [];
  let [cx, cy] = [x, y];
  while (cells.length < max) {
    [cx, cy] = step(cx, cy, dir);
    if (!game.inBounds(cx, cy)) break;
    cells.push([cx, cy]);
    if (game.buildingAt(cx, cy)) break;
  }
  return cells;
}

/** Hexes a unit can move to (Move / Quick) this turn, as [[x, y], ...]. */
export function moveReach(game, u) {
  const cells = [];
  for (const [k, d] of distancesTo(game, u.x, u.y, u.team)) {
    if (d > 0 && d <= u.speed) cells.push(k.split(',').map(Number));
  }
  return cells;
}

/** Hexes a unit can teleport to (empty, walkable, within range). */
export function teleportReach(game, u, range) {
  const cells = [];
  for (let x = 0; x < game.width; x++) {
    for (let y = 0; y < game.height; y++) {
      const d = distance(u.x, u.y, x, y);
      if (d > 0 && d <= range && game.isWalkable(x, y, u.team) && !game.unitAt(x, y)) cells.push([x, y]);
    }
  }
  return cells;
}
