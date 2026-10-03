// Parses spoken-style sentences like "Maria yesterday one hour ten" into person, date and minutes,
// and formats durations and dates. Each language is a locale object below; to add German,
// add a `de` locale with the same shape (number words, date words, months, weekdays, duration rules).
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // Decimal numbers like "1.5 hours" must not be mistaken for the date "1.5"
  const DOTTED = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)(?!\s*(?:h\b|hr|hour|год|std|stund))/;

  // Replaces spelled-out numbers ("fifty five") with digits.
  function wordsToDigits(text, units, tens, compound) {
    const toks = text.split(' ');
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i];
      const c = compound && compound(w);
      if (c != null) out.push(String(c));
      else if (w in tens) {
        let n = tens[w];
        const nx = toks[i + 1];
        if (nx in units && units[nx] > 0 && units[nx] < 10) { n += units[nx]; i++; }
        out.push(String(n));
      } else if (w in units) out.push(String(units[w]));
      else out.push(w);
    }
    return out.join(' ');
  }

  // Simplified spelling used to compare names by sound: katharina and katerina both become "katarina".
  const soundKey = (w) => w
    .replace(/[^\p{L}]/gu, '')
    .replace(/ß/g, 'ss').replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k').replace(/c(?=[aouäöü])/g, 'k').replace(/ch/g, 'h')
    .replace(/([aeiouäöüy])h/g, '$1').replace(/y/g, 'i').replace(/(.)\1+/g, '$1')
    .replace(/[eä]/g, 'a');
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
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

  // ---------------------------------------------------------------- German
  const DE_MONTHS = ['jan(?:uar)?', 'feb(?:ruar)?', 'mär(?:z)?', 'apr(?:il)?', 'mai', 'juni?', 'juli?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'okt(?:ober)?', 'nov(?:ember)?', 'dez(?:ember)?'];
  const DE_UNITS = { null: 0, ein: 1, eins: 1, eine: 1, einen: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
  const DE_TENS = { zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
  const DE_ORD = { erst: 1, zweit: 2, dritt: 3, viert: 4, fünft: 5, sechst: 6, siebt: 7, acht: 8, neunt: 9, zehnt: 10, elft: 11, zwölft: 12,
    dreizehnt: 13, vierzehnt: 14, fünfzehnt: 15, sechzehnt: 16, siebzehnt: 17, achtzehnt: 18, neunzehnt: 19, zwanzigst: 20, dreißigst: 30, dreissigst: 30 };
  function deOrdinal(stem) {
    if (stem in DE_ORD) return DE_ORD[stem];
    const m = /^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzigst|dreißigst|dreissigst)$/.exec(stem);
    return m ? DE_ORD[m[2]] + DE_UNITS[m[1]] : null;
  }
  const de = {
    intl: 'de-DE',
    units: DE_UNITS,
    tens: DE_TENS,
    // German writes compound numbers as one word: fünfundfünfzig = 55
    compound(w) {
      const m = /^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzig|dreißig|dreissig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)$/.exec(w);
      if (m) return DE_TENS[m[2]] + DE_UNITS[m[1]];
      // Ordinal words used for dates: "fünfzehnter Oktober" -> 15
      const o = /^(.+?)(?:e|en|er|es|em)?$/.exec(w);
      return o ? deOrdinal(o[1]) : null;
    },
    normalize: (s) => s.replace(/\bund\b/g, ' ').replace(/\s+/g, ' ').trim(),
    dayBefore: /vorgestern/,
    yesterday: /gestern/,
    today: /heute/,
    monthPatterns: (i) => [{ re: new RegExp(`(?:^|\\s)(\\d{1,2})\\.?\\s*${DE_MONTHS[i]}(?![a-zäöü])(?:\\s+(\\d{4}))?`), d: 1, y: 2 }],
    weekdays: [['montag', 1], ['dienstag', 2], ['mittwoch', 3], ['donnerstag', 4], ['freitag', 5], ['samstag', 6], ['sonnabend', 6], ['sonntag', 0]],
    selfRe: /(^|\s)(ich|mir|mich|selbst|meine|mein)(\s|$)/,
    nameMatch: (rest, name) => new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(rest), // also matches "Marias"
    duration(text) {
      let m;
      if ((m = /(\d{1,2}):(\d{2})/.exec(text))) return +m[1] * 60 + +m[2];
      if (/anderthalb/.test(text)) return 90;
      if ((m = /(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)einhalb/.exec(text))) return DE_UNITS[m[1]] * 60 + 30;
      if ((m = /(\d+)\s*einhalb/.exec(text))) return +m[1] * 60 + 30;
      if (/dreiviertel\s?stunde/.test(text)) return 45;
      if (/viertel\s?stunde/.test(text)) return 15;
      if (/halbe?\s+stunde/.test(text)) return 30;
      if ((m = /(\d+\.\d+)\s*(?:std\.?|stunden?|h)(?![a-zäöü])/.exec(text))) return Math.round(parseFloat(m[1]) * 60);
      if ((m = /(\d+)\s*(?:std\.?|stunden?|h)(?![a-zäöü])(?:\s+(\d+)(?:\s*(?:min\w*|m)(?![a-zäöü]))?)?/.exec(text))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
      if ((m = /(?:^|\s)stunde(?![a-zäöü])(?:\s+(\d+))?/.exec(text))) return 60 + (m[1] ? +m[1] : 0);
      if ((m = /(\d+)\s*(?:min\w*|m)(?![a-zäöü])/.exec(text))) return +m[1];
      if ((m = /(?:^|\s)(\d+)(?:\s|$)/.exec(text))) return +m[1]; // a bare number means minutes
      return null;
    },
    fmtDuration(h, m) {
      const p = [];
      if (h) p.push(`${h} ${h === 1 ? 'Stunde' : 'Stunden'}`);
      if (m) p.push(`${m} ${m === 1 ? 'Minute' : 'Minuten'}`);
      return p.join(' ');
    },
    zero: '0 Minuten',
  };

  const LOCALES = { en, uk, de };

  function forLang(lang) {
    const L = LOCALES[lang] || en;

    // Without a year, a date in the future is read as last year's (entries are about the past) unless allowFuture is set (reports).
    function parseDate(text, today, allowFuture = false) {
      let m;
      for (const [key, off] of [['dayBefore', -2], ['yesterday', -1], ['today', 0]]) {
        if ((m = L[key].exec(text))) return { date: iso(addDays(today, off)), rest: text.replace(m[0], ' ') };
      }
      if ((m = DOTTED.exec(text))) {
        let y = m[3] ? +m[3] : today.getFullYear();
        if (y < 100) y += 2000;
        const d = new Date(y, +m[2] - 1, +m[1]);
        if (!m[3] && !allowFuture && d > today) d.setFullYear(y - 1);
        return { date: iso(d), rest: text.replace(m[0], ' ') };
      }
      for (let i = 0; i < 12; i++) {
        for (const { re, d: gd, y: gy } of L.monthPatterns(i)) {
          if ((m = re.exec(text))) {
            const y = m[gy] ? +m[gy] : today.getFullYear();
            const d = new Date(y, i, +m[gd]);
            if (!m[gy] && !allowFuture && d > today) d.setFullYear(y - 1);
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
      // "1,5" is a decimal number, other commas are just separators
      const lowered = String(input || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[,;!?]/g, ' ');
      const text = wordsToDigits(L.normalize(lowered), L.units, L.tens, L.compound);
      const { date, rest } = parseDate(text, today);
      const minutes = L.duration(rest);
      let person = null, best = 0;
      for (const p of people) {
        if (p.id === 'self') continue;
        const n = L.normalize(p.name.toLowerCase());
        if (n.length > best && L.nameMatch(rest, n)) { person = p; best = n.length; }
      }
      // Speech recognition often spells a name differently ("Katerina" / "Katharina"): fall back to a similar-sounding match.
      if (!person) {
        let bestDist = Infinity;
        for (const p of people) {
          if (p.id === 'self') continue;
          const n = soundKey(L.normalize(p.name.toLowerCase()));
          if (n.length < 3) continue;
          for (const w of rest.split(' ')) {
            const k = soundKey(w);
            if (k.length < 3) continue;
            const d = editDistance(k, n);
            const allowed = n.length >= 7 ? 2 : 1;
            if (d <= allowed && d < bestDist) { bestDist = d; person = p; }
          }
        }
      }
      if (!person && L.selfRe.test(rest)) person = people.find((p) => p.id === 'self') || null;
      return { personId: person && person.id, date, minutes: minutes && minutes > 0 ? minutes : null };
    }

    // A date spoken on its own ("fünfzehnter Oktober", "1.10", "gestern"); null if none was understood.
    function parseDateText(input, today = new Date(), allowFuture = false) {
      const lowered = String(input || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[,;!?]/g, ' ');
      return parseDate(wordsToDigits(L.normalize(lowered), L.units, L.tens, L.compound), today, allowFuture).date;
    }

    const fmtDuration = (min) => (min ? L.fmtDuration(Math.floor(min / 60), min % 60) : L.zero);
    const parts = (isoStr) => { const [y, mo, d] = isoStr.split('-').map(Number); return new Date(y, mo - 1, d); };
    const fmtDate = (isoStr, withYear) => parts(isoStr).toLocaleDateString(L.intl, { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
    const fmtDateParts = (isoStr) => ({
      weekday: parts(isoStr).toLocaleDateString(L.intl, { weekday: 'long' }),
      dayMonth: parts(isoStr).toLocaleDateString(L.intl, { day: 'numeric', month: 'long' }),
    });
    return { parseSentence, parseDate, parseDateText, fmtDuration, fmtDate, fmtDateParts, intl: L.intl };
  }

  const api = { forLang, iso, addDays };
  if (typeof module !== 'undefined') module.exports = api; else root.P = api;
})(this);
