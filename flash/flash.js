// The web flasher: esptool-js over Web Serial, the device presets and their file slots, the
// write plan, and the session log.
// Constraints:
// - Files are read in the browser and go only to the serial port; the page stores nothing and
//   sends nothing off the computer (privacy.html says so).
// - Erase of the whole chip is never offered on an ESP32-P4, whatever the preset: its NVS holds
//   the hub identity, the trust ledger and pairing.
// - Flash mode, frequency and size stay "keep": the images carry their build's settings, and a
//   changed header would no longer match the image's appended SHA-256.
import { ESPLoader, Transport } from './vendor/esptool-js/bundle.js';
import { PRESETS, checkFile, customKind, parsePartitions, bootSlot, guessOffset, checkPlan, md5, hex, kb } from './image.js';

const $ = (id) => document.getElementById(id);

// ---- the log ----
const t0 = performance.now();
const lines = [];
function log(text) {
  const t = ((performance.now() - t0) / 1000).toFixed(3).padStart(9);
  for (const s of String(text).split(/\r?\n/)) {
    if (!s.trim()) continue;
    // esptool-js logs every block; keep only the newest "Writing at" line of a run
    if (s.startsWith('Writing at') && lines.length && lines[lines.length - 1].includes('Writing at')) lines.pop();
    lines.push(`${t} s  ${s}`);
  }
  if (lines.length > 4000) lines.splice(0, lines.length - 4000);
  const box = $('log');
  box.textContent = lines.join('\n');
  box.scrollTop = box.scrollHeight;
}
const terminal = { clean() {}, writeLine: log, write: log };

function say(id, text, tone) {
  const e = $(id);
  e.textContent = text;
  e.className = 'state' + (tone ? ' ' + tone : '');
}

// ---- the board ----
let transport = null, loader = null, chip = null, flashBytes = 0, parts = [], boot = null, busy = false, cancel = false;
const SIZE = (s) => { const m = /^(\d+)(KB|MB)/.exec(s || ''); return m ? m[1] * (m[2] === 'MB' ? 1048576 : 1024) : 0; };

async function drop() {
  const t = transport;
  transport = loader = chip = boot = null;
  parts = [];
  flashBytes = 0;
  if (t) try { await t.disconnect(); } catch (e) {}
  $('info').hidden = true;
  refresh();
}

async function connect() {
  let port;
  try { port = await navigator.serial.requestPort(); } catch (e) { return; }
  busy = true;
  $('boot-help').hidden = true;
  refresh();
  say('conn-state', 'Connecting: resetting the board into download mode.');
  transport = new Transport(port, false);
  loader = new ESPLoader({ transport, baudrate: Number($('baud').value), romBaudrate: 115200, terminal });
  try {
    const desc = await loader.main('default_reset');
    const c = loader.chip;
    chip = { name: c.CHIP_NAME, imageChipId: c.IMAGE_CHIP_ID, bootOffset: c.BOOTLOADER_FLASH_OFFSET };
    let mac = 'not readable';
    try { mac = await c.readMac(loader); } catch (e) {}
    const fs = await loader.detectFlashSize();
    flashBytes = SIZE(fs);
    try {
      parts = parsePartitions(await loader.readFlash(0x8000, 0xc00));
      const od = parts.find((p) => p.type === 1 && p.subtype === 0);
      if (od) boot = bootSlot(await loader.readFlash(od.offset, 0x2000), parts);
    } catch (e) {
      log(`partition table not read: ${e.message}`);
    }
    $('i-chip').textContent = desc;
    $('i-mac').textContent = mac;
    $('i-flash').textContent = flashBytes ? kb(flashBytes) : 'unknown';
    $('i-pt').textContent = parts.length ? parts.map((p) => `${p.label} ${hex(p.offset)}`).join(', ') : 'none at 0x8000';
    $('i-boot').textContent = boot ? boot.text + (boot.notes.length ? `; ${boot.notes.join(', ')} (rolled back)` : '') : 'no otadata';
    $('info').hidden = false;
    log(`connected: ${chip.name}, MAC ${mac}, flash ${fs || 'unknown'}, ${parts.length} partitions`);
    say('conn-state', `Connected: ${chip.name}.`, 'good');
  } catch (e) {
    log(`error: ${e.message}`);
    say('conn-state', `No answer: ${e.message}. Put the board in download mode and connect again.`, 'bad');
    $('boot-help').hidden = false;
    busy = false;
    await drop();
    return;
  }
  busy = false;
  refresh();
}

// ---- the preset, its slots and the files ----
let preset = PRESETS.garnet, rows = [];

