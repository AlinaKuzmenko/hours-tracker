const $app = document.getElementById('app');
const $status = document.getElementById('status');
const $alert = document.getElementById('alert');
const { t, has, LANG } = I18N;
const L = P.forLang(LANG);
const { iso, addDays } = P;

let state = { people: [], entries: [] };
let view = 'add';
let report = { mode: 'thisWeek', personId: 'self' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const personRole = (id) => (state.people.find((p) => p.id === id) || {}).role || '';
const personName = (id) => (id === 'self' ? t('me') : (state.people.find((p) => p.id === id) || { name: '?' }).name);
const $ = (id) => $app.querySelector('#' + id);

// Messages for screen readers (polite status / assertive alert). Cleared first so repeated text is announced again.
function say(text) { $status.textContent = ''; setTimeout(() => { $status.textContent = text; }, 50); }
const $toast = document.getElementById('toast');
let toastTimer;
// Warnings are also shown on screen (a banner at the bottom, tap to dismiss), not only announced.
function warn(text) {
  $alert.textContent = '';
  setTimeout(() => { $alert.textContent = text; }, 50);
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 9000);
}
$toast.onclick = () => { $toast.hidden = true; };
const errText = (e) => (has('err.' + e.message) ? t('err.' + e.message) : t('err.generic'));

// Moving focus right after the keyboard closes makes screen readers jump around, so wait a moment.
function focusSoon(el, ms = 400) { setTimeout(() => el && el.isConnected && el.focus(), ms); }

async function call(method, url, data) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.error === 'auth') { renderLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error(j.error || 'server_error');
  return j;
}
async function refresh() { state = await call('GET', '/api/data'); }
function focusHeading() { const h = $app.querySelector('h1'); if (h) { h.tabIndex = -1; h.focus(); } }

// Accessible confirmation dialog (native <dialog>: focus trap, Esc to cancel, background made inert).
// Focus moves to the info paragraph so a screen reader reads it as soon as the dialog opens.
function confirmDialog({ title, lines = [], detail, okLabel, okClass = 'danger-solid', opener }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-labelledby', 'dlg-info');
    // One single element (lines separated by <br>, with hidden commas for pauses), so a screen reader reads it all in one go.
    const parts = [`<span class="dlg-title">${esc(title)}</span>`, ...lines.map((l) => `<span class="dlg-line">${esc(l)}</span>`), ...(detail ? [`<span class="dlg-detail">${esc(detail)}</span>`] : [])];
    // A blank line (two <br>) before the detail keeps it visually apart while staying one inline text run.
    d.innerHTML = `<p id="dlg-info" tabindex="-1">${parts.map((p, i) => (i === 0 ? p : (detail && i === parts.length - 1 ? '<span class="pause">. </span><br><br>' : '<span class="pause">, </span><br>') + p)).join('')}</p>
      <div class="dlg-actions">
        <button type="button" class="secondary" data-act="cancel">${esc(t('dlg.cancel'))}</button>
        <button type="button" class="${okClass}" data-act="ok">${esc(okLabel)}</button>
      </div>`;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      d.remove();
      if (!ok && opener) focusSoon(opener, 0); // after the browser's own focus restore
      resolve(ok);
    };
    d.querySelector('[data-act=cancel]').onclick = () => finish(false);
    d.querySelector('[data-act=ok]').onclick = () => finish(true);
    d.addEventListener('cancel', () => finish(false)); // Esc
    d.addEventListener('close', () => finish(false));
    document.body.appendChild(d);
    d.showModal();
    d.querySelector('#dlg-info').focus();
  });
}

// Blocks repeated taps while a request runs and shows a loader. Uses aria-disabled (not `disabled`)
// so the button keeps keyboard/screen-reader focus; screen readers announce it as "dimmed".
async function withBusy(btn, label, fn) {
  if (btn.getAttribute('aria-disabled') === 'true') return;
  const icon = btn.classList.contains('icon'); // icon buttons keep their picture; they only dim and spin
  const orig = btn.innerHTML;
  btn.setAttribute('aria-disabled', 'true');
  btn.setAttribute('aria-busy', 'true');
  if (!icon) btn.textContent = label;
  say(label);
  try { return await fn(); } finally {
    if (btn.isConnected) { btn.removeAttribute('aria-disabled'); btn.removeAttribute('aria-busy'); btn.innerHTML = orig; }
  }
}

// ---------- voice input ----------
// A microphone button next to a text field: tap, speak, and the text lands in the field, so the keyboard
// never has to open. Uses the browser's speech recognition (Chrome, Safari); where it is missing the buttons are not shown.
const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LANG = { de: 'de-DE', en: 'en-GB', uk: 'uk-UA' }[LANG];
const ICON_MIC = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let micStop = null; // finishes the running recording and uses what it heard
// Safari on iPhone often gives a second recording no sound when a new recogniser object is created for it,
// so one object is reused for the whole page; a fresh one is only made while the shared one is still busy.
let sharedRec = null;
let sharedBusy = false;
let micAbort = null; // cancels the running recording and drops what it heard (clear button, closing a dialog)

