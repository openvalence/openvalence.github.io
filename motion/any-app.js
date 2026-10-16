const DUR = 12, OFFSET = 4;   // frame 0 is the poster: start where the picture is whole
const ROWS = [['speed', '%', '0 to 100'], ['depth', '%', '0 to 100'], ['stroke', '%', '0 to 100'], ['jog_speed', 'mm/s', '1 to 2000']];
const MC = { x: 40, y: 136, w: 340, h: 300 };                 // the machine card
const DK = { x: 430, y: 136, w: 560, h: 350 };                // desktop face, 1280x800 scaled
const PH = { x: 1036, y: 136, w: 204, h: 420 };               // phone
const RM = { x: 560, y: 556, w: 300, h: 150 };                // remote
const ROWY = (i) => MC.y + 128 + i * 40;
const SL = { x: DK.x + 234 * DK.w / 1280, y: DK.y + 625 * DK.h / 800, w: 1000 * DK.w / 1280 };   // the Dash's Pattern speed slider
const FLY = [ // chip flights: from, to, start time
  { to: () => [DK.x + 30, DK.y + 30], a: 1.3 },
  { to: () => [PH.x + 20, PH.y + 60], a: 1.5 },
  { to: () => [RM.x + 20, RM.y + 20], a: 1.7 },
];
let g = {};

const txt = (p, x, y, s, cls, size, fill, anchor = 'start') => { const e = el('text', { x, y, class: cls, 'font-size': size, fill, 'text-anchor': anchor }, p); e.textContent = s; return e; };
function chip(p, label) {
  const e = el('g', { opacity: 0 }, p);
  el('rect', { x: -4, y: -15, width: label.length * 8.6 + 22, height: 28, rx: 14, fill: C.accent }, e);
  txt(e, 7, 4, label, 'mono', 14, '#fff');
  return e;
}
const bez = (a, b, u, lift = 60) => { const cx = (a[0] + b[0]) / 2, cy = Math.min(a[1], b[1]) - lift; const v = 1 - u; return [v * v * a[0] + 2 * v * u * cx + u * u * b[0], v * v * a[1] + 2 * v * u * cy + u * u * b[1]]; };

