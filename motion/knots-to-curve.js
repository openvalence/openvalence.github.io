const H = HDATA, K = H.knots, F = H.final, N = K.length, WP = H.walkPiece, TP = H.trimPiece, AN = H.angle, RS = H.resolve;
const [VMAX, AMAX, JMAX] = H.lim, LIMS = H.lim;
const TOL = 1.001;   // handles.hpp kTol: a peak within 0.1% of its ceiling is legal
const HEAD = ['Knots', 'Angles', 'Handle lengths', 'Legality check', 'Trim', '1 ms samples'];
const X = (t) => 64 + t * 196, Y = (p) => 410 - p * 2.9;            // the main plot
const DX0 = 812, DX1 = 1228, DY0 = 136, DY1 = 380;                    // the detail viewport
const SU0 = 100, SU1 = 640;                                           // the scope's x axis
const ROWS = [{ y: 510, h: 26, key: 3, lim: VMAX, name: 'v', unit: 'mm/s' }, { y: 576, h: 26, key: 4, lim: AMAX, name: 'a', unit: 'mm/s²' }, { y: 642, h: 26, key: 5, lim: JMAX, name: 'j', unit: 'mm/s³' }];
const FEED0 = 2700;
// per-item step times, s: knots in, classes, sweeps 2 to 4, the judge's first 3 samples and the other 8, factors walked, strip ticks
const D = { in: 0.13, cls: 0.18, sw: 0.5, s3: 0.33, s11: 0.2, fill: 0.06, feed: 0.3 };                                                   // ms: where the strip is shown tick by tick
const fmt = (x, d = 0) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const big = (x) => Math.abs(x) >= 1e6 ? fmt(x / 1e6, 2) + ' M' : fmt(x);
const sgn = (x) => (x > 0 ? '+' : '') + fmt(x, 1);
const ms = (s) => Math.round(s * 1000);
let g = {}, s;

// ---- the data the stops and the log read (all from the trace) ----
const W4 = H.walk[WP], W6 = H.walk[TP], B = H.bisect, J = H.judge.walk, SW4 = H.sweep[WP].filter((r) => r[0] === 0), SW6 = H.sweep[TP].filter((r) => r[0] === 0);
const FULL = K[TP + 1].p - K[TP].p, SPAN6 = ms(K[TP + 1].t - K[TP].t), SPAN4 = ms(K[WP + 1].t - K[WP].t);
const COUNT = ['through', 'crest', 'end'].map((c) => K.filter((k) => k.cls === c).length);
// the bisection's bracket after each test: [lo, hi] mm of move (lo over, hi legal)
const BR = (() => { let lo = 0, hi = B[0][0]; return B.map((b, i) => { if (i) { if (b[1]) hi = b[0]; else lo = b[0]; } return [lo, hi]; }); })();
const atFloor = SW6.filter((r) => r[2] <= H.floor + 1e-6 && r[1] < 1).map((r) => r[1]);   // shorter factors whose handles sit at the floor
const aOk6 = W6.filter((w) => w[3] <= AMAX * TOL);                                           // factors where acceleration passes on piece 6
const vOk4 = SW4.filter((r) => r[4] <= TOL).map((r) => r[1]), aOk4 = SW4.filter((r) => r[5] <= TOL).map((r) => r[1]);
const hiS = (k) => J.samples.reduce((m, x) => Math.abs(x[k]) > Math.abs(m[k]) ? x : m);
const overList = (v, a, j) => [[v, VMAX, 'speed', fmt(v, 1) + ' mm/s'], [a, AMAX, 'acceleration', fmt(a) + ' mm/s²'], [j, JMAX, 'jerk', big(j) + ' mm/s³']].filter(([x, m]) => x > m * TOL).map((x) => x[2] + ' ' + x[3]).join(' and ');
const mmf = (x) => { const t = fmt(x, 3); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };

// ---- the timeline: seg() runs a reveal, hold() keeps its result on screen and is a stepper stop ----
const A = {}, STEPS = [], BEAT = [];
let DUR = 0;
{
  let c = 0;
  const seg = (n, d) => { A[n] = c; c += d; };
  const hold = (n, d, note) => { A[n] = c; c += d; STEPS.push({ id: n, beat: BEAT.length - 1, at: +(c - Math.min(0.35, d / 2)).toFixed(2), note }); };
  const beat = (n) => { BEAT.push(c); A[n] = c; };
  const peaks = (v, a, j) => `${fmt(v, 1)} mm/s, ${fmt(a)} mm/s², ${big(j)} mm/s³`;
  // 1 Knots
  beat('b1');
  seg('in', 1.8);
  hold('hIn', 1.1, `${N} knots, each a time and a position. No speeds and no handles yet: the planner works those out.`);
  seg('chords', 0.5);
  seg('cls', N * D.cls);
  hold('hCls', 1.2, `Each knot is classed by its two chords. Where their signs differ the stroke turns: a crest. Here ${COUNT[1]} crests, ${COUNT[0]} through points, ${COUNT[2]} ends.`);
  // 2 Angles
  beat('b2');
  seg('flat', 0.7);
  seg('terms', 1.0);
  seg('pchip', 0.4);
  hold('hPchip', 1.2, `Crests and ends lie flat. Knot ${AN.i} is a through point: pchip takes a weighted harmonic mean of its chords, ${fmt(AN.dIn, 1)} and ${fmt(AN.dOut, 1)} mm/s, and gets ${fmt(AN.pchip, 1)} mm/s.`);
  seg('band', 0.4);
  hold('hBand', 1.1, `The monotone band runs from 0 to 3 times the smaller chord, ${fmt(AN.hi, 1)} mm/s. An angle inside it never overshoots between knots that keep climbing.`);
  seg('sw1', 0.6);
  hold('hSw1', 1.1, `Sweep 1: the acceleration at knot ${AN.i} is ${fmt(AN.sweeps[0][2], 1)} mm/s² from the left and ${fmt(AN.sweeps[0][3], 1)} from the right. The angle that makes them equal: ${fmt(AN.sweeps[0][1], 1)} mm/s.`);
  seg('sw', 3 * D.sw);
  hold('hSw', 1.2, `Knot ${AN.i + 1} moves in each sweep too, so the next one starts a little off: ${fmt(AN.sweeps[1][2], 1)} against ${fmt(AN.sweeps[1][3], 1)}, then ${fmt(AN.sweeps[2][2], 1)} against ${fmt(AN.sweeps[2][3], 1)}. After 4: ${fmt(AN.sweeps[3][1], 1)} mm/s, inside the band.`);
  // 3 Handle lengths
  beat('b3');
  seg('handles', 0.8);
  hold('hThird', 1.0, `Every handle starts at a third of its span: the cubic Hermite. Piece ${WP} to ${WP + 1} climbs ${fmt(K[WP + 1].p - K[WP].p)} mm in ${SPAN4} ms.`);
  seg('k1', 1.2);
  hold('hK1', 1.1, `k 1.00: the judge reads u 0, then u 1, then u 0.5, where speed is ${fmt(W4[0][2], 1)} mm/s, over ${fmt(VMAX)}. It stops at the first sample over.`);
  seg('skip', 0.3);
  hold('hSkip', 1.3, 'Speed over wants shorter handles: they start the move sooner and finish it later, so the middle gets more time and runs slower. k above 1 is skipped.');
  W4.slice(1).forEach((w, j) => {
    seg('w' + (j + 1), 0.5);
    hold('hW' + (j + 1), w[1] ? 1.1 : 0.9, `k ${w[0].toFixed(2)}: both handles ${(w[0] / 3).toFixed(3)} of the span. ` + (w[1] ? `Peaks ${peaks(w[2], w[3], w[4])}, all under. Legal.` : `Speed ${fmt(w[2], 1)} mm/s, still over.`));
  });
  seg('bounds', 0.6);
  hold('hBounds', 1.4, `Every factor at once: speed passes only at k ${Math.max(...vOk4).toFixed(2)} and below, acceleration only from ${Math.min(...aOk4).toFixed(2)} up. One factor passes all three, and the walk reached it ${['first', 'second', 'third', 'fourth', 'fifth'][W4.length - 1]}.`);
  // 4 Legality check
  beat('b4');
  seg('s3', 0.4 + 3 * D.s3);
  hold('hS3', 1.1, `The judge reads the ends first, then the middle: short handles spike acceleration and jerk at the ends, so a bad piece fails early. Here: ${fmt(Math.abs(J.samples[0][2]))} mm/s² at u 0.`);
  seg('s11', 8 * D.s11);
  hold('hS11', 1.0, `11 samples. Highest: speed ${fmt(hiS(1)[1], 1)} mm/s at u ${hiS(1)[0]}, acceleration ${fmt(Math.abs(hiS(2)[2]))} mm/s² at u ${hiS(2)[0]}, jerk ${big(Math.abs(hiS(3)[3]))} mm/s³ at u ${hiS(3)[0]}.`);
  const segOf = (u, n) => `u ${mmf(Math.floor(u * n) / n)} to ${mmf((Math.floor(u * n) + 1) / n)}`;
  const turn = (r, n, what, by, unit, d) => r.length
    ? `${what} peaks where ${by} is 0. Of ${n} segments, ${segOf(r[0][0], n)} changes sign; the turn is at u ${r[0][0]}, ${fmt(Math.abs(r[0][1]), d)} ${unit}.`
    : `${what} peaks where ${by} is 0. No sign change in ${n} segments, so the samples hold its peak:`;
  seg('rv', 0.5);
  hold('hRv', 1.1, turn(J.rootsV, 6, 'Speed', 'acceleration', 'mm/s', 1));
  seg('ra', 0.4);
  hold('hRa', 1.0, turn(J.rootsA, 8, 'Acceleration', 'jerk', 'mm/s²', 0) + (J.rootsA.length ? '' : ` ${fmt(Math.abs(hiS(2)[2]))} mm/s² at u ${hiS(2)[0]}.`));
  seg('rj', 0.4);
  hold('hRj', 1.0, turn(J.rootsJ, 10, 'Jerk', 'its slope', 'mm/s³', 0) + ` The ends stay higher, ${big(J.over[3] * JMAX)} mm/s³.`);
  seg('verdict', 0.3);
  hold('hVerdict', 1.1, `Peaks ${peaks(J.over[1] * VMAX, J.over[2] * AMAX, J.over[3] * JMAX)}: ${J.over[1].toFixed(3)}, ${J.over[2].toFixed(3)} and ${J.over[3].toFixed(3)} of the ceilings. Legal.`);
  // 5 Trim
  beat('b5');
  seg('t1', 0.7);
  hold('hT1', 1.2, `Piece ${TP} to ${TP + 1}: ${FULL} mm in ${SPAN6} ms. At k 1.00 speed is ${fmt(W6[0][2])} mm/s and acceleration ${fmt(W6[0][3])} mm/s², both over, so the walk tries both sides.`);
  seg('fill', (W6.length - 1) * D.fill);
  hold('hShort', 1.3, `Shorter handles: speed falls to ${fmt(W6.find((w) => w[0] === atFloor[0])[2], 1)} mm/s and stops, since from k ${atFloor[0].toFixed(2)} down the handles sit at the floor, ${H.floor} of the span. Acceleration climbs to ${fmt(Math.max(...W6.map((w) => w[3])))}.`);
  hold('hLong', 1.3, `Longer handles: acceleration drops under ${fmt(AMAX)} at k ${aOk6.map((w) => w[0].toFixed(2)).join(' and ')}, but speed is ${fmt(aOk6[0][2])} mm/s there, and ${fmt(W6[W6.length - 1][2])} mm/s at k ${W6[W6.length - 1][0].toFixed(2)}.`);
  hold('hWhy', 1.5, `${FULL} mm in ${SPAN6} ms averages ${fmt(K[TP + 1].dIn)} mm/s. From rest to rest the peak sits above the average, and the shortest handles still reach ${fmt(W6.find((w) => w[0] === atFloor[0])[2], 1)}. No length fits.`);
  seg('trim', 0.4);
  const stepNote = (i) => {
    const b = B[i], [lo, hi] = BR[i];
    return `Step ${i}: move ${fmt(b[0], 3)} mm, keeps ${fmt(b[2], 3)} of ${FULL} mm. ` + (b[1]
      ? `Legal${b[4] > VMAX ? ' within 0.1%' : ''} at ${fmt(b[4], 1)} mm/s`
      : `Over: ${overList(b[4], b[5], b[6])}`) + `. The answer lies between ${mmf(lo)} and ${mmf(hi)} mm.`;
  };
  B.forEach((b, i) => {
    const stop = i <= 3 || i === 7 || i === B.length - 1;
    seg('bs' + i, stop ? 0.35 : i <= 6 ? 0.25 : 0.12);
    if (!stop) return;
    hold('hb' + i, i === B.length - 1 ? 1.3 : 0.9, i === 0
      ? `So knot ${TP + 1} moves toward knot ${TP} and keeps its time. Step 0 tests the full move, ${fmt(b[0])} mm, a zero stroke: legal, so the answer lies between 0 and ${fmt(b[0])} mm.`
      : i === B.length - 1
        ? `Step ${i}: move ${fmt(b[0], 3)} mm, keeps ${fmt(b[2], 3)} of ${FULL} mm, ${fmt(b[3] * 100, 2)}%. Speed ${fmt(b[4], 1)} mm/s is within 0.1%: legal. Knot ${TP + 1} keeps its time, ${K[TP + 1].t.toFixed(3)} s.`
        : stepNote(i));
  });
  seg('resolve', 0.8);
  hold('hResolve', 1.2, `Round 2 solves again on the trimmed chords. Knot ${RS.i}'s chord in is now ${fmt(RS.dIn, 1)} mm/s: pchip gives ${fmt(RS.pchip, 1)}, the sweeps ${fmt(RS.vel, 1)} mm/s.`);
  // 6 1 ms samples
  beat('b6');
  seg('render', 1.0);
  hold('hRender', 1.0, 'The pieces join as one composite Bézier. Where two pieces meet with different accelerations, a corner ramp at jmax joins them.');
  seg('grid', 0.5);
  hold('hGrid', 1.0, `The engine reads the curve every 1 ms: ${fmt(H.P.length)} samples for ${(H.P.length - 1) / 1000} s. At ${fmt(FEED0)} ms: ${fmt(H.P[FEED0], 2)} mm, ${fmt(H.V[FEED0])} mm/s.`);
  seg('feed', 6 * D.feed);
  hold('hFeed', 1.1, 'Nucleus keeps 128 samples ahead. Each 1 ms the motor takes the one at now and the next is read at the far end, so a stall under 128 ms never reaches the motor.');
  seg('ride', 3.5);
  hold('hEnd', 0.5, `The carriage rides the samples in real time: ${fmt(H.P.length)} positions over ${(H.P.length - 1) / 1000} s.`);
  seg('out', 0.35);
  DUR = +c.toFixed(2);
  BEAT.push(DUR);
}
const OFFSET = +(A.ride + 0.4).toFixed(2);   // frame 0 is the poster: the finished curve, the ride under way

