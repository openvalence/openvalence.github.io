// Renders every page's 1200x630 link-preview card to images/og/<page>.png from tools/og.html; chrome.py
// then points the page's og:image and twitter:image at it. Run from the repo root after adding a page or
// changing a title, a description or a figure a card borrows:
//     node tools/og.mjs [path-substring]
// Constraints: <page> is chrome.py's card name for the page (the canonical path's segments joined by
// "-", "home" for /, the file name without a canonical link), so the two scripts must agree. A page with
// no CARDS entry still gets a card: its h1, its description's first sentence and its first figure or
// image, else its headings. Needs Playwright with Chromium: an installed "playwright" package, or the
// sibling Phosphor checkout's.
import { readFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright').catch(() =>
  import(pathToFileURL(join(root, '../Phosphor/node_modules/playwright/index.mjs')).href));

const COMPONENTS = { section: 'Components' };
const docs = (img, subject) => ({ section: 'Phosphor docs', subject, visual: { img: `/phosphor/docs/img/${img}`, pos: 'left top' } });
// Per-page overrides: title, subject, section (the band's label) and visual (see og.html render()).
const CARDS = {
  '/': { title: 'OpenValence', section: 'Open source', subject: 'Open-source hardware and software for linear motion machines.', visual: { img: '/images/phosphor/hero-poster.webp', pos: 'left top' } },
  '/components/': { ...COMPONENTS, subject: 'A protocol, its firmware, a planner, an app and a board.', visual: { list: [
    ['Valence', 'The protocol'], ['Nucleus', 'Firmware for the OSSM Flagship PCB'], ['Neutrino', 'The hub firmware, emulated inside Phosphor'],
    ['Kinetic', 'The motion planner'], ['Phosphor', 'The Valence client']] } },
  '/demos/': { subject: 'The Kinetic planner, funscript shaping and Phosphor driving Neutrino, in the browser.' },
  '/diagrams/': { subject: 'The system from app to motor, the path of a funscript action and the access tiers.', visual: { svg: 0, crop: true } },
  '/downloads/': { title: 'Downloads', subject: 'Phosphor pre-release builds, straight from CI.', visual: { list: [
    ['Windows', 'MSIX package, installer, portable zip'], ['macOS', 'Disk image, Apple silicon'], ['Linux', 'AppImage, .deb'], ['Neutrino', 'Built in: try the app with no machine']] } },
  '/flash/': { section: 'Guides', title: 'Web flasher', subject: 'Write firmware to an OpenValence board over USB from Chrome or Edge.', visual: { rows: [
    ['0x2000', 'Bootloader'], ['0x8000', 'Partition table'], ['0xF000', 'otadata'], ['0x20000', 'App, slot ota_0'], ['0x9000', 'NVS: Pre-program Wi-Fi']] } },
  '/guides/': { subject: 'Builds and mods you do with your own hands: parts, steps, pinouts and checks.', visual: { list: [
    ['Barnacle mod', 'A Stamp-P4 on the OSSM R+D board'], ['Motor setup', 'A/B quadrature input over RS485'], ['Web flasher', 'Firmware over USB']] } },
  '/guides/barnacle/': { subject: 'A Stamp-P4 on the OSSM R+D board, driving the motor on A/B quadrature.' },
  '/guides/servo-setup/': { title: 'Motor setup', subject: 'Set an AIM-series motor to A/B quadrature input over RS485, from the browser.', visual: { rows: [
    ['0x19 = 2', 'A/B quadrature input'], ['0x0A/0x0B', 'Gear 4/1: 8192 counts per turn'], ['0x00 = 0', 'Modbus control off'], ['0x01 ≠ 0', 'Output on'], ['0x14 = 1', 'Save']] } },
  '/hardware/': { ...COMPONENTS, subject: 'A 75 x 75 mm controller board: ESP32-P4 plus ESP32-C6, 36 V in.', visual: { img: '/images/hardware/pcb-angle-1000.webp' } },
  '/isotope/': { ...COMPONENTS, title: 'Isotope', subject: 'Planned firmware for small ESP32 accessories that join a Valence hub over ESP-NOW.' },
  '/kinetic/': { ...COMPONENTS, subject: 'Knots in, a jerk-limited trajectory out, bit-identical on every IEEE-754 target.', visual: { svg: 0 } },
  '/neutrino/': { ...COMPONENTS, subject: 'The Nucleus hub firmware compiled to WebAssembly and built into Phosphor.', visual: { img: '/images/phosphor-virtual.jpg', pos: 'left top' } },
  '/nucleus/': { ...COMPONENTS, subject: 'Firmware for the OSSM Flagship: the Valence hub and the motion planner on an ESP32-P4.', visual: { rows: [
    ['128 ms', 'Plan strip, one position per 1 ms tick'], ['4 ms', 'Lease: the LP core parks without a renewal'], ['128 ns', 'Edge spread, on a 125 ns grid'], ['900 ms', 'Wi-Fi buffer ahead of the motion']] } },
  '/valence/': { subject: 'The machine serves its own control panel, any app can open it, and the machine enforces its own limits.', visual: { from: '/diagrams/', svg: 2 } },
  '/phosphor/': { title: 'Phosphor', subject: 'The reference client for Valence machines.', visual: { img: '/images/phosphor/dash-dark.webp', pos: 'left top' } },
  '/phosphor/docs/': { section: 'Phosphor docs', subject: 'Guides for Phosphor, the Valence client.', visual: { img: '/images/phosphor/builder-dark.webp', pos: 'left top' } },
  '/phosphor/docs/connecting/': docs('conn-pairing-dark.webp', 'Discovery, Bluetooth setup, the access tiers and the Pair button.'),
  '/phosphor/docs/funscript-player/': docs('fs-player-dark.webp', 'Load a video and a script, set scale and offset, and play it on the machine.'),
  '/phosphor/docs/getting-started/': docs('gs-dash-dark.webp', 'Install Phosphor, try Neutrino with no hardware, then find a real machine.'),
  '/phosphor/docs/node-editor/': docs('ne-graph-dark.webp', 'Wire machine settings and toys through math, logic and smoothing nodes.'),
  '/phosphor/docs/plugins/': docs('pl-pane-dark.webp', 'What plugins can do, the five that ship with the app, and how permissions work.'),
  '/phosphor/docs/troubleshooting/': docs('ts-health-dark.webp', 'What the status and health lines mean and what to do about them.'),
  '/privacy.html': { subject: 'What Phosphor, the Nucleus firmware and this website do with your data.' },
  '404': { title: 'Not found', section: '404', subject: 'This page does not exist on openvalence.org.', visual: { mark: true } },
};

