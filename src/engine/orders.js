// Order constructors and validation.
//
// Orders are plain, serializable objects so that game state (including
// queued orders) can be snapshotted, hashed and replayed deterministically.

export const OrderType = Object.freeze({
  MOVE: 'move',
  SHOOT: 'shoot',
});

/** Grid directions. y grows downward, so "up" is y - 1. */
export const Directions = Object.freeze({
  up: Object.freeze([0, -1]),
  down: Object.freeze([0, 1]),
  left: Object.freeze([-1, 0]),
  right: Object.freeze([1, 0]),
});

/** Create a move order: walk toward (x, y) at the unit's speed. */
export function move(x, y) {
  return { type: OrderType.MOVE, x, y };
}

/** Create a shoot order: fire one projectile in a direction ("up", ...). */
export function shoot(dir) {
  return { type: OrderType.SHOOT, dir };
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
    case OrderType.SHOOT:
      if (!Object.hasOwn(Directions, order.dir)) return `direction must be one of ${Object.keys(Directions).join(', ')}`;
      return null;
    default:
      return `unknown order type "${order.type}"`;
  }
}
