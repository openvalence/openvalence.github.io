// mark-anim.js -- the OpenValence mark, animated two ways. Every picture is a pure function of
// t in seconds (draw(t)), so HyperFrames can seek any frame and a page loop is just draw(now).
//   orbit(svg)    the site's mark: the electrons come in from random places on an elastic ease and
//                 settle into their gaps, then the arcs form between them. Hover: one smooth spin.
//                 header(img) wires it into the site.
//   phosphor(el)  Phosphor's: the mark spins at constant speed; the electrons jump out and back on an
//                 in-out elastic ease, and each leaves a phosphor glow in its wake on the way down,
//                 fading exponentially.
// Motion rules: every velocity is continuous, nothing snaps, and the rest frame is the exact logo.
// Geometry: Valence/assets/icons/README.md (ring r 300, stroke 80, dot r 54, core r 136, 28 clear).
// Constraints: no clock or randomness inside draw(t): a fresh random play takes a new seed when it is
// built. This file is the source; Phosphor's src/ui/mark-anim.js is a byte-identical copy (edit here,
// then copy).

const R = 300, STROKE = 80, DOT = 54, CORE = 136;
const G = 23.356;                                             // electron center to arc cap center, degrees (icon-app.svg)
const SPAN = 120 - 2 * G;                                     // one arc, degrees
const SLOTS = [-90, 30, 150];                                 // electron angles, clockwise from +x
const VIOLET = '#A78BFA', BLUE = '#4DA6FF';
const RAD = Math.PI / 180;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);
const polar = (deg, r) => [r * Math.cos(deg * RAD), r * Math.sin(deg * RAD)];
// a seeded generator (mulberry32): the same seed, the same draws
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Elastic out, as a spring released from rest (damping zeta, frequency hz): 0 at c <= 0, no starting
// velocity, overshoot and damped settles, landing exactly on 1 at c = d (a smoothstep takes up the
// last fraction of a percent, so the hand-off to rest is invisible). zeta 1: no overshoot.
export function elastic(c, zeta, hz, d) {
  if (c <= 0) return 0;
  if (c >= d) return 1;
  const w = 2 * Math.PI * hz;
  const s = zeta >= 1
    ? (x) => 1 - Math.exp(-w * x) * (1 + w * x)
    : (x) => { const wd = w * Math.sqrt(1 - zeta * zeta); return 1 - Math.exp(-zeta * w * x) * (Math.cos(wd * x) + ((zeta * w) / wd) * Math.sin(wd * x)); };
  return s(c) + (1 - s(d)) * smooth(c / d);
}
// Elastic in-out over u in [0, 1]: a damped wobble before it leaves and after it arrives, at full
// speed through the middle (both halves meet there with the same velocity). k: how fast the wobble
// dies, cycles: wobbles across each half.
export function inOutElastic(u, k = 6, cycles = 1.5) {
  const w = 2 * Math.PI * cycles, g1 = 1 - Math.exp(-k) * Math.cos(w);
  const g = (x) => (1 - Math.exp(-k * x) * Math.cos(w * x)) / g1;
  u = clamp(u);
  return u < 0.5 ? 0.5 * (1 - g(1 - 2 * u)) : 0.5 + 0.5 * g(2 * u - 1);
}
// The hover spin's profile: velocity ramps up and down along a smoothstep, a short cruise between.
export function scurve(u, a = 0.35, d = 0.5) {
  u = clamp(u);
  let s;
  if (u < a) { const x = u / a; s = a * (x * x * x - (x * x * x * x) / 2); }
  else if (u <= 1 - d) s = a / 2 + (u - a);
  else { const y = (u - 1 + d) / d; s = a / 2 + (1 - d - a) + d * (y - (y * y * y - (y * y * y * y) / 2)); }
  return s / (1 - a / 2 - d / 2);
}

