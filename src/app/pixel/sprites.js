// Colour pixel sprites, built from simple shapes on a pixel grid and then
// given a 1px outline. Building them in code (rather than typing every
// pixel) keeps them editable: each sprite is a short recipe of rects,
// ellipses, lines and polygons, back to front.
//
// The grid itself is plain arrays (no DOM), so sprites can be tested in
// node; `toCanvas` turns one into a cached canvas for drawing.
//
// Unit sprites are UNIT_W x UNIT_H, face right, and stand with their feet
// on FOOT_ROW (the outline's bottom row). CPU sprites are mirrored. Units
// have a soft, coloured outline; props keep the plum OUTLINE.

import { C, U, UNIT_RAMPS, OUTLINE, teamOf } from './palette.js';

export const UNIT_W = 18;
export const UNIT_H = 24;
export const FOOT_ROW = 21;

export class SpriteBuilder {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.p = new Array(w * h).fill(null);
  }

  get(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.p[y * this.w + x] : null;
  }

  px(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = c;
    return this;
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
    return this;
  }

  /** Filled ellipse (pixel centres inside); `half` = 'top' | 'bottom' keeps one half. */
  ellipse(cx, cy, rx, ry, c, half = null) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        if (half === 'top' && y + 0.5 > cy) continue;
        if (half === 'bottom' && y + 0.5 < cy) continue;
        this.px(x, y, c);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled polygon (pixel centres inside, even-odd rule). */
  poly(pts, c) {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const cy = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x + 0.5 <= xs[k + 1]; x++) this.px(x, y, c);
      }
    }
    return this;
  }

  /** Put `c` on every empty pixel next to a filled one (4-neighbours). */
  outline(c = OUTLINE) {
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.px(x, y, c);
    return this;
  }

  /** Set of colours used. */
  colors() {
    return new Set(this.p.filter(Boolean));
  }
}

// ---- units ------------------------------------------------------------------------
// Small chibi figures: a big head on a stubby body, a handful of muted
// colours each, and a soft outline: every edge is the darkest shade of the
// material it wraps (see U in palette.js), never a black line.

/** Map each unit colour (and the team's) to its ramp's edge shade. */
function edgeMap(t) {
  const m = new Map();
  for (const ramp of [...UNIT_RAMPS, t.unit]) for (const c of ramp) m.set(c, ramp[ramp.length - 1]);
  return m;
}

/** Soft outline: each empty pixel next to the figure takes the edge shade of what it touches. */
function softOutline(s, edges) {
  const add = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (s.get(x, y)) continue;
      const n = [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => s.get(x + dx, y + dy)).find(Boolean);
      if (n) add.push([x, y, edges.get(n) ?? n]);
    }
  }
  for (const [x, y, c] of add) s.px(x, y, c);
  return s;
}

function chibiHead(s, cx = 8.5, cy = 7.5) {
  const x = Math.floor(cx), y = Math.floor(cy);
  s.ellipse(cx, cy, 4.6, 4.4, U.skin[0]);
  s.rect(x - 3, y + 3, 7, 1, U.skin[1]).rect(x + 3, y + 1, 1, 3, U.skin[1]); // jaw in shade
  s.rect(x, y - 1, 1, 2, U.cloth[1]).rect(x + 2, y - 1, 1, 2, U.cloth[1]); // eyes
}

function chibiBody(s, T, { boots = U.leather, legs = U.cloth } = {}) {
  s.rect(6, 17, 2, 3, legs[0]).rect(10, 17, 2, 3, legs[1] ?? legs[0]);
  s.rect(6, 19, 3, 2, boots[1]).rect(10, 19, 3, 2, boots[1]);
  s.rect(5, 12, 8, 6, T[1]);
  s.rect(5, 12, 1, 5, T[0]);
  s.rect(11, 12, 2, 6, T[2]);
}