function setup() {
  const s = document.getElementById("scene");
  el('rect', { width: 1280, height: 720, fill: C.bg }, s);
  // the machine and its catalog
  el('rect', { x: MC.x, y: MC.y, width: MC.w, height: MC.h, rx: 12, fill: C.bg2, stroke: C.line3, 'stroke-width': 1.5 }, s);
  txt(s, MC.x + 24, MC.y + 44, 'The machine', 'kick', 24, C.ink);
  txt(s, MC.x + 24, MC.y + 72, 'Nucleus · its catalog', 'mono', 15, C.ink3);
  el('line', { x1: MC.x + 24, x2: MC.x + MC.w - 24, y1: MC.y + 92, y2: MC.y + 92, stroke: C.rule, 'stroke-width': 1.5 }, s);
  g.rows = ROWS.map((r, i) => {
    const e = el('g', { opacity: 0 }, s);
    txt(e, MC.x + 24, ROWY(i), r[0], 'mono', 17, C.ink);
    txt(e, MC.x + 150, ROWY(i), r[1], 'mono', 17, C.ink3);
    txt(e, MC.x + MC.w - 24, ROWY(i), r[2], 'mono', 17, C.ink3, 'end');
    return e;
  });
  g.rowFlash = el('rect', { x: MC.x + 12, y: ROWY(0) - 24, width: MC.w - 24, height: 34, rx: 6, fill: C.accent, opacity: 0 }, s);
  s.insertBefore(g.rowFlash, g.rows[0]);
  // the punch lines
  g.lines = [['Same entry.', 'Three controls.'], ['One state.', 'Every app in sync.']].map(([a, b]) => {
    const e = el('g', { opacity: 0 }, s);
    txt(e, MC.x, 548, a, 'disp', 40, C.ink); txt(e, MC.x, 596, b, 'disp', 40, C.ink);
    return e;
  });
  // desktop: Phosphor, as on the site
  g.dk = el('g', { opacity: 0 }, s);
  const cp = el('clipPath', { id: 'dkc' }, el('defs', {}, s));
  el('rect', { x: DK.x, y: DK.y, width: DK.w, height: DK.h, rx: 10 }, cp);
  const img = el('image', { href: `${ASSETS}dash-${THEME}.webp`, x: DK.x, y: DK.y, width: DK.w, height: DK.h, 'clip-path': 'url(#dkc)' }, g.dk);
  el('rect', { x: DK.x, y: DK.y, width: DK.w, height: DK.h, rx: 10, fill: 'none', stroke: C.line3, 'stroke-width': 1.5 }, g.dk);
  g.ring = el('rect', { x: SL.x - 10, y: SL.y - 22, width: SL.w + 20, height: 44, rx: 8, fill: 'none', stroke: C.accent, 'stroke-width': 4, opacity: 0 }, s);
  g.tagDk = tag(s, DK.x + 14, DK.y + DK.h + 30, 'Desktop', 'a slider');
  // phone: its own drawing of the same entries
  g.ph = el('g', { opacity: 0 }, s);
  el('rect', { x: PH.x, y: PH.y, width: PH.w, height: PH.h, rx: 30, fill: C.bg2, stroke: C.line3, 'stroke-width': 2 }, g.ph);
  el('rect', { x: PH.x + PH.w / 2 - 28, y: PH.y + 14, width: 56, height: 14, rx: 7, fill: C.bg }, g.ph);
  txt(g.ph, PH.x + 20, PH.y + 66, 'Pattern', 'kick', 15, C.ink3);
  txt(g.ph, PH.x + 20, PH.y + 100, 'speed', 'mono', 15, C.ink2);
  g.phVal = txt(g.ph, PH.x + PH.w / 2, PH.y + 168, '55', 'disp', 48, C.ink, 'middle');
  txt(g.ph, PH.x + PH.w / 2 + 42, PH.y + 166, '%', 'mono', 14, C.ink3);
  for (const [dx, sym] of [[-78, '−'], [78, '+']]) {
    el('circle', { cx: PH.x + PH.w / 2 + dx, cy: PH.y + 148, r: 18, fill: 'none', stroke: C.line3, 'stroke-width': 2 }, g.ph);
    txt(g.ph, PH.x + PH.w / 2 + dx, PH.y + 155, sym, 'mono', 20, C.ink, 'middle');
  }
  g.phFlash = el('rect', { x: PH.x + 14, y: PH.y + 112, width: PH.w - 28, height: 72, rx: 10, fill: 'none', stroke: C.accent, 'stroke-width': 3, opacity: 0 }, s);
  [['depth', 0.4], ['stroke', 0.75]].forEach(([n, v], i) => {
    const y = PH.y + 236 + i * 70;
    txt(g.ph, PH.x + 20, y, n, 'mono', 15, C.ink2);
    txt(g.ph, PH.x + PH.w - 20, y, Math.round(v * 100) + ' %', 'mono', 15, C.ink, 'end');
    el('rect', { x: PH.x + 20, y: y + 16, width: PH.w - 40, height: 6, rx: 3, fill: C.bg3 }, g.ph);
    el('rect', { x: PH.x + 20, y: y + 16, width: (PH.w - 40) * v, height: 6, rx: 3, fill: C.accentInk }, g.ph);
    el('circle', { cx: PH.x + 20 + (PH.w - 40) * v, cy: y + 19, r: 9, fill: C.ink }, g.ph);
  });
  g.tagPh = tag(s, PH.x + 6, PH.y + PH.h + 32, 'Phone', 'a stepper');
  // remote: a knob and a stop button
  g.rm = el('g', { opacity: 0 }, s);
  el('rect', { x: RM.x, y: RM.y, width: RM.w, height: RM.h, rx: 28, fill: C.bg2, stroke: C.line3, 'stroke-width': 2 }, g.rm);
  const kx = RM.x + 90, ky = RM.y + 70;
  el('circle', { cx: kx, cy: ky, r: 46, fill: C.bg3, stroke: C.line3, 'stroke-width': 2 }, g.rm);
  g.arc = el('path', { fill: 'none', stroke: C.accentInk, 'stroke-width': 6, 'stroke-linecap': 'round' }, g.rm);
  g.knob = el('line', { x1: kx, y1: ky - 20, x2: kx, y2: ky - 40, stroke: C.ink, 'stroke-width': 5, 'stroke-linecap': 'round' }, g.rm);
  g.rmVal = txt(g.rm, kx, ky + 7, '55', 'mono', 20, C.ink, 'middle');
  txt(g.rm, kx, RM.y + RM.h - 12, 'speed', 'mono', 14, C.ink3, 'middle');
  el('circle', { cx: RM.x + 222, cy: ky, r: 40, fill: C.ink }, g.rm);
  txt(g.rm, RM.x + 222, ky + 7, 'STOP', 'kick', 18, C.bg, 'middle');
  g.tagRm = tag(s, RM.x + RM.w + 24, RM.y + 64, 'Remote', 'a knob');
  // the chips
  g.out = FLY.map(() => chip(s, 'catalog'));
  g.up = chip(s, 'speed 70');
  g.down = [chip(s, 'speed 70'), chip(s, 'speed 70')];
  // the band
  el('rect', { width: 1280, height: 104, fill: C.accent }, s);
  txt(s, 48, 76, 'One machine. Any app.', 'disp', 58, '#fff');
  txt(s, 1232, 70, 'Valence', 'kick', 16, '#fff', 'end').setAttribute('opacity', 0.85);
  const pre = new Image(); pre.src = img.getAttribute('href');
  return pre.decode();   // capture waits for the screenshot
}
function tag(p, x, y, name, what) {
  const e = el('g', { opacity: 0 }, p);
  txt(e, x, y, name, 'kick', 20, C.ink);
  txt(e, x, y + 22, 'draws ' + what, 'mono', 14, C.ink3);
  return e;
}

