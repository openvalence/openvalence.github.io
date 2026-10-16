// mark-anim.js -- the OpenValence mark, animated two ways. Every picture is a pure function of
// t in seconds (draw(t)), so HyperFrames can seek any frame and a page loop is just draw(now).
//   orbit(svg)    the site's mark: three electrons are captured into the ring and snap into their
//                 gaps; a hover excites them out and they drop back. header(img) wires it in.
//   phosphor(el)  Phosphor's: the ring spins past a pump point; each electron that passes it jumps
//                 out, lingers, drops back with a quantum of light, and the screen's afterglow decays.
// The motion borrows from the physics, it does not teach it: jumps between levels are instant
// (softened only by an afterglow echo), how long an electron stays excited is drawn from an
// exponential distribution (seeded, so every loop is the same loop), light decays as exp(-t/tau),
// orbits turn at constant angular speed, and every drop sends one photon out. Level radii follow
// Bohr's r ~ n^2 with the ring as n = 6. Nothing eases.
// Geometry: Valence/assets/icons/README.md (ring r 300, stroke 80, dot r 54, core r 136, 28 clear).
// Constraints: no clock or randomness inside draw(t). This file is the source;
// Phosphor's src/ui/mark-anim.js is a byte-identical copy (edit here, then copy).

const R = 300, STROKE = 80, DOT = 54, CORE = 136;
const G = 23.356;                                             // electron center to arc cap center, degrees (icon-app.svg)
const SPAN = 120 - 2 * G;                                     // one arc, degrees
const SLOTS = [-90, 30, 150];                                 // electron angles, clockwise from +x
const VIOLET = '#A78BFA', BLUE = '#4DA6FF';
const RAD = Math.PI / 180;
const level = (n) => R * (n / 6) ** 2;                        // 6: the ring, 7: 408, 8: 533
const VIEW = 560;                                             // past this radius a particle has left the picture
const LIGHT = 1700;                                           // a photon's speed, units/s: light, slowed until it can be seen
const PH_LEN = 0.035;                                         // a photon's streak, s of travel

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const polar = (deg, r) => [r * Math.cos(deg * RAD), r * Math.sin(deg * RAD)];
// a seeded generator (mulberry32): the same seed, the same draws, every run
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// a waiting time drawn from an exponential distribution with mean tau, kept within [lo, hi]
const wait = (u, tau, lo, hi) => clamp(-tau * Math.log(1 - u), lo, hi);
// a photon leaving (x, y) at te in direction deg: its streak's tail and head at t, or null
function photonAt(p, t) {
  const a = t - p.te;
  if (a < 0) return null;
  const c = Math.cos(p.dir * RAD), s = Math.sin(p.dir * RAD), h = LIGHT * a, tl = LIGHT * Math.max(0, a - PH_LEN);
  const hx = p.x + c * h, hy = p.y + s * h;
  if (hx * hx + hy * hy > VIEW * VIEW) return null;
  return [p.x + c * tl, p.y + s * tl, hx, hy];
}

