// bake-handles.mjs -- traces the real Kinetic² planner building one script and writes
// handles-data.js for knots-to-curve.html: knot classes, angles, the length walk, the
// judge's samples and turning points, the trim's bisection, and the 1 ms samples.
// Usage: node bake-handles.mjs [path/to/Kinetic]   (default: ../../Kinetic)
// Needs g++ (C++20) on the PATH. Builds kinetic-trace/trace.cpp, which defines Kinetic's
// own trace hooks (include/kinetic2/trace.hpp), against that checkout's headers into
// renders/k2i (untracked), checks the build's 1 ms samples against the deployed
// kinetic2.wasm bit for bit, and refuses to write on a mismatch.
// Constraints: units here are the engine's (window 0..1); handles-data.js is mm on a
// 100 mm window, with the Kinetic playground handles page's ceilings (Kinetic playground/handles.js).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const kin = resolve(process.argv[2] || join(here, '../../Kinetic'));
const build = join(here, 'renders/k2i');
const MM = 100;                                     // the window, mm
const LIM = [1000, 50000, 5e6];                     // mm/s, mm/s^2, mm/s^3 (Kinetic playground/handles.js)
// The script: p0, span, then t (s) and p (mm) per knot; the last at rest.
const SCRIPT = [10, 3.4, [[0.45, 35], [0.8, 70], [1.15, 92], [1.5, 15], [1.62, 100], [2.0, 20], [2.08, 92], [2.6, 60], [2.9, 40], [3.3, 10]]];
const WALK = 4, TRIM = 6, ANG = 1;                  // the pieces the video opens up (from knot i to i + 1), the knot whose angle it works

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
execFileSync('g++', ['-std=c++20', '-O2', '-ffp-contract=off', '-static', '-I' + join(kin, 'include'), join(here, 'kinetic-trace/trace.cpp'), '-o', 'trace.exe'], { cwd: build, stdio: 'inherit' });
const args = [LIM[0] / MM, LIM[1] / MM, LIM[2] / MM, SCRIPT[0] / MM, SCRIPT[1]];
for (const [t, p] of SCRIPT[2]) args.push(t, p / MM);
const L = execFileSync(join(build, 'trace.exe'), args.map(String), { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').map((l) => JSON.parse(l));
const sha = execFileSync('git', ['-C', kin, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

// The same script through the deployed wasm: the trace build must match it exactly.
const wasm = Buffer.from(await (await fetch('https://openvalence.org/Kinetic/kinetic2.wasm')).arrayBuffer());
const { instance } = await WebAssembly.instantiate(wasm, {});
const K = instance.exports; K._initialize();
const h = K.kinetic2_create(), sb = K.malloc(24);
K.kinetic2_configure(h, args[0], args[1], args[2], 0, 0.15, 1, 4000);
K.kinetic2_reset(h, args[3], 0);
SCRIPT[2].forEach(([t, p], i) => { const last = i === SCRIPT[2].length - 1; K.kinetic2_submit(h, Math.round(t * 1e6), p / MM, last ? 1 : 0, 0, 0, last ? 0 : 2); });
const smp = L.find((e) => e.ev === 'samples');
let bad = 0;
for (let i = 0; i < smp.P.length; i++) {
  K.kinetic2_sample(h, i * 1000, sb);
  const d = new DataView(K.memory.buffer);
  if (d.getFloat32(sb + 8, true) !== Math.fround(smp.P[i]) || d.getFloat32(sb + 12, true) !== Math.fround(smp.V[i])) bad++;
}
if (bad) throw new Error(`trace build differs from the deployed wasm in ${bad} samples: rebuild against the deployed commit`);

// ---- what the video reads -------------------------------------------------------
const r1 = L.filter((e) => e.run === 1 && e.pass === 0);
if (L.some((e) => e.ev === 'pass' && (e.run !== 1 || e.pass !== 0))) throw new Error('more than one render pass: the video shows one');
let round = -1, piece = -1;
const rounds = [], judges = {}, ends = {}, terms = [], sweeps = [];
for (const e of r1) {
  // a solve's pchip terms and sweeps print before its solved line: they belong to round + 1
  if (e.ev === 'pchipTerms') ((terms[round + 1] ||= {})[e.i] ||= e);
  if (e.ev === 'sweep') ((sweeps[round + 1] ||= {})[e.i] ||= []).push(e);
  if (e.ev === 'solved' && (e.tag === 0 || e.tag === 2)) { round++; rounds[round] = { solve: e.knots }; }
  if (e.ev === 'solved' && (e.tag === 1 || e.tag === 3)) rounds[round].nudge = e.knots;
  if (e.ev === 'piece') piece = e.i;
  if (round === 0 && e.ev === 'judge') (judges[piece] ||= []).push(e);
  if (round === 0 && e.ev === 'pieceEnd') ends[e.i] = e;
}
const pchip = L.find((e) => e.ev === 'pchip').base;
const det = Object.fromEntries(L.filter((e) => e.ev === 'detail').map((d) => [d.i, d]));
const r = (x, n = 2) => +x.toFixed(n);
const mm = (x, n = 2) => r(x * MM, n);
const CLS = ['end', 'rest', 'crest', 'through'];
const judgeOut = (j) => ({
  samples: j.samples.map(([u, v, a, jj]) => [u, mm(v, 1), mm(a, 0), mm(jj, 0)]),
  rootsV: j.rootsV.map(([u, v]) => [r(u, 4), mm(v, 1)]),
  rootsA: j.rootsA.map(([u, a]) => [r(u, 4), mm(a, 0)]),
  rootsJ: j.rootsJ.map(([u, x]) => [r(u, 4), mm(x, 0)]),
  dense: j.dense.filter((_, i) => i % 2 === 0).map(([u, t, p, v, a, jj]) => [u, r(t, 4), mm(p), mm(v, 1), mm(a, 0), mm(jj, 0)]),
  over: j.over.map((x) => r(x, 4)),
});
const s0 = rounds[0].solve, fin = rounds[rounds.length - 1].nudge;
const data = {
  kinetic: sha, window: MM, lim: LIM, floor: det[WALK].floor, walkPiece: WALK, trimPiece: TRIM,
  knots: s0.map((k, i) => ({ t: r(k.t, 3), p: mm(k.p, 1), cls: CLS[k.cls], dIn: mm(k.dIn, 1), dOut: mm(k.dOut, 1), pchip: mm(pchip[i], 1), vel: mm(k.vel, 1) })),
  final: fin.map((k) => ({ p: mm(k.p + k.dp, 3), dp: mm(k.dp, 3), vel: mm(k.vel, 1), effIn: r(k.effIn, 4), effOut: r(k.effOut, 4) })),
  // the length walk, per judged factor: [k, legal, peak v mm/s, a mm/s^2, j mm/s^3]
  walk: Object.fromEntries([WALK, TRIM].map((i) => [i, judges[i].filter((e) => e.phase === 0).map((e) => [e.f, e.legal, r(e.rv * LIM[0], 1), r(e.ra * LIM[1], 0), r(e.rj * LIM[2], 0)])])),
  sweep: Object.fromEntries([WALK, TRIM].map((i) => [i, det[i].sweep.map(([pass, f, i0, i1, o, rv, ra, rj]) => [pass, f, r(i0, 4), r(i1, 4), r(rv, 6), r(ra, 6), r(rj, 6), o <= 1.001 ? 1 : 0])])),
  judge: { walkK1: judgeOut(det[WALK].atK1), walk: judgeOut(det[WALK].chosen), trimK1: judgeOut(det[TRIM].atK1) },
  // knot ANG in round 0 (pchipAngle, solveStyle): spans h1 h2 s, weights w1 w2, chords mm/s, pchip mm/s, the band
  // mm/s, and per G2 sweep [angle before, after mm/s, acceleration from the left and from the right before, after mm/s^2]
  angle: (() => {
    const p = terms[0][ANG], w = sweeps[0][ANG];
    return { i: ANG, h1: r(p.h1, 3), h2: r(p.h2, 3), w1: r(p.w1, 3), w2: r(p.w2, 3), dIn: mm(p.dIn, 1), dOut: mm(p.dOut, 1), pchip: mm(p.r, 1), lo: mm(w[0].lo, 1), hi: mm(w[0].hi, 1),
      sweeps: w.map((e) => [mm(e.v0, 1), mm(e.v, 1), mm(e.aL0, 1), mm(e.aR0, 1), mm(e.aL, 1), mm(e.aR, 1)]) };
  })(),
  // every through knot's angle after each sweep of round 0, mm/s (the main plot)
  sweepV: Object.fromEntries(Object.entries(sweeps[0]).map(([i, w]) => [i, w.map((e) => mm(e.v, 1))])),
  // round 1, the solve on the trimmed chords, at knot TRIM + 2: its chord in mm/s, pchip and the angle after the sweeps
  resolve: (() => { const i = TRIM + 2, p = terms[1][i], w = sweeps[1][i]; return { i, dIn: mm(p.dIn, 1), pchip: mm(p.r, 1), vel: mm(w[w.length - 1].v, 1), lo: mm(w[0].lo, 1) }; })(),
  // the walk's other tried factors (k 1 and the chosen one are in judge), keyed by k
  walkAt: Object.fromEntries(judges[WALK].filter((e) => e.phase === 0 && e.f !== 1 && e.f !== ends[WALK].k).map((e) => {
    const c = det[WALK].byK.find((x) => x.f === e.f);
    if (!c || Math.abs(c.over[1] - e.rv) > 1e-4 * e.rv) throw new Error(`no trace for k ${e.f} that matches its judge`);
    return [e.f, judgeOut(c)];
  })),
  chosen: { [WALK]: ends[WALK].k, [TRIM]: ends[TRIM].k },
  // the trim: the full move tested first, then 16 halvings. Per test, the judge that decided it
  // (the first legal fit, else the least over): [move mm toward the previous knot, legal,
  // stroke kept mm, share kept, peak v mm/s, a mm/s^2, j mm/s^3]
  bisect: (() => {
    const ph = {}, full = Math.abs(det[TRIM].pR - det[TRIM].pL);
    for (const e of judges[TRIM]) {
      if (e.phase < 1 || e.phase >= 30) continue;
      const b = ph[e.phase];
      if (!b || (!b.legal && (e.legal || e.o < b.o))) ph[e.phase] = e;
    }
    return Object.keys(ph).map(Number).sort((a, b) => a - b).map((k) => {
      const e = ph[k], d = Math.abs(e.D);
      return [mm(full - d, 3), e.legal, mm(d, 3), r(d / full, 4), r(e.rv * LIM[0], 1), r(e.ra * LIM[1], 0), r(e.rj * LIM[2], 0)];
    });
  })(),
  share: r(L.find((e) => e.ev === 'anomaly' && e.kind === 3).detail, 4),
  P: smp.P.map((x) => mm(x, 2)),
  V: smp.V.map((x) => mm(x, 0)),
  A: smp.A.map((x) => mm(x, 0)),
};
writeFileSync(join(here, 'handles-data.js'), `// Generated by bake-handles.mjs from Kinetic ${sha} (matches the deployed kinetic2.wasm). Do not edit.\nwindow.HDATA = ${JSON.stringify(data)};\n`);
console.log('handles-data.js:', sha, 'trim keeps', data.share, 'walk', JSON.stringify(data.walk[WALK].map((w) => w[0] + (w[1] ? '+' : '-'))));
