// The servo setup page: a Web Serial link to an AIM drive, the scan, the register read, the
// OpenValence preset and the baud change.
// Constraints:
// - Writes go through w(), which refuses any register outside WRITABLE and 0x0A = 0 (Modbus
//   control at power-on). 0x00 is written only inside the save gate, the baud sequence and the
//   Release button: a bare 0x00 write arms Modbus control, and only 506 then 0 releases it.
// - The save gate, the preset and the baud sequence are the bench-proven ones: Nucleus
//   tools/aim/aim_program.py (gate and TARGET) and docs/drive-bench-2026-10-07.md. Change them
//   there first, then here.
// - Stores nothing and sends nothing off the computer.
import { readRequest, writeRequest, parseReply, hex } from './modbus.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s16 = (v) => (v > 32767 ? v - 65536 : v);
const s32 = (lo, hi) => ((hi << 16) | lo) | 0;
const h2x = (a) => '0x' + a.toString(16).toUpperCase().padStart(2, '0');
const num = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

// Nucleus flagship_p4/src/system/AimDrive.h kBauds: every rate the drive takes, the factory one first.
const BAUDS = [19200, 115200, 38400, 9600];
// The baud sequence's code for 115200, the only one proven on the bench.
const TARGET_BAUD = 115200, BAUD_CODE = 803;
// aim_program.py TARGET: the machine's drive settings, written only when the visitor ticks them.
const TUNING = { 0x02: 2000, 0x03: 60000, 0x04: 495, 0x05: 3000, 0x06: 10, 0x07: 3000, 0x08: 3900, 0x09: 1, 0x0A: 4, 0x0B: 1, 0x18: 600, 0x19: 2 };
const WRITABLE = new Set([0x00, 0x01, 0x14, ...Object.keys(TUNING).map(Number)]);
// The preset: A/B quadrature, gear 4/1 (the scale the firmware's 208.6 steps/mm assumes), and 0x07's
// ones digit even (alarm output normally open), the visitor's gain kept. With 0x00 = 0 and 0x01
// nonzero it is what the Flagship firmware's drive-link probe passes (Nucleus AimDrive.h judgeMap,
// docs/board-map.md drive link).
const evenKp = (v) => (v % 2 ? v - (v % 10) : v);
function targets() {
  const t = { 0x19: 2, 0x0A: TUNING[0x0A], 0x0B: TUNING[0x0B] };
  if (raw[0x07] !== undefined) t[0x07] = evenKp(raw[0x07]);
  return $('tuning').checked ? { ...t, ...TUNING } : t;
}
const ALARMS = { 0: 'none', 0x10: 'battery (the motor keeps running)', 0x12: 'over-current', 0x14: 'stall', 0x15: 'over-voltage' };