const UNIT_RECIPES = {
  pikeman(s, T) {
    s.line(15, 3, 15, 20, U.wood[1]);
    s.poly([[15.5, 0], [17.5, 4], [13.5, 4]], U.metal[1]);
    s.px(15, 1, U.metal[0]);
    chibiBody(s, T);
    s.rect(5, 16, 8, 1, U.leather[1]); // belt
    s.rect(12, 13, 2, 2, T[1]); // arm to the pike
    s.rect(14, 13, 2, 2, U.skin[0]);
    chibiHead(s);
    // Kettle helmet with a wide brim.
    s.ellipse(8.5, 5.5, 5, 3.6, U.metal[1], 'top');
    s.rect(3, 5, 12, 1, U.metal[2]);
    s.px(6, 3, U.metal[0]).px(7, 2, U.metal[0]);
  },

  gunslinger(s, T) {
    chibiBody(s, T);
    // Duster flaring out over the legs.
    s.poly([[5, 12], [13, 12], [14, 19], [4, 19]], T[1]);
    s.poly([[11, 12], [13, 12], [14, 19], [12, 19]], T[2]);
    s.line(5, 13, 4, 18, T[0]);
    s.rect(8, 12, 2, 5, U.metal[0]); // shirt
    s.rect(12, 13, 3, 2, T[1]); // gun arm
    s.px(15, 14, U.skin[0]);
    s.rect(15, 12, 2, 2, U.metal[2]).px(16, 12, U.metal[1]);
    chibiHead(s);
    // Wide-brim hat with a team band.
    s.rect(2, 4, 14, 1, U.leather[1]);
    s.rect(5, 1, 8, 3, U.leather[0]);
    s.rect(10, 1, 3, 3, U.leather[1]);
    s.rect(5, 3, 8, 1, T[1]);
  },

  stalker(s, T) {
    // Crouched under a long hooded cloak.
    s.poly([[4, 10], [13, 10], [16, 21], [1, 21]], T[2]);
    s.poly([[4, 10], [8, 10], [5, 21], [1, 21]], T[1]);
    s.line(9, 14, 9, 20, T[3]);
    s.rect(14, 17, 2, 2, U.skin[1]); // a hand on the ground
    s.ellipse(8.5, 9, 5.6, 5.4, T[2]);
    s.ellipse(7.5, 7.5, 4.2, 3.8, T[1], 'top');
    s.ellipse(10.5, 10, 3.4, 3, U.hood[0]);
    s.px(9, 9, U.glow[0]).px(12, 9, U.glow[0]);
  },

  builder(s, T) {
    // Armoured work suit: powerpack, glass-visor helmet, big shoulder pad, torch.
    s.rect(2, 11, 3, 6, U.metal[2]);
    s.rect(2, 11, 1, 6, U.metal[1]);
    s.rect(3, 8, 1, 3, U.metal[2]);
    chibiBody(s, T, { boots: U.metal, legs: [U.metal[1], U.metal[2]] });
    s.rect(5, 16, 8, 1, U.metal[2]);
    s.rect(7, 14, 3, 2, U.metal[1]).px(7, 14, U.metal[0]); // chest vent
    // Helmet with a wide visor.
    s.ellipse(8.5, 7.5, 4.6, 4.4, U.metal[1]);
    s.ellipse(7, 5, 2.4, 1.8, U.metal[0], 'top');
    s.rect(4, 8, 4, 1, T[1]); // team stripe
    s.rect(9, 6, 4, 3, U.glass[1]);
    s.rect(9, 6, 3, 1, U.glass[0]);
    s.rect(9, 9, 4, 1, U.metal[2]);
    // Shoulder pad and torch arm.
    s.rect(13, 14, 3, 2, U.metal[2]);
    s.ellipse(12.5, 13, 2.8, 2.4, T[1]);
    s.ellipse(12, 12.4, 1.6, 1, T[0], 'top');
    s.px(16, 14, U.spark[0]).px(17, 13, U.glow[0]).px(17, 16, U.glow[0]);
  },

  generic(s, T) {
    chibiBody(s, T);
    s.rect(5, 16, 8, 1, U.leather[1]);
    chibiHead(s);
    s.ellipse(8.5, 5.5, 4.6, 3.2, T[2], 'top');
  },
};

export const UNIT_TYPES_DRAWN = Object.keys(UNIT_RECIPES).filter((k) => k !== 'generic');

/** Build a unit sprite (facing right) for a team. */
export function buildUnit(type, team) {
  const t = teamOf(team);
  const s = new SpriteBuilder(UNIT_W, UNIT_H);
  (UNIT_RECIPES[type] ?? UNIT_RECIPES.generic)(s, t.unit);
  return softOutline(s, edgeMap(t));
}

// ---- props --------------------------------------------------------------------------

