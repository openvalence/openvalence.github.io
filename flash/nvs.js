// The Wi-Fi option's NVS work: an ESP-IDF NVS reader and writer, and the Valence saved-network
// list the firmware keeps in it. No DOM and no serial port, so tools/flash_check.mjs runs it.
// Constraints:
// - The page format follows ESP-IDF 5.5 nvs_flash (nvs_page.cpp, nvs_types.cpp, nvs_constants.h):
//   page version 0xFE only. build() lays entries out as nvs_partition_gen.py 0.3.0 does, byte for
//   byte; tools/flash_check.mjs holds the generator's hashes.
// - parse() throws on anything it does not fully understand. A throw means nothing goes to NVS.
// - No message, return value or log line carries an SSID or a passphrase.
// - The saved-network blob mirrors Valence lib/valence/include/valence/net/saved_networks.hpp
//   (SavedNetworks::encode, decode, save, joinTarget, checkCredentials). Change it there first.
import { crc32, parsePartitions } from './image.js?v=bd65b734d4';

const PAGE = 4096, ENTRIES = 126, VERSION = 0xfe;
const ACTIVE = 0xfffffffe, FULL = 0xfffffffc, FREEING = 0xfffffff8;
// item types (nvs_types.hpp ItemType); BLOB (0x41, the pre-v2 single-page blob) is refused
export const T = { u8: 0x01, i8: 0x11, u16: 0x02, i16: 0x12, u32: 0x04, i32: 0x14, u64: 0x08, i64: 0x18, str: 0x21, blob: 0x48 };
const PRIM = new Set([0x01, 0x11, 0x02, 0x12, 0x04, 0x14, 0x08, 0x18]);
const SZ = 0x21, BLOB_DATA = 0x42, BLOB_IDX = 0x48;

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const put32 = (d, o, v) => { for (let i = 0; i < 4; i++) d[o + i] = (v >>> (8 * i)) & 0xff; };
const hx = (n) => '0x' + n.toString(16);
const enc = new TextEncoder();
export const blank = (d) => d.every((b) => b === 0xff);
const entryCrc = (e) => crc32([...e.subarray(0, 4), ...e.subarray(8, 32)]);