// [address, name, meaning(raw value, all raw values), registers read together]
const REGS = [
  [0x00, 'Modbus control', (v) => (v === 0 ? 'off: the pulse input is live' : 'on: the drive ignores its pulse input')],
  [0x01, 'Output enable', (v) => (v === 0 ? 'off' : v === 1 ? 'on' : `on: the manual lists 0 and 1; a 60AIM40F reads ${v} with Modbus control off`)],
  [0x02, 'Speed limit', (v) => `${v} rpm`],
  [0x03, 'Acceleration', (v) => (v <= 60000 ? `${v} rpm/s` : `full ramp plus ${v - 60000} % feed-forward`)],
  [0x04, 'Field weakening', () => 'drive internal'],
  [0x05, 'Speed loop gain', (v) => `${(v / 1000).toFixed(1)}; ones digit ${v % 10} sets the pulse edge`],
  [0x06, 'Speed loop integral', (v) => `${v} ms`],
  [0x07, 'Position loop gain', (v) => `${v}; ${v % 2 ? 'odd: alarm output normally closed' : 'even: alarm output normally open'}`],
  [0x08, 'Speed feed-forward', (v) => `${(v / 327).toFixed(2)} V/krpm`],
  [0x09, 'Direction polarity', (v) => String(v)],
  [0x0A, 'Gear numerator', (v) => (v === 0 ? '0: Modbus control at power-on' : String(v))],
  [0x0B, 'Gear denominator', (v, r) => (r[0x0A] && v ? `${num((32768 * v) / r[0x0A])} input counts per motor turn` : '')],
  [0x0C, 'Distance to go', (v, r) => `${s32(v, r[0x0D])} counts`, 2],
  [0x0E, 'Alarm', (v) => ALARMS[v] || `unknown code ${v}`],
  [0x0F, 'Current', (v) => `${(v / 2000).toFixed(2)} A`],
  [0x10, 'Speed', (v) => `${(s16(v) / 10).toFixed(1)} rpm`],
  [0x11, 'Voltage', (v) => `${(v / 327).toFixed(1)} V`],
  [0x12, 'Temperature', (v) => `${v} °C`],
  [0x13, 'Output', (v) => `${((s16(v) / 32767) * 100).toFixed(0)} %`],
  [0x14, 'Save flag', (v) => String(v)],
  [0x15, 'Address', (v) => String(v)],
  [0x16, 'Encoder position', (v, r) => `${s32(v, r[0x17])} counts, ${(s32(v, r[0x17]) / 32768).toFixed(3)} turns`, 2],
  [0x18, 'Standstill output', (v) => `${Math.floor(v / 10)} % hold limit; stall alarm digit ${v % 10}${v % 10 ? '' : ' (off)'}`],
  [0x19, 'Input mode', (v) => (v === 2 ? 'A/B quadrature' : `${v}: not A/B quadrature`)],
];
const NAME = Object.fromEntries(REGS.map(([a, n]) => [a, n]));
const WHY = {
  0x02: 'above the 1730 rpm the motor reaches loaded on 36 V',
  0x03: 'full ramp, no feed-forward',
  0x04: 'bench-tuned',
  0x05: 'bench-tuned',
  0x06: 'bench-tuned',
  0x07: 'bench-tuned; even keeps the alarm output normally open',
  0x08: 'bench-tuned',
  0x09: 'the machine\'s direction',
  0x0A: '4/1 is 8192 counts per turn, what the firmware sends',
  0x0B: '4/1 is 8192 counts per turn, what the firmware sends',
  0x18: 'factory: 60 % hold, no stall alarm',
  0x19: 'A/B quadrature input',
};

// ---- the log ----
const t0 = performance.now();
const lines = [];
function log(text, bytes) {
  const t = ((performance.now() - t0) / 1000).toFixed(3).padStart(9);
  lines.push(`${t} s  ${text}${bytes ? '  ' + hex(bytes) : ''}`);
  if (lines.length > 4000) lines.splice(0, lines.length - 4000);
  const el = $('log');
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;
}

// ---- the port ----
let port = null, writer = null, reader = null, pumping = null, closing = false;
let rx = [], wake = null, linkBaud = 0, addr = 1, raw = null, quiet = false, stop = false;

async function closePort() {
  closing = true;
  if (reader) try { await reader.cancel(); } catch (e) {}
  if (pumping) await pumping;
  if (writer) { writer.releaseLock(); writer = null; }
  if (port && port.writable) try { await port.close(); } catch (e) {}
  pumping = null;
  closing = false;
}

async function openAt(baud) {
  await closePort();
  await port.open({ baudRate: baud, dataBits: 8, parity: 'none', stopBits: 1 });
  linkBaud = baud;
  log(`port open at ${baud} 8N1`);
  writer = port.writable.getWriter();
  pumping = (async () => {
    // A framing or parity error (likely at a wrong baud) errors the stream; port.readable then
    // hands out a fresh one.
    while (port.readable && !closing) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          for (const x of value) rx.push(x);
          if (wake) wake();
        }
      } catch (e) {
        if (!quiet) log(`line error: ${e.name}`);
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
  })();
}

async function xfer(req, timeout = 120) {
  rx = [];
  await writer.write(req);
  const start = performance.now();
  let r;
  for (;;) {
    r = parseReply(req, Uint8Array.from(rx));
    if (r.kind === 'ok' || r.kind === 'exception') break;
    const left = timeout - (performance.now() - start);
    if (left <= 0) break;
    await new Promise((res) => { wake = res; setTimeout(res, left); });
    wake = null;
  }
  if (!quiet || rx.length) {
    log('TX', req);
    log(rx.length ? `RX ${r.kind === 'ok' ? '' : r.kind}`.trim() : 'RX none', rx.length ? Uint8Array.from(rx) : null);
  }
  await sleep(5);   // the 3.5-character silence before the next frame, at 9600 and up
  return r;
}

