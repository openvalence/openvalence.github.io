// timing.js -- One second to 125 ns: Nucleus's motion timing as one continuous zoom, from the
// 900 ms Wi-Fi buffer down to the LP core's poll grid. Time on screen slows as the view narrows,
// so the trace always drifts at the same speed; the readout says by how much.
// Facts: Nucleus MotionArbiter.h kStepsPerMm 208.608, kLpClockHz 40 MHz, kLeaseTicks 4,
// kStripLen 128; ValenceMotion.h kMotionTickUs 1000; .claude/rules/motion-control.md (the 5-cycle
// poll loop, 125 ns at 40 MHz; the deadline runs from the previous deadline, the edge lands on the
// next poll); Phosphor sends up to the 1000 ms factory horizon minus 100 ms: 900 ms.
// The stroke is Kinetic² output (kinetic-data.js, window units), drawn as a 100 mm stroke; between
// 1 ms samples the position is linear, as the steer holds one speed per tick.
const DUR = 24;
const MM = 100, SPM = 208.608, GRID = 125e-9, TICK = 1e-3, LEASE = 4e-3, STRIP = 0.128, LEAD = 0.9;
const PER = 4, SP = KDATA.stroke.P, NSMP = 4000;
const W = 1280, XN = 470;                         // the now line
const LT = 150, LB = 410, LH = LB - LT, LC = (LT + LB) / 2;   // position lane
const QA = [446, 482], QB = [514, 550];           // quadrature lanes: high, low
const RY = 592;                                    // the ruler
// the five stops: the view's span in seconds, what it shows
const STOPS = [
  { span: 2.4, kick: 'Wi-Fi buffer', big: '900 ms', line: 'Each knot arrives up to 900 ms before it is due.' },
  { span: 0.32, kick: 'Plan strip', big: '128 ms', line: 'The next 128 positions, one per 1 ms tick.' },
  { span: 0.012, kick: 'Steer tick, lease', big: '1 ms · 4 ms', line: 'Each tick sets a speed and renews the LP core’s 4 ms lease.' },
  { span: 1.4e-4, kick: 'Quadrature', big: '4.79 µm', line: 'One A/B transition per step, 208.608 steps per mm.' },
  { span: 3.2e-6, kick: 'Poll grid', big: '125 ns', line: 'Each edge lands on the first 5-cycle poll after its deadline.' },
];
const LS = STOPS.map((s) => Math.log(s.span));
// holds and zooms, in clip seconds; the last zoom returns to stop 0
const HOLD = [2.8, 2.6, 2.8, 2.6, 3.2], ZOOM = [1.9, 1.9, 1.9, 1.8, 2.5];
const DRIFT = 0.045;                               // ln(span) per second: the view never stands still
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
let SEG = [], TAU = [], TAU0 = 0, FOCUS = 0, g = {};

