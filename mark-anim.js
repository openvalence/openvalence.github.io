// mark-anim.js -- the OpenValence mark, animated two ways. Every picture is a pure function of
// t in seconds (draw(t)), so HyperFrames can seek any frame and a page loop is just draw(now).
//   orbit(svg)    the electrons spiral out of the center and orbit clockwise, each unspooling its
//                 arc behind it, settle into their gaps, and the core lands. Idle: a 120 degree
//                 index step on the same velocity profile. header(img) wires it into the site.
//   phosphor(el)  the system spins past a fixed excitation point. What passes it lights up:
//                 the arcs flare and fade, each electron is kicked outward and relaxes back in,
//                 and its light decays exponentially, leaving a persistence trail.
// Geometry: Valence/assets/icons/README.md (ring r 300, stroke 80, dot r 54, core r 136, 28 clear).
// Constraints: no clock or randomness inside draw(t). This file is the source;
// Phosphor's src/ui/mark-anim.js is a byte-identical copy (edit here, then copy).

const R = 300, STROKE = 80, DOT = 54, CORE = 136;
const G = 23.356;                                             // electron center to arc cap center, degrees (icon-app.svg)
const SPAN = 120 - 2 * G;                                     // one arc, degrees
const SLOTS = [-90, 30, 150];                                 // electron angles, clockwise from +x
const VIOLET = '#A78BFA', BLUE = '#4DA6FF';
const RAD = Math.PI / 180;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);
const polar = (deg, r) => [r * Math.cos(deg * RAD), r * Math.sin(deg * RAD)];

// The motion profile: velocity ramps up and down along a smoothstep (finite jerk, never a dead
// start or stop) with a constant-speed cruise between. a and d: the ramp shares of the move.
export function scurve(u, a = 0.3, d = 0.45) {
  u = clamp(u);
  let s;
  if (u < a) { const x = u / a; s = a * (x * x * x - (x * x * x * x) / 2); }
  else if (u <= 1 - d) s = a / 2 + (u - a);
  else { const y = (u - 1 + d) / d; s = a / 2 + (1 - d - a) + d * (y - (y * y * y - (y * y * y * y) / 2)); }
  return s / (1 - a / 2 - d / 2);
}

// A damped spring released at c = 0 from `from`, settling on 1.
function spring(c, from, zeta, hz) {
  if (c <= 0) return from;
  const w = 2 * Math.PI * hz, wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 + (from - 1) * Math.exp(-zeta * w * c) * (Math.cos(wd * c) + ((zeta * w) / wd) * Math.sin(wd * c));
}