const txt = (p, x, y, str, cls, size, fill, anchor = 'start', extra = {}) => { const e = el('text', { x, y, class: cls, 'font-size': size, fill, 'text-anchor': anchor, ...extra }, p); e.textContent = str; return e; };
const line = (p, x1, y1, x2, y2, stroke, w = 1.5, extra = {}) => el('line', { x1, y1, x2, y2, stroke, 'stroke-width': w, ...extra }, p);
const op = (e, v) => e.setAttribute('opacity', clamp(v).toFixed(3));
const within = (t, a, b, fi = 0.3, fo = 0.3) => ramp(t, a, a + fi) * (1 - ramp(t, b - fo, b));
const path = (pts) => pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
const setL = (e, x1, y1, x2, y2) => { e.setAttribute('x1', x1); e.setAttribute('y1', y1); e.setAttribute('x2', x2); e.setAttribute('y2', y2); };
const paint = (e, fill, weight) => { e.setAttribute('fill', fill); if (weight) e.setAttribute('font-weight', weight); };
// a line of mono text in parts, [[text, fill?]], each a tspan the draw can recolor
function rich(p, x, y, parts, size = 13) {
  const e = el('text', { x, y, class: 'mono', 'font-size': size, style: 'white-space:pre' }, p);
  const sp = parts.map(([str, fill]) => { const t = el('tspan', { fill: fill || C.ink2 }, e); t.textContent = str; return t; });
  return { e, sp };
}
// A cubic Bezier's point (the piece's control points; evalPiece's curve).
const bez = (P, u) => { const w = 1 - u; return [0, 1].map((d) => w * w * w * P[0][d] + 3 * u * w * w * P[1][d] + 3 * u * u * w * P[2][d] + u * u * u * P[3][d]); };
// Control points of piece i (t, p) from angles, lengths and rendered positions; pT: knot TP + 1's position now.
function ctrl(i, sel, pT) {
  const fin = sel === 'final', pos = (j) => j === TP + 1 ? pT : fin ? F[j].p : K[j].p;
  const L = fin ? F[i] : K[i], R = fin ? F[i + 1] : K[i + 1];
  const tL = K[i].t, tR = K[i + 1].t, T = tR - tL;
  const lo = fin ? F[i].effOut : 1 / 3, li = fin ? F[i + 1].effIn : 1 / 3;
  return [[tL, pos(i)], [tL + lo * T, pos(i) + L.vel * lo * T], [tR - li * T, pos(i + 1) - R.vel * li * T], [tR, pos(i + 1)]];
}

function frame(p, x, y, w, h, title) {
  el('rect', { x, y, width: w, height: h, rx: 8, fill: C.bg2, stroke: C.rule, 'stroke-width': 1.5 }, p);
  return txt(p, x + 14, y + 20, title, 'mono', 11, C.ink3, 'start', { 'letter-spacing': '0.08em' });
}

function setup() {
  s = document.getElementById('scene');
  g = {};
  el('rect', { width: 1280, height: 720, fill: C.bg }, s);
  const defs = el('defs', {}, s);
  // ---- main plot ----
  frame(s, 32, 88, 740, 352, 'TIME S · POSITION MM');
  for (let i = 0; i <= 34; i++) line(s, X(i / 10), Y(100) - 6, X(i / 10), Y(0), C.rule, i % 5 ? 0.6 : 1.2);
  for (let p = 0; p <= 100; p += 25) line(s, X(0), Y(p), X(3.4), Y(p), C.rule, p % 50 ? 0.6 : 1.2);
  for (let i = 0; i <= 3; i++) txt(s, X(i), 430, i + ' s', 'mono', 11, C.ink3, 'middle');
  for (const p of [0, 50, 100]) txt(s, 58, Y(p) + 4, String(p), 'mono', 11, C.ink3, 'end');
  g.chords = K.slice(1).map((k, i) => line(s, X(K[i].t), Y(K[i].p), X(k.t), Y(k.p), C.line3, 1.5, { 'stroke-dasharray': '4 4', opacity: 0 }));
  g.arms = []; g.dots = [];
  for (let i = 0; i + 1 < N; i++) {
    g.arms.push([line(s, 0, 0, 0, 0, C.accentInk, 1.4, { opacity: 0 }), line(s, 0, 0, 0, 0, C.accentInk, 1.4, { opacity: 0 })]);
    g.dots.push([el('circle', { r: 3, fill: C.accentInk, opacity: 0 }, s), el('circle', { r: 3, fill: C.accentInk, opacity: 0 }, s)]);
  }
  g.dirs = K.map(() => line(s, 0, 0, 0, 0, C.ink, 2.2, { 'stroke-linecap': 'round', opacity: 0 }));
  el('rect', { x: X(0), y: 0, width: 0, height: 720 }, el('clipPath', { id: 'rev' }, defs));
  g.rev = defs.querySelector('#rev rect');
  let d = '';
  for (let i = 0; i < H.P.length; i += 4) d += (i ? 'L' : 'M') + X(i / 1000).toFixed(1) + ' ' + Y(H.P[i]).toFixed(1);
  g.curve = el('path', { d, fill: 'none', stroke: C.accentInk, 'stroke-width': 4, 'stroke-linejoin': 'round', 'clip-path': 'url(#rev)', opacity: 0 }, s);
  g.focus = el('rect', { rx: 4, fill: 'none', stroke: C.accentInk, 'stroke-width': 1.5, 'stroke-dasharray': '3 3', opacity: 0 }, s);
  g.ghost = el('circle', { cx: X(K[TP + 1].t), cy: Y(K[TP + 1].p), r: 6, fill: 'none', stroke: C.ink3, 'stroke-width': 1.5, 'stroke-dasharray': '2 2', opacity: 0 }, s);
  g.ring = el('circle', { r: 12, fill: 'none', stroke: C.accentInk, 'stroke-width': 2, opacity: 0 }, s);
  g.knots = K.map((k) => el('circle', { cx: X(k.t), cy: Y(k.p), r: 0, fill: C.bg2, stroke: C.ink, 'stroke-width': 2.4 }, s));
  g.tags = K.map((k, i) => {
    const up = i > 0 && i < N - 1 && k.p > (K[i - 1].p + K[i + 1].p) / 2;
    return txt(s, X(k.t), Y(k.p) + (up ? -12 : 20), k.cls === 'through' ? 'thru' : k.cls, 'mono', 10, k.cls === 'through' ? C.accentInk : C.ink3, 'middle', { opacity: 0 });
  });
  g.head = el('circle', { r: 6, fill: C.accentInk, opacity: 0 }, s);
  g.now = line(s, 0, Y(100) - 6, 0, Y(0), C.accentInk, 1.2, { 'stroke-dasharray': '2 3', opacity: 0 });
  el('rect', { x: 748, y: Y(100) - 8, width: 10, height: Y(0) - Y(100) + 16, rx: 5, fill: C.bg3, stroke: C.line3 }, s);
  g.car = el('rect', { x: 740, width: 26, height: 14, rx: 3, fill: C.accent }, s);
  // ---- the detail viewport, one group per beat ----
  g.detTitle = frame(s, 792, 88, 456, 352, '');
  g.det = [0, 1, 2, 3, 4, 5].map(() => el('g', { opacity: 0 }, s));
  buildTable(g.det[0]); buildAngle(g.det[1]); buildPiece(g.det[2], WP, 'walk'); buildSamples(g.det[3]); buildPiece(g.det[4], TP, 'trim'); buildStrip(g.det[5]);
  // ---- the scope ----
  g.scTitle = frame(s, 32, 456, 740, 248, '');
  g.pill = el('g', { opacity: 0 }, s);
  g.pillBg = el('rect', { x: 688, y: 466, width: 76, height: 22, rx: 11 }, g.pill);   // clear of the v ceiling label (646 to 682)
  g.pillTx = txt(g.pill, 726, 481, '', 'kick', 13, '#fff', 'middle');
  g.work1 = buildClasses(); g.work2 = buildWork();
  g.scopes = {
    k1: scope('walkK1', true), walk: scope('walk', true), trimK1: scope('trimK1'),
    // the walk's other tried factors, in the order it tried them (k 1 first, the chosen last)
    tried: W4.slice(1, -1).map((w) => scope(H.walkAt[w[0]], true)),
  };
  g.kp4 = kplot(WP); g.kp6 = kplot(TP);
  g.bp = bplot();
  g.time = timeScope();
  // ---- the log ----
  frame(s, 792, 456, 456, 248, 'COMPUTING');
  g.log = Array.from({ length: 9 }, (_, i) => txt(s, 808, 492 + i * 23, '', 'mono', 13, C.ink2, 'start', { style: 'white-space:pre' }));
  g.cursor = el('rect', { width: 8, height: 14, fill: C.accentInk }, s);
  // ---- the band ----
  el('rect', { width: 1280, height: 72, fill: C.accent }, s);
  el('rect', { width: 1280, height: 72 }, el('clipPath', { id: 'hc' }, defs));
  const hg = el('g', { 'clip-path': 'url(#hc)' }, s);
  g.heads = HEAD.map((w, i) => {
    const e = el('g', {}, hg);
    txt(e, 40, 50, '0' + (i + 1), 'mono', 16, '#fff', 'start', { opacity: 0.75 });
    txt(e, 78, 52, w, 'disp', 40, '#fff');
    return e;
  });
  txt(s, 1112, 44, 'Kinetic² · real planner trace', 'kick', 13, '#fff', 'end', { opacity: 0.85 });   // clear of the page's pause button
}

