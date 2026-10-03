const $app = document.getElementById('app');
const $status = document.getElementById('status');
const $alert = document.getElementById('alert');
const { t, has, LANG } = I18N;
const L = P.forLang(LANG);
const { iso, addDays } = P;

let state = { people: [], entries: [] };
let view = 'add';
let report = { mode: 'thisWeek', personId: 'all' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const personName = (id) => (id === 'self' ? t('me') : (state.people.find((p) => p.id === id) || { name: '?' }).name);
const $ = (id) => $app.querySelector('#' + id);

// Messages for screen readers (polite status / assertive alert). Cleared first so repeated text is announced again.
function say(text) { $status.textContent = ''; setTimeout(() => { $status.textContent = text; }, 50); }
function warn(text) { $alert.textContent = ''; setTimeout(() => { $alert.textContent = text; }, 50); }
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
function shell(title, inner) {
  document.title = title;
  const nav = [['add', t('nav.add')], ['report', t('nav.reports')], ['people', t('nav.people')]]
    .map(([k, n]) => `<button class="secondary" data-nav="${k}" ${view === k ? 'aria-current="page"' : ''}>${esc(n)}</button>`).join('');
  // Sign out lives only at the bottom of the People page, away from the menu, and asks for confirmation.
  $app.innerHTML = `<nav aria-label="${esc(t('nav.label'))}">${nav}</nav>
    <h1>${esc(title)}</h1>${inner}
    ${view === 'people' ? `<footer><button class="orange" id="logout">${esc(t('nav.logout'))}</button></footer>` : ''}`;
  $app.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
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

// "When" picker shared by the add form and the edit dialog: today / yesterday / day before / another date.
function whenHtml(pre) {
  return `<label for="${pre}when">${esc(t('add.when'))}</label>
    <select id="${pre}when">
      <option value="0">${esc(t('when.today'))}</option><option value="1">${esc(t('when.yesterday'))}</option>
      <option value="2">${esc(t('when.dayBefore'))}</option><option value="other">${esc(t('when.other'))}</option>
    </select>
    <div id="${pre}otherWrap" hidden>
      <label for="${pre}other">${esc(t('add.otherLabel'))}</label>
      <input id="${pre}other" autocomplete="off">
    </div>`;
}
function makeWhen(root, pre) {
  const q = (id) => root.querySelector('#' + pre + id);
  const toggle = () => { q('otherWrap').hidden = q('when').value !== 'other'; };
  q('when').onchange = toggle;
  return {
    get() {
      const w = q('when').value;
      if (w !== 'other') return iso(addDays(new Date(), -Number(w)));
      return L.parseDate(String(q('other').value).toLowerCase().replace(/\s+/g, ' ').trim(), new Date()).date;
    },
    set(date) {
      const diff = Math.round((new Date(iso(new Date())) - new Date(date)) / 864e5);
      if ([0, 1, 2].includes(diff)) { q('when').value = String(diff); q('other').value = ''; }
      else { q('when').value = 'other'; q('other').value = date.split('-').reverse().join('.'); }
      toggle();
    },
  };
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
    const opts = state.people.map((p) => `<option value="${p.id}" ${p.id === e.personId ? 'selected' : ''}>${esc(personName(p.id))}</option>`).join('');
    d.innerHTML = `<form id="ef">
      <h2 id="dlg-info" tabindex="-1">${esc(t('dlg.editEntry'))}</h2>
      <label for="e-who">${esc(t('add.who'))}</label>
      <select id="e-who">${opts}</select>
      ${whenHtml('e-')}
      <div class="row">
        <div><label for="e-h">${esc(t('add.hours'))}</label><input id="e-h" type="number" inputmode="numeric" min="0" max="24" value="${Math.floor(e.minutes / 60)}"></div>
        <div><label for="e-m">${esc(t('add.minutes'))}</label><input id="e-m" type="number" inputmode="numeric" min="0" max="59" value="${e.minutes % 60}"></div>
      </div>
      <p id="e-err" class="msg" role="alert" hidden></p>
      <div class="dlg-actions">
        <button type="button" class="secondary" data-act="cancel">${esc(t('dlg.cancel'))}</button>
        <button type="submit" id="e-save">${esc(t('dlg.save'))}</button>
      </div></form>`;
    const q = (id) => d.querySelector('#' + id);
    const when = makeWhen(d, 'e-');
    when.set(e.date);
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
      if (!date) return fail(t('msg.badDate'));
      await withBusy(q('e-save'), t('busy.saving'), async () => {
        try { await save({ personId: q('e-who').value, date, minutes }); } catch (err) { return fail(err.message === 'auth' ? t('err.generic') : errText(err)); }
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
  const opts = state.people.map((p) => `<option value="${p.id}">${esc(personName(p.id))}</option>`).join('');
  shell(t('add.title'), `
    <form id="say">
      <label for="sentence">${esc(t('add.sentenceLabel'))}</label>
      <p id="ex" class="hint">${esc(t('add.example'))}</p>
      <input id="sentence" autocomplete="off" autocapitalize="off" enterkeyhint="go">
      <button type="submit">${esc(t('add.recognize'))}</button>
    </form>
    <form id="f">
      <fieldset>
        <legend>${esc(t('add.legend'))}</legend>
        <label for="who">${esc(t('add.who'))}</label>
        <select id="who">${opts}</select>
        ${whenHtml('')}
        <div class="row">
          <div><label for="h">${esc(t('add.hours'))}</label><input id="h" type="number" inputmode="numeric" min="0" max="24" value="0"></div>
          <div><label for="m">${esc(t('add.minutes'))}</label><input id="m" type="number" inputmode="numeric" min="0" max="59" value="0"></div>
        </div>
        <button type="submit" id="save">${esc(t('add.save'))}</button>
      </fieldset>
    </form>
    <h2 id="recentTitle" tabindex="-1">${esc(t('add.recent'))}</h2>
    <div id="recent"></div>`);

  function fillRecent() {
    const last = [...state.entries].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 5);
    $('recent').innerHTML = last.length ? `<ul>${last.map((e) => entryLi(e, true)).join('')}</ul>` : `<p>${esc(t('add.none'))}</p>`;
    bindEntryActions($('recent'), fillRecent, () => $('recentTitle'));
  }
  fillRecent();

  const when = makeWhen($app, '');

  function summary() {
    const min = Number($('h').value) * 60 + Number($('m').value);
    const date = when.get();
    return { min, date, text: `${$('who').selectedOptions[0].text}, ${date ? L.fmtDate(date) : t('add.noDate')}, ${L.fmtDuration(min)}` };
  }

  $('say').onsubmit = (e) => {
    e.preventDefault();
    const r = L.parseSentence($('sentence').value, state.people);
    if (!r.minutes) return warn(t('msg.noTime'));
    if (r.personId) $('who').value = r.personId;
    when.set(r.date || iso(new Date()));
    $('h').value = Math.floor(r.minutes / 60);
    $('m').value = r.minutes % 60;
    if (r.personId) {
      say(t('msg.recognized', { summary: summary().text }));
      focusSoon($('save'));
    } else {
      warn(t('msg.noPerson'));
      focusSoon($('who'));
    }
  };

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const { min, date, text } = summary();
    if (!min || min <= 0) return warn(t('msg.enterTime'));
    if (!date) return warn(t('msg.badDate'));
    await withBusy($('save'), t('busy.saving'), async () => {
      try {
        await call('POST', '/api/entries', { personId: $('who').value, date, minutes: min });
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
  switch (report.mode) {
    case 'lastWeek': return week(addDays(weekStart, -7));
    case 'thisMonth': return month(0);
    case 'lastMonth': return month(-1);
    case 'custom': return { from: report.from, to: report.to, title: t('report.rangeTitle', { from: L.fmtDate(report.from, true), to: L.fmtDate(report.to, true) }) };
    default: return week(weekStart);
  }
}

function renderReport() {
  const people = [['all', t('report.everyone')], ...state.people.map((p) => [p.id, personName(p.id)])];
  if (report.personId !== 'all' && !state.people.some((p) => p.id === report.personId)) report.personId = 'all';
  const personLabel = () => (people.find(([id]) => id === report.personId) || [, ''])[1];

  shell(t('report.title'), `
    <h2>${esc(t('report.people'))}</h2>
    <div class="presets">${people.map(([id, n]) => `<button class="secondary" data-person="${id}">${esc(n)}</button>`).join('')}</div>
    <h2>${esc(t('report.period'))}</h2>
    <div class="presets">${PRESETS.map((k) => `<button class="secondary" data-preset="${k}">${esc(t('report.' + k))}</button>`).join('')}</div>
    <details id="custom">
      <summary>${esc(t('report.customTitle'))}</summary>
      <form id="range">
        <label for="from">${esc(t('report.from'))}</label>
        <input id="from" autocomplete="off">
        <label for="to">${esc(t('report.to'))}</label>
        <input id="to" autocomplete="off">
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
      .filter((e) => e.date >= per.from && e.date <= per.to && (report.personId === 'all' || e.personId === report.personId))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { per, list, d: L.fmtDuration(list.reduce((s, e) => s + e.minutes, 0)) };
  }
  function fillReport() {
    const { per, list, d } = totals();
    // Total first, then the entries of the chosen person for the chosen period.
    $('reportBody').innerHTML = `<h2 id="ptitle" tabindex="-1">${esc(per.title)}</h2>
      <p class="total">${esc(personLabel())}: ${esc(t('report.total', { d }))}</p>
      ${list.length ? `<ul>${list.map((e) => entryLi(e, report.personId === 'all')).join('')}</ul>` : `<p>${esc(t('report.noEntries'))}</p>`}`;
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
    <form id="f">
      <label for="name">${esc(t('people.addLabel'))}</label>
      <input id="name" autocomplete="off">
      <button type="submit" id="add">${esc(t('people.add'))}</button>
    </form>`);

  function fillPeople() {
    $('peopleList').innerHTML = `<ul>${state.people.map((p) => `<li>${esc(personName(p.id))}${p.id === 'self' ? '' : `
      <button class="danger" data-rm="${p.id}" aria-label="${esc(t('people.removeAria', { name: p.name }))}">${esc(t('entry.delete'))}</button>`}</li>`).join('')}</ul>`;
    $('peopleList').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      const n = personName(b.dataset.rm);
      if (!(await confirmDialog({ title: t('dlg.deletePerson'), lines: [n], detail: t('dlg.personDetail'), okLabel: t('dlg.delete'), opener: b }))) return;
      await withBusy(b, t('busy.deleting'), async () => {
        await call('DELETE', '/api/people/' + b.dataset.rm);
        await refresh(); fillPeople(); say(t('people.removed', { name: n })); focusSoon($('listTitle'), 100);
      });
    }));
  }
  fillPeople();

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) return warn(t('people.emptyName'));
    await withBusy($('add'), t('busy.adding'), async () => {
      try { await call('POST', '/api/people', { name }); } catch (err) { return err.message !== 'auth' && warn(errText(err)); }
      await refresh(); fillPeople(); $('name').value = ''; say(t('people.added', { name }));
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
