// Order constructors and validation.
//
// Orders are plain, serializable objects so that game state (including
// queued orders) can be snapshotted, hashed and replayed deterministically.

export const OrderType = Object.freeze({
  MOVE: 'move',
});

/** Create a move order: walk toward (x, y), one cell per tick. */
export function move(x, y) {
  return { type: OrderType.MOVE, x, y };
}

/**
 * Validate an order against a grid. Returns null when valid, otherwise a
 * short reason string.
 */
export function validateOrder(order, grid) {
  if (!order || typeof order !== 'object') return 'not an object';
  switch (order.type) {
    case OrderType.MOVE: {
      const { x, y } = order;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return 'coordinates must be integers';
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'target out of bounds';
      return null;
    }
    default:
      return `unknown order type "${order.type}"`;
  }
}