// position in mm at time tau, linear between the 1 ms samples, periodic
function pAt(tau) {
  const u = (((tau % PER) + PER) % PER) * 1000, i = Math.min(NSMP - 1, Math.floor(u));
  return MM * (SP[i] + (SP[i + 1] - SP[i]) * (u - i));
}
const vAt = (tau) => { const d = 0.0025; return (pAt(tau + d) - pAt(tau - d)) / (2 * d); };
// ln(span) at clip time t
function lnSpan(t) {
  let L = LS[0] - DRIFT * t;
  for (const s of SEG) L += s.dL * smoother(clamp((t - s.a) / s.d));
  return L;
}
// the edges in [ta, tb]: per 1 ms piece, each step boundary crossed (ideal), and where the LP core
// puts it (the first poll grid point at or after it)
function edges(ta, tb, cap) {
  const out = [];
  for (let k = Math.floor(ta / TICK); k * TICK < tb; k++) {
    const t0 = k * TICK, p0 = pAt(t0) * SPM, p1 = pAt(t0 + TICK) * SPM;
    if (p1 === p0) continue;
    const up = p1 > p0, lo = Math.min(p0, p1), hi = Math.max(p0, p1);
    for (let m = Math.floor(lo) + 1; m <= hi; m++) {
      const ti = t0 + ((m - p0) / (p1 - p0)) * TICK;
      if (ti < ta - GRID || ti > tb) continue;
      out.push({ ti, te: Math.ceil(ti / GRID - 1e-9) * GRID, c: up ? m : m - 1 });
      if (out.length > cap) return null;
    }
  }
  return out.sort((x, y) => x.ti - y.ti);   // a falling piece crosses its boundaries top down
}
const gray = (c) => [((c & 3) === 1 || (c & 3) === 2) ? 1 : 0, (c & 3) >= 2 ? 1 : 0];
function fmt(s) {
  const a = Math.abs(s), r = (x) => (Math.abs(x - Math.round(x)) < 1e-6 ? String(Math.round(x)) : x.toFixed(1));
  if (a >= 1) return r(s) + ' s';
  if (a >= 1e-3) return r(s * 1e3) + ' ms';
  if (a >= 1e-6) return r(s * 1e6) + ' µs';
  return r(s * 1e9) + ' ns';
}
const sig2 = (x) => { const p = Math.pow(10, Math.floor(Math.log10(x)) - 1); return (Math.round(x / p) * p).toLocaleString('en-US'); };
const txt = (p, x, y, s, cls, size, fill, anchor = 'start') => { const e = el('text', { x, y, class: cls, 'font-size': size, fill, 'text-anchor': anchor }, p); e.textContent = s; return e; };