// A text field with a mic button. `submitForm` (optional) is the id of a form to submit when speaking has finished.
// Every such field also gets a clear (x) button, for when the text was recognised badly.
// With `mic: false` only the clear button is added (the main mic button is elsewhere).
function fieldWithMic(inputHtml, id, label, submitForm, mic = true) {
  const clear = `<button type="button" class="clear" data-clear="${id}" aria-label="${esc(t('clear.aria', { field: label }))}">${ICON_CLEAR}</button>`;
  const micBtn = mic && getSR() ? `<button type="button" class="mic" data-mic="${id}" ${submitForm ? `data-submit="${submitForm}"` : ''} data-field="${esc(label)}" aria-pressed="false" aria-label="${esc(t('mic.start', { field: label }))}">${ICON_MIC}</button>` : '';
  return `<div class="with-mic ${micBtn ? 'has-mic' : ''}">${inputHtml}${clear}${micBtn}</div>`;
}
// The main way to enter data: a large mic button. The text field stays available for typing.
function bigMic(id, label, submitForm) {
  if (!getSR()) return '';
  return `<button type="button" class="mic mic-big" data-mic="${id}" data-big="1" ${submitForm ? `data-submit="${submitForm}"` : ''} data-field="${esc(label)}" aria-pressed="false" aria-label="${esc(t('mic.start', { field: label }))}">${ICON_MIC}<span class="mic-text">${esc(t('mic.speak'))}</span></button><p id="micTrail" class="mic-trail" aria-hidden="true"></p>`;
}
// Does the sentence already say how long? Then it can be recognised (a missing person or date is handled there).
function isCompleteSentence(text) {
  return !!L.parseSentence(text, state.people).minutes;
}

function bindMics(root) {
  root.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.onclick = () => {
      const input = root.querySelector('#' + btn.dataset.clear);
      if (micAbort) micAbort(); // a recording in progress must not write the text back
      input.value = '';
      say(t('clear.done')); // focus stays on the button, so the keyboard does not open
    };
  });
  root.querySelectorAll('[data-mic]').forEach((btn) => {
    const input = root.querySelector('#' + btn.dataset.mic);
    const startLabel = t('mic.start', { field: btn.dataset.field });
    const setListening = (on) => {
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('listening', on);
      btn.setAttribute('aria-label', on ? t('mic.stop') : startLabel);
      const text = btn.querySelector('.mic-text');
      if (text) text.textContent = on ? t('mic.stop') : t('mic.speak');
    };
    btn.onclick = () => {
      // Tapping the button while it is recording finishes the recording (and uses the text).
      if (btn.classList.contains('listening') && micStop) { micStop(); return; }
      if (micAbort) micAbort(); // never two recordings at once (Safari then refuses to start the new one)
      let rec;
      if (sharedRec && !sharedBusy) rec = sharedRec;
      else { rec = new (getSR())(); if (!sharedRec) sharedRec = rec; }
      const isShared = rec === sharedRec;
      if (isShared) sharedBusy = true;
      rec.lang = SPEECH_LANG;
      rec.interimResults = true;
      // A pause while thinking should not end the recording. If continuous mode has failed before on this device,
      // the plain mode is used instead (remembered for this browser session).
      let plain = false;
      try { plain = sessionStorage.getItem('micPlain') === '1'; } catch {}
      rec.continuous = !plain;
      rec.maxAlternatives = 1;
      const base = input.value.trim(); // what is already in the field stays; speech is appended to it
      let heard = '';
      let discarded = false, manualStop = false, failed = false;
      // Diagnostics: a short trail of what the recogniser did, shown under the button so it can be reported.
      const trailEl = root.querySelector('#micTrail');
      const t0 = Date.now(), trail = [];
      const mark = (name) => { trail.push(`${name} ${((Date.now() - t0) / 1000).toFixed(1)}`); if (trailEl) trailEl.textContent = `${rec.continuous ? 'continuous' : 'plain'}: ${trail.join(' › ')}`; };
      let sawSound = false, watchdog = null;
      rec.onstart = () => mark('start');
      rec.onaudiostart = () => {
        mark('audiostart');
        // The microphone opened but no sound arrives at all (e.g. Bluetooth headphones grabbing the input): say so instead of waiting forever.
        watchdog = setTimeout(() => { if (!sawSound && !discarded && micAbort === abort) { mark('silent'); warn(t('mic.silent')); abort(); } }, 6000);
      };
      rec.onsoundstart = () => { sawSound = true; mark('soundstart'); };
      rec.onspeechstart = () => { sawSound = true; mark('speechstart'); };
      rec.onspeechend = () => mark('speechend');
      rec.onsoundend = () => mark('soundend');
      rec.onaudioend = () => mark('audioend');
      rec.onnomatch = () => mark('nomatch');
      mark('tap');
      rec.onresult = (e) => {
        if (discarded) return;
        sawSound = true;
        if (!trail.some((x) => x.startsWith('result'))) mark('result');
        heard = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
        input.value = (base ? base + ' ' : '') + heard;
      };
      rec.onerror = (e) => {
        mark(`error:${e.error}`);
        if (rec.continuous && e.error !== 'aborted') { try { sessionStorage.setItem('micPlain', '1'); } catch {} }
        const key = { 'not-allowed': 'mic.denied', 'service-not-allowed': 'mic.denied', 'no-speech': 'mic.nothing', 'audio-capture': 'mic.noMic' }[e.error];
        // Chrome/Firefox/Edge on iPhone are not allowed to use speech recognition even when the microphone is switched on in Settings.
        const iosOtherBrowser = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
        if (e.error !== 'aborted' && !discarded) { failed = true; warn(iosOtherBrowser && (key === 'mic.denied' || !key) ? t('mic.iosBrowser') : `${t(key || 'mic.failed')} (${e.error})`); }
      };
      const release = () => { if (micStop === stop) micStop = null; if (micAbort === abort) micAbort = null; };
      rec.onend = () => {
        clearTimeout(watchdog);
        if (isShared) sharedBusy = false;
        mark('end');
        if (rec.continuous && !heard && !discarded && !manualStop) { try { sessionStorage.setItem('micPlain', '1'); } catch {} } // nothing came out of continuous mode: use plain mode next time
        setListening(false);
        release();
        if (discarded || failed) return;
        if (!heard) return warn(t('mic.nothing'));
        if (btn.dataset.submit) {
          // After a manual stop the sentence is used as it is. If the recording ended by itself (a long pause)
          // an unfinished sentence is kept and the user is asked to continue instead of showing an error.
          if (manualStop || isCompleteSentence(input.value)) { const f = root.querySelector('#' + btn.dataset.submit); if (f) f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
          else warn(t('mic.paused'));
        }
      };
      const stop = () => { manualStop = true; try { rec.stop(); } catch {} };
      const abort = () => { discarded = true; clearTimeout(watchdog); try { rec.abort(); } catch { try { rec.stop(); } catch {} } setListening(false); release(); };
      micStop = stop;
      micAbort = abort;
      setListening(true);
      // Must be started right inside the tap: Safari on iPhone refuses to start recognition later (e.g. from a timer).
      try { rec.start(); } catch (err) { abort(); if (isShared) sharedBusy = false; warn(`${t('mic.failed')} (${err.name || 'start'})`); }
    };
  });
}

