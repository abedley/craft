// Debug UI: wires the DOM controls to a Game instance.
//
// Interaction model (touch first):
//   Move mode    - tap a unit to select it, tap an empty cell to queue
//                  move(x,y) for the selected unit. Tap the selected unit
//                  again to deselect.
//   Attack mode  - tap one of your units to select it, then tap any cell
//                  (including a target unit) to queue attack() toward it,
//                  snapped to the nearest direction that unit type allows.
//   Add mode     - tap an empty cell to spawn a unit of the chosen type.
//   Speed        - with a unit selected, sets that unit's speed (cells per
//                  tick); otherwise sets the speed used for new units.
//   Remove mode  - tap a unit to delete it.
//   Paint mode   - pick a terrain type, then tap or drag across hexes to
//                  paint it (water can't be painted under a unit).
//
// Turns: the CPU stages its orders as soon as a turn starts. The player then
// orders their own (blue) units and taps "End turn", which runs the queue
// front to back (the Queue tab shows that order) and starts the next turn. Editing the board
// makes the CPU re-plan. "Back" restores the snapshot taken just before the
// last "End turn", including both sides' staged orders (an exact undo).

import { Game, Teams, MAX_SPEED, move, quickMove, charge, chargePlan, ALL_DIRECTIONS, attack, TerrainTypes, DEFAULT_TERRAIN, DIRECTION_ANGLES, UnitTypes, DEFAULT_UNIT_TYPE } from '../engine/index.js';
import { Match, MatchStatus } from '../match.js';
import { Renderer } from './renderer.js';
import { scenarios } from '../scenarios.js';

const AUTO_INTERVAL_MS = 350;
const $ = (sel) => document.querySelector(sel);

export class DebugUI {
  constructor() {
    this.renderer = new Renderer($('#board'));
    this.mode = 'move';
    this.selectedId = null;
    this.history = []; // [{ snapshot, tick, events }] - state before each tick
    this.log = []; // [{ tick, events }]
    this.autoTimer = null;
    this.tab = 'queue';
    this.newUnitType = DEFAULT_UNIT_TYPE;
    this.newUnitSpeed = UnitTypes[DEFAULT_UNIT_TYPE].speed;
    this.newUnitTeam = Teams.PLAYER;
    this.paintTerrain = DEFAULT_TERRAIN;
    this.painting = false;

    this.populateScenarios();
    this.populateSpeeds();
    this.populateTypes();
    this.populateTeams();
    this.populateTerrain();
    this.bind();
    this.loadScenario(Object.keys(scenarios)[0]);
    this.renderer.resize(this.game);
    this.render();
  }

  // ---- setup -------------------------------------------------------------

  populateScenarios() {
    const sel = $('#scenario');
    for (const name of Object.keys(scenarios)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.append(opt);
    }
  }

