// Parses spoken-style Ukrainian sentences like "Марія вчора година десять" into person, date and minutes; also formats durations and dates in Ukrainian
(function (root) {
  const UNITS = {
    нуль: 0, один: 1, одна: 1, одну: 1, два: 2, дві: 2, двох: 2, три: 3, трьох: 3, чотири: 4, чотирьох: 4,
    "п'ять": 5, шість: 6, сім: 7, вісім: 8, "дев'ять": 9, десять: 10, одинадцять: 11, дванадцять: 12,
    тринадцять: 13, чотирнадцять: 14, "п'ятнадцять": 15, шістнадцять: 16, сімнадцять: 17, вісімнадцять: 18,
    "дев'ятнадцять": 19,
  };
  const TENS = { двадцять: 20, тридцять: 30, сорок: 40, "п'ятдесят": 50, шістдесят: 60, сімдесят: 70, вісімдесят: 80, "дев'яносто": 90 };
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const WEEKDAYS = { понеділ: 1, вівтор: 2, серед: 3, четвер: 4, "п'ятниц": 5, субот: 6, неділ: 0 };

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[’ʼ`]/g, "'").replace(/[,;!?]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function wordsToDigits(text) {
    const toks = text.split(' ');
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i].replace(/\.$/, '');
      if (w in TENS) {
        let n = TENS[w];
        const nx = (toks[i + 1] || '').replace(/\.$/, '');
        if (nx in UNITS && UNITS[nx] > 0 && UNITS[nx] < 10) { n += UNITS[nx]; i++; }
        out.push(String(n));
      } else if (w in UNITS) out.push(String(UNITS[w]));
      else out.push(toks[i]);
    }
    return out.join(' ');
  }

  function parseDate(text, today) {
    let m;
    if (/позавчора/.test(text)) return { date: iso(addDays(today, -2)), rest: text.replace('позавчора', ' ') };
    if (/вчора/.test(text)) return { date: iso(addDays(today, -1)), rest: text.replace('вчора', ' ') };
    if (/сьогодні/.test(text)) return { date: iso(today), rest: text.replace('сьогодні', ' ') };
    if ((m = /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/.exec(text))) {
      let y = m[3] ? +m[3] : today.getFullYear();
      if (y < 100) y += 2000;
      const d = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && d > today) d.setFullYear(y - 1);
      return { date: iso(d), rest: text.replace(m[0], ' ') };
    }
    for (let i = 0; i < 12; i++) {
      const re = new RegExp(`(\\d{1,2})(?:-?го)?\\s+${MONTHS[i]}(?:\\s+(\\d{4}))?`);
      if ((m = re.exec(text))) {
        let y = m[2] ? +m[2] : today.getFullYear();
        const d = new Date(y, i, +m[1]);
        if (!m[2] && d > today) d.setFullYear(y - 1);
        return { date: iso(d), rest: text.replace(m[0], ' ') };
      }
    }
    for (const stem in WEEKDAYS) {
      if (text.includes(stem)) {
        let diff = (today.getDay() - WEEKDAYS[stem] + 7) % 7;
        return { date: iso(addDays(today, -diff)), rest: text.replace(new RegExp(stem + '\\S*'), ' ') };
      }
    }
    return { date: null, rest: text };
  }

  function parseDuration(text) {
    let m;
    if ((m = /(\d{1,2}):(\d{2})/.exec(text))) return +m[1] * 60 + +m[2];
    if (/півтори/.test(text)) return 90;
    if ((m = /(\d+)\s*з половиною/.exec(text))) return +m[1] * 60 + 30;
    if (/(пів\s?години|півгодини)/.test(text)) return 30;
    if ((m = /(\d+)\s*год\S*(?:\s+(\d+)(?:\s*хв\S*)?)?/.exec(text))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
    if ((m = /(?:^|\s)година(?:\s+(\d+))?/.exec(text))) return 60 + (m[1] ? +m[1] : 0);
    if ((m = /(\d+)\s*хв\S*/.exec(text))) return +m[1];
    if ((m = /(?:^|\s)(\d+)(?:\s|$)/.exec(text))) return +m[1]; // a bare number means minutes
    return null;
  }

  function parseSentence(input, people, today = new Date()) {
    let t = wordsToDigits(normalize(input));
    const { date, rest } = parseDate(t, today);
    const minutes = parseDuration(rest);
    let person = null, best = 0;
    for (const p of people) {
      if (p.id === 'self') continue;
      const n = normalize(p.name);
      const stem = n.slice(0, Math.max(3, n.length - 2));
      if (rest.includes(stem) && stem.length > best) { person = p; best = stem.length; }
    }
    if (!person && /(^|\s)(я|сама|мною|мої|мене)(\s|$)/.test(rest)) person = people.find((p) => p.id === 'self') || null;
    return { personId: person && person.id, date, minutes: minutes && minutes > 0 ? minutes : null };
  }

  const plural = (n, f) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2]; };
  function fmtDuration(min) {
    if (!min) return '0 хвилин';
    const h = Math.floor(min / 60), m = min % 60, parts = [];
    if (h) parts.push(`${h} ${plural(h, ['година', 'години', 'годин'])}`);
    if (m) parts.push(`${m} ${plural(m, ['хвилина', 'хвилини', 'хвилин'])}`);
    return parts.join(' ');
  }
  function fmtDate(isoStr, withYear) {
    const [y, mo, d] = isoStr.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
  }

  function fmtDateParts(isoStr) {
    const [y, mo, d] = isoStr.split('-').map(Number);
    const dt = new Date(y, mo - 1, d);
    return {
      weekday: dt.toLocaleDateString('uk-UA', { weekday: 'long' }),
      dayMonth: dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }),
    };
  }

  const api = { parseSentence, parseDate, fmtDuration, fmtDate, fmtDateParts, iso, addDays };
  if (typeof module !== 'undefined') module.exports = api; else root.P = api;
})(this);
