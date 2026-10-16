const DUR = 24.5, OFFSET = 21.0;   // frame 0 is the poster: the finished curve, the ride under way
const H = HDATA, K = H.knots, F = H.final, N = K.length, WP = H.walkPiece, TP = H.trimPiece;
const [VMAX, AMAX, JMAX] = H.lim;
const BEAT = [0, 3, 7, 12, 15.5, 19.5, 24.5];
const HEAD = ['Knots', 'Angles', 'Handle lengths', 'Legality check', 'Trim', '1 ms samples'];
const X = (t) => 64 + t * 196, Y = (p) => 410 - p * 2.9;            // the main plot
const DX0 = 812, DX1 = 1228, DY0 = 136, DY1 = 380;                    // the detail viewport
const SU0 = 100, SU1 = 640;                                           // the scope's u axis
const ROWS = [{ y: 510, h: 26, key: 3, lim: VMAX, name: 'v', unit: 'mm/s' }, { y: 576, h: 26, key: 4, lim: AMAX, name: 'a', unit: 'mm/s²' }, { y: 642, h: 26, key: 5, lim: JMAX, name: 'j', unit: 'mm/s³' }];
const fmt = (x, d = 0) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const big = (x) => Math.abs(x) >= 1e6 ? fmt(x / 1e6, 2) + ' M' : fmt(x);
let g = {}, s;

const txt = (p, x, y, str, cls, size, fill, anchor = 'start', extra = {}) => { const e = el('text', { x, y, class: cls, 'font-size': size, fill, 'text-anchor': anchor, ...extra }, p); e.textContent = str; return e; };
const line = (p, x1, y1, x2, y2, stroke, w = 1.5, extra = {}) => el('line', { x1, y1, x2, y2, stroke, 'stroke-width': w, ...extra }, p);
const op = (e, v) => e.setAttribute('opacity', clamp(v).toFixed(3));
const within = (t, a, b, fi = 0.3, fo = 0.3) => ramp(t, a, a + fi) * (1 - ramp(t, b - fo, b));
const path = (pts) => pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
// A cubic Bezier's point (the piece's control points; evalPiece's curve).
const bez = (P, u) => { const w = 1 - u; return [0, 1].map((d) => w * w * w * P[0][d] + 3 * u * w * w * P[1][d] + 3 * u * u * w * P[2][d] + u * u * u * P[3][d]); };
// Control points of piece i (t, p) from angles, lengths and rendered positions.
function ctrl(i, sel) {
  const L = sel === 'final' ? F[i] : K[i], R = sel === 'final' ? F[i + 1] : K[i + 1];
  const tL = K[i].t, tR = K[i + 1].t, T = tR - tL;
  const lo = sel === 'final' ? F[i].effOut : 1 / 3, li = sel === 'final' ? F[i + 1].effIn : 1 / 3;
  return [[tL, L.p], [tL + lo * T, L.p + L.vel * lo * T], [tR - li * T, R.p - R.vel * li * T], [tR, R.p]];
}

function frame(p, x, y, w, h, title) {
  el('rect', { x, y, width: w, height: h, rx: 8, fill: C.bg2, stroke: C.rule, 'stroke-width': 1.5 }, p);
  return txt(p, x + 14, y + 20, title, 'mono', 11, C.ink3, 'start', { 'letter-spacing': '0.08em' });
}

