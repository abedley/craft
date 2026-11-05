# Craft

A single-player, turn-based hex-grid game for the mobile browser (built for an
iPhone 13 Pro held vertically), hosted on GitHub Pages.

No build step: plain ES modules served as static files.

- **The game** is `index.html`: a single-player campaign, played on an isometric, monochrome
  pixel-art board.
- **The debug UI** is `debug.html`: a flat board with editing tools, every scenario, and an
  event log.

## Run locally

```sh
npm run serve        # http://localhost:8000 (game), /debug.html (debug UI)
npm test             # unit tests (Node 20+)
```

To try it on a phone, serve on your LAN and open `http://<your-ip>:8000`.

## Layout

```
index.html            the game shell
debug.html            debug UI shell
css/game.css          the game's dark pixel-panel styles
css/style.css         debug UI styles (safe areas, 44px touch targets)
src/engine/           deterministic game engine (no DOM)
  game.js             Game state, order queue, tick(), projectiles
  hex.js              hex grid geometry (directions, distance, lines)
  unitTypes.js        loads + validates unit definitions from JSON
  terrain.js          loads + validates terrain definitions from JSON
  orders.js           order constructors + validation (move, attack)
src/data/units.json   unit definitions (add new units here)
src/data/terrain.json terrain definitions (add new terrain here)
src/data/campaign.json campaign levels (add new levels here)
src/match.js          turn structure: CPU stages orders, player orders, end turn
src/ai/cpu.js         deterministic CPU opponent
src/ui/               debug UI: flat canvas renderer + debug controls
src/app/              the game UI
  main.js             boot + screen router (title -> campaign -> battle)
  campaign.js         level list + saved progress (localStorage)
  screens/            title / campaign screens, the battle screen
  battleView.js       draws each frame into a small art buffer and scales it up crisply;
                      camera (fit / zoom / pan) in whole device pixels
  pixel/grid.js       integer hex geometry: tile masks, elevations, picking (no DOM)
  pixel/raster.js     pixel primitives: dithers, lines, hex faces, 3x5 bitmap font
  pixel/sprites.js    unit and prop sprites, written as text
  pixel/draw.js       terrain, units, intents, markers and playback effects
  controls.js         tap / pan / pinch gestures
  shared.js           helpers used by both UIs (direction snapping, preview, paths)
src/scenarios.js      preset boards: matches and rule demos
test/                 node:test suites (engine, campaign, iso view)
```

## The game

Portrait only, built for an iPhone 13 Pro in Safari. Monochrome pixel art: two tones (a warm
light and a soft charcoal) plus dithering, on dark bevelled panels. The board is drawn at a low
"art" resolution (about 180 x 170 pixels for the escort map) and scaled up by a whole number of
device pixels, so every pixel is a crisp, equal square. Hexes are a fixed 20 x 16 pixel mask on a
2:1 slope that tiles exactly; terrain height is a few pixels of elevation. Units idle with a
1-pixel bob; your units are light with a ring base, the CPU's are dark on a solid base.

- **Title → Campaign → Battle → Result.** The campaign is a list of levels; a level opens when the
  one before it is cleared. Progress is saved in `localStorage` (or kept for the session if
  storage is blocked).
- **The board** is isometric: hexes are prisms whose height comes from their terrain (visual only:
  water sits low, grass and forest high; buildings add a storey and units stand on the roof).
  Drag to pan, pinch to zoom (0.8–2.5×), ⌖ recenters.
- **The enemy's plan is always on the board**, as in Into the Breach: heavy dashed arrows for its
  moves, crosshairs on hexes it will strike or shoot, a dotted ray for shots (solid for this turn's
  4 hexes), arcs for teleports and dashed outlines for builds. Its moves are drawn thin and light so
  its attacks stand out, and every hex that will be struck or shot this turn is **hatched**. The
  **turn-order strip** under the board lists the queue in run order; **hold it** to put a numbered
  badge on every order on the board (dark for the CPU, white for you; a double ring for fast
  entries). Selecting a unit (or tapping its chip) shows just its badge and fades the other orders. A **✕** on a unit means it dies
  if the turn runs as things stand (the turn is simulated on a copy).
