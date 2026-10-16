// bake-handles.mjs -- traces the real Kinetic² planner building one script and writes
// handles-data.js for knots-to-curve.html: knot classes, angles, the length walk, the
// judge's samples and turning points, the trim's bisection, and the 1 ms samples.
// Usage: node bake-handles.mjs [path/to/Kinetic]   (default: ../../Kinetic)
// Needs g++ (C++20) on the PATH. Builds Kinetic's own headers with the trace hooks in
// kinetic-trace/patch.mjs into renders/k2i (untracked), checks that build's 1 ms
// samples against the deployed kinetic2.wasm bit for bit, and refuses to write on a
// mismatch.
// Constraints: units here are the engine's (window 0..1); handles-data.js is mm on a
// 100 mm window, with the Kinetic playground handles page's ceilings (handles-model.js DEF).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const kin = resolve(process.argv[2] || join(here, '../../Kinetic'));
const build = join(here, 'renders/k2i');
const MM = 100;                                     // the window, mm
const LIM = [1000, 50000, 5e6];                     // mm/s, mm/s^2, mm/s^3 (handles-model.js DEF)
// The script: p0, span, then t (s) and p (mm) per knot; the last at rest.
const SCRIPT = [10, 3.4, [[0.45, 35], [0.8, 70], [1.15, 92], [1.5, 15], [1.62, 100], [2.0, 20], [2.08, 92], [2.6, 60], [2.9, 40], [3.3, 10]]];
const WALK = 4, TRIM = 6;                           // the pieces the video opens up (from knot i to i + 1)

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
cpSync(join(kin, 'include'), join(build, 'include'), { recursive: true });
cpSync(join(here, 'kinetic-trace/patch.mjs'), join(build, 'patch.mjs'));
cpSync(join(here, 'kinetic-trace/trace.cpp'), join(build, 'trace.cpp'));
execFileSync('node', ['patch.mjs'], { cwd: build, stdio: 'inherit' });
execFileSync('g++', ['-std=c++20', '-O2', '-ffp-contract=off', '-static', '-Iinclude', 'trace.cpp', '-o', 'trace.exe'], { cwd: build, stdio: 'inherit' });
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
const rounds = [], judges = {}, ends = {};
for (const e of r1) {
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
  walk: Object.fromEntries([WALK, TRIM].map((i) => [i, judges[i].filter((e) => e.phase === 0).map((e) => [e.f, e.legal, r(e.rv, 3), r(e.ra, 3), r(e.rj, 3)])])),
  sweep: Object.fromEntries([WALK, TRIM].map((i) => [i, det[i].sweep.map(([pass, f, i0, i1, o, rv, ra, rj]) => [pass, f, r(i0, 4), r(i1, 4), r(rv, 3), r(ra, 3), r(rj, 3), o <= 1.001 ? 1 : 0])])),
  judge: { walkK1: judgeOut(det[WALK].atK1), walk: judgeOut(det[WALK].chosen), trimK1: judgeOut(det[TRIM].atK1), trim: judgeOut(det[TRIM].chosen) },
  chosen: { [WALK]: ends[WALK].k, [TRIM]: ends[TRIM].k },
  // the trim: the full move tested first, then 16 halvings of the move (mm toward the previous knot)
  bisect: (() => {
    const ph = {};
    for (const e of judges[TRIM]) if (e.phase >= 1 && e.phase < 30) { (ph[e.phase] ||= { move: mm(Math.abs(det[TRIM].pR - det[TRIM].pL) - Math.abs(e.D), 3), legal: 0 }); if (e.legal) ph[e.phase].legal = 1; }
    return Object.keys(ph).map(Number).sort((a, b) => a - b).map((k) => [ph[k].move, ph[k].legal]);
  })(),
  share: r(L.find((e) => e.ev === 'anomaly' && e.kind === 3).detail, 4),
  P: smp.P.map((x) => mm(x, 2)),
  V: smp.V.map((x) => mm(x, 0)),
  A: smp.A.map((x) => mm(x, 0)),
};
writeFileSync(join(here, 'handles-data.js'), `// Generated by bake-handles.mjs from Kinetic ${sha} (matches the deployed kinetic2.wasm). Do not edit.\nwindow.HDATA = ${JSON.stringify(data)};\n`);
console.log('handles-data.js:', sha, 'trim keeps', data.share, 'walk', JSON.stringify(data.walk[WALK].map((w) => w[0] + (w[1] ? '+' : '-'))));