// ---------- login ----------
function renderLogin() {
  document.title = t('login.title');
  const err = new URLSearchParams(location.search).get('login_error');
  const msg = { denied: t('login.denied'), failed: t('login.failed') }[err];
  $app.innerHTML = `
    <h1>${esc(t('login.title'))}</h1>
    ${msg ? `<p class="msg" role="alert">${esc(msg)}</p>` : ''}
    <button id="google">${esc(t('login.google'))}</button>
    <p class="hint">${esc(t('login.hint'))}</p>`;
  $('google').onclick = (e) => {
    const b = e.currentTarget;
    if (b.getAttribute('aria-disabled') === 'true') return;
    b.setAttribute('aria-disabled', 'true');
    b.setAttribute('aria-busy', 'true');
    b.textContent = t('login.redirecting');
    location.href = '/api/auth/google';
  };
  focusHeading();
}

// ---------- shell ----------
// `first` (optional) is the content of a full-height first screen together with the menu and heading;
// `inner` is everything after it.
function shell(title, inner, first) {
  document.title = title;
  const nav = [['add', t('nav.add')], ['report', t('nav.reports')], ['people', t('nav.people')]]
    .map(([k, n]) => `<button class="secondary" data-nav="${k}" ${view === k ? 'aria-current="page"' : ''}>${esc(n)}</button>`).join('');
  // Sign out lives only at the bottom of the main (Add hours) page, away from the menu, and asks for confirmation.
  const top = `<nav aria-label="${esc(t('nav.label'))}">${nav}</nav>
    <h1>${esc(title)}</h1>`;
  $app.innerHTML = `${first === undefined ? top : `<div class="screen">${top}${first}</div>`}${inner}
    ${view === 'add' ? `<footer><button class="orange" id="logout">${esc(t('nav.logout'))}</button></footer>` : ''}`;
  $app.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
  bindMics($app);
  if ($('logout')) $('logout').onclick = async (e) => {
    const b = e.currentTarget;
    if (!(await confirmDialog({ title: t('dlg.logoutTitle'), detail: t('dlg.logoutDetail'), okLabel: t('nav.logout'), okClass: 'orange', opener: b }))) return;
    await call('POST', '/api/logout').catch(() => {});
    renderLogin();
  };
}
async function go(v) {
  view = v;
  await refresh();
  render();
  focusHeading();
}
function render() { ({ add: renderAdd, report: renderReport, people: renderPeople })[view](); }