function setup() {
  s = document.getElementById('scene');
  el('rect', { width: 1280, height: 720, fill: C.bg }, s);
  const defs = el('defs', {}, s);
  // ---- main plot ----
  g.mainTitle = frame(s, 32, 88, 740, 352, 'TIME S · POSITION MM');
  for (let i = 0; i <= 34; i++) line(s, X(i / 10), Y(100) - 6, X(i / 10), Y(0), C.rule, i % 5 ? 0.6 : 1.2);
  for (let p = 0; p <= 100; p += 25) line(s, X(0), Y(p), X(3.4), Y(p), C.rule, p % 50 ? 0.6 : 1.2);
  for (let i = 0; i <= 3; i++) txt(s, X(i), 430, i + ' s', 'mono', 11, C.ink3, 'middle');
  for (const p of [0, 50, 100]) txt(s, 58, Y(p) + 4, String(p), 'mono', 11, C.ink3, 'end');
  
  g.chords = K.slice(1).map((k, i) => line(s, X(K[i].t), Y(K[i].p), X(k.t), Y(k.p), C.line3, 1.5, { 'stroke-dasharray': '4 4', opacity: 0 }));
  g.arms = []; g.dots = [];
  for (let i = 0; i + 1 < N; i++) {
    const a = [line(s, 0, 0, 0, 0, C.accentInk, 1.4, { opacity: 0 }), line(s, 0, 0, 0, 0, C.accentInk, 1.4, { opacity: 0 })];
    const d = [el('circle', { r: 3, fill: C.accentInk, opacity: 0 }, s), el('circle', { r: 3, fill: C.accentInk, opacity: 0 }, s)];
    g.arms.push(a); g.dots.push(d);
  }
  g.dirs = K.map(() => line(s, 0, 0, 0, 0, C.ink, 2.2, { 'stroke-linecap': 'round', opacity: 0 }));
  el('rect', { x: X(0), y: 0, width: 0, height: 720 }, el('clipPath', { id: 'rev' }, defs));
  g.rev = defs.querySelector('#rev rect');
  let d = '';
  for (let i = 0; i < H.P.length; i += 4) d += (i ? 'L' : 'M') + X(i / 1000).toFixed(1) + ' ' + Y(H.P[i]).toFixed(1);
  g.curve = el('path', { d, fill: 'none', stroke: C.accentInk, 'stroke-width': 4, 'stroke-linejoin': 'round', 'clip-path': 'url(#rev)', opacity: 0 }, s);
  g.focus = el('rect', { rx: 4, fill: 'none', stroke: C.accentInk, 'stroke-width': 1.5, 'stroke-dasharray': '3 3', opacity: 0 }, s);
  g.ghost = el('circle', { cx: X(K[TP + 1].t), cy: Y(K[TP + 1].p), r: 6, fill: 'none', stroke: C.ink3, 'stroke-width': 1.5, 'stroke-dasharray': '2 2', opacity: 0 }, s);
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
  buildTable(g.det[0]); buildAngle(g.det[1]); buildPiece(g.det[2], WP, 'walk'); buildJudgeNotes(g.det[3]); buildPiece(g.det[4], TP, 'trim'); buildStrip(g.det[5]);
  // ---- the scope ----
  g.scTitle = frame(s, 32, 456, 740, 248, '');
  g.pill = el('g', { opacity: 0 }, s);
  g.pillBg = el('rect', { x: 668, y: 466, width: 92, height: 22, rx: 11 }, g.pill);
  g.pillTx = txt(g.pill, 714, 481, '', 'kick', 13, '#fff', 'middle');
  g.scopes = {
    k1: scope('walkK1', true), walk: scope('walk', true), trimK1: scope('trimK1'), trim: scope('trim'),
  };
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

// B1: the knots as the planner gets them
function buildTable(p) {
  txt(p, 812, 136, 'k', 'mono', 12, C.ink3); txt(p, 900, 136, 't s', 'mono', 12, C.ink3, 'end'); txt(p, 990, 136, 'p mm', 'mono', 12, C.ink3, 'end'); txt(p, 1012, 136, 'class', 'mono', 12, C.ink3);
  g.rows = K.map((k, i) => {
    const e = el('g', { opacity: 0 }, p), y = 162 + i * 24;
    txt(e, 812, y, String(i), 'mono', 14, C.ink3);
    txt(e, 900, y, k.t.toFixed(3), 'mono', 14, C.ink, 'end');
    txt(e, 990, y, k.p.toFixed(1), 'mono', 14, C.ink, 'end');
    g['cls' + i] = txt(e, 1012, y, k.cls, 'mono', 14, k.cls === 'through' ? C.accentInk : C.ink2, 'start', { opacity: 0 });
    return e;
  });
}
// B2: knot 1 up close: its two chords, pchip's angle, the band, the G2 sweeps
function buildAngle(p) {
  const i = 1, k = K[i], t0 = K[0].t - 0.05, t1 = K[2].t + 0.05, p0 = 0, p1 = 80;
  const x = (t) => DX0 + (t - t0) / (t1 - t0) * (DX1 - DX0), y = (q) => DY1 - (q - p0) / (p1 - p0) * (DY1 - DY0);
  g.ax = x; g.ay = y;
  const slope = (v, len) => { const dx = len, dt = dx / ((DX1 - DX0) / (t1 - t0)); return [x(k.t) - dx, y(k.p + (-v) * dt), x(k.t) + dx, y(k.p + v * dt)]; };
  const b = 3 * Math.min(Math.abs(k.dIn), Math.abs(k.dOut));
  const w = (v) => { const [x1, y1, x2, y2] = slope(v, 150); return [[x1, y1], [x2, y2]]; };
  const lo = w(0), hi = w(b);
  g.band = el('path', { d: `M${x(k.t)} ${y(k.p)}L${lo[1][0]} ${lo[1][1]}L${hi[1][0]} ${hi[1][1]}ZM${x(k.t)} ${y(k.p)}L${lo[0][0]} ${lo[0][1]}L${hi[0][0]} ${hi[0][1]}Z`, fill: C.accent, opacity: 0 }, p);
  for (const j of [0, 1, 2]) {
    if (j < 2) line(p, x(K[j].t), y(K[j].p), x(K[j + 1].t), y(K[j + 1].p), C.line3, 2, { 'stroke-dasharray': '5 4' });
    el('circle', { cx: x(K[j].t), cy: y(K[j].p), r: j === i ? 7 : 5, fill: C.bg2, stroke: C.ink, 'stroke-width': 2.4 }, p);
  }
  txt(p, (x(K[0].t) + x(k.t)) / 2 - 8, (y(K[0].p) + y(k.p)) / 2 + 22, 'dIn ' + k.dIn.toFixed(1), 'mono', 12, C.ink3, 'middle');
  txt(p, (x(K[2].t) + x(k.t)) / 2 + 30, (y(K[2].p) + y(k.p)) / 2 + 12, 'dOut ' + k.dOut.toFixed(1), 'mono', 12, C.ink3, 'middle');
  g.angLine = line(p, 0, 0, 0, 0, C.accentInk, 3, { 'stroke-linecap': 'round' });
  g.angSlope = (v) => { const [x1, y1, x2, y2] = slope(v, 110); g.angLine.setAttribute('x1', x1); g.angLine.setAttribute('y1', y1); g.angLine.setAttribute('x2', x2); g.angLine.setAttribute('y2', y2); };
  g.angRead = txt(p, DX0, 412, '', 'mono', 14, C.ink);
  g.bandLbl = txt(p, DX1, 412, `band 0 to ${b.toFixed(1)} mm/s`, 'mono', 12, C.ink3, 'end', { opacity: 0 });
}
// B3 and B5: one piece up close, its control polygon, and the length-factor ruler
function buildPiece(p, i, kind) {
  const A = K[i], B = K[i + 1], pad = (B.t - A.t) * 0.12;
  const t0 = A.t - pad, t1 = B.t + pad, p0 = 0, p1 = 105;
  const x = (t) => DX0 + (t - t0) / (t1 - t0) * (DX1 - DX0), y = (q) => DY1 - 36 - (q - p0) / (p1 - p0) * (DY1 - DY0 - 46);
  const o = { x, y, i };
  o.curve = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 3 }, p);
  o.poly = el('polyline', { fill: 'none', stroke: C.ink3, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, p);
  o.arms = [line(p, 0, 0, 0, 0, C.accentInk, 2), line(p, 0, 0, 0, 0, C.accentInk, 2)];
  o.cp = [0, 1, 2, 3].map((j) => el('circle', { r: j % 3 ? 5 : 7, fill: j % 3 ? C.accentInk : C.bg2, stroke: j % 3 ? 'none' : C.ink, 'stroke-width': 2.4 }, p));
  o.lbl = [txt(p, 0, 0, '', 'mono', 11, C.accentInk, 'middle'), txt(p, 0, 0, '', 'mono', 11, C.accentInk, 'middle')];
  if (kind === 'trim') {
    o.timeLine = line(p, x(B.t), DY0 - 4, x(B.t), y(0), C.ink3, 1.2, { 'stroke-dasharray': '2 4' });
    o.timeLbl = txt(p, x(B.t) - 6, y(0) - 4, 'time kept: ' + B.t.toFixed(3) + ' s', 'mono', 11, C.ink3, 'end');
    o.ghost = el('circle', { cx: x(B.t), cy: y(B.p), r: 7, fill: 'none', stroke: C.ink3, 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }, p);
    o.lo = line(p, x(B.t) - 26, 0, x(B.t) + 26, 0, C.ink2, 1.5); o.hi = line(p, x(B.t) - 26, 0, x(B.t) + 26, 0, C.ink2, 1.5);
    o.mid = el('circle', { cx: x(B.t), r: 5 }, p);
    o.read = txt(p, DX0, 140, '', 'mono', 13, C.ink, 'start');
    o.read2 = txt(p, DX0, 160, '', 'mono', 13, C.ink3, 'start');
  }
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
  [[0, 1], [3, 2]].forEach(([a, b], j) => { o.arms[j].setAttribute('x1', pts[a][0]); o.arms[j].setAttribute('y1', pts[a][1]); o.arms[j].setAttribute('x2', pts[b][0]); o.arms[j].setAttribute('y2', pts[b][1]); });
  pts.forEach((q, j) => { o.cp[j].setAttribute('cx', q[0]); o.cp[j].setAttribute('cy', q[1]); });
}
// B4: what the judge reads
function buildJudgeNotes(p) {
  const J = H.judge.walk, lines = [
    ['11 u samples', 'ends, middle, quarters'],
    ['turning points', 'roots of the next derivative'],
    ['v peaks where a = 0', '6 segments, bracketed'],
    ['a peaks where j = 0', '8 segments'],
    ['j peaks where dj/du = 0', '10 segments'],
    ['each bisected 4 times', 'then 2 secant steps'],
  ];
  g.notes = lines.map(([a, b], i) => { const e = el('g', { opacity: 0 }, p); txt(e, 812, 140 + i * 40, a, 'mono', 14, C.ink); txt(e, 812, 158 + i * 40, b, 'mono', 12, C.ink3); return e; });
  g.notesOk = el('g', { opacity: 0 }, p);
  txt(g.notesOk, 812, 392, `peaks ${fmt(J.over[1] * VMAX)} mm/s · ${fmt(J.over[2] * AMAX)} mm/s²`, 'mono', 13, C.accentInk);
  txt(g.notesOk, 812, 412, `${big(J.over[3] * JMAX)} mm/s³ · each within its ceiling`, 'mono', 13, C.accentInk);
}
// B6: the 1 ms grid, 128 ms ahead of now
function buildStrip(p) {
  g.stripTicks = [0, 32, 64, 96, 128].map((ms) => txt(p, 0, DY1 - 6, ms + ' ms', 'mono', 10, C.ink3, 'middle'));
  g.stripStems = Array.from({ length: 161 }, () => line(p, 0, 0, 0, 0, C.accentInk, 1, { opacity: 0 }));
  g.stripDots = Array.from({ length: 161 }, () => el('circle', { r: 1.4, fill: C.accentInk }, p));
  g.stripNow = line(p, 0, DY0, 0, DY1, C.ink, 1.5);
  g.stripBand = el('rect', { y: DY0, height: DY1 - DY0, fill: C.accent, opacity: 0.16 }, p);
  g.stripLbl = txt(p, 0, DY0 + 14, '128 ms ahead', 'mono', 11, C.accentInk);
  g.stripRead = [0, 1, 2, 3].map((j) => txt(p, DX0 + j * 108, 412, '', 'mono', 13, C.ink));
}
// One judged piece: v, a, j against u, with the ceilings
function scope(key, withMarks) {
  const J = H.judge[key], e = el('g', { opacity: 0 }, s), o = { e, J };
  const ux = (u) => SU0 + u * (SU1 - SU0);
  o.rows = ROWS.map((R, ri) => {
    const peak = Math.max(R.lim, ...J.dense.map((d) => Math.abs(d[R.key]))), sc = R.h / (peak * 1.05);
    const yy = (v) => R.y - v * sc, r = { yy, sc };
    line(e, SU0, R.y, SU1, R.y, C.rule, 1);
    for (const sg of [1, -1]) line(e, SU0, yy(sg * R.lim), SU1, yy(sg * R.lim), C.ink3, 1, { 'stroke-dasharray': '5 4' });
    txt(e, SU1 + 6, yy(R.lim) + 4, big(R.lim), 'mono', 10, C.ink3);
    txt(e, 48, R.y + 5, R.name, 'mono', 15, C.ink); txt(e, 62, R.y + 5, R.unit, 'mono', 10, C.ink3);
    r.trace = el('path', { d: path(J.dense.map((d) => [ux(d[0]), yy(d[R.key])])), fill: 'none', stroke: C.accentInk, 'stroke-width': 2 }, e);
    r.over = el('path', { d: '', fill: 'none', stroke: C.ink, 'stroke-width': 3.5 }, e);
    let od = '';
    for (let k = 1; k < J.dense.length; k++) { const a = J.dense[k - 1], b = J.dense[k]; if (Math.abs(a[R.key]) > R.lim * 1.001 && Math.abs(b[R.key]) > R.lim * 1.001) od += `M${ux(a[0]).toFixed(1)} ${yy(a[R.key]).toFixed(1)}L${ux(b[0]).toFixed(1)} ${yy(b[R.key]).toFixed(1)}`; }
    r.over.setAttribute('d', od);
    if (withMarks) {
      const nseg = [6, 8, 10][ri];
      r.segs = el('g', { opacity: 0 }, e);
      for (let k = 0; k <= nseg; k++) line(r.segs, ux(k / nseg), R.y + R.h + 2, ux(k / nseg), R.y + R.h - 4, C.ink3, 1);
      r.dots = J.samples.map((sm, k) => el('circle', { cx: ux(sm[0]), cy: yy(sm[ri + 1]), r: 3.5, fill: C.bg2, stroke: C.ink, 'stroke-width': 1.6, opacity: 0 }, e));
      const roots = [J.rootsV, J.rootsA, J.rootsJ][ri];
      r.br = roots.map(([u]) => el('rect', { x: ux(Math.floor(u * nseg) / nseg), y: R.y - R.h, width: (SU1 - SU0) / nseg, height: 2 * R.h, fill: C.accent, opacity: 0 }, e));
      r.roots = roots.map(([u, v]) => { const m = el('g', { opacity: 0 }, e); el('path', { d: `M${ux(u)} ${yy(v) - 8}l-5 -8h10z`, fill: C.accentInk }, m); line(m, ux(u), R.y - R.h, ux(u), R.y + R.h, C.accentInk, 1); return m; });
      r.none = roots.length ? null : txt(e, (SU0 + SU1) / 2, R.y + R.h + 12, 'no turning point inside: the samples hold the peak', 'mono', 10, C.ink3, 'middle', { opacity: 0 });
    }
    r.read = txt(e, 668, R.y + 2, '', 'mono', 15, C.ink); r.read2 = txt(e, 668, R.y + 18, '', 'mono', 10, C.ink3);
    const pk = J.over[ri + 1] * R.lim;
    r.read.textContent = big(pk); r.read2.textContent = '/ ' + big(R.lim) + '  ×' + J.over[ri + 1].toFixed(3);
    return r;
  });
  txt(e, SU0, 696, 'u 0', 'mono', 10, C.ink3); txt(e, (SU0 + SU1) / 2, 696, '0.5', 'mono', 10, C.ink3, 'middle'); txt(e, SU1, 696, '1', 'mono', 10, C.ink3, 'end');
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
  [0.3, '> 11 knots in, 0 to 3.3 s'], [1.0, '  time and position only'], [1.9, '> classify each by its chords'], [2.4, '  4 through · 5 crest · 2 end'],
  [3.0, '> chord: the slope of each span'], [3.6, '> crest and end: flat, zero slope'], [4.1, '> through: pchip, a weighted'], [4.3, '  harmonic mean of the chords'],
  [5.2, '> 4 G2 sweeps: acceleration'], [5.4, '  matched on both sides'], [6.1, `  k1: ${K[1].pchip.toFixed(1)} → ${K[1].vel.toFixed(1)} mm/s, in the band`],
  [7.0, '> every handle a third'], [7.3, '  of its span: the cubic Hermite'], [7.8, `> piece ${WP}→${WP + 1}: ${(K[WP + 1].p - K[WP].p).toFixed(0)} mm in ${Math.round((K[WP + 1].t - K[WP].t) * 1000)} ms`],
  [8.1, '> scale both handles by k,'], [8.25, '  nearest 1 first'], [8.6, '  k 1.00: sample 3, v 1062 > 1000'], [9.0, '> speed over: shorter only,'], [9.15, '  k > 1 skipped'],
  [9.5, '  k 0.95: v ×1.037, over'], [9.9, '  k 0.90: v ×1.012, over'], [10.3, `  k 0.85: legal, handles ${H.final[WP].effOut.toFixed(3)}`],
  [12.0, `> judge piece ${WP}→${WP + 1} at k 0.85`], [12.2, '> v, a, j at 11 u samples'], [13.7, '> then each peak exactly:'], [13.9, '  bracket the turning points,'], [14.1, '  bisect, read the peak there'], [14.9, '> legal, within 0.1%'],
  [15.5, `> piece ${TP}→${TP + 1}: ${(K[TP + 1].p - K[TP].p).toFixed(0)} mm in ${Math.round((K[TP + 1].t - K[TP].t) * 1000)} ms`], [15.8, '  k 1.00: v ×1.35, a ×1.35'], [16.1, '> both over: both sides walked'], [16.5, '  37 factors, none legal'],
  [16.8, '> trim toward the previous knot'], [17.0, '  the time stays'], [17.3, '  halve the move 16 times'], [18.6, `  move ${(-F[TP + 1].dp).toFixed(2)} mm, keeps ${Math.round(H.share * 100)}%`], [18.9, '> 2 rounds: solve again on'], [19.05, '  the trimmed chords'],
  [19.5, '> render the composite Bézier'], [20.0, '> a corner ramp at jmax where'], [20.15, '  two accelerations differ'], [20.6, '> sample on the 1 ms grid'], [21.0, `  ${H.P.length} samples, ${H.P.length - 1} ms`], [21.6, '> Nucleus keeps 128 ms of them'], [21.8, '  ahead of the motor'],
];

