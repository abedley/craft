// Order constructors and validation.
//
// Orders are plain, serializable objects so that game state (including
// queued orders) can be snapshotted, hashed and replayed deterministically.

export const OrderType = Object.freeze({
  MOVE: 'move',
  ATTACK: 'attack',
  CHARGE: 'charge',
  TELEPORT: 'teleport',
});

import { ALL_DIRECTIONS } from './hex.js';

// Directions are hex directions; see hex.js.
export { Directions, ALL_DIRECTIONS } from './hex.js';

/** Create a move order: walk toward (x, y) at the unit's speed. */
export function move(x, y) {
  return { type: OrderType.MOVE, x, y };
}

/**
 * Create a quick move: a move order that jumps to the FRONT of the order
 * queue, so it counts as the earliest order given and wins same-instant
 * contests for a hex. Each unit has a limited number (see Game#addUnit).
 */
export function quickMove(x, y) {
  return { type: OrderType.MOVE, x, y, quick: true };
}

/**
 * Create a charge in a hex direction: the unit rushes up to its type's charge
 * distance (3 for pikemen) in a straight line, then attacks in that same
 * direction (see Game#tick). Like a quick move it goes to the FRONT of the
 * order queue. Only units whose type has a "charge" can use it, a limited
 * number of times.
 */
export function charge(dir) {
  return { type: OrderType.CHARGE, dir };
}

/**
 * Create a teleport: the unit jumps straight to (x, y), up to its type's
 * teleport distance away, ignoring anything in between. It joins the END of
 * the queue like a normal order. A stalker leaves a mine on the hex it left.
 */
export function teleport(x, y) {
  return { type: OrderType.TELEPORT, x, y };
}

/** Quick moves and charges go to the front of the queue. */
export const goesToFront = (order) => !!(order?.quick || order?.type === OrderType.CHARGE);

/**
 * Create an attack order in a hex direction ("up", "down-left", ...). What the
 * attack does (shoot, strike, ...) comes from the unit's type definition.
 */
export function attack(dir) {
  return { type: OrderType.ATTACK, dir };
}

/**
 * Validate an order against a grid and, if given, the unit type that will
 * carry it out. Returns null when valid, otherwise a short reason string.
 */
export function validateOrder(order, grid, unitType = null) {
  if (!order || typeof order !== 'object') return 'not an object';
  if (unitType && order.type !== OrderType.CHARGE && !unitType.orders.includes(order.type)) {
    return `${unitType.name} units cannot ${order.type}`;
  }
  if (order.quick !== undefined && order.type !== OrderType.MOVE) return 'only move orders can be quick';
  switch (order.type) {
    case OrderType.MOVE: {
      const { x, y } = order;
      if (order.quick !== undefined && order.quick !== true) return '"quick" must be true when present';
      if (!Number.isInteger(x) || !Number.isInteger(y)) return 'coordinates must be integers';
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'target out of bounds';
      return null;
    }
    case OrderType.TELEPORT: {
      const { x, y } = order;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return 'coordinates must be integers';
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'target out of bounds';
      return null;
    }
    case OrderType.CHARGE:
      if (unitType && !unitType.charge) return `${unitType.name} units can't charge`;
      if (!ALL_DIRECTIONS.includes(order.dir)) return `direction must be one of ${ALL_DIRECTIONS.join(', ')}`;
      if (unitType?.attack && !unitType.attack.directions.includes(order.dir)) {
        return `a ${unitType.name} charge must be in a direction it can attack: ${unitType.attack.directions.join(', ')}`;
      }
      return null;
    case OrderType.ATTACK: {
      const allowed = unitType ? unitType.attack.directions : ALL_DIRECTIONS;
      if (!allowed.includes(order.dir)) return `direction must be one of ${allowed.join(', ')}`;
      return null;
    }
    default:
      return `unknown order type "${order.type}"`;
  }
}