function arcPath(k) {
  const [x0, y0] = polar(SLOTS[k] + G, R), [x1, y1] = polar(SLOTS[k] + 120 - G, R);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// The static mark, structured for orbit(): one group per electron, holding the electron and the
// arc behind it (clockwise). Same proportions as /mark.svg.
export const MARK_SVG = `<svg class="ov-mark" viewBox="-351 -351 702 702" aria-hidden="true" focusable="false"><g class="ov-ring">${
  SLOTS.map((s, j) => `<g class="ov-p"><path d="${arcPath((j + 2) % 3)}" pathLength="${SPAN.toFixed(3)}" fill="none" stroke="${VIOLET}" stroke-width="${STROKE}" stroke-linecap="round"/><circle r="${DOT}" fill="${BLUE}" transform="rotate(${s + 90}) translate(0 -${R})"/></g>`).join('')
}<circle class="ov-core" r="${CORE}" fill="${BLUE}"/></g></svg>`;

// orbit(svg, opts): drives a MARK_SVG. draw(t): the intro at t, the finished mark from END on.
// Each electron spirals out and orbits clockwise along the motion profile, unspooling its arc
// behind it: the arc's length grows with the distance run, so head and tail land together.
// index(u): the idle step, 120 degrees at u in [0, 1]; turn(deg): any rotation.
// Options (the chosen defaults):
//   travel  degrees each electron orbits     dur      the move, s
//   stagger s between electrons (0: the three-fold symmetry holds throughout the move)
//   r0      spiral start, share of the ring radius
//   core    s when the core starts landing   drop     the core's start scale
export function orbit(svg, o = {}) {
  const P = { travel: 240, dur: 1.5, stagger: 0, r0: 0.2, core: 1.05, drop: 1.45, ...o };
  const ring = svg.querySelector('.ov-ring'), core = svg.querySelector('.ov-core');
  const ps = [...svg.querySelectorAll('.ov-p')], arcs = ps.map((g) => g.firstChild), es = ps.map((g) => g.lastChild);
  const END = Math.max(P.dur + 2 * P.stagger, P.core + 0.8);
  const set = (e, k, v) => e.setAttribute(k, v);
  function draw(t) {
    for (let j = 0; j < 3; j++) {
      const u = clamp((t - j * P.stagger) / P.dur), p = scurve(u), sc = P.r0 + (1 - P.r0) * smooth(clamp(u / 0.6));
      set(ps[j], 'transform', `rotate(${(-P.travel * (1 - p)).toFixed(3)}) scale(${sc.toFixed(4)})`);
      set(es[j], 'opacity', smooth(clamp(u / 0.12)).toFixed(3));
      const len = SPAN * p;
      set(arcs[j], 'stroke-dasharray', `${len.toFixed(3)} 400`);
      set(arcs[j], 'stroke-dashoffset', (len - SPAN).toFixed(3));
      set(arcs[j], 'opacity', clamp(len / 3).toFixed(3));
    }
    const c = t - P.core;
    set(core, 'transform', `scale(${(c <= 0 ? 0 : spring(c, P.drop, 0.6, 2.2)).toFixed(4)})`);
    set(core, 'opacity', smooth(clamp(c / 0.08)).toFixed(3));
    set(ring, 'transform', '');
  }
  const turn = (deg) => set(ring, 'transform', `rotate(${deg.toFixed(3)})`);
  const index = (u) => turn(120 * scurve(u, 0.35, 0.5));
  // back to the static markup (the electrons keep their own placing transforms)
  function reset() {
    for (const e of [ring, core, ...ps]) e.removeAttribute('transform');
    for (const e of [core, ...es, ...arcs]) for (const k of ['opacity', 'stroke-dasharray', 'stroke-dashoffset']) e.removeAttribute(k);
  }
  return { draw, index, turn, reset, END };
}

// header(img): the site header's mark (openvalence.github.io, tools/chrome.html). Swaps the static
// <img> for a MARK_SVG of the same size, plays the intro once when html.intro is set (the head script
// sets it on the home page's first load in a session; style.css hides the img meanwhile), then turns
// one index step, 120 degrees, per hover or keyboard focus. Site only.
export function header(img) {
  const html = document.documentElement, brand = img.closest('a') || img.parentElement;
  img.insertAdjacentHTML('afterend', MARK_SVG);
  const svg = img.nextElementSibling, o = orbit(svg);
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
  const step = () => go(0.9, (t) => o.index(t / 0.9));
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

// One excitation, as a pulse in [0, 1]: a bi-exponential (rise tr, decay td), summed over every
// earlier period S so the loop has no seam. Normalized to the single pulse's peak.
function pulse(tau, tr, td, S) {
  const tp = (Math.log(td / tr) * tr * td) / (td - tr), peak = Math.exp(-tp / td) - Math.exp(-tp / tr);
  return (Math.exp(-tau / td) / (1 - Math.exp(-S / td)) - Math.exp(-tau / tr) / (1 - Math.exp(-S / tr))) / peak;
}

// phosphor(host, opts): a canvas filling host. Colors from host's CSS custom properties
// --mark-ring, --mark-core and --mark-bg (a light background means plain blending, a dark one
// additive light); refresh() re-reads them. play() / stop() run it on the page clock; draw(t, calm)
// draws one frame, calm: the resting mark, no excitation.
// One phosphor, one decay (tau): a lit point on the ring and an electron's trail both fade as
// exp(-age / tau). An electron's own excitation (its throw and its brightness) relaxes with relax.
// Options (the chosen defaults):
//   spin   s per turn                    beam   the excitation point, degrees (-90 is the top)
//   kick   outward throw, share of R     rise   excitation time constant, s
//   relax  the electron's relaxation, s  tau    phosphor decay, s
export function phosphor(host, o = {}) {
  const P = { spin: 3.6, beam: -60, kick: 0.46, rise: 0.08, relax: 0.42, tau: 0.45, ...o };
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  const probe = host.appendChild(document.createElement('span'));
  probe.style.display = 'none';
  let ring, core, light, L, k = 1, w = 0, h = 0, sprite = {}, grad = null, raf = 0, t0 = 0, lastT = 0, still = false;

  function refresh() {
    const cs = getComputedStyle(host);
    ring = rgbOf(probe, cs.getPropertyValue('--mark-ring').trim(), VIOLET);
    core = rgbOf(probe, cs.getPropertyValue('--mark-core').trim(), BLUE);
    const bg = rgbOf(probe, cs.getPropertyValue('--mark-bg').trim(), '#08090B');
    light = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] > 140;
    // light: no light to add, so excitation reads as saturation and a faint halo
    L = light
      ? { arc: 0.8, halo: 0.02, trail: 0.05, eRest: 1, eBloom: 0.05, coreBloom: 0, hot: 0 }
      : { arc: 0.6, halo: 0.11, trail: 0.12, eRest: 0.66, eBloom: 0.34, coreBloom: 0.1, hot: 0.6 };
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
    k = Math.min(w, h) / 1100;   // the throw and its bloom stay inside the box
    sprite = {}; grad = null;
    draw(lastT, still);
  }
  // time since a world angle phi (degrees) last passed the beam
  const since = (phi) => ((((phi - P.beam) % 360) + 360) % 360 / 360) * P.spin;
  // a ring point at phi: lit as it passed the beam, decaying since
  const lit = (phi) => pulse(since(phi), P.rise, P.tau, P.spin);
  // the arcs' stroke: that brightness as a gradient fixed in the world; the arcs turn through it
  function ringStroke() {
    if (!ctx.createConicGradient) return rgba(ring, L.arc);
    const g = ctx.createConicGradient(P.beam * RAD, 0, 0), n = 48;
    for (let i = 0; i <= n; i++) { const f = (i / n) ** 2; g.addColorStop(f, rgba(ring, L.arc + (1 - L.arc) * lit(P.beam + f * 360))); }
    return g;
  }
  function draw(t, calm = false) {
    lastT = t;
    if (!w) return;
    const f = calm ? 0 : 1, spin = (360 * t) / P.spin;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(k, 0, 0, k, w / 2, h / 2);
    ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
    // an electron at time tt: where it is and how excited (0..1)
    const at = (tt, j) => {
      const th = SLOTS[j] + (360 * tt) / P.spin, b = f * pulse(since(th), P.rise, P.relax, P.spin);
      const [x, y] = polar(th, R * (1 + P.kick * b));
      return { x, y, b };
    };
    const heads = [0, 1, 2].map((j) => at(t, j)), energy = heads.reduce((s, p) => s + p.b, 0);
    if (L.coreBloom) put(spr('gc', core, CORE * 2.4, 0), 0, 0, CORE * 2.4, f * L.coreBloom * (0.7 + 0.5 * energy));
    // the arcs' bloom: Gaussians along each arc, as bright as the ring there
    if (!calm) {
      const gb = spr('ga', ring, STROKE * 1.9, 0);
      for (let a = 0; a < 3; a++) for (let i = 0; i <= 10; i++) {
        const phi = SLOTS[a] + G + spin + (SPAN * i) / 10, [x, y] = polar(phi, R);
        put(gb, x, y, STROKE * 1.9, L.halo * (0.35 + 2.2 * lit(phi)));
      }
    }
    // persistence: every earlier position, as bright as the electron was then, decayed since
    if (!calm) {
      const dt = 1 / 60, disc = spr('d', core, DOT * 1.15, 0.7);   // 1/60 s apart, still overlapping at the throw's peak speed
      for (let i = 1; i * dt < P.tau * 3.5; i++) {
        const age = i * dt, fade = Math.exp(-age / P.tau);
        // the trail narrows as it fades: the dim edge of a decaying spot drops below sight first
        for (let j = 0; j < 3; j++) { const p = at(t - age, j); put(disc, p.x, p.y, DOT * 1.15 * (0.4 + 0.6 * fade), 2 * L.trail * fade * (0.08 + p.b)); }
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
    // the electrons: bloom, body, and a hot center while excited
    const gl = spr('g', core, DOT * 3.2, 0), hot = spr('w', [255, 255, 255], DOT * 0.75, 0);
    ctx.fillStyle = rgba(core, 1);
    for (const p of heads) {
      if (!calm) put(gl, p.x, p.y, DOT * 3.2, L.eBloom * (0.3 + p.b));
      ctx.globalAlpha = calm ? 1 : L.eRest + (1 - L.eRest) * p.b;
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT, 0, 2 * Math.PI);
      ctx.fill();
      put(hot, p.x, p.y, DOT * 0.75, L.hot * p.b);
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
    draw, play, stop, refresh, canvas: cv, period: P.spin / 3,
    destroy() { stop(); ro.disconnect(); cv.remove(); probe.remove(); },
  };
}
