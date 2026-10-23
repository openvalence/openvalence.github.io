// Checks guides/servo-setup/modbus.js. Run from the repo root: node tools/modbus_test.mjs
// Vectors: the CRC-16/MODBUS check value of "123456789" (0x4B37), the rest computed by the
// Nucleus tools/aim crc16 in Python.
import assert from 'node:assert/strict';
import { crc16, readRequest, writeRequest, parseReply, hex } from '../guides/servo-setup/modbus.js';

const u8 = (s) => Uint8Array.from(s.split(' '), (x) => parseInt(x, 16));

assert.equal(crc16(new TextEncoder().encode('123456789')), 0x4b37);
assert.equal(hex(readRequest(1, 0x15, 1)), '01 03 00 15 00 01 95 ce');
assert.equal(hex(readRequest(0x11, 0x16, 2)), '11 03 00 16 00 02 27 5f');
assert.equal(hex(writeRequest(1, 0x19, 2)), '01 06 00 19 00 02 d9 cc');
assert.equal(hex(writeRequest(1, 0x00, 506)), '01 06 00 00 01 fa 08 19');

const rd = readRequest(1, 0x15, 1);
assert.deepEqual(parseReply(rd, u8('01 03 02 00 01 79 84')), { kind: 'ok', regs: [1] });
// echoing adapter, and junk before the frame
assert.deepEqual(parseReply(rd, u8('01 03 00 15 00 01 95 ce 01 03 02 00 01 79 84')), { kind: 'ok', regs: [1] });
assert.deepEqual(parseReply(rd, u8('ff 00 01 03 02 00 01 79 84')), { kind: 'ok', regs: [1] });
assert.deepEqual(parseReply(rd, u8('01 83 02 c0 f1')), { kind: 'exception', code: 2 });
assert.equal(parseReply(rd, u8('01 03 02 00 01 79 85')).kind, 'crc');      // bad CRC
assert.equal(parseReply(rd, u8('01 03 02 00')).kind, 'crc');               // partial
assert.equal(parseReply(rd, u8('02 03 02 00 01 79 84')).kind, 'crc');      // another address
assert.equal(parseReply(rd, new Uint8Array()).kind, 'none');
// a reply of the wrong length for the request is not the reply
assert.equal(parseReply(readRequest(1, 0x16, 2), u8('01 03 02 00 01 79 84')).kind, 'crc');

const wr = writeRequest(1, 0x19, 2);
assert.deepEqual(parseReply(wr, wr), { kind: 'ok', reg: 0x19, value: 2 });
const two = readRequest(0x11, 0x16, 2);
const body = Uint8Array.from([0x11, 0x03, 0x04, 0x12, 0x34, 0xff, 0xfe]);
const c = crc16(body);
assert.deepEqual(parseReply(two, Uint8Array.from([...body, c & 0xff, c >> 8])), { kind: 'ok', regs: [0x1234, 0xfffe] });

console.log('modbus.js: all checks pass');