function draw(t, held) {
  const beat = BEAT.findIndex((b, i) => t >= b && t < BEAT[i + 1]);
  const out = 1 - ramp(t, 24.1, 24.45);
  // headline
  g.heads.forEach((e, i) => {
    const a = BEAT[i], b = BEAT[i + 1], u = out_(ramp(t, a, a + 0.35)), v = ease(ramp(t, b - 0.3, b));
    e.setAttribute('transform', `translate(0 ${((1 - u) * 72 - v * 72).toFixed(1)})`);
    op(e, t >= a && t < b ? 1 : 0);
  });
  // titles
  g.detTitle.textContent = ['KNOTS · AS SUBMITTED', 'DETAIL · KNOT 1', `DETAIL · PIECE ${WP}→${WP + 1} · LENGTH WALK`, `DETAIL · PIECE ${WP}→${WP + 1} · THE JUDGE`, `DETAIL · PIECE ${TP}→${TP + 1} · THE TRIM`, '1 MS GRID · 128 MS STRIP'][beat];
  g.scTitle.textContent = beat < 2 ? 'SCOPE · WAITING FOR A PIECE' : beat === 5 ? 'ENGINE · 1 MS SAMPLES' : 'SCOPE · V, A, J OVER U (THE CURVE PARAMETER, NOT TIME)';
  g.det.forEach((e, i) => op(e, within(t, BEAT[i], BEAT[i + 1], 0.35, 0.3)));

  // ---- main plot ----
  K.forEach((k, i) => {
    const a = 0.3 + i * 0.14;
    g.knots[i].setAttribute('r', (6 * back(ramp(t, a, a + 0.3))).toFixed(2));
    op(g.knots[i], out);
    op(g.tags[i], ramp(t, 1.9 + i * 0.05, 2.2 + i * 0.05) * (1 - ramp(t, 19.5, 20)) * out);
    op(g.rows[i], ramp(t, a, a + 0.2));
    op(g['cls' + i], ramp(t, 1.9 + i * 0.05, 2.2 + i * 0.05));
  });
  // the trimmed knot moves down while the bisection runs, then stays
  const trimU = bisectAt(t), kt = K[TP + 1];
  const pT = t < 16.8 ? kt.p : kt.p - trimU.move;
  g.knots[TP + 1].setAttribute('cy', Y(pT).toFixed(1));
  op(g.ghost, ramp(t, 16.8, 17.1) * out);
  g.tags[TP + 1].setAttribute('y', (Y(pT) - 12).toFixed(1));
  g.chords.forEach((c, i) => { op(c, ramp(t, 3.0 + i * 0.05, 3.3 + i * 0.05) * (1 - 0.6 * ramp(t, 7, 7.5)) * (1 - ramp(t, 19.5, 20.2)) * out); if (i === TP) c.setAttribute('y2', Y(pT)); if (i === TP + 1) c.setAttribute('y1', Y(pT)); });
  // angles: pchip first, the sweeps after; knot 8's angle moves again with the trim's re-solve
  K.forEach((k, i) => {
    const u = ease(ramp(t, 5.2, 6.2)), re = ease(ramp(t, 18.9, 19.4));
    let v = lerp(k.pchip, k.vel, u); v = lerp(v, F[i].vel, re);
    const p = i === TP + 1 ? pT : k.p, dx = 18, dy = v * 2.9 / 196 * dx;
    const d = g.dirs[i];
    d.setAttribute('x1', X(k.t) - dx); d.setAttribute('y1', Y(p) + dy); d.setAttribute('x2', X(k.t) + dx); d.setAttribute('y2', Y(p) - dy);
    d.setAttribute('stroke', k.cls === 'through' ? C.accentInk : C.ink);
    op(d, ramp(t, 3.6 + i * 0.06, 3.9 + i * 0.06) * (1 - 0.7 * ramp(t, 19.5, 20.2)) * out);
  });
  // handles: a third on every piece, the fitted lengths after their beats
  for (let i = 0; i + 1 < N; i++) {
    const P = ctrl(i, 'solve'), Pf = ctrl(i, 'final');
    const done = i === WP ? ramp(t, 10.3, 10.6) : i === TP ? ramp(t, 18.6, 18.9) : ramp(t, 18.9, 19.4);
    const c = P.map((q, j) => [lerp(q[0], Pf[j][0], done), lerp(q[1], Pf[j][1], done)]);
    [[0, 1], [3, 2]].forEach(([a, b], j) => {
      const A = g.arms[i][j], D = g.dots[i][j];
      A.setAttribute('x1', X(c[a][0])); A.setAttribute('y1', Y(c[a][1])); A.setAttribute('x2', X(c[b][0])); A.setAttribute('y2', Y(c[b][1]));
      D.setAttribute('cx', X(c[b][0])); D.setAttribute('cy', Y(c[b][1]));
      const vis = ramp(t, 7.0 + i * 0.06, 7.3 + i * 0.06) * (1 - 0.75 * ramp(t, 19.6, 20.3)) * out;
      op(A, vis); op(D, vis);
    });
  }
  // focus box
  const fp = beat === 2 || beat === 3 ? WP : beat === 4 ? TP : -1;
  if (fp >= 0) { const x0 = X(K[fp].t) - 8, x1 = X(K[fp + 1].t) + 8; g.focus.setAttribute('x', x0); g.focus.setAttribute('width', x1 - x0); g.focus.setAttribute('y', Y(100) - 10); g.focus.setAttribute('height', Y(0) - Y(100) + 20); }
  op(g.focus, fp === WP ? within(t, 7.8, 15.5) : fp === TP ? within(t, 15.5, 19.5) : 0);
  // the rendered curve and the ride
  g.rev.setAttribute('width', (X(3.4 * ease(ramp(t, 19.5, 20.5))) - X(0) + 4).toFixed(1));
  op(g.curve, ramp(t, 19.5, 19.7) * out);
  const tr = clamp((t - 20.6) / 3.4) * 3.4, on = t >= 20.6 && t < 24.1, i = Math.round(tr * 1000), p = H.P[Math.min(i, H.P.length - 1)];
  g.head.setAttribute('cx', X(tr)); g.head.setAttribute('cy', Y(p)); op(g.head, on ? out : 0);
  g.now.setAttribute('x1', X(tr)); g.now.setAttribute('x2', X(tr)); op(g.now, on ? out : 0);
  g.car.setAttribute('y', (Y(on ? p : H.P[0]) - 7).toFixed(1));

  // ---- detail ----
  angleBeat(t); pieceBeat(t, g.piecewalk, 'walk'); judgeNotes(t); pieceBeat(t, g.piecetrim, 'trim'); stripBeat(t, tr, on);
  // ---- scope ----
  scopeBeat(t);
  // ---- log ----
  const lines = LOG.filter(([a]) => a <= t && a >= BEAT[beat]).slice(-9);
  g.log.forEach((e, k) => {
    const L = lines[k]; e.textContent = '';
    if (!L) return;
    const n = held ? L[1].length : Math.floor(clamp((t - L[0]) / 0.25) * L[1].length);
    e.textContent = L[1].slice(0, Math.max(1, n));
    e.setAttribute('fill', L[1].startsWith('>') ? C.ink : C.ink2);
  });
  const last = lines.length - 1;
  g.cursor.setAttribute('x', 808 + (last >= 0 ? g.log[last].getComputedTextLength() + 4 : 0));
  g.cursor.setAttribute('y', 492 + Math.max(0, last) * 23 - 12);
  op(g.cursor, (!held && Math.floor(t * 2.5) % 2 ? 0.2 : 1) * out);
}
const out_ = (u) => 1 - Math.pow(1 - u, 3);