// B1: the knots as the planner gets them, then their chords and classes
const TC = { k: 812, t: 886, p: 946, dIn: 1030, dOut: 1112, cls: 1128 };
function buildTable(p) {
  g.rowBar = el('rect', { x: 802, width: 436, height: 20, rx: 3, fill: C.bg3, opacity: 0 }, p);
  txt(p, TC.k, 136, 'k', 'mono', 12, C.ink3); txt(p, TC.t, 136, 't s', 'mono', 12, C.ink3, 'end'); txt(p, TC.p, 136, 'p mm', 'mono', 12, C.ink3, 'end');
  g.chHead = el('g', { opacity: 0 }, p);
  txt(g.chHead, TC.dIn, 136, 'dIn', 'mono', 12, C.ink3, 'end'); txt(g.chHead, TC.dOut, 136, 'dOut', 'mono', 12, C.ink3, 'end'); txt(g.chHead, TC.cls, 136, 'class', 'mono', 12, C.ink3);
  g.rows = K.map((k, i) => {
    const e = el('g', { opacity: 0 }, p), y = 160 + i * 22, r = { e, y };
    r.cells = [txt(e, TC.k, y, String(i), 'mono', 13, C.ink3), txt(e, TC.t, y, k.t.toFixed(3), 'mono', 13, C.ink, 'end'), txt(e, TC.p, y, k.p.toFixed(1), 'mono', 13, C.ink, 'end')];
    r.ch = [i ? txt(e, TC.dIn, y, sgn(k.dIn), 'mono', 13, C.ink2, 'end', { opacity: 0 }) : null, i < N - 1 ? txt(e, TC.dOut, y, sgn(k.dOut), 'mono', 13, C.ink2, 'end', { opacity: 0 }) : null].filter(Boolean);
    r.cls = txt(e, TC.cls, y, k.cls, 'mono', 13, k.cls === 'through' ? C.accentInk : k.cls === 'crest' ? C.ink : C.ink2, 'start', { opacity: 0 });
    return r;
  });
}
// B1's working panel: the rule, then the knot being classed
function buildClasses() {
  const e = el('g', { opacity: 0 }, s), o = { e };
  o.intro = txt(e, 48, 500, 'A class from the two chords, the slopes in and out (mm/s):', 'mono', 13, C.ink2);
  o.inSum = rich(e, 48, 676, [[`${N} knots`, C.ink], ['  ·  ', C.ink3], [`${2 * N} numbers`, C.ink], ['  ·  ', C.ink3], ['no speeds, no handles', C.ink3]], 16).e;
  o.rules = [['end', 'the first or the last knot'], ['crest', 'the signs differ: the stroke turns'], ['through', 'the same sign: the stroke carries on']].map(([a, b], i) => {
    const r = rich(e, 48, 530 + i * 22, [[a.padEnd(10), C.ink], [b, C.ink3]]);
    return r;
  });
  o.cur = rich(e, 48, 624, [['', C.ink3], ['', C.ink], ['', C.ink], ['', C.ink3], ['', C.accentInk]], 20);
  o.sum = rich(e, 48, 676, [[`${COUNT[0]} through`, C.accentInk], ['  ·  ', C.ink3], [`${COUNT[1]} crest`, C.ink], ['  ·  ', C.ink3], [`${COUNT[2]} end`, C.ink2]], 16);
  return o;
}
// B2: knot 1 up close: its two chords, pchip's angle, the band, the G2 sweeps
function buildAngle(p) {
  const i = AN.i, k = K[i], t0 = K[i - 1].t - 0.05, t1 = K[i + 1].t + 0.05, p0 = 0, p1 = 80;
  const x = (t) => DX0 + (t - t0) / (t1 - t0) * (DX1 - DX0), y = (q) => DY1 - (q - p0) / (p1 - p0) * (DY1 - DY0);
  const slope = (v, len) => { const dx = len, dt = dx / ((DX1 - DX0) / (t1 - t0)); return [x(k.t) - dx, y(k.p + (-v) * dt), x(k.t) + dx, y(k.p + v * dt)]; };
  const w = (v) => { const [x1, y1, x2, y2] = slope(v, 150); return [[x1, y1], [x2, y2]]; };
  const lo = w(AN.lo), hi = w(AN.hi);
  g.band = el('path', { d: `M${x(k.t)} ${y(k.p)}L${lo[1][0]} ${lo[1][1]}L${hi[1][0]} ${hi[1][1]}ZM${x(k.t)} ${y(k.p)}L${lo[0][0]} ${lo[0][1]}L${hi[0][0]} ${hi[0][1]}Z`, fill: C.accent, opacity: 0 }, p);
  g.angChords = [];
  for (const j of [i - 1, i, i + 1]) {
    if (j < i + 1) g.angChords.push(line(p, x(K[j].t), y(K[j].p), x(K[j + 1].t), y(K[j + 1].p), C.line3, 2, { 'stroke-dasharray': '5 4' }));
    el('circle', { cx: x(K[j].t), cy: y(K[j].p), r: j === i ? 7 : 5, fill: C.bg2, stroke: C.ink, 'stroke-width': 2.4 }, p);
  }
  g.dInLbl = txt(p, (x(K[i - 1].t) + x(k.t)) / 2 - 8, (y(K[i - 1].p) + y(k.p)) / 2 + 34, 'dIn ' + AN.dIn.toFixed(1), 'mono', 12, C.ink3, 'middle');
  g.dOutLbl = txt(p, (x(K[i + 1].t) + x(k.t)) / 2 + 30, (y(K[i + 1].p) + y(k.p)) / 2 + 12, 'dOut ' + AN.dOut.toFixed(1), 'mono', 12, C.ink3, 'middle');
  g.angLine = line(p, 0, 0, 0, 0, C.accentInk, 3, { 'stroke-linecap': 'round' });
  g.angSlope = (v) => { const [x1, y1, x2, y2] = slope(v, 110); setL(g.angLine, x1, y1, x2, y2); };
  g.angRead = txt(p, DX0, 412, '', 'mono', 15, C.ink);
  g.bandLbl = txt(p, DX0, 150, `band 0 to ${fmt(AN.hi, 1)} mm/s`, 'mono', 12, C.ink3, 'start', { opacity: 0 });
}
// B2's working panel: pchip at knot 1 term by term, the band, then each sweep
function buildWork() {
  const e = el('g', { opacity: 0 }, s), o = { e }, a = AN, f3 = (x) => x.toFixed(3);
  o.r = [
    rich(e, 48, 498, [['chords   ', C.ink3], [`dIn ${fmt(a.dIn, 1)} mm/s over h1 ${f3(a.h1)} s`], ['     '], [`dOut ${fmt(a.dOut, 1)} mm/s over h2 ${f3(a.h2)} s`]]),
    rich(e, 48, 520, [['weights  ', C.ink3], [`w1 = 2 h2 + h1 = ${f3(a.w1)}`], ['     '], [`w2 = h2 + 2 h1 = ${f3(a.w2)}`]]),
    rich(e, 48, 542, [['pchip    ', C.ink3], ['(w1 + w2) / (w1 / dIn + w2 / dOut) = '], [`${fmt(a.pchip, 1)} mm/s`, C.accentInk]]),
    rich(e, 48, 564, [['band     ', C.ink3], ['0 to 3 × the smaller chord = '], [`${fmt(a.hi, 1)} mm/s`, C.ink]]),
  ];
  o.head = rich(e, 48, 598, [['sweep    ', C.ink3], ['a from left  a from right', C.ink3], ['   →  ', C.ink3], ['angle mm/s   a both sides', C.ink3]], 12);
  o.sw = a.sweeps.map((w, i) => rich(e, 48, 620 + i * 21, [[`${i + 1}`.padEnd(9), C.ink3], [fmt(w[2], 1).padStart(11)], [fmt(w[3], 1).padStart(14)], ['   →  ', C.ink3], [fmt(w[1], 1).padStart(10)], [fmt(w[4], 1).padStart(15)]]));
  o.unit = txt(e, 756, 598, 'mm/s²', 'mono', 11, C.ink3, 'end');
  return o;
}
// B3 and B5: one piece up close, its control polygon, and the length-factor ruler
function buildPiece(p, i, kind) {
  const A_ = K[i], B_ = K[i + 1], pad = (B_.t - A_.t) * 0.12;
  const t0 = A_.t - pad, t1 = B_.t + pad, p0 = 0, p1 = 105;
  const x = (t) => DX0 + (t - t0) / (t1 - t0) * (DX1 - DX0), y = (q) => DY1 - 36 - (q - p0) / (p1 - p0) * (DY1 - DY0 - 46);
  const o = { x, y, i };
  o.curve = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 3 }, p);
  o.poly = el('polyline', { fill: 'none', stroke: C.ink3, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, p);
  o.arms = [line(p, 0, 0, 0, 0, C.accentInk, 2), line(p, 0, 0, 0, 0, C.accentInk, 2)];
  o.cp = [0, 1, 2, 3].map((j) => el('circle', { r: j % 3 ? 5 : 7, fill: j % 3 ? C.accentInk : C.bg2, stroke: j % 3 ? 'none' : C.ink, 'stroke-width': 2.4 }, p));
  o.lbl = [txt(p, 0, 0, '', 'mono', 11, C.accentInk, 'middle'), txt(p, 0, 0, '', 'mono', 11, C.accentInk, 'middle')];
  if (kind === 'trim') {
    o.timeLine = line(p, x(B_.t), DY0 + 30, x(B_.t), y(0), C.ink3, 1.2, { 'stroke-dasharray': '2 4' });
    o.timeLbl = txt(p, x(B_.t) - 6, y(0) - 4, 'time kept: ' + B_.t.toFixed(3) + ' s', 'mono', 11, C.ink3, 'end');
    o.ghost = el('circle', { cx: x(B_.t), cy: y(B_.p), r: 7, fill: 'none', stroke: C.ink3, 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }, p);
    o.lo = line(p, x(B_.t) - 26, 0, x(B_.t) + 26, 0, C.ink2, 1.5); o.hi = line(p, x(B_.t) - 26, 0, x(B_.t) + 26, 0, C.ink2, 1.5);
    o.mid = el('circle', { cx: x(B_.t), r: 5 }, p);
  }
  o.read = rich(p, DX0, 140, [['', C.ink], ['', C.ink3]], 13);
  o.read2 = rich(p, DX0, 160, [['', C.ink3], ['', C.ink], ['', C.ink3], ['', C.ink], ['', C.ink3]], 13);
  // the ruler: k 0.2 .. 2.0, four rows (v, a, j, all) of the 37 factors on the k grid
  const rx = (k) => 846 + (k - 0.2) / 1.8 * 374, ry0 = 366;
  o.ruler = el('g', {}, p);
  txt(o.ruler, 812, ry0 - 6, 'k', 'mono', 11, C.ink3);
  for (const k of [0.2, 0.5, 1, 1.5, 2]) txt(o.ruler, rx(k), ry0 + 62, String(k), 'mono', 11, C.ink3, 'middle');
  o.cells = {};
  const sw = H.sweep[i].filter((r) => r[0] === 0);
  ['v', 'a', 'j', 'all'].forEach((nm, row) => {
    txt(o.ruler, 834, ry0 + row * 12 + 9, nm, 'mono', 10, C.ink3, 'end');
    o.cells[nm] = sw.map((r) => el('rect', { x: rx(r[1]) - 4.5, y: ry0 + row * 12, width: 9, height: 10, rx: 2, fill: C.bg3 }, o.ruler));
  });
  o.colRing = el('rect', { y: ry0 - 3, width: 13, height: 52, rx: 3, fill: 'none', stroke: C.ink, 'stroke-width': 1.5, opacity: 0 }, o.ruler);
  o.mark = el('path', { d: 'M0 0l-5 -8h10z', fill: C.ink }, o.ruler);
  o.skip = el('rect', { x: rx(1.025), y: ry0 - 2, width: rx(2.0) - rx(1.025) + 6, height: 52, fill: C.bg2, opacity: 0 }, o.ruler);
  o.skipLbl = txt(o.ruler, (rx(1.05) + rx(2)) / 2, ry0 + 28, 'skipped: cannot help', 'mono', 11, C.ink3, 'middle', { opacity: 0 });
  o.rx = rx; o.ry0 = ry0; o.sw = sw;
  g['piece' + kind] = o;
}
function setPiece(o, P) {
  const pts = P.map(([t, q]) => [o.x(t), o.y(q)]);
  const c = []; for (let u = 0; u <= 1.0001; u += 0.02) { const [t, q] = bez(P, u); c.push([o.x(t), o.y(q)]); }
  o.curve.setAttribute('d', path(c));
  o.poly.setAttribute('points', pts.map((q) => q.join(',')).join(' '));
  [[0, 1], [3, 2]].forEach(([a, b], j) => setL(o.arms[j], pts[a][0], pts[a][1], pts[b][0], pts[b][1]));
  pts.forEach((q, j) => { o.cp[j].setAttribute('cx', q[0]); o.cp[j].setAttribute('cy', q[1]); });
}
// B4: the judge's 11 samples as it reads them, then the turning points
const SC = { n: 812, u: 868, v: 960, a: 1060, j: 1212 };
function buildSamples(p) {
  g.smBar = el('rect', { x: 802, width: 436, height: 18, rx: 3, fill: C.bg3, opacity: 0 }, p);
  txt(p, SC.n, 134, '#', 'mono', 11, C.ink3); txt(p, SC.u, 134, 'u', 'mono', 11, C.ink3, 'end'); txt(p, SC.v, 134, 'v mm/s', 'mono', 11, C.ink3, 'end'); txt(p, SC.a, 134, 'a mm/s²', 'mono', 11, C.ink3, 'end'); txt(p, SC.j, 134, 'j mm/s³', 'mono', 11, C.ink3, 'end');
  g.smRows = J.samples.map((sm, i) => {
    const e = el('g', { opacity: 0 }, p), y = 152 + i * 18;
    return { e, y, c: [txt(e, SC.n, y, String(i + 1), 'mono', 12, C.ink3), txt(e, SC.u, y, String(sm[0]), 'mono', 12, C.ink2, 'end'), txt(e, SC.v, y, fmt(sm[1], 1), 'mono', 12, C.ink2, 'end'), txt(e, SC.a, y, fmt(sm[2]), 'mono', 12, C.ink2, 'end'), txt(e, SC.j, y, fmt(sm[3]), 'mono', 12, C.ink2, 'end')] };
  });
  const tp = (r, d) => r.length ? `u ${r[0][0]}: ${fmt(r[0][1], d)}` : 'none inside';
  g.tp = [['v where a = 0', tp(J.rootsV, 1)], ['a where j = 0', tp(J.rootsA, 0)], ['j where dj/du = 0', tp(J.rootsJ, 0)]].map(([a, b], i) => {
    const r = rich(p, DX0, 364 + i * 19, [[a.padEnd(19), C.ink3], [b, C.ink]], 12);
    r.e.setAttribute('opacity', 0);
    return r;
  });
  g.verdict = rich(p, DX0, 428, [['all under: ', C.ink3], ['LEGAL', C.accentInk]], 13);
}
// B6: the 1 ms grid, 128 ms ahead of now
function buildStrip(p) {
  g.stripTicks = [0, 32, 64, 96, 128].map((m) => txt(p, 0, DY1 - 6, m + ' ms', 'mono', 10, C.ink3, 'middle'));
  g.stripStems = Array.from({ length: 161 }, () => line(p, 0, 0, 0, 0, C.accentInk, 1, { opacity: 0 }));
  g.stripDots = Array.from({ length: 161 }, () => el('circle', { r: 1.4, fill: C.accentInk }, p));
  g.stripNow = line(p, 0, DY0, 0, DY1, C.ink, 1.5);
  g.stripBand = el('rect', { y: DY0, height: DY1 - DY0, fill: C.accent, opacity: 0.16 }, p);
  g.stripLbl = txt(p, 0, DY0 + 14, '128 samples ahead', 'mono', 11, C.accentInk);
  g.stripOut = el('circle', { r: 6, fill: 'none', stroke: C.ink, 'stroke-width': 2, opacity: 0 }, p);
  g.stripIn = el('circle', { r: 6, fill: 'none', stroke: C.accentInk, 'stroke-width': 2, opacity: 0 }, p);
  g.stripInLbl = txt(p, 0, 0, 'read', 'mono', 11, C.accentInk, 'end', { opacity: 0 });
  g.stripOutLbl = txt(p, 0, 0, 'to the motor', 'mono', 11, C.ink, 'end', { opacity: 0 });
  g.stripRead = [0, 1, 2, 3].map((j) => txt(p, DX0 + j * 108, 412, '', 'mono', 13, C.ink));
}
// One judged piece: v, a, j against u, with the ceilings; the parts over a ceiling in red
function scope(key, withMarks) {
  const J_ = typeof key === 'string' ? H.judge[key] : key, e = el('g', { opacity: 0 }, s), o = { e, J: J_ };
  const ux = (u) => SU0 + u * (SU1 - SU0);
  o.ux = ux;
  o.rows = ROWS.map((R, ri) => {
    const peak = Math.max(R.lim, ...J_.dense.map((d) => Math.abs(d[R.key]))), sc = R.h / (peak * 1.05);
    const yy = (v) => R.y - v * sc, r = { yy, sc };
    line(e, SU0, R.y, SU1, R.y, C.rule, 1);
    for (const sg of [1, -1]) line(e, SU0, yy(sg * R.lim), SU1, yy(sg * R.lim), C.ink3, 1, { 'stroke-dasharray': '5 4' });
    txt(e, SU1 + 6, yy(R.lim) + 4, big(R.lim), 'mono', 10, C.ink3);
    txt(e, 48, R.y + 5, R.name, 'mono', 15, C.ink); txt(e, 62, R.y + 5, R.unit, 'mono', 10, C.ink3);
    r.trace = el('path', { d: path(J_.dense.map((d) => [ux(d[0]), yy(d[R.key])])), fill: 'none', stroke: C.accentInk, 'stroke-width': 2 }, e);
    let od = '';
    for (let k = 1; k < J_.dense.length; k++) { const a = J_.dense[k - 1], b = J_.dense[k]; if (Math.abs(a[R.key]) > R.lim * TOL && Math.abs(b[R.key]) > R.lim * TOL) od += `M${ux(a[0]).toFixed(1)} ${yy(a[R.key]).toFixed(1)}L${ux(b[0]).toFixed(1)} ${yy(b[R.key]).toFixed(1)}`; }
    r.over = el('path', { d: od, fill: 'none', stroke: C.bad, 'stroke-width': 3.5, 'stroke-linecap': 'round' }, e);
    if (withMarks) {
      const nseg = [6, 8, 10][ri];
      r.segs = el('g', { opacity: 0 }, e);
      for (let k = 0; k <= nseg; k++) line(r.segs, ux(k / nseg), R.y + R.h + 2, ux(k / nseg), R.y + R.h - 4, C.ink3, 1);
      r.dots = J_.samples.map((sm) => {
        const over = Math.abs(sm[ri + 1]) > R.lim * TOL;
        return el('circle', { cx: ux(sm[0]), cy: yy(sm[ri + 1]), r: over ? 5 : 3.5, fill: over ? C.bad : C.bg2, stroke: over ? C.bad : C.ink, 'stroke-width': 1.6, opacity: 0 }, e);
      });
      r.cur = el('circle', { r: 8, fill: 'none', stroke: C.ink, 'stroke-width': 1.5, opacity: 0 }, e);
      const roots = [J_.rootsV, J_.rootsA, J_.rootsJ][ri];
      r.br = roots.map(([u]) => el('rect', { x: ux(Math.floor(u * nseg) / nseg), y: R.y - R.h, width: (SU1 - SU0) / nseg, height: 2 * R.h, fill: C.accent, opacity: 0 }, e));
      r.roots = roots.map(([u, v]) => { const m = el('g', { opacity: 0 }, e); el('path', { d: `M${ux(u)} ${yy(v) - 8}l-5 -8h10z`, fill: C.accentInk }, m); line(m, ux(u), R.y - R.h, ux(u), R.y + R.h, C.accentInk, 1.5); return m; });
      r.none = roots.length ? null : txt(e, (SU0 + SU1) / 2, R.y + R.h + 12, 'no turning point inside: the samples hold the peak', 'mono', 10, C.ink3, 'middle', { opacity: 0 });
    }
    const ratio = J_.over[ri + 1], over = ratio > TOL;
    r.read = txt(e, 668, R.y + 2, big(ratio * R.lim), 'mono', 15, over ? C.bad : C.ink); r.read2 = txt(e, 668, R.y + 18, '/ ' + big(R.lim) + '  ×' + ratio.toFixed(3), 'mono', 10, over ? C.bad : C.ink3);
    return r;
  });
  txt(e, SU0, 696, 'u 0', 'mono', 10, C.ink3); txt(e, (SU0 + SU1) / 2, 696, '0.5', 'mono', 10, C.ink3, 'middle'); txt(e, SU1, 696, '1', 'mono', 10, C.ink3, 'end');
  return o;
}
// Every factor on the k grid: v, a, j peaks against k, on a log scale around the ceiling
function kplot(i) {
  const e = el('g', { opacity: 0 }, s), sw = H.sweep[i].filter((r) => r[0] === 0), o = { e, sw };
  const kx = (k) => SU0 + (k - 0.2) / 1.8 * (SU1 - SU0), L0 = Math.log2(1 / 16), L1 = Math.log2(64);
  o.rows = ROWS.map((R, ri) => {
    const ly = (r) => R.y + R.h - (Math.log2(clamp(r, 1 / 16, 64)) - L0) / (L1 - L0) * 2 * R.h;
    line(e, SU0, R.y + R.h, SU1, R.y + R.h, C.rule, 1);
    line(e, SU0, ly(1), SU1, ly(1), C.ink3, 1, { 'stroke-dasharray': '5 4' });
    txt(e, 48, R.y + 5, R.name, 'mono', 15, C.ink); txt(e, 62, R.y + 5, R.unit, 'mono', 10, C.ink3);
    const pts = sw.map((r) => { const x = r[4 + ri], over = x > TOL; return el('circle', { cx: kx(r[1]), cy: ly(x), r: 3.5, fill: over ? C.bad : C.accentInk, opacity: 0 }, e); });
    return { pts, read: txt(e, 668, R.y + 2, '', 'mono', 15, C.ink), read2: txt(e, 668, R.y + 18, '', 'mono', 10, C.ink3) };
  });
  o.cur = el('rect', { y: 480, width: 12, height: 196, rx: 3, fill: 'none', stroke: C.ink, 'stroke-width': 1.5, opacity: 0 }, e);
  o.zone = el('rect', { y: 480, height: 196, fill: C.ink, opacity: 0 }, e);
  o.kx = kx;
  txt(e, 668, 696, '- - the ceiling', 'mono', 10, C.ink3);
  for (const k of [0.2, 0.5, 1, 1.5, 2]) txt(e, kx(k), 696, (k === 0.2 ? 'k ' : '') + k, 'mono', 10, C.ink3, k === 0.2 ? 'start' : 'middle');
  return o;
}
// The trim's search: every test's stroke kept and its peaks, the bracket closing in
function bplot() {
  const e = el('g', { opacity: 0 }, s), o = { e };
  const sx = (i) => SU0 + 12 + i / (B.length - 1) * (SU1 - SU0 - 24);
  const rows = [{ y: 510, name: 'kept', unit: 'mm', key: 2, lo: 0, hi: FULL, lim: null }, { y: 576, name: 'v', unit: 'mm/s', key: 4, lo: 0, hi: VMAX * 1.1, lim: VMAX }, { y: 642, name: 'a', unit: 'mm/s²', key: 5, lo: 0, hi: AMAX * 1.1, lim: AMAX }];
  o.rows = rows.map((R) => {
    const yy = (v) => R.y + 24 - (v - R.lo) / (R.hi - R.lo) * 48;
    line(e, SU0, R.y + 24, SU1, R.y + 24, C.rule, 1);
    if (R.lim) { line(e, SU0, yy(R.lim), SU1, yy(R.lim), C.ink3, 1, { 'stroke-dasharray': '5 4' }); txt(e, SU1 + 6, yy(R.lim) + 4, big(R.lim), 'mono', 10, C.ink3); }
    txt(e, 48, R.y + 5, R.name, 'mono', 15, C.ink); txt(e, R.name.length > 1 ? 94 : 62, R.y + 5, R.unit, 'mono', 10, C.ink3);
    const r = { yy, R };
    if (!R.lim) {
      // the bracket on the stroke kept: from FULL - hi (legal) to FULL - lo (over)
      r.band = BR.map(([lo, hi], i) => el('rect', { x: sx(i) - 7, width: 14, y: yy(FULL - lo), height: Math.max(1, yy(FULL - hi) - yy(FULL - lo)), rx: 2, fill: C.accent, opacity: 0 }, e));
    }
    r.pts = B.map((b, i) => el('circle', { cx: sx(i), cy: yy(Math.min(R.hi, b[R.key])), r: 4, fill: b[1] ? C.accentInk : C.bad, opacity: 0 }, e));
    r.read = txt(e, 668, R.y + 6, '', 'mono', 15, C.ink);
    return r;
  });
  o.sx = sx;
  txt(e, sx(0), 696, 'test 0', 'mono', 10, C.ink3, 'middle'); txt(e, sx(B.length - 1), 696, String(B.length - 1), 'mono', 10, C.ink3, 'middle');
  return o;
}
// B6: the engine's 1 ms samples against time
function timeScope() {
  const e = el('g', { opacity: 0 }, s), tx = (t) => SU0 + t / 3.4 * (SU1 - SU0), o = { e, tx };
  const rows = [{ y: 510, h: 26, arr: H.P, lim: null, name: 'p', unit: 'mm', base: 50, sc: 26 / 55 }, { y: 576, h: 26, arr: H.V, lim: VMAX, name: 'v', unit: 'mm/s' }, { y: 642, h: 26, arr: H.A, lim: AMAX, name: 'a', unit: 'mm/s²' }];
  o.rows = rows.map((R) => {
    const peak = R.lim ? Math.max(R.lim, ...R.arr.map(Math.abs)) : 0, sc = R.sc || R.h / (peak * 1.05), base = R.base || 0;
    const yy = (v) => R.y - (v - base) * sc;
    line(e, SU0, R.y, SU1, R.y, C.rule, 1);
    if (R.lim) { for (const sg of [1, -1]) line(e, SU0, yy(sg * R.lim), SU1, yy(sg * R.lim), C.ink3, 1, { 'stroke-dasharray': '5 4' }); txt(e, SU1 + 6, yy(R.lim) + 4, big(R.lim), 'mono', 10, C.ink3); }
    txt(e, 48, R.y + 5, R.name, 'mono', 15, C.ink); txt(e, 62, R.y + 5, R.unit, 'mono', 10, C.ink3);
    const pts = []; for (let i = 0; i < R.arr.length; i += 4) pts.push([tx(i / 1000), yy(R.arr[i])]);
    el('path', { d: path(pts), fill: 'none', stroke: C.accentInk, 'stroke-width': 1.8 }, e);
    return { yy, R, read: txt(e, 668, R.y + 6, '', 'mono', 15, C.ink) };
  });
  o.now = line(e, 0, 480, 0, 680, C.ink, 1.2);
  txt(e, SU0, 696, '0 s', 'mono', 10, C.ink3); txt(e, SU1, 696, '3.4 s', 'mono', 10, C.ink3, 'end');
  return o;
}