function pickPreset() {
  preset = PRESETS[$('preset').value];
  $('baud').value = String(preset.baud);
  $('erase').checked = !!preset.erase;
  $('blank-ota').checked = !!preset.blankOta;
  for (const n of document.querySelectorAll('[data-preset]')) n.hidden = n.dataset.preset !== $('preset').value;
  rows = preset.slots.map((s) => ({ slot: s, addr: s.addr, data: null, name: '' }));
  if (!rows.length) rows.push({ slot: null, addr: null, data: null, name: '' });
  drawRows();
}

function drawRows() {
  const body = $('files').tBodies[0];
  body.replaceChildren();
  rows.forEach((r, i) => {
    const td = (...kids) => { const c = document.createElement('td'); c.append(...kids); return c; };
    let off = null;
    if (!r.slot) {
      off = Object.assign(document.createElement('input'), { type: 'text', className: 'off', value: r.addr === null ? '' : hex(r.addr), placeholder: '0x10000', spellcheck: false });
      off.setAttribute('list', 'offsets');
      off.setAttribute('aria-label', 'Offset');
      off.addEventListener('input', () => { const v = off.value.trim(); r.addr = /^(0x)?[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : null; refresh(); });
    }
    const what = document.createElement('td');
    what.innerHTML = r.slot ? `${r.slot.label}<br><span class="fine">${r.slot.hint}</span>` : 'File';
    const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.bin,application/octet-stream' });
    f.setAttribute('aria-label', r.slot ? r.slot.label : 'File');
    f.addEventListener('change', async () => {
      const file = f.files[0];
      r.data = file ? new Uint8Array(await file.arrayBuffer()) : null;
      r.name = file ? file.name : '';
      if (file) log(`file: ${file.name}, ${file.size} bytes`);
      if (file && off && r.addr === null && chip) {
        r.addr = guessOffset(file.name, chip, parts);
        if (r.addr !== null) off.value = hex(r.addr);
      }
      refresh();
    });
    const st = td();
    st.className = 'chk';
    st.id = `chk-${i}`;
    const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'x', textContent: 'Remove', hidden: !!r.slot });
    rm.addEventListener('click', () => { rows.splice(i, 1); if (!rows.length) rows.push({ slot: null, addr: null, data: null, name: '' }); drawRows(); });
    const at = r.slot ? td(hex(r.addr)) : td(off);
    at.className = 'n';
    const tr = document.createElement('tr');
    tr.append(at, what, td(f), st, td(rm));
    body.append(tr);
  });
  refresh();
}

// One row's refusal, or null. Needs the board for the chip checks.
function rowError(r) {
  if (!r.data) return null;
  if (r.addr === null) return 'set an offset';
  const kind = r.slot ? r.slot.kind : customKind(r.data, r.addr, chip);
  return checkFile(r.data, r.addr, kind, chip, flashBytes, r.slot?.max, r.slot?.ptAt);
}

function plan() {
  const writes = rows.filter((r) => r.data).map((r) => ({ addr: r.addr, data: r.data, name: r.name }));
  const ota = rows.find((r) => r.slot?.kind === 'otadata');
  if (ota && !ota.data && $('blank-ota').checked && writes.length) writes.push({ addr: ota.addr, data: new Uint8Array(ota.slot.max).fill(0xff), name: 'blank otadata' });
  return writes.sort((a, b) => a.addr - b.addr);
}