function arcPath(k) {
  const [x0, y0] = polar(SLOTS[k] + G, R), [x1, y1] = polar(SLOTS[k] + 120 - G, R);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// The static mark, structured for orbit(): one group per electron, holding the arc behind it and
// the electron. Same proportions as /mark.svg.
export const MARK_SVG = `<svg class="ov-mark" viewBox="-351 -351 702 702" aria-hidden="true" focusable="false"><g class="ov-ring">${
  SLOTS.map((s, j) => `<g class="ov-p"><path d="${arcPath((j + 2) % 3)}" fill="none" stroke="${VIOLET}" stroke-width="${STROKE}" stroke-linecap="round"/><circle r="${DOT}" fill="${BLUE}" transform="rotate(${s + 90}) translate(0 -${R})"/></g>`).join('')
}<circle class="ov-core" r="${CORE}" fill="${BLUE}"/></g></svg>`;

// orbit(svg, opts): drives a MARK_SVG. The nucleus and the ring are there from the start.
//   draw(t)       the intro: the electrons are captured one after another, gaps between captures
//                 drawn from an exponential; the finished mark from END on.
//   excite(t, k)  hover k (any integer, a different draw each): every electron jumps out a level,
//                 lingers an exponential while, drops back and sends a photon. Over at EXCITE(k).
//   ionize(t)     every electron is knocked free and leaves at constant speed. Over at IONIZE.
//   reset()       back to the static markup.
// mode, the capture:
//   'orbit'    the electron appears on level 7, circles there at constant angular speed (timed so
//              it passes its gap), and drops into the gap as it arrives: one photon.
//   'cascade'  it appears on level 8 above its gap and drops 8 -> 7 -> 6, an exponential wait on
//              each: two photons.
//   'capture'  a free electron flies straight in at constant speed and is caught in its gap: one
//              photon.
export function orbit(svg, o = {}) {
  const P = { mode: 'orbit', seed: 11, start: 0.15, gap: 0.3, tau: 0.32, w7: 120, speed: 1100, echo: 0.11, ...o };
  const ps = [...svg.querySelectorAll('.ov-p')], es = ps.map((g) => g.lastChild);
  const ring = svg.querySelector('.ov-ring'), NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); e.setAttribute('opacity', '0'); ring.insertBefore(e, ring.firstChild); return e; };
  // an echo per electron (the afterglow where it was before a jump) and a few photon streaks
  const echoes = es.map(() => mk('circle', { r: DOT, fill: BLUE }));
  const lines = Array.from({ length: 6 }, () => mk('line', { stroke: BLUE, 'stroke-width': DOT * 0.5, 'stroke-linecap': 'round' }));
  const statics = es.map((e) => e.getAttribute('transform'));
  const set = (e, k, v) => e.setAttribute(k, v);

  // the intro, worked out once: per electron its path (a function of t) and its jumps
  const r0 = rng(P.seed), order = [0, 1, 2].sort(() => r0() - 0.5);
  const intro = [], photons = [];
  let tc = P.start;
  for (const j of order) {
    const s = SLOTS[j], jumps = [];   // tc: when this electron enters the picture
    let bind;
    if (P.mode === 'cascade') {
      const d8 = wait(r0(), P.tau, 0.1, 0.8), d7 = wait(r0(), P.tau, 0.1, 0.8);
      bind = tc + d8 + d7;
      jumps.push({ t: tc }, { t: tc + d8 }, { t: bind });
      const t7 = tc + d8, t6 = bind, t8 = tc;
      intro[j] = { bind, path: (t) => (t < t8 ? null : [s, level(t < t7 ? 8 : t < t6 ? 7 : 6)]) };
    } else if (P.mode === 'capture') {
      bind = tc + (VIEW - R) / P.speed;
      const b0 = bind;
      intro[j] = { bind, path: (t) => { const r = R + P.speed * Math.max(0, b0 - t); return r >= VIEW ? null : [s, r]; } };
      jumps.push({ t: bind });
    } else {
      const d = wait(r0(), P.tau * 2, 0.35, 1.2), w = P.w7, t7 = tc;   // constant angular speed on level 7
      bind = tc + d;
      const b0 = bind;
      intro[j] = { bind, path: (t) => (t < t7 ? null : t < b0 ? [s - w * (b0 - t), level(7)] : [s, R]) };
      jumps.push({ t: tc }, { t: bind });
    }
    // every jump down sends one photon; an appearance is a capture from outside, a jump down too
    for (const k of jumps) {
      const [th, r] = intro[j].path(k.t + 1e-6);
      const [x, y] = polar(th, r);
      photons.push({ te: k.t, x, y, dir: r0() * 360 });
    }
    intro[j].jumps = jumps;
    tc += wait(r0(), P.gap, 0.08, 0.45);
  }
  const END = Math.max(...intro.map((e) => e.bind)) + 0.4;

  // place electron j at [deg, r] (null: not in the picture), its echo at the last jump's start
  function put(j, pos, echo) {
    if (!pos) { set(es[j], 'opacity', '0'); } else {
      const [x, y] = polar(pos[0], pos[1]);
      set(es[j], 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      set(es[j], 'opacity', '1');
    }
    if (echo && echo.a > 0.01) {
      const [x, y] = polar(echo.pos[0], echo.pos[1]);
      set(echoes[j], 'cx', x.toFixed(2)); set(echoes[j], 'cy', y.toFixed(2));
      set(echoes[j], 'opacity', echo.a.toFixed(3));
    } else set(echoes[j], 'opacity', '0');
  }
  function light(list, t) {
    let i = 0;
    for (const p of list) {
      const s = photonAt(p, t);
      if (!s || i >= lines.length) continue;
      const l = lines[i++];
      set(l, 'x1', s[0].toFixed(1)); set(l, 'y1', s[1].toFixed(1)); set(l, 'x2', s[2].toFixed(1)); set(l, 'y2', s[3].toFixed(1));
      set(l, 'opacity', '1');
    }
    for (; i < lines.length; i++) set(lines[i], 'opacity', '0');
  }
  // the echo of the latest jump before t: where the electron was, fading as exp(-age / echo)
  function echoOf(path, jumps, t) {
    let last = null;
    for (const k of jumps) if (k.t <= t) last = k;
    if (!last) return null;
    const before = path(last.t - 1e-6);
    return before ? { pos: before, a: 0.55 * Math.exp(-(t - last.t) / P.echo) } : null;
  }

  function draw(t) {
    for (let j = 0; j < 3; j++) { const e = intro[j]; put(j, e.path(t), echoOf(e.path, e.jumps, t)); }
    light(photons, t);
  }

  // hover k: its own draws; every electron up one level at nearly once, down after its own wait
  const hovers = new Map();
  function plan(k) {
    if (hovers.has(k)) return hovers.get(k);
    const r = rng(P.seed * 7919 + k * 104729), ev = [];
    for (let j = 0; j < 3; j++) {
      const up = r() * 0.12, down = up + wait(r(), P.tau, 0.08, 0.9), [x, y] = polar(SLOTS[j], R);
      ev[j] = { up, down, ph: { te: down, x, y, dir: r() * 360 } };
    }
    const p = { ev, end: Math.max(...ev.map((e) => e.down)) + 0.35 };
    hovers.set(k, p);
    return p;
  }
  function excite(t, k) {
    const { ev } = plan(k);
    for (let j = 0; j < 3; j++) {
      const e = ev[j], s = SLOTS[j], up = t >= e.up && t < e.down;
      const path = (u) => [s, u >= e.up && u < e.down ? level(7) : R];
      put(j, path(t), echoOf(path, [{ t: e.up }, { t: e.down }], t));
    }
    light(ev.map((e) => e.ph), t);
  }
  const EXCITE = (k) => plan(k).end;

  // ionization: knocked free, each leaves along its own radius at constant speed
  const r1 = rng(P.seed + 1), ion = [0, 1, 2].map(() => r1() * 0.3);
  const IONIZE = Math.max(...ion) + (VIEW - R) / P.speed + 0.05;
  function ionize(t) {
    for (let j = 0; j < 3; j++) {
      const r = R + P.speed * Math.max(0, t - ion[j]);
      put(j, r > VIEW ? null : [SLOTS[j], r], null);
    }
    light([], t);
  }

  function reset() {
    es.forEach((e, j) => { set(e, 'transform', statics[j]); e.removeAttribute('opacity'); });
    for (const e of [...echoes, ...lines]) set(e, 'opacity', '0');
  }
  return { draw, excite, ionize, reset, END, EXCITE, IONIZE };
}