async function readRegs(a, n = 1) {
  const r = await xfer(readRequest(addr, a, n));
  return r.kind === 'ok' ? r.regs : null;
}

// One register write and its read-back. verify false: the reply is not judged (0x00 = 506 has
// none; 0x01 is a live status word that reads back other than written; 0x14 is polled instead).
async function w(a, v, verify = true) {
  if (!WRITABLE.has(a) || (a === 0x0A && v === 0)) throw new Error(`refused: ${h2x(a)} = ${v} is outside the documented set`);
  const r = await xfer(writeRequest(addr, a, v));
  await sleep(30);
  if (!verify) {
    step(`${h2x(a)} ${NAME[a] || ''} = ${v}`);
    return true;
  }
  const rb = await readRegs(a);
  const ok = r.kind === 'ok' && rb !== null && rb[0] === v;
  step(`${h2x(a)} ${NAME[a] || ''} = ${v}: ${ok ? 'read back' : `FAILED (reply ${r.kind}, read back ${rb ? rb[0] : 'none'})`}`, !ok);
  return ok;
}

// Modbus control off: 506, then 0 (a bare 0 is acknowledged and changes nothing).
async function release() {
  await w(0x00, 506, false);
  await sleep(50);
  return w(0x00, 0);
}

// ---- the page ----
let busy = false, runList = null;
function step(text, bad) {
  if (!runList) return;
  const li = document.createElement('li');
  li.textContent = text;
  if (bad) li.className = 'bad';
  runList.append(li);
}
function say(id, text, tone) {
  const el = $(id);
  el.textContent = text;
  el.className = 'state' + (tone ? ' ' + tone : '');
}

function refresh() {
  const have = !!raw;
  $('find').disabled = busy;
  $('stop').hidden = !busy;
  $('reread').disabled = busy || !have;
  $('release').hidden = !have || raw[0x00] === 0 || raw[0x00] === undefined;
  $('release').disabled = busy;
  $('apply').disabled = busy || !have || !$('ack-apply').checked || !work();
  $('baud').disabled = busy || !have || linkBaud === TARGET_BAUD || !$('ack-baud').checked;
  $('check').disabled = busy || !port;
}