// ---------- custom dropdown ----------
// A button that opens a dialog with the options (radio buttons). Looks the same everywhere and is
// predictable for screen readers; the page behind the dialog is inert.
function pickDialog({ title, options, value, opener }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.setAttribute('aria-label', title);
    d.innerHTML = `<div role="radiogroup" aria-label="${esc(title)}" class="picker-options">
        ${options.map((o) => `<button type="button" role="radio" aria-checked="${o.value === value}" data-value="${esc(o.value)}"><span>${esc(o.text)}</span></button>`).join('')}
      </div>
      <div class="dlg-actions"><button type="button" class="secondary" data-act="cancel">${esc(t('dlg.cancel'))}</button></div>`;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      d.remove();
      if (opener) focusSoon(opener, 0);
      resolve(v);
    };
    const radios = [...d.querySelectorAll('[role=radio]')];
    radios.forEach((r) => {
      r.onclick = () => finish(r.dataset.value);
      r.onkeydown = (e) => {
        const i = radios.indexOf(r);
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); radios[(i + 1) % radios.length].focus(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); radios[(i - 1 + radios.length) % radios.length].focus(); }
      };
    });
    d.querySelector('[data-act=cancel]').onclick = () => finish(null);
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('close', () => finish(null));
    document.body.appendChild(d);
    d.showModal();
    (radios.find((r) => r.getAttribute('aria-checked') === 'true') || radios[0]).focus();
  });
}
function pickerHtml(id, label, options, value) {
  const cur = options.find((o) => o.value === value) || options[0];
  return `<span class="field-label" id="${id}-lbl">${esc(label)}</span>
    <button type="button" class="picker" id="${id}" aria-haspopup="dialog" aria-labelledby="${id}-lbl ${id}" data-value="${esc(cur.value)}">${esc(cur.text)}</button>`;
}
function makePicker(root, id, label, options) {
  const btn = root.querySelector('#' + id);
  const set = (v) => { const o = options.find((x) => x.value === v); if (o) { btn.dataset.value = o.value; btn.textContent = o.text; } };
  btn.onclick = async () => { const v = await pickDialog({ title: label, options, value: btn.dataset.value, opener: btn }); if (v != null) set(v); };
  return { get: () => btn.dataset.value, text: () => btn.textContent, set, el: btn };
}
const personOptions = () => state.people.map((p) => ({ value: p.id, text: personName(p.id) }));

// ---------- number stepper ----------
// A number field with - / + buttons. Also: arrow keys, and dragging up/down on touch screens.
// The value is always kept within min..max.
function stepperHtml(id, label, min, max, value, big = 1) {
  return `<label for="${id}">${esc(label)}</label>
    <div class="stepper">
      <button type="button" class="step" data-step="-1" data-for="${id}" aria-label="${esc(t('step.less', { field: big > 1 ? `${label} (${big})` : label }))}">&minus;</button>
      <input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${value}" data-big="${big}">
      <button type="button" class="step" data-step="1" data-for="${id}" aria-label="${esc(t('step.more', { field: big > 1 ? `${label} (${big})` : label }))}">+</button>
    </div>`;
}
function makeStepper(root, id) {
  const input = root.querySelector('#' + id);
  const min = Number(input.min), max = Number(input.max);
  const big = Number(input.dataset.big || 1); // the +/- buttons and dragging move in steps of this size (5 for minutes)
  const clamp = (n) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));
  // Next value in a direction; with a coarse step it snaps to the grid (12 -> 15 or 10).
  const nudge = (n, dir) => (big > 1 ? (dir > 0 ? Math.floor(n / big) * big + big : Math.ceil(n / big) * big - big) : n + dir);
  const setVal = (n) => { input.value = clamp(n); input.dispatchEvent(new Event('change', { bubbles: true })); };
  const fit = () => { input.value = clamp(input.value); };
  input.addEventListener('blur', fit);
  input.addEventListener('change', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); setVal(Number(input.value) + 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setVal(Number(input.value) - 1); }
  });
  root.querySelectorAll(`.step[data-for="${id}"]`).forEach((b) => {
    let timer;
    const bump = () => setVal(nudge(Number(input.value), Number(b.dataset.step)));
    b.onclick = (e) => { if (e.detail === 0 || !b._held) bump(); b._held = false; }; // keyboard / screen reader activation
    b.onpointerdown = (e) => { // press and hold repeats
      b._held = false;
      timer = setTimeout(function tick() { b._held = true; bump(); timer = setTimeout(tick, 120); }, 450);
    };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
  });
  // Drag up/down on the field to change the value (touch and pen only, so the mouse can still select text).
  let startY = null, startVal = 0, dragging = false;
  input.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; startY = e.clientY; startVal = Number(input.value) || 0; dragging = false; });
  input.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = startY - e.clientY;
    if (!dragging && Math.abs(dy) < 10) return;
    dragging = true;
    input.blur();
    let v = startVal;
    for (let i = 0, n = Math.abs(Math.round(dy / 24)); i < n; i++) v = clamp(nudge(v, dy > 0 ? 1 : -1));
    input.value = clamp(v);
  });
  const end = () => { if (dragging) input.dispatchEvent(new Event('change', { bubbles: true })); startY = null; dragging = false; };
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
  return input;
}
// 24 hours is the most; with 24 hours there can be no extra minutes.
function limitDuration(hEl, mEl) {
  const fix = () => { if (Number(hEl.value) >= 24) mEl.value = 0; };
  hEl.addEventListener('change', fix);
  mEl.addEventListener('change', fix);
  mEl.addEventListener('input', () => { if (Number(hEl.value) >= 24) mEl.value = 0; });
}

