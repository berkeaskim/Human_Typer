// Markdown -> document model. A small, forgiving subset: ATX headings,
// **bold**, *italic* / _italic_, ~~strike~~, `code` (as plain text), links
// (visible text only), bullet and ordered lists nested by indentation, GFM
// pipe tables and paragraphs. Anything else is kept as plain text.
// Requires docmodel.js to be loaded first.
(function (root) {
  'use strict';

  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    require('./docmodel.js');
  }
  const api = (root.HumanTyperDoc = root.HumanTyperDoc || {});

  // --- inline --------------------------------------------------------------
  // Longest delimiters first so "***" is not read as "**" + "*".
  const DELIMS = [
    ['***', ['bold', 'italic']],
    ['___', ['bold', 'italic']],
    ['**', ['bold']],
    ['__', ['bold']],
    ['~~', ['strike']],
    ['*', ['italic']],
    ['_', ['italic']],
  ];
  const WORD = /[\p{L}\p{N}]/u;
  const ESCAPABLE = /[!-/:-@[-`{-~]/;

  // Index of the closing delimiter `d` at or after `from`, or -1.
  function findClose(s, from, d) {
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') {
        j++;
        continue;
      }
      if (s[j] === '`') {
        const end = s.indexOf('`', j + 1);
        if (end > 0) j = end;
        continue;
      }
      if (!s.startsWith(d, j)) continue;
      if (d.length === 1 && (s[j + 1] === d || s[j - 1] === d)) {
        while (s[j + 1] === d) j++; // part of a longer delimiter run
        continue;
      }
      if (j === from || /\s/.test(s[j - 1])) continue;
      // Underscores inside a word (snake_case) are literal.
      if (d[0] === '_' && s[j + d.length] && WORD.test(s[j + d.length])) continue;
      return j;
    }
    return -1;
  }

  function parseInline(s, flags, out) {
    let buf = '';
    const flush = () => {
      if (buf) out.push({ text: buf, ...flags });
      buf = '';
    };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const rest = () => s.slice(i);
      let m;
      if (c === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
        buf += s[i + 1];
        i += 2;
      } else if (c === '`' && s.indexOf('`', i + 1) > 0) {
        const end = s.indexOf('`', i + 1);
        buf += s.slice(i + 1, end);
        i = end + 1;
      } else if (c === '!' && (m = /^!\[[^\]]*\]\([^)]*\)/.exec(rest()))) {
        i += m[0].length; // images are skipped
      } else if (c === '[' && (m = /^\[([^\]]*)\]\([^)]*\)/.exec(rest()))) {
        flush();
        parseInline(m[1], flags, out);
        i += m[0].length;
      } else if (c === '<' && (m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest()))) {
        buf += m[1];
        i += m[0].length;
      } else if (c === '*' || c === '_' || c === '~') {
        let matched = false;
        for (const [d, names] of DELIMS) {
          if (!s.startsWith(d, i)) continue;
          const after = s[i + d.length];
          if (!after || /\s/.test(after)) continue;
          if (d[0] === '_' && i > 0 && WORD.test(s[i - 1])) continue;
          const close = findClose(s, i + d.length, d);
          if (close < 0) continue;
          flush();
          const inner = { ...flags };
          for (const name of names) inner[name] = true;
          parseInline(s.slice(i + d.length, close), inner, out);
          i = close + d.length;
          matched = true;
          break;
        }
        if (!matched) {
          // No pairing found: the whole run of this character is literal.
          do {
            buf += c;
            i++;
          } while (s[i] === c);
        }
      } else {
        buf += c;
        i++;
      }
    }
    flush();
  }

  function inlineRuns(text) {
    const runs = [];
    parseInline(text, {}, runs);
    return runs;
  }

  // --- blocks --------------------------------------------------------------
  const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
  const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\S.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const FENCE = /^ {0,3}(`{3,}|~{3,})/;

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  }

  function paragraph(runs, extra) {
    return { type: 'paragraph', style: 'normal', list: null, align: 'left', runs, ...extra };
  }

  function parseMarkdown(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n?|\n/);
    const blocks = [];
    let open = null; // paragraph that still accepts continuation lines
    let indents = []; // indentation of the enclosing list levels
    let fence = null; // marker of the open fenced code block
    const push = (rawText, extra) => {
      const p = { rawText, extra };
      blocks.push(p);
      return p;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].replace(/\t/g, '    ');
      const f = FENCE.exec(line);
      if (fence) {
        // Code is kept verbatim: one plain paragraph per non-blank line.
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
        else if (line.trim()) push(line.replace(/\s+$/, ''), { literal: true });
        continue;
      }
      if (f) {
        fence = f[1];
        open = null;
        indents = [];
        continue;
      }
      line = line.replace(/^ {0,3}(?:>\s?)+/, ''); // blockquote markers
      if (!line.trim()) {
        open = null;
        continue;
      }

      let m;
      if ((m = HEADING.exec(line))) {
        if (m[2]) push(m[2], { style: 'h' + m[1].length });
        open = null;
        indents = [];
        continue;
      }
      if (RULE.test(line)) {
        open = null;
        indents = [];
        continue;
      }

      const next = lines[i + 1] || '';
      if (line.includes('|') && next.includes('-') && TABLE_SEP.test(next)) {
        const header = splitRow(line);
        const sep = splitRow(next);
        if (header.length === sep.length) {
          const aligns = sep.map((c) =>
            c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left'
          );
          const rows = [header];
          i += 2;
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
            rows.push(splitRow(lines[i++]));
          }
          i--;
          blocks.push({
            type: 'table',
            rows: rows.map((row) =>
              aligns.map((align, c) => ({
                paragraphs: [paragraph(inlineRuns(row[c] || ''), { align })],
              }))
            ),
          });
          open = null;
          indents = [];
          continue;
        }
      }

      if ((m = LIST_ITEM.exec(line))) {
        const indent = m[1].length;
        while (indents.length && indent < indents[indents.length - 1]) indents.pop();
        // Two or more extra spaces of indentation open a deeper level.
        if (!indents.length || indent >= indents[indents.length - 1] + 2) indents.push(indent);
        const kind = /\d/.test(m[2]) ? 'number' : 'bullet';
        open = push(m[3], { list: { kind, level: Math.min(indents.length - 1, 8) } });
        continue;
      }

      // Plain text: continues the open paragraph or list item, or starts a new one.
      const hardBreak = /( {2,}|\\)$/.test(line);
      const content = line.replace(/\\$/, '').trim();
      if (open) open.rawText += ' ' + content;
      else {
        open = push(content, {});
        indents = [];
      }
      if (hardBreak) open = null;
    }

    const doc = api.normalize({
      blocks: blocks.map((b) => {
        if (b.type === 'table') return b;
        const literal = b.extra.literal;
        const runs = literal ? [{ text: b.rawText }] : inlineRuns(b.rawText);
        return paragraph(runs, { style: b.extra.style || 'normal', list: b.extra.list || null });
      }),
    });
    // Paragraphs that ended up empty (e.g. only an image) are dropped.
    doc.blocks = doc.blocks.filter((b) => b.type === 'table' || b.runs.length > 0);
    return doc;
  }

  api.parseMarkdown = parseMarkdown;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