const knobAngle = (v) => -135 + (v / 100) * 270;
function drawKnob(v) {
  const kx = RM.x + 90, ky = RM.y + 70, a = knobAngle(v) * Math.PI / 180;
  g.knob.setAttribute('transform', `rotate(${knobAngle(v)} ${kx} ${ky})`);
  const a0 = -135 * Math.PI / 180, r = 58;
  const P = (q) => [kx + r * Math.sin(q), ky - r * Math.cos(q)];
  const [x0, y0] = P(a0), [x1, y1] = P(a);
  g.arc.setAttribute('d', `M${x0} ${y0}A${r} ${r} 0 ${a - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`);
  g.rmVal.textContent = Math.round(v);
}
function fly(e, a, b, u, lift) {
  const on = u > 0 && u < 1, [x, y] = bez(a, b, ease(clamp(u)), lift);
  e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  e.setAttribute('opacity', on ? 1 : 0);
}

function draw(t) {
  const fade = 1 - ramp(t, 10.9, 11.5);
  ROWS.forEach((_, i) => g.rows[i].setAttribute('opacity', ramp(t, 0.3 + i * 0.18, 0.55 + i * 0.18) * fade));
  // the catalog goes out to every app
  FLY.forEach((f, i) => fly(g.out[i], [MC.x + MC.w - 20, MC.y + 110], f.to(), (t - f.a) / 0.9, 80));
  const built = (a) => ramp(t, a, a + 0.5) * fade;
  g.dk.setAttribute('opacity', built(2.2));
  g.ph.setAttribute('opacity', built(2.4));
  g.rm.setAttribute('opacity', built(2.6));
  g.tagDk.setAttribute('opacity', built(3.0)); g.tagPh.setAttribute('opacity', built(3.15)); g.tagRm.setAttribute('opacity', built(3.3));
  g.lines[0].setAttribute('opacity', ramp(t, 3.4, 3.8) * (1 - ramp(t, 5.6, 5.9)));
  g.lines[1].setAttribute('opacity', ramp(t, 6.0, 6.4) * fade);
  // one change on the remote, echoed by the machine to every app
  const v = 55 + 15 * ease(ramp(t, 6.0, 6.8));
  drawKnob(t < 10.9 ? v : 55);
  fly(g.up, [RM.x + 60, RM.y - 6], [MC.x + MC.w - 120, ROWY(0) - 4], (t - 6.8) / 0.7, 40);
  g.rowFlash.setAttribute('opacity', 0.35 * (ramp(t, 7.45, 7.6) - ramp(t, 8.2, 8.6)));
  fly(g.down[0], [MC.x + MC.w - 20, ROWY(0) - 4], [SL.x + 20, SL.y - 30], (t - 7.6) / 0.7, 80);
  fly(g.down[1], [MC.x + MC.w - 20, ROWY(0) - 4], [PH.x + 16, PH.y + 120], (t - 7.6) / 0.8, 120);
  const hit = (a) => ramp(t, a, a + 0.12) * (1 - ramp(t, a + 0.6, a + 1.1));
  g.ring.setAttribute('opacity', Math.max(hit(8.3), ramp(t, 3.0, 3.3) * (1 - ramp(t, 4.6, 5.0))));
  g.phFlash.setAttribute('opacity', hit(8.4));
  g.phVal.textContent = t >= 8.4 && t < 10.9 ? '70' : '55';
}

run(setup, (t) => draw((t + OFFSET) % DUR), DUR);