// ---- the log: what is being computed, newest last ----
const LOG = [
  [A.in + 0.2, `> ${N} knots in, 0 to ${K[N - 1].t} s`], [A.in + 0.9, '  a time and a position each'],
  [A.chords, '> chords: the slope of each span'], [A.cls, '> class each knot by its chords'], [A.hCls, `  ${COUNT[0]} through · ${COUNT[1]} crest · ${COUNT[2]} end`],
  [A.flat, '> crest and end: angle 0'], [A.terms, `> through: pchip at knot ${AN.i}`], [A.terms + 0.2, '  weighted harmonic mean'], [A.pchip, `  = ${fmt(AN.pchip, 1)} mm/s`],
  [A.band, `> monotone band 0 to ${fmt(AN.hi, 1)}`], [A.sw1, '> G2 sweeps: match acceleration'], [A.sw1 + 0.2, '  on both sides of the knot'], [A.hSw, `  4 sweeps: ${fmt(AN.sweeps[3][1], 1)} mm/s, in the band`],
  [A.handles, '> every handle a third of its span'], [A.handles + 0.5, `> piece ${WP}→${WP + 1}: ${fmt(K[WP + 1].p - K[WP].p)} mm in ${SPAN4} ms`], [A.k1, '> judge at k 1.00'],
  [A.hK1, `  u 0.5: v ${fmt(W4[0][2], 1)} > ${fmt(VMAX)}, stop`], [A.skip, '> speed over: shorter only'], [A.skip + 0.15, '  k > 1 skipped'],
  ...W4.slice(1).map((w, j) => [A['w' + (j + 1)] + 0.3, `  k ${w[0].toFixed(2)}: v ${fmt(w[2], 1)}, ${w[1] ? 'legal' : 'over'}`]),
  [A.bounds, '> every factor, for the picture:'], [A.bounds + 0.2, `  one passes, k ${H.chosen[WP].toFixed(2)}`],
  [A.b4, `> judge piece ${WP}→${WP + 1} at k ${H.chosen[WP].toFixed(2)}`], [A.b4 + 0.3, '> 11 u samples: ends, middle,'], [A.b4 + 0.45, '  quarters, tenths'],
  [A.rv, '> each peak exactly at its'], [A.rv + 0.15, '  turning point: bracket, bisect'], [A.rv + 0.4, `  v: u ${J.rootsV.length ? J.rootsV[0][0] : 'none'}`], [A.ra + 0.2, `  a: ${J.rootsA.length ? 'u ' + J.rootsA[0][0] : 'none inside'}`], [A.rj + 0.2, `  j: u ${J.rootsJ.length ? J.rootsJ[0][0] : 'none'}`], [A.verdict, '> legal, within 0.1%'],
  [A.b5, `> piece ${TP}→${TP + 1}: ${FULL} mm in ${SPAN6} ms`], [A.t1 + 0.4, `  k 1.00: v ×${(W6[0][2] / VMAX).toFixed(2)}, a ×${(W6[0][3] / AMAX).toFixed(2)}`], [A.fill, '> both over: walk both sides'],
  [A.hShort, `  ${W6.length} factors, none legal`], [A.trim, '> trim toward the previous knot'], [A.trim + 0.2, '  the time stays'], [A.bs1, `  halve the move ${B.length - 1} times`],
  [A['hb' + (B.length - 1)], `  move ${fmt(-F[TP + 1].dp, 2)} mm, keeps ${Math.round(H.share * 100)}%`], [A.resolve, '> round 2: solve again on'], [A.resolve + 0.15, '  the trimmed chords'],
  [A.b6, '> render the composite Bézier'], [A.render + 0.4, '> a corner ramp at jmax where'], [A.render + 0.55, '  two accelerations differ'], [A.grid, '> sample on the 1 ms grid'], [A.grid + 0.3, `  ${H.P.length} samples, ${H.P.length - 1} ms`],
  [A.feed, '> Nucleus keeps 128 of them'], [A.feed + 0.2, '  ahead of the motor'],
];

