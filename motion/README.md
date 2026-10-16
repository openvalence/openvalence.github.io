# Motion

Sources for the three looping clips on the site, rendered with
[HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0): each piece is an
HTML page whose picture is a pure function of time, captured frame by frame in headless
Chrome and encoded with FFmpeg.

| Piece | Source | On the site |
| - | - | - |
| Screen to rail | `screen-to-rail.html` | `/diagrams/#funscript` |
| Knots to curve | `knots-to-curve.html` | `/kinetic/`, under "Time never gives" |
| Any app, one machine | `any-app.html` | `/valence/`, under "You already know how this works" |

Each renders twice, dark and light (the `theme` variable), into `../images/motion/`:
`<piece>-<theme>.webm` (VP9) and `.mp4` (H.264) at 1280 wide, the same at 640 wide with
`-640`, and `<piece>-<theme>.webp`, the poster, which is frame 0. Every file is under 2 MB.

## Live on the site

Each piece's script is its own file (`<piece>.js`), so the site can run it in the page.
The figure's `data-live` lists the scripts in load order; `site.js` decides per visitor:

- Live: no reduced motion, no Save-Data or 2g/3g, `hardwareConcurrency` 4 or more,
  `deviceMemory` 4 or more where the browser reports it. After the page has loaded and
  the figure is near the screen, `site.js` sets `window.motionHost`, loads the scripts,
  and `run()` in `common.js` hands it the piece. Colors come from `/style.css`'s tokens
  and the scene is rebuilt when the page theme changes (system scheme or header toggle). If the 90th-percentile frame
  time over the first second is above 20 ms, the video takes over at the same loop
  position.
- Video: everyone else. The poster stays for reduced motion.

On `/kinetic/` the clip has a stepper (`stepper()` in `site.js`): Prev, Play, Next, a
scrubber and the six steps, with the arrow keys and Space when the figure has focus. Each
step holds at its beat's end state (`data-hold` on the beat's `<li>`, in clip seconds); the
live piece has its own stops in every beat (`STEPS` in `knots-to-curve.js`, passed through
`run()`, listed below), and `draw(t, held)` shows those frames with the log fully typed. On
the live piece Prev, Next and the step tabs run the clip to the stop in 0.4 to 1.2 s, eased
(Prev runs it backward); the scrubber is immediate. The video keeps the beat-level stops and
seeks to them. Reduced motion gets the stepper too, with no runs: the live piece where the
device can carry it, drawn only on a step, else the paused video.

