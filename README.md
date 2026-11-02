# Craft

A single-player, turn-based grid game for the mobile browser (built for an
iPhone 13 Pro held vertically), hosted on GitHub Pages.

No build step: plain ES modules served as static files.

## Run locally

```sh
npm run serve        # http://localhost:8000
npm test             # engine unit tests (Node 20+)
```

To try it on a phone, serve on your LAN and open `http://<your-ip>:8000`.

## Layout

```
index.html            debug UI shell
css/style.css         mobile-first styles (safe areas, 44px touch targets)
src/engine/           deterministic game engine (no DOM)
  game.js             Game state, order queue, tick()
  orders.js           order constructors + validation (move(x, y))
  resolve.js          simultaneous move / collision resolution
src/ui/               canvas renderer + debug controls
src/scenarios.js      preset boards that exercise collision rules
test/                 node:test suites for the engine
```

## Engine model

- The world is a `width x height` grid of cells; each cell holds at most one unit.
- During a turn the player queues orders (`game.queueOrder(unitId, move(x, y))`).
  Nothing changes until `game.tick()`.
- `tick()`:
  1. applies queued orders in queue order (a later order for the same unit replaces an earlier one),
  2. each unit with a move order picks one orthogonal step toward its target
     (larger axis gap first, x on ties; no pathfinding yet),
  3. all steps are resolved **simultaneously**,
  4. units that reached their target drop their order.
  It returns an event list (`orderApplied`, `moved`, `blocked`, `arrived`).
- Move orders persist across ticks until the unit arrives or gets a new order.
  A blocked unit simply tries again next tick.

### Collision rules (`src/engine/resolve.js`)

Guiding rule: **whoever got to a cell first keeps it, and the colliding unit doesn't move.**

1. **Contested cell** – several units step into the same empty cell on the same tick: the unit
   whose move order was given first wins (orders are stamped with a sequence number when applied;
   unit id breaks exact ties). The rest don't move.
2. **Swap** – two units try to trade cells: both stay.
3. **Occupied** – a unit standing in a cell keeps it. A unit can enter an occupied cell only if its occupant leaves this tick.
   Propagated to a fixed point, so a line of units moves together if its front is free and
   stops together if not.
4. **Rotation** – closed loops of 3+ units all move.

### Determinism

The engine uses no randomness, clock, or DOM; units are processed in id order; state is
plain JSON. `game.hash()` is an FNV-1a hash of canonical JSON state, shown in the debug
UI header, so two runs with the same orders can be compared at a glance.
`game.snapshot()` / `Game.fromSnapshot()` give exact save/restore.

## Debug UI

- **Order** mode: tap a unit to select it, tap an empty cell to queue `move(x, y)`.
- **Add unit** / **Remove** modes edit the board.
- **Tick** steps once, **Back** restores the pre-tick snapshot, **Auto** ticks until all units are idle.
- **Preview** draws green arrows for next tick's moves and dashed red rings on units that will be blocked.
- **Scenario** loads preset collision cases.
- Tabs: queued orders, per-tick event log, unit list, and raw state JSON (copy / edit / load).
- `window.debug.game` is available in the browser console.

## Deploying

`.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
