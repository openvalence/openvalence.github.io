// stroke.js -- The stroke: a script played the way the machine plays it. Knots arrive 900 ms before
// they are due, Kinetic² fills in the curve to each one as it lands, the 128 ms strip runs ahead of
// the carriage, and what the carriage has done fades behind it like a phosphor trace.
// Facts: Phosphor sends up to the 1000 ms factory horizon minus 100 ms ahead (900 ms); Nucleus
// MotionArbiter.h kStripLen 128 on the 1 ms grid. The curve and the knots are Kinetic² output
// (kinetic-data.js, bake.mjs: the same stroke as Screen to rail, 4 s, at rest at both ends).
const DUR = 12;
const PER = 4, SP = KDATA.stroke.P, NSMP = 4000, LEAD = 0.9, STRIP = 0.128;
const W = 1280, H = 360, XN = 700, PXS = 400;          // the now line; 400 px per second
const YT = 52, YB = 308;                                // the rail's ends: position 0 and 1
const DRAW = 0.32;                                      // a new piece draws in over this long
const OVER = 700;                                       // drawn this far past each side: the page shows it in its margins
let g = {};

function pAt(tau) {
  const u = (((tau % PER) + PER) % PER) * 1000, i = Math.min(NSMP - 1, Math.floor(u));
  return SP[i] + (SP[i + 1] - SP[i]) * (u - i);
}
const Y = (p) => YB - p * (YB - YT);
const d1 = (x) => x.toFixed(1);
// a damped spring from rest at 0 to 1 (zeta 0.55): the arrival's small overshoot
function spring(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const z = 0.55, w = 2 * Math.PI * 2.2, wd = w * Math.sqrt(1 - z * z), x = u * 0.9;
  return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x)) * (1 - u * u * u);
}

