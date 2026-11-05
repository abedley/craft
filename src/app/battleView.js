// The battle board renderer: monochrome pixel art.
//
// Each frame is drawn into a small "art buffer" (one pixel per art pixel,
// about 220 x 200 for the escort map) and then scaled up onto the screen
// canvas by a whole number of device pixels, with smoothing off, so every
// art pixel is a crisp, equal square. The terrain is cached in its own
// art-sized buffer and only redrawn when the terrain changes.
//
// Layers, back to front: terrain; ground marks (danger tiles, reach,
// selection, strike flashes); things in depth order (trees, buildings,
// mines, the goal flag, units, shots); intents and their number badges;
// unit marks; playback effects.

import { PixelView } from './pixel/grid.js';
import { Raster, FRAME, PAT } from './pixel/raster.js';
import {
  drawTerrain, drawTrees, drawBuilding, drawMine, drawGoal, drawUnit, drawBullet, escortStar, dangerMark,
  reachMarks, selectRing, dangerTiles, drawIntent, badge, aimArrows, boom, strikeFlash, dirAngle,
} from './pixel/draw.js';
import { getUnitType } from '../engine/index.js';

const MAX_ZOOM = 3; // times the fitted scale

export class BattleView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.grid = null;
    this.art = document.createElement('canvas');
    this.artCtx = this.art.getContext('2d');
    this.terrain = document.createElement('canvas');
    this.terrainKey = null;
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.k = 1; // device px per art px
    this.fitK = 1;
    this.off = [0, 0]; // device px of the art buffer's top-left
    this.fitOff = [0, 0];
    this.zoomAcc = 1;
  }

  /** Point the view at a game (the camera is kept if the board is the same size). */
  setGame(game) {
    const same = this.grid && this.grid.game.width === game.width && this.grid.game.height === game.height;
    if (!this.grid) this.grid = new PixelView(game);
    this.grid.game = game;
    if (!same) {
      const { w, h } = this.grid.size;
      this.art.width = w;
      this.art.height = h;
      this.terrain.width = w;
      this.terrain.height = h;
      this.terrainKey = null;
      if (this.cssW) this.fit();
    }
  }

  /** Match the canvas to its box (call on resize). Returns whether it changed. */
  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return false;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.grid) this.fit();
    return true;
  }

  // ---- camera (device pixels) --------------------------------------------------

  fit() {
    const { w, h } = this.grid.size;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.fitK = Math.max(1, Math.floor(Math.min(W / w, H / h)));
    this.k = this.fitK;
    this.zoomAcc = 1;
    this.off = [Math.floor((W - w * this.k) / 2), Math.floor((H - h * this.k) / 2)];
    this.fitOff = [...this.off];
  }

  resetCamera() {
    this.k = this.fitK;
    this.zoomAcc = 1;
    this.off = [...this.fitOff];
  }

  get cameraMoved() {
    return this.k !== this.fitK || this.off[0] !== this.fitOff[0] || this.off[1] !== this.fitOff[1];
  }

  /** Zoom by `factor` about css point (cx, cy), in whole art-pixel steps. */
  zoomAt(factor, cx, cy) {
    this.zoomAcc = Math.max(1, Math.min(MAX_ZOOM, this.zoomAcc * factor));
    const next = Math.max(this.fitK, Math.round(this.fitK * this.zoomAcc));
    if (next === this.k) return;
    const px = cx * this.dpr;
    const py = cy * this.dpr;
    const ax = (px - this.off[0]) / this.k;
    const ay = (py - this.off[1]) / this.k;
    this.k = next;
    this.off = [Math.round(px - ax * next), Math.round(py - ay * next)];
    this.clamp();
  }

  panBy(dx, dy) {
    this.off = [this.off[0] + Math.round(dx * this.dpr), this.off[1] + Math.round(dy * this.dpr)];
    this.clamp();
  }

  /** Keep at least part of the board on screen. */
  clamp() {
    const { w, h } = this.grid.size;
    const keep = 60 * this.dpr;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.off = [
      Math.min(W - keep, Math.max(keep - w * this.k, this.off[0])),
      Math.min(H - keep, Math.max(keep - h * this.k, this.off[1])),
    ];
  }

  /** Art px -> css px (for tests and taps). */
  artToCss(ax, ay) {
    return [(this.off[0] + (ax + 0.5) * this.k) / this.dpr, (this.off[1] + (ay + 0.5) * this.k) / this.dpr];
  }

  /** The hex under css point (sx, sy), or null. */
  pick(sx, sy) {
    const ax = Math.floor((sx * this.dpr - this.off[0]) / this.k);
    const ay = Math.floor((sy * this.dpr - this.off[1]) / this.k);
    return this.grid.pick(ax, ay);
  }

  dirAngle(dir) {
    return dirAngle(dir);
  }

  // ---- frame ---------------------------------------------------------------------

  drawTerrainCache() {
    const g = this.grid.game;
    const key = `${g.width}x${g.height}|${g.terrain.join(',')}`;
    if (key === this.terrainKey) return;
    const ctx = this.terrain.getContext('2d');
    ctx.clearRect(0, 0, this.terrain.width, this.terrain.height);
    drawTerrain(new Raster(ctx), this.grid);
    this.terrainKey = key;
  }

  /**
   * @param {object} st
   *   game, frame (0/1: idle bob and blink), selectedId, reach {cells, teleport},
   *   aim {unit, dirs}, intents (bool), activeStep, danger (Set of unit ids),
   *   threats ([[x, y]]), focusId, showNumbers,
   *   anim { units: Map(id -> [ax, ay] feet), hidden: Set, bullets: [{id, ax, ay, angle}],
   *          effects: [{kind, ...}] (art px), rising: Map(buildingId -> 0..1) }
   */
  render(st) {
    const v = this.grid;
    const g = st.game;
    v.game = g;
    const anim = st.anim ?? {};
    const frame = st.frame ?? 0;
    this.drawTerrainCache();
    const a = this.artCtx;
    a.fillStyle = FRAME;
    a.fillRect(0, 0, this.art.width, this.art.height);
    a.drawImage(this.terrain, 0, 0);
    const r = new Raster(a);

    // Ground marks.
    if (st.threats?.length) dangerTiles(r, v, st.threats);
    if (st.reach?.cells?.length) reachMarks(r, v, st.reach.cells, st.reach.teleport);
    const sel = st.selectedId != null ? g.getUnit(st.selectedId) : null;
    if (sel && !anim.units?.has(sel.id)) selectRing(r, v, sel.x, sel.y, frame);
    for (const e of anim.effects ?? []) if (e.kind === 'strike') strikeFlash(r, v, e.cells, e.t);

    this.drawThings(r, g, anim, frame);

    // Intents (unfocused ones dithered out) and their badges.
    const badges = [];
    if (st.intents) {
      g.queue.forEach((entry, i) => {
        if (st.activeStep && i + 1 < st.activeStep) return;
        const ownerId = entry.projectileId !== undefined ? g.getProjectile(entry.projectileId)?.ownerId : entry.unitId;
        r.fade = st.focusId != null && ownerId !== st.focusId ? PAT.quarter : null;
        const at = drawIntent(r, v, g, entry);
        r.fade = null;
        if (!at) return;
        const active = st.activeStep === i + 1;
        if (!(st.showNumbers || active || (st.focusId != null && ownerId === st.focusId))) return;
        const team = g.getUnit(ownerId)?.team ?? 'cpu';
        const fast = !!(entry.order?.quick || entry.order?.type === 'charge');
        badges.push({ at, n: i + 1, dark: team === 'cpu', fast, active });
      });
    }
    if (st.aim) aimArrows(r, v, st.aim.unit, st.aim.dirs);

    // Unit marks: escort star, dies-this-turn, build progress.
    const vipId = g.objective?.kind === 'escort' ? g.objective.unitId : null;
    for (const u of g.units) {
      if (anim.hidden?.has(u.id)) continue;
      const [fx, fy] = this.footOf(u, anim);
      if (u.id === vipId) escortStar(r, fx, fy);
      if (st.danger?.has(u.id)) dangerMark(r, fx, fy);
      if (u.channel?.kind === 'build') r.label(`${u.channel.progress}/${getUnitType(u.type).build.turns}`, fx, fy + 4);
    }
    for (const b of badges) badge(r, b.at[0], b.at[1], b.n, b);

    for (const e of anim.effects ?? []) {
      if (e.kind === 'boom') boom(r, e.x, e.y, e.size ?? 1, e.t);
      if (e.kind === 'text') r.label(e.text, e.x, Math.round(e.y - e.t * 6), { dark: !e.light });
    }

    // Scale the art buffer up onto the screen.
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = FRAME;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.art, this.off[0], this.off[1], this.art.width * this.k, this.art.height * this.k);
  }

  /** Art position of a unit's feet (animated if it's moving). */
  footOf(u, anim = {}) {
    const p = anim.units?.get(u.id);
    if (p) return p;
    return this.grid.center(u.x, u.y, this.grid.standHeight(u.x, u.y));
  }

  /** Trees, buildings, mines, the flag, units and shots, back to front. */
  drawThings(r, g, anim, frame) {
    const v = this.grid;
    const items = [];
    const depth = (x, y) => v.center(x, y)[1];
    for (const [x, y] of v.drawOrder()) {
      if (g.terrainAt(x, y) === 'forest') items.push({ d: depth(x, y) - 0.5, draw: () => drawTrees(r, v, x, y) });
    }
    for (const b of g.buildings) {
      items.push({ d: depth(b.x, b.y) - 0.3, draw: () => drawBuilding(r, v, b, anim.rising?.get(b.id) ?? 1) });
    }
    for (const m of g.mines) items.push({ d: depth(m.x, m.y) - 0.4, draw: () => drawMine(r, v, m) });
    if (g.objective?.kind === 'escort') {
      const [gx, gy] = g.objective.to;
      items.push({ d: depth(gx, gy) - 0.45, draw: () => drawGoal(r, v, gx, gy) });
    }
    for (const u of g.units) {
      if (anim.hidden?.has(u.id)) continue;
      const moving = anim.units?.has(u.id);
      const [fx, fy] = this.footOf(u, anim);
      const ground = moving ? fy : depth(u.x, u.y);
      items.push({ d: ground, draw: () => drawUnit(r, u, fx, fy, moving ? 0 : (frame + u.id) % 2) });
    }
    const flying = new Set((anim.bullets ?? []).map((b) => b.id));
    for (const p of g.projectiles) {
      if (flying.has(p.id)) continue;
      const [bx, by] = v.center(p.x, p.y);
      items.push({ d: by + 0.2, draw: () => drawBullet(r, bx, by - 9, dirAngle(p.dir)) });
    }
    for (const b of anim.bullets ?? []) items.push({ d: b.ay + 9.2, draw: () => drawBullet(r, b.ax, b.ay, b.angle) });
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.draw();
  }
}
