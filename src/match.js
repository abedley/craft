// Turn structure for a player-vs-CPU match.
//
// Each turn:
//   1. startTurn(): the CPU looks at the board and stages all of its orders
//      first. They go to the front of the order queue, before any player
//      order, so under the "first ordered wins" collision rule the CPU wins
//      same-instant ties for a cell.
//   2. The player stages orders for their own units (playerOrder()). They
//      can change them freely until the turn ends; the CPU's plan is fixed.
//   3. endTurn(): runs one engine tick, then starts the next turn.
//
// All match state lives in the Game state (the CPU's staged orders are just
// queued orders), so a Game snapshot is a complete save and undo is exact.

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

  /** CPU stages its orders. Does nothing if it already has orders queued. */
  startTurn() {
    if (this.status !== MatchStatus.PLAYING) return [];
    const g = this.game;
    const staged = g.queue.some((q) => g.getUnit(q.unitId)?.team === Teams.CPU);
    if (staged) return [];
    const plan = planTurn(g, Teams.CPU);
    // Put CPU orders ahead of anything already queued (e.g. scenario setup).
    const playerOrders = g.queue;
    g.state.queue = [];
    for (const [id, order] of plan) g.queueOrder(id, order);
    g.state.queue.push(...playerOrders);
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

  clearPlayerOrders() {
    this.game.clearQueue(Teams.PLAYER);
  }

  /** Resolve the turn (one tick), then let the CPU stage the next one. */
  endTurn() {
    const events = this.game.tick();
    this.startTurn();
    return events;
  }
}