function setup() {
  // the schedule: hold i, then zoom i to stop i + 1 (the last back to 0), drift throughout
  SEG = [];
  let t = 0, L = LS[0];
  for (let i = 0; i < STOPS.length; i++) {
    t += HOLD[i]; L -= DRIFT * HOLD[i];
    const to = LS[(i + 1) % STOPS.length], a = t, d = ZOOM[i];
    t += d; L -= DRIFT * d;
    SEG.push({ a, d, dL: to - L, hold: a - HOLD[i] });
    L = to;
  }
  // time on screen: d tau / dt = K * span * slow(L), scaled so the loop runs whole stroke periods
  const slow = (Lx) => 0.22 + 0.78 * smoother(clamp((Lx - LS[4]) / (LS[2] - LS[4])));
  const N = DUR * 600, rate = [];
  for (let i = 0; i <= N; i++) { const Lx = lnSpan(i / 600); rate.push(Math.exp(Lx) * slow(Lx)); }
  TAU = [0];
  for (let i = 1; i <= N; i++) TAU.push(TAU[i - 1] + (rate[i - 1] + rate[i]) / 1200);
  const periods = Math.max(1, Math.round((TAU[N] * 0.42) / PER)), K = (periods * PER) / TAU[N];
  for (let i = 0; i <= N; i++) TAU[i] *= K;
  // the deepest hold watches one edge: its deadline, at speed, crosses the now line 1.2 s into it.
  // Of those, the one that also puts the strip and the tick stops on a moving stretch of the stroke.
  const tm = SEG[4].hold + 1.2, mid = (i) => SEG[i].hold + HOLD[i] / 2;
  let best = null;
  for (let i = 0; i < NSMP; i += 5) {
    const v = Math.abs(vAt(i / 1000));
    if (v < 150 || v > 230) continue;
    const e = edges(i / 1000, i / 1000 + TICK, 1e4)[0], off = e.ti - tauAt(tm);
    const score = Math.min(160, Math.abs(vAt(tauAt(mid(1)) + off))) + Math.min(160, Math.abs(vAt(tauAt(mid(2)) + off)));
    if (!best || score > best.score) best = { score, e, off };
  }
  TAU0 = best.off;
  FOCUS = best.e.ti;

  const s = document.getElementById('scene');
  s.replaceChildren();
  el('rect', { width: W, height: 720, fill: C.bg }, s);
  const defs = el('defs', {}, s);
  // the trace behind now fades like phosphor: exponential in distance, which is age
  const fade = el('linearGradient', { id: 'tfade', gradientUnits: 'userSpaceOnUse', x1: 0, x2: XN, y1: 0, y2: 0 }, defs);
  for (let k = 0; k <= 8; k++) el('stop', { offset: k / 8, 'stop-color': C.accentInk, 'stop-opacity': Math.exp(-(1 - k / 8) * 2.6).toFixed(3) }, fade);
  const cp = el('clipPath', { id: 'plot' }, defs);
  el('rect', { x: 48, y: LT - 16, width: W - 48, height: QB[1] - LT + 30 }, cp);
  const plot = el('g', { 'clip-path': 'url(#plot)' }, s);
  g.grat = [0, 1, 2, 3].map(() => el('path', { stroke: C.rule, 'stroke-width': 1, fill: 'none' }, plot));
  g.strip = el('rect', { y: LT - 6, height: QB[1] - LT + 12, fill: C.accent, opacity: 0.16 }, plot);
  g.poll = el('path', { stroke: C.line3, 'stroke-width': 1, fill: 'none' }, plot);
  g.sent = el('line', { y1: LT - 6, y2: LB, stroke: C.info, 'stroke-width': 2, 'stroke-dasharray': '5 6' }, plot);
  g.past = el('path', { fill: 'none', stroke: 'url(#tfade)', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, plot);
  g.fut = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 2, opacity: 0.5, 'stroke-linejoin': 'round' }, plot);
  g.hot = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, plot);
  g.stair = el('path', { fill: 'none', stroke: C.ink, 'stroke-width': 2, 'stroke-linejoin': 'miter' }, plot);
  g.dots = el('path', { fill: C.accentInk }, plot);
  g.knots = Array.from({ length: 24 }, () => el('circle', { r: 7, fill: C.bg, stroke: C.ink, 'stroke-width': 2.5 }, plot));
  g.pulse = el('circle', { r: 0, fill: 'none', stroke: C.info, 'stroke-width': 2 }, plot);
  g.lease = el('path', { fill: 'none', stroke: C.ink, 'stroke-width': 2 }, plot);
  g.leaseT = txt(plot, 0, 0, 'lease 4 ms', 'mono', 13, C.ink, 'end');
  g.flash = el('line', { y1: LT - 6, y2: QB[1] + 6, stroke: C.accentInk, 'stroke-width': 2 }, plot);
  // a band too dense to draw edge by edge glows with the edge rate, as on a scope
  g.bandA = [0.22, 0.4, 0.62].map((o) => el('path', { fill: C.accentInk, opacity: o }, plot));
  g.bandB = [0.18, 0.33, 0.5].map((o) => el('path', { fill: C.ink2, opacity: o }, plot));
  g.qa = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, plot);
  g.qb = el('path', { fill: 'none', stroke: C.ink2, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, plot);
  g.ideal = el('path', { fill: 'none', stroke: C.info, 'stroke-width': 2, 'stroke-dasharray': '3 4' }, plot);
  g.gap = el('path', { fill: 'none', stroke: C.info, 'stroke-width': 2 }, plot);
  g.gapT = txt(plot, 0, 0, '', 'mono', 13, C.info, 'middle');
  g.labels = [txt(plot, 0, 0, '+900 ms, sent', 'mono', 13, C.info), txt(plot, 0, LT + 8, '128 ms', 'mono', 13, C.accentInk)];
  g.lblStep = txt(plot, 0, 0, '1 step', 'mono', 13, C.ink);
  // the now line and the carriage on it
  el('line', { x1: XN, x2: XN, y1: LT - 16, y2: RY, stroke: C.ink, 'stroke-width': 2 }, s);
  g.halo = el('circle', { cx: XN, r: 16, fill: C.accentInk, opacity: 0.18 }, s);
  g.car = el('circle', { cx: XN, r: 7, fill: C.accentInk, stroke: C.bg, 'stroke-width': 2.5 }, s);
  txt(s, 18, (QA[0] + QA[1]) / 2 + 5, 'A', 'mono', 14, C.ink3);
  txt(s, 18, (QB[0] + QB[1]) / 2 + 5, 'B', 'mono', 14, C.ink3);
  txt(s, 18, LT + 4, 'mm', 'mono', 13, C.ink3);
  // the ruler: now, and the labelled divisions
  el('line', { x1: 0, x2: W, y1: RY, y2: RY, stroke: C.line3, 'stroke-width': 1.5 }, s);
  txt(s, XN, RY + 26, 'now', 'mono', 14, C.ink, 'middle');
  g.ticks = el('path', { stroke: C.ink3, 'stroke-width': 1.5 }, s);
  g.tl = Array.from({ length: 14 }, () => txt(s, 0, RY + 26, '', 'mono', 13, C.ink3, 'middle'));
  g.speed = txt(s, 40, 684, '', 'mono', 15, C.ink2);
  g.div = txt(s, W - 40, 684, '', 'mono', 15, C.ink2, 'end');
  // the stop's caption
  g.cap = STOPS.map((st) => {
    const e = el('g', { opacity: 0 }, s);
    txt(e, 40, 52, st.kick, 'kick', 17, C.ink3);
    txt(e, 40, 112, st.big, 'disp', 62, C.ink);
    txt(e, W - 40, 112, st.line, 'mono', 15, C.ink2, 'end');
    return e;
  });
}