// Date picker shared by the add form and the edit dialog: a native date field (opens the device calendar).
function whenHtml(pre) {
  return `<label for="${pre}when">${esc(t('add.date'))}</label>
    <input id="${pre}when" type="date" value="${iso(new Date())}">`;
}
function makeWhen(root, pre) {
  const input = root.querySelector('#' + pre + 'when');
  return { get: () => input.value || null, set: (date) => { input.value = date; } };
}

const ICON_EDIT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>';

// One entry as a card: the text is a single element (one screen-reader stop), with small pencil / trash buttons beside it.
function entryLi(e, withPerson) {
  const parts = [...(withPerson ? [`<span class="e-name">${esc(personName(e.personId))}</span>`] : []), `<span>${esc(L.fmtDate(e.date))}</span>`, `<span class="e-dur">${esc(L.fmtDuration(e.minutes))}</span>`];
  const label = `${withPerson ? personName(e.personId) + ', ' : ''}${L.fmtDate(e.date)}: ${L.fmtDuration(e.minutes)}`;
  return `<li class="card entry"><p class="entry-text">${parts.join('<span class="pause">, </span><br>')}</p>
    <div class="entry-actions">
      <button class="icon secondary" data-edit="${e.id}" title="${esc(t('entry.edit'))}" aria-label="${esc(t('entry.editAria', { label }))}">${ICON_EDIT}</button>
      <button class="icon danger" data-del="${e.id}" title="${esc(t('entry.delete'))}" aria-label="${esc(t('entry.deleteAria', { label }))}">${ICON_DELETE}</button>
    </div></li>`;
}

// Edit dialog. `save(values)` must throw on failure; its message is shown inside the dialog
// (the page behind a modal is inert, so the global live regions would not be read).
function editDialog(e, opener, save) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.setAttribute('aria-labelledby', 'dlg-info');
    d.innerHTML = `<form id="ef">
      <h2 id="dlg-info" tabindex="-1">${esc(t('dlg.editEntry'))}</h2>
      ${pickerHtml('e-who', t('add.who'), personOptions(), e.personId)}
      ${whenHtml('e-')}
      ${stepperHtml('e-h', t('add.hours'), 0, 24, Math.floor(e.minutes / 60))}
      ${stepperHtml('e-m', t('add.minutes'), 0, 59, e.minutes % 60, 5)}
      <p id="e-err" class="msg" role="alert" hidden></p>
      <div class="dlg-actions">
        <button type="button" class="secondary" data-act="cancel">${esc(t('dlg.cancel'))}</button>
        <button type="submit" id="e-save">${esc(t('dlg.save'))}</button>
      </div></form>`;
    const q = (id) => d.querySelector('#' + id);
    const when = makeWhen(d, 'e-');
    when.set(e.date);
    const who = makePicker(d, 'e-who', t('add.who'), personOptions());
    limitDuration(makeStepper(d, 'e-h'), makeStepper(d, 'e-m'));
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      d.remove();
      if (!ok && opener) focusSoon(opener, 0);
      resolve(ok);
    };
    const fail = (msg) => { const p = q('e-err'); p.hidden = false; p.textContent = ''; setTimeout(() => { p.textContent = msg; }, 50); };
    d.querySelector('[data-act=cancel]').onclick = () => finish(false);
    d.addEventListener('cancel', () => finish(false));
    d.addEventListener('close', () => finish(false));
    q('ef').onsubmit = async (ev) => {
      ev.preventDefault();
      const minutes = Number(q('e-h').value) * 60 + Number(q('e-m').value);
      const date = when.get();
      if (!minutes || minutes <= 0) return fail(t('msg.enterTime'));
      if (minutes > 24 * 60) return fail(t('msg.tooLong'));
      if (!date) return fail(t('msg.badDate'));
      await withBusy(q('e-save'), t('busy.saving'), async () => {
        try { await save({ personId: who.get(), date, minutes }); } catch (err) { return fail(err.message === 'auth' ? t('err.generic') : errText(err)); }
        finish(true);
      });
    };
    document.body.appendChild(d);
    d.showModal();
    q('dlg-info').focus();
  });
}

// Dialog for changing a person's name and position (the owner's own name is fixed, only the position can change).
function personDialog(person, opener, save) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.setAttribute('aria-labelledby', 'dlg-info');
    const self = person.id === 'self';
    d.innerHTML = `<form id="pf">
      <h2 id="dlg-info" tabindex="-1">${esc(t('people.editTitle'))}</h2>
      ${self ? '' : `<label for="p-name">${esc(t('people.nameLabel'))}</label>
      ${fieldWithMic('<input id="p-name" autocomplete="off">', 'p-name', t('people.nameLabel'))}`}
      <label for="p-role">${esc(t('people.roleLabel'))}</label>
      ${fieldWithMic('<input id="p-role" autocomplete="off">', 'p-role', t('people.roleLabel'))}
      <p id="p-err" class="msg" role="alert" hidden></p>
      <div class="dlg-actions">
        <button type="button" class="secondary" data-act="cancel">${esc(t('dlg.cancel'))}</button>
        <button type="submit" id="p-save">${esc(t('dlg.save'))}</button>
      </div></form>`;
    const q = (id) => d.querySelector('#' + id);
    if (!self) q('p-name').value = person.name;
    q('p-role').value = person.role || '';
    bindMics(d);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (micAbort) micAbort();
      if (d.open) d.close();
      d.remove();
      if (!ok && opener) focusSoon(opener, 0);
      resolve(ok);
    };
    const fail = (msg) => { const e = q('p-err'); e.hidden = false; e.textContent = ''; setTimeout(() => { e.textContent = msg; }, 50); };
    d.querySelector('[data-act=cancel]').onclick = () => finish(false);
    d.addEventListener('cancel', () => finish(false));
    d.addEventListener('close', () => finish(false));
    q('pf').onsubmit = async (ev) => {
      ev.preventDefault();
      const name = self ? person.name : q('p-name').value.trim();
      if (!name) return fail(t('people.emptyName'));
      await withBusy(q('p-save'), t('busy.saving'), async () => {
        try { await save({ name, role: q('p-role').value.trim() }); } catch (err) { return fail(err.message === 'auth' ? t('err.generic') : errText(err)); }
        finish(true);
      });
    };
    document.body.appendChild(d);
    d.showModal();
    q('dlg-info').focus();
  });
}