// One NVS partition image to { namespaces: [name, ...] in index order, entries: [{ ns, key, type,
// data }], orphans }. data: the 8-byte field for integers, the bytes with the NUL for strings, the
// joined chunks for blobs. orphans: blob chunks no index claims (the IDF drops them at init too).
export function parse(img) {
  if (!img.length || img.length % PAGE) throw new Error(`NVS size ${img.length} is not whole pages`);
  const pages = [];
  for (let o = 0; o < img.length; o += PAGE) {
    const p = img.subarray(o, o + PAGE), state = u32(p, 0);
    if (state === 0xffffffff) {
      if (!blank(p)) throw new Error(`page ${hx(o)}: blank header over data`);
      continue;
    }
    if (state === FREEING) throw new Error('NVS was mid-cleanup: boot the board once, then retry');
    if (state !== ACTIVE && state !== FULL) throw new Error(`page ${hx(o)}: state ${hx(state)}`);
    if (crc32(p.subarray(4, 28)) !== u32(p, 28)) throw new Error(`page ${hx(o)}: header CRC`);
    if (p[8] !== VERSION) throw new Error(`page ${hx(o)}: NVS version ${hx(p[8])}, not 0xfe`);
    pages.push({ o, seq: u32(p, 4), p });
  }
  pages.sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < pages.length; i++) if (pages[i].seq === pages[i - 1].seq) throw new Error('two pages share a sequence number');

  const items = [], seen = new Set();
  for (const { o, p } of pages) {
    const st = (i) => (p[32 + (i >> 2)] >> ((i & 3) * 2)) & 3;
    for (let i = 0; i < ENTRIES; i++) {
      const s = st(i);
      if (s === 3 || s === 0) continue;   // empty, erased
      const at = `entry ${hx(o + 64 + 32 * i)}`;
      if (s !== 2) throw new Error(`${at}: illegal state`);
      const e = p.subarray(64 + 32 * i, 96 + 32 * i);
      if (entryCrc(e) !== u32(e, 4)) throw new Error(`${at}: CRC (encrypted NVS?)`);
      const [nsi, type, span, chunk] = e;
      const kb = e.subarray(8, 24), kl = kb.indexOf(0);
      if (kl < 1) throw new Error(`${at}: key`);
      const key = String.fromCharCode(...kb.subarray(0, kl));
      const id = `${nsi}/${key}/${chunk}`;
      if (seen.has(id)) throw new Error(`${at}: a key appears twice: boot the board once, then retry`);
      seen.add(id);
      const it = { nsi, type, key, chunk };
      if (PRIM.has(type) || type === BLOB_IDX) {
        if (span !== 1) throw new Error(`${at}: span ${span}`);
        if (type === BLOB_IDX) {
          if (chunk !== 0xff) throw new Error(`${at}: blob index chunk`);
          Object.assign(it, { size: u32(e, 24), count: e[28], start: e[29] });
        } else it.data = e.slice(24, 32);
      } else if (type === SZ || type === BLOB_DATA) {
        const size = u16(e, 24);
        if (span !== 1 + Math.ceil(size / 32) || i + span > ENTRIES) throw new Error(`${at}: span ${span} for ${size} bytes`);
        for (let k = i + 1; k < i + span; k++) if (st(k) !== 2) throw new Error(`${at}: half-written`);
        if (type === BLOB_DATA && chunk === 0xff) throw new Error(`${at}: blob chunk index`);
        it.data = p.slice(96 + 32 * i, 96 + 32 * i + size);
        if (crc32(it.data) !== u32(e, 28)) throw new Error(`${at}: data CRC`);
      } else throw new Error(`${at}: unknown type ${hx(type)}`);
      items.push(it);
      i += span - 1;
    }
  }

  const ns = new Map();
  for (const it of items.filter((x) => x.nsi === 0)) {
    const idx = it.data?.[0];
    if (it.type !== T.u8 || !(idx >= 1 && idx <= 254) || ns.has(idx) || [...ns.values()].includes(it.key)) throw new Error('namespace table');
    ns.set(idx, it.key);
  }
  const entries = [], used = new Set();
  for (const it of items) {
    if (it.nsi === 0 || it.type === BLOB_DATA) continue;
    const name = ns.get(it.nsi);
    if (!name) throw new Error(`${it.key}: no namespace ${it.nsi}`);
    let data = it.data;
    if (it.type === BLOB_IDX) {
      data = new Uint8Array(it.size);
      let n = 0;
      for (let c = it.start; c < it.start + it.count; c++) {
        const ch = items.find((x) => x.type === BLOB_DATA && x.nsi === it.nsi && x.key === it.key && x.chunk === c);
        if (!ch || n + ch.data.length > it.size) throw new Error(`${name}/${it.key}: blob incomplete`);
        data.set(ch.data, n);
        n += ch.data.length;
        used.add(ch);
      }
      if (n !== it.size) throw new Error(`${name}/${it.key}: blob incomplete`);
    }
    entries.push({ ns: name, key: it.key, type: it.type, data });
  }
  const orphans = items.filter((x) => x.type === BLOB_DATA && !used.has(x)).length;
  return { namespaces: [...ns.keys()].sort((a, b) => a - b).map((k) => ns.get(k)), entries, orphans };
}