- **Giving orders:** tap one of your units (white). The unit card shows its stats and order; the
  hexes it can reach are outlined. Pick **Move**, **ϟ Quick**, **Strike / Shoot**, or its ability
  (**» Charge**, **⇢ Teleport**, **▣ Build**), then tap the board. Attacks and charges snap to the hex
  direction nearest the tap. **✕** cancels the unit's order. Tap an enemy (black) to read its card.
- **End Turn** runs the queue: each entry plays back in order (moves, shots, strikes, mines,
  buildings going up), with its chip highlighted. Tap the board to speed it up. **Undo turn** goes
  back to just before the last End Turn (both sides' orders included).
- **Win / lose** comes from `Match#status`; the result screen offers undo, retry and the campaign.
- `window.craft` is the app in the browser console; `craft.screen.api` drives the battle (`select`,
  `action`, `tapHex`, `endTurn`, `match`).

### Campaign levels (`src/data/campaign.json`)

```json
{ "id": "escort-1", "title": "The Bridge", "scenario": "Escort the builder",
  "goal": "Get the builder ★ to the flag ⚑", "brief": "…", "tips": ["…"] }
```

`scenario` names a board in `src/scenarios.js` (its units, terrain and objective). Levels play in
file order. Fonts: Silkscreen and Pixelify Sans from Google Fonts (monospace fallback); text on
the board uses a built-in 3x5 bitmap font.


## Turns and teams

**The CPU's plan is visible, and that is a core mechanic:** the CPU commits to its orders first and you
see all of them (pink lines, shot rays and strike zones, plus the Queue tab) before you decide.

The game is played by two teams: the player (blue) and the CPU (pink). Every unit has a `team`
(`'player'` default, or `'cpu'`). **Friendly fire is on**: projectiles hit whatever unit is in their way.

Each turn (`src/match.js`):

1. **The CPU stages all of its orders first** (`match.startTurn()`), looking only at the board as it
   stands. Its new orders go ahead of the player's in the queue (see *The queue* below), so they
   happen first.
2. The player stages orders for their own units (`match.playerOrder()`); the CPU's plan is fixed.
   The player cannot order CPU units.
3. **End turn** (`match.endTurn()`) runs the queue, then the CPU stages the next turn.

### Quick move

Each of the player's units has **one quick move per match** (`quickMove(x, y)`; CPU units have none).
It's a move order that goes to the **very front of the queue** when you give it, so it happens
before everything already queued, including the CPU's orders and shots still in flight. That's how it **saves a unit from a
gunslinger shot that would land this turn**: the unit has stepped off the shot's line before the
shot is fired. A normal move comes after the CPU's orders, too late. Stepping along the shot's
line doesn't help; you have to step off it. It goes as far as a normal move: up to the unit's
speed.

- It's only used up when the turn runs. Replacing it with another order or clearing it first
  costs nothing.
- A unit has at most one queued order; queueing a new one replaces the old one.
- `unit.quickMoves` holds how many are left. The `quickMove` event reports when one is spent.

`match.status` is `playing`, `won` (no CPU units left), `lost` (no player units left) or `draw` (both
wiped out in the same tick). Boards with no CPU units are sandboxes and never end.

**Missions:** a board can carry an objective (`new Game({ ..., objective })`, kept in the saved
state). The one supported so far is an **escort**:
`{ kind: 'escort', unitId: 1, to: [3, 0] }`. You **win** when that unit stands on the target hex, and
**lose** if it dies (wiping out the CPU still wins). The CPU treats the escorted unit as its priority
target: it shoots it first when it has a line, and heads for it rather than the nearest unit. The
board shows the target hex with a gold flag and the escorted unit with a gold star.

### Charge (pikemen)

Pikemen have a **charge** (`charge(dir)`): they rush **in a straight line** in one of the 6 hex
directions, up to **3 hexes**, and then **strike in that same direction**. Like a quick move it goes
to the **front of the queue**. Each pikeman can charge **once per match**.

- **Collides with a unit:** the charge stops in the hex before it, and the strike hits that unit
  (and the hex behind it, the pike's normal reach of 2). Friendly fire applies: charging into a
  teammate strikes it.
- **Nothing in the way:** it goes the full 3 hexes and strikes the 2 hexes ahead.
- **Water or the board edge:** it stops there and still strikes ahead (strikes ignore terrain).
- **A shot in flight in its path:** the pikeman is hit and never strikes.
- It's a single queue entry; nothing carries over to the next turn.
- **Front of the queue:** a charge is added to the very front. A fast order added after it (e.g.
  your quick move, given after the CPU staged its charge) goes in front of it.
- **Cost:** it's used up only when it runs; replacing or clearing it first costs nothing.
- **Defined in the unit JSON:** `"charge": { "distance": 3, "uses": 1 }` on the pikeman. Any unit
  type can have one; the charge ends with that type's attack. `chargePlan(game, unit, dir)` previews
  the path, why it stops, and the strike hexes. `unit.charges` holds how many are left.
- **CPU:** CPU pikemen charge too, when no normal strike reaches but a charge's closing strike would
  hit an enemy (never a teammate), in the direction that hits the most.

### Stalker (teleport and mines)

The **stalker** has **no attack**. Instead it can **teleport** (`teleport(x, y)`) to any free,
walkable hex **up to 3 hexes away**. It jumps straight there, so water and units in between don't
matter. It **leaves a mine** on the hex it left. A teleport is a normal order (it joins the end of
the queue) and can be used every turn. If another unit has taken the landing hex earlier in the
queue, nothing happens and no mine is laid.

**Mines:** any unit that moves onto a mined hex, whether walking onto it, walking or charging
*through* it, or teleporting onto it, sets it off and is **killed**; the mine is used up. That
includes either team and the stalker itself. A charging pikeman killed by a mine never strikes.
Shots fly over mines. Mines are visible to both sides (drawn in the colour of the team that laid
them), and `game.mines` lists them.

**At most 2 mines at a time:** a stalker with 2 of its mines on the board **can't teleport**, since
it couldn't lay another mine. That's checked when its teleport comes up in the queue, so if one of
its mines goes off earlier in that same queue, the teleport goes ahead.

It's all unit JSON: `"teleport": { "distance": 3, "leavesMine": true, "maxMines": 2 }` (add
`"uses": n` to limit it). The CPU stalker closes in to about 3 hexes from your units and teleports away, leaving a mine
in their path, when one gets within 2. CPU units never walk, charge or dodge onto a mine.

### Builder (channelled buildings)

The **builder** has no attack. Its ability is **build** (`build()`): it **channels for 2 turns** on
its own hex, and then a **building** appears there.

- **Channelling:** turn 1, its build order runs and records progress 1/2. The order then carries
  itself over to the start of next turn's queue, alongside shots in flight. When it runs again on
  turn 2, the building is finished.
- **Interrupting:** giving the builder any other order breaks the channel, and the progress is lost
  (`channelBroken` event). A builder killed before its second entry builds nothing. Queue order
  decides it, as always. "Clear" (your new orders) doesn't cancel a channel in progress.
- **One per hex:** you can't build where there's already a building.
- **Buildings:** **allied units can walk on or through them** and stand on them. To the other team
  they're **impassable**, like water: their moves, routes, charges and teleports go around or stop
  short.
- **Buildings stop projectiles** (either team's, including your own side's): a shot that flies into a
  building hex is used up there (`projectileBlocked`), and a unit standing on that building is not
  hit, so buildings shield the units on them. A gunslinger standing on a building fires out of it
  normally. The building is unharmed. Strikes and mines ignore buildings. `game.buildings` lists them
  (saved and hashed).
- **Defined in the unit JSON:** `"build": { "turns": 2 }`.
- **CPU:** CPU builders build where they stand when none of your units is within 2, leave a channel
  alone once started, step away when you get close, and move on to a fresh hex once theirs is built
  on.

### CPU (`src/ai/cpu.js`)

Deterministic: same board, same plan. For each CPU unit in id order:

1. **Dodge**: step off the line of a shot in flight that would hit it on the flight *after* next.
   (A shot that hits on its next flight can't be outrun: it's carried over ahead of the CPU's moves,
   and the CPU has no quick moves.)
2. **Attack**:
   - Projectile units shoot if the first unit in an allowed direction, within range, is an enemy
     (nearest first), and never when a teammate is first in line.
   - Melee units strike in the allowed direction that catches the most enemies, as the board stands
     now. They never strike when a teammate stands in the strike, or is planned (earlier in the CPU's own plan)
     to step into it.
3. **Charge** (melee units with charges left): if a straight-line charge would end in a strike on
   enemies and no teammates, charge in the direction that hits the most.
4. **Move**: projectile units head for the nearest free cell with a clear, in-range shot at an enemy;
   everyone else heads for the nearest enemy. Moves are one turn's walk, so the order is for the
   furthest hex toward that destination it can reach this turn; it re-plans next turn.

All of this reads from the unit definitions, so JSON-only units are played sensibly too.

## Hex grid

The board is a rectangle of **pointy-topped hexes** (a corner points up and down;
`src/engine/hex.js`), default 8 × 8. Positions are `(x, y)` = (column, row), and odd rows sit half a
hex to the right ("odd-r" layout). Each hex has six neighbours and six directions: `up-left`,
`up-right`, `right`, `down-right`, `down-left`, `left`. There is **no straight up/down**. Straight
lines run through opposite sides: a **row is a straight left/right line**, and the four diagonals run
at 60°. A column zigzags, but is still connected, so a map's "column" road is walkable end to end.
Shots and charges between teams at the top and bottom of the board travel on the diagonals.

Distances are hex steps. Internally the geometry uses axial coordinates; `step`, `distance`,
`neighbors` and `hexLineStep` are exported for other code. Saved states are tagged `grid: 'hex-r'`;
saves from the earlier flat-topped grid (`grid: 'hex'`) and the square grid are rejected with a clear
error.

## Terrain

Every hex has a terrain type, defined in **`src/data/terrain.json`** (validated on load, like units):

```json
{
  "default": "grass",
  "types": {
    "grass":  { "name": "Grass",  "char": ".", "color": "#22331f", "walkable": true },
    "road":   { "name": "Road",   "char": "=", "color": "#4a3f30", "walkable": true },
    "forest": { "name": "Forest", "char": "f", "color": "#16261a", "walkable": true },
    "sand":   { "name": "Sand",   "char": "s", "color": "#4d4630", "walkable": true },
    "water":  { "name": "Water",  "char": "~", "color": "#173450", "walkable": false }
  }
}
```

**The only terrain rule so far: units can't stand on or move into a hex that isn't `walkable`
(water).** Placing a unit there or ordering a move onto it is rejected. Projectiles and melee strikes
ignore terrain: you can shoot across a river.

- **Pathfinding:** units walk the shortest route around unwalkable hexes, and a move's reach (the
  unit's speed) is measured along that route. Among equally short routes they prefer the straight
  hex line, so in open ground they walk straight. Other units are not avoided: a unit stops when its
  next hex is occupied (see *The queue*). A move to a hex with no route is rejected.
- **Maps:** pass `terrain` to `new Game` as one string per row, one `char` per hex, e.g.
  `'~=~~~~=~'`. Omit it for all-default. `game.terrainAt(x, y)`, `game.isWalkable(x, y)` and
  `game.setTerrain(x, y, type)` read and edit it (you can't make an occupied hex unwalkable).
- **Saves:** terrain is part of the saved state and the state hash.
- **CPU:** "nearest" means walking distance, and gunslingers only pick firing hexes they can stand on
  and reach.
- **Adding a terrain type** is a JSON-only change. New *rules* (e.g. movement cost, cover) need code.

## The queue (engine model)

**The order queue decides everything.** When a turn runs (`game.tick()`), the queue is carried out
front to back, and **each entry happens in full before the next one starts**, on the board exactly
as the entries before it left it. There are no hidden phases or simultaneous moves: whatever is
earlier in the queue happens first.

**How the queue is built** each turn:

1. **It starts empty.** Shots still in flight from last turn are added first, in the order they
   ran. (They're the only thing that continues from one turn to the next.)
2. **New orders join the end**, in the order they're given. The CPU stages its whole plan at the
   start of the turn, so its orders go in before yours.
3. **Fast orders go to the very front** instead: **quick moves** and **charges**. Each one added
   goes in front of everything already there, so a fast order given later runs earlier.
4. **Nothing reorders the queue.** A unit has at most one entry: giving it a new order removes its
   old one, and the new one goes to the end, or the front if fast.
   No other entry moves. (A future ability could be allowed to change the order; none does yet.)

So in a match the CPU's fast orders are added at the start of the turn, and yours, added later, go
in front of them.

**What each entry does when its turn comes:**

- **Move** (`move(x, y)`): **one turn's walk.** The target must be within the unit's `speed` in
  hexes (walking distance around terrain); a further target is rejected when the order is given.
  The unit walks there along a shortest walkable route (straight hex line where possible; see
  *Terrain*). If the next hex is occupied, it stops there: whoever is in the hex got there first.
  Either way the move is over; nothing carries over to the next turn. Walking somewhere further
  takes one move per turn: that's for a front end to manage (`walkToward(game, unit, x, y)` gives
  the furthest hex on the way that the unit can reach this turn).
- **Attack** (`attack(dir)`): see *Combat*. The unit doesn't move that turn.
- **Projectile in flight**: flies another `speed` hexes (see *Combat*).

So, for example: two units heading for the same hex, the one earlier in the queue gets it; two units
trying to swap places both stay put; a line of units walks together only if the front unit is
first in the queue; a fast unit gains distance, not priority.

Events from `tick()` (`orderStarted`, `moved` with the full `path`, `blocked`, `arrived`, `shot`,
`projectileMoved`, `strike`, `killed`, `projectileExpired`, `quickMove`) all carry `step`, the
queue position that caused them. `game.orderFor(id)` returns a unit's queued order; projectiles
carried over from last turn are marked `carried: true`.

Other basics: the world is a `width x height` hex grid; each hex holds at most one unit. Every unit
has a **type** that defines its speed and attack; ordering a unit to do something its type can't do
throws.

### Unit types (defined in JSON)

Unit types live in **`src/data/units.json`**. Adding a unit is a JSON-only change: the engine, CPU,
renderer and debug UI all read behaviour from the definition, and the file is validated on load with
error messages that name the unit and field.

```json
{
  "default": "pikeman",
  "units": {
    "pikeman": {
      "name": "Pikeman", "speed": 1, "shape": "circle",
      "attack": { "kind": "melee", "reach": 2, "directions": "all" }
    },
    "gunslinger": {
      "name": "Gunslinger", "speed": 1, "shape": "diamond",
      "attack": { "kind": "projectile", "speed": 4, "directions": "all" }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `name` | display name (required) |
| `speed` | hexes walked per move entry, 1–6 (required) |
| `shape` | `circle` (default), `diamond`, `square`, `triangle` |
| `attack` | leave it out for a unit that can't attack |
| `attack.kind` | `melee` or `projectile` |
| `attack.directions` | `all` (the 6 hex directions), `horizontal` (left/right), or a list like `["left", "down-left"]` |
| `attack.reach` | melee: how many hexes in a row it strikes |
| `attack.speed` | projectile: hexes flown per queue entry, 1–6 |
| `attack.range` | projectile: max cells travelled; leave it out for unlimited |
| `teleport` | optional `{ "distance": 3, "leavesMine": true, "maxMines": 2, "uses": n }`: jump to any free walkable hex up to `distance` away; optionally leave a mine behind; can't teleport with `maxMines` of its mines down; `uses` per match (omit for unlimited) |
| `build` | optional `{ "turns": 2 }`: channel this many turns to put a building on its own hex |
| `charge` | optional `{ "distance": 3, "uses": 1 }`: a straight-line rush of up to `distance` hexes, ending with the unit's attack in that direction; goes to the front of the queue; `uses` times per unit per match |
| `attack.maxInFlight` | optional, projectile attacks: can't fire while this many of the unit's projectiles are still in flight |
| `attack.blockedByAdjacentEnemy` | optional, `true`: the attack fails if an enemy is next to the unit when its queue entry runs |
| `default` | type used when a unit doesn't name one |
| `renamed` | optional: old type keys mapped to current ones, so old saves still load |

Example: a range-limited archer that only shoots along one diagonal line, which needs no code:

```json
"archer": {
  "name": "Archer", "speed": 1, "shape": "triangle",
  "attack": { "kind": "projectile", "speed": 2, "range": 3, "directions": ["down-right", "up-left"] }
}
```

Only a brand-new attack *kind* (e.g. an area blast) needs code: in `unitTypes.js` (validation),
`game.js` (resolution), `ai/cpu.js` (CPU use) and `ui/renderer.js` (drawing the queued attack).
`registerUnitTypes(json)` can also add types at runtime, as `test/units.test.js` does.

A unit's speed starts at its type's speed; `speed` / `setSpeed` override it for debugging and tests.

### Combat

Every attacking unit uses the same order, `attack(dir)` (`dir`: one of the 6 hex directions,
limited to what the type allows). What happens when the entry runs depends on `attack.kind`:

**Melee** (pikeman): every unit in the `reach` hexes in a straight line next to the attacker is
killed, right then, teammates included. A unit that stepped away earlier in the queue escapes; one
that walks in later is safe. A pikeman killed earlier in the queue never strikes.

**Projectile** (gunslinger): a shot is fired from the unit's hex and immediately flies up to its
`speed` (4) hexes in a straight line. It kills the **first unit it meets** and is used up. If it
doesn't hit anything, it stays in flight: it gets an entry in the carried-over part of next turn's
queue and flies another 4 hexes then. It ends when it leaves the board or passes its `range` (if
set). Shots fly over any terrain, never steer, don't block units, and don't collide with each
other, but a **building stops them** (see *Builder*). A unit that walks into a hex where a shot is
sitting is hit.

So two gunslingers facing each other within 4 hexes: the one first in the queue wins, and the other
never fires.

**One shot in flight at a time:** a gunslinger **can't shoot while its last shot is still flying**
(`attackBlocked`, reason `projectile in flight`). That's checked when its shot comes up in the
queue. Its carried-over shot flies first each turn, so if that shot hits something or leaves the
board, a new shot later in the same queue is allowed. Unit JSON: `"maxInFlight": 1` on the attack.
The CPU doesn't plan a shot that would be blocked this way.

**Gunslingers can't shoot with an enemy next to them.** If an enemy unit is on any of the 6 hexes
around the gunslinger when its shot comes up in the queue, the shot fails and nothing is fired
(`attackBlocked` event; a teammate next to it doesn't matter). It's checked at that moment only:
if the gunslinger has already shot (earlier in the queue, or a shot still flying from a previous
turn), an enemy arriving next to it afterwards changes nothing. Likewise an enemy that moves away or
dies earlier in the queue no longer blocks it. The rule is the unit-JSON flag
`"blockedByAdjacentEnemy": true` on the gunslinger's attack, so other unit types can use it too. The
CPU won't plan a shot that would be blocked, and won't pick a firing hex next to an enemy.

### Determinism

The engine uses no randomness, clock, or DOM; the queue fixes the order of everything; state is
plain JSON. `game.hash()` is an FNV-1a hash of canonical JSON state, shown in the debug
UI header, so two runs with the same orders can be compared at a glance.
`game.snapshot()` / `Game.fromSnapshot()` give exact save/restore.

## Debug UI (`debug.html`)

- Starts on **Skirmish vs CPU** (a river with two bridges; **Open field vs CPU** has no terrain).
  Other matches:
  - **Escort the builder** (8×10): get your builder (gold star) to the flag at the top of the road,
    over the only bridge, past two CPU gunslingers whose diagonal lines of fire cross on the bridge. Its buildings stop shots, so it
    can build cover on the way.
  - **Big battle (12×14)**: 10 units a side (4 pikemen, 3 gunslingers, 2 stalkers, a builder) on a
    big map with a three-bridge river, a lake, roads and forest.
  - **Small skirmish (5×6)**: a pikeman and a gunslinger each on a tiny board: fast and sharp.
  Boards can be any size; scenarios with a map take their size from it. The board scales to fit
  the phone screen (at most about two-thirds of its height). CPU orders are already staged when your turn starts (pink dashed
  lines, listed first in the Queue tab); tap **End turn** when your orders are in. The header shows
  YOU WIN / YOU LOSE / DRAW when a side is wiped out.
- **Move** mode: tap one of your units to select it (the hexes it can reach this turn light up),
  then tap one of them to queue `move(x, y)`.
- **Paint** mode: pick a terrain type and tap or drag across hexes to paint it. The CPU re-plans
  afterwards.
- **Ability** mode: select one of your units with an ability. A **pikeman** charges: tap toward where
  it should charge (any hex or unit; snapped to the nearest hex direction). A **stalker** teleports:
  tap one of the highlighted hexes (its teleport is drawn as a dotted arc, with a faint preview of the
  mine it will leave). A **builder**: one tap queues its build on its own hex (dashed outline). While
  it channels, a progress ring shows around it. Finished buildings are a tinted hex with a house
  badge, in the team's colour. For a charge, the board shows the straight path in purple and the hexes its
  closing strike will hit. Pikemen that still have a charge show a purple chevron pip.
- **Quick** mode: the same, but queues that unit's one-time quick move (drawn in cyan, listed first in
  the queue). Units that still have their quick move show a small lightning pip.
- **Attack** mode: tap one of your units, then tap any cell or unit to attack toward it, snapped to the
  nearest direction that unit's type allows. Queued melee attacks shade the
  struck cells in the team's colour.
- **Add** / **Remove** modes edit the board (the CPU re-plans after edits). The type and team pickers
  set what gets added.
  Gunslingers are drawn as diamonds, pikemen as circles.
- **Speed** sets the selected unit's speed, or the speed for newly added units when none is selected.
  Units faster than 1 show their speed in a small badge.
- Projectiles are orange dots with a tail. Queued shots show as a dotted orange ray.
- **End turn** resolves the turn, **Back** restores the state just before the last End turn (both sides'
  orders included), **Auto** ends turns until the match is over or everything is idle.
- **Clear** removes your queued orders (the CPU's stay).
- **Preview** draws green arrows along next tick's full unit paths, orange arrows for projectiles,
  a red X on units that will be killed, and dashed red rings on units that will be blocked.
- **Scenario** loads preset collision cases.
- Tabs: the queue in run order (quick / continuing / CPU / your new orders, and shots in flight), a
  per-turn event log numbered by queue step, unit list, and raw state JSON (copy / edit / load).
- `window.debug.game` is available in the browser console.

## Deploying

`.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
