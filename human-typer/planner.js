// Planlayıcı: metni { type: 'char' | 'back', ch?, delay } eylem listesine çevirir.
// Saf fonksiyonlardır; aynı tohum aynı planı üretir. Hem içerik betiğinde hem
// Node testlerinde çalışır.
(function (root) {
  'use strict';

  // --- rastgelelik ---------------------------------------------------------
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }
  // Ortalaması `mean` olan log-normal örnek.
  function logn(r, mean, sigma) {
    return Math.exp(Math.log(mean) - (sigma * sigma) / 2 + sigma * gauss(r));
  }

  // --- klavye düzenleri ----------------------------------------------------
  function makeLayout(locale, rows) {
    const nb = new Map();
    rows.forEach((row, ri) => {
      Array.from(row).forEach((ch, ci) => {
        const up = rows[ri - 1] ? Array.from(rows[ri - 1]) : [];
        const down = rows[ri + 1] ? Array.from(rows[ri + 1]) : [];
        const cur = Array.from(row);
        // Sıralar sağa kaydırmalı dizildiği için üstte (c, c+1), altta (c-1, c).
        const list = [cur[ci - 1], cur[ci + 1], up[ci], up[ci + 1], down[ci - 1], down[ci]];
        nb.set(ch, list.filter(Boolean));
      });
    });
    return { locale, nb };
  }
  const LAYOUTS = {
    qwerty: makeLayout('en', ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']),
    trq: makeLayout('tr', ['qwertyuıopğü', 'asdfghjklşi', 'zxcvbnmöç']),
  };

  // --- ölçülmüş / varsayılan parametreler ----------------------------------
  // "ölçüm": Dhakal 2018, Crump & Logan 2013. "varsayım": yayımlanmış değer yok.
  const P = {
    ikiSigma: 0.35, // varsayım (dağılım biçimi ölçüm, parametre değil)
    ikiFloor: 60, // ölçüm
    wordStart: 1.25, // varsayım
    upper: 1.4, // varsayım
    punct: 1.3, // varsayım
    hesitateProb: 0.04, // varsayım
    hesitateMean: 700, // varsayım (Baaijen 2012 orta bileşen ~735 ms)
    sentencePause: 900, // varsayım
    paragraphPause: 2000, // varsayım
    kindSub: 0.53, // ölçüm: %1,65 / %0,80 / %0,67 oranından
    kindOmit: 0.26,
    lagCdf: [0.48, 0.73, 0.85, 0.91, 1], // ölçüm: 0,1,2,3,4 harf sonra fark etme
    firstBack: 420, // ölçüm
    nextBack: 195, // ölçüm (170–222)
  };

  function plan(text, options) {
    const o = Object.assign({ wpm: 52, typoRate: 0.02, seed: 1, layout: 'trq' }, options);
    const L = LAYOUTS[o.layout] || LAYOUTS.trq;
    const r = rng32(o.seed);
    const mean = 60000 / (Math.max(5, o.wpm) * 5);
    const lower = (c) => c.toLocaleLowerCase(L.locale);
    const upper = (c) => c.toLocaleUpperCase(L.locale);
    const isUpper = (c) => lower(c) !== c;
    const isKey = (c) => c !== undefined && L.nb.has(lower(c));

    const chars = Array.from(String(text).replace(/\r\n?/g, '\n'));
    const out = [];
    let p1; // son yazılan karakter
    let p2; // ondan önceki

    function emit(ch) {
      let d = logn(r, mean, P.ikiSigma);
      if (p1 === undefined || p1 === ' ' || p1 === '\n') d *= P.wordStart;
      if (isUpper(ch)) d *= P.upper;
      else if (/[^\p{L}\p{N}\s]/u.test(ch)) d *= P.punct;
      if (r() < P.hesitateProb) d += logn(r, P.hesitateMean, 0.5);
      if (p1 === ' ' && p2 !== undefined && /[.!?…]/.test(p2)) d += logn(r, P.sentencePause, 0.6);
      if (p1 === '\n') d += logn(r, P.paragraphPause, 0.6);
      out.push({ type: 'char', ch, delay: Math.round(Math.max(P.ikiFloor, d)) });
      p2 = p1;
      p1 = ch;
    }

    let i = 0;
    while (i < chars.length) {
      const ch = chars[i];
      if (isKey(ch) && r() < o.typoRate) {
        // Hata, kelime sınırını geçmeden fark edilir: araya boşluk girerse
        // Docs'un otomatik düzeltmesi metnin uzunluğunu değiştirebilir.
        let maxLag = 0;
        while (maxLag < 4 && isKey(chars[i + 1 + maxLag])) maxLag++;
        const u = r();
        let kind = u < P.kindSub ? 'sub' : u < P.kindSub + P.kindOmit ? 'omit' : 'ins';
        const v = r();
        let lag = Math.min(P.lagCdf.findIndex((c) => v < c), maxLag);
        if (kind === 'omit' && lag === 0) {
          if (maxLag >= 1) lag = 1; // eksik harf ancak sonraki harften sonra görülür
          else kind = 'sub';
        }
        const near = L.nb.get(lower(ch));
        const pick = near[Math.floor(r() * near.length)];
        const wrong = isUpper(ch) ? upper(pick) : pick;

        let typed = 0;
        if (kind === 'sub') {
          emit(wrong);
          typed = 1;
        } else if (kind === 'ins') {
          emit(wrong);
          emit(ch);
          typed = 2;
        }
        for (let j = 1; j <= lag; j++) {
          emit(chars[i + j]);
          typed++;
        }
        for (let b = 0; b < typed; b++) {
          const d = b === 0 ? logn(r, P.firstBack, 0.3) : logn(r, P.nextBack, 0.2);
          out.push({ type: 'back', delay: Math.round(Math.max(P.ikiFloor, d)) });
        }
        p1 = chars[i - 1];
        p2 = chars[i - 2];
        for (let j = 0; j <= lag; j++) emit(chars[i + j]);
        i += lag + 1;
        continue;
      }
      emit(ch);
      i++;
    }
    // Çarpanlar, duraklamalar ve düzeltmeler toplam süreyi uzatır. Ölçülen
    // hızlar bunları zaten içerdiği için plan, istenen hıza göre ölçeklenir.
    const total = out.reduce((s, a) => s + a.delay, 0);
    if (total > 0) {
      const k = (chars.length * mean) / total;
      for (const a of out) a.delay = Math.round(Math.max(P.ikiFloor, a.delay * k));
    }
    return out;
  }

  // Bir planı bellekte oynatır; testlerde ve tahmini süre için kullanılır.
  function simulate(actions) {
    const buf = [];
    for (const a of actions) {
      if (a.type === 'char') buf.push(a.ch);
      else if (a.type === 'back') buf.pop();
    }
    return buf.join('');
  }
  function summarize(actions) {
    let ms = 0;
    let backs = 0;
    for (const a of actions) {
      ms += a.delay;
      if (a.type === 'back') backs++;
    }
    return { ms, backs, keys: actions.length };
  }

  const api = { plan, simulate, summarize, LAYOUTS };
  root.HumanTyperPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