// The entries into a fresh partition image of `size` bytes, laid out as nvs_partition_gen.py
// (generate, version 2) lays out a CSV that lists each namespace, then its keys: namespace
// indices from 1 in `namespaces` order, data pages from sequence 0, the last page left blank.
export function build(namespaces, entries, size) {
  const pages = [];
  let pg = null, n = 0;
  const page = () => {
    if (pg && u32(pg, 0) === ACTIVE) put32(pg, 0, FULL);
    if (pages.length >= size / PAGE - 1) throw new Error('NVS full');
    pg = new Uint8Array(PAGE).fill(0xff);
    put32(pg, 0, ACTIVE);
    put32(pg, 4, pages.length);
    pg[8] = VERSION;
    put32(pg, 28, crc32(pg.subarray(4, 28)));
    pages.push(pg);
    n = 0;
  };
  const write = (bytes, count) => {
    pg.set(bytes, 64 + 32 * n);
    for (let i = 0; i < count; i++, n++) pg[32 + (n >> 2)] &= ~(1 << ((n & 3) * 2));
  };
  const head = (nsi, type, span, chunk, key) => {
    const e = new Uint8Array(32).fill(0xff);
    e.set([nsi, type, span, chunk]);
    e.fill(0, 8, 24);
    e.set(enc.encode(key), 8);
    return e;
  };
  const seal = (e) => { put32(e, 4, entryCrc(e)); write(e, 1); };
  const prim = (nsi, type, key, data8) => {
    if (n >= ENTRIES) page();
    const e = head(nsi, type, 1, 0xff, key);
    e.set(data8, 24);
    seal(e);
  };
  const str = (nsi, key, data) => {
    const cnt = Math.ceil(data.length / 32);
    if (data.length > 4000) throw new Error(`${key}: string over 4000 bytes`);
    if (n >= ENTRIES || n + cnt + 1 >= ENTRIES) page();
    const e = head(nsi, SZ, cnt + 1, 0xff, key);
    e[24] = data.length & 0xff; e[25] = data.length >> 8;
    put32(e, 28, crc32(data));
    seal(e);
    write(data, cnt);
  };
  const blob = (nsi, key, data) => {
    if (n >= ENTRIES) page();
    let off = 0, count = 0, left = data.length;
    for (;;) {
      const room = (ENTRIES - n - 1) * 32, size = Math.min(room, left);
      left -= size;
      const cnt = Math.ceil(size / 32), e = head(nsi, BLOB_DATA, cnt + 1, count, key);
      const chunk = data.subarray(off, off + size);
      e[24] = size & 0xff; e[25] = size >> 8;
      put32(e, 28, crc32(chunk));
      seal(e);
      write(chunk, cnt);
      count++;
      if (left || room - size < 32) page();
      off += size;
      if (!left) {
        const x = head(nsi, BLOB_IDX, 1, 0xff, key);
        put32(x, 24, data.length);
        x[28] = count; x[29] = 0;
        seal(x);
        return;
      }
    }
  };

  page();
  namespaces.forEach((name, i) => {
    prim(0, T.u8, name, [i + 1]);
    for (const e of entries.filter((x) => x.ns === name)) {
      if (e.key.length < 1 || e.key.length > 15) throw new Error('key length');
      if (e.type === SZ) str(i + 1, e.key, e.data);
      else if (e.type === BLOB_IDX) blob(i + 1, e.key, e.data);
      else if (PRIM.has(e.type)) prim(i + 1, e.type, e.key, e.data);
      else throw new Error(`type ${hx(e.type)}`);
    }
  });
  if (entries.some((e) => !namespaces.includes(e.ns))) throw new Error('entry without a namespace');
  const out = new Uint8Array(size).fill(0xff);
  pages.forEach((p, i) => out.set(p, i * PAGE));
  return out;
}

// ---- the saved-network list (SavedNetworks, kCapacity 4, kVersion 1) ----
export const NETS_MAX = 4, NETS_BYTES = 4 + NETS_MAX * (2 + 32 + 64);
const isHex = (s) => /^[0-9a-fA-F]{64}$/.test(s);

// checkCredentials: null when the firmware accepts the pair, else the reason (never the value).
export function checkNet(ssid, pass) {
  const s = enc.encode(ssid);
  if (!s.length || s.length > 32) return 'SSID: 1 to 32 bytes';
  if (s.includes(0)) return 'SSID: no NUL';
  if (!pass.length || isHex(pass)) return null;
  if (pass.length < 8 || pass.length > 63) return 'password: 8 to 63 characters, or 64 hex digits';
  if (!/^[\x20-\x7e]*$/.test(pass)) return 'password: printable ASCII only';
  return null;
}

