// The web flasher: esptool-js over Web Serial, the device presets and their file slots, the
// write plan, and the session log.
// Constraints:
// - Release images come from this site only (/flash/fw/, same origin, index.json written at
//   deploy by tools/fw_index.py); local files are read in the browser. Both go only to the serial
//   port; the page stores nothing and sends nothing off the computer (privacy.html says so).
// - Erase of the whole chip is never offered on an ESP32-P4, whatever the preset: its NVS holds
//   the hub identity, the trust ledger and pairing.
// - Flash mode, frequency and size stay "keep": the images carry their build's settings, and a
//   changed header would no longer match the image's appended SHA-256.
// - Pre-program Wi-Fi: the SSID, password and hub address stay in the page and go only into the
//   NVS row; no log line or message carries them (the log gets the NVS size and SSID length). The
//   NVS row is written last, after every image, and only from an NVS that nvs.js parsed whole.
import { ESPLoader, Transport } from './vendor/esptool-js/bundle.js';
import { PRESETS, releasesFor, checkFile, customKind, parsePartitions, bootSlot, guessOffset, checkPlan, md5, hex, kb } from './image.js?v=bd65b734d4';
import { baseFor, withWifi, checkNet, blank } from './nvs.js?v=edb7ff98ca';

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
let nvs = null, nvsErr = null, mac = '';   // nvs: the board's NVS partition as read, { addr, data, url }
const SIZE = (s) => { const m = /^(\d+)(KB|MB)/.exec(s || ''); return m ? m[1] * (m[2] === 'MB' ? 1048576 : 1024) : 0; };

