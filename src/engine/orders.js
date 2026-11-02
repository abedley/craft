// Order constructors and validation.
//
// Orders are plain, serializable objects so that game state (including
// queued orders) can be snapshotted, hashed and replayed deterministically.

export const OrderType = Object.freeze({
  MOVE: 'move',
  ATTACK: 'attack',
});

import { ALL_DIRECTIONS } from './hex.js';

// Directions are hex directions; see hex.js.
export { Directions, ALL_DIRECTIONS } from './hex.js';

/** Create a move order: walk toward (x, y) at the unit's speed. */
export function move(x, y) {
  return { type: OrderType.MOVE, x, y };
}

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
  if (unitType && !unitType.orders.includes(order.type)) {
    return `${unitType.name} units cannot ${order.type}`;
  }
  switch (order.type) {
    case OrderType.MOVE: {
      const { x, y } = order;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return 'coordinates must be integers';
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'target out of bounds';
      return null;
    }
    case OrderType.ATTACK: {
      const allowed = unitType ? unitType.attack.directions : ALL_DIRECTIONS;
      if (!allowed.includes(order.dir)) return `direction must be one of ${allowed.join(', ')}`;
      return null;
    }
    default:
      return `unknown order type "${order.type}"`;
  }
}
