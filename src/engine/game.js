// Core game state and the tick loop.
//
// Determinism rules for the engine:
//   * No Math.random, Date, or other ambient input inside the engine.
//   * Units are always processed in ascending id order.
//   * Orders are applied in the order they were queued.
//   * State is plain JSON so it can be snapshotted, hashed and replayed.

import { validateOrder, OrderType } from './orders.js';
import { resolveMoves } from './resolve.js';

export class Game {
  /**
   * @param {{width:number,height:number,units?:Array<{x:number,y:number,id?:number}>}} opts
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
    for (const u of units) this.addUnit(u.x, u.y, u.id);
  }

  // ---- snapshots ---------------------------------------------------------

  static fromSnapshot(snapshot) {
    const game = new Game({ width: snapshot.width, height: snapshot.height });
    game.state = structuredClone(snapshot);
    // Snapshots from before order sequencing existed.
    game.state.nextOrderSeq ??= 1;
    for (const u of game.state.units) u.orderSeq ??= null;
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

  addUnit(x, y, id) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    if (this.unitAt(x, y)) throw new Error(`Cell ${x},${y} is occupied`);
    const unitId = id ?? this.state.nextUnitId;
    if (this.getUnit(unitId)) throw new Error(`Unit id ${unitId} already exists`);
    this.state.nextUnitId = Math.max(this.state.nextUnitId, unitId + 1);
    // orderSeq: when the current order was applied (lower = given earlier).
    const unit = { id: unitId, x, y, order: null, orderSeq: null };
    this.state.units.push(unit);
    this.state.units.sort((a, b) => a.id - b.id);
    return unit;
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
   * Advance the simulation by one step:
   *   1. apply queued orders to units (in queue order),
   *   2. every unit with a move order picks the next cell toward its target,
   *   3. resolve all moves simultaneously (see resolve.js): whoever got to a
   *      cell first keeps it and the colliding unit doesn't move,
   *   4. units that reached their target drop the order.
   * Returns a list of events describing what happened.
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

    // 2. Intents.
    const intents = s.units.map((u) => {
      const next = nextStep(u);
      return { id: u.id, x: u.x, y: u.y, tx: next.x, ty: next.y, priority: u.orderSeq };
    });

    // 3. Resolve.
    const outcome = resolveMoves(intents);

    // 4. Apply results.
    for (const u of s.units) {
      const r = outcome.get(u.id);
      if (r.moved) {
        events.push({ type: 'moved', unitId: u.id, from: [u.x, u.y], to: [r.x, r.y] });
        u.x = r.x;
        u.y = r.y;
      } else if (r.blocked) {
        events.push({ type: 'blocked', unitId: u.id, at: [u.x, u.y], reason: r.blocked.reason, by: r.blocked.by });
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

/**
 * The cell a unit wants to enter this tick. Moves one cell orthogonally,
 * closing the larger axis gap first (x on ties). No pathfinding yet: a
 * blocked unit simply tries again next tick.
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
