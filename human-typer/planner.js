// Planner: turns text or a structured document into a list of timed actions.
//
//   plan(text, opts)                  plain string  -> char/back actions
//   planBlock(doc, index, opts, carry) one document block -> actions + new carry
//
// Everything here is a pure function of its arguments: the same seed gives the
// same plan. The file has no dependencies and runs both in the content script
// and in the Node tests.
//
// Action vocabulary (`delay` = integer ms to wait BEFORE performing the action):
//   { type: 'char',   ch, delay }          type one character (never '\n' in planBlock)
//   { type: 'back',   delay }              one Backspace
//   { type: 'key',    key, delay }         'Enter' | 'Tab' | 'ShiftTab' | 'ArrowDown'
//   { type: 'format', op, delay }          see FORMAT_OPS; 'list:none' also carries
//                                          kind and level of the list being left
//   { type: 'table',  rows, cols, delay }  insert an empty table, caret in first cell
//   { type: 'pageNumbers', where, skipFirst, delay }  Docs' page-number tool:
//                                          caret ends in that header/footer
//   { type: 'para', style, align, fmt, text, font, empty?, delay }  rich mode:
//                                          paste a whole paragraph (props + first
//                                          text) then join the empty one after it
//   key 'PageBreak' ends the paragraph with a page break (Cmd/Ctrl+Enter)
//   key 'OpenHeader' / 'OpenFooter' moves the caret into the (new, empty) page
//   header / footer; key 'Escape' returns it to the body where it was.
//   { type: 'image',  id, width, height, delay } paste picture `id` (size in pt,
//                                          0 = natural) into the caret's empty
//                                          paragraph; the executor adds `src`;
//                                          maxWidth (pt) inside a table cell
//   { type: 'paste',  text, delay, style? } paste `text` in one go (links). With
//                                          `style` ({ family?, size?, bold, italic,
//                                          underline, strike }) it is pasted in that
//                                          font, so the text typed after it follows
(function (root) {
  'use strict';

  // --- randomness ----------------------------------------------------------
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
  // Log-normal sample whose mean is `mean`.
  function logn(r, mean, sigma) {
    return Math.exp(Math.log(mean) - (sigma * sigma) / 2 + sigma * gauss(r));
  }
  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }
  // Independent stream seed for (seed, index): a block's plan must not depend
  // on how many random numbers earlier blocks consumed.
  function mixSeed(seed, index) {
    let h = (seed >>> 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h ^= Math.imul((index + 1) | 0, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // --- keyboard layouts ----------------------------------------------------
  function makeLayout(locale, rows) {
    const nb = new Map();
    rows.forEach((row, ri) => {
      Array.from(row).forEach((ch, ci) => {
        const up = rows[ri - 1] ? Array.from(rows[ri - 1]) : [];
        const down = rows[ri + 1] ? Array.from(rows[ri + 1]) : [];
        const cur = Array.from(row);
        // Rows are staggered to the right, so the neighbours are (c, c+1)
        // above and (c-1, c) below.
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

  // 'trq' when the text looks Turkish, otherwise 'qwerty'. Accepts a string or
  // a Doc. ı ğ ş are unique to Turkish among Latin-script languages commonly
  // typed; ç ö ü alone also occur in German, French etc., so several are needed.
  function detectLayout(text) {
    const s = text && typeof text === 'object' ? docText(text) : String(text == null ? '' : text);
    if (/[ığşİĞŞ]/.test(s)) return 'trq';
    const soft = s.match(/[çöüÇÖÜ]/g);
    return soft && soft.length >= 3 ? 'trq' : 'qwerty';
  }

  // --- measured / assumed parameters ---------------------------------------
  // "measured": Dhakal 2018, Crump & Logan 2013. "assumed": no published value.
  const P = {
    ikiSigma: 0.35, // assumed (the distribution shape is measured, the parameter is not)
    ikiFloor: 60, // measured
    wordStart: 1.25, // assumed
    upper: 1.4, // assumed
    punct: 1.3, // assumed
    hesitateProb: 0.04, // assumed
    hesitateMean: 700, // assumed (Baaijen 2012 middle component ~735 ms)
    sentencePause: 900, // assumed
    paragraphPause: 2000, // assumed
    inWord: 0.92, // assumed
    repeat: 0.86, // measured: repeated key 176 ms, same hand ~204–215 ms
    burstPause: 1100, // assumed (5–12 words per burst is a secondary source)
    thinkPause: 1500, // assumed
    distractProb: 0.004, // assumed
    fatigue: 0.06, // measured: 5–7 % over 100 minutes
    kindSub: 0.53, // measured: from the 1.65 % / 0.80 % / 0.67 % ratio
    kindOmit: 0.26,
    lagCdf: [0.48, 0.73, 0.85, 0.91, 1], // measured: error noticed 0,1,2,3,4 letters later
    firstBack: 420, // measured
    nextBack: 195, // measured (170–222)
    pasteLink: [2600, 0.35, 1200, 6000], // assumed: switch to the source tab, copy the link, come back, paste
    sectionOpen: [1800, 0.35, 900, 4000], // assumed: moving into the header/footer
    // The writer leaves for the picture (finds it, copies it, comes back)
    // and only then pastes it: a long pause before every image. Assumed.
    imagePaste: [30000, 0.4, 15000, 75000],
    menuTrip: [3200, 0.3, 2000, 6000], // assumed: Insert › Page elements › Page numbers
    fontKey: [300, 0.4, 120, 700], // assumed: the styled first character of a paragraph, like a keystroke

    // Structural actions. All assumed: there is no published keystroke data
    // for formatting shortcuts or table handling. [mean, sigma, min, max] in ms.
    shortcut: [430, 0.3, 250, 800], // bold/italic/style/list/align shortcut chord
    indentKey: [280, 0.3, 180, 500], // indent / outdent (a single Tab-like key)
    enterKey: [260, 0.3, 120, 600], // Enter between paragraphs
    cellMove: [520, 0.3, 300, 900], // Tab to the next cell / ArrowDown out of the table
    tableInsert: [2400, 0.3, 1500, 4000], // menu trip to insert a table
    cellParagraphPause: 600, // assumed: thinking pause between paragraphs inside a cell
    poolChars: 300, // assumed: weight (in characters) of the reference speed, see normalise()

    // Automatic speed (no opts.wpm). The ~52 wpm mean is measured (Dhakal
    // 2018); the spread kept here and the drift over the document are assumed.
    autoWpm: [52, 0.13, 40, 68], // base speed of the document's writer
    // opts.speed presets for the base speed (assumed; same drift on top).
    speeds: {
      slow: [40, 0.1, 33, 48],
      normal: [62, 0.1, 52, 72],
      fast: [88, 0.1, 75, 102],
    },
    autoDrift: [0.75, 1.3], // per-block factor on the base speed
    restProb: 0.06, // assumed: share of blocks that start with a longer rest
    restMs: [5000, 25000], // assumed
    restAfterBreak: 1.6, // assumed: rests are likelier and longer after a heading or table
  };

  // `wpm` here is the default of plan(); planBlock/estimate treat a missing
  // wpm as "automatic" (see targetWpm).
  const DEFAULTS = { wpm: 52, typoRate: 0.02, seed: 1, layout: 'trq' };
  const INLINE = ['bold', 'italic', 'underline', 'strike'];
  const STYLES = ['normal', 'title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const ALIGNS = ['left', 'center', 'right', 'justify'];
  const FORMAT_OPS = INLINE.concat(
    STYLES.map((s) => 'style:' + s),
    ['list:bullet', 'list:number', 'list:none', 'indent', 'outdent'],
    ALIGNS.map((a) => 'align:' + a)
  );

  // Session profile: each seed behaves like a slightly different "writer".
  // Consumes exactly seven numbers from `r`.
  function makeProfile(r) {
    return {
      sigma: 0.28 + r() * 0.17, // spread of the inter-key interval
      tempoRho: 0.94 + r() * 0.05, // how slowly the tempo drifts
      tempoSd: 0.03 + r() * 0.04, // how far the tempo drifts
      hesitate: 0.02 + r() * 0.05, // probability of a mid-word hesitation
      think: 0.03 + r() * 0.06, // probability of thinking at a word start
      burst: 4 + Math.floor(r() * 8), // words typed in one burst
      typoBias: 0.7 + r() * 0.6,
    };
  }

  // The human timing model. `type(chars)` emits char/back actions for one
  // uninterrupted stretch of text through `sink`; typos and their corrections
  // never reach outside that stretch.
  function makeTypist(r, prof, o, L, sink) {
    const mean = meanIki(o);
    const lower = (c) => c.toLocaleLowerCase(L.locale);
    const upper = (c) => c.toLocaleUpperCase(L.locale);
    const isUpper = (c) => lower(c) !== c;
    const isKey = (c) => c !== undefined && L.nb.has(lower(c));

    let p1; // last typed character
    let p2; // the one before it
    let tempo = 0; // slowly drifting speed on a log scale (AR(1))
    let wordMul = 1; // speed of the current word
    let posInWord = 0;
    let burstLeft = 2 + Math.floor(r() * prof.burst * 1.5);
    let elapsed = 0;

    function emit(ch) {
      tempo = prof.tempoRho * tempo + prof.tempoSd * gauss(r);
      const wordStart = p1 === undefined || p1 === ' ' || p1 === '\n';
      if (wordStart) {
        wordMul = logn(r, 1, 0.18);
        posInWord = 0;
      }
      let d = logn(r, mean, prof.sigma) * Math.exp(tempo) * wordMul;
      if (wordStart) d *= P.wordStart;
      else if (posInWord >= 2) d *= P.inWord; // speeds up as the word progresses
      if (p1 !== undefined && lower(ch) === lower(p1)) d *= P.repeat;
      if (isUpper(ch)) d *= P.upper;
      else if (/[^\p{L}\p{N}\s]/u.test(ch)) d *= P.punct;
      if (r() < prof.hesitate) d += logn(r, P.hesitateMean, 0.5);

      if (p1 === '\n') {
        d += logn(r, P.paragraphPause, 0.6);
      } else if (p1 === ' ') {
        if (p2 !== undefined && /[.!?…]/.test(p2)) {
          d += logn(r, P.sentencePause, 0.6);
        } else if (--burstLeft <= 0) {
          d += logn(r, P.burstPause, 0.5); // between bursts
          burstLeft = 2 + Math.floor(r() * prof.burst * 1.5);
        } else if (r() < prof.think) {
          d += logn(r, P.thinkPause, 0.7); // searching for a word
        }
        if (r() < P.distractProb) d += 4000 + r() * 8000; // distraction
      }
      d *= 1 + P.fatigue * Math.min(1, elapsed / 6e6); // ~6 % slower after 100 minutes
      elapsed += d;
      posInWord++;
      sink({ type: 'char', ch, delay: Math.round(Math.max(P.ikiFloor, d)) });
      p2 = p1;
      p1 = ch;
    }

    function type(chars) {
      let i = 0;
      while (i < chars.length) {
        const ch = chars[i];
        // Typos are more likely in fast stretches.
        const typoP = Math.min(0.5, o.typoRate * prof.typoBias * Math.exp(-1.2 * tempo));
        if (isKey(ch) && r() < typoP) {
          // The typo is noticed before the word ends (and before `chars`
          // ends): once a space is typed, Docs autocorrect could change the
          // length of the text and the Backspace count would be wrong.
          let maxLag = 0;
          while (maxLag < 4 && isKey(chars[i + 1 + maxLag])) maxLag++;
          const u = r();
          let kind = u < P.kindSub ? 'sub' : u < P.kindSub + P.kindOmit ? 'omit' : 'ins';
          const v = r();
          let lag = Math.min(P.lagCdf.findIndex((c) => v < c), maxLag);
          if (kind === 'omit' && lag === 0) {
            if (maxLag >= 1) lag = 1; // a missing letter only shows after the next one
            else kind = 'sub';
          }
          const near = L.nb.get(lower(ch));
          const pick = near[Math.floor(r() * near.length)];
          const wrong = isUpper(ch) ? upper(pick) : pick;
          const before1 = p1;
          const before2 = p2;

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
            sink({ type: 'back', delay: Math.round(Math.max(P.ikiFloor, d)) });
          }
          p1 = before1;
          p2 = before2;
          for (let j = 0; j <= lag; j++) emit(chars[i + j]);
          i += lag + 1;
          continue;
        }
        emit(ch);
        i++;
      }
    }

    return {
      type,
      // Start of a new paragraph or cell: the next character starts a word.
      reset() {
        p1 = undefined;
        p2 = undefined;
      },
      // Text that reached the page without being typed (a paste): the next
      // character follows its last two characters.
      after(text) {
        const a = Array.from(text);
        if (a.length) p1 = a[a.length - 1];
        if (a.length > 1) p2 = a[a.length - 2];
      },
    };
  }

  // Splits text into [{ text, link }] segments. Links (http(s)://… or www.…)
  // are pasted, not typed: nobody types a URL out by hand. Trailing sentence
  // punctuation and an unbalanced closing bracket stay outside the link.
  const LINK_RE = /(?:https?:\/\/|www\.)[^\s<>"]+/giu;
  function trimLink(url) {
    let u = url.replace(/[.,;:!?'"’”]+$/u, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (u.endsWith(close) && u.split(close).length > u.split(open).length) u = u.slice(0, -1).replace(/[.,;:!?'"’”]+$/u, '');
    }
    return u;
  }
  function splitLinks(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(LINK_RE)) {
      const url = trimLink(m[0]);
      if (!/[\p{L}\p{N}]/u.test(url.replace(/^(?:https?:\/\/|www\.)/iu, ''))) continue;
      if (m.index > last) out.push({ text: text.slice(last, m.index), link: false });
      out.push({ text: url, link: true });
      last = m.index + url.length;
    }
    if (last < text.length) out.push({ text: text.slice(last), link: false });
    return out;
  }

  // --- Docs autocorrect guards ------------------------------------------------
  // Docs rewrites some typed text: straight quotes become curly, "1. " at the
  // start of a paragraph starts a numbered list, and (c), --, 1/2 ... become
  // symbols when the next character is typed. Pasted text is left alone, so
  // those characters are pasted instead of typed (measured in a live Doc): a
  // quote alone; a list prefix up to the first letter after it; a symbol
  // token together with the character after it and one more. Docs drops
  // whitespace at either end of a paste, so pieces never start or end with it.
  const AUTOLIST_RE = /^(?:\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})[.)]\s+\S|^[*\-•>]\s+\S/u;
  const SUBST_RE = /\((?:c|r|tm)\)|--|<=|>=|!=|->|<-|=>|\d+\/\d+/giu;
  function autolistPrefix(text) {
    const m = AUTOLIST_RE.exec(text);
    return m ? Array.from(m[0]).length : 0;
  }
  // [{ text, paste, link }] for one run; `prefixLen` characters at its start
  // are pasted (the paragraph's list-like prefix).
  function guardPieces(text, prefixLen) {
    const out = [];
    let pos = 0;
    for (const seg of splitLinks(text)) {
      const chars = Array.from(seg.text);
      if (seg.link) {
        out.push({ text: seg.text, paste: true, link: true });
        pos += chars.length;
        continue;
      }
      const mark = chars.map((ch, i) => pos + i < prefixLen || ch === "'" || ch === '"');
      const charAt = [];
      chars.forEach((ch, i) => {
        for (let k = 0; k < ch.length; k++) charAt.push(i);
      });
      for (const m of seg.text.matchAll(SUBST_RE)) {
        const end = m.index + m[0].length;
        if (end >= charAt.length) continue; // nothing typed after it in this run
        for (let k = charAt[m.index]; k <= charAt[end]; k++) mark[k] = true;
      }
      const ws = (i) => /\s/u.test(chars[i]);
      // Grow pasted pieces past whitespace at their ends (forward first).
      for (let i = 0; i < chars.length; i++) {
        if (!mark[i] || !ws(i)) continue;
        const startsPiece = i === 0 || !mark[i - 1];
        const endsPiece = i + 1 >= chars.length || !mark[i + 1];
        if (endsPiece) {
          if (i + 1 < chars.length) mark[i + 1] = true;
          else if (i > 0) mark[i - 1] = true;
        }
        if (startsPiece && i > 0) mark[i - 1] = true;
      }
      for (let i = chars.length - 1; i >= 0; i--) {
        // whatever still starts or ends on whitespace (a run of only spaces) is typed
        if (mark[i] && ws(i) && (i === 0 || !mark[i - 1] || i + 1 >= chars.length || !mark[i + 1])) {
          let j = i;
          while (j >= 0 && mark[j] && ws(j)) mark[j--] = false;
        }
      }
      let i = 0;
      while (i < chars.length) {
        let j = i;
        while (j < chars.length && mark[j] === mark[i]) j++;
        out.push({ text: chars.slice(i, j).join(''), paste: mark[i], link: false });
        i = j;
      }
      pos += chars.length;
    }
    return out;
  }
  // Length of the shortest start of `chars` that is not only whitespace.
  function leadLen(chars) {
    let k = 0;
    while (k < chars.length - 1 && /\s/u.test(chars[k])) k++;
    return k + 1;
  }

  // Smooth value noise in [0, 1) over a real position, fixed by `seed`.
  function valueNoise(seed, x) {
    const j = Math.floor(x);
    const t = x - j;
    const at = (n) => rng32(mixSeed(seed, n))();
    return at(j) + (at(j + 1) - at(j)) * t * t * (3 - 2 * t);
  }
  // Target speed of block `index`. A numeric opts.wpm is a fixed target.
  // Otherwise the speed is automatic: a base speed drawn once from the seed,
  // times a factor that wanders smoothly with the block index, so neighbouring
  // blocks have a similar pace but the pace keeps drifting over the document.
  // Depends on (seed, index) only.
  function targetWpm(opts, index) {
    const o = opts || {};
    if (typeof o.wpm === 'number' && isFinite(o.wpm)) return o.wpm;
    const seed = o.seed === undefined ? DEFAULTS.seed : o.seed;
    const [mean, sigma, lo, hi] = P.speeds[o.speed] || P.autoWpm;
    const base = clamp(logn(rng32(mixSeed(seed, -3)), mean, sigma), lo, hi);
    // Two octaves: a slow swell over ~8 blocks and a quicker ripple on top.
    const v = 0.7 * valueNoise(mixSeed(seed, -4), index / 8) + 0.3 * valueNoise(mixSeed(seed, -5), index / 4);
    const [min, max] = P.autoDrift;
    // The sum of two noises bunches around 0.5; stretch it so the pace
    // really uses the range, then map it geometrically onto [min, max].
    const spread = clamp(0.5 + (v - 0.5) * 1.4, 0, 1);
    return base * min * Math.pow(max / min, spread);
  }

  function meanIki(o) {
    return 60000 / (Math.max(5, o.wpm) * 5);
  }
  function resolveLayout(o) {
    return LAYOUTS[o.layout] || LAYOUTS.trq;
  }
  function totalDelay(actions) {
    let s = 0;
    for (const a of actions) s += a.delay;
    return s;
  }
  function scaleDelays(actions, k) {
    for (const a of actions) a.delay = Math.round(Math.max(P.ikiFloor, a.delay * k));
  }

  // --- plain text ----------------------------------------------------------
  function plan(text, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const r = rng32(o.seed);
    const prof = makeProfile(r);
    const out = [];
    const typed = [];
    const typist = makeTypist(r, prof, o, resolveLayout(o), (a) => {
      out.push(a);
      typed.push(a);
    });
    let n = 0;
    for (const seg of splitLinks(String(text).replace(/\r\n?/g, '\n'))) {
      if (seg.link) {
        const [mean, sigma, lo, hi] = P.pasteLink;
        out.push({ type: 'paste', text: seg.text, delay: Math.round(clamp(logn(r, mean, sigma), lo, hi)) });
        typist.after(seg.text);
        continue;
      }
      const chars = Array.from(seg.text);
      typist.type(chars);
      n += chars.length;
    }
    // Multipliers, pauses and corrections all lengthen the total. Measured
    // typing speeds already include them, so the typed part is scaled back to
    // the requested speed; pasting a link is extra time on top.
    const total = totalDelay(typed);
    if (total > 0) scaleDelays(typed, (n * meanIki(o)) / total);
    return out;
  }

  // Replays a plain-text plan in memory (char/back only; other actions are
  // ignored). Used by the tests.
  function simulate(actions) {
    const buf = [];
    for (const a of actions) {
      if (a.type === 'char') buf.push(a.ch);
      else if (a.type === 'paste') buf.push(...Array.from(a.text));
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

  // --- document model helpers ----------------------------------------------
  function runFormatBits(run) {
    let bits = 0;
    INLINE.forEach((f, i) => {
      if (run[f]) bits |= 1 << i;
    });
    return bits;
  }
  function makeRun(text, bits, font, size) {
    const run = { text };
    INLINE.forEach((f, i) => {
      if (bits & (1 << i)) run[f] = true;
    });
    if (font) run.font = font;
    if (size) run.size = size;
    return run;
  }
  const runKey = (run) => runFormatBits(run) + '|' + (run.font || '') + '|' + (run.size || '');
  // No empty runs, adjacent runs with equal formatting merged, no line breaks.
  function normalizeRuns(runs) {
    const out = [];
    let lastKey = null;
    for (const run of runs || []) {
      const text = String(run.text == null ? '' : run.text).replace(/[\r\n]+/g, ' ');
      if (!text) continue;
      const key = runKey(run);
      if (key === lastKey) out[out.length - 1].text += text;
      else out.push(makeRun(text, runFormatBits(run), run.font, run.size));
      lastKey = key;
    }
    return out;
  }
  const FMT_KEYS = ['before', 'after', 'line', 'lineExact', 'left', 'firstLine'];
  function normalizeFmt(f) {
    const out = {};
    if (!f || typeof f !== 'object') return out;
    for (const k of FMT_KEYS) if (typeof f[k] === 'number' && isFinite(f[k])) out[k] = f[k];
    if (f.pageBreak) out.pageBreak = true;
    return out;
  }
  function normalizeParagraph(p) {
    const out = {
      type: 'paragraph',
      style: STYLES.includes(p.style) ? p.style : 'normal',
      list: p.list ? { kind: p.list.kind === 'number' ? 'number' : 'bullet', level: clamp(p.list.level | 0, 0, 8) } : null,
      align: ALIGNS.includes(p.align) ? p.align : 'left',
      runs: normalizeRuns(p.runs),
    };
    const fmt = normalizeFmt(p.fmt);
    if (Object.keys(fmt).length) out.fmt = fmt;
    return out;
  }
  function normalizeImage(b) {
    const n = (x) => (typeof x === 'number' && x > 0 && isFinite(x) ? x : 0);
    const out = { type: 'image', id: String(b.id), width: n(b.width), height: n(b.height), align: ALIGNS.includes(b.align) ? b.align : 'left' };
    if (b.pageBreak) out.pageBreak = true;
    return out;
  }
  function normalizeBlock(b) {
    if (b && b.type === 'image') return normalizeImage(b);
    if (b && b.type === 'table') {
      const cols = b.rows.length ? b.rows[0].length : 0;
      const out = {
        type: 'table',
        rows: b.rows.map((row) =>
          Array.from({ length: cols }, (_, c) => {
            const ps = row[c] && row[c].paragraphs && row[c].paragraphs.length ? row[c].paragraphs : [{}];
            const cell = { paragraphs: ps.map((p) => (p && p.type === 'image' ? normalizeImage(p) : normalizeParagraph(p))) };
            if (row[c] && row[c].fill) cell.fill = row[c].fill;
            return cell;
          })
        ),
      };
      if (Array.isArray(b.widths) && b.widths.length === cols) out.widths = b.widths.slice();
      return out;
    }
    return normalizeParagraph(b || {});
  }
  // Header/footer paragraphs: trailing empty ones dropped; null without text.
  function normalizeSection(sec) {
    const ps = (sec && Array.isArray(sec.paragraphs) ? sec.paragraphs : []).map((p) => normalizeParagraph(p || {}));
    while (ps.length && !ps[ps.length - 1].runs.length) ps.pop();
    return ps.some((p) => p.runs.length) ? { paragraphs: ps } : null;
  }
  const SECTION_KINDS = ['header', 'footer'];
  // Doc.pageNumbers = { where: 'header' | 'footer', skipFirst } or absent.
  function normalizePageNumbers(pn) {
    if (!pn || typeof pn !== 'object') return null;
    return { where: pn.where === 'header' ? 'header' : 'footer', skipFirst: Boolean(pn.skipFirst) };
  }
  // After the body come the header and footer, then the page numbers, as
  // items blocks.length, blocks.length + 1, ...
  function sections(doc) {
    const out = SECTION_KINDS.filter((k) => normalizeSection(doc && doc[k]));
    if (normalizePageNumbers(doc && doc.pageNumbers)) out.push('pageNumbers');
    return out;
  }
  // Number of items planBlock plans for `doc`: body blocks, then sections.
  function itemCount(doc) {
    return ((doc && doc.blocks) || []).length + sections(doc).length;
  }
  // Canonical form of a Doc; `simulateDoc` returns documents in this form.
  function normalizeDoc(doc) {
    const out = { blocks: ((doc && doc.blocks) || []).map(normalizeBlock) };
    for (const k of SECTION_KINDS) {
      const sec = normalizeSection(doc && doc[k]);
      if (sec) out[k] = sec;
    }
    const pn = normalizePageNumbers(doc && doc.pageNumbers);
    if (pn) out.pageNumbers = pn;
    if (doc && doc.font && (doc.font.family || doc.font.size)) out.font = Object.assign({}, doc.font);
    if (doc && doc.rich) out.rich = true;
    return out;
  }
  function blockParagraphs(block) {
    if (block.type === 'image') return [];
    if (block.type !== 'table') return [block];
    const out = [];
    for (const row of block.rows) for (const cell of row) out.push(...cell.paragraphs.filter((p) => p.type !== 'image'));
    return out;
  }
  function docText(doc) {
    const parts = [];
    for (const b of (doc && doc.blocks) || []) {
      for (const p of blockParagraphs(normalizeBlock(b))) parts.push(p.runs.map((x) => x.text).join(''));
    }
    return parts.join('\n');
  }

  // --- reference lists -----------------------------------------------------
  // Nobody types a bibliography out: the entries are copied from a reference
  // manager and pasted. Body paragraphs under a "References" / "Bibliography"
  // / "Kaynakça" heading (any heading style, or a short line with just that
  // word) are pasted whole, up to the next heading.
  const REF_HEADING = /^\s*(?:(?:\d+|[ivxlc]+)[.)]?\s+)?(?:references?|reference list|list of references|bibliography|works cited|kaynakça|kaynaklar|referanslar)\s*:?\s*$/iu;
  const refCache = new WeakMap();
  function referenceBlocks(doc) {
    if (!doc || !Array.isArray(doc.blocks)) return [];
    let out = refCache.get(doc);
    if (out) return out;
    out = [];
    let inRefs = false;
    for (const b of doc.blocks) {
      let ref = false;
      if (b && b.type === 'paragraph') {
        const text = (b.runs || []).map((x) => x.text).join('');
        const heading = b.style && b.style !== 'normal';
        if (REF_HEADING.test(text)) inRefs = true;
        else if (heading) inRefs = false;
        else ref = inRefs;
      }
      out.push(ref);
    }
    refCache.set(doc, out);
    return out;
  }

  // --- structured documents ------------------------------------------------
  // The carry is what the editor "remembers" at the caret between blocks. It
  // is plain JSON so the scheduler can persist it between sessions.
  function initialCarry() {
    return {
      style: 'normal',
      list: null,
      align: 'left',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      afterTable: false, // caret sits on the empty paragraph Docs keeps below a table
      started: false, // at least one block has been planned
      fontSet: false, // text typed at the caret already comes out in opts.font
    };
  }

  // opts.font -> { family?, size? } or null. Sizes are whole or half points.
  function resolveFont(f) {
    if (!f || typeof f !== 'object') return null;
    const out = {};
    const family = typeof f.family === 'string' ? f.family.replace(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 60) : '';
    if (family) out.family = family;
    const size = Math.round(Number(f.size) * 2) / 2;
    if (size >= 6 && size <= 96) out.size = size;
    return out.family || out.size ? out : null;
  }

  // A fixed sample used to measure how much this writer's pauses and typos
  // stretch the raw key intervals (see normalise() in planBlock).
  const REFERENCE_TEXT = (
    'the morning was quiet and the street was almost empty when we left the house. ' +
    'nobody had expected the weather to change so quickly, but by noon the sky was grey. ' +
    'we walked for a while without saying much, then stopped at a small place near the corner. ' +
    'it is hard to say why some days stay in your mind longer than others do. ' +
    'later that evening everything looked the same as before, only a little slower. '
  ).repeat(4);
  const referenceCache = new Map();
  // Ratio (target typing time) / (raw typing time) for this writer at o.wpm.
  // With a fixed random stream the raw time is linear in the mean interval
  // (intervals scale with it, pauses and corrections do not), so two sample
  // speeds per (seed, typoRate, layout) are enough for every target speed.
  function referenceScale(o, prof, L) {
    const key = [o.seed, o.typoRate, o.layout].join('|');
    let line = referenceCache.get(key);
    const chars = Array.from(REFERENCE_TEXT);
    if (!line) {
      const rawAt = (wpm) => {
        const at = Object.assign({}, o, { wpm });
        const acts = [];
        makeTypist(rng32(mixSeed(o.seed, -2)), prof, at, L, (a) => acts.push(a)).type(chars);
        return [meanIki(at), totalDelay(acts)];
      };
      const [m1, t1] = rawAt(40);
      const [m2, t2] = rawAt(80);
      const slope = (t1 - t2) / (m1 - m2);
      line = [slope, t1 - slope * m1];
      if (referenceCache.size > 256) referenceCache.clear();
      referenceCache.set(key, line);
    }
    const mean = meanIki(o);
    return (chars.length * mean) / (line[0] * mean + line[1]);
  }

  // Plans block `index` of `doc`. Returns the actions and the carry to pass to
  // the next block. The result depends only on (doc.blocks[index], index, opts,
  // carry): the session profile comes from opts.seed alone and the block's
  // random stream from (opts.seed, index).
  function planBlock(doc, index, opts, carry) {
    const o = Object.assign({}, DEFAULTS, opts);
    o.wpm = targetWpm(opts, index);
    const L = resolveLayout(o);
    const c = Object.assign(initialCarry(), carry);
    c.list = c.list ? { kind: c.list.kind, level: c.list.level } : null;
    const nBlocks = ((doc && doc.blocks) || []).length;
    let block;
    if (index < nBlocks) block = normalizeBlock(doc.blocks[index]);
    else {
      const kind = sections(doc)[index - nBlocks];
      if (!kind) return { actions: [], carry: c };
      block = kind === 'pageNumbers'
        ? Object.assign({ type: 'pageNumbers' }, normalizePageNumbers(doc.pageNumbers))
        : Object.assign({ type: 'section', kind }, normalizeSection(doc[kind]));
    }

    const prof = makeProfile(rng32(o.seed));
    const r = rng32(mixSeed(o.seed, index));
    const out = [];
    const typed = []; // char/back actions: the part that is speed-normalised
    const pauses = []; // [action, ms] thinking pauses added after normalisation
    let textChars = 0;
    let pendingPause = 0;
    const typist = makeTypist(r, prof, o, L, (a) => {
      out.push(a);
      typed.push(a);
    });

    const think = (mean) => Math.round(logn(r, mean, 0.6));
    // Occasionally the writer rests before starting a block (looks away,
    // rereads, checks something). Never before the very first block.
    const afterBreak = c.style !== 'normal' || c.afterTable;
    const restRoll = r();
    const restSize = r();
    let rest = 0;
    if (c.started && restRoll < P.restProb * (afterBreak ? P.restAfterBreak : 1)) {
      rest = Math.round((P.restMs[0] + restSize * (P.restMs[1] - P.restMs[0])) * (afterBreak ? P.restAfterBreak : 1));
    }
    const human = (spec) => Math.round(clamp(logn(r, spec[0], spec[1]), spec[2], spec[3]));
    function push(action) {
      out.push(action);
      claimPause(action);
    }
    // A pending between-paragraph pause lands on whatever is done next.
    function claimPause(action) {
      if (pendingPause && action) pauses.push([action, pendingPause]);
      pendingPause = 0;
    }
    // Body font (opts.font). Docs carries the font at the caret over Enter,
    // but a paragraph style shortcut, Enter after a heading, a new table and
    // a move to another cell all go back to the style's own font. After any
    // of those the next normal paragraph starts with one character pasted in
    // the body font; everything typed after it follows that character.
    const font = resolveFont(o.font);
    const format = (op, extra) => {
      if (op.startsWith('style:')) c.fontSet = false;
      push(Object.assign({ type: 'format', op }, extra, { delay: human(op === 'indent' || op === 'outdent' ? P.indentKey : P.shortcut) }));
    };
    // 'list:none' names the list it leaves: the executor toggles that kind's shortcut.
    const leaveList = () => format('list:none', { kind: c.list.kind, level: c.list.level });
    const key = (name, spec) => push({ type: 'key', key: name, delay: human(spec) });

    function enter() {
      if (c.style !== 'normal') c.fontSet = false;
      key('Enter', P.enterKey);
      if (c.style !== 'normal') c.style = 'normal'; // rule 1: Enter after a heading gives 'normal'
    }
    function setInline(bits) {
      INLINE.forEach((f, i) => {
        const want = Boolean(bits & (1 << i));
        if (c[f] !== want) {
          format(f);
          c[f] = want;
        }
      });
    }

    // Enter → list/indent → style → align → runs (toggles, then characters).
    // `pauseMs`: thinking time before the paragraph's first action (after Enter).
    const rich = Boolean(doc && doc.rich);
    // A reference-list entry: its text is pasted, not typed (see typeRun).
    const whole = index < nBlocks && block.type === 'paragraph' && Boolean(referenceBlocks(doc)[index]);
    let wholeFirst = true; // the first paste of the entry carries the trip to the source
    function paragraph(p, needEnter, pauseMs, inCell) {
      if (rich) return paragraphRich(p, needEnter, pauseMs, inCell);
      if (needEnter) enter();
      if (p.runs.length) pendingPause = pauseMs;

      if (!p.list) {
        if (c.list) leaveList();
      } else {
        let level = c.list ? c.list.level : 0;
        if (!c.list || c.list.kind !== p.list.kind) format('list:' + p.list.kind);
        for (; level < p.list.level; level++) format('indent');
        for (; level > p.list.level; level--) format('outdent');
      }
      c.list = p.list ? { kind: p.list.kind, level: p.list.level } : null;
      if (c.style !== p.style) format('style:' + p.style);
      c.style = p.style;
      if (c.align !== p.align) format('align:' + p.align);
      c.align = p.align;

      typist.reset();
      let restyle = Boolean(font) && p.style === 'normal' && !c.fontSet;
      const styled = () => {
        restyle = false;
        c.fontSet = true;
        const st = Object.assign({}, font);
        for (const f of INLINE) st[f] = c[f];
        return st;
      };
      let prefix = autolistPrefix(p.runs.map((r) => r.text).join(''));
      for (const run of p.runs) {
        setInline(runFormatBits(run));
        typeRun(run, prefix, restyle ? styled : null);
        prefix = Math.max(0, prefix - Array.from(run.text).length);
      }
    }

    // Types one run: links and autocorrect triggers are pasted, the rest is
    // typed. `lead`, when given, returns the style to paste the run's first
    // character with (a font or size change, or the body font).
    function typeRun(run, prefixLen, lead) {
      if (whole) {
        // Docs drops whitespace at the ends of a paste: that part is typed.
        const m = /^(\s*)([\s\S]*?)(\s*)$/u.exec(run.text);
        const edge = (s) => {
          if (!s) return;
          const first = out.length;
          typist.type(Array.from(s));
          claimPause(out[first]);
          textChars += Array.from(s).length;
        };
        edge(m[1]);
        if (m[2]) {
          const a = { type: 'paste', text: m[2], delay: human(wholeFirst ? P.pasteLink : P.fontKey) };
          wholeFirst = false;
          if (lead) a.style = lead();
          push(a);
          typist.after(m[2]);
        }
        edge(m[3]);
        return;
      }
      for (const pc of guardPieces(run.text, prefixLen)) {
        if (pc.paste) {
          const a = { type: 'paste', text: pc.text, delay: human(pc.link ? P.pasteLink : P.fontKey) };
          if (lead) {
            a.style = lead();
            lead = null;
          }
          push(a);
          typist.after(pc.text);
          continue;
        }
        let chars = Array.from(pc.text);
        if (lead && /\s/u.test(chars[0])) {
          // Docs drops whitespace at the start of a paste: type it (in the
          // previous font) and paste the first visible character styled.
          let k = 0;
          while (k < chars.length && /\s/u.test(chars[k])) k++;
          const first = out.length;
          typist.type(chars.slice(0, k));
          claimPause(out[first]);
          textChars += k;
          chars = chars.slice(k);
          if (!chars.length) continue;
        }
        if (lead) {
          const k = 1;
          const head = chars.slice(0, k).join('');
          push({ type: 'paste', text: head, delay: human(P.fontKey), style: lead() });
          lead = null;
          typist.after(head);
          textChars += k;
          chars = chars.slice(k);
          if (!chars.length) continue;
        }
        const first = out.length;
        typist.type(chars);
        claimPause(out[first]);
        textChars += chars.length;
      }
    }

    // Rich mode (.docx): every paragraph starts with a paste of the whole
    // paragraph (style, alignment, spacing, indents and its first text in its
    // font), which Docs takes over completely; the empty paragraph Docs adds
    // after it is joined back. Lists are switched on afterwards (the pasted
    // paragraph is never one). Runs in another font or size start with a
    // styled paste of their first character.
    const baseFont = (doc && doc.font) || {};
    function effFont(run) {
      let family = run.font || baseFont.family;
      let size = run.size || baseFont.size;
      if (font) {
        if (font.family && (!family || family === baseFont.family)) family = font.family;
        if (font.size && (!size || size === baseFont.size)) size = font.size;
      }
      const f = {};
      if (family) f.family = family;
      if (size) f.size = size;
      return f;
    }
    const fkey = (f) => (f.family || '') + '|' + (f.size || '');
    const styleOf = (f, bits) => {
      const st = Object.assign({}, f);
      INLINE.forEach((name, i) => {
        st[name] = Boolean(bits & (1 << i));
      });
      return st;
    };
    function paragraphRich(p, needEnter, pauseMs, inCell) {
      if (needEnter) {
        if (p.fmt && p.fmt.pageBreak && !inCell) {
          if (c.style !== 'normal') c.style = 'normal';
          key('PageBreak', P.enterKey);
        } else enter();
      }
      pendingPause = pauseMs;
      const runs = p.runs;
      const fmt = Object.assign({}, p.fmt);
      delete fmt.pageBreak;
      const f0 = effFont(runs[0] || {});
      const bits0 = runs.length ? runFormatBits(runs[0]) : INLINE.reduce((b, name, i) => (c[name] ? b | (1 << i) : b), 0);
      let text = '';
      // A paragraph that starts with whitespace is pasted empty (Docs would
      // drop the leading whitespace of the paste) and typed from the start.
      if (whole && runs.length && !/^\s/u.test(runs[0].text)) text = runs[0].text.replace(/\s+$/u, '');
      else if (runs.length && !/^\s/u.test(runs[0].text)) {
        const pc = guardPieces(runs[0].text, autolistPrefix(runs.map((r) => r.text).join('')))[0];
        if (pc.paste) text = pc.text;
        else {
          const ch = Array.from(runs[0].text);
          text = ch.slice(0, leadLen(ch)).join('');
        }
      }
      typist.reset();
      const a = { type: 'para', style: p.style, align: p.align, fmt, text, font: styleOf(f0, bits0), delay: human(whole && text ? P.pasteLink : P.fontKey) };
      if (!text) a.empty = true;
      else wholeFirst = false;
      push(a);
      Object.assign(c, { style: p.style, align: p.align, list: null, fontKey: fkey(f0) });
      INLINE.forEach((name, i) => {
        c[name] = Boolean(bits0 & (1 << i));
      });
      if (text) typist.after(text);
      if (p.list) {
        format('list:' + p.list.kind);
        for (let l = 0; l < p.list.level; l++) format('indent');
        c.list = { kind: p.list.kind, level: p.list.level };
      }
      const skip = Array.from(text).length;
      runs.forEach((run, r) => {
        const rest = r === 0 ? Array.from(run.text).slice(skip).join('') : run.text;
        if (!rest) return;
        const f = effFont(run);
        const bits = runFormatBits(run);
        let lead = null;
        if (fkey(f) !== c.fontKey) {
          lead = () => {
            c.fontKey = fkey(f);
            INLINE.forEach((name, i) => {
              c[name] = Boolean(bits & (1 << i));
            });
            return styleOf(f, bits);
          };
        } else setInline(bits);
        typeRun(Object.assign({}, run, { text: rest }), 0, lead);
      });
    }

    // A picture gets a paragraph of its own (plain, with the picture's
    // alignment) and is pasted into it after a long pause. `maxWidth` (pt):
    // the room it has inside a table cell.
    function image(b, needEnter, pauseMs, maxWidth) {
      if (needEnter) {
        if (b.pageBreak) {
          if (c.style !== 'normal') c.style = 'normal';
          key('PageBreak', P.enterKey);
        } else enter();
      }
      pendingPause = pauseMs;
      if (rich) {
        const f = effFont({});
        push({ type: 'para', style: 'normal', align: b.align, fmt: {}, text: '', empty: true, font: styleOf(f, 0), delay: human(P.fontKey) });
        Object.assign(c, { fontKey: fkey(f), bold: false, italic: false, underline: false, strike: false });
      } else {
        if (c.list) leaveList();
        if (c.style !== 'normal') format('style:normal');
        if (c.align !== b.align) format('align:' + b.align);
      }
      Object.assign(c, { style: 'normal', align: b.align, list: null });
      const a = { type: 'image', id: b.id, width: b.width, height: b.height, delay: human(P.imagePaste) };
      if (maxWidth) a.maxWidth = maxWidth;
      push(a);
    }

    function table(t) {
      const cols = t.rows.length ? t.rows[0].length : 0;
      if (!cols) return false;
      const join = c.started && !c.afterTable;
      if (join) enter();
      pendingPause = rest;
      if (c.list) leaveList();
      if (c.style !== 'normal') format('style:normal');
      if (c.align !== 'left') format('align:left');
      // Inline formats are switched off before the table is inserted and
      // before leaving each cell. Under the documented rule (formats simply
      // carry over) this costs at most a few shortcuts; if Docs instead gives
      // the caret the destination cell's own text style, the result is still
      // right because every cell was created plain.
      setInline(0);
      const ins = { type: 'table', rows: t.rows.length, cols, delay: human(P.tableInsert) };
      if (t.widths) ins.widths = t.widths.slice();
      if (t.rows.some((row) => row.some((cl) => cl.fill))) ins.fills = t.rows.map((row) => row.map((cl) => cl.fill || null));
      if (join) ins.join = true; // the empty paragraph made by Enter is removed again
      push(ins);
      c.fontSet = false;
      const cellStart = () => Object.assign(c, { style: 'normal', list: null, align: 'left' });
      cellStart();
      // Column widths as the table is inserted (see tableHtml in transport.js),
      // in pt, less the cell padding.
      const total = t.widths ? t.widths.reduce((x, y) => x + y, 0) : 0;
      const colWidth = (k) => Math.max(20, Math.round((t.widths ? t.widths[k] * Math.min(1, 450 / total) : Math.max(45, Math.floor(450 / cols) * 0.75)) - 12));
      let n = 0;
      for (const row of t.rows) {
        for (const [col, cell] of row.entries()) {
          if (n++) {
            setInline(0);
            key('Tab', P.cellMove);
            c.fontSet = false;
            cellStart();
          }
          cell.paragraphs.forEach((p, j) => {
            const pause = j > 0 ? think(P.cellParagraphPause) : 0;
            if (p.type === 'image') image(Object.assign({}, p, { pageBreak: false }), j > 0, pause, colWidth(col));
            else paragraph(p, j > 0, pause, true);
          });
        }
      }
      setInline(0);
      key('ArrowDown', P.cellMove);
      c.fontSet = false;
      cellStart();
      return true;
    }

    if (block.type === 'pageNumbers') {
      pendingPause = (c.started ? think(P.paragraphPause) : 0) + rest;
      push({ type: 'pageNumbers', where: block.where, skipFirst: block.skipFirst, delay: human(P.menuTrip) });
      key('Escape', P.cellMove);
    } else if (block.type === 'section') {
      // The caret goes into the empty header/footer, which starts plain;
      // Escape brings it back to the body, whose formatting state is kept.
      const body = Object.assign({}, c);
      Object.assign(c, { style: 'normal', list: null, align: 'left', bold: false, italic: false, underline: false, strike: false, fontSet: false });
      pendingPause = (c.started ? think(P.paragraphPause) : 0) + rest;
      key(block.kind === 'header' ? 'OpenHeader' : 'OpenFooter', P.sectionOpen);
      block.paragraphs.forEach((p, j) => paragraph(p, j > 0, j > 0 ? think(P.cellParagraphPause) : 0));
      key('Escape', P.cellMove);
      Object.assign(c, body);
    } else if (block.type === 'table') {
      if (table(block)) c.afterTable = true;
    } else if (block.type === 'image') {
      image(block, c.started && !c.afterTable, c.started ? think(P.paragraphPause) + rest : 0);
      c.afterTable = false;
    } else {
      const needEnter = c.started && !c.afterTable;
      paragraph(block, needEnter, c.started ? think(P.paragraphPause) + rest : 0);
      c.afterTable = false;
    }
    c.started = true;

    // Speed normalisation. Pauses and corrections stretch the raw intervals;
    // measured typing speeds already include them, so typing time is scaled
    // back towards textChars × mean interval. A long block is normalised on
    // its own (as plan() does). A short block has too few keys for that to be
    // meaningful (one hesitation would squeeze every other key), so its own
    // ratio is pooled with the writer's reference ratio, weighted as
    // `poolChars` characters. Format, key and table delays and the
    // between-paragraph pauses are structural time on top and are not scaled.
    const total = totalDelay(typed);
    if (total > 0) {
      const mean = meanIki(o);
      const pooled = ((P.poolChars + textChars) * mean) / ((P.poolChars * mean) / referenceScale(o, prof, L) + total);
      scaleDelays(typed, pooled);
    }
    for (const [action, ms] of pauses) action.delay += ms;

    return { actions: out, carry: c };
  }

  // Plans the whole document to estimate its duration.
  // chars = characters of document text, keys = number of actions.
  function estimate(doc, opts) {
    const n = itemCount(doc);
    const perBlockMs = [];
    let carry = initialCarry();
    let ms = 0;
    let keys = 0;
    for (let i = 0; i < n; i++) {
      const res = planBlock(doc, i, opts, carry);
      carry = res.carry;
      const blockMs = totalDelay(res.actions);
      perBlockMs.push(blockMs);
      ms += blockMs;
      keys += res.actions.length;
    }
    let chars = 0;
    for (const b of (doc && doc.blocks) || []) {
      for (const p of blockParagraphs(normalizeBlock(b))) for (const run of p.runs) chars += Array.from(run.text).length;
    }
    for (const k of sections(doc)) {
      if (k === 'pageNumbers') continue;
      for (const p of normalizeSection(doc[k]).paragraphs) for (const run of p.runs) chars += Array.from(run.text).length;
    }
    return { ms, chars, keys, perBlockMs };
  }

  // --- virtual editor ------------------------------------------------------
  // Replays an action list (all blocks concatenated) the way Google Docs
  // responds to it and returns the resulting Doc in normalizeDoc() form.
  // Implements exactly the editor rules the planner relies on:
  //   1. Enter after title/subtitle/heading starts a 'normal' paragraph.
  //   2. Enter in a list item starts an item of the same kind and level.
  //   3. Inline formats persist until toggled, 4. alignment persists over Enter.
  //   5. A new table puts the caret in its first cell (normal, no list, left);
  //      Tab goes to the next cell; ArrowDown from the last row lands on the
  //      empty normal paragraph below the table.
  // The paragraph an empty document starts with and the one below a table
  // exist in Docs whether or not anything is typed there; they are reported
  // only once touched (typed in, formatted, or ended with Enter).
  // Throws on sequences the planner must never produce.
  // opts.fonts: also track the font and size typed text gets (rich mode).
  function simulateDoc(actions, opts) {
    const trackFonts = Boolean(opts && opts.fonts);
    const newPar = (style, list, align, implicit) => ({ style, list, align, chars: [], implicit: Boolean(implicit) });
    let cf = ''; // font|size at the caret, set by styled pastes
    const fontKeyOf = (st) => (st && (st.family || st.size) ? (st.family || '') + '|' + (st.size || '') : null);
    const bitsOf = (st) => INLINE.reduce((b, f, k) => (st[f] ? b | (1 << k) : b), 0);
    const blocks = [newPar('normal', null, 'left', true)];
    let pars = blocks; // container of the caret's paragraph: `blocks` or a cell
    let par = blocks[0];
    let tbl = null; // { rows, r, c } while the caret is inside a table
    let bits = 0; // inline formats pending at the caret
    const secs = {}; // header/footer paragraphs, once opened
    let inSec = null; // { kind, pars, par, bits } of the body while in a section
    const fail = (msg, i) => {
      throw new Error(`simulateDoc: ${msg} (action ${i})`);
    };
    const gotoCell = (r, c) => {
      tbl.r = r;
      tbl.c = c;
      pars = tbl.rows[r][c];
      par = pars[pars.length - 1];
    };

    actions.forEach((a, i) => {
      if (a.type === 'char') {
        if (a.ch === '\n') fail('newline as a character', i);
        if (par.image) fail('text typed next to an image', i);
        par.chars.push([a.ch, bits, cf]);
        par.implicit = false;
      } else if (a.type === 'paste') {
        if (/[\r\n]/.test(a.text) || !a.text) fail('paste with a line break or no text', i);
        if (/\s$/u.test(a.text)) fail('paste ending in whitespace (Docs drops it)', i);
        // Pasted text keeps its own formatting; the caret takes it over.
        if (a.style) {
          bits = bitsOf(a.style);
          if (fontKeyOf(a.style)) cf = fontKeyOf(a.style);
        }
        for (const ch of Array.from(a.text)) par.chars.push([ch, bits, cf]);
        par.implicit = false;
      } else if (a.type === 'para') {
        // The pasted paragraph replaces the caret's empty paragraph's
        // properties (never a list); a page break before it is kept.
        if (par.chars.length) fail('para paste into a non-empty paragraph', i);
        if (!STYLES.includes(a.style) || !ALIGNS.includes(a.align)) fail('para with a bad style/align', i);
        if (a.empty ? a.text : !a.text) fail('para text does not match empty', i);
        if (a.text && /\s$/u.test(a.text)) fail('para text ending in whitespace', i);
        par.style = a.style;
        par.align = a.align;
        par.list = null;
        par.fmt = Object.assign(normalizeFmt(a.fmt), par.brk ? { pageBreak: true } : {});
        delete par.fmt.pageBreak;
        if (par.brk) par.fmt.pageBreak = true;
        bits = bitsOf(a.font || {});
        cf = fontKeyOf(a.font) || cf;
        for (const ch of Array.from(a.text || '')) par.chars.push([ch, bits, cf]);
        par.implicit = false;
      } else if (a.type === 'image') {
        // The picture is the only thing in its paragraph.
        if (inSec) fail('image inside a header/footer', i);
        if (par.chars.length || par.image) fail('image pasted into a non-empty paragraph', i);
        if (par.list || par.style !== 'normal') fail('image in a list or heading', i);
        if (!a.id) fail('image without an id', i);
        par.image = { id: a.id, width: a.width, height: a.height };
        par.implicit = false;
      } else if (a.type === 'key' && a.key === 'PageBreak') {
        if (tbl || inSec) fail('page break inside a table or section', i);
        par.implicit = false;
        par = newPar('normal', par.list && { kind: par.list.kind, level: par.list.level }, par.align);
        par.brk = true;
        pars.push(par);
      } else if (a.type === 'back') {
        if (!par.chars.length) fail('Backspace at the start of a paragraph', i);
        par.chars.pop();
      } else if (a.type === 'key' && (a.key === 'OpenHeader' || a.key === 'OpenFooter')) {
        const kind = a.key === 'OpenHeader' ? 'header' : 'footer';
        if (tbl || inSec) fail(a.key + ' inside a table or section', i);
        if (secs[kind]) fail(kind + ' opened twice', i);
        inSec = { pars, par, bits, cf };
        secs[kind] = [newPar('normal', null, 'left')];
        pars = secs[kind];
        par = pars[0];
        bits = 0;
      } else if (a.type === 'pageNumbers') {
        if (tbl || inSec) fail('pageNumbers inside a table or section', i);
        if (secs.pageNumbers) fail('page numbers inserted twice', i);
        secs.pageNumbers = normalizePageNumbers(a);
        inSec = { pars, par, bits };
        pars = [newPar('normal', null, 'left')]; // the number's own paragraph, not modelled
        par = pars[0];
      } else if (a.type === 'key' && a.key === 'Escape') {
        if (!inSec) fail('Escape outside a header/footer', i);
        ({ pars, par, bits, cf } = inSec);
        inSec = null;
      } else if (a.type === 'key' && a.key === 'Enter') {
        par.implicit = false;
        par = newPar('normal', par.list && { kind: par.list.kind, level: par.list.level }, par.align);
        pars.push(par);
      } else if (a.type === 'key' && (a.key === 'Tab' || a.key === 'ShiftTab')) {
        if (!tbl) fail(a.key + ' outside a table', i);
        const cols = tbl.rows[0].length;
        const n = tbl.r * cols + tbl.c + (a.key === 'Tab' ? 1 : -1);
        if (n < 0 || n >= tbl.rows.length * cols) fail(a.key + ' past the table', i);
        gotoCell(Math.floor(n / cols), n % cols);
      } else if (a.type === 'key' && a.key === 'ArrowDown') {
        if (!tbl) fail('ArrowDown outside a table', i);
        if (tbl.r < tbl.rows.length - 1) {
          gotoCell(tbl.r + 1, tbl.c);
        } else {
          tbl = null;
          pars = blocks;
          par = newPar('normal', null, 'left', true);
          blocks.push(par);
        }
      } else if (a.type === 'format') {
        const [name, arg] = a.op.split(':');
        if (!FORMAT_OPS.includes(a.op)) fail('unknown format op ' + a.op, i);
        if (INLINE.includes(name)) {
          bits ^= 1 << INLINE.indexOf(name);
          return;
        }
        par.implicit = false;
        if (name === 'style') par.style = arg;
        else if (name === 'align') par.align = arg;
        else if (a.op === 'list:none') {
          if (!par.list) fail('list:none outside a list', i);
          if (a.kind !== par.list.kind || a.level !== par.list.level) fail('list:none with the wrong kind/level', i);
          par.list = null;
        } else if (name === 'list') par.list = { kind: arg, level: par.list ? par.list.level : 0 };
        else if (!par.list) fail(name + ' outside a list', i);
        else par.list.level = clamp(par.list.level + (name === 'indent' ? 1 : -1), 0, 8);
      } else if (a.type === 'table') {
        if (tbl) fail('nested table', i);
        if (inSec) fail('table in a header/footer', i);
        if (par.chars.length) fail('table inserted in a non-empty paragraph', i);
        const rows = Array.from({ length: a.rows }, () => Array.from({ length: a.cols }, () => [newPar('normal', null, 'left')]));
        blocks[blocks.length - 1] = { table: rows, widths: a.widths, fills: a.fills }; // replaces the empty paragraph
        tbl = { rows, r: 0, c: 0 };
        gotoCell(0, 0);
      } else {
        fail('unknown action ' + JSON.stringify(a), i);
      }
    });

    if (inSec) fail('still inside a header/footer at the end', actions.length);
    const last = blocks[blocks.length - 1];
    if (last && !last.table && last.implicit) blocks.pop();

    const toParagraph = (p) => {
      if (p.image) return normalizeImage(Object.assign({ align: p.align, pageBreak: p.brk }, p.image));
      const runs = [];
      let lastKey = null;
      for (const [ch, b, f] of p.chars) {
        const key = trackFonts ? b + '#' + f : String(b);
        if (key === lastKey) runs[runs.length - 1].text += ch;
        else {
          const [family, size] = trackFonts && f ? f.split('|') : [];
          runs.push(makeRun(ch, b, family || undefined, size ? Number(size) : undefined));
        }
        lastKey = key;
      }
      const out = { type: 'paragraph', style: p.style, list: p.list, align: p.align, runs };
      if (p.fmt && Object.keys(p.fmt).length) out.fmt = p.fmt;
      else if (p.brk) out.fmt = { pageBreak: true };
      return out;
    };
    const toTable = (b) => {
      const t = {
        type: 'table',
        rows: b.table.map((row, r) =>
          row.map((cell, c) => {
            const out = { paragraphs: cell.map(toParagraph) };
            if (b.fills && b.fills[r] && b.fills[r][c]) out.fill = b.fills[r][c];
            return out;
          })
        ),
      };
      if (b.widths) t.widths = b.widths.slice();
      return t;
    };
    const result = { blocks: blocks.map((b) => (b.table ? toTable(b) : toParagraph(b))) };
    for (const k of SECTION_KINDS) {
      const sec = secs[k] && normalizeSection({ paragraphs: secs[k].map(toParagraph) });
      if (sec) result[k] = sec;
    }
    if (secs.pageNumbers) result.pageNumbers = secs.pageNumbers;
    return result;
  }

  // Font families the document uses (rich mode), to make sure Docs has them.
  function docFonts(doc, opts) {
    const set = new Set();
    const add = (f) => f && set.add(f);
    const o = opts || {};
    const ov = resolveFont(o.font);
    if (ov && ov.family) add(ov.family);
    if (doc && doc.font) add(doc.font.family);
    const visit = (p) => p.runs && p.runs.forEach((r) => add(r.font));
    for (const b of (doc && doc.blocks) || []) {
      if (b.type === 'table') b.rows.forEach((row) => row.forEach((cell) => cell.paragraphs.forEach(visit)));
      else visit(b);
    }
    for (const k of SECTION_KINDS) if (doc && doc[k]) doc[k].paragraphs.forEach(visit);
    return [...set];
  }

  const api = {
    docFonts,
    plan,
    simulate,
    summarize,
    LAYOUTS,
    FORMAT_OPS,
    initialCarry,
    planBlock,
    estimate,
    targetWpm,
    detectLayout,
    simulateDoc,
    normalizeDoc,
    splitLinks,
    guardPieces,
    autolistPrefix,
    resolveFont,
    SPEEDS: Object.keys(P.speeds),
    sections,
    itemCount,
    referenceBlocks,
  };
  root.HumanTyperPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