// checkCredentials on stored bytes, as decode() and the legacy migrations run it.
const okPair = (ssid, pass) => ssid.length >= 1 && ssid.length <= 32 && !ssid.includes(0) && !checkNet('x', String.fromCharCode(...pass));

// list: [{ ssid: Uint8Array, pass: Uint8Array }]. save(): replace the entry with the same SSID,
// else append, else, on a full list, the last entry (joinTarget with no slot and no live entry).
export function netsSave(list, ssid, pass) {
  const s = enc.encode(ssid), p = enc.encode(pass);
  const same = list.findIndex((e) => e.ssid.length === s.length && e.ssid.every((b, i) => b === s[i]));
  const slot = same >= 0 ? same : list.length < NETS_MAX ? list.length : NETS_MAX - 1;
  const replaced = slot < list.length;
  list[slot] = { ssid: s, pass: p };
  return { slot, replaced };
}

// encode(): 'V' 'N', version 1, count, then 4 x { ssidLen, passLen, ssid[32], pass[64] }, zeros past count.
export function netsEncode(list) {
  const d = new Uint8Array(NETS_BYTES);
  d.set([0x56, 0x4e, 1, list.length]);
  list.forEach((e, i) => {
    const o = 4 + i * 98;
    d[o] = e.ssid.length; d[o + 1] = e.pass.length;
    d.set(e.ssid, o + 2); d.set(e.pass, o + 34);
  });
  return d;
}

// decode(): null where the firmware's decode fails (and it then starts with an empty list).
export function netsDecode(d) {
  if (d.length !== NETS_BYTES || d[0] !== 0x56 || d[1] !== 0x4e || d[2] !== 1 || d[3] > NETS_MAX) return null;
  const list = [];
  for (let i = 0; i < d[3]; i++) {
    const o = 4 + i * 98;
    if (d[o] > 32 || d[o + 1] > 64) return null;
    const ssid = d.slice(o + 2, o + 2 + d[o]), pass = d.slice(o + 34, o + 34 + d[o + 1]);
    // save() runs checkCredentials on every stored pair; any refusal empties the list
    if (!okPair(ssid, pass)) return null;
    const dup = list.findIndex((e) => e.ssid.length === ssid.length && e.ssid.every((b, k) => b === ssid[k]));
    if (dup >= 0) list[dup] = { ssid, pass };
    else list.push({ ssid, pass });
  }
  return list;
}

// ---- the Wi-Fi edit ----
// The NVS the board holds once the image rows are written: the slice of a row that covers the
// whole partition (a full image), else `board`, the partition as read. A partition table inside
// a row must put NVS where `wifi` says. Returns { base, from: 'image' | 'board' }.
export function baseFor(writes, wifi, board) {
  const end = wifi.addr + wifi.size;
  for (const w of writes) {
    const at = 0x8000 - w.addr;
    if (at < 0 || w.data.length < at + 32) continue;
    const t = parsePartitions(w.data.subarray(at, at + 0xc00)), p = t.find((x) => x.type === 1 && x.subtype === 2);
    if (t.length && !p) throw new Error(`${w.name} has no NVS partition`);
    if (p && (p.offset !== wifi.addr || p.size !== wifi.size)) throw new Error(`${w.name} puts NVS at ${hx(p.offset)}, not ${hx(wifi.addr)}`);
  }
  const cover = writes.filter((w) => w.addr < end && w.addr + w.data.length > wifi.addr);
  const c = cover[0];
  if (cover.length > 1 || (c && (c.addr > wifi.addr || c.addr + c.data.length < end))) throw new Error('an image covers part of NVS');
  if (c) return { base: c.data.slice(wifi.addr - c.addr, end - c.addr), from: 'image' };
  if (!board) throw new Error('NVS not read');
  return { base: board, from: 'board' };
}

