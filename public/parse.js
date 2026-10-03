// Parses spoken-style sentences like "Maria yesterday one hour ten" into person, date and minutes,
// and formats durations and dates. Each language is a locale object below; to add German,
// add a `de` locale with the same shape (number words, date words, months, weekdays, duration rules).
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // Decimal numbers like "1.5 hours" must not be mistaken for the date "1.5"
  const DOTTED = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)(?!\s*(?:h\b|hr|hour|год))/;

  // Replaces spelled-out numbers ("fifty five") with digits.
  function wordsToDigits(text, units, tens) {
    const toks = text.split(' ');
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i];
      if (w in tens) {
        let n = tens[w];
        const nx = toks[i + 1];
        if (nx in units && units[nx] > 0 && units[nx] < 10) { n += units[nx]; i++; }
        out.push(String(n));
      } else if (w in units) out.push(String(units[w]));
      else out.push(w);
    }
    return out.join(' ');
  }

  const plural3 = (n, f) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2]; };

  // ---------------------------------------------------------------- English
  const EN_MONTHS = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?', 'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];
  const en = {
    intl: 'en-GB',
    units: { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 },
    tens: { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
    normalize: (s) => s.replace(/-/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim(),
    dayBefore: /day before yesterday/,
    yesterday: /\byesterday\b/,
    today: /\btoday\b/,
    monthPatterns: (i) => [
      { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${EN_MONTHS[i]}\\b(?:\\s+(\\d{4}))?`), d: 1, y: 2 },
      { re: new RegExp(`\\b${EN_MONTHS[i]}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`), d: 1, y: 2 },
    ],
    weekdays: [['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6], ['sunday', 0]],
    selfRe: /\b(i|me|myself|my)\b/,
    nameMatch: (rest, name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(rest),
    duration(text) {
      let m;
      if ((m = /(\d{1,2}):(\d{2})/.exec(text))) return +m[1] * 60 + +m[2];
      if ((m = /(\d+)\s*(?:a )?half (?:an? )?hours?/.exec(text)) || (m = /(\d+) a half/.exec(text))) return +m[1] * 60 + 30;
      if (/\ban? hour a half\b/.test(text)) return 90;
      if (/\bhalf (?:an? )?hour\b/.test(text)) return 30;
      if ((m = /(\d+\.\d+)\s*(?:h|hrs?|hours?)\b/.exec(text))) return Math.round(parseFloat(m[1]) * 60);
      if ((m = /(\d+)\s*(?:h|hrs?|hours?)\b(?:\s+(\d+)(?:\s*(?:m|mins?|minutes?)\b)?)?/.exec(text))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
      if ((m = /\ban?\s+hour\b(?:\s+(\d+))?/.exec(text))) return 60 + (m[1] ? +m[1] : 0);
      if ((m = /(\d+)\s*(?:m|mins?|minutes?)\b/.exec(text))) return +m[1];
      if ((m = /(?:^|\s)(\d+)(?:\s|$)/.exec(text))) return +m[1]; // a bare number means minutes
      return null;
    },
    fmtDuration(h, m) {
      const p = [];
      if (h) p.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
      if (m) p.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
      return p.join(' ');
    },
    zero: '0 minutes',
  };

  // ---------------------------------------------------------------- Ukrainian
  const UK_MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const uk = {
    intl: 'uk-UA',
    units: { нуль: 0, один: 1, одна: 1, одну: 1, два: 2, дві: 2, двох: 2, три: 3, трьох: 3, чотири: 4, чотирьох: 4, "п'ять": 5, шість: 6, сім: 7, вісім: 8, "дев'ять": 9, десять: 10, одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14, "п'ятнадцять": 15, шістнадцять: 16, сімнадцять: 17, вісімнадцять: 18, "дев'ятнадцять": 19 },
    tens: { двадцять: 20, тридцять: 30, сорок: 40, "п'ятдесят": 50, шістдесят: 60, сімдесят: 70, вісімдесят: 80, "дев'яносто": 90 },
    normalize: (s) => s.replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ').trim(),
    dayBefore: /позавчора/,
    yesterday: /вчора/,
    today: /сьогодні/,
    monthPatterns: (i) => [{ re: new RegExp(`(\\d{1,2})(?:-?го)?\\s+${UK_MONTHS[i]}(?:\\s+(\\d{4}))?`), d: 1, y: 2 }],
    weekdays: [['понеділ', 1], ['вівтор', 2], ['серед', 3], ['четвер', 4], ["п'ятниц", 5], ['субот', 6], ['неділ', 0]],
    selfRe: /(^|\s)(я|сама|мною|мої|мене)(\s|$)/,
    nameMatch: (rest, name) => rest.includes(name.slice(0, Math.max(3, name.length - 2))), // tolerate case endings
    duration(text) {
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
    },
    fmtDuration(h, m) {
      const p = [];
      if (h) p.push(`${h} ${plural3(h, ['година', 'години', 'годин'])}`);
      if (m) p.push(`${m} ${plural3(m, ['хвилина', 'хвилини', 'хвилин'])}`);
      return p.join(' ');
    },
    zero: '0 хвилин',
  };

  const LOCALES = { en, uk };

  function forLang(lang) {
    const L = LOCALES[lang] || en;

    function parseDate(text, today) {
      let m;
      for (const [key, off] of [['dayBefore', -2], ['yesterday', -1], ['today', 0]]) {
        if ((m = L[key].exec(text))) return { date: iso(addDays(today, off)), rest: text.replace(m[0], ' ') };
      }
      if ((m = DOTTED.exec(text))) {
        let y = m[3] ? +m[3] : today.getFullYear();
        if (y < 100) y += 2000;
        const d = new Date(y, +m[2] - 1, +m[1]);
        if (!m[3] && d > today) d.setFullYear(y - 1);
        return { date: iso(d), rest: text.replace(m[0], ' ') };
      }
      for (let i = 0; i < 12; i++) {
        for (const { re, d: gd, y: gy } of L.monthPatterns(i)) {
          if ((m = re.exec(text))) {
            const y = m[gy] ? +m[gy] : today.getFullYear();
            const d = new Date(y, i, +m[gd]);
            if (!m[gy] && d > today) d.setFullYear(y - 1);
            return { date: iso(d), rest: text.replace(m[0], ' ') };
          }
        }
      }
      for (const [stem, idx] of L.weekdays) {
        if (text.includes(stem)) {
          const diff = (today.getDay() - idx + 7) % 7;
          return { date: iso(addDays(today, -diff)), rest: text.replace(new RegExp(stem + '\\S*'), ' ') };
        }
      }
      return { date: null, rest: text };
    }

    function parseSentence(input, people, today = new Date()) {
      const lowered = String(input || '').toLowerCase().replace(/[,;!?]/g, ' ');
      const text = wordsToDigits(L.normalize(lowered), L.units, L.tens);
      const { date, rest } = parseDate(text, today);
      const minutes = L.duration(rest);
      let person = null, best = 0;
      for (const p of people) {
        if (p.id === 'self') continue;
        const n = L.normalize(p.name.toLowerCase());
        if (n.length > best && L.nameMatch(rest, n)) { person = p; best = n.length; }
      }
      if (!person && L.selfRe.test(rest)) person = people.find((p) => p.id === 'self') || null;
      return { personId: person && person.id, date, minutes: minutes && minutes > 0 ? minutes : null };
    }

    const fmtDuration = (min) => (min ? L.fmtDuration(Math.floor(min / 60), min % 60) : L.zero);
    const parts = (isoStr) => { const [y, mo, d] = isoStr.split('-').map(Number); return new Date(y, mo - 1, d); };
    const fmtDate = (isoStr, withYear) => parts(isoStr).toLocaleDateString(L.intl, { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
    const fmtDateParts = (isoStr) => ({
      weekday: parts(isoStr).toLocaleDateString(L.intl, { weekday: 'long' }),
      dayMonth: parts(isoStr).toLocaleDateString(L.intl, { day: 'numeric', month: 'long' }),
    });
    return { parseSentence, parseDate, fmtDuration, fmtDate, fmtDateParts, intl: L.intl };
  }

  const api = { forLang, iso, addDays };
  if (typeof module !== 'undefined') module.exports = api; else root.P = api;
})(this);
