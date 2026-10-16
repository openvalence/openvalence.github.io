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
`-640`, and `<piece>-<theme>.webp`, the poster, which is frame 0. Every file is under 1.2 MB.

## Live on the site

Each piece's script is its own file (`<piece>.js`), so the site can run it in the page.
The figure's `data-live` lists the scripts in load order; `site.js` decides per visitor:

- Live: no reduced motion, no Save-Data or 2g/3g, `hardwareConcurrency` 4 or more,
  `deviceMemory` 4 or more where the browser reports it. After the page has loaded and
  the figure is near the screen, `site.js` sets `window.motionHost`, loads the scripts,
  and `run()` in `common.js` hands it the piece. Colors come from `/style.css`'s tokens
  and the scene is rebuilt when the color scheme changes. If the 90th-percentile frame
  time over the first second is above 20 ms, the video takes over at the same loop
  position.
- Video: everyone else. The poster stays for reduced motion.

On `/kinetic/` the clip has a stepper (`stepper()` in `site.js`): Prev, Play, Next, a
scrubber and the six steps, with the arrow keys and Space when the figure has focus. Each
step holds at its beat's end state (`data-hold` on the beat's `<li>`, in clip seconds); the
live piece adds its own stops inside Handle lengths, Legality check and Trim (`STEPS` in
`knots-to-curve.js`, passed through `run()`), and `draw(t, held)` shows those frames with the
log fully typed. The video seeks to the same times. Reduced motion gets the stepper too:
the live piece where the device can carry it, drawn only on a step, else the paused video.

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

## The Kinetic² data

Both Kinetic pieces draw what the real planner computed, never a sketch of it.

- `kinetic-data.js` (Screen to rail): `node bake.mjs` runs the playground's WebAssembly
  build (`https://openvalence.org/Kinetic/kinetic2.wasm` by default, or a local
  `kinetic2.wasm` as the first argument) over the knots in `bake.mjs` and keeps the
  position on the 1 ms grid.
- `handles-data.js` (Knots to curve): `node bake-handles.mjs [path/to/Kinetic]` needs
  g++ (C++20). It copies Kinetic's headers into `renders/k2i`, adds the trace hooks in
  `kinetic-trace/patch.mjs` (no-ops that only report: knot classes, angles, every
  length the walk judged, the judge's samples and turning points, the trim's
  halvings), builds `kinetic-trace/trace.cpp` and runs the script in
  `bake-handles.mjs`. It writes nothing unless that build's 1 ms samples match the
  deployed `kinetic2.wasm` bit for bit, so bake from the Kinetic commit the
  playground runs. A patch anchor that no longer matches fails the bake: move the
  hook, never the planner.

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