async function run(fn, stateId = 'find-state') {
  if (busy) return;
  busy = true;
  stop = false;
  refresh();
  try {
    await fn();
  } catch (e) {
    log(`error: ${e.message}`);
    say(stateId, /open/i.test(e.message) ? 'The port would not open. Another program may have it: close it there and try again.' : `Stopped: ${e.message}`, 'bad');
  } finally {
    busy = false;
    quiet = false;
    refresh();
  }
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Address 1 at every rate first, then 2 to 247. A valid-CRC reply to a read of 0x15 (the drive's
// own address register) identifies the drive.
async function scan(stateId, first = []) {
  const order = [...new Set([...first, ...BAUDS])];
  const odd = [];
  for (const [list, timeout] of [[[1], 120], [range(2, 247), 60]]) {
    if (list.length > 1) log('nothing at address 1: trying addresses 2 to 247 at each rate');
    quiet = list.length > 1;
    for (const b of order) {
      await openAt(b);
      for (const a of list) {
        if (stop) return null;
        if (a === 1 || a % 8 === 2) say(stateId, `Trying ${b} baud, address ${a}${list.length > 1 ? ' of 247' : ''}...`);
        const r = await xfer(readRequest(a, 0x15, 1), timeout);
        if (r.kind === 'ok') {
          quiet = false;
          log(`found: ${b} baud, address ${a}, 0x15 reads ${r.regs[0]}`);
          return { baud: b, addr: a, id: r.regs[0] };
        }
        if (r.kind === 'exception') odd.push(`${b} baud, address ${a} answered with exception ${r.code}: not this drive's register map`);
      }
    }
  }
  quiet = false;
  for (const o of odd) log(o);
  return null;
}

async function readAll() {
  const next = {};
  for (const [a, , , n = 1] of REGS) {
    const v = await readRegs(a, n);
    if (v) v.forEach((x, i) => (next[a + i] = x));
  }
  raw = next;
  render();
  if (raw[0x15] === undefined) throw new Error('the drive stopped answering');
}

function render() {
  const body = $('regs').tBodies[0];
  body.replaceChildren();
  for (const [a, name, show, n = 1] of REGS) {
    const tr = body.insertRow();
    const have = raw[a] !== undefined && (n === 1 || raw[a + 1] !== undefined);
    const cells = [n === 2 ? `${h2x(a)}-${h2x(a + 1)}` : h2x(a), name, have ? (n === 2 ? `${raw[a]}, ${raw[a + 1]}` : String(raw[a])) : 'no answer', have ? show(raw[a], raw) : ''];
    cells.forEach((c, i) => {
      const td = tr.insertCell();
      td.textContent = c;
      if (i === 0 || i === 2) td.className = 'n';
    });
  }
  $('regs').hidden = false;
  const notes = [];
  if (raw[0x15] !== undefined && raw[0x15] !== addr) notes.push(`0x15 reads ${raw[0x15]} but the drive answered at address ${addr}.`);
  if (addr !== 1) notes.push('Nucleus on the Flagship talks to address 1 only. A barnacle build does not use RS485.');
  if (raw[0x0E]) notes.push(`The drive reports an alarm: ${ALARMS[raw[0x0E]] || 'code ' + raw[0x0E]}.`);
  if (raw[0x00]) notes.push('Modbus control is on, so the drive ignores pulses. Release it below, or let the preset write release it.');
  $('drive-notes').textContent = notes.join(' ');
  renderDiff();
}

// Registers written inside the gate. 0x00 and 0x01 are the gate's own: 0x01 = 1 goes last inside
// it, 0x00 is released after it.
function diff() {
  if (!raw) return [];
  return Object.entries(targets()).map(([a, v]) => [Number(a), v]).filter(([a, v]) => raw[a] !== v);
}
const needOn = () => raw && raw[0x01] === 0;
const needRelease = () => raw && raw[0x00] !== 0 && raw[0x00] !== undefined;
const work = () => diff().length > 0 || needOn() || needRelease();

// The drive-link probe's pass criteria, as the Flagship firmware checks them.
function ready() {
  const r = raw || {};
  const rows = [
    [r[0x15] === 1, `0x15 address reads ${r[0x15] ?? 'nothing'}; the firmware talks to address 1`],
    [r[0x00] === 0, `0x00 Modbus control ${r[0x00] ?? '?'}: must be 0, or the drive ignores the pulse input`],
    [r[0x01] !== undefined && r[0x01] !== 0, `0x01 output enable ${r[0x01] ?? '?'}: must not be 0`],
    [r[0x19] === 2, `0x19 input mode ${r[0x19] ?? '?'}: must be 2, A/B quadrature`],
    [r[0x07] !== undefined && r[0x07] % 2 === 0, `0x07 position loop gain ${r[0x07] ?? '?'}: must be even, alarm output normally open`],
    [r[0x12] !== undefined && r[0x12] <= 100, `0x12 temperature ${r[0x12] ?? '?'}: 100 or less, else this is not the AIM map`],
  ];
  const ul = $('ready');
  ul.replaceChildren();
  for (const [ok, text] of rows) {
    const li = document.createElement('li');
    li.textContent = `${ok ? 'pass' : 'FAIL'}  ${text}`;
    if (!ok) li.className = 'bad';
    ul.append(li);
  }
  if (r[0x0A] !== undefined && (r[0x0A] !== 4 || r[0x0B] !== 1)) {
    const li = document.createElement('li');
    li.textContent = `note  0x0A/0x0B gear ${r[0x0A]}/${r[0x0B]}: the firmware's scale assumes 4/1, 8192 counts per turn (the preset writes it)`;
    ul.append(li);
  }
  return rows.every(([ok]) => ok);
}

function renderDiff() {
  const d = diff(), body = $('diff').tBodies[0];
  body.replaceChildren();
  const rows = d.map(([a, v]) => [a, v, a === 0x07 && !$('tuning').checked ? 'ones digit even: alarm output normally open' : WHY[a]]);
  if (raw && needOn()) rows.push([0x01, 1, 'output on, written last']);
  if (raw && needRelease()) rows.push([0x00, 0, 'released: 506, then 0']);
  for (const [a, v, why] of rows) {
    const tr = body.insertRow();
    [h2x(a), NAME[a], raw[a] === undefined ? 'no answer' : String(raw[a]), String(v), why].forEach((c, i) => {
      const td = tr.insertCell();
      td.textContent = c;
      if (i === 0 || i === 2) td.className = 'n';
      if (i === 3) td.className = 'n new';
    });
  }
  $('diff').hidden = !rows.length;
  say('apply-state', !raw ? 'Find the drive first.' : rows.length ? `${rows.length} register${rows.length > 1 ? 's' : ''} to change.` : 'The drive matches the preset. Nothing to write.', raw && !rows.length ? 'good' : '');
  ready();
}

// Refuses while the motor turns: 0x10 at 1 rpm or more, or the encoder moving 64 counts (0.7 degrees)
// in 200 ms.
async function stillCheck() {
  const s1 = await readRegs(0x10), e1 = await readRegs(0x16, 2);
  await sleep(200);
  const s2 = await readRegs(0x10), e2 = await readRegs(0x16, 2);
  if (!s1 || !e1 || !s2 || !e2) throw new Error('the drive stopped answering');
  const v = Math.max(Math.abs(s16(s1[0])), Math.abs(s16(s2[0]))), de = Math.abs(s32(e2[0], e2[1]) - s32(e1[0], e1[1]));
  if (v >= 10 || de > 64) {
    step(`Refused: the motor is turning (${(v / 10).toFixed(1)} rpm, ${de} counts in 200 ms). Stop whatever drives it, then try again.`, true);
    return false;
  }
  return true;
}

async function find() {
  const picked = await navigator.serial.requestPort();
  await closePort();
  port = picked;
  raw = null;
  render0();
  const f = await scan('find-state');
  if (!f) {
    if (!stop) say('find-state', 'No drive answered at any rate or address. Check motor power, the 5 V and COM wires, and try A and B swapped.', 'bad');
    else say('find-state', 'Stopped.');
    return;
  }
  addr = f.addr;
  await readAll();
  say('find-state', `Found the drive at ${f.baud} baud, address ${f.addr}.`, 'good');
  $('baud-now').textContent = baudNow();
}

const baudNow = () => (linkBaud === TARGET_BAUD ? `The drive is at ${TARGET_BAUD} baud already.` : `The drive is at ${linkBaud} baud.`);

function render0() {
  $('regs').hidden = true;
  $('diff').hidden = true;
  $('drive-notes').textContent = '';
  say('apply-state', 'Find the drive first.');
  $('ready').replaceChildren();
}

async function apply() {
  runList = $('apply-run');
  runList.replaceChildren();
  await readAll();
  const d = diff();
  if (!work()) return;
  if (!d.length && !needOn()) {
    step('Only Modbus control is on: releasing it.');
    await release();
    await readAll();
    say('apply-state', raw[0x00] === 0 ? 'Released. Check below.' : 'Modbus control did not release. Copy the log for support.', raw[0x00] === 0 ? 'good' : 'bad');
    return;
  }
  const missing = [0x01, 0x07, ...d.map(([a]) => a)].filter((a) => raw[a] === undefined);
  if (missing.length) {
    step(`Refused: ${missing.map(h2x).join(', ')} gave no answer. Read again, and copy the log for support if it repeats.`, true);
    return;
  }
  if (!(await stillCheck())) return;
  const outEn = raw[0x01];
  step(`Output enable reads ${outEn}; it is written 1 last, before Modbus control is released.`);
  let ok = (await w(0x00, 1)) && (await w(0x01, 0));
  if (ok) for (const [a, v] of d) ok = (await w(a, v)) && ok;
  if (!ok) {
    step('A write failed: nothing saved. Restoring output enable and releasing Modbus control.', true);
    await w(0x01, outEn, false);
    await release();
    await readAll();
    say('apply-state', 'Not saved: a write failed. Copy the log below for support.', 'bad');
    return;
  }
  let saved = false, flags = [];
  for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
    await w(0x14, 1, false);
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      const f = await readRegs(0x14);
      if (f) flags.push(f[0]);
      if (f && f[0] === 2) { saved = true; break; }
    }
    step(`Save attempt ${attempt}: flag read ${[...new Set(flags)].join(', ') || 'nothing'}`);
    flags = [];
  }
  // 0x01 reads back other than written while Modbus control is on; the read after release judges it.
  await w(0x01, 1, false);
  await release();
  await readAll();
  step(`After release: 0x00 reads ${raw[0x00]}, 0x01 reads ${raw[0x01]}, 0x19 reads ${raw[0x19]}`, raw[0x00] !== 0 || raw[0x01] === 0);
  if (saved) say('apply-state', 'Saved: the drive reported the save done. Power-cycle it now, then check.', 'good');
  else say('apply-state', 'Written, but the drive did not report the save done (some drives never do). Power-cycle it now, then check: that decides.', '');
}