// Edit / delete buttons of a list of entries. After a change, refill() updates only the changed region
// (re-rendering the whole page would make a screen reader jump back to the top).
function bindEntryActions(root, refill, headingEl) {
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
    const e = state.entries.find((x) => x.id === b.dataset.edit);
    if (!e) return;
    const saved = await editDialog(e, b, (v) => call('PUT', '/api/entries/' + e.id, v));
    if (!saved) return;
    await refresh();
    refill();
    say(t('msg.entryUpdated'));
    // The list was rebuilt: put focus back on this entry's Edit button if it is still listed.
    focusSoon(root.querySelector(`[data-edit="${e.id}"]`) || headingEl(), 100);
  }));
  root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const e = state.entries.find((x) => x.id === b.dataset.del);
    const lines = e ? [personName(e.personId), L.fmtDateParts(e.date).weekday, L.fmtDateParts(e.date).dayMonth, L.fmtDuration(e.minutes)] : [];
    if (!(await confirmDialog({ title: t('dlg.deleteEntry'), lines, okLabel: t('dlg.delete'), opener: b }))) return;
    await withBusy(b, t('busy.deleting'), async () => {
      try { await call('DELETE', '/api/entries/' + b.dataset.del); } catch (err) { return err.message !== 'auth' && warn(errText(err)); }
      await refresh();
      refill();
      say(t('msg.entryDeleted'));
      focusSoon(headingEl(), 100); // the deleted card is gone, so land on the list heading
    });
  }));
}

// ---------- add entry ----------
function renderAdd() {
  shell(t('add.title'), `
    <div class="screen">
    <form id="f">
      <fieldset>
        <legend>${esc(t('add.legend'))}</legend>
        ${pickerHtml('who', t('add.who'), personOptions(), 'self')}
        ${whenHtml('')}
        ${stepperHtml('h', t('add.hours'), 0, 24, 0)}
        ${stepperHtml('m', t('add.minutes'), 0, 59, 0, 5)}
        <button type="submit" id="save">${esc(t('add.save'))}</button>
      </fieldset>
    </form>
    </div>
    <h2 id="recentTitle" tabindex="-1">${esc(t('add.recent'))}</h2>
    <div id="recent"></div>
    <button type="button" class="secondary" id="more" hidden>${esc(t('add.showMore'))}</button>`, `
    <form id="say">
      <label for="sentence">${esc(t('add.sentenceLabel'))}</label>
      <p id="ex" class="hint">${esc(t('add.example'))}</p>
      ${bigMic('sentence', t('add.sentenceLabel'), 'say')}
      ${fieldWithMic('<input id="sentence" autocomplete="off" autocapitalize="off" enterkeyhint="go">', 'sentence', t('add.sentenceLabel'), null, false)}
      <button type="submit">${esc(t('add.recognize'))}</button>
    </form>`);

  let shown = 3; // how many recent entries are listed; "Show more" raises it
  function fillRecent() {
    const all = [...state.entries].sort((a, b) => b.created.localeCompare(a.created));
    const last = all.slice(0, shown);
    $('more').hidden = shown >= all.length;
    $('recent').innerHTML = last.length ? `<ul>${last.map((e) => entryLi(e, true)).join('')}</ul>` : `<p>${esc(t('add.none'))}</p>`;
    bindEntryActions($('recent'), fillRecent, () => $('recentTitle'));
  }
  fillRecent();
  $('more').onclick = () => {
    shown += 5;
    fillRecent();
    const total = state.entries.length;
    say(t('add.shown', { n: Math.min(shown, total), total }));
    // The button disappears once everything is shown; keep focus in the list instead of losing it.
    if ($('more').hidden) focusSoon($('recent').querySelector('li:last-child [data-edit]') || $('recentTitle'), 100);
  };

  const when = makeWhen($app, '');
  const who = makePicker($app, 'who', t('add.who'), personOptions());
  limitDuration(makeStepper($app, 'h'), makeStepper($app, 'm'));

  function summary() {
    const min = Number($('h').value) * 60 + Number($('m').value);
    const date = when.get();
    return { min, date, text: `${who.text()}, ${date ? L.fmtDate(date) : t('add.noDate')}, ${L.fmtDuration(min)}` };
  }

  $('say').onsubmit = (e) => {
    e.preventDefault();
    const r = L.parseSentence($('sentence').value, state.people);
    if (!r.minutes) return warn(t('msg.noTime'));
    if (r.personId) who.set(r.personId);
    when.set(r.date || iso(new Date()));
    $('h').value = Math.floor(r.minutes / 60);
    $('m').value = r.minutes % 60;
    if (r.personId) {
      say(t('msg.recognized', { summary: summary().text }));
      focusSoon($('save'));
    } else {
      warn(t('msg.noPerson'));
      focusSoon(who.el);
    }
  };

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const { min, date, text } = summary();
    if (!min || min <= 0) return warn(t('msg.enterTime'));
    if (min > 24 * 60) return warn(t('msg.tooLong'));
    if (!date) return warn(t('msg.badDate'));
    await withBusy($('save'), t('busy.saving'), async () => {
      try {
        await call('POST', '/api/entries', { personId: who.get(), date, minutes: min });
      } catch (err) { return err.message !== 'auth' && warn(t('msg.saveFailed')); }
      await refresh();
      // Reset the form and update the list in place. Focus is deliberately not moved.
      $('sentence').value = '';
      when.set(iso(new Date()));
      $('h').value = 0; $('m').value = 0;
      fillRecent();
      say(t('msg.saved', { summary: text }));
    });
  };
}

