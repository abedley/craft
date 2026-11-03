// Core game state and the turn loop.
//
// THE QUEUE DECIDES EVERYTHING. A turn (tick) runs the order queue from front
// to back; each entry is carried out completely, against the board exactly as
// the entries before it left it, before the next one starts. There are no
// hidden phases or simultaneous resolution: whatever is earlier in the queue
// happens first.
//
// Queue entries:
//   { unitId, order }      a unit's order (move or attack)
//   { projectileId }       a projectile still in flight from an earlier turn
// An entry may also carry `carried: true` (left over from last turn).
//
// Where entries go (see queueOrder and match.js):
//   1. quick moves                      (very front)
//   2. carried over from last turn      (in the order they ran last turn)
//   3. the CPU's new orders             (it stages its plan first)
//   4. the player's new orders
//
// What each entry does when its turn comes:
//   move        The unit walks up to `speed` hexes along its route. It stops
//               early if the next hex is occupied (whoever is there got there
//               first). Walking into a hex with a projectile in it is a hit.
//               If it hasn't arrived, the order carries over to next turn.
//   attack      projectile kind: a projectile is fired from the unit's hex
//               and immediately flies up to its `speed` hexes, killing the
//               first unit it meets. Still flying? It carries over.
//               melee kind: every unit in the `reach` hexes in a row next to
//               the attacker is killed, right now (friendly fire included).
//   projectile  (carried over) flies another `speed` hexes the same way.
//
// Determinism: no randomness, clock or DOM; state is plain JSON.

import { validateOrder, OrderType } from './orders.js';
import { step, hexLineStep, neighbors } from './hex.js';
import * as Units from './unitTypes.js';
import { getUnitType, AttackKind, MAX_SPEED } from './unitTypes.js';
import * as Terrain from './terrain.js';
import { getTerrainType, terrainForChar } from './terrain.js';

export { MAX_SPEED };

/** Sides. Friendly fire is on: attacks hit any unit regardless of team. */
export const Teams = Object.freeze({ PLAYER: 'player', CPU: 'cpu' });

