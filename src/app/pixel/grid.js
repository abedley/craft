// Integer pixel geometry for the pixel-art board (no DOM; testable in node).
//
// Pointy-topped hexes (odd-r layout, see engine/hex.js) drawn on a 2:1
// isometric slope. Every hex's top face is the same pixel mask, W wide and
// H tall, and the masks tile exactly: a hex sits at
//   ax = x * W + (y odd ? W / 2 : 0),   ay = y * V - elevation
// in "art pixels" (the low-res buffer the board is drawn in, which is then
// scaled up by a whole number of device pixels).

import { getTerrainType } from '../../engine/terrain.js';

export const W = 20; // hex width (must be 4 * Q so the slopes are 2:1 and tile)
export const Q = 5; // rows in each sloped part (top and bottom)
export const S = 6; // rows in the straight middle
export const H = 2 * Q + S; // 16: hex height
export const V = Q + S; // 11: row step
export const BASE = 4; // prism depth below ground level

/** Elevation (px) of each terrain type's top face. */
export const ELEVATION = { water: 2, sand: 5, road: 5, grass: 6, forest: 6 };
export const BUILDING_HEIGHT = 11; // a building's roof above its hex

export function elevationOf(key) {
  if (key in ELEVATION) return ELEVATION[key];
  try {
    return getTerrainType(key).walkable ? 6 : 2;
  } catch {
    return 6;
  }
}

/** Half-width of the mask on row r (the row spans [W/2 - hw, W/2 + hw)). */
function halfWidth(r) {
  if (r < Q) return 2 * r + 1;
  if (r < Q + S) return W / 2;
  return 2 * (H - 1 - r) + 1;
}

/** The hex top-face mask: MASK[r] = [x0, x1) for each row r. */
export const MASK = Object.freeze(
  Array.from({ length: H }, (_, r) => Object.freeze([W / 2 - halfWidth(r), W / 2 + halfWidth(r)])),
);

export function inMask(dx, dy) {
  if (dy < 0 || dy >= H) return false;
  const [x0, x1] = MASK[dy];
  return dx >= x0 && dx < x1;
}

/** Lowest mask row in each column (where the side faces start). */
export const BOTTOM_ROW = Object.freeze(Array.from({ length: W }, (_, x) => {
  for (let r = H - 1; r >= 0; r--) if (inMask(x, r)) return r;
  return 0;
}));

/** Mask pixels on the hex outline, split by which edge they're on. */
export const OUTLINE = (() => {
  const top = []; // top slopes and the left side: drawn by every hex
  const right = []; // right side: only at the board's edge
  const bottom = []; // bottom slopes: only where no hex is below
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      if (!inMask(x, r)) continue;
      const up = !inMask(x, r - 1);
      const left = !inMask(x - 1, r) && r < Q + S;
      if (up || left) top.push([x, r]);
      else if (!inMask(x + 1, r) && r < Q + S) right.push([x, r]);
      else if (!inMask(x, r + 1) || (r >= Q + S && (!inMask(x - 1, r) || !inMask(x + 1, r)))) bottom.push([x, r]);
    }
  }
  return Object.freeze({ top, right, bottom });
})();

/** Pixels just outside the mask (for selection rings). */
export const RING = (() => {
  const out = [];
  for (let r = -1; r <= H; r++) {
    for (let x = -1; x <= W; x++) {
      if (inMask(x, r)) continue;
      if (inMask(x - 1, r) || inMask(x + 1, r) || inMask(x, r - 1) || inMask(x, r + 1)) out.push([x, r]);
    }
  }
  return Object.freeze(out);
})();

/** The outline of a mask shrunk by `n` pixels (for reach marks). */
export function insetOutline(n) {
  const inside = (x, r) => {
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (!inMask(x + dx, r + dy)) return false;
    return true;
  };
  const out = [];
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, r)) continue;
      if (!inside(x - 1, r) || !inside(x + 1, r) || !inside(x, r - 1) || !inside(x, r + 1)) out.push([x, r]);
    }
  }
  // Walk order (by angle round the centre) so dashes look even.
  const cx = W / 2 - 0.5;
  const cy = H / 2 - 0.5;
  return out.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

export class PixelView {
  /**
   * @param {{width:number,height:number,terrainAt:Function,buildingAt?:Function}} game
   * @param {{top?:number,side?:number,bottom?:number}} [margin] art px round the board
   */
  constructor(game, { top = 30, side = 6, bottom = 6 } = {}) {
    this.game = game;
    this.margin = { top, side, bottom };
  }

  /** Size of the art buffer that holds the whole board. */
  get size() {
    const { width: w, height: h } = this.game;
    const m = this.margin;
    return {
      w: w * W + (h > 1 ? W / 2 : 0) + m.side * 2,
      h: (h - 1) * V + H + BASE + 6 + m.top + m.bottom,
    };
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.game.width && y < this.game.height;
  }

  /** Elevation of a hex's ground (off the board: grass height). */
  groundHeight(x, y) {
    if (!this.inBounds(x, y)) return ELEVATION.grass;
    return elevationOf(this.game.terrainAt(x, y));
  }

  /** Height a unit stands at (on the roof if there's a building). */
  standHeight(x, y) {
    return this.groundHeight(x, y) + (this.inBounds(x, y) && this.game.buildingAt?.(x, y) ? BUILDING_HEIGHT : 0);
  }

  /** Top-left of a hex's mask at elevation h. */
  origin(x, y, h = this.groundHeight(x, y)) {
    return [
      this.margin.side + x * W + (y & 1 ? W / 2 : 0),
      this.margin.top + 8 + y * V - h,
    ];
  }

  /** Centre of a hex's top face at elevation h (default: its ground). */
  center(x, y, h = this.groundHeight(x, y)) {
    const [ox, oy] = this.origin(x, y, h);
    return [ox + W / 2, oy + Math.floor(H / 2)];
  }

  /** All hexes, back to front. */
  drawOrder() {
    const cells = [];
    for (let y = 0; y < this.game.height; y++) for (let x = 0; x < this.game.width; x++) cells.push([x, y]);
    return cells;
  }

  /** The hex whose top face (or roof) is under art pixel (ax, ay), or null. */
  pick(ax, ay) {
    const order = this.drawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const [x, y] = order[i];
      for (const h of new Set([this.standHeight(x, y), this.groundHeight(x, y)])) {
        const [ox, oy] = this.origin(x, y, h);
        if (inMask(Math.floor(ax) - ox, Math.floor(ay) - oy)) return { x, y };
      }
    }
    return null;
  }
}