// header(img): the site header's mark (openvalence.github.io, tools/chrome.html). Swaps the static
// <img> for a MARK_SVG of the same size, plays the intro once when html.intro is set (the head script
// sets it on the home page's first load in a session; style.css hides the img meanwhile), then
// excites the electrons once per hover or keyboard focus. Site only.
export function header(img) {
  const html = document.documentElement, brand = img.closest('a') || img.parentElement;
  img.insertAdjacentHTML('afterend', MARK_SVG);
  const svg = img.nextElementSibling, o = orbit(svg);
  svg.setAttribute('width', img.width);
  svg.setAttribute('height', img.height);
  let busy = false, k = 0;
  const go = (dur, f) => {
    if (busy) return;
    busy = true;
    const t0 = performance.now();
    const tick = (now) => { const t = Math.min(dur, (now - t0) / 1000); f(t); if (t < dur) requestAnimationFrame(tick); else { o.reset(); busy = false; } };
    requestAnimationFrame(tick);
  };
  if (html.classList.contains('intro')) {
    try { sessionStorage.setItem('intro', '1'); } catch (e) {}
    if (performance.now() < 2300) { o.draw(0); go(o.END, o.draw); }   // later, style.css has shown the img: no intro
  }
  img.remove();
  html.classList.remove('intro');
  const step = () => { const n = ++k; go(o.EXCITE(n), (t) => o.excite(t, n)); };
  brand.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') step(); });
  brand.addEventListener('focus', () => { if (brand.matches(':focus-visible')) step(); });
}

