// Shared document model: normalization, validation, plain-text helpers and
// the file dispatcher. Dependency-free; runs in the browser (plain <script>,
// content script, service worker) and under `node --test`.
//
//   Doc       = { blocks: Block[] }
//   Block     = Paragraph | Table
//   Paragraph = { type: 'paragraph', style, list, align, runs: Run[] }
//   Run       = { text, bold?: true, italic?: true, underline?: true, strike?: true,
//                 font?: string, size?: number (pt) }
//   Paragraph.fmt? = { before?, after?, line? (multiple), lineExact? (pt),
//                 left?, firstLine? (pt; negative = hanging), pageBreak?: true }
//   Table.widths? = column widths in pt; Cell.fill? = '#RRGGBB'
//   Doc.font? = { family?, size? } body font; Doc.rich?: true when paragraphs
//               and runs carry their own formatting (.docx input)
//   Table     = { type: 'table', rows: Cell[][] }   (rectangular)
//   Cell      = { paragraphs: Paragraph[] }         (at least one)
//   Doc.header, Doc.footer = { paragraphs: Paragraph[] }  (optional; present
//               only when they contain text)
//   Doc.pageNumbers = { where: 'header' | 'footer', skipFirst }  (optional)
//
// Load order: docmodel.js -> zip.js -> docx.js -> markdown.js. Every file adds
// its functions to the single `globalThis.HumanTyperDoc` object.
(function (root) {
  'use strict';

  const api = (root.HumanTyperDoc = root.HumanTyperDoc || {});

  const STYLES = ['normal', 'title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const ALIGNS = ['left', 'center', 'right', 'justify'];
  const LIST_KINDS = ['bullet', 'number'];
  const FLAGS = ['bold', 'italic', 'underline', 'strike'];
  const MAX_LIST_LEVEL = 8;

  // --- normalize -----------------------------------------------------------
  function sameFlags(a, b) {
    return FLAGS.every((f) => (a[f] === true) === (b[f] === true)) && (a.font || '') === (b.font || '') && (a.size || 0) === (b.size || 0);
  }
  function cleanFont(x) {
    return typeof x === 'string' ? x.replace(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 60) : '';
  }
  function cleanSize(x) {
    const n = Math.round(Number(x) * 2) / 2;
    return n >= 1 && n <= 400 ? n : 0;
  }
  const FMT_NUM = ['before', 'after', 'line', 'lineExact', 'left', 'firstLine'];
  function cleanFmt(f) {
    const out = {};
    if (!f || typeof f !== 'object') return out;
    for (const k of FMT_NUM) {
      const n = Number(f[k]);
      if (f[k] !== undefined && isFinite(n) && Math.abs(n) <= 2000) out[k] = Math.round(n * 100) / 100;
    }
    if (f.pageBreak) out.pageBreak = true;
    return out;
  }

  // Cleans a run list and splits it at line breaks: returns one Run[] per line.
  function splitRuns(runs) {
    const lines = [[]];
    for (const run of Array.isArray(runs) ? runs : []) {
      if (!run || run.text == null) continue;
      const text = String(run.text)
        .replace(/\r\n?|[\v\u2028\u2029]/g, '\n')
        .replace(/\t/g, ' ');
      // '\f' (page break) ends the line like '\n' and starts the next on a new page.
      text.split(/(?<=\f)|\n/).forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part.endsWith('\f')) {
          lines.breaks = (lines.breaks || new Set()).add(lines.length); // the line after this one
          part = part.slice(0, -1);
        }
        if (!part) return;
        const line = lines[lines.length - 1];
        const clean = { text: part };
        for (const f of FLAGS) if (run[f]) clean[f] = true;
        const font = cleanFont(run.font);
        const size = cleanSize(run.size);
        if (font) clean.font = font;
        if (size) clean.size = size;
        const last = line[line.length - 1];
        if (last && sameFlags(last, clean)) last.text += part;
        else line.push(clean);
      });
    }
    return lines;
  }

  // One input paragraph can become several (one per line break).
  function normalizeParagraph(p) {
    const src = p || {};
    const style = STYLES.includes(src.style) ? src.style : 'normal';
    const align = ALIGNS.includes(src.align) ? src.align : 'left';
    let list = null;
    if (src.list && LIST_KINDS.includes(src.list.kind)) {
      const level = Math.trunc(Number(src.list.level)) || 0;
      list = { kind: src.list.kind, level: Math.min(MAX_LIST_LEVEL, Math.max(0, level)) };
    }
    const fmt = cleanFmt(src.fmt);
    const lines = splitRuns(src.runs);
    return lines.map((runs, i) => {
      const p = { type: 'paragraph', style, list: list && { kind: list.kind, level: list.level }, align, runs };
      const f = Object.assign({}, fmt);
      if (i > 0) delete f.pageBreak; // only the first line keeps page-break-before...
      if (lines.breaks && lines.breaks.has(i)) f.pageBreak = true; // ...or one that follows a '\f'
      if (Object.keys(f).length) p.fmt = f;
      return p;
    });
  }

  function emptyParagraph() {
    return { type: 'paragraph', style: 'normal', list: null, align: 'left', runs: [] };
  }

  function normalizeTable(t) {
    const rows = (Array.isArray(t.rows) ? t.rows : [])
      .filter((row) => Array.isArray(row) && row.length > 0)
      .map((row) =>
        row.map((cell) => {
          const src = cell && Array.isArray(cell.paragraphs) ? cell.paragraphs : [];
          const paragraphs = [];
          for (const p of src) {
            if (p && p.type === 'paragraph') paragraphs.push(...normalizeParagraph(p));
          }
          if (paragraphs.length === 0) paragraphs.push(emptyParagraph());
          const out = { paragraphs };
          if (cell && /^#[0-9A-F]{6}$/i.test(cell.fill || '')) out.fill = cell.fill.toUpperCase();
          return out;
        })
      );
    if (rows.length === 0) return null;
    const width = Math.max(...rows.map((row) => row.length));
    for (const row of rows) {
      while (row.length < width) row.push({ paragraphs: [emptyParagraph()] });
    }
    const out = { type: 'table', rows };
    const w = Array.isArray(t.widths) ? t.widths.map(Number) : [];
    if (w.length === width && w.every((x) => x > 0 && x < 5000)) out.widths = w.map((x) => Math.round(x * 100) / 100);
    return out;
  }

  // Returns a new Doc that satisfies every rule of the model. Never throws.
  function normalize(doc) {
    const blocks = [];
    for (const b of doc && Array.isArray(doc.blocks) ? doc.blocks : []) {
      if (!b) continue;
      if (b.type === 'paragraph') blocks.push(...normalizeParagraph(b));
      else if (b.type === 'table') {
        const table = normalizeTable(b);
        if (table) blocks.push(table);
      }
    }
    const out = { blocks };
    for (const kind of ['header', 'footer']) {
      const src = doc && doc[kind] && Array.isArray(doc[kind].paragraphs) ? doc[kind].paragraphs : [];
      const paragraphs = [];
      for (const p of src) if (p && p.type === 'paragraph') paragraphs.push(...normalizeParagraph(p));
      // Trailing empty paragraphs are dropped; nothing with text, no section.
      while (paragraphs.length && !paragraphs[paragraphs.length - 1].runs.length) paragraphs.pop();
      if (paragraphs.some((p) => p.runs.length)) out[kind] = { paragraphs };
    }
    const pn = doc && doc.pageNumbers;
    if (pn && typeof pn === 'object') out.pageNumbers = { where: pn.where === 'header' ? 'header' : 'footer', skipFirst: Boolean(pn.skipFirst) };
    const f = doc && doc.font;
    if (f && typeof f === 'object') {
      const font = {};
      if (cleanFont(f.family)) font.family = cleanFont(f.family);
      if (cleanSize(f.size)) font.size = cleanSize(f.size);
      if (font.family || font.size) out.font = font;
    }
    if (doc && doc.rich) out.rich = true;
    return out;
  }

  // --- validate ------------------------------------------------------------
  function validateParagraph(p, path, out) {
    if (!p || p.type !== 'paragraph') {
      out.push(`${path}: expected a paragraph`);
      return;
    }
    if (!STYLES.includes(p.style)) out.push(`${path}.style: invalid style "${p.style}"`);
    if (!ALIGNS.includes(p.align)) out.push(`${path}.align: invalid align "${p.align}"`);
    if (p.list !== null) {
      const l = p.list;
      if (!l || !LIST_KINDS.includes(l.kind)) out.push(`${path}.list: invalid list kind`);
      else if (!Number.isInteger(l.level) || l.level < 0 || l.level > MAX_LIST_LEVEL) {
        out.push(`${path}.list.level: must be an integer between 0 and ${MAX_LIST_LEVEL}`);
      }
    }
    if (!Array.isArray(p.runs)) {
      out.push(`${path}.runs: must be an array`);
      return;
    }
    p.runs.forEach((r, i) => {
      const rp = `${path}.runs[${i}]`;
      if (!r || typeof r.text !== 'string' || r.text === '') {
        out.push(`${rp}.text: must be a non-empty string`);
        return;
      }
      if (/[\n\r]/.test(r.text)) out.push(`${rp}.text: contains a line break`);
      if (r.text.includes('\t')) out.push(`${rp}.text: contains a tab`);
      for (const f of FLAGS) {
        if (f in r && r[f] !== true) out.push(`${rp}.${f}: must be true or omitted`);
      }
      const prev = p.runs[i - 1];
      if (prev && typeof prev.text === 'string' && sameFlags(prev, r)) {
        out.push(`${rp}: has the same formatting as the previous run (should be merged)`);
      }
    });
  }

  // Returns a list of human-readable problems; empty when the doc is valid.
  function validate(doc) {
    const out = [];
    if (!doc || !Array.isArray(doc.blocks)) return ['doc.blocks: must be an array'];
    doc.blocks.forEach((b, i) => {
      const path = `blocks[${i}]`;
      if (b && b.type === 'paragraph') return validateParagraph(b, path, out);
      if (!b || b.type !== 'table') return out.push(`${path}: unknown block type`);
      if (!Array.isArray(b.rows) || b.rows.length === 0) {
        return out.push(`${path}.rows: must be a non-empty array`);
      }
      const width = Array.isArray(b.rows[0]) ? b.rows[0].length : 0;
      b.rows.forEach((row, r) => {
        if (!Array.isArray(row) || row.length === 0 || row.length !== width) {
          return out.push(`${path}.rows[${r}]: table is not rectangular`);
        }
        row.forEach((cell, c) => {
          const cp = `${path}.rows[${r}][${c}]`;
          if (!cell || !Array.isArray(cell.paragraphs) || cell.paragraphs.length === 0) {
            return out.push(`${cp}.paragraphs: must contain at least one paragraph`);
          }
          cell.paragraphs.forEach((p, k) => validateParagraph(p, `${cp}.paragraphs[${k}]`, out));
        });
      });
    });
    return out;
  }

  // --- plain text ----------------------------------------------------------
  function paragraphText(p) {
    return p.runs.map((r) => r.text).join('');
  }

  // Paragraphs joined by '\n'; table cells joined by '\t', rows by '\n'.
  // Multiple paragraphs inside one cell are joined by a space.
  function toPlainText(doc) {
    return doc.blocks
      .map((b) => {
        if (b.type === 'paragraph') return paragraphText(b);
        return b.rows
          .map((row) => row.map((cell) => cell.paragraphs.map(paragraphText).join(' ')).join('\t'))
          .join('\n');
      })
      .join('\n');
  }

  // Each non-blank line becomes a normal paragraph.
  function parsePlain(text) {
    const blocks = [];
    for (const line of String(text).replace(/^\uFEFF/, '').split(/\r\n?|\n/)) {
      const clean = line.replace(/\s+$/, '');
      if (clean) blocks.push({ ...emptyParagraph(), runs: [{ text: clean }] });
    }
    return normalize({ blocks });
  }

  // `paragraphs` counts top-level paragraphs only (blocks = paragraphs + tables);
  // `words` and `chars` cover all text including table cells. `chars` counts
  // Unicode code points and excludes the separators between paragraphs.
  function stats(doc) {
    const s = { blocks: doc.blocks.length, paragraphs: 0, tables: 0, words: 0, chars: 0 };
    const count = (p) => {
      const text = paragraphText(p);
      s.chars += Array.from(text).length;
      s.words += (text.match(/\S+/g) || []).length;
    };
    for (const b of doc.blocks) {
      if (b.type === 'paragraph') {
        s.paragraphs++;
        count(b);
      } else {
        s.tables++;
        for (const row of b.rows) for (const cell of row) cell.paragraphs.forEach(count);
      }
    }
    return s;
  }

  // --- file dispatch -------------------------------------------------------
  function decodeText(buffer) {
    const bytes = ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer);
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    return new TextDecoder(encoding).decode(bytes);
  }

  // Picks a parser from the file extension. Resolves to { doc, warnings }.
  async function parseFile(name, buffer) {
    const m = /\.([^./\\]+)$/.exec(String(name || ''));
    const ext = m ? m[1].toLowerCase() : '';
    if (ext === 'docx') return api.parseDocx(buffer);
    if (ext === 'md' || ext === 'markdown') {
      return { doc: api.parseMarkdown(decodeText(buffer)), warnings: [] };
    }
    if (ext === 'txt') return { doc: parsePlain(decodeText(buffer)), warnings: [] };
    throw new Error(
      `Unsupported file type "${ext ? '.' + ext : name}". Use a .docx, .md or .txt file.`
    );
  }

  Object.assign(api, { normalize, validate, parsePlain, parseFile, toPlainText, stats });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