  populateSpeeds() {
    const sel = $('#speed');
    for (let v = 1; v <= MAX_SPEED; v++) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = `Speed ${v}`;
      sel.append(opt);
    }
    sel.addEventListener('change', () => this.onSpeedTap(Number(sel.value)));
  }

  populateTeams() {
    const sel = $('#unit-team');
    for (const [value, label] of [[Teams.PLAYER, 'You'], [Teams.CPU, 'CPU']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      sel.append(opt);
    }
    sel.addEventListener('change', () => {
      this.newUnitTeam = sel.value;
      if (this.mode !== 'add') this.setMode('add');
      this.hint(`New units join ${sel.value === Teams.CPU ? 'the CPU' : 'your team'}. Tap an empty cell.`);
    });
  }

  populateTerrain() {
    const row = $('#terrain-row');
    for (const def of Object.values(TerrainTypes)) {
      const btn = document.createElement('button');
      btn.dataset.terrain = def.key;
      btn.innerHTML = `<span class="swatch" style="background:${def.color}"></span>${def.name}`;
      btn.addEventListener('click', () => {
        this.paintTerrain = def.key;
        this.hint(`Painting ${def.name}${def.walkable ? '' : ' (units can\'t walk on it)'}. Tap or drag on the board.`);
        this.render();
      });
      row.append(btn);
    }
  }

  /** Paint one hex; returns true if it changed. */
  paintAt(x, y) {
    if (this.game.terrainAt(x, y) === this.paintTerrain) return false;
    try {
      this.game.setTerrain(x, y, this.paintTerrain);
      return true;
    } catch (err) {
      this.hint(err.message, true);
      return false;
    }
  }

  /** Swap in a (new or restored) game and wrap it in a match. */
  setGame(game, vsCpu) {
    this.game = game;
    this.match = new Match(game, { vsCpu });
  }

  /** After a board edit, throw away the CPU's plan and let it plan again. */
  replanCpu() {
    this.game.clearQueue(Teams.CPU);
    this.match.vsCpu ||= this.game.units.some((u) => u.team === Teams.CPU);
    this.match.startTurn();
  }

  populateTypes() {
    const sel = $('#unit-type');
    for (const [key, def] of Object.entries(UnitTypes)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = def.name;
      sel.append(opt);
    }
    sel.value = this.newUnitType;
    sel.addEventListener('change', () => {
      this.newUnitType = sel.value;
      this.newUnitSpeed = UnitTypes[sel.value].speed;
      if (this.mode !== 'add') this.setMode('add');
      this.hint(`New units: ${UnitTypes[sel.value].name}, speed ${this.newUnitSpeed}. Tap an empty cell.`);
      this.render();
    });
  }

  onSpeedTap(v) {
    if (this.selectedId !== null) {
      this.game.setSpeed(this.selectedId, v);
      this.replanCpu();
      this.hint(`Unit ${this.selectedId} speed set to ${v}.`);
    } else {
      this.newUnitSpeed = v;
      this.hint(`New units will have speed ${v}.`);
    }
    this.render();
  }

  bind() {
    $('#board').addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const cell = this.renderer.cellFromEvent(ev, this.game);
      if (this.mode === 'paint') {
        this.painting = true;
        ev.target.setPointerCapture?.(ev.pointerId);
      }
      if (cell) this.onCellTap(cell.x, cell.y);
    });
    // Drag to paint terrain.
    $('#board').addEventListener('pointermove', (ev) => {
      if (!this.painting || this.mode !== 'paint') return;
      const cell = this.renderer.cellFromEvent(ev, this.game);
      if (cell && this.paintAt(cell.x, cell.y)) this.render();
    });
    const stopPainting = () => {
      if (!this.painting) return;
      this.painting = false;
      this.replanCpu(); // terrain changes what the CPU can do
      this.render();
    };
    $('#board').addEventListener('pointerup', stopPainting);
    $('#board').addEventListener('pointercancel', stopPainting);

    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab));
    });

    $('#btn-tick').addEventListener('click', () => this.tick());
    $('#btn-back').addEventListener('click', () => this.back());
    $('#btn-auto').addEventListener('click', () => this.toggleAuto());
    $('#btn-clear').addEventListener('click', () => {
      this.match.clearPlayerOrders();
      this.render();
    });
    $('#chk-preview').addEventListener('change', () => this.render());
    $('#scenario').addEventListener('change', (ev) => this.loadScenario(ev.target.value));
    $('#btn-copy').addEventListener('click', () => this.copyState());
    $('#btn-load').addEventListener('click', () => this.loadStateFromText());

    window.addEventListener('resize', () => {
      this.renderer.resize(this.game);
      this.render();
    });
  }

  // ---- actions -----------------------------------------------------------

  loadScenario(name) {
    this.stopAuto();
    this.setGame(scenarios[name]());
    this.match.startTurn();
    $('#scenario').value = name;
    this.resetSession();
    this.hint(`Loaded "${name}".`);
  }

  resetSession() {
    this.selectedId = null;
    this.history = [];
    this.log = [];
    this.renderer.resize(this.game);
    this.render();
  }

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (mode === 'add' || mode === 'remove' || mode === 'paint') this.selectedId = null;
    $('#terrain-row').hidden = mode !== 'paint';
    $('#unit-row').hidden = mode === 'paint';
    if (mode === 'attack' && this.selectedId !== null && !this.attackOrder(this.game.getUnit(this.selectedId))) {
      this.selectedId = null;
    }
    if (mode === 'quick' && this.selectedId !== null && !(this.game.getUnit(this.selectedId)?.quickMoves > 0)) {
      this.selectedId = null;
    }
    if (mode === 'charge' && this.selectedId !== null && !(this.game.getUnit(this.selectedId)?.charges > 0)) {
      this.selectedId = null;
    }
    this.hint({
      move: 'Tap a unit to select it, then tap a cell to queue a move.',
      quick: 'Quick move (once per unit): steps first, before shots fly, and wins ties. Tap a unit, then a hex.',
      charge: 'Charge (pikemen, once each): rush up to 3 hexes in a straight line, then strike. Goes first. Tap a pikeman, then a direction.',
      attack: 'Tap one of your units, then tap a cell or unit to attack toward it.',
      add: 'Tap an empty cell to add a unit.',
      remove: 'Tap a unit to remove it.',
      paint: 'Pick a terrain, then tap or drag across hexes to paint it.',
    }[mode]);
    this.render();
  }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    for (const t of ['queue', 'log', 'units', 'state']) $(`#tab-${t}`).hidden = t !== tab;
    this.renderPanel();
  }

  onCellTap(x, y) {
    const unit = this.game.unitAt(x, y);
    try {
      switch (this.mode) {
        case 'add':
          if (unit) return this.hint(`Cell ${x},${y} is occupied.`, true);
          this.game.addUnit(x, y, undefined, { type: this.newUnitType, team: this.newUnitTeam, speed: this.newUnitSpeed });
          this.replanCpu();
          this.hint(`Added ${this.newUnitTeam === Teams.CPU ? 'CPU' : 'your'} ${UnitTypes[this.newUnitType].name} at ${x},${y}.`);
          break;
        case 'paint':
          this.paintAt(x, y);
          break;
        case 'remove':
          if (!unit) return;
          this.game.removeUnit(unit.id);
          this.replanCpu();
          this.hint(`Removed unit ${unit.id}.`);
          break;
        case 'attack': {
          const sel = this.selectedId !== null ? this.game.getUnit(this.selectedId) : null;
          if (unit && unit.id === this.selectedId) {
            this.selectedId = null;
            this.hint('Deselected.');
          } else if (sel && this.attackOrder(sel)) {
            const order = this.attackOrder(sel)(x, y);
            this.match.playerOrder(sel.id, order);
            const enemy = UnitTypes[sel.type].attack.blockedByAdjacentEnemy ? this.game.adjacentEnemy(sel) : null;
            if (enemy) {
              this.hint(`Queued: unit ${sel.id} ${fmtOrder(order)}, but enemy #${enemy.id} is next to it: the shot will fail unless that changes first.`, true);
            } else {
              this.hint(`Queued: unit ${sel.id} ${fmtOrder(order)}.`);
            }
          } else if (unit && unit.team === Teams.CPU) {
            this.hint(`Unit ${unit.id} is a CPU unit.`, true);
            return;
          } else if (unit && this.attackOrder(unit)) {
            this.selectedId = unit.id;
            this.hint(`Unit ${unit.id} selected. Tap a cell to attack toward it.`);
          } else if (unit) {
            this.hint(`Unit ${unit.id} (${UnitTypes[unit.type].name}) can't attack.`, true);
            return;
          }
          break;
        }
        case 'charge': {
          // Like Attack mode: select a pikeman, then tap any hex or unit to
          // charge in that direction.
          const sel = this.selectedId !== null ? this.game.getUnit(this.selectedId) : null;
          if (unit && unit.id === this.selectedId) {
            this.selectedId = null;
            this.hint('Deselected.');
          } else if (sel && sel.charges > 0) {
            const def = UnitTypes[sel.type];
            const dir = nearestDirection(this.renderer, sel, x, y, def.attack?.directions ?? ALL_DIRECTIONS);
            this.match.playerOrder(sel.id, charge(dir));
            const plan = chargePlan(this.game, sel, dir);
            const ends = plan.reason === 'collided' ? `into #${plan.by}` : plan.reason === 'terrain' ? 'until blocked' : `${plan.path.length - 1} hexes`;
            this.hint(`Queued: unit ${sel.id} CHARGE ${dir} (${ends}, then strikes), at the front of the queue.`);
          } else if (unit && unit.team === Teams.CPU) {
            this.hint(`Unit ${unit.id} is a CPU unit.`, true);
            return;
          } else if (unit && !UnitTypes[unit.type].charge) {
            this.hint(`${UnitTypes[unit.type].name} units can't charge.`, true);
            return;
          } else if (unit && !(unit.charges > 0)) {
            this.hint(`Unit ${unit.id} has already used its charge.`, true);
            return;
          } else if (unit) {
            this.selectedId = unit.id;
            this.hint(`Unit ${unit.id} selected. Tap toward where it should charge (straight line, up to ${UnitTypes[unit.type].charge.distance} hexes, then it strikes).`);
          }
          break;
        }
        case 'move':
        case 'quick':
        default: {
          const quick = this.mode === 'quick';
          if (unit && unit.id === this.selectedId) {
            this.selectedId = null;
            this.hint('Deselected.');
          } else if (unit && unit.team === Teams.CPU) {
            this.hint(`Unit ${unit.id} is a CPU unit${this.game.orderFor(unit.id) ? ` (${fmtOrder(this.game.orderFor(unit.id))})` : ''}.`);
          } else if (unit && quick && !(unit.quickMoves > 0)) {
            this.hint(`Unit ${unit.id} has already used its quick move.`, true);
            return;
          } else if (unit) {
            this.selectedId = unit.id;
            this.hint(`Unit ${unit.id} selected. Tap a cell to ${quick ? 'quick move (goes first)' : 'move'}.`);
          } else if (this.selectedId !== null) {
            const order = quick ? quickMove(x, y) : move(x, y);
            this.match.playerOrder(this.selectedId, order);
            this.hint(`Queued: unit ${this.selectedId} ${fmtOrder(order)}${quick ? ' at the front of the queue' : ''}.`);
          }
        }
      }
    } catch (err) {
      this.hint(err.message, true);
    }
    this.render();
  }

  /** For a unit that can attack: a function (x, y) -> attack order toward that cell. */
  attackOrder(unit) {
    if (!unit) return null;
    const def = UnitTypes[unit.type];
    if (!def.attack) return null;
    return (x, y) => attack(nearestDirection(this.renderer, unit, x, y, def.attack.directions));
  }

  tick() {
    const before = this.game.snapshot();
    const tick = this.game.tickCount;
    const events = this.match.endTurn();
    this.history.push({ snapshot: before });
    this.log.push({ tick, events });
    const count = (type) => events.filter((e) => e.type === type).length;
    const killed = count('killed');
    const status = this.match.status;
    const outcome = { won: ' You win!', lost: ' You lose.', draw: ' Draw: both sides wiped out.' }[status] ?? '';
    this.hint(`Turn ${tick}: ${count('moved')} moved, ${count('blocked')} blocked${killed ? `, ${killed} killed` : ''}.${outcome}`);
    if (status !== MatchStatus.PLAYING) this.stopAuto();
    if (this.selectedId !== null && !this.game.getUnit(this.selectedId)) this.selectedId = null;
    this.render();
    return events;
  }

  back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.stopAuto();
    this.setGame(Game.fromSnapshot(prev.snapshot), this.match.vsCpu);
    this.log.pop();
    if (this.selectedId !== null && !this.game.getUnit(this.selectedId)) this.selectedId = null;
    this.hint(`Rewound to tick ${this.game.tickCount}.`);
    this.render();
  }

  toggleAuto() {
    if (this.autoTimer) return this.stopAuto();
    $('#btn-auto').classList.add('on');
    this.autoTimer = setInterval(() => {
      // Stop once nothing is left to do.
      const g = this.game;
      if (this.match.status !== MatchStatus.PLAYING) return this.stopAuto();
      if (g.queue.length === 0 && g.projectiles.length === 0) {
        this.stopAuto();
        this.hint('Auto stopped: nothing moving.');
        return;
      }
      this.tick();
    }, AUTO_INTERVAL_MS);
  }

  stopAuto() {
    clearInterval(this.autoTimer);
    this.autoTimer = null;
    $('#btn-auto').classList.remove('on');
  }

  async copyState() {
    const text = JSON.stringify(this.game.snapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.hint('State copied to clipboard.');
    } catch {
      const ta = $('#state-json');
      ta.focus();
      ta.select();
      this.hint('Clipboard unavailable; text selected.', true);
    }
  }

  loadStateFromText() {
    try {
      const snap = JSON.parse($('#state-json').value);
      this.stopAuto();
      this.setGame(Game.fromSnapshot(snap));
      this.match.startTurn();
      this.resetSession();
      this.hint('State loaded.');
    } catch (err) {
      this.hint(`Load failed: ${err.message}`, true);
    }
  }

  hint(text, isError = false) {
    const el = $('#hint');
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  // ---- rendering ---------------------------------------------------------

  /** Run the next tick on a throwaway clone to show what will happen. */
  computePreview() {
    if (!$('#chk-preview').checked) return null;
    const events = this.game.clone().tick();
    const moved = new Map();
    const blocked = new Map();
    const projectiles = [];
    const killed = new Set();
    const attackBlocked = new Set();
    for (const e of events) {
      if (e.type === 'moved') moved.set(e.unitId, e.path);
      if (e.type === 'blocked') blocked.set(e.unitId, e.reason);
      if (e.type === 'projectileMoved') projectiles.push(e.path);
      if (e.type === 'killed') killed.add(e.unitId);
      if (e.type === 'attackBlocked') attackBlocked.add(e.unitId);
    }
    return { moved, blocked, projectiles, killed, attackBlocked };
  }

  render() {
    const g = this.game;
    $('#tick').textContent = g.tickCount;
    const status = this.match.status;
    $('#status').textContent = { playing: '', won: 'YOU WIN', lost: 'YOU LOSE', draw: 'DRAW' }[status];
    $('#status').className = `outcome ${status}`;
    $('#btn-tick').disabled = status !== MatchStatus.PLAYING;
    $('#queue-count').textContent = g.queue.length;
    $('#hash').textContent = g.hash();
    $('#btn-back').disabled = this.history.length === 0;
    const selected = this.selectedId !== null ? g.getUnit(this.selectedId) : null;
    const shownSpeed = selected ? selected.speed : this.newUnitSpeed;
    $('#speed').value = String(shownSpeed);
    document.querySelectorAll('[data-terrain]').forEach((b) => b.classList.toggle('active', b.dataset.terrain === this.paintTerrain));
    this.renderer.draw(g, { selectedId: this.selectedId, preview: this.computePreview() });
    this.renderPanel();
  }

  renderPanel() {
    const g = this.game;
    switch (this.tab) {
      case 'queue': {
        const el = $('#tab-queue');
        el.innerHTML = g.queue.length
          ? g.queue.map((q, i) => fmtEntry(g, q, i)).join('')
          : '<div class="empty">Queue is empty. Orders run on the next tick.</div>';
        break;
      }
      case 'log': {
        const el = $('#tab-log');
        if (!this.log.length) {
          el.innerHTML = '<div class="empty">No ticks yet.</div>';
          break;
        }
        // Newest first.
        el.innerHTML = [...this.log].reverse().map(({ tick, events }) => (
          `<div class="tick-head">tick ${tick}</div>` +
          (events.length ? events.map(fmtEvent).join('') : '<div class="meta">(nothing happened)</div>')
        )).join('');
        break;
      }
      case 'units': {
        const el = $('#tab-units');
        const projLines = g.projectiles.map((p) => `<div class="shot">projectile ${p.id} @ ${p.x},${p.y} → ${p.dir} (from #${p.ownerId})</div>`).join('');
        el.innerHTML = projLines + (g.units.length
          ? g.units.map((u) => `<div class="${teamClass(u)}">${teamLabel(u)} #${u.id} ${UnitTypes[u.type].name} @ ${u.x},${u.y} spd ${u.speed}${u.quickMoves > 0 ? ' ⚡' : ''}${u.charges > 0 ? ' »' : ''} ${g.orderFor(u.id) ? fmtOrder(g.orderFor(u.id)) : '<span class="meta">idle</span>'}</div>`).join('')
          : '<div class="empty">No units.</div>');
        break;
      }
      case 'state': {
        const ta = $('#state-json');
        if (document.activeElement !== ta) ta.value = JSON.stringify(g.snapshot(), null, 2);
        break;
      }
    }
  }
}