export class Game {
  /**
   * @param {{width:number,height:number,
   *          terrain?:string[],
   *          units?:Array<{x:number,y:number,id?:number,type?:string,team?:string,speed?:number}>}} opts
   *   terrain: one string per row, one character per hex, using each terrain
   *   type's "char" (see terrain.js), e.g. "..==~~..". Omit for all-default.
   */
  constructor({ width, height, units = [], terrain = null }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Grid width and height must be positive integers');
    }
    this.state = {
      grid: 'hex', // flat-topped hexes, odd-q offset coordinates (see hex.js)
      queueVersion: 2, // sequential queue model
      width,
      height,
      tick: 0,
      nextUnitId: 1,
      nextProjectileId: 1,
      units: [], // kept sorted by id
      projectiles: [], // kept sorted by id
      queue: [], // see the top of this file
      // Terrain type key per hex, row-major: terrain[y * width + x].
      terrain: parseTerrain(terrain, width, height),
    };
    for (const u of units) this.addUnit(u.x, u.y, u.id, { type: u.type, team: u.team, speed: u.speed });
  }

  // ---- snapshots ---------------------------------------------------------

  static fromSnapshot(snapshot) {
    const game = new Game({ width: snapshot.width, height: snapshot.height });
    if (snapshot.grid !== 'hex') {
      throw new Error('This save is from the square-grid version of the game and can\'t be loaded on the hex grid');
    }
    if (snapshot.queueVersion !== 2) {
      throw new Error('This save is from an older version of the turn rules and can\'t be loaded');
    }
    game.state = structuredClone(snapshot);
    return game;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  clone() {
    return Game.fromSnapshot(this.state);
  }

  // ---- queries -----------------------------------------------------------

  get width() { return this.state.width; }
  get height() { return this.state.height; }
  get tickCount() { return this.state.tick; }
  get units() { return this.state.units; }
  get projectiles() { return this.state.projectiles; }
  get queue() { return this.state.queue; }
  get terrain() { return this.state.terrain; }

  getUnit(id) {
    return this.state.units.find((u) => u.id === id) ?? null;
  }

  getProjectile(id) {
    return this.state.projectiles.find((p) => p.id === id) ?? null;
  }

  unitAt(x, y) {
    return this.state.units.find((u) => u.x === x && u.y === y) ?? null;
  }

  projectileAt(x, y) {
    return this.state.projectiles.find((p) => p.x === x && p.y === y) ?? null;
  }

  /** The unit's queue entry, if it has one. */
  entryFor(unitId) {
    return this.state.queue.find((e) => e.unitId === unitId) ?? null;
  }

  /** The unit's queued order (new or carried over), or null. */
  orderFor(unitId) {
    return this.entryFor(unitId)?.order ?? null;
  }

  /** Terrain type key of a hex. */
  terrainAt(x, y) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    return this.state.terrain[y * this.state.width + x];
  }

  /** Can a unit stand on this hex (on the board and walkable terrain)? */
  isWalkable(x, y) {
    return isWalkable(this.state, x, y);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.state.width && y < this.state.height;
  }

  // ---- editing (between turns) ---------------------------------------------

  /** Change one hex's terrain. Can't make an occupied hex unwalkable. */
  setTerrain(x, y, type) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    const def = getTerrainType(type);
    const unit = this.unitAt(x, y);
    if (unit && !def.walkable) throw new Error(`Unit ${unit.id} is standing on ${x},${y}`);
    this.state.terrain[y * this.state.width + x] = type;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [id] defaults to the next free id
   * @param {{type?:string, team?:string, speed?:number}} [opts]
   *   type: key of UnitTypes (default: the units file's "default").
   *   team: Teams.PLAYER (default) or Teams.CPU.
   *   Player units start with one quick move (see queueOrder); CPU units have none.
   *   speed: hexes per move; defaults to the type's speed. Overriding it is
   *   meant for debugging/tests.
   */
  addUnit(x, y, id, { type = Units.DEFAULT_UNIT_TYPE, team = Teams.PLAYER, speed } = {}) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    const def = getUnitType(type);
    speed ??= def.speed;
    validateSpeed(speed);
    if (!Object.values(Teams).includes(team)) throw new Error(`Unknown team "${team}"`);
    if (this.unitAt(x, y)) throw new Error(`Cell ${x},${y} is occupied`);
    if (!this.isWalkable(x, y)) throw new Error(`Units can't stand on ${getTerrainType(this.terrainAt(x, y)).name}`);
    const unitId = id ?? this.state.nextUnitId;
    if (this.getUnit(unitId)) throw new Error(`Unit id ${unitId} already exists`);
    this.state.nextUnitId = Math.max(this.state.nextUnitId, unitId + 1);
    const unit = { id: unitId, team, type, x, y, speed, quickMoves: team === Teams.PLAYER ? 1 : 0 };
    this.state.units.push(unit);
    this.state.units.sort((a, b) => a.id - b.id);
    return unit;
  }

  setSpeed(id, speed) {
    const unit = this.getUnit(id);
    if (!unit) throw new Error(`No unit with id ${id}`);
    validateSpeed(speed);
    unit.speed = speed;
  }

  removeUnit(id) {
    this.state.units = this.state.units.filter((u) => u.id !== id);
    this.state.queue = this.state.queue.filter((q) => q.unitId !== id);
  }

  /**
   * Queue an order for a unit. A unit has at most one queue entry: a new
   * order replaces its old one (including one carried over from last turn).
   *
   * Placement: a quick move goes to the very front (after any other quick
   * moves); any other order goes to the back. (match.js puts the CPU's plan
   * ahead of the player's new orders.) A quick move is only used up when it
   * runs, so replacing or clearing it first costs nothing.
   *
   * Throws if the order is invalid (wrong for the unit's type, a move onto
   * unwalkable terrain, or a quick move the unit doesn't have).
   */
  queueOrder(unitId, order) {
    const unit = this.getUnit(unitId);
    if (!unit) throw new Error(`No unit with id ${unitId}`);
    const err = validateOrder(order, this.state, getUnitType(unit.type));
    if (err) throw new Error(`Invalid order: ${err}`);
    if (order.type === OrderType.MOVE && !this.isWalkable(order.x, order.y)) {
      throw new Error(`Invalid order: units can't walk on ${getTerrainType(this.terrainAt(order.x, order.y)).name}`);
    }
    if (order.quick && !(unit.quickMoves > 0)) throw new Error(`Unit ${unitId} has no quick move left`);
    const q = this.state.queue.filter((e) => e.unitId !== unitId);
    const entry = { unitId, order: structuredClone(order) };
    if (order.quick) {
      const firstNonQuick = q.findIndex((e) => !e.order?.quick);
      q.splice(firstNonQuick === -1 ? q.length : firstNonQuick, 0, entry);
    } else {
      q.push(entry);
    }
    this.state.queue = q;
  }

  /**
   * Remove unit orders from the queue; with a team, only that team's.
   * Projectiles in flight are never removed. With `newOnly`, orders carried
   * over from last turn are kept.
   */
  clearQueue(team = null, { newOnly = false } = {}) {
    this.state.queue = this.state.queue.filter((e) => {
      if (e.projectileId !== undefined) return true;
      if (newOnly && e.carried) return true;
      return team !== null && this.getUnit(e.unitId)?.team !== team;
    });
  }

  // ---- the turn ------------------------------------------------------------

  /**
   * Run the queue front to back (see the top of this file). Every event has
   * `step`: the 1-based position in the queue of the entry that caused it.
   * The entries still active afterwards (unfinished moves, projectiles in
   * flight) become next turn's queue, marked `carried`, in the order they
   * ran. Returns the events.
   */
  tick() {
    const s = this.state;
    const events = [];
    const carried = [];

    s.queue.forEach((entry, i) => {
      const stepNo = i + 1;
      if (entry.projectileId !== undefined) {
        const p = this.getProjectile(entry.projectileId);
        if (p && this.fly(p, events, stepNo)) carried.push({ projectileId: p.id, carried: true });
        return;
      }

      const unit = this.getUnit(entry.unitId);
      if (!unit) {
        events.push({ type: 'orderDropped', step: stepNo, unitId: entry.unitId, reason: 'unit gone' });
        return;
      }
      const { order } = entry;
      events.push({ type: 'orderStarted', step: stepNo, unitId: unit.id, order, carried: !!entry.carried });

      if (order.type === OrderType.MOVE) {
        if (order.quick) {
          unit.quickMoves -= 1;
          events.push({ type: 'quickMove', step: stepNo, unitId: unit.id, remaining: unit.quickMoves });
        }
        if (this.walk(unit, order, events, stepNo)) {
          const { quick, ...rest } = order; // a carried quick move is an ordinary move now
          carried.push({ unitId: unit.id, order: rest, carried: true });
        }
        return;
      }

      // Attack.
      const atk = getUnitType(unit.type).attack;
      if (atk.kind === AttackKind.PROJECTILE) {
        const p = {
          id: s.nextProjectileId++, ownerId: unit.id, x: unit.x, y: unit.y,
          dir: order.dir, speed: atk.speed, range: atk.range, traveled: 0,
        };
        s.projectiles.push(p);
        events.push({ type: 'shot', step: stepNo, unitId: unit.id, projectileId: p.id, dir: p.dir, from: [p.x, p.y] });
        if (this.fly(p, events, stepNo)) carried.push({ projectileId: p.id, carried: true });
      } else if (atk.kind === AttackKind.MELEE) {
        const cells = strikeCells(unit, order.dir, atk.reach).filter(([x, y]) => this.inBounds(x, y));
        events.push({ type: 'strike', step: stepNo, unitId: unit.id, dir: order.dir, cells });
        for (const [x, y] of cells) {
          const victim = this.unitAt(x, y);
          if (victim) this.kill(victim, { cause: 'melee', sourceId: unit.id, attackerId: unit.id }, events, stepNo);
        }
      }
    });

    s.queue = carried;
    s.tick += 1;
    return events;
  }

  /**
   * Walk a unit up to its speed toward the order's target. Returns true if
   * the order should carry over (not arrived, unit alive).
   */
  walk(unit, order, events, stepNo) {
    const path = [[unit.x, unit.y]];
    let alive = true;
    for (let k = 0; k < unit.speed; k++) {
      if (unit.x === order.x && unit.y === order.y) break;
      const next = nextStep({ x: unit.x, y: unit.y, order }, this.state);
      if (next.x === unit.x && next.y === unit.y) {
        events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'no route', by: null });
        break;
      }
      const occupant = this.unitAt(next.x, next.y);
      if (occupant) {
        events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'occupied', by: occupant.id });
        break;
      }
      unit.x = next.x;
      unit.y = next.y;
      path.push([unit.x, unit.y]);
      const p = this.projectileAt(unit.x, unit.y);
      if (p) {
        // Walked into a projectile in flight.
        this.removeProjectile(p);
        this.kill(unit, { cause: 'projectile', sourceId: p.id, attackerId: p.ownerId }, events, stepNo);
        alive = false;
        break;
      }
    }
    if (path.length > 1) {
      events.push({ type: 'moved', step: stepNo, unitId: unit.id, from: path[0], to: path[path.length - 1], path });
    }
    if (!alive) return false;
    if (unit.x === order.x && unit.y === order.y) {
      events.push({ type: 'arrived', step: stepNo, unitId: unit.id, at: [unit.x, unit.y] });
      return false;
    }
    return true;
  }

  /**
   * Fly a projectile up to its speed. It hits the first unit it meets, and
   * is gone if it leaves the board or passes its range. Returns true if it
   * is still flying afterwards.
   */
  fly(p, events, stepNo) {
    const path = [[p.x, p.y]];
    let flying = true;
    for (let k = 0; k < p.speed; k++) {
      [p.x, p.y] = step(p.x, p.y, p.dir);
      p.traveled += 1;
      if (!this.inBounds(p.x, p.y) || (p.range !== null && p.traveled > p.range)) {
        events.push({ type: 'projectileExpired', step: stepNo, projectileId: p.id });
        this.removeProjectile(p);
        flying = false;
        break;
      }
      path.push([p.x, p.y]);
      const victim = this.unitAt(p.x, p.y);
      if (victim) {
        this.removeProjectile(p);
        this.kill(victim, { cause: 'projectile', sourceId: p.id, attackerId: p.ownerId }, events, stepNo);
        flying = false;
        break;
      }
    }
    if (path.length > 1) events.push({ type: 'projectileMoved', step: stepNo, projectileId: p.id, path });
    return flying;
  }

  removeProjectile(p) {
    this.state.projectiles = this.state.projectiles.filter((q) => q.id !== p.id);
  }

  kill(unit, hit, events, stepNo) {
    events.push({
      type: 'killed', step: stepNo, unitId: unit.id, team: unit.team, at: [unit.x, unit.y], hits: [hit],
      // Shortcuts for projectile kills.
      by: hit.cause === 'projectile' ? [hit.sourceId] : [],
      shooterId: hit.cause === 'projectile' ? hit.attackerId : null,
    });
    this.state.units = this.state.units.filter((u) => u.id !== unit.id);
  }

  /** Stable hash of the full state; equal states always hash equal. */
  hash() {
    return hashState(this.state);
  }
}