function setup() {
  const s = document.getElementById('scene');
  s.replaceChildren();
  el('rect', { x: -OVER, width: W + 2 * OVER, height: H, fill: C.bg }, s);
  const defs = el('defs', {}, s);
  // the trace fades with its age, exponentially: the gradient runs along time, which is x
  const fade = el('linearGradient', { id: 'sfade', gradientUnits: 'userSpaceOnUse', x1: -OVER, x2: XN, y1: 0, y2: 0 }, defs);
  for (let k = 0; k <= 12; k++) el('stop', { offset: k / 12, 'stop-color': C.accentInk, 'stop-opacity': Math.exp(-((1 - k / 12) * (XN + OVER)) / 220).toFixed(4) }, fade);
  const glow = el('radialGradient', { id: 'sglow' }, defs);
  el('stop', { offset: 0, 'stop-color': C.accentInk, 'stop-opacity': 0.45 }, glow);
  el('stop', { offset: 1, 'stop-color': C.accentInk, 'stop-opacity': 0 }, glow);
  // rail ends and the sent horizon
  for (const y of [YT, YB]) el('line', { x1: -OVER, x2: W + OVER, y1: y, y2: y, stroke: C.rule, 'stroke-width': 1 }, s);
  const sx = XN + LEAD * PXS;
  el('line', { x1: sx, x2: sx, y1: YT - 22, y2: YB + 22, stroke: C.line3, 'stroke-width': 1.5, 'stroke-dasharray': '3 5' }, s);
  el('text', { x: sx + 10, y: YT - 10, class: 'mono', 'font-size': 13, fill: C.ink3 }, s).textContent = '+900 ms';
  g.strip = el('rect', { x: XN, y: YT - 22, width: STRIP * PXS, height: YB - YT + 44, fill: C.accent, opacity: THEME === 'light' ? 0.08 : 0.14 }, s);
  el('text', { x: XN + 12, y: YB + 40, class: 'mono', 'font-size': 13, fill: C.accentInk }, s).textContent = '128 ms';
  g.halo = el('path', { fill: 'none', stroke: 'url(#sfade)', 'stroke-width': 12, opacity: 0.22, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s);
  g.past = el('path', { fill: 'none', stroke: 'url(#sfade)', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s);
  g.fut = el('path', { fill: 'none', stroke: C.ink3, 'stroke-width': 2, 'stroke-linejoin': 'round' }, s);
  g.hot = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s);
  // the script as the player holds it, straight lines between its actions: past the horizon, and the
  // piece the planner is replacing
  g.script = el('path', { fill: 'none', stroke: C.ink3, 'stroke-width': 1.5, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, s);
  g.old = el('path', { fill: 'none', stroke: C.ink3, 'stroke-width': 1.5, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, s);
  g.queued = el('path', { fill: 'none', stroke: C.ink3, 'stroke-width': 1.5 }, s);
  g.knots = Array.from({ length: 12 }, () => el('circle', { r: 6, fill: C.bg, stroke: C.ink, 'stroke-width': 2.5 }, s));
  g.rings = Array.from({ length: 3 }, () => el('circle', { r: 0, fill: 'none', stroke: C.ink, 'stroke-width': 1.5 }, s));
  // the rail and the carriage on the now line
  el('rect', { x: XN - 3, y: YT - 22, width: 6, height: YB - YT + 44, rx: 3, fill: C.bg3 }, s);
  g.glow = el('circle', { cx: XN, r: 42, fill: 'url(#sglow)' }, s);
  g.car = el('rect', { x: XN - 13, width: 26, height: 40, rx: 7, fill: C.accent }, s);
  g.dot = el('circle', { cx: XN, r: 4.5, fill: '#fff' }, s);
  el('text', { x: XN - 12, y: YB + 40, class: 'mono', 'font-size': 13, fill: C.ink, 'text-anchor': 'end' }, s).textContent = 'now';
}

function draw(t) {
  t = ((t % DUR) + DUR) % DUR;
  const now = t, X = (tau) => XN + (tau - now) * PXS;
  const ta = now - (XN + OVER) / PXS, known = now + LEAD;
  // knots: three periods around now; one is known once it is sent, 900 ms before it is due
  const base = Math.floor(now / PER) * PER, ks = [];
  for (let n = -1; n <= 1; n++) for (const k of KDATA.stroke.solved) ks.push({ t: base + n * PER + k.t, p: k.p });
  ks.sort((a, b) => a.t - b.t);
  const sent = ks.filter((k) => k.t <= known), last = sent[sent.length - 1];
  const prev = sent[sent.length - 2] || { t: last.t - 0.5 };
  // the newest piece draws in from the knot before it
  const age = known - last.t, grow = 1 - Math.pow(1 - clamp(age / DRAW), 3);
  const end = prev.t + (last.t - prev.t) * grow;
  const curve = (a, b) => {
    if (b <= a) return '';
    const n = Math.max(2, Math.ceil((b - a) * PXS / 3));
    let d = '';
    for (let i = 0; i <= n; i++) { const tau = a + ((b - a) * i) / n; d += (i ? 'L' : 'M') + d1(X(tau)) + ' ' + d1(Y(pAt(tau))); }
    return d;
  };
  const pd = curve(ta, now);
  g.past.setAttribute('d', pd); g.halo.setAttribute('d', pd);
  g.hot.setAttribute('d', curve(now, Math.min(now + STRIP, end)));
  g.fut.setAttribute('d', curve(now + STRIP, end));
  let ki = 0;
  for (const k of ks) {
    if (ki >= g.knots.length) break;
    const x = X(k.t);
    if (k.t > known || x < -OVER - 20) continue;
    const c = g.knots[ki++], a = known - k.t;
    c.setAttribute('cx', d1(x)); c.setAttribute('cy', d1(Y(k.p)));
    c.setAttribute('r', (6 * spring(a / 0.5)).toFixed(2));
    // a knot behind the carriage has been played: it dims with the trace
    c.setAttribute('opacity', (x < XN ? Math.exp(-(XN - x) / 260) : 1).toFixed(3));
  }
  for (; ki < g.knots.length; ki++) g.knots[ki].setAttribute('r', 0);
  let qd = '';
  for (const k of ks) {
    const x = X(k.t);
    if (k.t > known && x < W + OVER) qd += `M${d1(x - 4)} ${d1(Y(k.p))}a4 4 0 1 0 8 0a4 4 0 1 0 -8 0`;
  }
  g.queued.setAttribute('d', qd);
  const line = (a) => a.map((k, i) => (i ? 'L' : 'M') + d1(X(k.t)) + ' ' + d1(Y(k.p))).join('');
  g.script.setAttribute('d', line(ks.filter((k) => k.t >= last.t && X(k.t) < W + OVER + 200)));
  g.old.setAttribute('d', prev.p == null ? '' : line([prev, last]));
  g.old.setAttribute('opacity', (1 - grow).toFixed(3));
  // each arrival rings once, fading exponentially
  sent.slice(-3).forEach((k, i) => {
    const a = known - k.t, r = g.rings[i];
    r.setAttribute('cx', d1(X(k.t))); r.setAttribute('cy', d1(Y(k.p)));
    r.setAttribute('r', d1(6 + 30 * (1 - Math.exp(-a * 5))));
    r.setAttribute('opacity', (0.8 * Math.exp(-a * 4.5)).toFixed(3));
  });
  const y = Y(pAt(now));
  g.car.setAttribute('y', d1(y - 20)); g.dot.setAttribute('cy', d1(y)); g.glow.setAttribute('cy', d1(y));
}

run(setup, draw, DUR);