function draw(t, held) {
  const beat = BEAT.findIndex((b, i) => t >= b && t < BEAT[i + 1]);
  const out = 1 - ramp(t, DUR - 0.35, DUR - 0.02);
  // headline
  g.heads.forEach((e, i) => {
    const a = BEAT[i], b = BEAT[i + 1], u = outE(ramp(t, a, a + 0.35)), v = ease(ramp(t, b - 0.3, b));
    e.setAttribute('transform', `translate(0 ${((1 - u) * 72 - v * 72).toFixed(1)})`);
    op(e, t >= a && t < b ? 1 : 0);
  });
  g.detTitle.textContent = ['KNOTS · AS SUBMITTED', `DETAIL · KNOT ${AN.i} · ITS ANGLE`, `DETAIL · PIECE ${WP}→${WP + 1} · LENGTH WALK`, `DETAIL · PIECE ${WP}→${WP + 1} · THE JUDGE`, `DETAIL · PIECE ${TP}→${TP + 1} · THE TRIM`, '1 MS GRID · THE STRIP'][beat];
  g.scTitle.textContent = beat === 0 ? 'WORKING · CLASSES' : beat === 1 ? `WORKING · KNOT ${AN.i} ANGLE` : beat === 5 ? 'ENGINE · 1 MS SAMPLES'
    : (beat === 2 && t >= A.bounds) || (beat === 4 && t >= A.fill && t < A.trim) ? 'SCOPE · THE PEAKS AT EVERY FACTOR k, LOG SCALE'
    : beat === 4 && t >= A.trim ? `SCOPE · THE TRIM SEARCH, ${B.length} TESTS` : 'SCOPE · V, A, J OVER U (THE CURVE PARAMETER, NOT TIME)';
  g.det.forEach((e, i) => op(e, within(t, BEAT[i], BEAT[i + 1], 0.35, 0.3)));
  mainPlot(t, out);
  knotsBeat(t); angleBeat(t); pieceBeat(t, g.piecewalk, 'walk'); judgeBeat(t); pieceBeat(t, g.piecetrim, 'trim'); stripBeat(t);
  scopeBeat(t);
  // ---- log: the newest step bright, the ones before it dim ----
  const lines = LOG.filter(([a]) => a <= t && a >= BEAT[beat]).slice(-9);
  let grp = 0; lines.forEach((L, k) => { if (L[1].startsWith('>')) grp = k; });
  g.log.forEach((e, k) => {
    const L = lines[k]; e.textContent = '';
    if (!L) return;
    const n = held ? L[1].length : Math.floor(clamp((t - L[0]) / 0.25) * L[1].length);
    e.textContent = L[1].slice(0, Math.max(1, n));
    e.setAttribute('fill', k < grp ? C.ink3 : L[1].startsWith('>') ? C.ink : C.ink2);
  });
  const last = lines.length - 1;
  g.cursor.setAttribute('x', 808 + (last >= 0 ? g.log[last].getComputedTextLength() + 4 : 0));
  g.cursor.setAttribute('y', 492 + Math.max(0, last) * 23 - 12);
  op(g.cursor, (!held && Math.floor(t * 2.5) % 2 ? 0.2 : 1) * out);
}
const outE = (u) => 1 - Math.pow(1 - u, 3);