// the trim's bisection, as nudge ran it: the full move first, then 16 halvings
function bisectAt(t) {
  const steps = H.bisect, a = 17.0, dt = 0.095;
  let lo = 0, hi = steps[0][0], k = Math.floor((t - a) / dt), move = 0, legal = 1, mid = hi;
  for (let s2 = 0; s2 < steps.length && s2 <= k; s2++) {
    const [m, ok] = steps[s2]; mid = m; legal = ok;
    if (s2 > 0) { if (ok) hi = m; else lo = m; }
  }
  move = t < a ? 0 : t >= a + steps.length * dt ? -F[TP + 1].dp : mid;
  return { lo, hi, mid, legal, move, k };
}

function angleBeat(t) {
  const k = K[1], u = ease(ramp(t, 5.2, 6.2)), v = lerp(k.pchip, k.vel, u);
  g.angSlope(v);
  op(g.angLine, ramp(t, 4.1, 4.4));
  op(g.band, 0.14 * ramp(t, 5.0, 5.3));
  op(g.bandLbl, ramp(t, 5.0, 5.3));
  g.angRead.textContent = t < 4.1 ? '' : (u < 1 ? (u > 0 ? 'sweeping ' : 'pchip ') : 'after 4 sweeps ') + v.toFixed(1) + ' mm/s';
}

