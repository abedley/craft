// Canvas renderer for the board. Purely a view: it reads game state and
// draws; it never mutates the game.

import { Directions as DIRS } from '../engine/index.js';

const COLORS = {
  grid: '#2b323c',
  bg: '#1a1f26',
  selected: '#ffffff',
  activeOrder: 'rgba(255,255,255,0.35)',
  queuedOrder: '#ffd166',
  preview: '#5fd38d',
  blocked: '#ff6b6b',
  projectile: '#ffa94d',
  shotLine: 'rgba(255,169,77,0.8)',
  label: '#0d1014',
};

export const unitColor = (id) => `hsl(${(id * 67) % 360} 65% 60%)`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cell = 0;
    this.size = 0;
  }

  /** Match the canvas backing store to its CSS size and device pixel ratio. */
  resize(game) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.layout(game);
  }

  layout(game) {
    this.cell = Math.floor(Math.min(this.cssW / game.width, this.cssH / game.height));
    this.ox = Math.floor((this.cssW - this.cell * game.width) / 2);
    this.oy = Math.floor((this.cssH - this.cell * game.height) / 2);
  }

  /** Convert a pointer event to a grid cell, or null if outside the grid. */
  cellFromEvent(ev, game) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left - this.ox) / this.cell);
    const y = Math.floor((ev.clientY - rect.top - this.oy) / this.cell);
    return game.inBounds(x, y) ? { x, y } : null;
  }

  center(x, y) {
    return [this.ox + (x + 0.5) * this.cell, this.oy + (y + 0.5) * this.cell];
  }

  /**
   * @param {import('../engine/game.js').Game} game
   * @param {{selectedId:number|null, preview:null|{moved:Map,blocked:Map,projectiles:Array,killed:Set}}} view
   */
  draw(game, { selectedId = null, preview = null } = {}) {
    const { ctx, cell } = this;
    this.layout(game);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // Grid.
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(this.ox, this.oy, cell * game.width, cell * game.height);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= game.width; i++) {
      const px = this.ox + i * cell + 0.5;
      ctx.moveTo(px, this.oy);
      ctx.lineTo(px, this.oy + game.height * cell);
    }
    for (let j = 0; j <= game.height; j++) {
      const py = this.oy + j * cell + 0.5;
      ctx.moveTo(this.ox, py);
      ctx.lineTo(this.ox + game.width * cell, py);
    }
    ctx.stroke();

    // Orders: the last queued order per unit overrides its active order.
    const queued = new Map();
    for (const q of game.queue) queued.set(q.unitId, q.order);
    for (const u of game.units) {
      const pending = queued.get(u.id);
      const order = pending ?? u.order;
      if (!order) continue;
      if (order.type === 'move') {
        this.drawOrderLine(u, order, pending ? COLORS.queuedOrder : COLORS.activeOrder, !!pending);
      } else if (order.type === 'shoot') {
        this.drawShotLine(game, u, order.dir);
      }
    }

    // Preview of the next tick.
    if (preview) {
      for (const path of preview.moved.values()) this.drawPathArrow(path, COLORS.preview);
      for (const path of preview.projectiles) this.drawPathArrow(path, COLORS.projectile);
    }

    // Units.
    const r = cell * 0.36;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(cell * 0.32)}px -apple-system, system-ui, sans-serif`;
    for (const u of game.units) {
      const [cx, cy] = this.center(u.x, u.y);
      ctx.fillStyle = unitColor(u.id);
      ctx.beginPath();
      if (u.type === 'gunslinger') {
        // Gunslingers are diamonds so they read differently from basic units.
        ctx.moveTo(cx, cy - r * 1.15);
        ctx.lineTo(cx + r * 1.15, cy);
        ctx.lineTo(cx, cy + r * 1.15);
        ctx.lineTo(cx - r * 1.15, cy);
        ctx.closePath();
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (u.id === selectedId) {
        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (preview?.blocked.has(u.id)) {
        ctx.strokeStyle = COLORS.blocked;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (preview?.killed.has(u.id)) this.drawCross(cx, cy, r * 1.1, COLORS.blocked);
      ctx.fillStyle = COLORS.label;
      ctx.fillText(String(u.id), cx, cy + 1);
      if (u.speed > 1) this.drawSpeedBadge(cx + r * 0.75, cy - r * 0.75, u.speed);
    }

    // Projectiles: a dot with a short tail pointing back the way it came.
    for (const p of game.projectiles) {
      const [cx, cy] = this.center(p.x, p.y);
      const [dx, dy] = DIRS[p.dir];
      ctx.strokeStyle = COLORS.projectile;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - dx * cell * 0.4, cy - dy * cell * 0.4);
      ctx.stroke();
      ctx.fillStyle = COLORS.projectile;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Dashed ray from a unit to the edge of the grid for a queued shot. */
  drawShotLine(game, u, dir) {
    const { ctx } = this;
    const [dx, dy] = DIRS[dir];
    let ex = u.x;
    let ey = u.y;
    while (game.inBounds(ex + dx, ey + dy)) {
      ex += dx;
      ey += dy;
    }
    const [ax, ay] = this.center(u.x, u.y);
    const [bx, by] = this.center(ex, ey);
    ctx.strokeStyle = COLORS.shotLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx + dx * this.cell * 0.5, by + dy * this.cell * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawCross(cx, cy, m, color) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - m, cy - m); ctx.lineTo(cx + m, cy + m);
    ctx.moveTo(cx + m, cy - m); ctx.lineTo(cx - m, cy + m);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  drawSpeedBadge(x, y, speed) {
    const { ctx, cell } = this;
    const br = cell * 0.15;
    ctx.fillStyle = COLORS.label;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(cell * 0.2)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(String(speed), x, y + 1);
    ctx.restore();
  }

  drawOrderLine(u, order, color, dashed) {
    const { ctx, cell } = this;
    const [ax, ay] = this.center(u.x, u.y);
    const [bx, by] = this.center(order.x, order.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    // Target marker.
    const m = cell * 0.18;
    ctx.beginPath();
    ctx.moveTo(bx - m, by - m); ctx.lineTo(bx + m, by + m);
    ctx.moveTo(bx + m, by - m); ctx.lineTo(bx - m, by + m);
    ctx.stroke();
  }

  /** Polyline through cell centers with an arrowhead on the last segment. */
  drawPathArrow(path, color) {
    if (path.length < 2) return;
    const { ctx, cell } = this;
    const pts = path.map(([x, y]) => this.center(x, y));
    const [ax, ay] = pts[pts.length - 2];
    const [bx, by] = pts[pts.length - 1];
    const ang = Math.atan2(by - ay, bx - ax);
    const tipX = bx - Math.cos(ang) * cell * 0.2;
    const tipY = by - Math.sin(ang) * cell * 0.2;
    const h = cell * 0.18;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length - 1; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX + Math.cos(ang) * h * 0.4, tipY + Math.sin(ang) * h * 0.4);
    ctx.lineTo(tipX - Math.cos(ang - 0.5) * h, tipY - Math.sin(ang - 0.5) * h);
    ctx.lineTo(tipX - Math.cos(ang + 0.5) * h, tipY - Math.sin(ang + 0.5) * h);
    ctx.closePath();
    ctx.fill();
  }
}