function refresh() {
  const connected = !!chip;
  $('connect').disabled = busy || connected || !('serial' in navigator);
  $('disconnect').hidden = !connected;
  $('disconnect').disabled = busy;
  $('baud').disabled = busy || connected;
  $('preset').disabled = busy;
  const p4 = chip?.name === 'ESP32-P4';
  $('erase-row').hidden = preset.erase === null || p4;
  if ($('erase-row').hidden) $('erase').checked = false;
  $('add').hidden = preset !== PRESETS.custom;

  // per-row status
  rows.forEach((r, i) => {
    const c = $(`chk-${i}`);
    if (!c) return;
    const err = connected ? rowError(r) : null;
    c.textContent = !r.data ? '' : err ? err : connected ? `${kb(r.data.length)}, checked` : `${kb(r.data.length)}; connect to check`;
    c.className = 'chk' + (err ? ' bad' : r.data && connected ? ' good' : '');
  });
  // the offsets list for custom rows: the chip's bootloader offset and the board's partitions
  const dl = $('offsets');
  dl.replaceChildren();
  const opts = connected ? [[chip.bootOffset, 'bootloader'], [0x8000, 'partition table'], ...parts.map((p) => [p.offset, p.label])] : [];
  for (const [o, l] of opts) dl.append(Object.assign(document.createElement('option'), { value: hex(o), label: l }));

  // the plan and the gate
  const list = $('plan');
  list.replaceChildren();
  const writes = plan();
  let why = null, notes = [];
  if (!connected) why = 'Connect first.';
  else if (preset.chip && chip.name !== preset.chip) why = `The board is ${chip.name}; this preset is for ${preset.chip}.`;
  else {
    const bad = rows.find((r) => rowError(r));
    if (bad) why = `Refused: ${bad.name}: ${rowError(bad)}.`;
    else {
      const pc = checkPlan(writes, parts);
      if (pc.error) why = pc.error[0].toUpperCase() + pc.error.slice(1) + '.';
      else notes = pc.notes;
    }
  }
  if (connected && !why && preset === PRESETS.p4 && boot?.slot === 'ota_1' && writes.some((w) => w.addr === 0x20000) && !writes.some((w) => w.addr === 0xf000)) {
    notes.push('otadata selects ota_1: the board keeps booting ota_1, not this app. Tick the blank otadata box.');
  }
  if ($('erase').checked && !$('erase-row').hidden) list.append(Object.assign(document.createElement('li'), { textContent: 'Erase the whole flash' }));
  for (const w of writes) list.append(Object.assign(document.createElement('li'), { textContent: `${hex(w.addr).padEnd(9)} ${w.name}, ${w.data.length} bytes` }));
  for (const n of notes) list.append(Object.assign(document.createElement('li'), { className: 'bad', textContent: n }));
  if (writes.length) list.append(Object.assign(document.createElement('li'), { textContent: 'Verify each write by MD5, then hard reset' }));
  if (!busy) say('write-state', why || (notes.length ? 'Ready, with the warnings above.' : 'Ready.'), why ? '' : 'good');
  $('write').disabled = busy || !!why || !$('ack').checked;
  $('cancel').hidden = !busy || !connected;
}

// ---- the write ----
async function write() {
  const writes = plan();
  busy = true;
  cancel = false;
  $('cancel').disabled = false;
  refresh();
  const bar = $('bar');
  bar.hidden = false;
  bar.value = 0;
  let current = '';
  try {
    if ($('erase').checked && !$('erase-row').hidden) say('write-state', 'Erasing the whole flash. This takes up to a minute.');
    await loader.writeFlash({
      fileArray: writes.map((w) => ({ data: w.data, address: w.addr })),
      flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', compress: true,
      eraseAll: $('erase').checked && !$('erase-row').hidden,
      reportProgress: (i, done, total) => {
        if (cancel) throw new Error('cancelled');
        current = writes[i].name;
        const pct = total ? Math.floor((100 * done) / total) : 0;
        bar.value = (i + done / (total || 1)) / writes.length;
        say('write-state', `Writing ${i + 1} of ${writes.length}: ${current}, ${pct} %`);
      },
      calculateMD5Hash: md5,
    });
    say('write-state', 'Written and verified. Resetting.');
    await loader.after('hard_reset');
    log('hard reset');
    busy = false;
    await drop();
    say('write-state', 'Written, verified and reset. Port closed.', 'good');
  } catch (e) {
    busy = false;
    log(`${cancel ? 'cancelled' : 'error'}: ${e.message}`);
    if (cancel) say('write-state', `Cancelled during ${current}. That region holds a partial image: write it again before the board resets.`, 'bad');
    else say('write-state', `Write failed: ${e.message}. Copy the log for support.`, 'bad');
    refresh();
  }
  bar.hidden = true;
}

// ---- the page ----
if (!('serial' in navigator)) {
  say('support', window.isSecureContext ? 'This browser has no Web Serial. Open this page in Chrome or Edge on a desktop computer.' : 'Web Serial needs a secure page: open this page over https.', 'bad');
} else {
  say('support', 'This browser has Web Serial.', 'good');
  navigator.serial.addEventListener('disconnect', (e) => {
    if (!transport || e.target !== transport.device) return;
    log('port gone');
    drop();
  });
}
$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => { log('disconnected'); drop(); say('conn-state', 'Port closed.'); });
$('preset').addEventListener('change', pickPreset);
$('add').addEventListener('click', () => { rows.push({ slot: null, addr: null, data: null, name: '' }); drawRows(); });
for (const id of ['erase', 'blank-ota', 'ack']) $(id).addEventListener('change', refresh);
$('write').addEventListener('click', write);
$('cancel').addEventListener('click', () => { cancel = true; $('cancel').disabled = true; say('write-state', 'Cancelling after this block.'); });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lines.join('\n')); $('copy').textContent = 'Copied'; } catch (e) {
    getSelection().selectAllChildren($('log'));
    $('copy').textContent = 'Selected: press Ctrl+C';
  }
  setTimeout(() => ($('copy').textContent = 'Copy log'), 2000);
});
$('clear').addEventListener('click', () => { lines.length = 0; $('log').textContent = ''; });
pickPreset();