function pieceBeat(t, o, kind) {
  const i = o.i, A = K[i], B = K[i + 1];
  const walk = H.walk[i], T0 = kind === 'walk' ? 8.0 : 15.6;
  // which judge of the walk is on screen
  const times = kind === 'walk' ? [8.1, 9.5, 9.9, 10.3] : walk.map((_, j) => 15.7 + j * 0.022);
  let jx = -1; times.forEach((a, j) => { if (t >= a) jx = j; });
  const f = jx >= 0 ? walk[jx][0] : 1;
  // the factor shown: lerp toward the next judged one for the walk
  let fk = f;
  if (kind === 'walk' && jx >= 0 && jx + 1 < walk.length) fk = lerp(f, walk[jx + 1][0], ease(ramp(t, times[jx + 1] - 0.25, times[jx + 1])));
  if (kind === 'trim' && t >= 16.8) fk = H.chosen[i];
  const bis = bisectAt(t);
  const pR = kind === 'trim' && t >= 16.8 ? B.p - bis.move : B.p;
  const T = B.t - A.t, l0 = Math.max(H.floor, Math.min(0.95, fk / 3)), l1 = l0;
  setPiece(o, [[A.t, A.p], [A.t + l0 * T, A.p + K[i].vel * l0 * T], [B.t - l1 * T, pR - (kind === 'trim' ? 0 : K[i + 1].vel) * l1 * T], [B.t, pR]]);
  // the ruler
  const seen = new Set(walk.slice(0, jx + 1).map((w) => w[0]));
  const bounds = kind === 'walk' ? ramp(t, 10.7, 11.2) : 0;
  o.sw.forEach((r, j) => {
    const vis = seen.has(r[1]), ok = [r[4] <= 1.001, r[5] <= 1.001, r[6] <= 1.001, r[7] === 1];
    ['v', 'a', 'j', 'all'].forEach((nm, row) => {
      const c = o.cells[nm][j];
      const show = row === 3 ? vis || bounds > 0 : bounds > 0 || vis;
      c.setAttribute('fill', !show ? C.bg3 : ok[row] ? C.accentInk : C.ink);
      op(c, row === 3 ? 1 : (vis ? 1 : bounds));
    });
  });
  o.mark.setAttribute('transform', `translate(${o.rx(fk)} ${o.ry0 - 2})`);
  if (kind === 'walk') { op(o.skip, 0.85 * ramp(t, 9.0, 9.2) * (1 - ramp(t, 10.7, 11.0))); op(o.skipLbl, ramp(t, 9.0, 9.2) * (1 - ramp(t, 10.7, 11.0))); }
  else { op(o.skip, 0); op(o.skipLbl, 0); }
  o.lbl[0].textContent = o.lbl[1].textContent = '';
  if (kind === 'walk') {
    const c0 = o.cp[1], c1 = o.cp[2];
    o.lbl[0].setAttribute('x', c0.getAttribute('cx')); o.lbl[0].setAttribute('y', +c0.getAttribute('cy') + 18); o.lbl[0].textContent = (l0).toFixed(3);
    o.lbl[1].setAttribute('x', c1.getAttribute('cx')); o.lbl[1].setAttribute('y', +c1.getAttribute('cy') - 10); o.lbl[1].textContent = (l1).toFixed(3);
  }
  if (kind === 'trim') {
    const on = t >= 17.0;
    op(o.ghost, ramp(t, 16.8, 17.0)); op(o.timeLine, ramp(t, 16.8, 17.1)); op(o.timeLbl, ramp(t, 16.8, 17.1));
    const yL = (m) => o.y(B.p - m);
    o.lo.setAttribute('y1', yL(bis.lo)); o.lo.setAttribute('y2', yL(bis.lo)); o.hi.setAttribute('y1', yL(bis.hi)); o.hi.setAttribute('y2', yL(bis.hi));
    const live = on && t < 17.0 + H.bisect.length * 0.095;
    op(o.lo, live ? 1 : 0); op(o.hi, live ? 1 : 0);
    o.mid.setAttribute('cy', yL(bis.mid)); o.mid.setAttribute('fill', bis.legal ? C.accentInk : C.ink); op(o.mid, live ? 1 : 0);
    o.read.textContent = !on ? '' : live ? `step ${Math.min(bis.k, 16)}: move ${bis.mid.toFixed(3)} mm  ${bis.legal ? 'legal' : 'over'}` : `moved ${bis.move.toFixed(2)} mm toward knot ${TP}`;
    o.read2.textContent = !on ? '' : live ? `bracket ${bis.lo.toFixed(3)} to ${bis.hi.toFixed(3)} mm` : `keeps ${(K[TP + 1].p - bis.move - K[TP].p).toFixed(2)} of ${(K[TP + 1].p - K[TP].p).toFixed(0)} mm: ${Math.round(H.share * 100)}%`;
  }
}

