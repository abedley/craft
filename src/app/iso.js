// Isometric view of the hex board (no DOM; testable in node).
//
// The board's flat-topped hexes (odd-q layout, see engine/hex.js) are laid on
// a ground plane that is tilted away from the viewer: plane y is squashed by
// SQUASH, and height lifts things straight up the screen. Every hex is drawn
// as a prism whose top sits at its terrain's (visual-only) height.
//
// World units are hex radii: a hex centre is at plane (1.5 x, √3 (y + x%2/2)).
// screen = origin + [px, py * SQUASH - h * LIFT] * scale.

import { getTerrainType } from '../engine/terrain.js';

export const SQUASH = 0.58;
export const LIFT = 0.55; // screen height of one height unit, in hex radii
export const BASE = -0.55; // bottom of every prism
const SQRT3 = Math.sqrt(3);

/** Visual height of each terrain type's top face (unknown types get a default). */
export const TERRAIN_HEIGHT = { water: 0.12, sand: 0.42, road: 0.45, grass: 0.5, forest: 0.5 };
export const BUILDING_HEIGHT = 0.85; // a building's roof above its tile

export function terrainHeight(key) {
  if (key in TERRAIN_HEIGHT) return TERRAIN_HEIGHT[key];
  try {
    return getTerrainType(key).walkable ? 0.5 : 0.15;
  } catch {
    return 0.5;
  }
}

export class IsoView {
  /** @param {{width:number,height:number,terrainAt?:Function,buildingAt?:Function}} game */
  constructor(game) {
    this.game = game;
    this.scale = 30;
    this.origin = [0, 0];
    this.viewW = 0;
    this.viewH = 0;
  }

  /** Plane coordinates (hex radii) of a hex centre. */
  plane(x, y) {
    return [1.5 * x, SQRT3 * (y + 0.5 * (x & 1))];
  }

  /** Height of a hex's top face. */
  groundHeight(x, y) {
    if (x < 0 || y < 0 || x >= this.game.width || y >= this.game.height) return TERRAIN_HEIGHT.grass; // off the board
    return terrainHeight(this.game.terrainAt(x, y));
  }

  /** Height a unit stands at on this hex (on the roof if there's a building). */
  standHeight(x, y) {
    return this.groundHeight(x, y) + (this.game.buildingAt?.(x, y) ? BUILDING_HEIGHT : 0);
  }

  /** Screen position of a plane point at a height. */
  project(px, py, h) {
    return [this.origin[0] + px * this.scale, this.origin[1] + (py * SQUASH - h * LIFT) * this.scale];
  }

  /** Screen position of a hex centre at height h (default: its top face). */
  center(x, y, h = this.groundHeight(x, y)) {
    const [px, py] = this.plane(x, y);
    return this.project(px, py, h);
  }

  /** Corner k (0..5, flat-top: 0 = right, going clockwise on screen) at height h. */
  corner(x, y, k, h, inset = 1) {
    const [px, py] = this.plane(x, y);
    const a = (Math.PI / 3) * k;
    return this.project(px + Math.cos(a) * inset, py + Math.sin(a) * inset, h);
  }

  /** The hex's face at height h, as 6 screen points. */
  face(x, y, h = this.groundHeight(x, y), inset = 1) {
    return [0, 1, 2, 3, 4, 5].map((k) => this.corner(x, y, k, h, inset));
  }

  /**
   * The visible side faces of a prism from hTop down to hBottom: the three
   * edges on the near (screen-down) side. Returns [{ pts, side }] where side
   * is 'right' | 'front' | 'left' (for shading).
   */
  sides(x, y, hTop, hBottom = BASE) {
    const sideNames = ['right', 'front', 'left'];
    return [[0, 1], [1, 2], [2, 3]].map(([a, b], i) => ({
      side: sideNames[i],
      pts: [this.corner(x, y, a, hTop), this.corner(x, y, b, hTop), this.corner(x, y, b, hBottom), this.corner(x, y, a, hBottom)],
    }));
  }

  /** All hexes, back to front (painter's order). */
  drawOrder() {
    const cells = [];
    for (let x = 0; x < this.game.width; x++) for (let y = 0; y < this.game.height; y++) cells.push([x, y]);
    return cells.sort((a, b) => this.plane(...a)[1] - this.plane(...b)[1] || a[0] - b[0]);
  }

  /** Bounds of the board on screen at scale 1, origin 0 (for fitting). */
  unitBounds() {
    const saved = [this.scale, this.origin];
    this.scale = 1;
    this.origin = [0, 0];
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of this.drawOrder()) {
      const h = this.groundHeight(x, y);
      for (const [sx, sy] of [...this.face(x, y, h + 1.6), ...this.face(x, y, BASE)]) {
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    }
    [this.scale, this.origin] = saved;
    return { x0, y0, x1, y1 };
  }

  /** Fit the whole board into a viewport (css px), with a margin. */
  fit(viewW, viewH, margin = 8) {
    this.viewW = viewW;
    this.viewH = viewH;
    const b = this.unitBounds();
    this.scale = Math.min((viewW - margin * 2) / (b.x1 - b.x0), (viewH - margin * 2) / (b.y1 - b.y0));
    this.fitScale = this.scale;
    this.origin = [
      (viewW - (b.x1 - b.x0) * this.scale) / 2 - b.x0 * this.scale,
      (viewH - (b.y1 - b.y0) * this.scale) / 2 - b.y0 * this.scale,
    ];
    this.fitOrigin = [...this.origin];
  }

  /** Zoom by `factor` about screen point (cx, cy), within 0.8x..2.5x of the fit. */
  zoomAt(factor, cx, cy) {
    const next = Math.max(this.fitScale * 0.8, Math.min(this.fitScale * 2.5, this.scale * factor));
    const k = next / this.scale;
    this.origin = [cx - (cx - this.origin[0]) * k, cy - (cy - this.origin[1]) * k];
    this.scale = next;
    this.clampPan();
  }

  panBy(dx, dy) {
    this.origin = [this.origin[0] + dx, this.origin[1] + dy];
    this.clampPan();
  }

  resetCamera() {
    this.scale = this.fitScale;
    this.origin = [...this.fitOrigin];
  }

  /** Keep at least part of the board on screen. */
  clampPan() {
    const b = this.unitBounds();
    const s = this.scale;
    const keep = 60;
    const [ox, oy] = this.origin;
    const minX = keep - b.x1 * s;
    const maxX = this.viewW - keep - b.x0 * s;
    const minY = keep - b.y1 * s;
    const maxY = this.viewH - keep - b.y0 * s;
    this.origin = [Math.min(maxX, Math.max(minX, ox)), Math.min(maxY, Math.max(minY, oy))];
  }

  /** The hex whose top face is under screen point (sx, sy), or null. */
  pick(sx, sy) {
    const order = this.drawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const [x, y] = order[i];
      if (pointInPolygon(sx, sy, this.face(x, y, this.standHeight(x, y))) || pointInPolygon(sx, sy, this.face(x, y))) {
        return { x, y };
      }
    }
    return null;
  }
}

export function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
