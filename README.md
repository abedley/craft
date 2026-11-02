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
  game.js             Game state, order queue, tick(), projectiles
  unitTypes.js        unit type registry (movement + attack abilities)
  orders.js           order constructors + validation (move, shoot)
  resolve.js          simultaneous move / collision resolution
src/ui/               canvas renderer + debug controls
src/scenarios.js      preset boards that exercise collision rules
test/                 node:test suites for the engine
```

## Engine model

- The world is a `width x height` grid of cells; each cell holds at most one unit.
- Every unit has a **type** (`src/engine/unitTypes.js`) that defines its speed, which orders it
  accepts, and what it fires. Ordering a unit to do something its type can't do throws.
- During a turn the player queues orders (`game.queueOrder(unitId, move(x, y))`,
  `game.queueOrder(unitId, shoot('right'))`). Nothing changes until `game.tick()`.
  If a unit gets several orders in one turn, only the last is carried out.
- `tick()`:
  1. applies queued orders in queue order (`shoot` fires immediately, see *Combat*),
  2. moves units in timed **sub-steps** (see *Speed* below); at each sub-step every unit
     due to step picks one orthogonal step toward its target (larger axis gap first,
     x on ties; no pathfinding yet) and those steps are resolved **simultaneously**,
  3. units that reached their target drop their order.
  It returns an event list (`orderApplied`, `moved` with the full `path`, `blocked` with the
  sub-step `time` it first happened, `arrived`, `shot`, `projectileMoved`, `killed`,
  `projectileExpired`).
- Move orders persist across ticks until the unit arrives or gets a new order.
  A blocked unit simply tries again next tick.

### Speed

Each unit has a `speed` (cells per tick, 1–6, default 1): `new Game({ units: [{ x, y, speed: 3 }] })`,
`game.addUnit(x, y, id, { speed })`, `game.setSpeed(id, speed)`.

A unit with speed *s* takes one step at times 1/s, 2/s, …, 1 within the tick. The engine walks
through every distinct step time in order (exactly, using integer math over the lcm of all
speeds). At each instant, the units stepping then are resolved together with the
single-step collision rules below, while everyone else stands still and holds their cell. So:

- "Who got there first" means real arrival time within the tick: a speed-3 unit reaching a cell at
  t=2/3 keeps it against a speed-1 unit arriving at t=1, regardless of order age.
- Units arriving at the *same* instant use the normal contest rule (first ordered wins).
- No unit can jump over or pass through another; a fast unit stuck behind a slow one moves at the
  slow one's pace.
- A blocked unit retries at its own next step time within the same tick.

### Unit types

| Type | Speed | Orders | Notes |
| --- | --- | --- | --- |
| `basic` | 1 | move | default type |
| `gunslinger` | 1 | move, shoot | projectile speed 4 |

`new Game({ units: [{ x, y, type: 'gunslinger' }] })` or `game.addUnit(x, y, id, { type })`. A unit's
speed starts at its type's speed; `speed` / `setSpeed` override it (for debugging and tests).

### Combat

- `shoot(dir)` with `dir` one of `up`, `down`, `left`, `right`. The projectile spawns in the shooter's
  cell at the start of the tick. Shooting cancels the shooter's move order, and the shooter stays put
  that tick.
- Projectiles are on the same sub-step timeline as units (a speed-4 projectile steps at
  t = ¼, ½, ¾, 1). They fly straight, never steer, are never blocked, don't block units, and keep
  going across ticks until they hit something or leave the grid (unlimited range).
- At each instant, after units and projectiles have stepped, a projectile **hits** a unit if they
  share a cell (except a projectile still sitting in its shooter's cell), or if they passed
  through each other that instant. The unit is **killed and removed immediately**, freeing its cell for
  the rest of the tick, and the projectile is used up. Only the first unit in the line is hit.
- Same instant means same outcome for everyone: two gunslingers shooting each other both die.
  Projectiles don't collide with each other.

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

- **Move** mode: tap a unit to select it, tap an empty cell to queue `move(x, y)`.
- **Shoot** mode: tap a gunslinger, then tap any cell or unit to shoot toward it (dominant axis).
- **Add** / **Remove** modes edit the board. The type picker sets the type of added units.
  Gunslingers are drawn as diamonds, basic units as circles.
- **Spd** sets the selected unit's speed, or the speed for newly added units when none is selected.
  Units faster than 1 show their speed in a small badge.
- Projectiles are orange dots with a tail. Queued shots show as a dotted orange ray.
- **Tick** steps once, **Back** restores the pre-tick snapshot, **Auto** ticks until all units are idle.
- **Preview** draws green arrows along next tick's full unit paths, orange arrows for projectiles,
  a red X on units that will be killed, and dashed red rings on units that will be blocked.
- **Scenario** loads preset collision cases.
- Tabs: queued orders, per-tick event log, unit list, and raw state JSON (copy / edit / load).
- `window.debug.game` is available in the browser console.

## Deploying

`.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
