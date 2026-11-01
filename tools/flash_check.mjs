// Checks flash/image.js and flash/nvs.js: synthetic cases always, real images when given. Run from
// the repo root:
//   node tools/flash_check.mjs [garnet=FILE] [shim=FILE] [p4app=FILE] [p4build=DIR] [index=FILE]
//                              [nvscsv=DIR] [nvsgen=DIR]
// garnet: a Garnet *.factory.bin; shim: a barnacle-shim-*.bin; p4app: a nucleus-*-app.bin;
// p4build: a flagship_p4 .pio/build/<env> folder (bootloader.bin, partitions.bin, ota_data_initial.bin);
// index: a flash/fw/index.json from tools/fw_index.py.
// nvscsv: writes the NVS fixture sets as CSVs; nvsgen: a folder of nvs_partition_gen.py outputs
// for them (<set>.bin, generate <set>.csv <set>.bin 0x6000), compared byte for byte.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PRESETS, releasesFor, checkFile, customKind, parsePartitions, otaCrc, crc32, bootSlot, guessOffset, checkPlan, md5 } from '../flash/image.js';
import { parse, build, T, withWifi, baseFor, netsEncode, netsDecode, netsSave, checkNet, NETS_BYTES } from '../flash/nvs.js';

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

// hosted releases: the preset's products only, newest version first (0.1.10 above 0.1.9), files
// without a slot in the preset dropped, releases left with none dropped
const rel = (product, version, ...roles) => ({ product, version, tag: `${product}-${version}`, prerelease: true, files: roles.map((r) => ({ name: `${r}.bin`, role: r, size: 1, sha256: '0'.repeat(64) })) });
const INDEX = { releases: [rel('nucleus-p4b', '0.1.9', 'app'), rel('barnacle-shim', '0.1.78', 'image'), rel('nucleus-p4b', '0.1.10', 'boot', 'pt', 'ota', 'app', 'image'), rel('nucleus-p4', '0.2.0', 'app'), rel('garnet', '0.1.1', 'boot')] };
assert.deepEqual(releasesFor(INDEX, 'p4').map((r) => r.tag), ['nucleus-p4-0.2.0', 'nucleus-p4b-0.1.10', 'nucleus-p4b-0.1.9']);
assert.deepEqual(releasesFor(INDEX, 'p4')[1].files.map((f) => f.role), ['boot', 'pt', 'ota', 'app']);
assert.deepEqual(releasesFor(INDEX, 'shim').map((r) => r.tag), ['barnacle-shim-0.1.78']);
assert.deepEqual(releasesFor(INDEX, 'garnet'), []);   // no 'boot' slot on the Garnet preset
assert.deepEqual(releasesFor(INDEX, 'custom'), []);
assert.deepEqual(releasesFor(null, 'p4'), []); n += 6;