const sameKey = (a, b) => a.ns === b.ns && a.key === b.key;
const str0 = (e) => e && e.type === SZ ? e.data.subarray(0, Math.max(0, e.data.indexOf(0))) : null;

// The partition `base` (as read, or as a full image leaves it) with one network saved the way the
// firmware saves one, and for Garnet the typed hub address. wifi: a preset's wifi block (image.js).
// hub: null or { ip: [a, b, c, d], port }. Returns { image, fresh, slot, count, entries, reset,
// orphans }:
// reset = the stored list did not decode and was started again, as the firmware would.
// Throws on a refusal; the image is checked by parsing it back before it is returned.
export function withWifi(base, wifi, ssid, pass, hub) {
  const bad = checkNet(ssid, pass);
  if (bad) throw new Error(bad);
  const fresh = blank(base);
  const old = fresh ? { namespaces: [], entries: [], orphans: 0 } : parse(base);
  const find = (key) => old.entries.find((e) => e.ns === wifi.ns && e.key === key);
  const nets = find('nets');
  let list = nets && nets.type === BLOB_IDX ? netsDecode(nets.data) : null;
  const reset = !!nets && !list, dels = [];
  if (list) {
    // the stored list stands; legacy keys are left as they are, as the firmware leaves them
  } else if (wifi.legacy === 'sta') {
    // ValenceProvisioning.cpp load(): no readable list, so a valid LegacyStation
    // { 'S' 'T', 1, ssidLen, passLen, ssid[32], pass[64] } becomes slot 0 and is erased
    list = [];
    const l = find('sta')?.data;
    if (l && l.length === 101 && l[0] === 0x53 && l[1] === 0x54 && l[2] === 1 && l[3] >= 1 && l[3] <= 32 && l[4] <= 64) {
      const s = l.slice(5, 5 + l[3]), p = l.slice(37, 37 + l[4]);
      if (okPair(s, p)) { list.push({ ssid: s, pass: p }); dels.push('sta'); }
    }
  } else {
    list = [];
    // Garnet wifi.cpp load_locked(): with no "nets" at all, wifi_ssid / wifi_pass become slot 1
    // and both are erased
    const s = str0(find('wifi_ssid')), p = str0(find('wifi_pass')) || new Uint8Array(0);
    if (!nets && s && p.length <= 64 && okPair(s, p)) { list.push({ ssid: s, pass: p }); dels.push('wifi_ssid', 'wifi_pass'); }
  }
  const { slot } = netsSave(list, ssid, pass);
  const puts = [{ ns: wifi.ns, key: 'nets', type: BLOB_IDX, data: netsEncode(list) }];
  if (hub) {
    puts.push({ ns: wifi.ns, key: 'hub_ip', type: BLOB_IDX, data: Uint8Array.from(hub.ip) });
    puts.push({ ns: wifi.ns, key: 'hub_port', type: BLOB_IDX, data: Uint8Array.from([hub.port & 0xff, hub.port >> 8]) });
  }
  const want = old.entries.filter((e) => !(e.ns === wifi.ns && dels.includes(e.key))).map((e) => puts.find((x) => sameKey(x, e)) || e);
  for (const x of puts) if (!want.includes(x)) want.push(x);
  const namespaces = old.namespaces.includes(wifi.ns) ? old.namespaces : [...old.namespaces, wifi.ns];
  const image = build(namespaces, want, base.length);
  const back = parse(image), key = (e) => `${e.ns}\0${e.key}\0${e.type}\0${e.data.join()}`;
  const a = back.entries.map(key).sort(), b = want.map(key).sort();
  if (back.orphans || a.length !== b.length || a.some((k, i) => k !== b[i]) || back.namespaces.join() !== namespaces.join()) throw new Error('the new NVS did not read back');
  return { image, fresh, slot, count: list.length, entries: want.length, reset, orphans: old.orphans };
}