function arcPath(k) {
  const [x0, y0] = polar(SLOTS[k] + G, R), [x1, y1] = polar(SLOTS[k] + 120 - G, R);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// The static mark, structured for orbit(): one group per electron, holding the arc behind it and
// the electron. Same proportions as /mark.svg.
export const MARK_SVG = `<svg class="ov-mark" viewBox="-351 -351 702 702" aria-hidden="true" focusable="false"><g class="ov-ring">${
  SLOTS.map((s, j) => `<g class="ov-p"><path d="${arcPath((j + 2) % 3)}" pathLength="${SPAN.toFixed(3)}" fill="none" stroke="${VIOLET}" stroke-width="${STROKE}" stroke-linecap="round"/><circle r="${DOT}" fill="${BLUE}" transform="rotate(${s + 90}) translate(0 -${R})"/></g>`).join('')
}<circle class="ov-core" r="${CORE}" fill="${BLUE}"/></g></svg>`;

// orbit(svg, opts): drives a MARK_SVG.
//   draw(t)    the intro at t; the exact logo from END on.
//   spin(u)    the hover spin, one turn at u in [0, 1], ending on the logo.
//   reset()    back to the static markup.
// The intro: the core is the anchor, there from the start. Each electron starts at a random place
// just outside the ring (the same seed, the same places) and comes in on a polar path: its angle
// and its radius both follow the elastic ease, so the overshoot runs along the ring. Once they have
// settled, the arcs form between them, growing from their middles to their round caps.
// Options: seed, zeta and hz (the elastic), sweep (the most degrees an electron travels round).
export function orbit(svg, o = {}) {
  const P = { seed: 1, zeta: 0.45, hz: 1.15, sweep: 95, ...o };
  const ring = svg.querySelector('.ov-ring'), core = svg.querySelector('.ov-core');
  const ps = [...svg.querySelectorAll('.ov-p')], arcs = ps.map((g) => g.firstChild), es = ps.map((g) => g.lastChild);
  const statics = es.map((e) => e.getAttribute('transform'));
  const r0 = rng(P.seed), D = 1.9;   // D: when an electron's elastic lands
  const come = SLOTS.map((s, j) => {
    const from = (r0() < 0.5 ? -1 : 1) * (25 + r0() * (P.sweep - 25));   // degrees round the ring
    return { j, delay: r0() * 0.22, from, r: R * (1.32 + r0() * 0.2) };
  });
  const ARCS = Math.max(...come.map((c) => c.delay)) + 0.7;
  const END = Math.max(ARCS + 1.2, ...come.map((c) => c.delay + D));
  const set = (e, k, v) => e.setAttribute(k, v);
  function draw(t) {
    if (t >= END) return reset();
    for (const c of come) {
      const e = elastic(t - c.delay, P.zeta, P.hz, D), th = SLOTS[c.j] + c.from * (1 - e), r = c.r + (R - c.r) * e;
      const [x, y] = polar(th, r);
      set(es[c.j], 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      set(es[c.j], 'opacity', smooth(clamp((t - c.delay) / 0.2)).toFixed(3));
    }
    // the arcs grow from their middles, critically damped, landing exactly at their caps
    const len = SPAN * elastic(t - ARCS, 1, 1.1, 1.2);
    for (const p of arcs) {
      set(p, 'stroke-dasharray', `${len.toFixed(3)} 400`);
      set(p, 'stroke-dashoffset', (-(SPAN - len) / 2).toFixed(3));
      set(p, 'opacity', clamp(len / 3).toFixed(3));
    }
    set(core, 'transform', `scale(${(0.88 + 0.12 * elastic(t, 1, 1.6, 0.9)).toFixed(4)})`);
    set(core, 'opacity', smooth(clamp(t / 0.3)).toFixed(3));
    set(ring, 'transform', '');
  }
  const spin = (u) => set(ring, 'transform', `rotate(${(360 * scurve(u)).toFixed(3)})`);
  function reset() {
    es.forEach((e, j) => { set(e, 'transform', statics[j]); e.removeAttribute('opacity'); });
    for (const e of [ring, core]) e.removeAttribute('transform');
    for (const e of [core, ...arcs]) for (const k of ['opacity', 'stroke-dasharray', 'stroke-dashoffset']) e.removeAttribute(k);
  }
  return { draw, spin, reset, END };
}

// header(img): the site header's mark (openvalence.github.io, tools/chrome.html). Swaps the static
// <img> for a MARK_SVG of the same size, plays the intro once when html.intro is set (the head script
// sets it on the home page's first load in a session; style.css hides the img meanwhile), from fresh
// random places each time, then spins once per hover or keyboard focus. Site only.
export function header(img) {
  const html = document.documentElement, brand = img.closest('a') || img.parentElement;
  img.insertAdjacentHTML('afterend', MARK_SVG);
  const svg = img.nextElementSibling, o = orbit(svg, { seed: (Math.random() * 2 ** 31) | 0 });
  svg.setAttribute('width', img.width);
  svg.setAttribute('height', img.height);
  let busy = false;
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
  const step = () => go(1.4, (t) => o.spin(t / 1.4));
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
// draws one frame, calm: the exact logo. The loop is `period` s long (one turn).
// The mark spins at constant speed. Each electron jumps out and back, each way on the in-out elastic
// ease; on the way down it leaves a glow wherever it passes, fading as exp(-age / tau). The jumps
// take turns, a third of `every` apart, ordered so the picture repeats every third of a turn.
// Options: turn (s per turn), every (s between one electron's jumps; divides turn), up and down (s
// each way), lift (the jump, share of R), k and cycles (the elastic), tau (s).
export function phosphor(host, o = {}) {
  const P = { turn: 9.6, every: 2.4, up: 0.55, down: 0.75, lift: 0.3, k: 6, cycles: 1.5, tau: 0.42, ...o };
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  const probe = host.appendChild(document.createElement('span'));
  probe.style.display = 'none';
  let ring, core, light, Lk, k = 1, w = 0, h = 0, sprite = {}, raf = 0, t0 = 0, lastT = 0, still = false;

  const JUMP = P.up + P.down;
  const mod = (t, m) => ((t % m) + m) % m;
  // electron j at time t: how far out (0..1), and whether it is on its way down
  function jump(j, t) {
    const a = mod(t + (j * P.every) / 3, P.every);   // + : after a third of a turn, electron j is where j + 1 was, in j + 1's phase
    if (a >= JUMP) return { out: 0, down: false };
    return a < P.up ? { out: inOutElastic(a / P.up, P.k, P.cycles), down: false } : { out: 1 - inOutElastic((a - P.up) / P.down, P.k, P.cycles), down: true };
  }
  const at = (j, t) => polar(SLOTS[j] + (360 * t) / P.turn, R * (1 + P.lift * jump(j, t).out));

  function refresh() {
    const cs = getComputedStyle(host);
    ring = rgbOf(probe, cs.getPropertyValue('--mark-ring').trim(), VIOLET);
    core = rgbOf(probe, cs.getPropertyValue('--mark-core').trim(), BLUE);
    const bg = rgbOf(probe, cs.getPropertyValue('--mark-bg').trim(), '#08090B');
    light = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] > 140;
    Lk = light ? { wake: 0.05, bloom: 0 } : { wake: 0.1, bloom: 0.22 };
    sprite = {};
    if (w) draw(lastT, still);
  }
  // a soft disc (solid out to `solid` of r) or a Gaussian bloom (solid 0), rendered once per size
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
    k = Math.min(w, h) / (2 * (R * (1 + P.lift * 1.1) + DOT * 1.6));   // the highest jump and its glow stay inside
    sprite = {};
    draw(lastT, still);
  }
  function draw(t, calm = false) {
    lastT = t;
    if (!w) return;
    const turn = calm ? 0 : (360 * t) / P.turn;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(k, 0, 0, k, w / 2, h / 2);
    // the wake: where each electron passed on its way down, as bright as it was fresh, decayed since
    if (!calm) {
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
      const disc = spr('d', core, DOT * 1.1, 0.6), dt = 1 / 90;
      for (let j = 0; j < 3; j++) for (let i = 1; i * dt < P.tau * 4; i++) {
        const age = i * dt;
        if (!jump(j, t - age).down) continue;
        const [x, y] = at(j, t - age);
        put(disc, x, y, DOT * 1.1, Lk.wake * Math.exp(-age / P.tau));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineWidth = STROKE;
    ctx.strokeStyle = rgba(ring, 1);
    ctx.beginPath();
    for (let a = 0; a < 3; a++) { const s0 = (SLOTS[a] + G + turn) * RAD; ctx.moveTo(R * Math.cos(s0), R * Math.sin(s0)); ctx.arc(0, 0, R, s0, s0 + SPAN * RAD); }
    ctx.stroke();
    ctx.fillStyle = rgba(core, 1);
    for (let j = 0; j < 3; j++) {
      const [x, y] = calm ? polar(SLOTS[j], R) : at(j, t);
      if (!calm && Lk.bloom) { ctx.globalCompositeOperation = 'lighter'; put(spr('g', core, DOT * 2.6, 0), x, y, DOT * 2.6, Lk.bloom); ctx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, DOT, 0, 2 * Math.PI);
      ctx.fill();
    }
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
    draw, play, stop, refresh, canvas: cv, period: P.turn,
    destroy() { stop(); ro.disconnect(); cv.remove(); probe.remove(); },
  };
}
