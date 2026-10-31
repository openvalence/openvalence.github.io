// Checks flash/image.js: synthetic cases always, real images when given. Run from the repo root:
//   node tools/flash_check.mjs [garnet=FILE] [shim=FILE] [p4app=FILE] [p4build=DIR]
// garnet: a Garnet *.factory.bin; shim: a barnacle-shim-*.bin; p4app: a nucleus-*-app.bin;
// p4build: a flagship_p4 .pio/build/<env> folder (bootloader.bin, partitions.bin, ota_data_initial.bin).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PRESETS, checkFile, customKind, parsePartitions, otaCrc, bootSlot, guessOffset, checkPlan, md5 } from '../flash/image.js';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const S3 = { name: 'ESP32-S3', imageChipId: 9, bootOffset: 0 };
const P4 = { name: 'ESP32-P4', imageChipId: 18, bootOffset: 0x2000 };
const C6 = { name: 'ESP32-C6', imageChipId: 13, bootOffset: 0 };
const E32 = { name: 'ESP32', imageChipId: 0, bootOffset: 0x1000 };
const slot = (p, id) => PRESETS[p].slots.find((s) => s.id === id);
const check = (d, p, id, chip, flash = 16 << 20) => { const s = slot(p, id); return checkFile(d, s.addr, s.kind, chip, flash, s.max, s.ptAt); };
let n = 0;
const ok = (v, msg) => { assert.equal(v, null, msg); n++; };
const no = (v, re, msg) => { assert.match(v || '', re, msg); n++; };

// otadata CRC: values from otatool.py's binascii.crc32(struct.pack('<I', seq), 0xFFFFFFFF)
assert.equal(otaCrc(1), 0x4743989a); assert.equal(otaCrc(2), 0x55f63774); assert.equal(otaCrc(7), 0x6228c746); n += 3;

// MD5 against node's
for (const len of [0, 1, 55, 56, 64, 1000, 70001]) {
  const d = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) & 0xff);
  assert.equal(md5(d), createHash('md5').update(d).digest('hex'), `md5 of ${len} bytes`); n++;
}

// a synthetic partition table: the flagship_p4 layout
function table(rows) {
  const d = new Uint8Array(0xc00).fill(0xff);
  rows.forEach(([type, sub, off, size, label], i) => {
    const o = i * 32, v = new DataView(d.buffer);
    d[o] = 0xaa; d[o + 1] = 0x50; d[o + 2] = type; d[o + 3] = sub;
    v.setUint32(o + 4, off, true); v.setUint32(o + 8, size, true);
    for (let k = 0; k < 16; k++) d[o + 12 + k] = k < label.length ? label.charCodeAt(k) : 0;
    v.setUint32(o + 28, 0, true);
  });
  return d;
}
const P4_ROWS = [[1, 2, 0x9000, 0x6000, 'nvs'], [1, 0, 0xf000, 0x2000, 'otadata'], [1, 1, 0x11000, 0x1000, 'phy_init'], [0, 0x10, 0x20000, 0x400000, 'ota_0'], [0, 0x11, 0x420000, 0x400000, 'ota_1']];
const parts = parsePartitions(table(P4_ROWS));
assert.deepEqual(parts.map((p) => [p.label, p.sub, p.offset]), [['nvs', 'nvs', 0x9000], ['otadata', 'ota', 0xf000], ['phy_init', 'phy', 0x11000], ['ota_0', 'ota_0', 0x20000], ['ota_1', 'ota_1', 0x420000]]); n++;