function judgeNotes(t) {
  g.notes.forEach((e, i) => op(e, ramp(t, 12.2 + [0, 1.5, 1.7, 1.9, 2.1, 2.3][i], 12.5 + [0, 1.5, 1.7, 1.9, 2.1, 2.3][i])));
  op(g.notesOk, ramp(t, 14.9, 15.2));
}

function stripBeat(t, tr, on) {
  const x0 = DX0 + 20, pxms = (DX1 - DX0 - 40) / 160, ic = Math.min(Math.max(Math.round(tr * 1000) + 48, 0), H.P.length - 1), pc = H.P[ic], y = (p) => (DY0 + DY1) / 2 - 12 - (p - pc) * 7;
  const n0 = Math.round(tr * 1000) - 32;
  g.stripDots.forEach((d, k) => {
    const ms = n0 + k, yy = ms >= 0 && ms < H.P.length ? y(H.P[ms]) : -99, ok = yy > DY0 + 24 && yy < DY1 - 18;
    d.setAttribute('cx', x0 + k * pxms); d.setAttribute('cy', ok ? yy : -20);
    op(d, ok ? (k < 32 ? 0.3 : k <= 32 + 128 ? 1 : 0.3) : 0);
    const st = g.stripStems[k]; st.setAttribute('x1', x0 + k * pxms); st.setAttribute('x2', x0 + k * pxms); st.setAttribute('y1', DY1 - 18); st.setAttribute('y2', ok ? yy : DY1 - 18);
    op(st, ok ? (k < 32 ? 0.15 : 0.45) : 0);
  });
  const xn = x0 + 32 * pxms;
  g.stripNow.setAttribute('x1', xn); g.stripNow.setAttribute('x2', xn);
  g.stripBand.setAttribute('x', xn); g.stripBand.setAttribute('width', 128 * pxms);
  g.stripLbl.setAttribute('x', xn + 6);
  g.stripTicks.forEach((e, k) => e.setAttribute('x', xn + k * 32 * pxms));
  const i = Math.min(Math.round(tr * 1000), H.P.length - 1);
  const vals = [`${(i).toString().padStart(4, ' ')} ms`, `${H.P[i].toFixed(2)} mm`, `${fmt(H.V[i])} mm/s`, `${fmt(H.A[i])} mm/s²`];
  g.stripRead.forEach((e, j) => { e.textContent = vals[j]; });
}

