// common.js -- shared by the three pieces: the site's theme tokens (/style.css)
// and the HyperFrames frame-source hookup.
// Constraints:
// - Every draw is a pure function of t (seconds). No clocks, no randomness:
//   HyperFrames seeks frames in any order.
// - Outside HyperFrames (a plain browser tab) it loops on requestAnimationFrame
//   for previewing only; ?theme=light picks the theme there.
// - On the site, site.js sets window.motionHost before loading a piece: run() hands
//   it the piece, colors come from /style.css's tokens and the loop is site.js's.
const THEMES = {
  dark: { bg: '#0B0B0C', bg2: '#161618', bg3: '#1F1F22', ink: '#F3F3EF', ink2: '#BDBDB7', ink3: '#92928C',
    rule: '#2C2C30', line3: '#4A4A50', accent: '#2E4BFF', accentInk: '#92A3FF', info: '#B9A6FF', bad: '#FF4D5E' },
  light: { bg: '#F3F2EE', bg2: '#E8E7E1', bg3: '#DCDBD4', ink: '#0B0B0C', ink2: '#34343A', ink3: '#5B5B61',
    rule: '#CFCEC7', line3: '#A9A8A1', accent: '#2E4BFF', accentInk: '#2E4BFF', info: '#6A3FC8', bad: '#B8182A' },
};
const TOKENS = { bg: '--bg', bg2: '--bg-2', bg3: '--bg-3', ink: '--ink', ink2: '--ink-2', ink3: '--ink-3',
  rule: '--rule', line3: '--line-3', accent: '--accent', accentInk: '--accent-ink', info: '--info', bad: '--bad' };
const NS = 'http://www.w3.org/2000/svg';
const ASSETS = window.motionHost ? '/images/phosphor/' : 'assets/';
let C = THEMES.dark, THEME = 'dark', themed = false;

function applyTheme() {
  if (themed) return;
  themed = true;
  const v = (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};
  const name = v.theme || new URLSearchParams(location.search).get('theme') || 'dark';
  C = THEMES[name] || THEMES.dark;
  THEME = THEMES[name] ? name : 'dark';
  const r = document.documentElement.style;
  for (const [k, c] of Object.entries(C)) r.setProperty('--' + k, c);
  document.documentElement.dataset.theme = name;
}

// el('rect', {x: 1}, parent): an SVG element.
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
// u of t across [a, b], eased.
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const out = (u) => 1 - Math.pow(1 - u, 3);
const back = (u) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);

// steps (optional): the site's stepper stops, [{beat, at (clip s), note}].
function run(setup, draw, dur, steps) {
  const fonts = Promise.all([document.fonts.load('900 64px Archivo'), document.fonts.load('400 16px "Martian Mono"')]);
  if (window.motionHost) {
    // start(theme) builds the scene in #scene; site.js calls it again when the scheme changes
    const start = (theme) => fonts.then(() => {
      const cs = getComputedStyle(document.documentElement);
      THEME = theme; C = {};
      for (const k in TOKENS) C[k] = cs.getPropertyValue(TOKENS[k]).trim();
      return setup();
    });
    return window.motionHost({ start, draw, dur, steps });
  }
  const host = document.getElementById('scene');
  const ready = fonts
    .then(() => { applyTheme(); return setup(); })   // setup may return a promise (images decoding)
    .then(() => draw(0));
  if (window.__hyperframes && window.__hyperframes.registerFrameSource) {
    window.__hyperframes.registerFrameSource({ element: host, ready, render: (t) => draw(t) });
  } else {
    ready.then(() => {
      const t0 = performance.now();
      const f = (ms) => { draw(((ms - t0) / 1000) % dur); requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
  }
}
