// Canvas renderer for the board. Purely a view: it reads game state and
// draws; it never mutates the game.

const COLORS = {
  grid: '#2b323c',
  bg: '#1a1f26',
  selected: '#ffffff',
  activeOrder: 'rgba(255,255,255,0.35)',
  queuedOrder: '#ffd166',
  preview: '#5fd38d',
  blocked: '#ff6b6b',
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
   * @param {{selectedId:number|null, preview:null|{moved:Map,blocked:Map}}} view
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
      if (!order || order.type !== 'move') continue;
      this.drawOrderLine(u, order, pending ? COLORS.queuedOrder : COLORS.activeOrder, !!pending);
    }

    // Preview of the next tick.
    if (preview) {
      for (const [id, to] of preview.moved) {
        const u = game.getUnit(id);
        if (u) this.drawArrow(u.x, u.y, to[0], to[1], COLORS.preview);
      }
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
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
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
      ctx.fillStyle = COLORS.label;
      ctx.fillText(String(u.id), cx, cy + 1);
    }
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

  drawArrow(x0, y0, x1, y1, color) {
    const { ctx, cell } = this;
    const [ax, ay] = this.center(x0, y0);
    const [bx, by] = this.center(x1, y1);
    const ang = Math.atan2(by - ay, bx - ax);
    const tipX = bx - Math.cos(ang) * cell * 0.2;
    const tipY = by - Math.sin(ang) * cell * 0.2;
    const h = cell * 0.18;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
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