const text = (h) => h.replace(/<span class="tag">.*?<\/span>|<a class="hl".*?<\/a>/gs, '').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&#x27;|&rsquo;|’/g, '’').replace(/\s+/g, ' ').trim();
const pages = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return ['tools', '.git', 'motion', 'node_modules'].includes(n) ? [] : pages(p);
  return n.endsWith('.html') && readFileSync(p, 'utf8').includes('<!-- chrome:head -->') ? [p] : [];
});
const info = (file) => {
  const html = readFileSync(file, 'utf8');
  const path = html.match(/<link rel="canonical" href="https:\/\/openvalence\.org(\/[^"]*)">/)?.[1];
  const main = html.match(/<main\b[\s\S]*?<\/main>/)?.[0] || '';
  return { file, html, main, path, name: (path ? path.split('/').filter(Boolean).join('-') || 'home' : file.split(sep).pop()).replace(/\.html$/, '') };
};
const all = pages(root).map(info);
const byPath = Object.fromEntries(all.filter((p) => p.path).map((p) => [p.path, p]));
const fileUrl = (src, page) => pathToFileURL(src.startsWith('/') ? join(root, src) : join(dirname(page.file), src)).href;
// each figure's svg with the class of the figure around it: style.css scopes some figures' classes by it
const figures = (main) => [...main.matchAll(/<svg viewBox[\s\S]*?<\/svg>/g)].map((m) => ({
  svg: m[0], cls: [...main.slice(0, m.index).matchAll(/<figure class="([^"]*)"/g)].pop()?.[1] || '' }));

function card(p) {
  const o = CARDS[p.path || p.name] || {};
  const desc = p.html.match(/<meta name="description" content="([^"]*)"/)?.[1] || '';
  const seg = (p.path || '/').split('/').filter(Boolean)[0] || '';
  let v = o.visual;
  if (!v || v.svg !== undefined) {
    const src = v?.from ? byPath[v.from] : p, figs = figures(src.main), img = p.main.match(/<img[^>]*\ssrc="([^"]+)"/)?.[1];
    if (figs.length && (v || !img)) v = { ...figs[v?.svg || 0], crop: v?.crop };
    else if (img) v = { img: fileUrl(img, p), pos: 'left top' };
    else v = { list: [...p.main.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/gs)].map((m) => [text(m[1]), '']) };
  } else if (v.img) v = { ...v, img: fileUrl(v.img, p) };
  return {
    title: o.title || text(p.main.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1] || p.name),
    subject: o.subject || text(desc).split(/(?<=\.)\s/)[0],
    section: o.section || (seg ? seg[0].toUpperCase() + seg.slice(1).replace(/\.html$/, '') : 'OpenValence'),
    url: 'openvalence.org' + (p.path || '/' + p.name),
    visual: v,
  };
}

const only = process.argv[2];
mkdirSync(join(root, 'images/og'), { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const p of all) {
  if (only && !p.file.includes(only)) continue;
  await tab.goto(pathToFileURL(join(root, 'tools/og.html')).href);
  await tab.evaluate((c) => render(c), card(p));
  const out = join(root, 'images/og', p.name + '.png');
  await tab.screenshot({ path: out });
  console.log(`${relative(root, out)}  ${(statSync(out).size / 1024).toFixed(0)} KB  ${relative(root, p.file)}`);
}
await browser.close();