// ---------- reports ----------
const PRESETS = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];

// The dates come from the device clock (new Date()), so "this week" always matches the user's own calendar.
function period() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const weekStart = addDays(now, -((now.getDay() + 6) % 7));
  const week = (start) => { const end = addDays(start, 6); return { from: iso(start), to: iso(end), title: t('report.weekTitle', { from: L.fmtDate(iso(start)), to: L.fmtDate(iso(end)) }) }; };
  const month = (offset) => {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return { from: iso(start), to: iso(end), title: t('report.monthTitle', { name: start.toLocaleDateString(L.intl, { month: 'long', year: 'numeric' }) }) };
  };
  let per;
  switch (report.mode) {
    case 'lastWeek': per = week(addDays(weekStart, -7)); break;
    case 'thisMonth': per = month(0); break;
    case 'lastMonth': per = month(-1); break;
    case 'custom': per = { from: report.from, to: report.to, title: t('report.rangeTitle', { from: L.fmtDate(report.from, true), to: L.fmtDate(report.to, true) }) }; break;
    default: per = week(weekStart);
  }
  // What was chosen, then the first and last day, each on its own line.
  const custom = report.mode === 'custom';
  per.label = custom ? t('report.customShort') : t('report.' + report.mode);
  per.fromText = L.fmtDate(per.from, custom);
  per.toText = L.fmtDate(per.to, custom);
  return per;
}

function renderReport() {
  const people = state.people.map((p) => [p.id, personName(p.id)]);
  if (!state.people.some((p) => p.id === report.personId)) report.personId = 'self';
  const personLabel = () => personName(report.personId) + (personRole(report.personId) ? `, ${personRole(report.personId)}` : '');

  shell(t('report.title'), `
    <h2>${esc(t('report.people'))}</h2>
    <div class="presets">${people.map(([id, n]) => `<button class="secondary" data-person="${id}">${esc(n)}</button>`).join('')}</div>
    <h2>${esc(t('report.period'))}</h2>
    <div class="presets">${PRESETS.map((k) => `<button class="secondary" data-preset="${k}">${esc(t('report.' + k))}</button>`).join('')}</div>
    <details id="custom">
      <summary>${esc(t('report.customTitle'))}</summary>
      <form id="range">
        <label for="from">${esc(t('report.from'))}</label>
        ${fieldWithMic('<input id="from" autocomplete="off">', 'from', t('report.from'))}
        <label for="to">${esc(t('report.to'))}</label>
        ${fieldWithMic('<input id="to" autocomplete="off">', 'to', t('report.to'))}
        <button type="submit">${esc(t('report.show'))}</button>
      </form>
    </details>
    <div id="reportBody"></div>`);

  function markActive() {
    const set = (sel, key, val) => $app.querySelectorAll(sel).forEach((b) => {
      if (b.dataset[key] === val) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    set('[data-preset]', 'preset', report.mode);
    set('[data-person]', 'person', report.personId);
  }
  function totals() {
    const per = period();
    const list = state.entries
      .filter((e) => e.date >= per.from && e.date <= per.to && e.personId === report.personId)
      .sort((a, b) => a.date.localeCompare(b.date));
    return { per, list, d: L.fmtDuration(list.reduce((s, e) => s + e.minutes, 0)) };
  }
  function fillReport() {
    const { per, list, d } = totals();
    // Total first, then the entries of the chosen person for the chosen period.
    // One heading element (lines separated by <br>, with invisible commas), so a screen reader reads it in one go.
    $('reportBody').innerHTML = `<h2 id="ptitle" tabindex="-1" class="period"><span class="p-mode">${esc(per.label)}</span><span class="pause">, </span><br><span>${esc(t('period.from'))}: ${esc(per.fromText)}</span><span class="pause">, </span><br><span>${esc(t('period.to'))}: ${esc(per.toText)}</span></h2>
      <p class="total">${esc(personLabel())}: ${esc(t('report.total', { d }))}</p>
      ${list.length ? `<ul>${list.map((e) => entryLi(e, false)).join('')}</ul>` : `<p>${esc(t('report.noEntries'))}</p>`}`;
    bindEntryActions($('reportBody'), fillReport, () => $('ptitle'));
    markActive();
  }
  fillReport();

  // Focus stays on the pressed button; the new selection is announced instead.
  const announce = () => { const { per, d } = totals(); say(t('report.summary', { name: personLabel(), title: per.title, d })); };
  $app.querySelectorAll('[data-person]').forEach((b) => (b.onclick = () => { report.personId = b.dataset.person; fillReport(); announce(); }));
  $app.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => { report = { mode: b.dataset.preset, personId: report.personId }; fillReport(); announce(); }));
  $('range').onsubmit = (e) => {
    e.preventDefault();
    const parse = (v) => L.parseDate(String(v).toLowerCase().replace(/\s+/g, ' ').trim(), new Date(), true).date;
    const from = parse($('from').value), to = parse($('to').value);
    if (!from || !to) return warn(t('msg.badRange'));
    if (from > to) return warn(t('msg.rangeOrder'));
    report = { mode: 'custom', from, to, personId: report.personId };
    fillReport();
    announce();
  };
}

