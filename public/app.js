const $app = document.getElementById('app');
const $status = document.getElementById('status');
const $alert = document.getElementById('alert');
const { t, has, LANG } = I18N;
const L = P.forLang(LANG);
const { iso, addDays } = P;

let state = { people: [], entries: [] };
let view = 'add';
let report = { kind: 'week', offset: 0 };

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
    d.innerHTML = `<p id="dlg-info" tabindex="-1">${parts.join('<span class="sr">, </span><br>')}</p>
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
  const orig = btn.textContent;
  btn.setAttribute('aria-disabled', 'true');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = label;
  say(label);
  try { return await fn(); } finally {
    if (btn.isConnected) { btn.removeAttribute('aria-disabled'); btn.removeAttribute('aria-busy'); btn.textContent = orig; }
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
  // Sign out lives at the very bottom, away from the menu, and asks for confirmation.
  $app.innerHTML = `<nav aria-label="${esc(t('nav.label'))}">${nav}</nav>
    <h1>${esc(title)}</h1>${inner}
    <footer><button class="secondary" id="logout">${esc(t('nav.logout'))}</button></footer>`;
  $app.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
  $('logout').onclick = async (e) => {
    const b = e.currentTarget;
    if (!(await confirmDialog({ title: t('dlg.logoutTitle'), detail: t('dlg.logoutDetail'), okLabel: t('nav.logout'), okClass: '', opener: b }))) return;
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

function entryLi(e, withPerson) {
  const label = `${withPerson ? personName(e.personId) + ', ' : ''}${L.fmtDate(e.date)}: ${L.fmtDuration(e.minutes)}`;
  return `<li><span>${esc(label)}</span>
    <button class="danger" data-del="${e.id}" aria-label="${esc(t('entry.deleteAria', { label }))}">${esc(t('entry.delete'))}</button></li>`;
}

// Asks for confirmation, deletes, then calls refill() to update only the changed region
// (re-rendering the whole page would make a screen reader jump back to the top).
function bindDelete(root, refill, afterFocus) {
  root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const e = state.entries.find((x) => x.id === b.dataset.del);
    const lines = e ? [personName(e.personId), L.fmtDateParts(e.date).weekday, L.fmtDateParts(e.date).dayMonth, L.fmtDuration(e.minutes)] : [];
    if (!(await confirmDialog({ title: t('dlg.deleteEntry'), lines, okLabel: t('dlg.delete'), opener: b }))) return;
    await withBusy(b, t('busy.deleting'), async () => {
      try { await call('DELETE', '/api/entries/' + b.dataset.del); } catch (err) { return err.message !== 'auth' && warn(errText(err)); }
      await refresh();
      refill();
      say(t('msg.entryDeleted'));
      focusSoon(afterFocus(), 100); // the deleted button is gone, so land on the list heading
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
      <input id="sentence" autocomplete="off" autocapitalize="off" enterkeyhint="go" aria-describedby="ex">
      <button type="submit">${esc(t('add.recognize'))}</button>
    </form>
    <form id="f">
      <fieldset>
        <legend>${esc(t('add.legend'))}</legend>
        <label for="who">${esc(t('add.who'))}</label>
        <select id="who">${opts}</select>
        <label for="when">${esc(t('add.when'))}</label>
        <select id="when">
          <option value="0">${esc(t('when.today'))}</option><option value="1">${esc(t('when.yesterday'))}</option>
          <option value="2">${esc(t('when.dayBefore'))}</option><option value="other">${esc(t('when.other'))}</option>
        </select>
        <div id="otherWrap" hidden>
          <label for="other">${esc(t('add.otherLabel'))}</label>
          <input id="other" autocomplete="off">
        </div>
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
    bindDelete($('recent'), fillRecent, () => $('recentTitle'));
  }
  fillRecent();

  const toggleOther = () => { $('otherWrap').hidden = $('when').value !== 'other'; };
  $('when').onchange = toggleOther;

  function currentDate() {
    const w = $('when').value;
    if (w !== 'other') return iso(addDays(new Date(), -Number(w)));
    return L.parseDate(String($('other').value).toLowerCase().replace(/\s+/g, ' ').trim(), new Date()).date;
  }
  function summary() {
    const min = Number($('h').value) * 60 + Number($('m').value);
    const date = currentDate();
    return { min, date, text: `${$('who').selectedOptions[0].text}, ${date ? L.fmtDate(date) : t('add.noDate')}, ${L.fmtDuration(min)}` };
  }

  $('say').onsubmit = (e) => {
    e.preventDefault();
    const r = L.parseSentence($('sentence').value, state.people);
    if (!r.minutes) return warn(t('msg.noTime'));
    if (r.personId) $('who').value = r.personId;
    const today = iso(new Date());
    const d = r.date || today;
    const diff = Math.round((new Date(today) - new Date(d)) / 864e5);
    if ([0, 1, 2].includes(diff)) $('when').value = String(diff);
    else { $('when').value = 'other'; $('other').value = d.split('-').reverse().slice(0, 2).join('.') + '.' + d.slice(0, 4); }
    toggleOther();
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
      $('when').value = '0'; toggleOther(); $('other').value = '';
      $('h').value = 0; $('m').value = 0;
      fillRecent();
      say(t('msg.saved', { summary: text }));
    });
  };
}

// ---------- reports ----------
function period() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (report.kind === 'week') {
    const start = addDays(now, -((now.getDay() + 6) % 7) + report.offset * 7);
    const end = addDays(start, 6);
    return { from: iso(start), to: iso(end), title: t('report.weekTitle', { from: L.fmtDate(iso(start)), to: L.fmtDate(iso(end)) }) };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + report.offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const name = start.toLocaleDateString(L.intl, { month: 'long', year: 'numeric' });
  return { from: iso(start), to: iso(end), title: t('report.monthTitle', { name }) };
}

function renderReport() {
  const wk = report.kind === 'week';
  shell(t('report.title'), `
    <label for="kind">${esc(t('report.period'))}</label>
    <select id="kind"><option value="week" ${wk ? 'selected' : ''}>${esc(t('report.week'))}</option>
      <option value="month" ${wk ? '' : 'selected'}>${esc(t('report.month'))}</option></select>
    <div class="row">
      <button id="prev" class="secondary">${esc(t(wk ? 'report.prevWeek' : 'report.prevMonth'))}</button>
      <button id="next" class="secondary" ${report.offset >= 0 ? 'aria-disabled="true"' : ''}>${esc(t(wk ? 'report.nextWeek' : 'report.nextMonth'))}</button>
    </div>
    <div id="reportBody"></div>`);

  function fillReport() {
    const per = period();
    const inRange = state.entries.filter((e) => e.date >= per.from && e.date <= per.to).sort((a, b) => a.date.localeCompare(b.date));
    const total = inRange.reduce((s, e) => s + e.minutes, 0);
    const sections = state.people.map((p) => {
      const es = inRange.filter((e) => e.personId === p.id);
      const sum = es.reduce((s, e) => s + e.minutes, 0);
      return `<h3>${esc(personName(p.id))}: ${esc(L.fmtDuration(sum))}</h3>
        ${es.length ? `<ul>${es.map((e) => entryLi(e, false)).join('')}</ul>` : `<p>${esc(t('report.noEntries'))}</p>`}`;
    }).join('');
    $('reportBody').innerHTML = `<h2 id="ptitle" tabindex="-1">${esc(per.title)}</h2>
      <p class="total">${esc(t('report.total', { d: L.fmtDuration(total) }))}</p>${sections}`;
    bindDelete($('reportBody'), fillReport, () => $('ptitle'));
  }
  fillReport();

  const again = () => { renderReport(); const h = $('ptitle'); h.focus(); say(period().title); };
  $('kind').onchange = () => { report = { kind: $('kind').value, offset: 0 }; again(); };
  $('prev').onclick = () => { report.offset--; again(); };
  $('next').onclick = () => { if (report.offset < 0) { report.offset++; again(); } };
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
