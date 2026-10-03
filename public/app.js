const $app = document.getElementById('app');
const $status = document.getElementById('status');
const $alert = document.getElementById('alert');
const { parseSentence, fmtDuration, fmtDate, iso, addDays } = P;

let state = { people: [], entries: [] };
let view = 'add';
let report = { kind: 'week', offset: 0 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const personName = (id) => (state.people.find((p) => p.id === id) || { name: '?' }).name;

function say(text) { $status.textContent = ''; setTimeout(() => { $status.textContent = text; }, 50); }
function warn(text) { $alert.textContent = ''; setTimeout(() => { $alert.textContent = text; }, 50); }

async function call(method, url, data) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.error === 'auth') { renderLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error(j.error || 'Помилка');
  return j;
}
// Accessible confirmation dialog (native <dialog>: focus trap, Esc to cancel, background made inert).
// Focus moves to the title so a screen reader reads it as soon as the dialog opens.
function confirmDialog({ title, detail, okLabel, opener }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-labelledby', 'dlg-title');
    if (detail) d.setAttribute('aria-describedby', 'dlg-detail');
    d.innerHTML = `<h2 id="dlg-title" tabindex="-1">${esc(title)}</h2>
      ${detail ? `<p id="dlg-detail">${esc(detail)}</p>` : ''}
      <div class="dlg-actions">
        <button type="button" class="secondary" data-act="cancel">Скасувати</button>
        <button type="button" data-act="ok">${esc(okLabel)}</button>
      </div>`;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      d.remove();
      if (!ok && opener) setTimeout(() => opener.isConnected && opener.focus(), 0); // after the browser's own focus restore
      resolve(ok);
    };
    d.querySelector('[data-act=cancel]').onclick = () => finish(false);
    d.querySelector('[data-act=ok]').onclick = () => finish(true);
    d.addEventListener('cancel', () => finish(false)); // Esc
    d.addEventListener('close', () => finish(false));
    document.body.appendChild(d);
    d.showModal();
    d.querySelector('h2').focus();
  });
}

// Disables the button and shows a loader while the request runs, so repeated taps cannot create duplicates.
async function withBusy(btn, label, fn) {
  if (btn.disabled) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = label;
  say(label);
  try { return await fn(); } finally {
    if (btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = orig; }
  }
}
async function refresh() { state = await call('GET', '/api/data'); }

function focusHeading() { const h = $app.querySelector('h1'); if (h) { h.tabIndex = -1; h.focus(); } }

// ---------- login ----------
function renderLogin() {
  document.title = 'Вхід — Облік годин';
  const err = new URLSearchParams(location.search).get('login_error');
  const msg = { denied: 'Цей акаунт Google не має доступу до додатка.', failed: 'Не вдалося увійти. Спробуйте ще раз.' }[err];
  $app.innerHTML = `
    <h1>Облік годин. Вхід</h1>
    ${msg ? `<p class="msg" role="alert">${msg}</p>` : ''}
    <button id="google">Увійти через Google</button>
    <p class="hint">Після входу цей комп'ютер запамʼятає вас.</p>`;
  $app.querySelector('#google').onclick = (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.setAttribute('aria-busy', 'true');
    e.currentTarget.textContent = 'Переходжу до Google…';
    location.href = '/api/auth/google';
  };
  focusHeading();
}

// ---------- shell ----------
function shell(title, inner) {
  document.title = title + ' — Облік годин';
  const nav = [['add', 'Додати години'], ['report', 'Звіти'], ['people', 'Люди']]
    .map(([k, n]) => `<button class="secondary" data-nav="${k}" ${view === k ? 'aria-current="page"' : ''}>${n}</button>`).join('');
  $app.innerHTML = `<nav aria-label="Розділи">${nav}<button class="secondary" data-nav="logout">Вийти</button></nav>
    <h1>${title}</h1>${inner}`;
  $app.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
}
async function go(v) {
  if (v === 'logout') { await call('POST', '/api/logout').catch(() => {}); return renderLogin(); }
  view = v;
  await refresh();
  render();
  focusHeading();
}
function render() { ({ add: renderAdd, report: renderReport, people: renderPeople })[view](); }

