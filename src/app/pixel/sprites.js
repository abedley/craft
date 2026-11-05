// Colour pixel sprites, built from simple shapes on a pixel grid and then
// given a 1px outline. Building them in code (rather than typing every
// pixel) keeps them editable: each sprite is a short recipe of rects,
// ellipses, lines and polygons, back to front.
//
// The grid itself is plain arrays (no DOM), so sprites can be tested in
// node; `toCanvas` turns one into a cached canvas for drawing.
//
// Unit sprites are UNIT_W x UNIT_H, face right, and stand with their feet
// on FOOT_ROW (the outline's bottom row). CPU sprites are mirrored.

import { C, OUTLINE, teamOf } from './palette.js';

export const UNIT_W = 26;
export const UNIT_H = 40;
export const FOOT_ROW = 37;

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

function legs(s, t) {
  s.rect(9, 29, 3, 6, C.cloth[0]).rect(13, 29, 3, 6, C.cloth[1]);
  s.rect(8, 34, 4, 3, C.leather[1]).rect(13, 34, 4, 3, C.leather[1]);
  s.px(9, 34, C.leather[0]).px(14, 34, C.leather[0]);
  void t;
}

function head(s, cx = 12.5, cy = 13) {
  s.ellipse(cx, cy, 3.6, 3.6, C.skin[0]);
  s.rect(Math.round(cx + 1), cy - 1, 2, 4, C.skin[1]); // shaded side
  s.px(Math.round(cx + 1.5), cy, OUTLINE); // eye
}

function torso(s, t, { x = 8, w = 9 } = {}) {
  s.rect(x, 17, w, 12, t.main);
  s.rect(x, 17, 1, 11, t.light);
  s.rect(x + w - 2, 17, 2, 12, t.dark);
  s.rect(x, 26, w, 2, C.leather[1]);
  s.px(x + Math.floor(w / 2), 26, C.metal[1]);
}

const UNIT_RECIPES = {
  pikeman(s, t) {
    // Pike (behind the front hand): shaft and a metal head.
    s.line(20, 36, 21, 6, C.wood[1]);
    s.line(21, 36, 22, 6, C.wood[2]);
    s.poly([[21.5, 0.5], [24, 6], [19.5, 6]], C.metal[1]);
    s.line(21, 1, 21, 5, C.metal[0]);
    legs(s, t);
    s.rect(6, 18, 2, 8, t.dark); // back arm
    s.rect(6, 25, 2, 2, C.skin[1]);
    torso(s, t);
    s.rect(15, 19, 4, 3, t.main); // front arm to the pike
    s.rect(19, 19, 3, 3, C.skin[0]);
    head(s);
    // Kettle helmet with a wide brim.
    s.ellipse(12.5, 10.5, 4.6, 3.6, C.metal[1], 'top');
    s.rect(6, 10, 13, 2, C.metal[2]);
    s.px(10, 8, C.metal[0]).px(11, 8, C.metal[0]).px(10, 9, C.metal[0]);
  },

  gunslinger(s, t) {
    legs(s, t);
    // Duster coat flaring out, open at the front.
    s.poly([[7, 17], [17.5, 17], [19.5, 34], [5, 34]], t.main);
    s.poly([[15, 17], [17.5, 17], [19.5, 34], [16.5, 34]], t.dark);
    s.line(7, 18, 6, 33, t.light);
    s.rect(10, 17, 4, 8, C.wall[1]); // shirt
    s.line(12, 27, 12, 33, t.dark);
    s.rect(8, 25, 9, 2, C.leather[1]);
    s.px(12, 25, C.metal[0]);
    s.rect(5, 18, 2, 8, t.dark); // back arm
    // Gun arm, out straight, and the pistol.
    s.rect(16, 19, 6, 3, t.main);
    s.rect(16, 21, 6, 1, t.dark);
    s.rect(22, 19, 2, 3, C.skin[0]);
    s.rect(23, 17, 3, 2, C.metal[1]);
    s.px(25, 17, C.metal[2]).px(23, 19, C.metal[2]);
    head(s);
    s.rect(9, 15, 7, 2, t.dark); // bandana
    // Wide-brim hat with a team band.
    s.rect(4, 9, 17, 2, C.leather[0]);
    s.rect(4, 10, 17, 1, C.leather[1]);
    s.rect(8, 4, 9, 5, C.leather[0]);
    s.rect(14, 4, 3, 5, C.leather[1]);
    s.rect(8, 7, 9, 1, t.main);
    s.px(9, 5, C.wood[0]);
  },

  stalker(s, t) {
    // Crouched under a long hooded cloak.
    s.poly([[9, 16], [17, 16], [22, 37], [3, 37]], t.dark);
    s.poly([[9, 16], [12, 16], [7, 37], [3, 37]], t.main);
    s.line(11, 22, 10, 36, t.dark);
    s.line(15, 21, 16, 36, OUTLINE);
    s.line(18, 25, 19, 36, t.main);
    s.rect(19, 31, 3, 2, C.skin[1]); // a hand on the ground
    // Hood with a dark opening and glowing eyes.
    s.ellipse(13, 15, 6.2, 6, t.dark);
    s.ellipse(12, 14, 5, 5, t.main, 'top');
    s.ellipse(15, 16, 3.6, 3.2, '#1b1420');
    s.px(14, 16, C.eyes).px(17, 16, C.eyes);
  },

  builder(s, t) {
    // Wooden crate beside them.
    s.rect(0, 27, 8, 10, C.wood[1]);
    s.rect(0, 27, 8, 1, C.wood[0]);
    s.rect(6, 27, 2, 10, C.wood[2]);
    s.line(0, 28, 7, 36, C.wood[2]);
    s.px(1, 29, C.metal[1]).px(5, 34, C.metal[1]);
    legs(s, t);
    s.rect(7, 18, 2, 8, t.light); // back arm (shirt sleeve)
    torso(s, t, { x: 9, w: 8 });
    s.rect(9, 17, 8, 3, t.light); // shirt above the bib
    s.rect(10, 17, 1, 8, t.dark).rect(15, 17, 1, 8, t.dark); // straps
    // Raised hammer arm.
    s.rect(16, 12, 3, 7, t.light);
    s.rect(16, 10, 3, 2, C.skin[0]);
    s.line(18, 11, 20, 2, C.wood[1]);
    s.rect(17, 0, 7, 3, C.metal[1]);
    s.rect(17, 2, 7, 1, C.metal[2]);
    s.px(18, 0, C.metal[0]);
    head(s, 12.5, 13);
    // Hard hat.
    s.ellipse(12.5, 10.5, 4.6, 3.8, C.hardhat[1], 'top');
    s.rect(7, 10, 12, 2, C.hardhat[2]);
    s.px(10, 8, C.hardhat[0]).px(11, 7, C.hardhat[0]);
  },

  generic(s, t) {
    legs(s, t);
    s.rect(6, 18, 2, 8, t.dark);
    torso(s, t);
    s.rect(17, 18, 2, 8, t.dark);
    s.rect(11, 19, 3, 3, t.light); // badge
    head(s);
    s.ellipse(12.5, 10.5, 4.2, 3.2, t.dark, 'top');
  },
};

export const UNIT_TYPES_DRAWN = Object.keys(UNIT_RECIPES).filter((k) => k !== 'generic');

/** Build a unit sprite (facing right) for a team. */
export function buildUnit(type, team) {
  const s = new SpriteBuilder(UNIT_W, UNIT_H);
  (UNIT_RECIPES[type] ?? UNIT_RECIPES.generic)(s, teamOf(team));
  return s.outline();
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