// the trim's search as nudge ran it: the full move first, then the halvings. k: the test on screen
function bisectAt(t) {
  let k = -1;
  B.forEach((_, i) => { if (t >= A['bs' + i]) k = i; });
  if (k < 0) return { k, move: 0, lo: 0, hi: B[0][0], mid: 0, legal: 1 };
  const [lo, hi] = k ? BR[k - 1] : [0, B[0][0]], b = B[k];
  return { k, lo, hi, mid: b[0], legal: b[1], move: lerp(k ? B[k - 1][0] : 0, b[0], ease(ramp(t, A['bs' + k], A['bs' + k] + 0.25))) };
}

function mainPlot(t, out) {
  const bis = bisectAt(t), kt = K[TP + 1];
  const pT = t < A.bs0 ? kt.p : t >= A.resolve ? F[TP + 1].p : kt.p - bis.move;
  K.forEach((k, i) => {
    const a = A.in + 0.25 + i * D.in;
    g.knots[i].setAttribute('r', (6 * back(ramp(t, a, a + 0.3))).toFixed(2));
    op(g.knots[i], out);
    op(g.tags[i], ramp(t, A.cls + i * D.cls, A.cls + i * D.cls + 0.2) * (1 - ramp(t, A.b6, A.b6 + 0.5)) * out);
  });
  g.knots[TP + 1].setAttribute('cy', Y(pT).toFixed(1));
  op(g.ghost, ramp(t, A.trim, A.trim + 0.3) * out);
  g.tags[TP + 1].setAttribute('y', (Y(pT) - 12).toFixed(1));
  g.chords.forEach((c, i) => {
    op(c, ramp(t, A.chords + i * 0.03, A.chords + 0.3 + i * 0.03) * (1 - 0.6 * ramp(t, A.b3, A.b3 + 0.5)) * (1 - ramp(t, A.b6, A.b6 + 0.7)) * out);
    if (i === TP) c.setAttribute('y2', Y(pT)); if (i === TP + 1) c.setAttribute('y1', Y(pT));
  });
  // the knot being worked: classes, then knot 1's angle, then the trimmed knot
  const ci = clamp(Math.floor((t - A.cls) / D.cls), 0, N - 1);
  const ringAt = t >= A.cls && t < A.hCls ? ci : t >= A.terms && t < A.b3 ? AN.i : t >= A.resolve && t < A.b6 ? RS.i : -1;
  if (ringAt >= 0) { g.ring.setAttribute('cx', X(K[ringAt].t)); g.ring.setAttribute('cy', Y(ringAt === TP + 1 ? pT : K[ringAt].p)); }
  op(g.ring, ringAt >= 0 ? 1 : 0);
  // angles: flat first, pchip, each sweep, then round 2's re-solve
  K.forEach((k, i) => {
    let v = 0, vis = 0;
    if (k.cls === 'through') {
      v = k.pchip;
      const sv = H.sweepV[i];
      for (let j = 0; j < sv.length; j++) { const a = j ? A.sw + (j - 1) * D.sw : A.sw1; v = lerp(v, sv[j], ease(ramp(t, a, a + 0.4))); }
      vis = ramp(t, A.pchip, A.pchip + 0.3);
    } else vis = ramp(t, A.flat + i * 0.04, A.flat + 0.3 + i * 0.04);
    v = lerp(v, F[i].vel, ease(ramp(t, A.resolve, A.resolve + 0.6)));
    const p = i === TP + 1 ? pT : k.p, dx = 18, dy = v * 2.9 / 196 * dx, d = g.dirs[i];
    setL(d, X(k.t) - dx, Y(p) + dy, X(k.t) + dx, Y(p) - dy);
    d.setAttribute('stroke', k.cls === 'through' ? C.accentInk : C.ink);
    d.setAttribute('stroke-width', i === RS.i && t >= A.resolve && t < A.b6 ? 3.4 : 2.2);
    op(d, vis * (1 - 0.7 * ramp(t, A.b6, A.b6 + 0.7)) * out);
  });
  // handles: a third on every piece, the fitted lengths after their beats
  for (let i = 0; i + 1 < N; i++) {
    const P = ctrl(i, 'solve', pT), Pf = ctrl(i, 'final', pT);
    const done = i === WP ? ramp(t, A.w3, A.w3 + 0.3) : i === TP ? ramp(t, A.resolve, A.resolve + 0.3) : ramp(t, A.resolve, A.resolve + 0.6);
    const c = P.map((q, j) => [lerp(q[0], Pf[j][0], done), lerp(q[1], Pf[j][1], done)]);
    [[0, 1], [3, 2]].forEach(([a, b], j) => {
      setL(g.arms[i][j], X(c[a][0]), Y(c[a][1]), X(c[b][0]), Y(c[b][1]));
      g.dots[i][j].setAttribute('cx', X(c[b][0])); g.dots[i][j].setAttribute('cy', Y(c[b][1]));
      const vis = ramp(t, A.handles + i * 0.05, A.handles + 0.3 + i * 0.05) * (1 - 0.75 * ramp(t, A.render, A.render + 0.7)) * out;
      op(g.arms[i][j], vis); op(g.dots[i][j], vis);
    });
  }
  // focus box
  const fp = t >= A.b3 && t < A.b5 ? WP : t >= A.b5 && t < A.b6 ? TP : -1;
  if (fp >= 0) { const x0 = X(K[fp].t) - 8, x1 = X(K[fp + 1].t) + 8; g.focus.setAttribute('x', x0); g.focus.setAttribute('width', x1 - x0); g.focus.setAttribute('y', Y(100) - 10); g.focus.setAttribute('height', Y(0) - Y(100) + 20); }
  op(g.focus, fp === WP ? within(t, A.handles + 0.5, A.b5) : fp === TP ? within(t, A.b5, A.b6) : 0);
  // the rendered curve and the ride
  g.rev.setAttribute('width', (X(3.4 * ease(ramp(t, A.render, A.render + 1.0))) - X(0) + 4).toFixed(1));
  op(g.curve, ramp(t, A.render, A.render + 0.2) * out);
  const tr = rideT(t), on = t >= A.grid && t < DUR - 0.35, i = Math.round(tr * 1000), p = H.P[Math.min(i, H.P.length - 1)];
  g.head.setAttribute('cx', X(tr)); g.head.setAttribute('cy', Y(p)); op(g.head, on ? out : 0);
  setL(g.now, X(tr), Y(100) - 6, X(tr), Y(0)); op(g.now, on ? out : 0);
  g.car.setAttribute('y', (Y(on ? p : H.P[0]) - 7).toFixed(1));
}
// the ride's time in the script, s: FEED0 for the grid, a tick each D.feed while it feeds, then 0 to 3.4 in real time
function rideT(t) {
  if (t >= A.ride) return clamp(t - A.ride, 0, 3.4);
  if (t >= A.feed) return (FEED0 + Math.min(6, Math.floor((t - A.feed) / D.feed) + 1)) / 1000;
  return FEED0 / 1000;
}

function knotsBeat(t) {
  const ci = Math.floor((t - A.cls) / D.cls), classing = t >= A.cls && t < A.hCls;
  g.rows.forEach((r, i) => {
    const a = A.in + 0.25 + i * D.in, newest = t >= a && t < a + 0.25;
    op(r.e, ramp(t, a, a + 0.2) * (classing && i !== ci ? 0.5 : 1));
    r.ch.forEach((c) => op(c, ramp(t, A.chords, A.chords + 0.3)));
    op(r.cls, ramp(t, A.cls + i * D.cls, A.cls + i * D.cls + 0.15));
    r.cells[1].setAttribute('fill', newest ? C.accentInk : C.ink); r.cells[2].setAttribute('fill', newest ? C.accentInk : C.ink);
  });
  op(g.chHead, ramp(t, A.chords, A.chords + 0.3));
  const bar = t < A.hIn ? clamp(Math.floor((t - A.in - 0.25) / D.in), 0, N - 1) : ci;
  const barOn = (t >= A.in + 0.25 && t < A.hIn) || classing;
  if (barOn) g.rowBar.setAttribute('y', g.rows[bar].y - 14);
  op(g.rowBar, barOn ? 1 : 0);
  // the working panel: the knot being classed, then the count
  const w = g.work1;
  op(w.e, within(t, A.in + 0.2, A.b2, 0.3, 0.3));
  const k = K[clamp(ci, 0, N - 1)], i = clamp(ci, 0, N - 1);
  const kin = clamp(Math.floor((t - A.in - 0.25) / D.in), 0, N - 1), inPhase = t < A.chords;
  const parts = inPhase ? [`knot ${kin}`.padEnd(9), `t ${K[kin].t.toFixed(3)} s`.padEnd(12), `p ${K[kin].p.toFixed(1)} mm`, '', ''] : [`knot ${i}`.padEnd(9), i ? `in ${sgn(k.dIn)}`.padEnd(12) : 'no chord in'.padEnd(12), i < N - 1 ? `out ${sgn(k.dOut)}`.padEnd(14) : 'no chord out'.padEnd(14), '→  ', k.cls];
  w.cur.sp.forEach((sp, j) => { sp.textContent = parts[j]; });
  paint(w.cur.sp[4], k.cls === 'through' ? C.accentInk : k.cls === 'crest' ? C.ink : C.ink2, 700);
  const crest = k.cls === 'crest';
  paint(w.cur.sp[1], crest ? (k.dIn > 0 ? C.accentInk : C.ink) : C.ink); paint(w.cur.sp[2], crest ? (k.dOut > 0 ? C.accentInk : C.ink) : C.ink);
  op(w.cur.e, (t >= A.in + 0.25 && inPhase) || (t >= A.cls && t < A.hCls) ? 1 : 0);
  w.rules.forEach((r, j) => op(r.e, inPhase ? 0 : classing ? (['end', 'crest', 'through'][j] === k.cls ? 1 : 0.35) : 1));
  op(w.intro, inPhase ? 0 : 1);
  op(w.inSum, t >= A.hIn && inPhase ? 1 : 0);
  op(w.sum.e, ramp(t, A.hCls, A.hCls + 0.3));
}

