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
//   { type: 'paste',  text, delay }        paste `text` as plain text in one go (links)
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
    const [mean, sigma, lo, hi] = P.autoWpm;
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
  function makeRun(text, bits) {
    const run = { text };
    INLINE.forEach((f, i) => {
      if (bits & (1 << i)) run[f] = true;
    });
    return run;
  }
  // No empty runs, adjacent runs with equal formatting merged, no line breaks.
  function normalizeRuns(runs) {
    const out = [];
    let lastBits = -1;
    for (const run of runs || []) {
      const text = String(run.text == null ? '' : run.text).replace(/[\r\n]+/g, ' ');
      if (!text) continue;
      const bits = runFormatBits(run);
      if (bits === lastBits) out[out.length - 1].text += text;
      else out.push(makeRun(text, bits));
      lastBits = bits;
    }
    return out;
  }
  function normalizeParagraph(p) {
    return {
      type: 'paragraph',
      style: STYLES.includes(p.style) ? p.style : 'normal',
      list: p.list ? { kind: p.list.kind === 'number' ? 'number' : 'bullet', level: clamp(p.list.level | 0, 0, 8) } : null,
      align: ALIGNS.includes(p.align) ? p.align : 'left',
      runs: normalizeRuns(p.runs),
    };
  }
  function normalizeBlock(b) {
    if (b && b.type === 'table') {
      const cols = b.rows.length ? b.rows[0].length : 0;
      return {
        type: 'table',
        rows: b.rows.map((row) =>
          Array.from({ length: cols }, (_, c) => {
            const ps = row[c] && row[c].paragraphs && row[c].paragraphs.length ? row[c].paragraphs : [{}];
            return { paragraphs: ps.map(normalizeParagraph) };
          })
        ),
      };
    }
    return normalizeParagraph(b || {});
  }
  // Canonical form of a Doc; `simulateDoc` returns documents in this form.
  function normalizeDoc(doc) {
    return { blocks: ((doc && doc.blocks) || []).map(normalizeBlock) };
  }
  function blockParagraphs(block) {
    if (block.type !== 'table') return [block];
    const out = [];
    for (const row of block.rows) for (const cell of row) out.push(...cell.paragraphs);
    return out;
  }
  function docText(doc) {
    const parts = [];
    for (const b of (doc && doc.blocks) || []) {
      for (const p of blockParagraphs(normalizeBlock(b))) parts.push(p.runs.map((x) => x.text).join(''));
    }
    return parts.join('\n');
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
    };
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
    const raw = doc && doc.blocks && doc.blocks[index];
    if (!raw) return { actions: [], carry: c };
    const block = normalizeBlock(raw);

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
    const format = (op, extra) =>
      push(Object.assign({ type: 'format', op }, extra, { delay: human(op === 'indent' || op === 'outdent' ? P.indentKey : P.shortcut) }));
    // 'list:none' names the list it leaves: the executor toggles that kind's shortcut.
    const leaveList = () => format('list:none', { kind: c.list.kind, level: c.list.level });
    const key = (name, spec) => push({ type: 'key', key: name, delay: human(spec) });

    function enter() {
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
    function paragraph(p, needEnter, pauseMs) {
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
      for (const run of p.runs) {
        setInline(runFormatBits(run));
        for (const seg of splitLinks(run.text)) {
          if (seg.link) {
            push({ type: 'paste', text: seg.text, delay: human(P.pasteLink) });
            typist.after(seg.text);
            continue;
          }
          const chars = Array.from(seg.text);
          const first = out.length;
          typist.type(chars);
          claimPause(out[first]);
          textChars += chars.length;
        }
      }
    }

    function table(t) {
      const cols = t.rows.length ? t.rows[0].length : 0;
      if (!cols) return false;
      if (c.started && !c.afterTable) enter();
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
      push({ type: 'table', rows: t.rows.length, cols, delay: human(P.tableInsert) });
      const cellStart = () => Object.assign(c, { style: 'normal', list: null, align: 'left' });
      cellStart();
      let n = 0;
      for (const row of t.rows) {
        for (const cell of row) {
          if (n++) {
            setInline(0);
            key('Tab', P.cellMove);
            cellStart();
          }
          cell.paragraphs.forEach((p, j) => paragraph(p, j > 0, j > 0 ? think(P.cellParagraphPause) : 0));
        }
      }
      setInline(0);
      key('ArrowDown', P.cellMove);
      cellStart();
      return true;
    }

    if (block.type === 'table') {
      if (table(block)) c.afterTable = true;
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
    const n = doc && doc.blocks ? doc.blocks.length : 0;
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
  function simulateDoc(actions) {
    const newPar = (style, list, align, implicit) => ({ style, list, align, chars: [], implicit: Boolean(implicit) });
    const blocks = [newPar('normal', null, 'left', true)];
    let pars = blocks; // container of the caret's paragraph: `blocks` or a cell
    let par = blocks[0];
    let tbl = null; // { rows, r, c } while the caret is inside a table
    let bits = 0; // inline formats pending at the caret
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
        par.chars.push([a.ch, bits]);
        par.implicit = false;
      } else if (a.type === 'paste') {
        if (/[\r\n]/.test(a.text) || !a.text) fail('paste with a line break or no text', i);
        for (const ch of Array.from(a.text)) par.chars.push([ch, bits]);
        par.implicit = false;
      } else if (a.type === 'back') {
        if (!par.chars.length) fail('Backspace at the start of a paragraph', i);
        par.chars.pop();
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
        if (par.chars.length) fail('table inserted in a non-empty paragraph', i);
        const rows = Array.from({ length: a.rows }, () => Array.from({ length: a.cols }, () => [newPar('normal', null, 'left')]));
        blocks[blocks.length - 1] = { table: rows }; // replaces the empty paragraph
        tbl = { rows, r: 0, c: 0 };
        gotoCell(0, 0);
      } else {
        fail('unknown action ' + JSON.stringify(a), i);
      }
    });

    const last = blocks[blocks.length - 1];
    if (last && !last.table && last.implicit) blocks.pop();

    const toParagraph = (p) => {
      const runs = [];
      let lastBits = -1;
      for (const [ch, b] of p.chars) {
        if (b === lastBits) runs[runs.length - 1].text += ch;
        else runs.push(makeRun(ch, b));
        lastBits = b;
      }
      return { type: 'paragraph', style: p.style, list: p.list, align: p.align, runs };
    };
    return {
      blocks: blocks.map((b) =>
        b.table ? { type: 'table', rows: b.table.map((row) => row.map((cell) => ({ paragraphs: cell.map(toParagraph) }))) } : toParagraph(b)
      ),
    };
  }

  const api = {
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
  };
  root.HumanTyperPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
