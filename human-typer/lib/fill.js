// Template fill: compares an empty pre-formatted template (the live Google Doc)
// with its filled version and plans only the missing typing. Nothing is rebuilt:
// the plan walks the existing paragraphs with `ParaEnd` presses and appends,
// replaces or inserts text. Pure functions; runs in the browser, in a service
// worker and under `node --test`.
//
// Caret rules the plan relies on (verified in Google Docs):
//   DocStart  caret to the very beginning of the document.
//   ParaEnd   caret to the END of the current paragraph; if it is already there,
//             to the END of the NEXT flat paragraph (into/through/out of tables).
//   At a paragraph end: type = append, SelectPara + type = replace,
//   Enter + type = new paragraph right after (inside the same cell in a table).
(function (root) {
  'use strict';

  // Alignment scores. Only classified pairs may be aligned; gaps are penalised so
  // that a valid one-to-one pairing always beats shifting paragraphs around.
  const SCORE = { same: 10, prefix: 8, blank: 4, similarBase: 1, similarGain: 2 };
  const GAP_TEMPLATE = -3; // template paragraph without a partner (reported)
  const GAP_FILLED = -1; // filled paragraph without a partner (becomes an insert)
  const GAP_FILLED_NO_ANCHOR = -3; // ... before the first template paragraph (cannot be typed)
  const SIMILAR_MIN = 0.6;
  const SIMILAR_MAX_LEN = 200; // similarity is measured on at most this many chars
  // Cost guards for long documents: in sequences longer than SIMILAR_BAND_FROM
  // only paragraphs within SIMILAR_BAND positions of the diagonal are compared
  // for similarity, and one plan spends at most SIMILAR_BUDGET edit-distance cells.
  const SIMILAR_BAND_FROM = 40;
  const SIMILAR_BAND = 6;
  const SIMILAR_BUDGET = 4e8;

  // --- text helpers --------------------------------------------------------
  const WS = /\s/;
  function nfc(s) {
    return String(s == null ? '' : s).normalize('NFC');
  }
  // Comparison key: NFC, whitespace runs collapsed, trimmed.
  function keyOf(s) {
    return nfc(s).replace(/\s+/g, ' ').trim();
  }
  function countChars(s) {
    return Array.from(s).length;
  }
  function copyRun(run, text) {
    const out = { text };
    for (const k of ['bold', 'italic', 'underline', 'strike']) if (run[k]) out[k] = true;
    return out;
  }
  function sliceRuns(runs, start) {
    const out = [];
    let pos = 0;
    for (const r of runs) {
      const end = pos + r.text.length;
      if (end > start) out.push(copyRun(r, r.text.slice(Math.max(0, start - pos))));
      pos = end;
    }
    return out;
  }

  // Index in `text` just past the part matching `key` (whitespace-insensitive),
  // or -1 when `key` is not a prefix of `text`.
  function prefixEnd(key, text) {
    let j = 0;
    while (j < text.length && WS.test(text[j])) j++;
    for (let i = 0; i < key.length; i++) {
      if (key[i] === ' ') {
        if (j >= text.length || !WS.test(text[j])) return -1;
        while (j < text.length && WS.test(text[j])) j++;
      } else if (text[j++] !== key[i]) return -1;
    }
    return j;
  }

  // Normalised edit similarity in [0, 1]; returns 0 early when it cannot exceed
  // SIMILAR_MIN (length ratio, then bag-of-characters lower bound). `work.cells`
  // caps the total effort of one plan.
  function similarity(a, b, work) {
    if (a.length > SIMILAR_MAX_LEN) a = a.slice(0, SIMILAR_MAX_LEN);
    if (b.length > SIMILAR_MAX_LEN) b = b.slice(0, SIMILAR_MAX_LEN);
    const max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    const budget = (1 - SIMILAR_MIN) * max;
    if (Math.abs(a.length - b.length) >= budget) return 0;
    const bag = new Map();
    for (const ch of a) bag.set(ch, (bag.get(ch) || 0) + 1);
    for (const ch of b) bag.set(ch, (bag.get(ch) || 0) - 1);
    let plus = 0;
    let minus = 0;
    for (const v of bag.values()) v > 0 ? (plus += v) : (minus -= v);
    if (Math.max(plus, minus) >= budget) return 0;
    if (work.cells > SIMILAR_BUDGET) return 0;
    work.cells += a.length * b.length;
    let prev = new Uint16Array(b.length + 1);
    let cur = new Uint16Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const ca = a.charCodeAt(i - 1);
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        let d = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
        if (prev[j] + 1 < d) d = prev[j] + 1;
        if (cur[j - 1] + 1 < d) d = cur[j - 1] + 1;
        cur[j] = d;
      }
      const t = prev;
      prev = cur;
      cur = t;
    }
    return 1 - prev[b.length] / max;
  }

  // --- flattening ----------------------------------------------------------
  function flatPara(p, extra) {
    const runs = [];
    for (const r of (p && p.runs) || []) {
      const text = nfc(r && r.text).replace(/\n/g, ' ');
      if (text) runs.push(copyRun(r, text));
    }
    return Object.assign({ text: runs.map((r) => r.text).join(''), runs }, extra);
  }

  // Flat list plus the block structure expressed in flat indices.
  function outline(doc) {
    const flat = [];
    const items = [];
    ((doc && doc.blocks) || []).forEach((b, block) => {
      if (b && b.type === 'table') {
        const first = flat.length;
        const rows = (b.rows || []).map((cells, row) =>
          (cells || []).map((cell, col) => {
            const paras = (cell && cell.paragraphs) || [];
            return (paras.length ? paras : [null]).map((p, para) => {
              flat.push(flatPara(p, { block, row, col, para, inTable: true }));
              return flat.length - 1;
            });
          })
        );
        items.push({ table: true, rows, first });
      } else {
        flat.push(flatPara(b, { block, inTable: false }));
        items.push({ table: false, i: flat.length - 1 });
      }
    });
    return { flat, items };
  }
  function flatten(doc) {
    return outline(doc).flat;
  }

  // Splits top-level items into paragraph sequences separated by the first
  // `nTables` tables; any further table is skipped.
  function split(items, nTables) {
    const segs = [[]];
    const tables = [];
    for (const it of items) {
      if (!it.table) segs[segs.length - 1].push(it.i);
      else if (tables.length < nTables) {
        tables.push(it);
        segs.push([]);
      }
    }
    return { segs, tables };
  }

  // --- pairing -------------------------------------------------------------
  // How template paragraph `t` can become filled paragraph `f`, or null.
  function classify(t, f, work, near) {
    if (t.key === f.key) return { kind: 'same', score: SCORE.same };
    if (f.key === '') return null; // would need deleting template text
    if (t.key === '') return { kind: 'append', start: 0, score: SCORE.blank };
    let j = prefixEnd(t.key, f.text);
    if (j >= 0) {
      // The template already ends with whitespace: do not type it again.
      if (WS.test(t.text[t.text.length - 1])) {
        if (f.text.startsWith(t.text)) j = t.text.length;
        else while (j < f.text.length && WS.test(f.text[j])) j++;
      }
      if (j < f.text.length) return { kind: 'append', start: j, score: SCORE.prefix };
    }
    // Text that exists verbatim on the other side is never a replace candidate.
    if (t.settled || f.settled || !near) return null;
    const sim = similarity(t.key, f.key, work);
    if (sim > SIMILAR_MIN) return { kind: 'replace', score: SCORE.similarBase + SCORE.similarGain * sim };
    return null;
  }

  // Global alignment of two paragraph lists. Returns steps in order:
  // { t, f, how } (pair), { t } (template only) or { f } (filled only).
  function align(ts, fs, work) {
    // Mark paragraphs whose exact text has enough copies on the other side.
    const count = (list) => list.reduce((m, p) => m.set(p.key, (m.get(p.key) || 0) + 1), new Map());
    const tc = count(ts);
    const fc = count(fs);
    for (const p of ts) p.settled = (fc.get(p.key) || 0) >= tc.get(p.key);
    for (const p of fs) p.settled = (tc.get(p.key) || 0) >= fc.get(p.key);
    const n = ts.length;
    const m = fs.length;
    const W = m + 1;
    const banded = Math.min(n, m) > SIMILAR_BAND_FROM;
    const best = new Float64Array((n + 1) * W);
    const move = new Uint8Array((n + 1) * W); // 1 pair, 2 template gap, 3 filled gap
    const how = new Array((n + 1) * W);
    const fGap = (i) => (i === 0 ? GAP_FILLED_NO_ANCHOR : GAP_FILLED);
    for (let j = 1; j <= m; j++) {
      best[j] = best[j - 1] + fGap(0);
      move[j] = 3;
    }
    for (let i = 1; i <= n; i++) {
      best[i * W] = best[(i - 1) * W] + GAP_TEMPLATE;
      move[i * W] = 2;
      for (let j = 1; j <= m; j++) {
        const at = i * W + j;
        let b = best[at - W] + GAP_TEMPLATE;
        let mv = 2;
        const ins = best[at - 1] + fGap(i);
        if (ins >= b) {
          b = ins;
          mv = 3;
        }
        const c = classify(ts[i - 1], fs[j - 1], work, !banded || Math.abs((i * m) / n - j) <= SIMILAR_BAND);
        if (c && best[at - W - 1] + c.score >= b) {
          b = best[at - W - 1] + c.score;
          mv = 1;
          how[at] = c;
        }
        best[at] = b;
        move[at] = mv;
      }
    }
    const steps = [];
    for (let i = n, j = m; i > 0 || j > 0; ) {
      const at = i * W + j;
      if (move[at] === 1) steps.push({ t: ts[--i], f: fs[--j], how: how[at] });
      else if (move[at] === 2) steps.push({ t: ts[--i] });
      else steps.push({ f: fs[--j] });
    }
    return steps.reverse();
  }

  // --- planning ------------------------------------------------------------
  function planFill(templateDoc, filledDoc) {
    const T = outline(templateDoc);
    const F = outline(filledDoc);
    T.flat.forEach((p, i) => ((p.index = i), (p.key = keyOf(p.text))));
    F.flat.forEach((p, i) => ((p.index = i), (p.key = keyOf(p.text))));
    const units = [];
    const problems = [];
    const work = { cells: 0 };
    const stats = { paragraphs: F.flat.length, unchanged: 0, appended: 0, replaced: 0, inserted: 0, charsToType: 0 };

    function unit(mode, templateIndex, text, runs, paragraphs) {
      const u = { advance: 0, mode, text, runs, templateIndex, chars: countChars(text) };
      // One Enter per inserted paragraph; `text` already holds one '\n' between them.
      if (paragraphs) (u.paragraphs = paragraphs), (u.chars += 1);
      units.push(u);
    }

    // Aligns one paragraph sequence (flat indices) and emits its units.
    function sequence(tIdx, fIdx, where) {
      let anchor = -1; // previous template paragraph of this sequence
      let pending = [];
      let orphans = [];
      const flush = () => {
        if (pending.length) {
          const text = pending.map((p) => p.text).join('\n');
          unit('insert', anchor, text, [], pending);
          stats.inserted += pending.length;
        }
        if (orphans.length) {
          const p = { code: 'insert_before_first', detail: orphans.length + ' paragraph(s) precede the first template paragraph of ' + where + '; skipped' };
          if (tIdx.length) p.templateIndex = tIdx[0];
          problems.push(p);
        }
        pending = [];
        orphans = [];
      };
      for (const s of align(tIdx.map((i) => T.flat[i]), fIdx.map((i) => F.flat[i]), work)) {
        if (!s.t) {
          (anchor < 0 ? orphans : pending).push({ text: s.f.text, runs: s.f.runs });
          continue;
        }
        flush();
        anchor = s.t.index;
        if (!s.f) {
          problems.push(
            s.t.key
              ? { code: 'template_text_missing', detail: 'template paragraph not found in the filled document: "' + s.t.key.slice(0, 60) + '"', templateIndex: anchor }
              : { code: 'structure_mismatch', detail: 'empty template paragraph has no counterpart in the filled document', templateIndex: anchor }
          );
        } else if (s.how.kind === 'same') stats.unchanged++;
        else if (s.how.kind === 'append') {
          unit('append', anchor, s.f.text.slice(s.how.start), sliceRuns(s.f.runs, s.how.start));
          stats.appended++;
        } else {
          unit('replace', anchor, s.f.text, s.f.runs);
          stats.replaced++;
        }
      }
      flush();
    }

    const tTables = T.items.filter((it) => it.table).length;
    const fTables = F.items.filter((it) => it.table).length;
    const nTables = Math.min(tTables, fTables);
    if (tTables !== fTables) {
      problems.push({ code: 'structure_mismatch', detail: 'template has ' + tTables + ' table(s), filled document has ' + fTables + '; extra tables are ignored' });
    }
    const ts = split(T.items, nTables);
    const fs = split(F.items, nTables);
    for (let k = 0; k <= nTables; k++) {
      sequence(ts.segs[k], fs.segs[k], k === 0 ? 'the document' : 'the text after table ' + k);
      if (k === nTables) break;
      const tt = ts.tables[k].rows;
      const ft = fs.tables[k].rows;
      const cols = (rows) => (rows[0] ? rows[0].length : 0);
      if (tt.length !== ft.length || tt.some((r, i) => ft[i] && r.length !== ft[i].length)) {
        problems.push({
          code: 'table_shape_mismatch',
          detail: 'table ' + (k + 1) + ': template is ' + tt.length + 'x' + cols(tt) + ', filled is ' + ft.length + 'x' + cols(ft) + '; only overlapping cells are filled',
          templateIndex: ts.tables[k].first,
        });
      }
      for (let r = 0; r < Math.min(tt.length, ft.length); r++) {
        for (let c = 0; c < Math.min(tt[r].length, ft[r].length); c++) {
          sequence(tt[r][c], ft[r][c], 'table ' + (k + 1) + ' cell ' + (r + 1) + ':' + (c + 1));
        }
      }
    }

    // ParaEnd presses, derived from where each unit leaves the caret.
    let caret = 0; // current flat index of the caret, always at a paragraph end
    let inserted = 0;
    units.forEach((u, k) => {
      const target = u.templateIndex + inserted;
      u.advance = k === 0 ? target + (T.flat[0].key === '' && T.flat[0].text === '' ? 0 : 1) : target - caret;
      caret = target;
      if (u.mode === 'insert') {
        inserted += u.paragraphs.length;
        caret += u.paragraphs.length;
      }
      stats.charsToType += u.chars;
    });
    return { units, stats, problems };
  }

  // ParaEnd presses needed right after DocStart to reach unit `unitIndex`, given
  // that units 0..unitIndex-1 are already in the document.
  function resumeAdvance(plan, unitIndex) {
    const units = plan.units;
    if (unitIndex <= 0) return units.length ? units[0].advance : 0;
    // Was flat paragraph 0 empty in the template? Then unit 0 needed no extra press.
    let firstEmpty = units[0].advance === units[0].templateIndex;
    let inserted = 0;
    for (let k = 0; k < unitIndex && k < units.length; k++) {
      const u = units[k];
      if (u.mode === 'insert') inserted += u.paragraphs.length;
      else if (u.templateIndex === 0) firstEmpty = false;
    }
    return units[unitIndex].templateIndex + inserted + (firstEmpty ? 0 : 1);
  }

  // --- virtual editor ------------------------------------------------------
  // Replays a plan on the template with the caret rules above and returns the
  // flat paragraph texts. `opts.resumeAt = k` simulates a new sitting before
  // unit k: DocStart again, then `resumeAdvance(plan, k)` presses.
  function applyPlan(templateDoc, plan, opts) {
    const texts = flatten(templateDoc).map((p) => p.text);
    const resumeAt = opts && opts.resumeAt > 0 ? opts.resumeAt : -1;
    let i = 0;
    let atEnd = false;
    const docStart = () => {
      i = 0;
      atEnd = texts[0] === '';
    };
    const paraEnd = () => {
      if (!atEnd) atEnd = true;
      else if (i < texts.length - 1) i++;
    };
    docStart();
    plan.units.forEach((u, k) => {
      if (k === resumeAt) docStart();
      for (let n = k === resumeAt ? resumeAdvance(plan, k) : u.advance; n > 0; n--) paraEnd();
      if (u.mode === 'append') texts[i] += u.text;
      else if (u.mode === 'replace') texts[i] = u.text; // SelectPara, then type
      else for (const p of u.paragraphs) texts.splice(++i, 0, p.text); // Enter, then type
      atEnd = true;
    });
    return texts;
  }

  const api = { flatten, planFill, resumeAdvance, applyPlan };
  root.HumanTyperFill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