// otadata: blank, one entry, two entries, rollback states, a bad crc
function otadata(...entries) {
  const d = new Uint8Array(0x2000).fill(0xff), v = new DataView(d.buffer);
  entries.forEach((e, i) => { if (!e) return; const b = i * 0x1000; v.setUint32(b, e.seq, true); v.setUint32(b + 24, e.state, true); v.setUint32(b + 28, e.crc ?? otaCrc(e.seq), true); });
  return d;
}
assert.equal(bootSlot(otadata(), parts).slot, 'ota_0'); n++;
assert.equal(bootSlot(otadata({ seq: 1, state: 2 }), parts).slot, 'ota_0'); n++;
assert.equal(bootSlot(otadata({ seq: 1, state: 2 }, { seq: 2, state: 2 }), parts).slot, 'ota_1'); n++;
assert.equal(bootSlot(otadata({ seq: 3, state: 2 }, { seq: 2, state: 2 }), parts).slot, 'ota_0'); n++;   // (3 - 1) % 2
assert.equal(bootSlot(otadata({ seq: 1, state: 2 }, { seq: 2, state: 4 }), parts).slot, 'ota_0'); n++;   // ota_1 aborted: rolled back
assert.deepEqual(bootSlot(otadata({ seq: 1, state: 2 }, { seq: 2, state: 4 }), parts).notes, ['ota_1 aborted']); n++;
assert.match(bootSlot(otadata({ seq: 1, state: 2 }, { seq: 2, state: 1 }), parts).text, /rolls back/); n++;
assert.equal(bootSlot(otadata({ seq: 1, state: 2 }, { seq: 2, state: 2, crc: 0x1234 }), parts).slot, 'ota_0'); n++;   // bad crc ignored
const withFactory = parsePartitions(table([[1, 2, 0x9000, 0x6000, 'nvs'], [1, 0, 0xd000, 0x2000, 'otadata'], [0, 0, 0x10000, 0x100000, 'factory'], [0, 0x10, 0x110000, 0x100000, 'ota_0']]));
assert.equal(bootSlot(otadata(), withFactory).slot, 'factory'); n++;

// synthetic images: header magic, chip id, app descriptor
function img(chipId, app, len = 0x100) {
  const d = new Uint8Array(len).fill(0); d[0] = 0xe9; d[12] = chipId & 0xff; d[13] = chipId >> 8;
  if (app) new DataView(d.buffer).setUint32(0x20, 0xabcd5432, true);
  return d;
}
ok(check(img(18, true), 'p4', 'app', P4), 'P4 app');
no(check(img(9, true), 'p4', 'app', P4), /built for ESP32-S3; the board is ESP32-P4/);
no(check(img(18, false), 'p4', 'app', P4), /not an app image/);
ok(check(img(18, false), 'p4', 'boot', P4), 'P4 bootloader');
no(check(img(18, true), 'p4', 'boot', P4), /an app image where the bootloader goes/);
no(check(img(18, false, 0x7000), 'p4', 'boot', P4), /does not fit its 24 KB slot/);
no(check(new Uint8Array(0x100).fill(0xff), 'p4', 'app', P4), /no image header \(0xE9\) at 0x0/);
no(check(img(18, true, 0x401000), 'p4', 'app', P4), /does not fit/);
no(check(new Uint8Array(0x10), 'p4', 'pt', P4), /not a partition table/);
ok(check(table(P4_ROWS), 'p4', 'pt', P4), 'P4 table');
no(check(new Uint8Array(0x3000), 'p4', 'ota', P4), /does not fit its 8 KB slot/);
no(checkFile(img(18, true, 0x2000), 0xfff000, 'app', P4, 16 << 20), /past the 16 MB flash/);
// merged on a chip with the bootloader at 0x1000 (ESP32) and 0x2000 (P4): the header is not at 0
const merged = (chip, len) => { const d = new Uint8Array(len).fill(0xff); d.set(img(chip.imageChipId, false), chip.bootOffset); d[0x8000] = 0xaa; d[0x8001] = 0x50; return d; };
ok(check(merged(E32, 0x10000), 'shim', 'image', E32, 4 << 20), 'ESP32 merged');
no(check(merged(E32, 0x10000), 'shim', 'image', S3, 4 << 20), /no image header \(0xE9\) at 0x0/);
no(check(img(9, true, 0x10000), 'garnet', 'image', S3), /an app image where the bootloader goes \(0x0\)/);
no(check(img(9, false, 0x10000), 'garnet', 'image', S3), /no partition table at 0x8000/);
// the C6 keeps its bootloader at 0x0, never 0x1000
assert.equal(customKind(img(13, false), 0, C6), 'merged'); ok(checkFile(img(13, false), 0, 'merged', C6, 4 << 20), 'C6 bootloader at 0x0');
assert.equal(customKind(img(18, false), 0x2000, P4), 'boot'); assert.equal(customKind(table(P4_ROWS), 0x8000, P4), 'pt');
assert.equal(customKind(img(18, true), 0x20000, P4), 'app'); assert.equal(customKind(new Uint8Array(4), 0x300000, P4), 'raw'); n += 4;

