// Turn structure for a player-vs-CPU match.
//
// The order queue decides everything (see engine/game.js): when the turn
// ends, the queue runs front to back and each entry happens in full before
// the next. How it's built each turn:
//
//   - It starts empty; projectiles still in flight and builders' channels
//     from last turn are added first, in the order they ran.
//   - New orders join the end, in the order they're given. The CPU stages
//     its whole plan at the start of the turn, so its orders go in before the
//     player's.
//   - Fast orders (quick moves and charges) go to the very front instead.
//   - Nothing reorders the queue afterwards.
//
// Each turn:
//   1. startTurn(): the CPU looks at the board and stages its plan. The plan
//      is visible.
//   2. The player stages orders for their own units (playerOrder()).
//   3. endTurn(): runs the queue (one engine tick), then starts the next turn.
//
// Win / lose: by default, wipe out the other side. A game can also carry an
// objective (game.objective). Supported: { kind: 'escort', unitId, to: [x, y] }
// - the player wins when that unit stands on `to`, and loses if it dies (or
// if all their units do). Wiping out the CPU still wins.
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
    // Escort mission: get one unit to a target hex. Losing it loses the game.
    const obj = this.game.objective;
    if (obj?.kind === 'escort') {
      const vip = this.game.getUnit(obj.unitId);
      if (!vip) return MatchStatus.LOST;
      if (vip.x === obj.to[0] && vip.y === obj.to[1]) return MatchStatus.WON;
    }
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
    // Each order is added like any other: to the end, or to the front if fast.
    for (const [id, order] of plan) g.queueOrder(id, order);
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

  /** Remove the player's new orders this turn (a channel in progress carries on). */
  clearPlayerOrders() {
    this.game.clearQueue(Teams.PLAYER, { keepCarried: true });
  }

  /** Resolve the turn (one tick), then let the CPU stage the next one. */
  endTurn() {
    const events = this.game.tick();
    this.startTurn();
    return events;
  }
}