export function buildTree(variant = 0) {
  const s = new SpriteBuilder(20, 26);
  s.rect(8, 15, 4, 9, C.trunk[0]).rect(10, 15, 2, 9, C.trunk[1]);
  s.rect(6, 23, 8, 1, C.trunk[1]);
  if (variant === 1) {
    // Conifer: stacked tiers.
    for (const [y, w] of [[2, 3], [6, 5], [10, 7], [14, 8]]) {
      s.poly([[10, y - 2], [10 + w, y + 5], [10 - w, y + 5]], C.canopy[2]);
      s.poly([[10, y - 2], [10, y + 5], [10 - w, y + 5]], C.canopy[1]);
      s.line(10 - w + 1, y + 5, 10 + w - 1, y + 5, C.canopy[3]);
    }
    s.px(9, 3, C.canopy[0]).px(8, 8, C.canopy[0]).px(6, 12, C.canopy[0]);
  } else {
    s.ellipse(10, 10, 9, 8.5, C.canopy[3]);
    s.ellipse(9.5, 9, 8, 7.5, C.canopy[2]);
    s.ellipse(8, 7.5, 5.5, 5, C.canopy[1]);
    s.ellipse(6.5, 5.5, 2.6, 2.2, C.canopy[0]);
    for (const [x, y] of [[13, 12], [15, 8], [11, 15], [4, 11], [16, 13]]) s.px(x, y, C.canopy[3]);
    for (const [x, y] of [[10, 4], [4, 8], [12, 6]]) s.px(x, y, C.canopy[0]);
  }
  return s.outline();
}

export function buildMine(team) {
  const t = teamOf(team);
  const s = new SpriteBuilder(15, 9);
  for (const [x, y] of [[1, 4], [13, 4], [7, 0], [3, 1], [11, 1]]) s.px(x, y, C.metal[2]);
  s.ellipse(7.5, 5, 6, 3.4, C.metal[2]);
  s.ellipse(7.5, 4, 5, 2.6, C.metal[1]);
  s.rect(6, 3, 3, 2, t.main);
  s.px(6, 3, t.light);
  return s.outline();
}

export function buildGoalFlag() {
  const s = new SpriteBuilder(20, 34);
  s.rect(2, 2, 2, 30, C.metal[2]);
  s.rect(2, 2, 1, 30, C.metal[0]);
  s.poly([[4, 2], [18, 6], [4, 12]], C.hardhat[1]);
  s.poly([[4, 2], [18, 6], [4, 6]], C.hardhat[0]);
  s.ellipse(3, 1.5, 1.6, 1.6, C.hardhat[0]);
  s.rect(0, 31, 6, 2, C.stone[1]);
  return s.outline();
}

export function buildStar() {
  const s = new SpriteBuilder(15, 15);
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (Math.PI / 5) * k;
    const r = k % 2 ? 2.8 : 6.6;
    pts.push([7.5 + Math.cos(a) * r, 7.8 + Math.sin(a) * r]);
  }
  s.poly(pts, C.hardhat[1]);
  s.poly(pts.map(([x, y]) => [x - 0.6, y - 0.8]).slice(0, 6), C.hardhat[0]);
  return s.outline();
}

export function buildDies() {
  const s = new SpriteBuilder(15, 15);
  s.rect(1, 1, 13, 13, C.target);
  s.rect(1, 1, 13, 1, '#ff6b5c');
  for (let i = 0; i < 7; i++) {
    s.rect(4 + i, 4 + i, 1, 1, C.white).rect(10 - i, 4 + i, 1, 1, C.white);
  }
  return s.outline();
}

export function buildBullet() {
  const s = new SpriteBuilder(14, 7);
  s.line(0, 3, 5, 3, C.metal[0]);
  s.line(2, 2, 5, 2, C.metal[2]);
  s.ellipse(9.5, 3.5, 3.5, 2.2, C.metal[1]);
  s.px(9, 2, C.metal[0]).px(10, 2, C.white);
  return s.outline();
}

// ---- canvases -------------------------------------------------------------------------

const cache = new Map();

/** A built sprite as a canvas (cached by key). */
export function toCanvas(key, build, { mirror = false } = {}) {
  const id = `${key}|${mirror}`;
  if (cache.has(id)) return cache.get(id);
  const s = build();
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  const ctx = c.getContext('2d');
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const col = s.get(x, y);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(mirror ? s.w - 1 - x : x, y, 1, 1);
    }
  }
  cache.set(id, c);
  return c;
}

/** A unit's sprite canvas (CPU units face left). */
export function unitSprite(type, team) {
  const kind = UNIT_RECIPES[type] ? type : 'generic';
  return toCanvas(`unit:${kind}:${team}`, () => buildUnit(kind, team), { mirror: team === 'cpu' });
}

export const sprite = {
  tree: (v = 0) => toCanvas(`tree:${v}`, () => buildTree(v)),
  mine: (team) => toCanvas(`mine:${team}`, () => buildMine(team)),
  goal: () => toCanvas('goal', buildGoalFlag),
  star: () => toCanvas('star', buildStar),
  dies: () => toCanvas('dies', buildDies),
  bullet: (left) => toCanvas('bullet', buildBullet, { mirror: left }),
};