/** The `reach` cells in a row next to a unit in a direction. */
export function strikeCells(unit, dir, reach) {
  const cells = [];
  let [x, y] = [unit.x, unit.y];
  for (let k = 1; k <= reach; k++) {
    [x, y] = step(x, y, dir);
    cells.push([x, y]);
  }
  return cells;
}

function validateSpeed(speed) {
  if (!Number.isInteger(speed) || speed < 1 || speed > MAX_SPEED) {
    throw new Error(`Speed must be an integer from 1 to ${MAX_SPEED}`);
  }
}

/**
 * The hex a unit wants to enter on its next step toward its move target.
 *
 * Units path around terrain they can't walk on (and the board's edges): the
 * step is always along a shortest walkable route. Among equally short
 * routes the straight hex line is preferred, then the direction order in
 * hex.js, so in open ground units walk straight lines. Other units are not
 * avoided: a blocked unit tries again on its next step. If the target can't
 * be reached at all, the unit stays put.
 *
 * @param {{x:number,y:number,order:object|null}} unit
 * @param {{width:number,height:number,terrain?:string[]}} [board] a Game or
 *   its state; omit for an unbounded, all-walkable plane
 */
export function nextStep(unit, board = null) {
  const o = unit.order;
  const stay = { x: unit.x, y: unit.y };
  if (!o || o.type !== OrderType.MOVE) return stay;
  if (o.x === unit.x && o.y === unit.y) return stay;
  const [lx, ly] = hexLineStep(unit.x, unit.y, o.x, o.y);
  if (!board) return { x: lx, y: ly };

  const dist = distancesTo(board, o.x, o.y);
  const here = dist.get(`${unit.x},${unit.y}`);
  if (here === undefined) return stay; // unreachable
  if (dist.get(`${lx},${ly}`) === here - 1) return { x: lx, y: ly };
  for (const [, x, y] of neighbors(unit.x, unit.y)) {
    if (dist.get(`${x},${y}`) === here - 1) return { x, y };
  }
  return stay;
}