function tauAt(t) {
  const N = TAU.length - 1, u = (((t % DUR) + DUR) % DUR) * 600, i = Math.min(N - 1, Math.floor(u));
  return TAU[i] + (TAU[i + 1] - TAU[i]) * (u - i);
}
const d3 = (x) => x.toFixed(2);

function draw(t) {
  t = ((t % DUR) + DUR) % DUR;
  const L = lnSpan(t), span = Math.exp(L), now = tauAt(t) + TAU0;
  const X = (tau) => XN + ((tau - now) / span) * W, T = (x) => now + ((x - XN) / W) * span;
  const ta = T(-8), tb = T(W + 8);
  // the lane follows the carriage once the view is narrower than a stroke
  const ySpan = clamp(260 * span, 0.032, 110), w = smoother(clamp((110 - ySpan) / 70));
  const yc = lerp(55, pAt(now), w);
  const Y = (mm) => LC - ((mm - yc) / ySpan) * LH;

  // captions: each stop's, faded by how far the view is from it
  STOPS.forEach((_, i) => {
    const gap = i ? LS[i - 1] - LS[i] : LS[0] - LS[1];
    g.cap[i].setAttribute('opacity', d3(smoother(clamp(1 - Math.abs(L - LS[i]) / (0.42 * gap)))));
  });

  // graticule: decades from now; a finer one fades in as the lines spread
  const n0 = Math.floor(Math.log10(span / 256));
  let lab = null;
  for (let j = 0; j < 4; j++) {
    const step = Math.pow(10, n0 + j), px = (step / span) * W;
    let d = '';
    if (px >= 5) for (let k = Math.ceil((0 - XN) / px); k * px + XN <= W; k++) {
      if (k % 10 === 0 && j < 3) continue;
      const x = XN + k * px;
      d += `M${x.toFixed(1)} ${LT - 16}V${QB[1] + 14}`;
    }
    g.grat[j].setAttribute('d', d);
    g.grat[j].setAttribute('opacity', d3(clamp((px - 5) / 60)));
    if (!lab && px >= 110) lab = { step, px };
  }
  let td = '', li = 0;
  if (lab) for (let k = Math.ceil(-XN / lab.px); k * lab.px + XN <= W && li < g.tl.length; k++) {
    if (!k) continue;
    const x = XN + k * lab.px;
    td += `M${x.toFixed(1)} ${RY}v8`;
    const e = g.tl[li++];
    e.setAttribute('x', x.toFixed(1));
    e.textContent = (k > 0 ? '+' : '−') + fmt(Math.abs(k * lab.step));
    e.setAttribute('opacity', Math.abs(x - XN) < 50 ? 0 : 1);
  }
  for (; li < g.tl.length; li++) g.tl[li].textContent = '';
  g.ticks.setAttribute('d', td);

  // knots: known once sent, 900 ms ahead
  const known = now + LEAD, base = Math.floor(now / PER) * PER, ks = [];
  for (let n = -1; n <= 1; n++) for (const k of KDATA.stroke.solved) ks.push({ t: base + n * PER + k.t, p: k.p * MM });
  const last = ks.filter((k) => k.t <= known).reduce((a, k) => (k.t > a ? k.t : a), -1e9);
  let ki = 0;
  for (const k of ks) {
    const x = X(k.t), on = k.t <= known && x > -20 && x < W + 20;
    const c = g.knots[ki++];
    if (!on) { c.setAttribute('opacity', 0); continue; }
    const age = (known - k.t) / (span / W);   // px since it arrived
    c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', Y(k.p).toFixed(1));
    c.setAttribute('opacity', d3(clamp(age / 20) * clamp((span - 0.05) / 0.2)));
  }
  for (; ki < g.knots.length; ki++) g.knots[ki].setAttribute('opacity', 0);
  // the newest knot rings as it arrives
  const newest = ks.filter((k) => k.t <= known).sort((a, b) => b.t - a.t)[0];
  const since = known - newest.t;   // seconds since it arrived, in plan time
  g.pulse.setAttribute('cx', X(newest.t).toFixed(1)); g.pulse.setAttribute('cy', Y(newest.p).toFixed(1));
  const ring = clamp((since / span) * 4);
  g.pulse.setAttribute('r', d3(8 + 26 * out(ring))); g.pulse.setAttribute('opacity', d3((1 - ring) * clamp((span - 0.05) / 0.2)));
  const sx = X(known);
  g.sent.setAttribute('x1', sx.toFixed(1)); g.sent.setAttribute('x2', sx.toFixed(1));
  g.labels[0].setAttribute('x', (sx + 8).toFixed(1)); g.labels[0].setAttribute('y', LT + 8);

  // the plan: behind now, the strip, then what is known ahead
  const curve = (a, b, n) => {
    if (b <= a) return '';
    let d = '';
    for (let i = 0; i <= n; i++) { const tau = a + ((b - a) * i) / n; d += (i ? 'L' : 'M') + X(tau).toFixed(1) + ' ' + Y(pAt(tau)).toFixed(1); }
    return d;
  };
  const res = (a, b) => Math.max(2, Math.min(260, Math.ceil(((b - a) / span) * W / 3)));
  g.past.setAttribute('d', curve(ta, now, res(ta, now)));
  const se = Math.min(now + STRIP, last, tb);
  g.hot.setAttribute('d', curve(now, se, res(now, se)));
  g.fut.setAttribute('d', curve(se, Math.min(last, tb), res(se, Math.min(last, tb))));
  const x1 = X(now + STRIP);
  g.strip.setAttribute('x', XN); g.strip.setAttribute('width', Math.max(0, Math.min(x1, W + 10) - XN).toFixed(1));
  g.strip.setAttribute('opacity', d3((THEME === 'light' ? 0.1 : 0.16) * clamp((span - 0.004) / 0.03)));
  g.labels[1].setAttribute('x', (XN + 8).toFixed(1));
  g.labels[1].setAttribute('opacity', d3(clamp((x1 - XN - 70) / 40) * clamp((W - 20 - x1) / 60)));

  // 1 ms samples, the lease and its renewal
  const msPx = (TICK / span) * W;
  let dd = '';
  if (msPx >= 7) for (let k = Math.ceil(ta / TICK); k * TICK <= tb; k++) {
    const x = X(k * TICK), y = Y(pAt(k * TICK)), r = k * TICK <= now + STRIP ? 4.5 : 3;
    dd += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  g.dots.setAttribute('d', dd);
  g.dots.setAttribute('opacity', d3(clamp((msPx - 7) / 14) * clamp((60 - msPx / 40) / 20)));
  const kt = Math.floor(now / TICK), frac = now / TICK - kt, step = out(clamp(frac / 0.3));
  const lo = X((kt - 1 + step) * TICK), hi = X((kt + 3 + step) * TICK), ly = LT + 18;
  const lv = clamp((msPx - 30) / 30) * clamp((900 - msPx) / 300);
  g.lease.setAttribute('d', `M${lo.toFixed(1)} ${ly + 8}v-8H${hi.toFixed(1)}v8`);
  g.lease.setAttribute('opacity', d3(lv));
  g.leaseT.setAttribute('x', (hi - 8).toFixed(1)); g.leaseT.setAttribute('y', ly - 8); g.leaseT.setAttribute('opacity', d3(lv));
  // the tick that just renewed it, glowing out
  const fx = X(kt * TICK);
  g.flash.setAttribute('x1', fx.toFixed(1)); g.flash.setAttribute('x2', fx.toFixed(1));
  g.flash.setAttribute('opacity', d3(lv * Math.exp(-frac * 5)));

  // the steps and the quadrature: exact edges when they can be told apart, density otherwise
  const E = edges(ta, tb, 900);
  const qa = [], qb = [];
  const ba = ['', '', ''], bb = ['', '', ''];
  let st = '', id = '';
  if (E) {
    let c = Math.floor(pAt(Math.floor(ta / GRID) * GRID) * SPM), x = -8;
    const pts = (c0) => gray(c0);
    let [a, b] = pts(c);
    qa.push([x, a]); qb.push([x, b]);
    let sy = Y(c / SPM);
    st = `M${x} ${sy.toFixed(1)}`;
    for (const e of E) {
      const ex = X(e.te);
      if (ex < -8) { c = e.c; [a, b] = pts(c); qa[0][1] = a; qb[0][1] = b; sy = Y(c / SPM); st = `M-8 ${sy.toFixed(1)}`; continue; }
      const [na, nb] = pts(e.c);
      if (na !== a) { qa.push([ex, a], [ex, na]); a = na; }
      if (nb !== b) { qb.push([ex, b], [ex, nb]); b = nb; }
      const ny = Y((e.c) / SPM);
      st += `H${ex.toFixed(1)}V${ny.toFixed(1)}`;
      sy = ny;
      const ix = X(e.ti);
      if (ix > -8 && ix < W + 8) id += `M${ix.toFixed(1)} ${QA[0] - 14}V${QB[1] + 8}`;
      c = e.c;
    }
    qa.push([W + 8, a]); qb.push([W + 8, b]);
    st += `H${W + 8}`;
  } else {
    // too many edges to draw one by one: per 2 px column, a level or a solid band where it toggles
    let pc = Math.floor(pAt(T(-8)) * SPM), run = -1, lv = 0;
    let [a, b] = gray(pc);
    const perMm = (2 / W) * span * SPM;   // edges in one column per mm/s
    const flush = (x) => { ba[lv] += `M${run} ${QA[0]}H${x}V${QA[1]}H${run}z`; bb[lv] += `M${run} ${QB[0]}H${x}V${QB[1]}H${run}z`; run = -1; };
    for (let x = -8; x <= W + 8; x += 2) {
      const c = Math.floor(pAt(T(x + 2)) * SPM), dc = Math.abs(c - pc), busy = dc >= 2, [na, nb] = gray(c);
      const l = dc < 70 * perMm ? 0 : dc < 150 * perMm ? 1 : 2;
      if (run >= 0 && (!busy || l !== lv)) flush(x);
      if (busy && run < 0) { run = x; lv = l; }
      // a busy column is a band, not a line: the wave picks up after it
      qa.push([x, busy ? null : a], [x + 2, busy ? null : na]); qb.push([x, busy ? null : b], [x + 2, busy ? null : nb]);
      a = na; b = nb; pc = c;
    }
    if (run >= 0) flush(W + 8);
  }
  const wave = (pts, lane) => {
    let d = '', pen = false;
    for (const [x, v] of pts) {
      if (v == null) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + (+x).toFixed(1) + ' ' + (v ? lane[0] : lane[1]);
      pen = true;
    }
    return d;
  };
  g.qa.setAttribute('d', wave(qa, QA)); g.qb.setAttribute('d', wave(qb, QB));
  for (let i = 0; i < 3; i++) { g.bandA[i].setAttribute('d', ba[i]); g.bandB[i].setAttribute('d', bb[i]); }
  // the staircase is the count: one step per edge, once a step is tall enough to see
  const stepPx = (1 / SPM / ySpan) * LH;
  g.stair.setAttribute('d', E ? st : '');
  g.stair.setAttribute('opacity', d3(clamp((stepPx - 3) / 12)));
  g.lblStep.setAttribute('opacity', d3(clamp((stepPx - 18) / 14)));
  g.lblStep.setAttribute('x', XN - 72); g.lblStep.setAttribute('y', (Y(pAt(now)) - stepPx * 0.5 + 4).toFixed(1));
  // the poll grid, and each deadline against the poll it lands on
  const gPx = (GRID / span) * W;
  let pd = '';
  if (gPx >= 6) for (let k = Math.ceil(ta / GRID); k * GRID <= tb; k++) pd += `M${X(k * GRID).toFixed(1)} ${QA[0] - 14}V${QB[1] + 8}`;
  g.poll.setAttribute('d', pd);
  g.poll.setAttribute('opacity', d3(clamp((gPx - 6) / 24)));
  g.ideal.setAttribute('d', gPx >= 6 ? id : '');
  g.ideal.setAttribute('opacity', d3(clamp((gPx - 10) / 30)));
  const fi = X(FOCUS), fe = X(Math.ceil(FOCUS / GRID - 1e-9) * GRID), gv = clamp((gPx - 30) / 40);
  g.gap.setAttribute('d', `M${fi.toFixed(1)} ${QA[0] - 22}h${(fe - fi).toFixed(1)}M${fi.toFixed(1)} ${QA[0] - 27}v10M${fe.toFixed(1)} ${QA[0] - 27}v10`);
  g.gap.setAttribute('opacity', d3(gv));
  g.gapT.setAttribute('x', ((fi + fe) / 2).toFixed(1)); g.gapT.setAttribute('y', QA[0] - 34);
  g.gapT.textContent = Math.round((Math.ceil(FOCUS / GRID - 1e-9) * GRID - FOCUS) * 1e9) + ' ns to the next poll';
  g.gapT.setAttribute('opacity', d3(gv));

  // the carriage on the now line
  const cy = Y(pAt(now));
  g.car.setAttribute('cy', cy.toFixed(1)); g.halo.setAttribute('cy', cy.toFixed(1));
  // readouts
  const v = vAt(now), rate = (tauAt(t + 0.01) - tauAt(t)) / 0.01;
  // the position readout gains a digit for every tenfold zoom on the lane
  const dp = Math.round(clamp(Math.ceil(-Math.log10(ySpan / 40)), 1, 4));
  g.speed.textContent = `x ${pAt(now).toFixed(dp)} mm  ·  v ${Math.abs(v).toFixed(0)} mm/s  ·  ${(Math.abs(v) * SPM / 1000).toFixed(1)} k steps/s`;
  g.div.textContent = (lab ? fmt(lab.step) + '/div  ·  ' : '') + (rate >= 0.1 ? 'time ×' + rate.toFixed(2) : 'slowed 1:' + sig2(1 / rate));
}

run(setup, draw, DUR);
