// Pixel primitives for the art buffer: single pixels, spans, hex faces,
// Bresenham lines, dither patterns and a tiny 3x5 bitmap font. Everything
// lands on whole pixels, so the buffer scales up crisp.

import { MASK, H } from './grid.js';

export const LIGHT = '#e6e0d2';
export const DARK = '#34312d';
export const FRAME = '#25231f'; // the board's background (darker than the UI panels)

/** Dither patterns, in absolute pixel coordinates so they line up across tiles. */
export const PAT = {
  solid: () => true,
  half: (x, y) => ((x + y) & 1) === 0,
  quarter: (x, y) => (x & 1) === 0 && (y & 1) === 0,
  threeq: (x, y) => !((x & 1) === 0 && (y & 1) === 0),
  sparse: (x, y) => (x & 3) === 0 && (y & 3) === 0,
  hstripe: (x, y) => (y & 1) === 0,
  vstripe: (x, y) => (x & 1) === 0,
  diag: (x, y) => ((x + y) & 3) === 0,
  diag2: (x, y) => ((x - y) & 3) === 0,
};

export class Raster {
  constructor(ctx) {
    this.ctx = ctx;
    this.fade = null; // optional pattern: only pixels where it's true are drawn
    this.color = null;
  }

  setColor(c) {
    if (c !== this.color) {
      this.ctx.fillStyle = c;
      this.color = c;
    }
  }

  px(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.fade && !this.fade(x, y)) return;
    this.setColor(c);
    this.ctx.fillRect(x, y, 1, 1);
  }

  rect(x, y, w, h, c) {
    if (this.fade) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
      return;
    }
    this.setColor(c);
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  /** Horizontal run [x0, x1) on row y, optionally through a pattern. */
  span(x0, x1, y, c, pat = null) {
    if (!pat && !this.fade) {
      this.rect(x0, y, x1 - x0, 1, c);
      return;
    }
    for (let x = x0; x < x1; x++) if (!pat || pat(x, y)) this.px(x, y, c);
  }

  /** Fill a hex top-face mask whose top-left is (ox, oy). */
  face(ox, oy, c, pat = null, inset = 0) {
    for (let r = inset; r < H - inset; r++) {
      const [x0, x1] = MASK[r];
      if (x1 - x0 - inset * 4 <= 0) continue;
      this.span(ox + x0 + inset * 2, ox + x1 - inset * 2, oy + r, c, pat);
    }
  }

  /** A list of [dx, dy] pixels offset by (ox, oy); every `every`-th one if dashed. */
  pixels(list, ox, oy, c, every = 1, on = 1) {
    list.forEach(([dx, dy], i) => {
      if (i % every < on) this.px(ox + dx, oy + dy, c);
    });
  }

  /** Bresenham line; `every`/`on` make it dotted (on `on` of each `every` pixels). */
  line(x0, y0, x1, y1, c, { every = 1, on = 1, phase = 0 } = {}) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let i = phase;
    for (;;) {
      if (i % every < on) this.px(x0, y0, c);
      i++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** A small filled (or hollow) arrowhead with its tip at (x, y), pointing along angle a. */
  arrowhead(x, y, a, size, c, { hollow = false, fill = LIGHT } = {}) {
    const back = [x - Math.cos(a) * size, y - Math.sin(a) * size];
    const nx = -Math.sin(a) * size * 0.6;
    const ny = Math.cos(a) * size * 0.6;
    const p1 = [back[0] + nx, back[1] + ny];
    const p2 = [back[0] - nx, back[1] - ny];
    // Fill by scanning the triangle's bounding box.
    const xs = [x, p1[0], p2[0]];
    const ys = [y, p1[1], p2[1]];
    const inside = (px, py) => {
      const s = (ax, ay, bx, by) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const d1 = s(x, y, p1[0], p1[1]);
      const d2 = s(p1[0], p1[1], p2[0], p2[1]);
      const d3 = s(p2[0], p2[1], x, y);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++) {
      for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++) {
        if (inside(px + 0.5, py + 0.5)) this.px(px, py, hollow ? fill : c);
      }
    }
    if (hollow) {
      this.line(x, y, p1[0], p1[1], c);
      this.line(p1[0], p1[1], p2[0], p2[1], c);
      this.line(p2[0], p2[1], x, y, c);
    }
  }

  /** Draw text in the 3x5 font with its top-left at (x, y). */
  text(str, x, y, c) {
    let cx = Math.round(x);
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch] ?? FONT['?'];
      for (let r = 0; r < 5; r++) {
        for (let i = 0; i < g[r].length; i++) if (g[r][i] === '#') this.px(cx + i, y + r, c);
      }
      cx += g[0].length + 1;
    }
  }

  /** Text on a plate (dark plate, light text by default), centred on x. */
  label(str, x, y, { dark = true } = {}) {
    const w = textWidth(str);
    const x0 = Math.round(x - w / 2) - 2;
    this.rect(x0, y - 2, w + 4, 9, dark ? DARK : LIGHT);
    if (!dark) {
      this.line(x0, y - 2, x0 + w + 3, y - 2, DARK);
      this.line(x0, y + 6, x0 + w + 3, y + 6, DARK);
      this.line(x0, y - 2, x0, y + 6, DARK);
      this.line(x0 + w + 3, y - 2, x0 + w + 3, y + 6, DARK);
    }
    this.text(str, x0 + 2, y, dark ? LIGHT : DARK);
  }

  blit(canvas, x, y) {
    this.ctx.drawImage(canvas, Math.round(x), Math.round(y));
  }
}