function entryLi(e, withPerson) {
  const label = `${withPerson ? personName(e.personId) + ', ' : ''}${fmtDate(e.date)}: ${fmtDuration(e.minutes)}`;
  return `<li><span>${esc(label)}</span>
    <button class="danger" data-del="${e.id}" aria-label="Видалити запис: ${esc(label)}">Видалити</button></li>`;
}
function bindDelete(after) {
  $app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const e = state.entries.find((x) => x.id === b.dataset.del);
    const title = e ? `Видалити запис: ${personName(e.personId)}, ${fmtDate(e.date)}, ${fmtDuration(e.minutes)}` : 'Видалити запис';
    if (!(await confirmDialog({ title, okLabel: 'Видалити', opener: b }))) return;
    await withBusy(b, 'Видаляю…', async () => {
      await call('DELETE', '/api/entries/' + b.dataset.del);
      await refresh();
      after();
      say('Запис видалено');
    });
  }));
}

// ---------- add entry ----------
function renderAdd() {
  const opts = state.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const last = [...state.entries].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 5);
  shell('Додати години', `
    <form id="say">
      <label for="sentence">Скажіть одним реченням: хто, коли, скільки</label>
      <input id="sentence" autocomplete="off" autocapitalize="off" aria-describedby="ex">
      <p id="ex" class="hint">Наприклад: Марія вчора година десять. Або: я сьогодні п'ятдесят п'ять хвилин. Або: Олена 15.09 дві години.</p>
      <button type="submit">Розпізнати</button>
    </form>
    <form id="f">
      <fieldset>
        <legend>Перевірте або заповніть вручну</legend>
        <label for="who">Хто працював</label>
        <select id="who">${opts}</select>
        <label for="when">Коли</label>
        <select id="when">
          <option value="0">Сьогодні</option><option value="1">Вчора</option>
          <option value="2">Позавчора</option><option value="other">Інша дата</option>
        </select>
        <div id="otherWrap" hidden>
          <label for="other">Дата, наприклад 15.09 або 15 вересня</label>
          <input id="other" autocomplete="off">
        </div>
        <div class="row">
          <div><label for="h">Годин</label><input id="h" type="number" inputmode="numeric" min="0" max="24" value="0"></div>
          <div><label for="m">Хвилин</label><input id="m" type="number" inputmode="numeric" min="0" max="59" value="0"></div>
        </div>
        <button type="submit" id="save">Зберегти</button>
      </fieldset>
    </form>
    <h2>Останні записи</h2>
    ${last.length ? `<ul>${last.map((e) => entryLi(e, true)).join('')}</ul>` : '<p>Поки що записів немає.</p>'}`);

  const $ = (id) => $app.querySelector('#' + id);
  const toggleOther = () => { $('otherWrap').hidden = $('when').value !== 'other'; };
  $('when').onchange = toggleOther;

  function currentDate() {
    const w = $('when').value;
    if (w !== 'other') return iso(addDays(new Date(), -Number(w)));
    return P.parseDate(String($('other').value).toLowerCase().replace(/\s+/g, ' ').trim(), new Date()).date;
  }
  function summary() {
    const min = Number($('h').value) * 60 + Number($('m').value);
    return { min, text: `${$('who').selectedOptions[0].text}, ${currentDate() ? fmtDate(currentDate()) : 'дата не вказана'}, ${fmtDuration(min)}` };
  }

  $('say').onsubmit = (e) => {
    e.preventDefault();
    const r = parseSentence($('sentence').value, state.people);
    if (!r.minutes) { warn('Не вдалося розпізнати час. Скажіть, наприклад: година десять, або п\'ятдесят п\'ять хвилин.'); return; }
    if (!r.personId) { warn('Не вдалося розпізнати, хто працював. Виберіть людину зі списку нижче або скажіть імʼя з реченням ще раз.'); $('who').focus(); }
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
      say(`Розпізнано: ${summary().text}. Натисніть «Зберегти», якщо все вірно.`);
      $('save').focus();
    }
  };

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const { min, text } = summary();
    const date = currentDate();
    if (!min || min <= 0) return warn('Вкажіть кількість годин або хвилин.');
    if (!date) return warn('Не вдалося зрозуміти дату. Напишіть, наприклад, 15.09');
    await withBusy($('save'), 'Зберігаю…', async () => {
      try {
        await call('POST', '/api/entries', { personId: $('who').value, date, minutes: min });
      } catch (err) { return err.message !== 'auth' && warn('Не вдалося зберегти. Спробуйте ще раз.'); }
      await refresh();
      renderAdd();
      $app.querySelector('#sentence').focus();
      say(`Збережено: ${text}.`);
    });
  };
  bindDelete(renderAdd);
}