async function changeBaud() {
  runList = $('baud-run');
  runList.replaceChildren();
  if (!(await stillCheck())) return;
  // Nucleus docs and the bench: 0x00 = 1, 0x03 = the code, 0x04 = 129, 0x00 = 506, no reply to the last.
  // The drive keeps it and switches at its next power cycle.
  for (const [a, v] of [[0x00, 1], [0x03, BAUD_CODE], [0x04, 129]]) {
    if (!WRITABLE.has(a)) throw new Error('refused');
    const r = await xfer(writeRequest(addr, a, v));
    await sleep(30);
    step(`${h2x(a)} = ${v}: ${r.kind === 'ok' ? 'acknowledged' : 'no acknowledgement'}`, r.kind !== 'ok');
    if (r.kind !== 'ok') {
      step('Stopped. Power-cycle the drive: unsaved values revert. Then find it again; the scan covers every rate.', true);
      say('baud-state', 'Not changed. Power-cycle the drive and find it again.', 'bad');
      return;
    }
  }
  await w(0x00, 506, false);
  say('baud-state', `Sent. Power-cycle the drive now; it comes back at ${TARGET_BAUD} baud. If it still answers at ${linkBaud}, power-cycle it once more. Then check below.`, 'good');
}

async function check() {
  raw = null;
  render0();
  const f = await scan('check-state', [linkBaud]);
  if (!f) {
    say('check-state', stop ? 'Stopped.' : 'No drive answered. Is the motor supply back on? Wait two seconds after power-on, then check again.', stop ? '' : 'bad');
    return;
  }
  addr = f.addr;
  await readAll();
  $('baud-now').textContent = baudNow();
  const d = diff(), ok = ready();
  if (ok && !d.length) say('check-state', `Ready for OpenValence: ${f.baud} baud, address ${f.addr}, every check passes and the preset holds.`, 'good');
  else say('check-state', `Not ready: ${d.length ? d.map(([a, v]) => `${h2x(a)} reads ${raw[a]}, preset ${v}`).join('; ') + '. If the preset values reverted, the save did not hold. ' : ''}See the failed lines; copy the log for support.`, 'bad');
}