function scopeBeat(t) {
  const S = g.scopes;
  op(S.k1.e, within(t, 8.1, 10.4, 0.25, 0.25));
  op(S.walk.e, within(t, 10.3, 15.5, 0.25, 0.3));
  op(S.trimK1.e, within(t, 15.6, 18.7, 0.25, 0.25));
  op(S.trim.e, within(t, 18.6, 19.5, 0.25, 0.3));
  op(g.time.e, within(t, 19.6, 24.45, 0.4, 0.35));
  // k = 1 of the walk: the judge stops at the third sample (u 0.5), v over its bar
  S.k1.rows.forEach((r, ri) => {
    r.dots.forEach((d, k) => { op(d, k < 3 ? ramp(t, 8.2 + k * 0.13, 8.3 + k * 0.13) : 0); if (k === 2 && ri === 0) { d.setAttribute('fill', C.ink); d.setAttribute('r', 5); } });
    op(r.segs, 0); r.br.forEach((b) => op(b, 0)); r.roots.forEach((m) => op(m, 0)); if (r.none) op(r.none, 0);
  });
  // the chosen fit: 11 samples in the judge's order, then the turning points
  S.walk.rows.forEach((r) => {
    r.dots.forEach((d, k) => op(d, ramp(t, 12.3 + k * 0.12, 12.4 + k * 0.12)));
    op(r.segs, ramp(t, 13.7, 14.0) * (1 - ramp(t, 14.9, 15.2)));
    r.br.forEach((b) => op(b, 0.25 * within(t, 14.0, 14.8, 0.2, 0.2)));
    r.roots.forEach((m) => op(m, ramp(t, 14.5, 14.7)));
    if (r.none) op(r.none, ramp(t, 14.5, 14.7));
  });
  const tx = g.time.tx, tr = clamp((t - 20.6) / 3.4) * 3.4, i = Math.min(Math.round(tr * 1000), H.P.length - 1);
  g.time.now.setAttribute('x1', tx(tr)); g.time.now.setAttribute('x2', tx(tr));
  g.time.rows.forEach((r, k) => { r.read.textContent = fmt([H.P, H.V, H.A][k][i], k ? 0 : 1); });
  // the verdict pill
  let pill = null;
  if (t >= 8.6 && t < 10.3) pill = ['OVER', false];
  else if (t >= 10.3 && t < 12.0) pill = ['LEGAL', true];
  else if (t >= 14.9 && t < 15.5) pill = ['LEGAL', true];
  else if (t >= 15.8 && t < 18.6) pill = ['OVER', false];
  else if (t >= 18.7 && t < 19.5) pill = ['LEGAL', true];
  op(g.pill, pill ? 1 : 0);
  if (pill) { g.pillTx.textContent = pill[0]; g.pillBg.setAttribute('fill', pill[1] ? C.accent : C.ink); g.pillTx.setAttribute('fill', pill[1] ? '#fff' : C.bg); }
}