// ---- flash/nvs.js: the Wi-Fi option ----
// Generator fixtures: each set is [namespace, key, encoding, value] rows. The hashes are of
// nvs_partition_gen.py 0.3.0's output for the same rows at 0x6000 (nvscsv= writes the CSVs,
// nvsgen= compares a folder of its .bin outputs byte for byte). Credentials are made up.
const enc = new TextEncoder();
const sha = (d) => createHash('sha256').update(d).digest('hex');
const INT = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8 };
function entriesOf(rows) {
  const namespaces = [], entries = [];
  for (const [ns, key, e, v] of rows) {
    if (!namespaces.includes(ns)) namespaces.push(ns);
    if (e === 'blob') entries.push({ ns, key, type: T.blob, data: v });
    else if (e === 'string') entries.push({ ns, key, type: T.str, data: Uint8Array.from([...enc.encode(v), 0]) });
    else {
      const d = new Uint8Array(8).fill(0xff);
      let x = BigInt.asUintN(8 * INT[e], BigInt(v));
      for (let i = 0; i < INT[e]; i++, x >>= 8n) d[i] = Number(x & 0xffn);
      entries.push({ ns, key, type: T[e], data: d });
    }
  }
  return { namespaces, entries };
}
const csvOf = (rows) => {
  let out = 'key,type,encoding,value\n', cur = null;
  for (const [ns, key, e, v] of rows) {
    if (ns !== cur) { out += `${ns},namespace,,\n`; cur = ns; }
    out += e === 'blob' ? `${key},data,hex2bin,${Buffer.from(v).toString('hex')}\n` : `${key},data,${e},${v}\n`;
  }
  return out;
};
const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
const rbytes = (r, n) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
const rword = (r, n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(r() * 36)]).join('');
const netsOf = (...pairs) => { const l = []; for (const [s, p] of pairs) netsSave(l, s, p); return netsEncode(l); };
const SETS = {
  'p4-one': [['valence', 'nets', 'blob', netsOf(['BenchNet', 'correct-horse-9'])]],
  'p4-max': [['valence', 'nets', 'blob', netsOf(['S'.repeat(31) + 'x', 'p'.repeat(62) + '!'])]],
  'p4-hex': [['valence', 'nets', 'blob', netsOf(['Shop Floor 5G', 'a1'.repeat(32)])]],
  'p4-open': [['valence', 'nets', 'blob', netsOf(['GuestOpen', ''])]],
  'garnet-hub': [['garnet', 'nets', 'blob', netsOf(['HomeLab', 'not-a-real-pass'])], ['garnet', 'hub_ip', 'blob', Uint8Array.from([192, 168, 1, 20])], ['garnet', 'hub_port', 'blob', Uint8Array.from([82, 0])]],
  'mixed': [
    ['valence', 'iid', 'blob', rbytes(lcg(1), 16)], ['valence', 'boots', 'u32', 4123456789], ['valence', 'trim', 'i16', -1234],
    ['valence', 'name', 'string', 'Flagship bench unit'], ['valence', 'ledger', 'blob', rbytes(lcg(2), 5000)],
    ['phy', 'cal', 'blob', rbytes(lcg(3), 1904)], ['phy', 'ver', 'u8', 7], ['phy', 'neg', 'i8', -3],
    ['garnet', 'big', 'blob', rbytes(lcg(4), 9000)], ['garnet', 'n64', 'i64', '-9000000000000000000'], ['garnet', 'u64', 'u64', '18446744073709551615'],
    ['garnet', 'msg', 'string', rword(lcg(5), 900)], ['garnet', 'w', 'u16', 65535], ['garnet', 'i32', 'i32', -2147483648],
  ],
};
// random sets walk the page-boundary rules: multi-page blobs, a blob index pushed to the next
// page, zero-length chunks, strings that would end on the last entry
for (let k = 0; k < 40; k++) {
  const r = lcg(100 + k), rows = [], nsN = 1 + Math.floor(r() * 4);
  let budget = 15000;
  for (let i = 0; budget > 0 && i < 200; i++) {
    const ns = `ns${Math.floor(r() * nsN)}`, key = `k${i}`, pick = r();
    if (pick < 0.35) { const len = Math.floor(r() * (r() < 0.2 ? 6000 : 400)); rows.push([ns, key, 'blob', rbytes(r, len)]); budget -= len + 64; }
    else if (pick < 0.6) { const len = Math.floor(r() * (r() < 0.2 ? 1500 : 120)); rows.push([ns, key, 'string', rword(r, len)]); budget -= len + 64; }
    else { const t = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64'][Math.floor(r() * 8)]; rows.push([ns, key, t, t.startsWith('u') ? Math.floor(r() * 200) : -Math.floor(r() * 100)]); budget -= 32; }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  SETS[`rand${k}`] = rows;
}
const GEN = {
  'p4-one': '70b038828d606b5f5b967db783e0cdde3fcd7e0f54209da75f5c7ea982177b9c',
  'p4-max': 'c4ddfaea82a5b9e85ae0d5d5e9b134d24ff11e0ac8559eab41f460d9326dc174',
  'p4-hex': '526edb9339d88b00080c5267b23c91b3721e806c26e33418fc2b2bb1262e1535',
  'p4-open': '97b4fefc84b7712bd997682f36f4ba136123fa49c4292bd2c5879010c73d75f0',
  'garnet-hub': '448881208441728c03564b27fa8098802f16155c82649d6b2edbd64e7f5e6da2',
  'mixed': 'c40ec4fa3a58becacd8a7160dfece89fdd008f5ae8f5c386cec5e2f5e4798c80',
};
const GEN_RAND = '65c75a40b97f7b83a499191a9fd84914f1a503730fe2596d5d59a4b537388b76';   // rand0..39 but rand1, which the generator refuses as too big
const GEN_FULL = ['rand1'];
if (arg.nvscsv) for (const [name, rows] of Object.entries(SETS)) writeFileSync(`${arg.nvscsv}/${name}.csv`, csvOf(rows));
const key = (e) => `${e.ns}|${e.key}|${e.type}|${e.data.join()}`;
const built = {};
let randAll = '';
for (const [name, rows] of Object.entries(SETS)) {
  const { namespaces, entries } = entriesOf(rows);
  if (GEN_FULL.includes(name)) { assert.throws(() => build(namespaces, entries, 0x6000), /NVS full/); n++; continue; }
  const img = build(namespaces, entries, 0x6000);
  built[name] = img;
  if (GEN[name]) { assert.equal(sha(img), GEN[name], `${name}: nvs_partition_gen.py bytes`); n++; } else randAll += sha(img) + '\n';
  if (arg.nvsgen) { assert.deepEqual(img, new Uint8Array(readFileSync(`${arg.nvsgen}/${name}.bin`)), `${name}: generator file`); n++; }
  // the image reads back as exactly its rows, and rebuilds to the same bytes
  const p = parse(img);
  assert.deepEqual([p.namespaces, p.entries.map(key), p.orphans], [namespaces, entries.map(key), 0], `${name}: parse`);
  assert.deepEqual(build(p.namespaces, p.entries, 0x6000), img, `${name}: rebuild`); n += 2;
}
assert.equal(sha(randAll), GEN_RAND, 'random sets: nvs_partition_gen.py bytes'); n++;

// a runtime-shaped image: erased entries, a blob at chunk start 0x80 (VER_1), an orphan chunk
const ent = (img, i, pg = 0) => img.subarray(pg * 4096 + 64 + 32 * i, pg * 4096 + 96 + 32 * i);
const reseal = (e) => { const c = crc32([...e.subarray(0, 4), ...e.subarray(8, 32)]); for (let k = 0; k < 4; k++) e[4 + k] = (c >>> (8 * k)) & 0xff; };
const state = (img, i, s, pg = 0) => { const o = pg * 4096 + 32 + (i >> 2), sh = (i & 3) * 2; img[o] = (img[o] & ~(3 << sh)) | (s << sh); };
const small = () => build(['a'], entriesOf([['a', 'x', 'u8', 1], ['a', 'y', 'u8', 2], ['a', 's', 'string', 'hello'], ['a', 'b', 'blob', rbytes(lcg(9), 40)], ['a', 'c', 'blob', rbytes(lcg(8), 40)]]).entries, 0x4000);
// entries: 0 ns a, 1 x, 2 y, 3-4 s, 5-7 b data, 8 b index, 9-11 c data, 12 c index
let rti = small();
assert.deepEqual(parse(rti).entries.map((e) => e.key), ['x', 'y', 's', 'b', 'c']); n++;
state(rti, 2, 0);
assert.deepEqual(parse(rti).entries.map((e) => e.key), ['x', 's', 'b', 'c']); n++;   // erased y skipped
ent(rti, 5)[3] = 0x80; reseal(ent(rti, 5)); ent(rti, 8)[29] = 0x80; reseal(ent(rti, 8));
state(rti, 12, 0); ent(rti, 9)[8] = 0x62; reseal(ent(rti, 9));   // c's index erased, its chunk renamed b, chunk 0
const rt = parse(rti);
assert.deepEqual([rt.entries.map((e) => e.key), rt.orphans, [...rt.entries[2].data]], [['x', 's', 'b'], 1, [...rbytes(lcg(9), 40)]]); n++;
const P4W = PRESETS.p4.wifi, GW = PRESETS.garnet.wifi;
assert.equal(withWifi(new Uint8Array(rti).subarray(0, 0x4000), { ...P4W, ns: 'a' }, 'BenchNet', 'correct-horse-9').entries, 4); n++;   // orphan dropped, entries kept
// refusals: each one names what it met and never a credential
const refuse = (mut, re) => { const d = small(); mut(d); assert.throws(() => parse(d), re); assert.throws(() => withWifi(d, { ...P4W, ns: 'a' }, 'BenchNet', 'correct-horse-9'), (e) => re.test(e.message) && !/BenchNet|correct-horse/.test(e.message)); n += 2; };
refuse((d) => { d[4] ^= 1; }, /header CRC/);
refuse((d) => { d[0] = 0xf8; }, /mid-cleanup/);
refuse((d) => { d[8] = 0xff; const c = crc32(d.subarray(4, 28)); for (let k = 0; k < 4; k++) d[28 + k] = (c >>> (8 * k)) & 0xff; }, /version 0xff/);
refuse((d) => { ent(d, 1)[1] = 0x41; reseal(ent(d, 1)); }, /unknown type 0x41/);
refuse((d) => { ent(d, 1)[9] = 0x7a; }, /CRC \(encrypted NVS\?\)/);
refuse((d) => { ent(d, 2)[8] = 0x78; reseal(ent(d, 2)); }, /twice/);
refuse((d) => { state(d, 4, 3); }, /half-written/);
refuse((d) => { ent(d, 4)[0] ^= 1; }, /data CRC/);
refuse((d) => { d[4096 + 100] = 0; }, /blank header over data/);
refuse((d) => { for (const i of [5, 6, 7]) state(d, i, 0); }, /blob incomplete/);   // b's chunk erased, span and all
refuse((d) => { state(d, 1, 1); }, /illegal state/);
assert.throws(() => build(['a'], [{ ns: 'a', key: 'big', type: T.blob, data: new Uint8Array(13000) }], 0x4000), /NVS full/); n++;

// the saved-network blob: SavedNetworks::encode's layout, decode's refusals, save's slot rule
const one = netsOf(['BenchNet', 'correct-horse-9']);
assert.equal(one.length, NETS_BYTES); assert.equal(NETS_BYTES, 396);
assert.deepEqual([...one.subarray(0, 6)], [0x56, 0x4e, 1, 1, 8, 15]);
assert.equal(Buffer.from(one.subarray(6, 14)).toString(), 'BenchNet'); assert.equal(Buffer.from(one.subarray(38, 53)).toString(), 'correct-horse-9');
assert.ok(one.subarray(53).every((b) => b === 0) && one.subarray(14, 38).every((b) => b === 0)); n += 6;
const four = [];
for (const [s, p] of [['A', ''], ['B', 'b'.repeat(8)], ['C', 'ab'.repeat(32)], ['D', 'd'.repeat(63)]]) netsSave(four, s, p);
assert.deepEqual(netsDecode(netsEncode(four)), four); n++;
const dec = (d) => netsDecode(d)?.map((e) => Buffer.from(e.ssid).toString());
assert.deepEqual(netsSave(four, 'B', 'new-pass-1'), { slot: 1, replaced: true }); assert.deepEqual(dec(netsEncode(four)), ['A', 'B', 'C', 'D']);
assert.deepEqual(netsSave(four, 'E', ''), { slot: 3, replaced: true }); assert.deepEqual(dec(netsEncode(four)), ['A', 'B', 'C', 'E']);
const two = []; netsSave(two, 'A', ''); assert.deepEqual(netsSave(two, 'B', ''), { slot: 1, replaced: false }); n += 5;
const bent = (f) => { const d = netsEncode(four); f(d); return netsDecode(d); };
assert.equal(bent((d) => { d[0] = 0x57; }), null); assert.equal(bent((d) => { d[2] = 2; }), null); assert.equal(bent((d) => { d[3] = 5; }), null);
assert.equal(bent((d) => { d[4] = 33; }), null); assert.equal(bent((d) => { d[4 + 98 + 1] = 7; }), null); assert.equal(bent((d) => { d[5] = 65; }), null);
assert.equal(netsDecode(one.subarray(0, 395)), null); n += 7;
assert.equal(checkNet('S'.repeat(32), ''), null); assert.match(checkNet('S'.repeat(33), ''), /SSID/); assert.equal(checkNet('é'.repeat(16), ''), null); assert.match(checkNet('é'.repeat(17), ''), /SSID/);
assert.match(checkNet('x', 'p'.repeat(7)), /8 to 63/); assert.equal(checkNet('x', 'p'.repeat(8)), null); assert.equal(checkNet('x', 'p'.repeat(63)), null);
assert.equal(checkNet('x', 'aB'.repeat(32)), null); assert.match(checkNet('x', 'g'.repeat(64)), /8 to 63/); assert.match(checkNet('x', 'pässword1'), /ASCII/); n += 10;

// the Wi-Fi edit: fresh images match the generator; a used NVS keeps every entry
const blank6 = new Uint8Array(0x6000).fill(0xff);
let w = withWifi(blank6, P4W, 'BenchNet', 'correct-horse-9');
assert.equal(sha(w.image), GEN['p4-one']); assert.deepEqual([w.fresh, w.slot, w.count], [true, 0, 1]);
assert.equal(sha(withWifi(blank6, GW, 'HomeLab', 'not-a-real-pass', { ip: [192, 168, 1, 20], port: 82 }).image), GEN['garnet-hub']); n += 3;
w = withWifi(built.mixed, P4W, 'BenchNet', 'correct-horse-9');
const back = parse(w.image), old = parse(built.mixed);
assert.deepEqual(back.entries.map(key).filter((k) => !k.startsWith('valence|nets|')), old.entries.map(key));
assert.deepEqual(dec(back.entries.find((e) => e.key === 'nets').data), ['BenchNet']); assert.equal(w.entries, old.entries.length + 1); n += 3;
w = withWifi(withWifi(built.mixed, P4W, 'Shop', 'shop-pass-1').image, P4W, 'BenchNet', 'correct-horse-9');
assert.deepEqual([w.slot, w.count, dec(parse(w.image).entries.find((e) => e.key === 'nets').data)], [1, 2, ['Shop', 'BenchNet']]);
w = withWifi(w.image, P4W, 'Shop', 'other-pass-2');
assert.deepEqual([w.slot, w.count, w.fresh], [0, 2, false]); n += 2;
// legacy keys the firmware would migrate: folded into slot 0, then dropped
const sta = new Uint8Array(101); sta.set([0x53, 0x54, 1, 6, 10]); sta.set(enc.encode('OldNet'), 5); sta.set(enc.encode('old-pass-9'), 37);
w = withWifi(build(['valence'], entriesOf([['valence', 'sta', 'blob', sta], ['valence', 'iid', 'u32', 7]]).entries, 0x6000), P4W, 'BenchNet', 'correct-horse-9');
assert.deepEqual([parse(w.image).entries.map((e) => e.key), dec(parse(w.image).entries[1].data)], [['iid', 'nets'], ['OldNet', 'BenchNet']]);
w = withWifi(build(['garnet'], entriesOf([['garnet', 'wifi_ssid', 'string', 'OldNet'], ['garnet', 'wifi_pass', 'string', 'old-pass-9'], ['garnet', 'link', 'blob', Uint8Array.of(1)]]).entries, 0x6000), GW, 'BenchNet', 'correct-horse-9');
assert.deepEqual([parse(w.image).entries.map((e) => e.key), dec(parse(w.image).entries[1].data)], [['link', 'nets'], ['OldNet', 'BenchNet']]);
const sta32 = new Uint8Array(101); sta32.set([0x53, 0x54, 1, 32, 0]); sta32.set(enc.encode('é'.repeat(16)), 5);   // a 32-byte UTF-8 SSID, open
w = withWifi(build(['valence'], entriesOf([['valence', 'sta', 'blob', sta32]]).entries, 0x6000), P4W, 'BenchNet', 'correct-horse-9');
assert.deepEqual(dec(parse(w.image).entries[0].data), ['é'.repeat(16), 'BenchNet']); n++;
w = withWifi(build(['garnet'], entriesOf([['garnet', 'nets', 'blob', new Uint8Array(10)]]).entries, 0x6000), GW, 'BenchNet', 'correct-horse-9');
assert.deepEqual([w.reset, w.count], [true, 1]); n += 3;
assert.throws(() => withWifi(blank6, P4W, 'BenchNet', 'short'), (e) => /8 to 63/.test(e.message) && !/short/.test(e.message)); n++;
// where the base comes from: a full image's own NVS region, else the board's
const full = merged(S3, 0x20000);
full.set(table([[1, 2, 0x9000, 0x6000, 'nvs'], [1, 1, 0xf000, 0x1000, 'phy_init'], [0, 0, 0x10000, 0x600000, 'factory']]), 0x8000);   // Garnet partitions.csv
assert.equal(baseFor([{ addr: 0, data: full, name: 'm' }], GW, null).from, 'image');
assert.throws(() => baseFor([{ addr: 0, data: full.subarray(0, 0xa000), name: 'm' }], GW, null), /part of NVS/);
assert.throws(() => baseFor([{ addr: 0x8000, data: table([[1, 2, 0xa000, 0x6000, 'nvs']]), name: 'pt' }], P4W, blank6), /puts NVS at 0xa000/);
assert.equal(baseFor([{ addr: 0x8000, data: table(P4_ROWS), name: 'pt' }], P4W, blank6).from, 'board');
assert.throws(() => baseFor([], P4W, null), /NVS not read/);
assert.deepEqual(checkPlan([{ addr: 0, data: full, name: 'm' }, { addr: 0x9000, data: blank6, name: 'NVS with Wi-Fi', nvs: true }], parts).notes, ['m overwrites nvs at 0x9000: stored settings are lost']); n += 6;

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
if (arg.index) {
  // every hosted release lands on a preset, every file on a slot of it
  const idx = JSON.parse(readFileSync(arg.index, 'utf8'));
  for (const r of idx.releases) {
    const id = Object.keys(PRESETS).find((k) => PRESETS[k].products.includes(r.product));
    assert.ok(id, `${r.tag}: no preset lists ${r.product}`);
    assert.equal(releasesFor(idx, id).find((x) => x.tag === r.tag)?.files.length, r.files.length, `${r.tag}: a file has no slot`);
    for (const f of r.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
    n++;
  }
}
console.log(`flash_check: ${n} checks passed${Object.keys(arg).length ? ' (real: ' + Object.keys(arg).join(', ') + ')' : ''}`);