/** One line of the Queue tab. */
function fmtEntry(g, e, i) {
  if (e.projectileId !== undefined) {
    const p = g.getProjectile(e.projectileId);
    return `<div class="shot">${i + 1}. projectile ${e.projectileId} keeps flying ${p ? p.dir : ''} (from #${p?.ownerId})</div>`;
  }
  const u = g.getUnit(e.unitId);
  const tag = e.order.quick || e.order.type === 'charge' ? 'goes first' : e.carried ? 'continuing' : 'new';
  return `<div class="${teamClass(u)}">${i + 1}. ${teamLabel(u)} #${e.unitId} ${fmtOrder(e.order)} <span class="meta">${tag}</span></div>`;
}

function teamLabel(u) {
  return u?.team === Teams.CPU ? 'CPU' : 'You';
}

function teamClass(u) {
  return u?.team === Teams.CPU ? 'team-cpu' : 'team-player';
}

function fmtOrder(o) {
  if (o.type === 'move') return `${o.quick ? 'QUICK ' : ''}move(${o.x}, ${o.y})`;
  if (o.type === 'charge') return `CHARGE ${o.dir}`;
  if (o.type === 'attack') return `attack(${o.dir})`;
  return o.type;
}

// Tie-break when a tap is exactly between two allowed directions.
const TAP_PRIORITY = ['up', 'down', 'up-right', 'down-right', 'down-left', 'up-left'];