// The site's stepper (site.js): stops inside the beats where the planner iterates, at clip
// times where the picture holds that state (the last of each beat is its end state, the same
// as data-hold on /kinetic/). Every number is the trace's.
const STEPS = (() => {
  const W = H.walk[WP], WT = H.walk[TP], B = H.bisect, J = H.judge.walk, full = K[TP + 1].p - K[TP].p;
  const peaks = (v, a, j) => `${fmt(v, 1)} mm/s, ${fmt(a)} mm/s², ${big(j)} mm/s³`;
  const over = (v, a, j) => [[v, VMAX, 'speed'], [a, AMAX, 'acceleration'], [j, JMAX, 'jerk']].filter(([x, m]) => x > m * 1.001).map((x) => x[2]).join(' and ');
  const hi = (k) => J.samples.reduce((m, x) => Math.abs(x[k]) > Math.abs(m[k]) ? x : m);
  const roots = [['speed', J.rootsV, 1, 'mm/s'], ['acceleration', J.rootsA, 0, 'mm/s²'], ['jerk', J.rootsJ, 0, 'mm/s³']].map(([nm, r, d, un]) => r.length ? `${nm} at u ${r[0][0]}, ${fmt(Math.abs(r[0][1]), d)} ${un}` : `${nm} none`);
  const step = (b, i) => `Step ${i}: move ${fmt(b[0], 3)} mm, keeps ${fmt(b[2], 3)} of ${full} mm (${fmt(b[3] * 100, 2)}%). ` + (b[1] ? `Legal${b[4] > VMAX ? ' within 0.1%' : ''}, ${fmt(b[4], 1)} mm/s.` : `Over: ${over(b[4], b[5], b[6])}, ${fmt(b[4], 1)} mm/s, ${fmt(b[5])} mm/s².`);
  return [
    ...W.map((w, j) => ({ beat: 2, at: [9.245, 9.645, 10.045, 11.69][j], note: `k ${w[0].toFixed(2)}: both handles ${(w[0] / 3).toFixed(3)} of the piece. ` + (w[1]
      ? `Peaks ${peaks(w[2], w[3], w[4])}. Legal.`
      : `Speed ${fmt(w[2], 1)} mm/s, over ${fmt(VMAX)}.` + (j ? '' : ' Speed over wants shorter handles, so k above 1 is skipped.')) })),
    { beat: 3, at: 13.65, note: `11 samples. Highest: speed ${fmt(hi(1)[1], 1)} mm/s at u ${hi(1)[0]}, acceleration ${fmt(Math.abs(hi(2)[2]))} mm/s² at u ${hi(2)[0]}, jerk ${big(Math.abs(hi(3)[3]))} mm/s³ at u ${hi(3)[0]}.` },
    { beat: 3, at: 15.19, note: `Turning points inside: ${roots.join('; ')}. Peaks ${peaks(J.over[1] * VMAX, J.over[2] * AMAX, J.over[3] * JMAX)}, all under. Legal.` },
    { beat: 4, at: 16.79, note: `Piece ${TP} to ${TP + 1}: ${full} mm in ${Math.round((K[TP + 1].t - K[TP].t) * 1000)} ms. All ${WT.length} factors fail. At k 1.00: speed ${fmt(WT[0][2])} mm/s, acceleration ${fmt(WT[0][3])} mm/s², both over.` },
    { beat: 4, at: 17.045, note: `Step 0: the full move, ${fmt(B[0][0], 3)} mm, leaves a zero stroke. ${B[0][1] ? 'Legal' : 'Over'}, so the search runs from 0 to ${fmt(B[0][0])} mm.` },
    ...[1, 2, 3, 4].map((i) => ({ beat: 4, at: 17.045 + i * 0.095, note: step(B[i], i) })),
    { beat: 4, at: 18.89, note: step(B[16], 16) + ` Knot ${TP + 1} keeps its time, ${K[TP + 1].t.toFixed(3)} s.` },
  ];
})();

run(setup, (t, held) => draw((t + OFFSET) % DUR, held), DUR, STEPS);