// ---------- people ----------
function renderPeople() {
  shell(t('people.title'), `
    <h2 id="listTitle" tabindex="-1">${esc(t('people.list'))}</h2>
    <div id="peopleList"></div>
    <h2>${esc(t('people.addTitle'))}</h2>
    <form id="f">
      <label for="name">${esc(t('people.nameLabel'))}</label>
      ${fieldWithMic('<input id="name" autocomplete="off">', 'name', t('people.nameLabel'))}
      <label for="role">${esc(t('people.roleLabel'))}</label>
      ${fieldWithMic('<input id="role" autocomplete="off">', 'role', t('people.roleLabel'))}
      <button type="submit" id="add">${esc(t('people.add'))}</button>
    </form>`);

  function fillPeople() {
    $('peopleList').innerHTML = `<ul>${state.people.map((p) => {
      const text = `<span class="e-name">${esc(personName(p.id))}</span>${p.role ? `<span class="pause">, </span><br><span>${esc(p.role)}</span>` : ''}`;
      const label = personName(p.id) + (p.role ? `, ${p.role}` : '');
      // The owner's own card ("Me") is plain text, not editable. Other cards: the whole text area is one button that opens the edit dialog.
      if (p.id === 'self') return `<li class="card entry"><p class="entry-text">${text}</p></li>`;
      return `<li class="card entry"><button type="button" class="card-main" data-editp="${p.id}" aria-label="${esc(t('people.editAria', { name: label }))}"><span class="entry-text">${text}</span><span class="card-pencil" aria-hidden="true">${ICON_EDIT}</span></button><div class="entry-actions">
        <button class="icon danger" data-rm="${p.id}" title="${esc(t('entry.delete'))}" aria-label="${esc(t('people.removeAria', { name: p.name }))}">${ICON_DELETE}</button></div></li>`;
    }).join('')}</ul>`;
    $('peopleList').querySelectorAll('[data-editp]').forEach((b) => (b.onclick = async () => {
      const person = state.people.find((x) => x.id === b.dataset.editp);
      if (!person) return;
      const saved = await personDialog(person, b, (v) => call('PUT', '/api/people/' + person.id, v));
      if (!saved) return;
      await refresh();
      fillPeople();
      const updated = state.people.find((x) => x.id === person.id);
      say(t('people.updated', { name: updated ? personName(updated.id) : '' }));
      focusSoon($('peopleList').querySelector(`[data-editp="${person.id}"]`) || $('listTitle'), 100);
    }));
    $('peopleList').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      const n = personName(b.dataset.rm);
      if (!(await confirmDialog({ title: t('dlg.deletePerson'), lines: [n, personRole(b.dataset.rm)].filter(Boolean), detail: t('dlg.personDetail'), okLabel: t('dlg.delete'), opener: b }))) return;
      await withBusy(b, t('busy.deleting'), async () => {
        await call('DELETE', '/api/people/' + b.dataset.rm);
        await refresh(); fillPeople(); say(t('people.removed', { name: n })); focusSoon($('listTitle'), 100);
      });
    }));
  }
  fillPeople();

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('name').value.trim(), role = $('role').value.trim();
    if (!name) return warn(t('people.emptyName'));
    await withBusy($('add'), t('busy.adding'), async () => {
      try { await call('POST', '/api/people', { name, role }); } catch (err) { return err.message !== 'auth' && warn(errText(err)); }
      await refresh(); fillPeople(); $('name').value = ''; $('role').value = ''; say(t('people.added', { name }));
    });
  };
}

async function start() {
  try { await refresh(); } catch { return; }
  view = 'add';
  render();
  focusHeading();
}
start();
