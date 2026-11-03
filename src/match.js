// Turn structure for a player-vs-CPU match.
//
// The order queue decides everything (see engine/game.js): when the turn
// ends, the queue runs front to back and each entry happens in full before
// the next. Its order is:
//
//   1. quick moves (the player's one-time "go first" moves)
//   2. entries carried over from last turn: projectiles still in flight and
//      walks not yet finished, in the order they ran
//   3. the CPU's new orders, which it stages first, at the start of the turn
//   4. the player's new orders
//
// Each turn:
//   1. startTurn(): the CPU looks at the board and stages its plan. Its new
//      orders replace its units' carried-over walks. The plan is visible.
//   2. The player stages orders for their own units (playerOrder()). A new
//      order replaces that unit's carried-over walk. Each player unit has one
//      quick move per match, which goes to the very front.
//   3. endTurn(): runs the queue (one engine tick), then starts the next turn.
//
// All match state lives in the Game state (the CPU's staged orders are just
// queue entries), so a Game snapshot is a complete save and undo is exact.

import { Teams } from './engine/game.js';
import { planTurn } from './ai/cpu.js';

export const MatchStatus = Object.freeze({
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost',
  DRAW: 'draw', // both sides wiped out in the same tick
});

export class Match {
  /**
   * @param {import('./engine/game.js').Game} game
   * @param {{vsCpu?:boolean}} [opts] vsCpu: whether win/loss applies. Defaults
   *   to whether the board has any CPU units.
   */
  constructor(game, { vsCpu } = {}) {
    this.game = game;
    this.vsCpu = vsCpu ?? game.units.some((u) => u.team === Teams.CPU);
  }

  get status() {
    if (!this.vsCpu) return MatchStatus.PLAYING;
    const alive = (team) => this.game.units.some((u) => u.team === team);
    const player = alive(Teams.PLAYER);
    const cpu = alive(Teams.CPU);
    if (!player && !cpu) return MatchStatus.DRAW;
    if (!player) return MatchStatus.LOST;
    if (!cpu) return MatchStatus.WON;
    return MatchStatus.PLAYING;
  }

  /** CPU stages its orders. Does nothing if it already has new orders queued. */
  startTurn() {
    if (this.status !== MatchStatus.PLAYING) return [];
    const g = this.game;
    const isCpu = (e) => e.unitId !== undefined && g.getUnit(e.unitId)?.team === Teams.CPU;
    if (g.queue.some((e) => isCpu(e) && !e.carried)) return [];
    const plan = planTurn(g, Teams.CPU);
    const replaced = new Set(plan.map(([id]) => id));
    const keep = g.queue.filter((e) => !(isCpu(e) && replaced.has(e.unitId)));
    const quick = keep.filter((e) => e.order?.quick);
    const carried = keep.filter((e) => e.carried);
    const playerNew = keep.filter((e) => !e.carried && !e.order?.quick);
    g.state.queue = [];
    for (const [id, order] of plan) g.queueOrder(id, order);
    g.state.queue = [...quick, ...carried, ...g.state.queue, ...playerNew];
    return plan;
  }

  /** Stage an order for one of the player's units. */
  playerOrder(unitId, order) {
    const unit = this.game.getUnit(unitId);
    if (!unit) throw new Error(`No unit with id ${unitId}`);
    if (unit.team !== Teams.PLAYER) throw new Error(`Unit ${unitId} belongs to the CPU`);
    if (this.status !== MatchStatus.PLAYING) throw new Error('The match is over');
    this.game.queueOrder(unitId, order);
  }

  /** Remove the player's new orders this turn (carried-over walks stay). */
  clearPlayerOrders() {
    this.game.clearQueue(Teams.PLAYER, { newOnly: true });
  }

  /** Resolve the turn (one tick), then let the CPU stage the next one. */
  endTurn() {
    const events = this.game.tick();
    this.startTurn();
    return events;
  }
}