// offsets from file names and the board's table
assert.equal(guessOffset('bootloader.bin', P4, parts), 0x2000);
assert.equal(guessOffset('partitions.bin', P4, parts), 0x8000);
assert.equal(guessOffset('ota_data_initial.bin', P4, parts), 0xf000);
assert.equal(guessOffset('firmware.bin', P4, parts), 0x20000);
assert.equal(guessOffset('firmware.factory.bin', P4, parts), 0);
assert.equal(guessOffset('firmware.bin', S3, []), null); n += 6;

// the plan: alignment, overlap, NVS
assert.match(checkPlan([], parts).error, /no files/);
assert.match(checkPlan([{ addr: 0x2100, data: new Uint8Array(4), name: 'a' }], parts).error, /4 KB sector/);
assert.match(checkPlan([{ addr: 0x2000, data: new Uint8Array(0x7000), name: 'a' }, { addr: 0x8000, data: new Uint8Array(4), name: 'b' }], parts).error, /a and b overlap at 0x8000/);
assert.deepEqual(checkPlan([{ addr: 0x0, data: new Uint8Array(0x20000), name: 'm' }], parts).notes, ['m overwrites nvs at 0x9000: stored settings are lost']);
assert.deepEqual(checkPlan(PRESETS.p4.slots.map((s) => ({ addr: s.addr, data: new Uint8Array(s.max), name: s.id })), parts), { notes: [] }); n += 5;   // full P4 slots stay clear of NVS

// real images
const read = (f) => new Uint8Array(readFileSync(f));
if (arg.garnet) { ok(check(read(arg.garnet), 'garnet', 'image', S3), 'Garnet factory image'); no(check(read(arg.garnet), 'garnet', 'image', P4), /no image header/); no(check(read(arg.garnet), 'garnet', 'image', { ...S3, imageChipId: 13, name: 'ESP32-C6' }), /built for ESP32-S3; the board is ESP32-C6/); }
if (arg.shim) { ok(check(read(arg.shim), 'shim', 'image', E32, 4 << 20), 'shim image'); no(check(read(arg.shim), 'p4', 'app', P4), /no image header/); }
if (arg.p4app) { ok(check(read(arg.p4app), 'p4', 'app', P4), 'P4 app'); no(check(read(arg.p4app), 'p4', 'boot', P4), /does not fit|an app image/); no(check(read(arg.p4app), 'garnet', 'image', S3), /built for ESP32-P4|an app image/); }
if (arg.p4build) {
  const b = (f) => read(`${arg.p4build}/${f}`);
  ok(check(b('bootloader.bin'), 'p4', 'boot', P4), 'P4 build bootloader');
  ok(check(b('partitions.bin'), 'p4', 'pt', P4), 'P4 build table');
  ok(check(b('ota_data_initial.bin'), 'p4', 'ota', P4), 'P4 build otadata');
  ok(check(b('firmware.bin'), 'p4', 'app', P4), 'P4 build app');
  const t = parsePartitions(b('partitions.bin'));
  const at = (l) => t.find((p) => p.label === l)?.offset;
  assert.deepEqual([at('nvs'), at('otadata'), at('ota_0'), at('ota_1')], [0x9000, 0xf000, 0x20000, 0x420000], 'the P4 preset matches the built table'); n++;
  for (const s of PRESETS.p4.slots.filter((s) => s.kind === 'app' || s.kind === 'otadata')) assert.equal(s.addr, s.kind === 'app' ? at('ota_0') : at('otadata')), n++;
  assert.equal(bootSlot(b('ota_data_initial.bin'), t).slot, 'ota_0'); n++;
}
console.log(`flash_check: ${n} checks passed${Object.keys(arg).length ? ' (real: ' + Object.keys(arg).join(', ') + ')' : ''}`);
