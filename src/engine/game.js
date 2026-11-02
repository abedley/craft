// Core game state and the tick loop.
//
// Determinism rules for the engine:
//   * No Math.random, Date, or other ambient input inside the engine.
//   * Units are always processed in ascending id order.
//   * Orders are applied in the order they were queued.
//   * State is plain JSON so it can be snapshotted, hashed and replayed.

import { validateOrder, OrderType } from './orders.js';
import { resolveMoves } from './resolve.js';

/** Fastest allowed unit speed, in cells per tick. */
export const MAX_SPEED = 6;

export class Game {
  /**
   * @param {{width:number,height:number,units?:Array<{x:number,y:number,id?:number,speed?:number}>}} opts
   */
  constructor({ width, height, units = [] }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Grid width and height must be positive integers');
    }
    this.state = {
      width,
      height,
      tick: 0,
      nextUnitId: 1,
      nextOrderSeq: 1, // stamps applied orders so "first ordered" is well defined
      units: [], // kept sorted by id
      queue: [], // [{ unitId, order }]
    };
    for (const u of units) this.addUnit(u.x, u.y, u.id, { speed: u.speed });
  }

  // ---- snapshots ---------------------------------------------------------

  static fromSnapshot(snapshot) {
    const game = new Game({ width: snapshot.width, height: snapshot.height });
    game.state = structuredClone(snapshot);
    // Snapshots from before order sequencing existed.
    game.state.nextOrderSeq ??= 1;
    for (const u of game.state.units) {
      u.orderSeq ??= null;
      u.speed ??= 1;
    }
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
  get queue() { return this.state.queue; }

  getUnit(id) {
    return this.state.units.find((u) => u.id === id) ?? null;
  }

  unitAt(x, y) {
    return this.state.units.find((u) => u.x === x && u.y === y) ?? null;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.state.width && y < this.state.height;
  }

  // ---- mutation (between ticks) -------------------------------------------

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [id] defaults to the next free id
   * @param {{speed?:number}} [opts] speed: cells moved per tick (1..MAX_SPEED)
   */
  addUnit(x, y, id, { speed = 1 } = {}) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    validateSpeed(speed);
    if (this.unitAt(x, y)) throw new Error(`Cell ${x},${y} is occupied`);
    const unitId = id ?? this.state.nextUnitId;
    if (this.getUnit(unitId)) throw new Error(`Unit id ${unitId} already exists`);
    this.state.nextUnitId = Math.max(this.state.nextUnitId, unitId + 1);
    // orderSeq: when the current order was applied (lower = given earlier).
    const unit = { id: unitId, x, y, speed, order: null, orderSeq: null };
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
   * Queue an order for a unit. It takes effect on the next tick(). If the
   * same unit is given several orders before a tick, the last one wins.
   * Throws if the order is invalid so the UI can report it immediately.
   */
  queueOrder(unitId, order) {
    if (!this.getUnit(unitId)) throw new Error(`No unit with id ${unitId}`);
    const err = validateOrder(order, this.state);
    if (err) throw new Error(`Invalid order: ${err}`);
    this.state.queue.push({ unitId, order: structuredClone(order) });
  }

  clearQueue() {
    this.state.queue = [];
  }

  // ---- simulation --------------------------------------------------------

  /**
   * Advance the simulation by one tick:
   *   1. apply queued orders to units (in queue order),
   *   2. move units. A unit with speed s takes one step at each of the times
   *      1/s, 2/s, ..., s/s within the tick. Every distinct time is a
   *      "sub-step": all units stepping at that instant pick their next cell
   *      toward their target and are resolved together with the same
   *      single-step collision rules (see resolve.js). Units not stepping at
   *      that instant stand still and so hold their cells. This keeps "whoever
   *      got to a cell first keeps it" true in real time: a faster unit
   *      genuinely arrives earlier, and no unit can jump over another.
   *      A unit blocked at one of its sub-steps retries at its next one.
   *   3. units that reached their target drop the order.
   * Returns a list of events describing what happened. Each unit produces at
   * most one "moved" event (with the full path taken) and at most one
   * "blocked" event (the first time it was blocked this tick).
   */
  tick() {
    const s = this.state;
    const events = [];

    // 1. Apply queued orders.
    for (const { unitId, order } of s.queue) {
      const unit = this.getUnit(unitId);
      if (!unit) {
        events.push({ type: 'orderDropped', unitId, reason: 'unit missing' });
        continue;
      }
      unit.order = order;
      unit.orderSeq = s.nextOrderSeq++;
      events.push({ type: 'orderApplied', unitId, order });
    }
    s.queue = [];

    // 2. Sub-steps. With L = lcm of all speeds, sub-step j (1..L) happens at
    //    time j/L; a unit of speed v steps when j is a multiple of L/v.
    //    Integer arithmetic only, so it is exact and deterministic.
    const L = s.units.reduce((acc, u) => lcm(acc, u.speed), 1);
    const paths = new Map(s.units.map((u) => [u.id, [[u.x, u.y]]]));
    const firstBlock = new Map();
    for (let j = 1; j <= L; j++) {
      const intents = s.units.map((u) => {
        const steps = j % (L / u.speed) === 0;
        const next = steps ? nextStep(u) : { x: u.x, y: u.y };
        return { id: u.id, x: u.x, y: u.y, tx: next.x, ty: next.y, priority: u.orderSeq };
      });
      if (intents.every((it) => it.tx === it.x && it.ty === it.y)) continue;
      const outcome = resolveMoves(intents);
      for (const u of s.units) {
        const r = outcome.get(u.id);
        if (r.moved) {
          u.x = r.x;
          u.y = r.y;
          paths.get(u.id).push([u.x, u.y]);
        } else if (r.blocked && !firstBlock.has(u.id)) {
          firstBlock.set(u.id, { at: [u.x, u.y], ...r.blocked, time: fraction(j, L) });
        }
      }
    }

    // 3. Report and clear finished orders.
    for (const u of s.units) {
      const path = paths.get(u.id);
      if (path.length > 1) {
        events.push({ type: 'moved', unitId: u.id, from: path[0], to: path[path.length - 1], path });
      }
      const b = firstBlock.get(u.id);
      if (b) {
        events.push({ type: 'blocked', unitId: u.id, at: b.at, reason: b.reason, by: b.by, time: b.time });
      }
      if (u.order?.type === OrderType.MOVE && u.x === u.order.x && u.y === u.order.y) {
        events.push({ type: 'arrived', unitId: u.id, at: [u.x, u.y] });
        u.order = null;
        u.orderSeq = null;
      }
    }

    s.tick += 1;
    return events;
  }

  /** Stable hash of the full state; equal states always hash equal. */
  hash() {
    return hashState(this.state);
  }
}

function validateSpeed(speed) {
  if (!Number.isInteger(speed) || speed < 1 || speed > MAX_SPEED) {
    throw new Error(`Speed must be an integer from 1 to ${MAX_SPEED}`);
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** j/L as a reduced fraction string, e.g. "1/2", or "1" for a whole tick. */
function fraction(j, L) {
  const g = gcd(j, L);
  return L / g === 1 ? String(j / g) : `${j / g}/${L / g}`;
}

function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

/**
 * The cell a unit wants to enter on its next step. Moves one cell orthogonally,
 * closing the larger axis gap first (x on ties). No pathfinding yet: a
 * blocked unit simply tries again on its next step.
 */
export function nextStep(unit) {
  const o = unit.order;
  if (!o || o.type !== OrderType.MOVE) return { x: unit.x, y: unit.y };
  const dx = o.x - unit.x;
  const dy = o.y - unit.y;
  if (dx === 0 && dy === 0) return { x: unit.x, y: unit.y };
  if (Math.abs(dx) >= Math.abs(dy)) return { x: unit.x + Math.sign(dx), y: unit.y };
  return { x: unit.x, y: unit.y + Math.sign(dy) };
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
