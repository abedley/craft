// The battle board renderer: an isometric, 1-bit hand-drawn canvas.
//
// Layers, back to front:
//   1. terrain (paper decor + every hex prism), pre-rendered to an offscreen
//      canvas and only redrawn when the zoom or the terrain changes;
//   2. ground marks: reach, selection, strike flashes;
//   3. things with height, depth-sorted: trees, buildings, mines, the goal
//      flag, units, projectiles;
//   4. intents (what each queue entry will do), queue number badges, danger
//      marks, aim arrows and playback effects.

import { PAPER } from './ink.js';
import { IsoView, SQUASH } from './iso.js';
import { drawTile, drawTrees, drawBuilding, drawMine, drawObjectiveFlag, drawPaperDecor, penOf } from './art/terrain.js';
import { drawFigure, escortStar } from './art/units.js';
import {
  reachMarks, selectBrackets, drawIntent, dangerTiles, badge, dangerMark, bullet, strikeFlash, boom, label, aimArrows,
} from './art/effects.js';
import { getUnitType, DIRECTION_ANGLES } from '../engine/index.js';

const PAD = 2.2; // hex radii of paper decor around the board
const MAX_CACHE_PX = 9e6; // stay well inside iOS canvas memory limits

export class BattleView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = null;
    this.cache = null;
    this.cacheTimer = null;
    this.cssW = 0;
    this.cssH = 0;
  }

  /** Point the view at a game (the camera is kept if the board size is the same). */
  setGame(game) {
    const same = this.view && this.view.game.width === game.width && this.view.game.height === game.height;
    if (!this.view) this.view = new IsoView(game);
    this.view.game = game;
    if (!same) {
      this.cache = null;
      if (this.cssW) this.view.fit(this.cssW, this.cssH);
    }
  }

  /** Match the canvas to its box (call on resize). */
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
    if (this.view) this.view.fit(w, h);
    this.cache = null;
    return true;
  }

  get cameraMoved() {
    const v = this.view;
    return !!v && (Math.abs(v.scale - v.fitScale) > 0.01
      || Math.abs(v.origin[0] - v.fitOrigin[0]) > 1 || Math.abs(v.origin[1] - v.fitOrigin[1]) > 1);
  }

  // ---- terrain cache ---------------------------------------------------------

  terrainKey() {
    const g = this.view.game;
    return `${this.view.scale.toFixed(3)}|${this.dpr}|${g.width}x${g.height}|${g.terrain.join(',')}`;
  }

  buildCache() {
    const v = this.view;
    const b = v.unitBounds();
    const x0 = b.x0 - PAD;
    const y0 = b.y0 - PAD;
    const wCss = (b.x1 - b.x0 + PAD * 2) * v.scale;
    const hCss = (b.y1 - b.y0 + PAD * 2) * v.scale;
    const cdpr = Math.min(this.dpr, Math.sqrt(MAX_CACHE_PX / (wCss * hCss)));
    const c = this.cache?.canvas ?? document.createElement('canvas');
    c.width = Math.ceil(wCss * cdpr);
    c.height = Math.ceil(hCss * cdpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(cdpr, 0, 0, cdpr, 0, 0);
    ctx.clearRect(0, 0, wCss, hCss);
    const saved = v.origin;
    v.origin = [-x0 * v.scale, -y0 * v.scale];
    drawPaperDecor(ctx, v, 0, PAD - 0.4);
    for (const [x, y] of v.drawOrder()) drawTile(ctx, v, x, y, v.game.terrainAt(x, y));
    v.origin = saved;
    this.cache = { canvas: c, key: this.terrainKey(), scale: v.scale, x0, y0, wCss, hCss };
  }

  drawTerrain(ctx) {
    const v = this.view;
    if (!this.cache || (this.cache.key !== this.terrainKey() && this.cache.scale === v.scale)) this.buildCache();
    const c = this.cache;
    if (c.key !== this.terrainKey()) {
      // Zooming: stretch the old cache now, redraw it sharp once things settle.
      clearTimeout(this.cacheTimer);
      this.cacheTimer = setTimeout(() => { this.buildCache(); this.onCacheReady?.(); }, 140);
    }
    const k = v.scale / c.scale;
    ctx.drawImage(c.canvas, v.origin[0] + c.x0 * v.scale, v.origin[1] + c.y0 * v.scale, c.wCss * k, c.hCss * k);
  }

  // ---- frame -------------------------------------------------------------------

  /**
   * @param {object} st
   *   game, seed (line boil 0..2), selectedId, reach {cells, teleport},
   *   aim {unit, dirs}, intents (bool), activeStep, danger (Set of unit ids),
   *   threats ([[x, y]] hexes hit this turn), focusId (unit whose intent is
   *   emphasised; others fade), showNumbers (all queue badges; otherwise
   *   only the focused unit's and the step being played),
   *   anim { units: Map(id -> {px, py, h}), hidden: Set, bullets: [{px, py, h, angle}],
   *          effects: [{kind, ...}], rising: Map(buildingId -> 0..1) }
   */
  render(st) {
    const { ctx, view: v } = this;
    const g = st.game;
    const seed = st.seed ?? 0;
    const anim = st.anim ?? {};
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.drawTerrain(ctx);

    // Ground marks.
    if (st.threats?.length) dangerTiles(ctx, v, st.threats, seed);
    if (st.reach?.cells?.length) reachMarks(ctx, v, st.reach.cells, { teleport: st.reach.teleport, seed });
    const sel = st.selectedId != null ? g.getUnit(st.selectedId) : null;
    if (sel && !anim.units?.has(sel.id)) selectBrackets(ctx, v, sel.x, sel.y, seed);
    for (const e of anim.effects ?? []) if (e.kind === 'strike') strikeFlash(ctx, v, e.cells, e.t, seed);

    this.drawThings(ctx, g, st, seed, anim);

    // Intents and badges.
    const k = penOf(v);
    const badges = [];
    if (st.intents) {
      g.queue.forEach((entry, i) => {
        if (st.activeStep && i + 1 < st.activeStep) return;
        const ownerId = entry.projectileId !== undefined ? g.getProjectile(entry.projectileId)?.ownerId : entry.unitId;
        const focused = st.focusId == null || ownerId === st.focusId;
        ctx.save();
        if (!focused) ctx.globalAlpha = 0.28;
        const at = drawIntent(ctx, v, g, entry, { seed });
        ctx.restore();
        if (!at) return;
        const active = st.activeStep === i + 1;
        if (!(st.showNumbers || active || (st.focusId != null && ownerId === st.focusId))) return;
        const team = entry.projectileId !== undefined ? (g.getUnit(ownerId)?.team ?? 'cpu') : g.getUnit(entry.unitId)?.team;
        const fast = !!(entry.order?.quick || entry.order?.type === 'charge');
        badges.push({ at, n: i + 1, dark: team === 'cpu', fast, active });
      });
    }
    if (st.aim) aimArrows(ctx, v, st.aim.unit, st.aim.dirs, seed);

    // Unit marks: escort star, danger, channel progress.
    const vipId = g.objective?.kind === 'escort' ? g.objective.unitId : null;
    for (const u of g.units) {
      if (anim.hidden?.has(u.id)) continue;
      const [fx, fy] = this.footOf(u, anim);
      if (u.id === vipId) escortStar(ctx, fx - v.scale * 0.04, fy - v.scale * 1.6, v.scale, seed);
      if (st.danger?.has(u.id)) dangerMark(ctx, fx - v.scale * 0.42, fy - v.scale * 1.05, v.scale, seed);
      if (u.channel?.kind === 'build') {
        label(ctx, fx, fy + v.scale * 0.32, `${u.channel.progress}/${getUnitType(u.type).build.turns}`, 13 * Math.max(1, k), { dark: true });
      }
    }
    for (const b of badges) badge(ctx, b.at[0], b.at[1], b.n, { dark: b.dark, fast: b.fast, active: b.active, k });

    for (const e of anim.effects ?? []) {
      if (e.kind === 'boom') boom(ctx, e.x, e.y, v.scale * (e.size ?? 1), e.t, e.seed ?? 0);
      if (e.kind === 'text') label(ctx, e.x, e.y - e.t * v.scale * 0.5, e.text, 15 * Math.max(1, k), { dark: e.dark });
    }
  }

  /** Screen position of a unit's feet (animated if it's moving). */
  footOf(u, anim = {}) {
    const v = this.view;
    const a = anim.units?.get(u.id);
    if (a) return v.project(a.px, a.py, a.h);
    return v.center(u.x, u.y, v.standHeight(u.x, u.y));
  }

  /** Trees, buildings, mines, the flag, units and projectiles, in depth order. */
  drawThings(ctx, g, st, seed, anim) {
    const v = this.view;
    const items = [];
    const at = (x, y) => v.plane(x, y)[1];
    for (let x = 0; x < g.width; x++) {
      for (let y = 0; y < g.height; y++) {
        if (g.terrainAt(x, y) === 'forest') items.push({ d: at(x, y) - 0.05, x, draw: () => drawTrees(ctx, v, x, y) });
      }
    }
    for (const b of g.buildings) {
      const rise = anim.rising?.get(b.id) ?? 1;
      items.push({ d: at(b.x, b.y) - 0.02, x: b.x, draw: () => drawBuilding(ctx, v, b, 0, rise) });
    }
    for (const m of g.mines) items.push({ d: at(m.x, m.y) - 0.03, x: m.x, draw: () => drawMine(ctx, v, m, seed) });
    const obj = g.objective;
    if (obj?.kind === 'escort') {
      items.push({ d: at(...obj.to) - 0.04, x: obj.to[0], draw: () => drawObjectiveFlag(ctx, v, obj.to[0], obj.to[1], seed) });
    }
    for (const u of g.units) {
      if (anim.hidden?.has(u.id)) continue;
      const a = anim.units?.get(u.id);
      const d = a ? a.py : at(u.x, u.y);
      items.push({
        d: d + 0.01, x: u.x,
        draw: () => {
          const [fx, fy] = this.footOf(u, anim);
          drawFigure(ctx, u, fx, fy, v.scale * 1.08, { seed, shape: getUnitType(u.type).shape });
        },
      });
    }
    const flying = new Set((anim.bullets ?? []).map((b) => b.id));
    for (const p of g.projectiles) {
      if (flying.has(p.id)) continue;
      items.push({
        d: at(p.x, p.y) + 0.03, x: p.x,
        draw: () => {
          const [sx, sy] = v.center(p.x, p.y, v.groundHeight(p.x, p.y));
          bullet(ctx, sx, sy - v.scale * 0.55, this.dirAngle(p.x, p.y, p.dir), v.scale, p.id + seed);
        },
      });
    }
    for (const b of anim.bullets ?? []) {
      items.push({
        d: b.py + 0.03, x: 0,
        draw: () => {
          const [sx, sy] = v.project(b.px, b.py, b.h);
          bullet(ctx, sx, sy - v.scale * 0.55, b.angle, v.scale, b.id + seed);
        },
      });
    }
    items.sort((a, b) => a.d - b.d || a.x - b.x);
    for (const it of items) it.draw();
  }

  /** On-screen angle of a hex direction (the iso squash bends it). */
  dirAngle(x, y, dir) {
    const a = DIRECTION_ANGLES[dir];
    return Math.atan2(Math.sin(a) * SQUASH, Math.cos(a));
  }

  pick(sx, sy) {
    return this.view.pick(sx, sy);
  }
}