/** Is (x, y) on the board and walkable? Works on a Game or its state. */
export function isWalkable(board, x, y) {
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return false;
  const t = board.terrain?.[y * board.width + x];
  return t === undefined || getTerrainType(t).walkable;
}

/**
 * Walking distance (hex steps over walkable terrain) from every hex that can
 * reach (tx, ty), as a Map "x,y" -> steps. Breadth-first search from the
 * target; units are ignored. Empty if the target itself isn't walkable.
 */
export function distancesTo(board, tx, ty) {
  const dist = new Map();
  if (!isWalkable(board, tx, ty)) return dist;
  dist.set(`${tx},${ty}`, 0);
  const frontier = [[tx, ty]];
  for (let i = 0; i < frontier.length; i++) {
    const [cx, cy] = frontier[i];
    const d = dist.get(`${cx},${cy}`);
    for (const [, nx, ny] of neighbors(cx, cy)) {
      const k = `${nx},${ny}`;
      if (dist.has(k) || !isWalkable(board, nx, ny)) continue;
      dist.set(k, d + 1);
      frontier.push([nx, ny]);
    }
  }
  return dist;
}

/** Build the row-major terrain array from map rows (or all default). */
function parseTerrain(rows, width, height) {
  if (rows === null || rows === undefined) return Array(width * height).fill(Terrain.DEFAULT_TERRAIN);
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`Terrain must have ${height} rows`);
  const out = [];
  rows.forEach((row, y) => {
    const chars = [...row];
    if (chars.length !== width) throw new Error(`Terrain row ${y} must have ${width} characters`);
    for (const ch of chars) out.push(terrainForChar(ch));
  });
  return out;
}

/** Canonical JSON (sorted keys) so key insertion order can't change hashes. */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 32-bit FNV-1a over the canonical JSON, as 8 hex chars. */
export function hashState(state) {
  const str = canonicalJSON(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