function angleBeat(t) {
  const a = AN, sw = a.sweeps;
  let v = a.pchip, row = -1;
  sw.forEach((w, j) => { const s0 = j ? A.sw + (j - 1) * D.sw : A.sw1; if (t >= s0) row = j; v = lerp(v, w[1], ease(ramp(t, s0, s0 + 0.4))); });
  g.angSlope(v);
  op(g.angLine, ramp(t, A.pchip, A.pchip + 0.3));
  op(g.band, 0.16 * ramp(t, A.band, A.band + 0.3));
  op(g.bandLbl, ramp(t, A.band, A.band + 0.3));
  const termsOn = t >= A.terms && t < A.band;
  [g.dInLbl, g.dOutLbl].forEach((e) => paint(e, termsOn ? C.ink : C.ink3, termsOn ? 700 : 400));
  g.angChords.forEach((c) => c.setAttribute('stroke', termsOn ? C.ink2 : C.line3));
  g.angRead.textContent = t < A.pchip ? '' : row < 0 ? `pchip ${fmt(a.pchip, 1)} mm/s` : row < 3 ? `sweep ${row + 1}: ${fmt(v, 1)} mm/s` : `after 4 sweeps ${fmt(v, 1)} mm/s`;
  paint(g.angRead, C.accentInk, 700);
  // the working panel
  const w = g.work2;
  op(w.e, within(t, A.b2 + 0.2, A.b3, 0.3, 0.3));
  const show = [A.terms, A.terms + 0.5, A.pchip, A.band];
  const latest = show.filter((x) => t >= x).length - 1;
  w.r.forEach((r, j) => op(r.e, t < show[j] ? 0 : t >= A.sw1 ? 0.45 : j === latest || j === 2 ? 1 : 0.6));
  paint(w.r[2].sp[2], C.accentInk, t >= A.pchip && t < A.band ? 700 : 400);
  paint(w.r[3].sp[2], C.ink, t >= A.band && t < A.sw1 ? 700 : 400);
  op(w.head.e, t >= A.sw1 ? 1 : 0); op(w.unit, t >= A.sw1 ? 1 : 0);
  w.sw.forEach((r, j) => {
    op(r.e, row >= j ? (row === j ? 1 : 0.5) : 0);
    paint(r.sp[4], C.accentInk, row === j ? 700 : 400);
    paint(r.sp[5], C.ink, row === j ? 700 : 400);
  });
}

function pieceBeat(t, o, kind) {
  const i = o.i, A_ = K[i], B_ = K[i + 1], walk = H.walk[i], sw = o.sw;
  // which factor is on screen, its index in the sweep (the walk's order)
  let fk = 1, jx = 0;
  if (kind === 'walk') {
    walk.forEach((w, j) => { if (j && t >= A['w' + j]) jx = j; });
    fk = walk[jx][0];
    if (jx > 0) fk = lerp(walk[jx - 1][0], walk[jx][0], ease(ramp(t, A['w' + jx], A['w' + jx] + 0.4)));
  } else {
    jx = t < A.fill ? 0 : Math.min(walk.length - 1, Math.floor((t - A.fill) / D.fill) + 1);
    const zk = zoneK(t);
    if (zk !== null) jx = walk.findIndex((w) => w[0] === zk);
    fk = walk[jx][0];
    if (t >= A.trim) fk = H.chosen[i];
  }
  const swAt = sw.find((r) => Math.abs(r[1] - fk) < 1e-6);
  const bis = bisectAt(t), trimming = kind === 'trim' && t >= A.trim;
  const pR = trimming ? B_.p - bis.move : B_.p;
  const T = B_.t - A_.t, l0 = swAt ? swAt[2] : Math.max(H.floor, Math.min(0.95, fk / 3)), l1 = swAt ? swAt[3] : l0;
  setPiece(o, [[A_.t, A_.p], [A_.t + l0 * T, A_.p + K[i].vel * l0 * T], [B_.t - l1 * T, pR - (trimming ? 0 : K[i + 1].vel) * l1 * T], [B_.t, pR]]);
  // the ruler: a factor's cells once it is judged, red over, accent legal; every factor at bounds
  const seen = kind === 'walk' ? new Set(walk.filter((_, j) => t >= (j ? A['w' + j] + 0.3 : A.k1 + 0.85)).map((w) => w[0])) : new Set(walk.slice(0, t < A.t1 + 0.5 ? 0 : t < A.fill ? 1 : Math.floor((t - A.fill) / D.fill) + 2).map((w) => w[0]));
  const bounds = kind === 'walk' ? ramp(t, A.bounds, A.bounds + 0.4) : 0;
  sw.forEach((r, j) => {
    const vis = seen.has(r[1]), ok = [r[4] <= TOL, r[5] <= TOL, r[6] <= TOL, r[7] === 1];
    ['v', 'a', 'j', 'all'].forEach((nm, row) => {
      const c = o.cells[nm][j], show = vis || bounds > 0;
      c.setAttribute('fill', !show ? C.bg3 : ok[row] ? C.accentInk : C.bad);
      op(c, row === 3 || vis ? 1 : bounds);
    });
  });
  o.mark.setAttribute('transform', `translate(${o.rx(fk)} ${o.ry0 - 2})`);
  const ring = kind === 'walk' ? t >= A.bounds : false;
  o.colRing.setAttribute('x', o.rx(H.chosen[i]) - 6.5); op(o.colRing, ring ? ramp(t, A.bounds + 0.4, A.bounds + 0.6) : 0);
  if (kind === 'walk') { const sk = ramp(t, A.skip, A.skip + 0.2) * (1 - ramp(t, A.bounds, A.bounds + 0.3)); op(o.skip, 0.85 * sk); op(o.skipLbl, sk); }
  else { op(o.skip, 0); op(o.skipLbl, 0); }
  // the handles' share of the span, by their control points
  o.lbl[0].textContent = o.lbl[1].textContent = '';
  if (kind === 'walk') {
    const c0 = o.cp[1], c1 = o.cp[2], hl = kind === 'walk' && t >= A.handles && t < A.k1;
    o.lbl[0].setAttribute('x', c0.getAttribute('cx')); o.lbl[0].setAttribute('y', +c0.getAttribute('cy') + 18); o.lbl[0].textContent = l0.toFixed(3);
    o.lbl[1].setAttribute('x', c1.getAttribute('cx')); o.lbl[1].setAttribute('y', +c1.getAttribute('cy') - 10); o.lbl[1].textContent = l1.toFixed(3);
    o.lbl.forEach((e) => { e.setAttribute('font-size', hl ? 15 : 11); e.setAttribute('font-weight', hl ? 700 : 400); });
  }
  // the readout: the factor and its verdict
  const w = walk[jx], judged = kind === 'walk' ? (jx ? t >= A['w' + jx] + 0.3 : t >= A.k1 + 0.85) : t >= A.t1 + 0.5;
  const set = (r, parts) => r.sp.forEach((sp, j) => { sp.textContent = parts[j] || ''; });
  if (!trimming) {
    set(o.read, [`k ${fk.toFixed(2)}`, `   handles ${l0.toFixed(3)}`]);
    paint(o.read.sp[0], C.ink, 700);
    if (judged) {
      set(o.read2, ['v ', fmt(w[2], 1), '   a ', fmt(w[3]), kind === 'trim' ? `   j ${big(w[4])}` : '']);
      paint(o.read2.sp[1], w[2] > VMAX * TOL ? C.bad : C.accentInk, 700);
      paint(o.read2.sp[3], w[3] > AMAX * TOL ? C.bad : C.ink, w[3] > AMAX * TOL ? 700 : 400);
      paint(o.read2.sp[4], w[4] > JMAX * TOL ? C.bad : C.ink3);
    } else set(o.read2, []);
  } else {
    const b = B[Math.max(0, bis.k)], fin = t >= A['hb' + (B.length - 1)];
    set(o.read, [bis.k <= 0 ? 'step 0: the full move' : `step ${bis.k}: move ${fmt(b[0], 3)} mm`, fin ? '' : ''] );
    paint(o.read.sp[0], C.ink, 700);
    set(o.read2, ['keeps ', fmt(b[2], 3) + ' mm', '   v ', fmt(b[4], 1), b[1] ? '  legal' : '  over']);
    paint(o.read2.sp[1], C.ink, 400);
    paint(o.read2.sp[3], b[1] ? C.accentInk : C.bad, 700);
    paint(o.read2.sp[4], b[1] ? C.accentInk : C.bad);
  }
  if (kind === 'trim') {
    op(o.ghost, ramp(t, A.trim, A.trim + 0.2)); op(o.timeLine, ramp(t, A.trim, A.trim + 0.3)); op(o.timeLbl, ramp(t, A.trim, A.trim + 0.3));
    const yL = (m) => o.y(B_.p - m), live = trimming && t < A.resolve;
    setL(o.lo, o.x(B_.t) - 26, yL(bis.lo), o.x(B_.t) + 26, yL(bis.lo)); setL(o.hi, o.x(B_.t) - 26, yL(bis.hi), o.x(B_.t) + 26, yL(bis.hi));
    op(o.lo, live ? 1 : 0); op(o.hi, live ? 1 : 0);
    o.mid.setAttribute('cy', yL(bis.mid)); o.mid.setAttribute('fill', bis.legal ? C.accentInk : C.bad); op(o.mid, live && bis.k >= 0 ? 1 : 0);
  }
}

function judgeBeat(t) {
  // sample k shows at smT(k): 3 slow, then 8 quick
  const n = J.samples.length, cur = sampleAt(t);
  g.smRows.forEach((r, k) => {
    op(r.e, t >= smT(k) ? (cur === k || t >= A.hS11 ? 1 : 0.55) : 0);
    r.c.slice(1).forEach((c, j) => paint(c, cur === k ? C.ink : C.ink2, cur === k ? 700 : 400));
  });
  if (cur >= 0) g.smBar.setAttribute('y', g.smRows[cur].y - 13);
  op(g.smBar, cur >= 0 ? 1 : 0);
  // after all 11: the highest of each column
  if (t >= A.hS3 && t < A.s11) paint(g.smRows[0].c[3], C.accentInk, 700);
  if (t >= A.hS11 && t < A.rv) [1, 2, 3].forEach((c) => { const hiK = J.samples.indexOf(hiS(c)); paint(g.smRows[hiK].c[c + 1], C.accentInk, 700); });
  const tpOn = [A.rv, A.ra, A.rj];
  g.tp.forEach((r, j) => { op(r.e, t >= tpOn[j] + 0.2 ? (t < (tpOn[j + 1] || A.verdict) ? 1 : 0.6) : 0); paint(r.sp[1], C.accentInk, t >= tpOn[j] && t < (tpOn[j + 1] || A.verdict) ? 700 : 400); });
  op(g.verdict.e, ramp(t, A.verdict, A.verdict + 0.2));
  paint(g.verdict.sp[1], C.accentInk, 700);
  void n;
}
const smT = (k) => k < 3 ? A.s3 + 0.4 + k * D.s3 : A.s11 + (k - 3) * D.s11;
const sampleAt = (t) => { if (t < A.s3 + 0.4 || t >= A.rv) return -1; let c = -1; for (let k = 0; k < J.samples.length; k++) if (t >= smT(k)) c = k; return c; };