// ---------- reports ----------
function period() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (report.kind === 'week') {
    const start = addDays(now, -((now.getDay() + 6) % 7) + report.offset * 7);
    const end = addDays(start, 6);
    return { from: iso(start), to: iso(end), title: `Тиждень з ${fmtDate(iso(start))} по ${fmtDate(iso(end))}` };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + report.offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const name = start.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
  return { from: iso(start), to: iso(end), title: `Місяць: ${name}` };
}

function renderReport() {
  const per = period();
  const inRange = state.entries.filter((e) => e.date >= per.from && e.date <= per.to).sort((a, b) => a.date.localeCompare(b.date));
  const total = inRange.reduce((s, e) => s + e.minutes, 0);
  const unit = report.kind === 'week' ? 'тиждень' : 'місяць';
  const sections = state.people.map((p) => {
    const es = inRange.filter((e) => e.personId === p.id);
    const sum = es.reduce((s, e) => s + e.minutes, 0);
    return `<h3>${esc(p.name)}: ${fmtDuration(sum)}</h3>
      ${es.length ? `<ul>${es.map((e) => entryLi(e, false)).join('')}</ul>` : '<p>Записів немає.</p>'}`;
  }).join('');
  shell('Звіти', `
    <label for="kind">Період</label>
    <select id="kind"><option value="week" ${report.kind === 'week' ? 'selected' : ''}>За тиждень</option>
      <option value="month" ${report.kind === 'month' ? 'selected' : ''}>За місяць</option></select>
    <div class="row">
      <button id="prev" class="secondary">Попередній ${unit}</button>
      <button id="next" class="secondary" ${report.offset >= 0 ? 'disabled' : ''}>Наступний ${unit}</button>
    </div>
    <h2 id="ptitle" tabindex="-1">${esc(per.title)}</h2>
    <p class="total">Разом: ${fmtDuration(total)}</p>
    ${state.people.length > 1 || true ? sections : ''}`);
  const $ = (id) => $app.querySelector('#' + id);
  const again = (msg) => { renderReport(); const t = $app.querySelector('#ptitle'); t.focus(); say(msg); };
  $('kind').onchange = () => { report = { kind: $('kind').value, offset: 0 }; again(period().title); };
  $('prev').onclick = () => { report.offset--; again(period().title); };
  $('next').onclick = () => { report.offset++; again(period().title); };
  bindDelete(renderReport);
}

// ---------- people ----------
function renderPeople() {
  shell('Люди', `
    <ul>${state.people.map((p) => `<li>${esc(p.name)}${p.id === 'self' ? '' : `
      <button class="danger" data-rm="${p.id}" aria-label="Видалити людину ${esc(p.name)} разом з її записами">Видалити</button>`}</li>`).join('')}</ul>
    <form id="f">
      <label for="name">Додати людину (наприклад, Марія, вчителька)</label>
      <input id="name" autocomplete="off">
      <button type="submit" id="add">Додати</button>
    </form>`);
  const $ = (id) => $app.querySelector('#' + id);
  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) return warn('Введіть імʼя.');
    await withBusy($('add'), 'Додаю…', async () => {
      try { await call('POST', '/api/people', { name }); } catch (err) { return warn(err.message); }
      await refresh(); renderPeople(); $app.querySelector('#name').focus(); say(`Додано: ${name}`);
    });
  };
  $app.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
    const n = personName(b.dataset.rm);
    const title = `Видалити людину: ${n}`;
    if (!(await confirmDialog({ title, detail: 'Усі записи цієї людини теж буде видалено. Це не можна скасувати.', okLabel: 'Видалити', opener: b }))) return;
    await withBusy(b, 'Видаляю…', async () => {
      await call('DELETE', '/api/people/' + b.dataset.rm);
      await refresh(); renderPeople(); $app.querySelector('h1').focus(); say(`Видалено: ${n}`);
    });
  }));
}

async function start() {
  try { await refresh(); } catch { return; }
  view = 'add';
  render();
  focusHeading();
}
start();