The clip's length, its loop offset and the beat times in `/kinetic/index.html`
(`data-dur`, `data-offset`, `data-at`, `data-hold`, the scrubber's `max`) and
`data-duration` in `knots-to-curve.html` come from `DUR`, `OFFSET`, `BEAT` and the last
stop of each beat in `knots-to-curve.js`. Change them together.

The page loads one live piece at most: the scripts share the page's globals.

## Re-render

Needs Node 22+ and FFmpeg on the PATH.

```sh
cd motion
npx --yes hyperframes@0.8.163 browser ensure   # once: downloads Chrome Headless Shell
bash render.sh                     # all three; or: bash render.sh knots-to-curve
```

`render.sh` runs HyperFrames 0.8.163 through `npx`. To use an installed copy instead, set
`HF` to its `hyperframes` executable: `HF=path/to/node_modules/.bin/hyperframes bash render.sh`.

`render.sh` copies the fonts and the Phosphor screenshots into `assets/`, renders a PNG
sequence per piece and theme into `renders/`, and encodes the web files.
`assets/` and `renders/` are not tracked. It sets `HYPERFRAMES_NO_TELEMETRY=1`.

To look at a piece while editing, run `bash render.sh` once (for `assets/`), serve the
repo root, and open `/motion/knots-to-curve.html?theme=light`. Outside HyperFrames it
loops on the browser clock.

## The mark

`mark.html` draws the animated OpenValence mark from `/mark-anim.js`, the one source for both
animations (Phosphor's `src/ui/mark-anim.js` is a byte-identical copy; edit here first):

- `orbit`: the electrons are captured one after another onto an outer level, circle it at constant
  speed and drop into their gaps, each drop sending out a photon. On the site it is the header
  mark's intro (`header()`; the home page's first load in a session); a hover excites the electrons
  and they drop back. The clip: the intro, two excitations, the electrons knocked free.
- `phosphor`: the ring spins past a pump point; each electron that passes it jumps out, stays an
  exponentially distributed while, and drops back with a photon, and the light decays exponentially.
  Phosphor's launch splash and its hub-connecting indicator.

The motion borrows from the physics (instant jumps, exponential waits and decays, constant orbits);
the header comment in `mark-anim.js` lists what it borrows.

Both clips are 9.6 s at 60 fps and loop. `bash render-mark.sh [piece ...]` renders them and writes
into `renders/mark/` (or `$OUT`): `<piece>-<dark|light>-<1920x1080|1080x1080>.mp4` and `.webm`,
`<piece>-alpha-<1920x1080|1080x1080>.webm` (VP9 with alpha, phosphor drawn for a dark page) and
`<piece>-dark.gif` (360 square, 25 fps, under 2 MB; phosphor's is a one-turn loop, 3.2 s).
They are for posts and READMEs and are not committed.

## The Kinetic² data

Both Kinetic pieces draw what the real planner computed, never a sketch of it.

- `kinetic-data.js` (Screen to rail): `node bake.mjs` runs the playground's WebAssembly
  build (`https://openvalence.org/Kinetic/kinetic2.wasm` by default, or a local
  `kinetic2.wasm` as the first argument) over the knots in `bake.mjs` and keeps the
  position on the 1 ms grid.
- `handles-data.js` (Knots to curve): `node bake-handles.mjs [path/to/Kinetic]` needs
  g++ (C++20). It builds `kinetic-trace/trace.cpp` against that checkout's headers into
  `renders/k2i` and runs the script in `bake-handles.mjs`. trace.cpp defines Kinetic's own
  trace hooks (`include/kinetic2/trace.hpp`, all seventeen; they only read) and prints what
  they report: knot classes, pchip's terms, each G2 sweep, every length the walk judged,
  the trim's tests. It writes nothing unless that build's 1 ms samples match the deployed
  `kinetic2.wasm` bit for bit, so bake from a Kinetic commit whose planner the playground
  runs. This data: Kinetic 28364a1. A hook whose arguments change in Kinetic breaks the
  trace build: change trace.cpp, never the planner.

The stepper's notes read `walk` (each factor tried, with its peaks) and `bisect` (each test
of the trim: the move, the stroke kept and the peaks of the fit that decided it).

Re-bake and re-render when the planner changes. The captions on `/kinetic/` cite
`handles.hpp` lines and change with it.

## Rules for the pieces

- Draw from `t` only: no `Date`, no `Math.random`, no timers. HyperFrames seeks frames
  in any order.
- Colors come from `common.js`, which copies the tokens in `/style.css`. Change both.
- Facts on screen come from the same sources as `/diagrams/`; each piece's header
  comment names them.
- A piece loops: its last frame runs into frame 0, and frame 0 is a complete picture,
  since it is also the poster and what reduced-motion visitors see.

## Knots to curve: the stops

The piece's timeline is a list of reveals (`seg`) and holds (`hold`) in `knots-to-curve.js`.
Every hold is a stepper stop, `{id, beat, at, note}`, at 0.35 s before the hold ends, so the
next fade has not started. A note is built from the trace and nothing else. On screen, a
value over its ceiling by more than `kTol` (0.1%) is red (`--bad`), a legal result is the
accent, and the element a stop is about is bold or ringed while the rest dims.

The trace records `bake-handles.mjs` reads, one JSON line each, from `kinetic-trace/trace.cpp`:

| Event | Where it fires | Fields |
| - | - | - |
| `pass` | `K2T_RUN`, `K2T_PASS` (solver.hpp `renderRun`) | run, pass, m (knots) |
| `pchipTerms` | `K2T_PCHIP` (`pchipAngle()`) | i, h1, h2 (s), w1, w2, dIn, dOut, r (the angle) |
| `sweep` | `K2T_SWEEP` (`solveStyle()`, each G2 sweep at a through knot); v0 is the angle before it, kept from `K2T_STYLE` and the last sweep | s, i, raw (the closed form), lo, hi (the band), v0, v (angle before, after), aL0, aR0, aL, aR (acceleration at the knot from the left and the right piece, before and after) |
| `solved` | `K2T_ROUND` (`render()`, after each solve, tag 0 and 2, and nudge, 1 and 3) | per knot: t, p, dp, cls, vel, lIn, lOut, effIn, effOut, dIn, dOut, slack, inf |
| `pchip` | `K2T_ROUND`, tag 0 | base: pchip's angle per knot |
| `piece`, `pieceEnd` | `K2T_PIECE`, `K2T_PIECE_END` (`nudge()`, per piece) | i, memo hit; the fit: k, i0, i1, o, legal, dp |
| `judge` | `K2T_JUDGE` (`fitPiece()`, every factor judged), with `K2T_PHASE` | phase (0 the walk, 1 the full move, 10 + s halving s, 30 + q the quarter moves, 40 flat), T, D, s0, s1, i0, i1, f, o, legal, the peak ratios rv, ra, rj, rx |
| `detail` | trace.cpp, round 0 of the walked and trimmed pieces | every factor's peaks (`sweep`), the judge's samples and turning points at k 1, at the chosen factor and at each factor (`byK`) |
| `samples` | the engine's `stateAt()` every 1 ms | P, V, A |
| `anomaly` | `popAnomaly()` | kind, t, target, detail |

Window units in the trace; `handles-data.js` is in mm on the 100 mm window. Source lines are
Kinetic 28364a1 (`include/kinetic2/`, handles.hpp unless named), and Nucleus for the strip.

| Stop | Beat | Brought forward | Reads (`HDATA`) | Planner source |
| - | - | - | - | - |
| `hIn` | Knots | the newest row; 11 knots, 22 numbers | `knots[].t, p` | trace.cpp `main()`: the script, submitted as `Knot{t_us, p}` |
| `hCls` | Knots | the knot being classed, its chord signs, its class; the count | `knots[].dIn, dOut, cls` | :495 `classify()` |
| `hPchip` | Angles | the chords at knot 1; pchip's result | `angle.h1, h2, w1, w2, dIn, dOut, pchip` | :511 `pchipAngle()` |
| `hBand` | Angles | the band and its bound | `angle.lo, hi` | :536 `band()` |
| `hSw1` | Angles | sweep 1: acceleration from the left and the right, the angle that matches them | `angle.sweeps[0]`, `sweepV` | :564 the G2 sweeps, :578 the closed form, clamped to the band |
| `hSw` | Angles | sweep 4, the settled angle | `angle.sweeps`, `sweepV` | :564 |
| `hThird` | Handle lengths | the handles' share, 0.333 | `knots` | :560 `kThird` |
| `hK1` | Handle lengths | sample 3, u 0.5, over (red): the judge stops | `judge.walkK1`, `walk[4][0]` | :312 `kOrder`, :321 the early return |
| `hSkip` | Handle lengths | the side the walk skips | `walk[4]` | :788 `tryDown`, `tryUp` |
| `hW1`, `hW2` | Handle lengths | the factor's speed, over | `walk[4]`, `walkAt`, `sweep[4]` | :618 `ksAt()`, :752 both lengths times k, never under the floor |
| `hW3` | Handle lengths | the legal factor and its peaks | `walk[4]`, `judge.walk`, `final[4].effOut` | :733 `fitPiece()` |
| `hBounds` | Handle lengths | the one factor where every row passes | `sweep[4]` (every factor, judged for the picture) | trace.cpp `tDetail()` |
| `hS3` | Legality check | samples 1 to 3; 49,020 mm/s² at u 0 | `judge.walk.samples` | :312, :321 |
| `hS11` | Legality check | the highest of each column | `judge.walk.samples` | :317 the sample loop |
| `hRv` | Legality check | the segment where acceleration changes sign; the turn | `judge.walk.rootsV` | :328, :271 `rootsOf()` |
| `hRa` | Legality check | no turn: the samples hold the peak | `judge.walk.rootsA` | :331 |
| `hRj` | Legality check | the jerk turn; the ends stay higher | `judge.walk.rootsJ` | :334 |
| `hVerdict` | Legality check | LEGAL, the peaks against the ceilings | `judge.walk.over` | :304 `overOf()` |
| `hT1` | Trim | speed and acceleration over at k 1 (red) | `judge.trimK1`, `walk[6][0]` | :771, :788 both over: both sides |
| `hShort` | Trim | the shorter side; k 0.45, where the handles reach the floor | `walk[6]`, `sweep[6]`, `floor` | :735 the floor, :752 |
| `hLong` | Trim | the longer side; k 1.20, acceleration under, speed over | `walk[6]`, `sweep[6]` | :752 |
| `hWhy` | Trim | speed at the floor against its ceiling; the chord's average | `walk[6]`, `knots[7].dIn` | :495 (the chord) |
| `hb0` | Trim | the full move, a zero stroke: legal | `bisect[0]` | :844 `nudge()`, :911 |
| `hb1`, `hb2`, `hb3`, `hb7` | Trim | the test, the bracket, red when over | `bisect[i]` | :915 the 16 halvings |
| `hb16` | Trim | the last test, legal within 0.1%; the time kept | `bisect[16]`, `share`, `final[7].dp` | :915 |
| `hResolve` | Trim | knot 8's angle on its trimmed chord | `resolve`, `final[8].vel` | :1017 the solve on the trimmed chords |
| `hRender` | 1 ms samples | the composite Bézier | `P` | solver.hpp:32 the corner ramp at jmax |
| `hGrid` | 1 ms samples | the sample at 2,700 ms | `P`, `V`, `A` | engine_piece.hpp:123 |
| `hFeed` | 1 ms samples | the sample leaving at now, the one read 127 ms ahead | `P` | Nucleus MotionArbiter.h:128 `kStripLen`, MotionArbiter.cpp:1093 |
| `hEnd` | 1 ms samples | the ride's end | `P` | |
