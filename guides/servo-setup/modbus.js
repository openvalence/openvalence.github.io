// Modbus RTU framing for the servo setup page: CRC-16, FC 0x03 and 0x06 requests, reply parsing.
// Constraints: no I/O here (servo.js owns the port); registers are big-endian on the wire, the
// CRC low byte first. tools/modbus_test.mjs checks this file: run it after any change.

// CRC-16/MODBUS: polynomial 0xA001 reflected, seed 0xFFFF, no final XOR.
export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

function frame(addr, fc, reg, word) {
  const f = new Uint8Array(8);
  f.set([addr, fc, reg >> 8, reg & 0xff, word >> 8, word & 0xff]);
  const c = crc16(f.subarray(0, 6));
  f[6] = c & 0xff;
  f[7] = c >> 8;
  return f;
}

export const readRequest = (addr, reg, count) => frame(addr, 0x03, reg, count);
export const writeRequest = (addr, reg, value) => frame(addr, 0x06, reg, value);

const crcOk = (b, i, n) => n >= 3 && i + n <= b.length && crc16(b.subarray(i, i + n - 2)) === (b[i + n - 2] | (b[i + n - 1] << 8));

// The reply to `req` in `bytes`, all that arrived since it went out. An adapter that echoes its
// own transmission is handled: an exact copy of the request at the start is skipped.
// kind: 'ok' (regs for FC 0x03; reg and value for FC 0x06), 'exception' (code), 'crc' (bytes came,
// no valid frame from this address: wrong baud or noise), 'none' (nothing yet).
export function parseReply(req, bytes) {
  let b = bytes;
  if (b.length >= req.length && req.every((x, i) => b[i] === x) && req[1] === 0x03) b = b.subarray(req.length);
  const addr = req[0], fc = req[1];
  for (let i = 0; i + 5 <= b.length; i++) {
    if (b[i] !== addr) continue;
    if (b[i + 1] === (fc | 0x80) && crcOk(b, i, 5)) return { kind: 'exception', code: b[i + 2] };
    if (b[i + 1] !== fc) continue;
    if (fc === 0x03) {
      const n = b[i + 2];
      if (n === ((req[4] << 8) | req[5]) * 2 && crcOk(b, i, 5 + n)) {
        const regs = [];
        for (let k = 0; k < n; k += 2) regs.push((b[i + 3 + k] << 8) | b[i + 4 + k]);
        return { kind: 'ok', regs };
      }
    } else if (crcOk(b, i, 8)) {
      return { kind: 'ok', reg: (b[i + 2] << 8) | b[i + 3], value: (b[i + 4] << 8) | b[i + 5] };
    }
  }
  return { kind: bytes.length ? 'crc' : 'none' };
}

export const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(' ');