// ---- phosphor -------------------------------------------------------------------------------

// Colors as [r, g, b] from any CSS color (a token may be oklch or color-mix): the browser computes
// it and a 1 px canvas reads it back. An invalid or empty value takes the fallback.
let px = null;
function rgbOf(probe, css, fb) {
  probe.style.color = '';
  probe.style.color = css;
  if (!probe.style.color) probe.style.color = fb;
  px ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  px.clearRect(0, 0, 1, 1);
  px.fillStyle = fb;
  px.fillStyle = getComputedStyle(probe).color;
  px.fillRect(0, 0, 1, 1);
  const d = px.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${clamp(a).toFixed(4)})`;

// phosphor(host, opts): a canvas filling host. Colors from host's CSS custom properties
// --mark-ring, --mark-core and --mark-bg (a light background means plain blending, a dark one
// additive light); refresh() re-reads them. play() / stop() run it on the page clock; draw(t, calm)
// draws one frame, calm: the resting mark. The loop is `period` s long: turns x spin.
// The ring turns at constant speed. Each electron that passes the pump point absorbs and jumps out
// (instantly), stays excited for a time drawn from an exponential (mean tau), drops back (instantly)
// and sends out one photon; its light and the ring's afterglow decay as exp(-t / glow). The draws
// are stratified over the loop, so it holds short and long waits in the right proportion.
// mode:
//   'pump'    as above: excitation at the pump point, one level up.
//   'triplet' as 'pump', but the jump lands two levels up and falls one level within isc s without
//             light before the wait (a phosphor's metastable state); the drop back is the light.
//   'random'  no pump point: absorptions arrive at exponential intervals anywhere on the turn.
// Options (the chosen defaults): spin (s per turn), turns, beam (pump point, degrees, -90 the top),
// tau (mean wait, s), isc (s), glow (afterglow, s), rate (absorptions per s per electron, 'random').
export function phosphor(host, o = {}) {
  const P = { mode: 'pump', spin: 3.2, turns: 3, beam: -60, tau: 0.7, isc: 0.06, glow: 0.4, rate: 0.35, seed: 5, ...o };
  const L = P.spin * P.turns;
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  const probe = host.appendChild(document.createElement('span'));
  probe.style.display = 'none';
  let ring, core, light, Lk, k = 1, w = 0, h = 0, sprite = {}, grad = null, raf = 0, t0 = 0, lastT = 0, still = false;

  // the loop's events, worked out once: per electron [{a: absorbed, i: settled, e: emitted, dir}]
  const ev = [[], [], []], rnd = rng(P.seed);
  const turn = (deg) => ((((deg - P.beam) % 360) + 360) % 360) / 360 * P.spin;   // s until a slot angle meets the beam
  if (P.mode === 'random') {
    for (let j = 0; j < 3; j++) {
      let t = rnd() * L;
      for (let n = 0; n < 40; n++) {
        const d = wait(rnd(), P.tau, 0.05, L / 3), a = t;
        ev[j].push({ a, i: a, e: a + d, dir: rnd() * 360 });
        t = a + d + wait(rnd(), 1 / P.rate, 0.2, L);
        if (t >= ev[j][0].a + L) break;
      }
      ev[j] = ev[j].map((x) => ({ ...x, a: x.a % L, i: x.i % L, e: x.a % L + (x.e - x.a) })).sort((p, q) => p.a - q.a);
    }
  } else {
    // stratified exponential waits, shuffled: short and long in the right share every loop
    const n = 3 * P.turns, q = Array.from({ length: n }, (_, i) => -P.tau * Math.log(1 - (i + 0.5) / n)).sort(() => rnd() - 0.5);
    for (let j = 0; j < 3; j++) for (let m = 0; m < P.turns; m++) {
      const a = turn(-SLOTS[j] + 2 * P.beam) + m * P.spin;   // passes the beam
      const i = P.mode === 'triplet' ? a + P.isc : a, d = Math.min(q[j * P.turns + m], P.spin * 0.85 - (i - a));
      ev[j].push({ a, i, e: i + d, dir: rnd() * 360 });
    }
  }
  const mod = (t) => ((t % L) + L) % L;
  // electron j at time t: angle, level radius, and its emission's afterglow (0..1)
  function state(j, t) {
    const tm = mod(t), th = SLOTS[j] + (360 * t) / P.spin;
    let n = 6, b = 0;
    for (const x of ev[j]) for (const s of [0, -L]) {
      const a = x.a + s, i = x.i + s, e = x.e + s;
      if (tm >= a && tm < e) n = tm < i ? 8 : 7;
      if (tm >= e) b = Math.max(b, Math.exp(-(tm - e) / P.glow));
    }
    return { th, r: level(n), b };
  }
  // photons in flight at t, from this loop and the last
  function photons(t) {
    const tm = mod(t), out = [];
    for (let j = 0; j < 3; j++) for (const x of ev[j]) for (const s of [0, -L]) {
      const te = x.e + s;
      if (tm < te || tm - te > (VIEW + R) / LIGHT) continue;
      const [px0, py0] = polar(SLOTS[j] + (360 * (t - (tm - te))) / P.spin, R);
      const seg = photonAt({ te, x: px0, y: py0, dir: x.dir }, tm);
      if (seg) out.push(seg);
    }
    return out;
  }

  function refresh() {
    const cs = getComputedStyle(host);
    ring = rgbOf(probe, cs.getPropertyValue('--mark-ring').trim(), VIOLET);
    core = rgbOf(probe, cs.getPropertyValue('--mark-core').trim(), BLUE);
    const bg = rgbOf(probe, cs.getPropertyValue('--mark-bg').trim(), '#08090B');
    light = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] > 140;
    // light: no light to add, so excitation reads as saturation and a faint halo
    Lk = light
      ? { arc: 0.8, halo: 0.02, trail: 0.05, eRest: 1, eBloom: 0.05, coreBloom: 0, hot: 0 }
      : { arc: 0.6, halo: 0.11, trail: 0.12, eRest: 0.7, eBloom: 0.34, coreBloom: 0.1, hot: 0.6 };
    sprite = {}; grad = null;
    if (w) draw(lastT, still);
  }
  // A soft disc (solid out to `solid` of r) or, solid = 0, a Gaussian bloom; rendered once per size.
  function spr(key, rgb, ru, solid) {
    const rpx = Math.max(1, Math.round(ru * k)), id = key + rpx;
    if (sprite[id]) return sprite[id];
    const n = rpx * 2, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d'), gr = g.createRadialGradient(rpx, rpx, 0, rpx, rpx, rpx);
    if (solid) { gr.addColorStop(0, rgba(rgb, 1)); gr.addColorStop(solid, rgba(rgb, 1)); gr.addColorStop(1, rgba(rgb, 0)); }
    else for (let i = 0; i <= 32; i++) { const x = i / 32; gr.addColorStop(x, rgba(rgb, Math.exp(-x * x * 5) * (1 - x * x))); }
    g.fillStyle = gr;
    g.fillRect(0, 0, n, n);
    return (sprite[id] = c);
  }
  const put = (img, x, y, ru, a) => { if (a < 0.004) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(img, x - ru, y - ru, 2 * ru, 2 * ru); };
  function size() {
    const b = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);   // soft light: 2x is enough
    w = Math.round(b.width * dpr); h = Math.round(b.height * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    k = Math.min(w, h) / 1180;   // level 8 and its glow stay inside the box
    sprite = {}; grad = null;
    draw(lastT, still);
  }
  // the ring's afterglow: lit as it passes the pump point, decaying since; fixed in the world, the
  // arcs turn through it. 'random' has no pump point: a steady ring.
  function ringStroke() {
    if (P.mode === 'random' || !ctx.createConicGradient) return rgba(ring, Lk.arc + 0.1);
    const g = ctx.createConicGradient(P.beam * RAD, 0, 0), n = 48;
    for (let i = 0; i <= n; i++) {
      const f = (i / n) ** 2, age = f * P.spin, lit = Math.exp(-age / P.glow) / (1 - Math.exp(-P.spin / P.glow));
      g.addColorStop(f, rgba(ring, Lk.arc + (1 - Lk.arc) * clamp(lit)));
    }
    return g;
  }
  const litAt = (phi) => P.mode === 'random' ? 0.1 : clamp(Math.exp(-turn(phi) / P.glow) / (1 - Math.exp(-P.spin / P.glow)));
  function draw(t, calm = false) {
    lastT = t;
    if (!w) return;
    const spin = (360 * t) / P.spin;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(k, 0, 0, k, w / 2, h / 2);
    ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
    const at = (tt, j) => { if (calm) return { th: SLOTS[j] + spin, r: R, b: 0 }; const s = state(j, tt); const [x, y] = polar(s.th, s.r); return { x, y, b: s.b }; };
    const heads = [0, 1, 2].map((j) => { const s = at(t, j); if (calm) { const [x, y] = polar(s.th, s.r); return { x, y, b: 0 }; } return s; });
    const energy = heads.reduce((s, p) => s + p.b, 0);
    if (Lk.coreBloom && !calm) put(spr('gc', core, CORE * 2.4, 0), 0, 0, CORE * 2.4, Lk.coreBloom * (0.7 + 0.4 * energy));
    if (!calm) {
      // the arcs' bloom: Gaussians along each arc, as bright as the ring there
      const gb = spr('ga', ring, STROKE * 1.9, 0);
      for (let a = 0; a < 3; a++) for (let i = 0; i <= 10; i++) {
        const phi = SLOTS[a] + G + spin + (SPAN * i) / 10, [x, y] = polar(phi, R);
        put(gb, x, y, STROKE * 1.9, Lk.halo * (0.35 + 2.2 * litAt(phi)));
      }
      // persistence: every earlier position, as bright as the electron was then, decayed since
      const dt = 1 / 60, disc = spr('d', core, DOT * 1.15, 0.7);
      for (let i = 1; i * dt < P.glow * 3.5; i++) {
        const age = i * dt, fade = Math.exp(-age / P.glow);
        for (let j = 0; j < 3; j++) { const p = at(t - age, j); put(disc, p.x, p.y, DOT * 1.15 * (0.4 + 0.6 * fade), 2 * Lk.trail * fade * (0.08 + p.b)); }
      }
    }
    if (!grad) grad = ringStroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineWidth = STROKE;
    ctx.strokeStyle = calm ? rgba(ring, 1) : grad;
    ctx.beginPath();
    for (let a = 0; a < 3; a++) { const s0 = (SLOTS[a] + G + spin) * RAD; ctx.moveTo(R * Math.cos(s0), R * Math.sin(s0)); ctx.arc(0, 0, R, s0, s0 + SPAN * RAD); }
    ctx.stroke();
    // photons: a short streak of the core's light, leaving
    if (!calm) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(core, 1);
      ctx.lineWidth = DOT * 0.42;
      ctx.beginPath();
      for (const s of photons(t)) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
      ctx.stroke();
    }
    // the electrons: bloom, body, and a hot center while the emission lasts
    const gl = spr('g', core, DOT * 3.2, 0), hot = spr('w', [255, 255, 255], DOT * 0.75, 0);
    ctx.fillStyle = rgba(core, 1);
    for (const p of heads) {
      if (!calm) put(gl, p.x, p.y, DOT * 3.2, Lk.eBloom * (0.3 + p.b));
      ctx.globalAlpha = calm ? 1 : Lk.eRest + (1 - Lk.eRest) * p.b;
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT, 0, 2 * Math.PI);
      ctx.fill();
      put(hot, p.x, p.y, DOT * 0.75, Lk.hot * p.b);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(core, 1);
    ctx.beginPath();
    ctx.arc(0, 0, CORE, 0, 2 * Math.PI);
    ctx.fill();
  }
  const loop = (ms) => { draw((ms - t0) / 1000); raf = requestAnimationFrame(loop); };
  function play() { if (raf) return; still = false; t0 = performance.now() - lastT * 1000; raf = requestAnimationFrame(loop); }
  function stop(calm = true) { cancelAnimationFrame(raf); raf = 0; still = calm; draw(lastT, calm); }
  const ro = new ResizeObserver(size);
  ro.observe(cv);
  refresh();
  size();
  return {
    draw, play, stop, refresh, canvas: cv, period: L,
    destroy() { stop(); ro.disconnect(); cv.remove(); probe.remove(); },
  };
}