async function drop() {
  const t = transport;
  transport = loader = chip = boot = null;
  parts = [];
  flashBytes = 0;
  if (nvs?.url) URL.revokeObjectURL(nvs.url);
  nvs = nvsErr = null;
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
    mac = 'not readable';
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
    if (preset.wifi) await readNvs();
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

// The board's NVS partition, for the Wi-Fi option: kept as read, offered as a backup, logged by
// SHA-256 only.
async function readNvs() {
  const w = preset.wifi, p = parts.find((x) => x.type === 1 && x.subtype === 2);
  nvsErr = null;
  if (parts.some((x) => x.type === 1 && x.subtype === 4)) nvsErr = 'the board has an nvs_keys partition (encrypted NVS)';
  else if (p && (p.offset !== w.addr || p.size !== w.size)) nvsErr = `the board's NVS is at ${hex(p.offset)}, ${kb(p.size)}; this device keeps it at ${hex(w.addr)}, ${kb(w.size)}`;
  if (nvsErr) return log(`NVS: ${nvsErr}`);
  try {
    const data = (await loader.readFlash(w.addr, w.size)).slice(0, w.size);
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
    nvs = { addr: w.addr, data, url: blank(data) ? null : URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' })) };
    log(`NVS ${hex(w.addr)}: ${data.length} bytes${nvs.url ? '' : ', blank'}, sha256 ${sha}`);
  } catch (e) {
    nvsErr = `NVS not read: ${e.message}`;
    log(nvsErr);
  }
}

// The Wi-Fi option against the image rows: { row } to write, { why } to refuse, {} when unused.
function wifiPlan(writes) {
  const w = preset.wifi, ssid = $('ssid').value, pass = $('pass').value, at = $('hub').value.trim();
  if (!w || !ssid) return {};
  const bad = checkNet(ssid, pass);
  if (bad) return { why: bad };
  let hub = null;
  if (w.hub && at) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(at), ip = m ? m.slice(1, 5).map(Number) : [];
    const port = m?.[5] ? Number(m[5]) : 82;   // Nucleus ValenceHub.cpp kWsPort
    if (!m || ip.some((o) => o > 255) || port < 1 || port > 65535) return { why: 'hub address: a.b.c.d or a.b.c.d:port' };
    hub = { ip, port };
  }
  if (!chip) return { wait: true };
  if (nvsErr) return { why: nvsErr };
  try {
    const { base, from } = baseFor(writes, w, nvs?.data);
    const r = withWifi(base, w, ssid, pass, hub);
    return { row: { addr: w.addr, data: r.image, name: 'NVS with Wi-Fi', nvs: true, ssidLen: new TextEncoder().encode(ssid).length }, r, from };
  } catch (e) {
    return { why: e.message };
  }
}

// ---- the preset, its slots and the files ----
let preset = PRESETS.garnet, rows = [], fwIndex = null, srcTicket = 0;
const freshRows = () => {
  const r = preset.slots.map((s) => ({ slot: s, addr: s.addr, data: null, name: '' }));
  return r.length ? r : [{ slot: null, addr: null, data: null, name: '' }];
};

// The release list for this preset; hidden with no index.json (a local preview) or no releases.
function drawReleases() {
  const rels = releasesFor(fwIndex, $('preset').value), sel = $('src');
  sel.replaceChildren(new Option('Local files', ''), ...rels.map((r) => new Option(`${r.product} ${r.version}${r.prerelease ? ', prerelease' : ''}`, r.tag)));
  $('src-row').hidden = !rels.length;
  say('src-state', '');
}

// A release's files into the preset's slots, each checked against its SHA-256 in index.json.
async function pickRelease() {
  const tag = $('src').value, ticket = ++srcTicket;
  rows = freshRows();
  drawRows();
  if (!tag) return say('src-state', '');
  const rel = releasesFor(fwIndex, $('preset').value).find((r) => r.tag === tag);
  say('src-state', `Fetching ${rel.tag}.`);
  const got = freshRows();
  try {
    for (const f of rel.files) {
      const res = await fetch(`/flash/fw/${rel.tag}/${f.name}`);
      if (!res.ok) throw new Error(`${f.name}: HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (sha !== f.sha256) throw new Error(`${f.name}: SHA-256 does not match the release`);
      Object.assign(got.find((r) => r.slot.id === f.role), { data, name: f.name, sha });
      log(`release ${rel.tag}: ${f.name}, ${data.length} bytes, sha256 ${sha}`);
    }
  } catch (e) {
    if (ticket !== srcTicket) return;
    log(`release ${rel.tag}: ${e.message}`);
    return say('src-state', `Fetch failed: ${e.message}.`, 'bad');
  }
  if (ticket !== srcTicket) return;
  rows = got;
  say('src-state', `${rel.product} ${rel.version}${rel.prerelease ? ', prerelease' : ''}: ${rel.files.length} file${rel.files.length === 1 ? '' : 's'}, SHA-256 matched.`, 'good');
  drawRows();
}

function pickPreset() {
  preset = PRESETS[$('preset').value];
  $('baud').value = String(preset.baud);
  $('erase').checked = !!preset.erase;
  $('blank-ota').checked = !!preset.blankOta;
  for (const n of document.querySelectorAll('[data-preset]')) n.hidden = n.dataset.preset !== $('preset').value;
  $('wifi-sec').hidden = !preset.wifi;
  if (chip && preset.wifi && !nvs && !nvsErr && !busy) {
    busy = true;
    readNvs().finally(() => { busy = false; refresh(); });
  }
  srcTicket++;
  rows = freshRows();
  drawReleases();
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
    let file = td(f);
    if (r.sha) {
      file = td(Object.assign(document.createElement('span'), { textContent: r.name }), document.createElement('br'), Object.assign(document.createElement('span'), { className: 'fine sha', textContent: `SHA-256 ${r.sha}` }));
    }
    const st = td();
    st.className = 'chk';
    st.id = `chk-${i}`;
    const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'x', textContent: 'Remove', hidden: !!r.slot });
    rm.addEventListener('click', () => { rows.splice(i, 1); if (!rows.length) rows.push({ slot: null, addr: null, data: null, name: '' }); drawRows(); });
    const at = r.slot ? td(hex(r.addr)) : td(off);
    at.className = 'n';
    const tr = document.createElement('tr');
    tr.append(at, what, file, st, td(rm));
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

// The images by offset, then the Wi-Fi option's NVS row last.
function plan() {
  const writes = rows.filter((r) => r.data).map((r) => ({ addr: r.addr, data: r.data, name: r.name }));
  const ota = rows.find((r) => r.slot?.kind === 'otadata');
  if (ota && !ota.data && $('blank-ota').checked && writes.length) writes.push({ addr: ota.addr, data: new Uint8Array(ota.slot.max).fill(0xff), name: 'blank otadata' });
  writes.sort((a, b) => a.addr - b.addr);
  const wifi = wifiPlan(writes);
  if (wifi.row) writes.push(wifi.row);
  return { writes, wifi };
}

function refresh() {
  const connected = !!chip;
  $('connect').disabled = busy || connected || !('serial' in navigator);
  $('disconnect').hidden = !connected;
  $('disconnect').disabled = busy;
  $('baud').disabled = busy || connected;
  $('preset').disabled = busy;
  $('src').disabled = busy;
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
  const { writes, wifi } = plan();
  let why = null, notes = [];
  if (!connected) why = 'Connect first.';
  else if (preset.chip && chip.name !== preset.chip) why = `The board is ${chip.name}; this preset is for ${preset.chip}.`;
  else {
    const bad = rows.find((r) => rowError(r));
    if (bad) why = `Refused: ${bad.name}: ${rowError(bad)}.`;
    else if (wifi.why) why = `Wi-Fi refused: ${wifi.why}. Clear the SSID to write the images alone.`;
    else {
      const pc = checkPlan(writes, parts);
      if (pc.error) why = pc.error[0].toUpperCase() + pc.error.slice(1) + '.';
      else notes = pc.notes;
    }
  }
  // the Wi-Fi section's status and backup
  if (!$('ssid').value) say('wifi-state', 'Empty SSID: NVS untouched.');
  else if (wifi.wait) say('wifi-state', "Connect to read the board's NVS.");
  else if (wifi.why) say('wifi-state', `Refused: ${wifi.why}. NVS untouched.`, 'bad');
  else if (wifi.r) {
    const r = wifi.r, kept = r.fresh ? (wifi.from === 'image' ? 'fresh NVS: the image blanks it' : 'fresh NVS') : `${r.entries - 1} other entries kept`;
    say('wifi-state', `Slot ${r.slot + 1} of ${r.count}; ${kept}${r.reset ? '; the stored list did not read and starts over' : ''}.`, 'good');
  }
  $('nvs-save').disabled = busy || !nvs?.url;
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
  const { writes } = plan();
  const nv = writes.find((w) => w.nvs);
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
    if (nv) log(`Wi-Fi: ${nv.data.length} bytes NVS written, SSID length ${nv.ssidLen}`);
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
$('src').addEventListener('change', pickRelease);
$('add').addEventListener('click', () => { rows.push({ slot: null, addr: null, data: null, name: '' }); drawRows(); });
for (const id of ['erase', 'blank-ota', 'ack']) $(id).addEventListener('change', refresh);
for (const id of ['ssid', 'pass', 'hub']) $(id).addEventListener('input', refresh);
$('pass-show').addEventListener('click', () => {
  const show = $('pass').type === 'password';
  $('pass').type = show ? 'text' : 'password';
  $('pass-show').textContent = show ? 'Hide' : 'Show';
  $('pass-show').setAttribute('aria-pressed', String(show));
});
$('nvs-save').addEventListener('click', () => {
  if (!nvs?.url) return;
  const name = `nvs-${String(mac).replace(/[^0-9a-f]/gi, '') || 'board'}-${hex(nvs.addr)}.bin`;
  Object.assign(document.createElement('a'), { href: nvs.url, download: name }).click();
  log(`NVS backup saved: ${nvs.data.length} bytes`);
});
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
fetch('/flash/fw/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => { fwIndex = j; drawReleases(); }).catch(() => {});