function stripBeat(t) {
  const tr = rideT(t), x0 = DX0 + 20, pxms = (DX1 - DX0 - 40) / 160, now = Math.round(tr * 1000);
  const ic = Math.min(Math.max(now + 48, 0), H.P.length - 1), pc = H.P[ic], y = (p) => (DY0 + DY1) / 2 - 12 - (p - pc) * 7;
  const n0 = now - 32, feeding = t >= A.feed && t < A.ride;
  g.stripDots.forEach((d, k) => {
    const m = n0 + k, yy = m >= 0 && m < H.P.length ? y(H.P[m]) : -99, ok = yy > DY0 + 24 && yy < DY1 - 18;
    d.setAttribute('cx', x0 + k * pxms); d.setAttribute('cy', ok ? yy : -20);
    op(d, ok ? (k < 32 ? 0.3 : k < 32 + 128 ? 1 : 0.3) : 0);
    const st = g.stripStems[k]; setL(st, x0 + k * pxms, DY1 - 18, x0 + k * pxms, ok ? yy : DY1 - 18);
    op(st, ok ? (k < 32 ? 0.15 : 0.45) : 0);
  });
  const xn = x0 + 32 * pxms;
  setL(g.stripNow, xn, DY0, xn, DY1);
  g.stripBand.setAttribute('x', xn); g.stripBand.setAttribute('width', 128 * pxms);
  g.stripLbl.setAttribute('x', xn + 6);
  g.stripTicks.forEach((e, k) => e.setAttribute('x', xn + k * 32 * pxms));
  // the feed: the sample at now goes to the motor, one more is read 127 ms ahead
  const xin = x0 + (32 + 127) * pxms, pin = H.P[Math.min(now + 127, H.P.length - 1)], pout = H.P[Math.min(now, H.P.length - 1)];
  g.stripIn.setAttribute('cx', xin); g.stripIn.setAttribute('cy', y(pin)); g.stripOut.setAttribute('cx', xn); g.stripOut.setAttribute('cy', y(pout));
  const fo = feeding ? 1 : 0, fresh = feeding ? 1 - ramp((t - A.feed) % D.feed, 0.12, 0.3) : 0;
  op(g.stripIn, fo); op(g.stripOut, fo);
  g.stripIn.setAttribute('r', (5 + 4 * fresh).toFixed(1));
  g.stripInLbl.setAttribute('x', xin - 10); g.stripInLbl.setAttribute('y', y(pin) - 12); op(g.stripInLbl, fo);
  g.stripOutLbl.setAttribute('x', xn - 10); g.stripOutLbl.setAttribute('y', y(pout) - 12); op(g.stripOutLbl, fo);
  const i = Math.min(now, H.P.length - 1), hl = t >= A.grid && t < A.ride;
  const vals = [`${String(i).padStart(4, ' ')} ms`, `${H.P[i].toFixed(2)} mm`, `${fmt(H.V[i])} mm/s`, `${fmt(H.A[i])} mm/s²`];
  g.stripRead.forEach((e, j) => { e.textContent = vals[j]; paint(e, hl && j < 2 ? C.accentInk : C.ink, hl && j < 2 ? 700 : 400); });
}

function scopeBeat(t) {
  const S = g.scopes;
  // B3: k 1 (the judge stops at the third sample), each tried factor, the chosen fit, then every factor
  op(S.k1.e, within(t, A.k1, A.w1, 0.25, 0.1));
  const k1s = [0.15, 0.5, 0.85];
  S.k1.rows.forEach((r, ri) => {
    r.dots.forEach((d, k) => op(d, k < 3 ? ramp(t, A.k1 + k1s[k], A.k1 + k1s[k] + 0.1) : 0));
    const ck = [0, 1, 2].filter((k) => t >= A.k1 + k1s[k]).pop();
    if (ck !== undefined && t < A.skip) { r.cur.setAttribute('cx', r.dots[ck].getAttribute('cx')); r.cur.setAttribute('cy', r.dots[ck].getAttribute('cy')); }
    op(r.cur, ck !== undefined && t < A.skip ? 1 : 0);
    op(r.segs, 0); r.br.forEach((b) => op(b, 0)); r.roots.forEach((m) => op(m, 0)); if (r.none) op(r.none, 0);
    // the trace past the stop is what the judge never read: faint
    op(r.trace, t < A.k1 + 0.85 ? 0.25 : 0.6);
  });
  S.tried.forEach((o, j) => {
    op(o.e, within(t, A['w' + (j + 1)], A['w' + (j + 2)], 0.1, 0.1));
    o.rows.forEach((r) => { r.dots.forEach((d, k) => op(d, k < 3 ? 1 : 0)); op(r.cur, 0); op(r.segs, 0); r.br.forEach((b) => op(b, 0)); r.roots.forEach((m) => op(m, 0)); if (r.none) op(r.none, 0); });
  });
  op(S.walk.e, within(t, A['w' + (W4.length - 1)], A.bounds, 0.1, 0.25) + within(t, A.b4, A.b5, 0.25, 0.3));
  op(g.kp4.e, within(t, A.bounds, A.b4, 0.3, 0.25));
  kplotDraw(g.kp4, t >= A.bounds ? g.kp4.sw.length : 0, H.chosen[WP], null);
  // B4: the chosen fit, 11 samples in the judge's order, then the turning points
  const cur = sampleAt(t);
  S.walk.rows.forEach((r, ri) => {
    r.dots.forEach((d, k) => op(d, t < A.b4 ? 0 : ramp(t, smT(k), smT(k) + 0.1)));
    if (cur >= 0) { r.cur.setAttribute('cx', r.dots[cur].getAttribute('cx')); r.cur.setAttribute('cy', r.dots[cur].getAttribute('cy')); }
    op(r.cur, cur >= 0 ? 1 : 0);
    const a = [A.rv, A.ra, A.rj][ri], b = [A.ra, A.rj, A.verdict][ri];
    op(r.segs, within(t, a, b + 0.01, 0.2, 0.2));
    r.br.forEach((x) => op(x, 0.25 * within(t, a + 0.1, b, 0.2, 0.2)));
    r.roots.forEach((m) => op(m, ramp(t, a + 0.35, a + 0.5)));
    if (r.none) op(r.none, ramp(t, a + 0.35, a + 0.5));
    const focus = t >= A.rv && t < A.verdict ? (t >= a && t < b ? 1 : 0.35) : 1;
    op(r.trace, t >= A.b4 ? focus : 1);
    const mine = t >= A.verdict && t < A.b5;
    r.read.setAttribute('font-weight', mine && ri === 1 ? 700 : 400);
  });
  // B5: k 1, then every factor walked, then the search
  op(S.trimK1.e, within(t, A.b5 + 0.1, A.fill, 0.25, 0.2));
  op(g.kp6.e, within(t, A.fill, A.trim, 0.2, 0.25));
  const fill = t < A.fill ? 1 : Math.min(g.kp6.sw.length, Math.floor((t - A.fill) / D.fill) + 2);
  const zone = zoneOf(t);
  kplotDraw(g.kp6, fill, null, zone);
  op(g.bp.e, within(t, A.trim, A.b6, 0.25, 0.3));
  bplotDraw(t);
  op(g.time.e, within(t, A.b6 + 0.2, DUR - 0.05, 0.4, 0.35));
  const tx = g.time.tx, tr = rideT(t), i = Math.min(Math.round(tr * 1000), H.P.length - 1);
  setL(g.time.now, tx(tr), 480, tx(tr), 680); op(g.time.now, t >= A.grid ? 1 : 0);
  g.time.rows.forEach((r, k) => { r.read.textContent = fmt([H.P, H.V, H.A][k][i], k ? 0 : 1); });
  // the verdict pill
  let pill = null;
  if (t >= A.k1 + 0.85 && t < A['w' + (W4.length - 1)] + 0.3) pill = ['OVER', false];
  else if (t >= A['w' + (W4.length - 1)] + 0.3 && t < A.bounds) pill = ['LEGAL', true];
  else if (t >= A.verdict && t < A.b5) pill = ['LEGAL', true];
  else if (t >= A.t1 + 0.5 && t < A.trim) pill = ['OVER', false];
  else if (t >= A.bs0 && t < A.b6) { const b = bisectAt(t); pill = b.k >= 0 ? [B[b.k][1] ? 'LEGAL' : 'OVER', !!B[b.k][1]] : null; }
  op(g.pill, pill ? 1 : 0);
  if (pill) { g.pillTx.textContent = pill[0]; g.pillBg.setAttribute('fill', pill[1] ? C.accent : C.bad); g.pillTx.setAttribute('fill', pill[1] ? '#fff' : C.bg); }
}
// the trim's three looks at every factor: which side, and the factor each one reads out
const zoneOf = (t) => t >= A.hShort && t < A.hLong ? 'short' : t >= A.hLong && t < A.hWhy ? 'long' : t >= A.hWhy && t < A.trim ? 'why' : null;
const zoneK = (t) => { const z = zoneOf(t); return z === 'long' ? aOk6[0][0] : z ? atFloor[0] : null; };
// n: factors shown (in the walk's order); fk: the factor marked and read out (default the newest);
// zone: the side brought forward (short, long, or why: speed at the floor)
function kplotDraw(o, n, fk, zone) {
  const last = Math.max(0, Math.min(n, o.sw.length) - 1);
  const f = fk !== null ? fk : zone === 'long' ? aOk6[0][0] : zone ? atFloor[0] : o.sw[last][1], r = o.sw.find((x) => x[1] === f);
  o.rows.forEach((row, ri) => {
    row.pts.forEach((p, j) => {
      const k = o.sw[j][1], inZone = !zone || (zone === 'short' ? k < 1 : zone === 'long' ? k > 1 : ri === 0);
      op(p, j < n ? (inZone ? 1 : 0.2) : 0);
      p.setAttribute('r', k === f ? 5.5 : 3.5);
    });
    const x = r[4 + ri], over = x > TOL, lim = LIMS[ri];
    row.read.textContent = n ? big(x * lim) : ''; row.read2.textContent = n ? `k ${f.toFixed(2)}  ×${x.toFixed(3)}` : '';
    paint(row.read, over ? C.bad : C.accentInk, 700); paint(row.read2, over ? C.bad : C.ink3);
  });
  o.cur.setAttribute('x', o.kx(f) - 6);
  op(o.cur, n ? 1 : 0);
  // the why: the factors whose handles sit at the floor, where speed bottoms out over its ceiling
  if (zone === 'why') { const fl = o.kx(0.2) - 6, fr = o.kx(atFloor[0]) + 6; o.zone.setAttribute('x', fl); o.zone.setAttribute('width', fr - fl); }
  op(o.zone, zone === 'why' ? 0.08 : 0);
}
function bplotDraw(t) {
  const o = g.bp, b = bisectAt(t), k = b.k;
  o.rows.forEach((r) => {
    r.pts.forEach((p, i) => { op(p, i <= k ? (i === k ? 1 : 0.55) : 0); p.setAttribute('r', i === k ? 6 : 4); });
    if (r.band) r.band.forEach((x, i) => op(x, i <= k ? (i === k ? 0.35 : 0.14) : 0));
    const v = k >= 0 ? B[k][r.R.key] : 0, over = k >= 0 && !B[k][1] && r.R.lim && v > r.R.lim * TOL;
    r.read.textContent = k < 0 ? '' : fmt(v, r.R.key === 2 ? 3 : r.R.key === 4 ? 1 : 0);
    paint(r.read, over ? C.bad : r.R.key === 2 ? C.ink : C.accentInk, 700);
  });
}

run(setup, (t, held) => draw((t + OFFSET) % DUR, held), DUR, STEPS);
