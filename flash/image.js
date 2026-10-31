// The flasher's pure logic: device presets, image checks, the partition table, otadata, MD5 and the
// write plan. No DOM and no serial port, so tools/flash_check.mjs runs it under node.
// Constraints:
// - Preset offsets come from the build configs and release notes named beside each preset. Change
//   them there first, then here.
// - The P4 preset never erases the chip: NVS holds the hub identity, the trust ledger and pairing.
//   Its slot limits keep every write clear of NVS (0x9000 to 0xF000).
// - otadata follows ESP-IDF esp_ota_select_entry_t and bootloader_common_ota_select_crc; see
//   bootSlot().

export const hex = (n) => '0x' + n.toString(16);
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
export const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n % 1048576 ? 1 : 0)} MB` : `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} KB`);

// esp_chip_id_t, for naming the chip an image was built for
const CHIP_IDS = { 0: 'ESP32', 2: 'ESP32-S2', 5: 'ESP32-C3', 9: 'ESP32-S3', 12: 'ESP32-C2', 13: 'ESP32-C6', 16: 'ESP32-H2', 18: 'ESP32-P4', 20: 'ESP32-C61', 23: 'ESP32-C5' };
const APP_DESC_MAGIC = 0xabcd5432;   // esp_app_desc_t, first in an app's first segment
const MB = 1048576;

// kind: merged (written at 0x0; the bootloader sits at the chip's bootloader offset inside it),
// boot, app, pt (partition table), otadata, raw (custom only: no check).
export const PRESETS = {
  garnet: {
    // Garnet/platformio.ini env m5_remote (16 MB, partitions.csv); FLASHING.txt: one image at 0x0
    name: 'Garnet remote', chip: 'ESP32-S3', baud: 921600, erase: false,
    slots: [{ id: 'image', label: 'Factory image', hint: 'garnet-*.factory.bin', addr: 0x0, kind: 'merged', max: 16 * MB, ptAt: 0x8000 }],
  },
  p4: {
    // Nucleus flagship_p4/partitions.csv and sdkconfig (BOOTLOADER_OFFSET 0x2000, PARTITION_TABLE_OFFSET
    // 0x8000); the slot limits are the gaps to the next region
    name: 'Nucleus P4 recovery', chip: 'ESP32-P4', baud: 921600, erase: null, blankOta: true,
    slots: [
      { id: 'boot', label: 'Bootloader', hint: 'bootloader.bin', addr: 0x2000, kind: 'boot', max: 0x6000 },
      { id: 'pt', label: 'Partition table', hint: 'partitions.bin', addr: 0x8000, kind: 'pt', max: 0x1000 },
      { id: 'ota', label: 'otadata', hint: 'ota_data_initial.bin', addr: 0xf000, kind: 'otadata', max: 0x2000 },
      { id: 'app', label: 'App, slot ota_0', hint: 'firmware.bin or nucleus-*-app.bin', addr: 0x20000, kind: 'app', max: 0x400000 },
    ],
  },
  shim: {
    // Nucleus barnacle_shim/platformio.ini (esp32dev, 4 MB); the barnacle-shim release README: erase,
    // then one image at 0x0 at 460800 baud
    name: 'Barnacle helper shim', chip: 'ESP32', baud: 460800, erase: true,
    slots: [{ id: 'image', label: 'Shim image', hint: 'barnacle-shim-*.bin', addr: 0x0, kind: 'merged', max: 4 * MB, ptAt: 0x8000 }],
  },
  custom: { name: 'Custom', chip: null, baud: 460800, erase: false, slots: [] },
};

// chip: { name, imageChipId, bootOffset } from the connected loader. Returns a refusal or null.
export function checkFile(d, addr, kind, chip, flashBytes, max, ptAt) {
  if (!d.length) return 'empty file';
  if (max && d.length > max) return `${kb(d.length)} does not fit its ${kb(max)} slot`;
  if (flashBytes && addr + d.length > flashBytes) return `ends at ${hex(addr + d.length)}, past the ${kb(flashBytes)} flash`;
  if (kind === 'raw' || kind === 'otadata') return null;
  if (kind === 'pt') return d[0] === 0xaa && d[1] === 0x50 ? null : 'not a partition table: no 0xAA50 at 0x0';
  const at = kind === 'merged' ? chip.bootOffset - addr : 0;
  if (at < 0 || d.length < at + 0x24) return `too short for an image header at ${hex(at)}`;
  if (d[at] !== 0xe9) return `no image header (0xE9) at ${hex(at)}`;
  const id = u16(d, at + 12);
  if (id !== chip.imageChipId) return `built for ${CHIP_IDS[id] || 'chip id ' + id}; the board is ${chip.name}`;
  const isApp = u32(d, at + 0x20) === APP_DESC_MAGIC;
  if (kind === 'app' && !isApp) return 'not an app image: no app descriptor';
  if (kind !== 'app' && isApp) return `an app image where the bootloader goes (${hex(addr + at)})`;
  if (ptAt !== undefined && !(d[ptAt - addr] === 0xaa && d[ptAt - addr + 1] === 0x50)) return `not a full image: no partition table at ${hex(ptAt)}`;
  return null;
}

// Custom rows: the kind follows the offset, then the content.
export function customKind(d, addr, chip) {
  if (addr === 0) return 'merged';
  if (addr === chip.bootOffset) return 'boot';
  if (d[0] === 0xaa && d[1] === 0x50) return 'pt';
  if (d[0] === 0xe9) return 'app';
  return 'raw';
}

const DATA_SUB = { 0: 'ota', 1: 'phy', 2: 'nvs', 3: 'coredump', 4: 'nvs_keys', 5: 'efuse', 0x81: 'fat', 0x82: 'spiffs', 0x83: 'littlefs' };
// esp_partition_info_t, 32 bytes each, from the table's start; stops at the MD5 entry or erased flash.
export function parsePartitions(d) {
  const out = [];
  for (let o = 0; o + 32 <= d.length && d[o] === 0xaa && d[o + 1] === 0x50; o += 32) {
    const type = d[o + 2], subtype = d[o + 3];
    let label = '';
    for (let i = o + 12; i < o + 28 && d[i]; i++) label += String.fromCharCode(d[i]);
    const sub = type === 0 ? (subtype === 0 ? 'factory' : subtype >= 0x10 && subtype < 0x20 ? `ota_${subtype - 0x10}` : subtype === 0x20 ? 'test' : hex(subtype)) : DATA_SUB[subtype] || hex(subtype);
    out.push({ type, subtype, sub, offset: u32(d, o + 4), size: u32(d, o + 8), label });
  }
  return out;
}

// esp_rom_crc32_le(UINT32_MAX, &ota_seq, 4): the register starts at 0, not 0xFFFFFFFF, so this is
// not the common CRC32. otatool.py spells it binascii.crc32(data, 0xFFFFFFFF).
export function otaCrc(seq) {
  let c = 0;
  for (let i = 0; i < 4; i++) {
    c ^= (seq >>> (8 * i)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

const OTA_STATE = { 0: 'new', 1: 'pending verify', 2: 'valid', 3: 'invalid', 4: 'aborted', 0xffffffff: 'undefined' };
// What the bootloader boots next, per bootloader_utility_get_selected_boot_partition: two
// entries, one per 4 KB sector; an entry counts when ota_seq is set, its state is neither invalid
// nor aborted and its crc matches; the highest ota_seq wins and picks slot (ota_seq - 1) % count.
// None valid: factory, else ota_0. Rollback on: pending verify becomes aborted at the next boot.
export function bootSlot(od, parts) {
  const apps = parts.filter((p) => p.type === 0 && p.subtype >= 0x10 && p.subtype < 0x20).sort((a, b) => a.subtype - b.subtype);
  const factory = parts.find((p) => p.type === 0 && p.subtype === 0);
  const e = [0, 0x1000].map((b) => ({ seq: u32(od, b), state: u32(od, b + 24), crc: u32(od, b + 28) }));
  const ok = (x) => x.seq !== 0xffffffff && x.state !== 3 && x.state !== 4 && x.crc === otaCrc(x.seq);
  const valid = e.filter(ok);
  const dead = e.filter((x) => x.seq !== 0xffffffff && (x.state === 3 || x.state === 4) && x.crc === otaCrc(x.seq) && apps.length);
  const notes = dead.map((x) => `${apps[(x.seq - 1) % apps.length].sub} ${OTA_STATE[x.state]}`);
  if (!valid.length || !apps.length) {
    const s = factory ? factory.sub : apps.length ? apps[0].sub : null;
    return { slot: s, text: s ? `${s}, otadata blank` : 'no app partition', notes };
  }
  const w = valid.reduce((a, b) => (b.seq > a.seq ? b : a));
  const slot = apps[(w.seq - 1) % apps.length].sub;
  let text = `${slot}, ${OTA_STATE[w.state] || 'state ' + hex(w.state)}`;
  if (w.state === 1) text += ': the next boot rolls back unless this app confirms itself';
  return { slot, text, notes };
}

// Offset for a custom file from its name and the board's partition table.
export function guessOffset(name, chip, parts) {
  const n = name.toLowerCase();
  const find = (f) => parts.find(f);
  if (/merged|factory\.bin$|full/.test(n)) return 0;
  if (/bootloader/.test(n)) return chip.bootOffset;
  if (/partition/.test(n)) return 0x8000;
  if (/ota_data|otadata/.test(n)) return find((p) => p.type === 1 && p.subtype === 0)?.offset ?? null;
  const app = find((p) => p.type === 0 && p.subtype === 0x10) || find((p) => p.type === 0 && p.subtype === 0);
  return app ? app.offset : null;
}

// writes: [{ addr, data, name }]. Refusals for overlap and alignment, and notes for writes that
// land on NVS. Returns { error } or { notes }.
export function checkPlan(writes, parts) {
  if (!writes.length) return { error: 'no files chosen' };
  const s = [...writes].sort((a, b) => a.addr - b.addr);
  for (const w of s) if (w.addr % 0x1000) return { error: `${w.name}: ${hex(w.addr)} is not on a 4 KB sector boundary` };
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1].addr + s[i - 1].data.length > s[i].addr) return { error: `${s[i - 1].name} and ${s[i].name} overlap at ${hex(s[i].addr)}` };
  }
  const notes = [];
  for (const p of parts.filter((x) => x.type === 1 && x.subtype === 2)) {
    for (const w of s) if (w.addr < p.offset + p.size && w.addr + w.data.length > p.offset) notes.push(`${w.name} overwrites ${p.label} at ${hex(p.offset)}: stored settings are lost`);
  }
  return { notes };
}

// RFC 1321 MD5, hex. esptool-js asks for it to verify each write against the flash.
export function md5(d) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  const n = ((d.length + 8) >>> 6) + 1, m = new Uint8Array(n * 64);
  m.set(d);
  m[d.length] = 0x80;
  const bits = d.length * 8;
  for (let i = 0; i < 8; i++) m[n * 64 - 8 + i] = i < 4 ? (bits >>> (8 * i)) & 0xff : Math.floor(bits / 2 ** (8 * i)) & 0xff;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < m.length; off += 64) {
    let a = a0, b = b0, c = c0, dd = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & dd); g = i; }
      else if (i < 32) { f = (dd & b) | (~dd & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ dd; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~dd); g = (7 * i) % 16; }
      f = (f + a + K[i] + u32(m, off + 4 * g)) >>> 0;
      a = dd; dd = c; c = b;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((f << s) | (f >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + dd) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}