/**
 * The allowed hex direction closest in angle to the on-screen line from a
 * unit to a tapped cell (angles are measured on screen, since hex rows are
 * staggered).
 */
function nearestDirection(renderer, u, x, y, allowed) {
  const [ax, ay] = renderer.center(u.x, u.y);
  const [bx, by] = renderer.center(x, y);
  const target = Math.atan2(by - ay, bx - ax);
  let best = null;
  for (const dir of TAP_PRIORITY.filter((d) => allowed.includes(d))) {
    let diff = Math.abs(target - DIRECTION_ANGLES[dir]);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (!best || diff < best.diff - 1e-9) best = { dir, diff };
  }
  return best.dir;
}

function fmtEvent(e) {
  switch (e.type) {
    case 'moved': return `<div class="moved">#${e.unitId} ${e.path.map((p) => p.join(',')).join(' → ')}</div>`;
    case 'blocked': return `<div class="blocked">#${e.unitId} blocked at ${e.at} (${e.reason}${e.by != null ? ` by #${e.by}` : ''})</div>`;
    case 'arrived': return `<div class="arrived">#${e.unitId} arrived at ${e.at}</div>`;
    case 'orderStarted': return `<div class="meta">${e.step}. #${e.unitId} ${fmtOrder(e.order)}${e.carried ? ' (continued)' : ''}</div>`;
    case 'quickMove': return `<div class="quick">#${e.unitId} used its quick move (${e.remaining} left)</div>`;
    case 'charge': return `<div class="charge">#${e.unitId} charges ${e.dir}! (${e.remaining} left)</div>`;
    case 'chargeEnded': return `<div class="charge">#${e.unitId}'s charge ${e.reason === 'collided' ? `hit #${e.by}` : e.reason === 'terrain' ? 'was stopped by terrain / the edge' : 'went the full distance'}</div>`;
    case 'shot': return `<div class="shot">#${e.unitId} fired projectile ${e.projectileId} ${e.dir} from ${e.from}</div>`;
    case 'projectileMoved': return `<div class="shot">projectile ${e.projectileId} ${e.path.map((p) => p.join(',')).join(' → ')}</div>`;
    case 'projectileExpired': return `<div class="meta">projectile ${e.projectileId} is gone (left the board or out of range)</div>`;
    case 'attackBlocked': return `<div class="blocked">#${e.unitId} can't shoot: enemy #${e.by} is next to it</div>`;
    case 'strike': return `<div class="shot">#${e.unitId} struck ${e.dir} at ${e.cells.map((c) => c.join(',')).join(' and ') || '(off the board)'}</div>`;
    case 'killed': {
      const how = e.hits.map((h) => (h.cause === 'melee' ? `strike of #${h.attackerId}` : `projectile ${h.sourceId} (#${h.attackerId})`)).join(' + ');
      return `<div class="killed">${e.team === Teams.CPU ? 'CPU' : 'Your'} #${e.unitId} KILLED at ${e.at} by ${how}</div>`;
    }
    default: return `<div class="meta">${e.type} ${JSON.stringify(e)}</div>`;
  }
}