export function textWidth(str) {
  let w = 0;
  for (const ch of String(str).toUpperCase()) w += (FONT[ch] ?? FONT['?'])[0].length + 1;
  return Math.max(0, w - 1);
}

// 3x5 glyphs ('#' = ink). A few are narrower.
const G = (s) => s.split('|');
export const FONT = {
  A: G('.#.|#.#|###|#.#|#.#'), B: G('##.|#.#|##.|#.#|##.'), C: G('.##|#..|#..|#..|.##'),
  D: G('##.|#.#|#.#|#.#|##.'), E: G('###|#..|##.|#..|###'), F: G('###|#..|##.|#..|#..'),
  G: G('.##|#..|#.#|#.#|.##'), H: G('#.#|#.#|###|#.#|#.#'), I: G('###|.#.|.#.|.#.|###'),
  J: G('..#|..#|..#|#.#|.#.'), K: G('#.#|#.#|##.|#.#|#.#'), L: G('#..|#..|#..|#..|###'),
  M: G('#.#|###|###|#.#|#.#'), N: G('##.|#.#|#.#|#.#|#.#'), O: G('.#.|#.#|#.#|#.#|.#.'),
  P: G('##.|#.#|##.|#..|#..'), Q: G('.#.|#.#|#.#|##.|.##'), R: G('##.|#.#|##.|#.#|#.#'),
  S: G('.##|#..|.#.|..#|##.'), T: G('###|.#.|.#.|.#.|.#.'), U: G('#.#|#.#|#.#|#.#|###'),
  V: G('#.#|#.#|#.#|#.#|.#.'), W: G('#.#|#.#|###|###|#.#'), X: G('#.#|#.#|.#.|#.#|#.#'),
  Y: G('#.#|#.#|.#.|.#.|.#.'), Z: G('###|..#|.#.|#..|###'),
  0: G('###|#.#|#.#|#.#|###'), 1: G('.#|##|.#|.#|.#'), 2: G('##.|..#|.#.|#..|###'),
  3: G('##.|..#|.#.|..#|##.'), 4: G('#.#|#.#|###|..#|..#'), 5: G('###|#..|##.|..#|##.'),
  6: G('.##|#..|###|#.#|###'), 7: G('###|..#|.#.|.#.|.#.'), 8: G('###|#.#|###|#.#|###'),
  9: G('###|#.#|###|..#|##.'),
  ' ': G('..|..|..|..|..'), '!': G('#|#|#|.|#'), '?': G('##.|..#|.#.|...|.#.'),
  '.': G('.|.|.|.|#'), ':': G('.|#|.|#|.'), '/': G('..#|..#|.#.|#..|#..'), '-': G('...|...|###|...|...'),
  "'": G('#|#|.|.|.'), ',': G('.|.|.|#|#'), '+': G('...|.#.|###|.#.|...'),
  'ϟ': G('.#|#.|##|.#|#.'), '>': G('#..|.#.|..#|.#.|#..'), '»': G('#.#..|.#.#.|..#.#|.#.#.|#.#..'),
};