async function releaseBtn() {
  runList = $('apply-run');
  runList.replaceChildren();
  await release();
  await readAll();
}

if (!('serial' in navigator)) {
  say('support', window.isSecureContext ? 'This browser has no Web Serial. Open this page in Chrome or Edge on a desktop computer.' : 'Web Serial needs a secure page: open this page over https.', 'bad');
  for (const b of document.querySelectorAll('.tool button')) b.disabled = true;
} else {
  say('support', 'This browser has Web Serial.', 'good');
  $('find').addEventListener('click', () => run(find));
  $('stop').addEventListener('click', () => { stop = true; });
  $('reread').addEventListener('click', () => run(readAll));
  $('release').addEventListener('click', () => run(releaseBtn));
  $('apply').addEventListener('click', () => run(apply, 'apply-state'));
  $('baud').addEventListener('click', () => run(changeBaud, 'baud-state'));
  $('check').addEventListener('click', () => run(check, 'check-state'));
  for (const id of ['ack-apply', 'ack-baud']) $(id).addEventListener('change', refresh);
  $('tuning').addEventListener('change', () => { if (raw) renderDiff(); refresh(); });
  navigator.serial.addEventListener('disconnect', (e) => {
    if (e.target !== port) return;
    log('adapter unplugged');
    port = null; writer = null; reader = null; pumping = null; raw = null;
    render0();
    say('find-state', 'The adapter was unplugged. Plug it in and find the drive again.', 'bad');
    refresh();
  });
  refresh();
}
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lines.join('\n')); $('copy').textContent = 'Copied'; } catch (e) { $('copy').textContent = 'Select and copy by hand'; }
  setTimeout(() => ($('copy').textContent = 'Copy log'), 1500);
});
$('clear').addEventListener('click', () => { lines.length = 0; $('log').textContent = ''; });
