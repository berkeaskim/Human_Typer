// Transport: turns one planned action into synthetic input events on the
// hidden Google Docs input frame. It relies on undocumented Docs internals
// (selectors, shortcut handling, paste markup); if Google changes them, this
// is the only file that needs to follow. No chrome.* APIs here, so the file
// can also be injected into a page for manual testing.
(function (root) {
  'use strict';

  const IFRAME = 'iframe.docs-texteventtarget-iframe';
  const CARET = '.kix-cursor-caret';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  function target() {
    const iframe = document.querySelector(IFRAME);
    if (!iframe || !iframe.contentDocument) return null;
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"]') || doc.activeElement || doc.body;
    return el ? { win: iframe.contentWindow, doc, el } : null;
  }

  function fire(t, type, init) {
    const Ctor = t.win.KeyboardEvent || KeyboardEvent;
    const ev = new Ctor(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: t.win }, init));
    t.el.dispatchEvent(ev);
  }

  // --- characters -----------------------------------------------------------
  function charInfo(ch) {
    if (ch === ' ') return { key: ' ', code: 'Space', keyCode: 32, charCode: 32 };
    const cp = ch.codePointAt(0);
    if (/^[a-zA-Z]$/.test(ch)) {
      const up = ch.toUpperCase();
      return { key: ch, code: 'Key' + up, keyCode: up.charCodeAt(0), charCode: cp, shiftKey: ch === up };
    }
    if (/^[0-9]$/.test(ch)) return { key: ch, code: 'Digit' + ch, keyCode: cp, charCode: cp };
    // Non-ASCII letters and punctuation: the physical key is unknown, the
    // character travels in keypress.charCode.
    return { key: ch, code: '', keyCode: 0, charCode: cp, shiftKey: ch.toLocaleLowerCase('tr') !== ch };
  }

  function typeChar(ch) {
    const t = target();
    if (!t) return false;
    if (ch === '\n') return key('Enter');
    const k = charInfo(ch);
    const base = { key: k.key, code: k.code, shiftKey: !!k.shiftKey };
    fire(t, 'keydown', Object.assign({ keyCode: k.keyCode, which: k.keyCode }, base));
    fire(t, 'keypress', Object.assign({ keyCode: k.charCode, charCode: k.charCode, which: k.charCode }, base));
    fire(t, 'keyup', Object.assign({ keyCode: k.keyCode, which: k.keyCode }, base));
    return true;
  }

  // --- named keys and shortcuts ---------------------------------------------
  const MOD = IS_MAC ? { metaKey: true } : { ctrlKey: true };
  const mod = (extra) => Object.assign({}, MOD, extra);
  // [key, code, keyCode, modifiers]. Paragraph navigation was verified on
  // macOS; the Windows/Linux/ChromeOS variants follow the Docs shortcut list.
  const KEYS = {
    Enter: ['Enter', 'Enter', 13, {}],
    Backspace: ['Backspace', 'Backspace', 8, {}],
    Tab: ['Tab', 'Tab', 9, {}],
    ShiftTab: ['Tab', 'Tab', 9, { shiftKey: true }],
    ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37, {}],
    ArrowRight: ['ArrowRight', 'ArrowRight', 39, {}],
    ArrowDown: ['ArrowDown', 'ArrowDown', 40, {}],
    ArrowUp: ['ArrowUp', 'ArrowUp', 38, {}],
    End: ['End', 'End', 35, {}],
    Delete: ['Delete', 'Delete', 46, {}],
    DocStart: IS_MAC ? ['ArrowUp', 'ArrowUp', 38, { metaKey: true }] : ['Home', 'Home', 36, { ctrlKey: true }],
    DocEnd: IS_MAC ? ['ArrowDown', 'ArrowDown', 40, { metaKey: true }] : ['End', 'End', 35, { ctrlKey: true }],
    ParaEnd: ['ArrowDown', 'ArrowDown', 40, IS_MAC ? { altKey: true } : { ctrlKey: true }],
    SelectPara: ['ArrowUp', 'ArrowUp', 38, IS_MAC ? { altKey: true, shiftKey: true } : { ctrlKey: true, shiftKey: true }],
    Escape: ['Escape', 'Escape', 27, {}],
    PageBreak: ['Enter', 'Enter', 13, IS_MAC ? { metaKey: true } : { ctrlKey: true }],
  };
  const digit = (d, extra) => [String(d), 'Digit' + d, 48 + d, mod(extra)];
  const letter = (c, extra) => [c, 'Key' + c.toUpperCase(), c.toUpperCase().charCodeAt(0), mod(extra)];
  // Two-chord shortcuts that move the caret into the page header/footer,
  // creating it. Verified on macOS (Docs menu: Ctrl+⌘O Ctrl+⌘H / Ctrl+⌘F;
  // ⌘⌥F would insert a footnote instead). Elsewhere Ctrl+Alt+O, Ctrl+Alt+H/F.
  const SEC_MODS = IS_MAC ? { metaKey: true, ctrlKey: true } : { ctrlKey: true, altKey: true };
  const chord = (c) => [c, 'Key' + c.toUpperCase(), c.toUpperCase().charCodeAt(0), SEC_MODS];
  const SEQS = {
    OpenHeader: [chord('o'), chord('h')],
    OpenFooter: [chord('o'), chord('f')],
  };
  const FORMATS = {
    bold: letter('b'),
    italic: letter('i'),
    underline: letter('u'),
    strike: letter('x', { shiftKey: true }),
    'style:normal': digit(0, { altKey: true }),
    // Docs has no shortcut for Title/Subtitle; they fall back to the closest
    // style that has one.
    'style:title': digit(1, { altKey: true }),
    'style:subtitle': digit(0, { altKey: true }),
    'style:h1': digit(1, { altKey: true }),
    'style:h2': digit(2, { altKey: true }),
    'style:h3': digit(3, { altKey: true }),
    'style:h4': digit(4, { altKey: true }),
    'style:h5': digit(5, { altKey: true }),
    'style:h6': digit(6, { altKey: true }),
    'list:bullet': digit(8, { shiftKey: true }),
    'list:number': digit(7, { shiftKey: true }),
    indent: KEYS.Tab,
    outdent: KEYS.ShiftTab,
    'align:left': letter('l', { shiftKey: true }),
    'align:center': letter('e', { shiftKey: true }),
    'align:right': letter('r', { shiftKey: true }),
    'align:justify': letter('j', { shiftKey: true }),
    clear: ['\\', 'Backslash', 220, MOD],
  };

  function press(def) {
    const t = target();
    if (!t) return false;
    const [k, code, keyCode, mods] = def;
    const init = Object.assign({ key: k, code, keyCode, which: keyCode }, mods);
    fire(t, 'keydown', init);
    if (k === 'Enter' && !Object.keys(mods).length) fire(t, 'keypress', Object.assign({}, init, { charCode: 13 }));
    fire(t, 'keyup', init);
    return true;
  }

  function key(name) {
    if (SEQS[name]) return pressSeq(SEQS[name]);
    return KEYS[name] ? press(KEYS[name]) : false;
  }
  async function pressSeq(defs) {
    for (let i = 0; i < defs.length; i++) {
      if (i) await sleep(140);
      if (!press(defs[i])) return false;
    }
    await sleep(400); // Docs lays out the new header/footer before typing lands
    return true;
  }
  const backspace = () => key('Backspace');

  // `action` is a planner format action; 'list:none' carries the kind to leave.
  function format(action) {
    const op = action.op === 'list:none' ? 'list:' + (action.kind || 'bullet') : action.op;
    return FORMATS[op] ? press(FORMATS[op]) : false;
  }

  // --- tables ---------------------------------------------------------------
  // Docs has no keyboard command for "insert table", so an empty grid is
  // pasted in the markup Docs itself puts on the clipboard. Afterwards the
  // caret sits below the table; it is walked back into the first cell.
  // `widths`: column widths in pt (from the source); the table is scaled
  // down to fit a portrait A4/Letter text width. `fills`: cell backgrounds.
  const MAX_TABLE_PX = 600;
  function tableHtml(rows, cols, widths, fills) {
    let px = widths && widths.length === cols ? widths.map((w) => (w * 4) / 3) : Array(cols).fill(Math.max(60, Math.floor(450 / cols)));
    const total = px.reduce((a, b) => a + b, 0);
    if (total > MAX_TABLE_PX) px = px.map((w) => (w * MAX_TABLE_PX) / total);
    const cell = (r, c) => {
      const fill = fills && fills[r] && fills[r][c];
      return '<td style="border:1px solid #000;padding:5pt' + (fill ? ';background-color:' + fill : '') + '"><p dir="ltr"><br /></p></td>';
    };
    let body = '';
    for (let r = 0; r < rows; r++) {
      body += '<tr>';
      for (let c = 0; c < cols; c++) body += cell(r, c);
      body += '</tr>';
    }
    return (
      '<meta charset="utf-8"><b style="font-weight:normal;" id="' + guid() + '"><div dir="ltr" align="left">' +
      '<table style="border:none;border-collapse:collapse;"><colgroup>' + px.map((w) => '<col width="' + Math.round(w) + '" />').join('') +
      '</colgroup><tbody>' + body + '</tbody></table></div></b>'
    );
  }
  function guid() {
    return 'docs-internal-guid-' + Math.random().toString(16).slice(2, 10) + '-7fff-4a1b-9c2d-' + Date.now().toString(16).padStart(12, '0');
  }

  // `join`: the table was pasted into an empty paragraph made for it (Enter
  // after the previous paragraph). Docs keeps that empty paragraph above the
  // table; it is removed by deleting forward from the end of the paragraph
  // before it, then the caret steps back into the first cell. (Pasting at the
  // end of the previous paragraph instead would give the cells and the
  // paragraph after the table that paragraph's alignment and list.)
  async function insertTable(rows, cols, join, widths, fills) {
    const t = target();
    if (!t) return false;
    const before = caret();
    const data = new t.win.DataTransfer();
    data.setData('text/html', tableHtml(rows, cols, widths, fills));
    data.setData('text/plain', '');
    t.el.dispatchEvent(new t.win.ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data }));
    // Wait until Docs has laid the table out (the caret jumps below it).
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      const now = caret();
      if (before && now && (now.x !== before.x || now.y !== before.y) && i >= 5) break;
    }
    key('ArrowLeft');
    await sleep(120);
    for (let i = 1; i < rows * cols; i++) {
      key('ShiftTab');
      await sleep(60);
    }
    if (join) {
      for (const k of ['ArrowUp', 'ArrowUp', 'End', 'Delete', 'ArrowRight']) {
        await sleep(110);
        key(k);
      }
      await sleep(150);
    }
    return true;
  }

  // --- page numbers ---------------------------------------------------------
  // Docs has no shortcut for page numbers: Insert › Page elements › Page
  // numbers, then one of four tiles. Everything is found by icon/tile class,
  // so it works whatever the UI language. Afterwards the caret is in the
  // header/footer next to the number (the planner sends Escape next).
  const visible = (el) => el && el.getBoundingClientRect().width > 0;
  async function waitFor(sel, ms) {
    for (let t = 0; t < ms; t += 100) {
      const el = [...document.querySelectorAll(sel)].find(visible);
      if (el) return el;
      await sleep(100);
    }
    return null;
  }
  function mouse(el, types) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + Math.min(20, r.width / 2), clientY: r.top + r.height / 2 };
    for (const t of types) el.dispatchEvent(new MouseEvent(t, o));
  }
  const HOVER = ['mouseover', 'mouseenter', 'mousemove'];
  const CLICK = ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];
  async function insertPageNumbers(where, skipFirst) {
    const menu = document.getElementById('docs-insert-menu');
    if (!menu) return false;
    mouse(menu, CLICK);
    const steps = ['.goog-menu .docs-icon-editors-ia-header-footer', '.goog-menu .docs-icon-editors-ia-number-sign'];
    for (const sel of steps) {
      const icon = await waitFor(sel, 3000);
      if (!icon) return closeMenus();
      mouse(icon.closest('.goog-menuitem'), HOVER);
    }
    const tile = await waitFor('.kix-pagenumber-' + (where === 'header' ? 'header' : 'footer') + '-one-on-' + (skipFirst ? 'second' : 'first'), 3000);
    if (!tile) return closeMenus();
    const cell = tile.closest('td') || tile;
    mouse(cell, HOVER);
    await sleep(250);
    mouse(cell, CLICK);
    await sleep(900);
    return true;
  }
  // --- fonts ------------------------------------------------------------------
  // Docs only keeps a pasted font that is in the user's font menu ("My
  // fonts"); others fall back to Arial (live-tested with Calibri). Missing
  // ones are added through Font › More fonts: search, tick, Done.
  async function ensureFonts(families) {
    const box = document.getElementById('docs-font-family');
    if (!box || !families || !families.length) return true;
    mouse(box, CLICK);
    const first = await waitFor('.goog-menu .docs-font-menuitem-with-icon, .goog-menu .goog-menuitem', 2000);
    if (!first) return closeMenus().then(() => true);
    const listed = new Set([...document.querySelectorAll('.goog-menu .goog-menuitem')].filter(visible).map((i) => i.textContent.trim().toLowerCase()));
    const missing = families.filter((f) => !listed.has(String(f).toLowerCase()));
    if (!missing.length) {
      await closeMenus();
      return true;
    }
    mouse(first.closest('.goog-menuitem') || first, CLICK); // "More fonts" is the first entry
    const search = await waitFor('[role=dialog] input[type=text]', 4000);
    if (!search) return closeMenus().then(() => true);
    const dialog = search.closest('[role=dialog]');
    for (const fam of missing) {
      search.focus();
      search.value = fam;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1200);
      for (const cb of [...dialog.querySelectorAll('input[type=checkbox]')].filter(visible)) {
        let row = cb;
        for (let k = 0; k < 8 && row && row !== dialog; k++) {
          if ((row.textContent || '').trim().toLowerCase() === fam.toLowerCase()) break;
          row = row.parentElement;
        }
        if (row && row !== dialog && (row.textContent || '').trim().toLowerCase() === fam.toLowerCase()) {
          if (!cb.checked) cb.click();
          break;
        }
      }
    }
    await sleep(300);
    const ok = [...dialog.querySelectorAll('button[data-mdc-dialog-action=ok]')].find(visible);
    if (ok) ok.click();
    await sleep(800);
    focus();
    return true;
  }

  async function closeMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(200);
    focus();
    return false;
  }

  // --- links and the body font ----------------------------------------------
  // A link is pasted as plain text in one go, like a writer copying it from
  // the source tab; plain text takes the formatting at the caret. With a
  // `style` the text is pasted in Docs' own clipboard markup with that font,
  // size and inline formats, and the text typed after it follows it.
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function spanCss(st) {
    const css = [];
    if (st.size) css.push('font-size:' + st.size + 'pt');
    if (st.family) css.push("font-family:'" + String(st.family).replace(/['";\\<>]/g, '') + "'");
    css.push('color:#000000', 'background-color:transparent');
    css.push('font-weight:' + (st.bold ? 700 : 400), 'font-style:' + (st.italic ? 'italic' : 'normal'));
    const deco = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ');
    css.push('text-decoration:' + (deco || 'none'), 'vertical-align:baseline', 'white-space:pre-wrap');
    return css.join(';') + ';';
  }
  function styledHtml(text, st) {
    return '<meta charset="utf-8"><b style="font-weight:normal;" id="' + guid() + '"><span style="' + spanCss(st) + '">' + esc(text) + '</span></b>';
  }

  // --- whole paragraphs (rich mode) -----------------------------------------
  // A pasted <p>/<hN> brings its paragraph properties (spacing, line height,
  // indents, alignment, heading style) and its text formatting; Docs puts it
  // before the caret's empty paragraph, which one Backspace joins back so the
  // caret ends after the pasted text in the pasted paragraph (live-tested).
  function paraHtml(a) {
    const tag = /^h[1-6]$/.test(a.style) ? a.style : 'p';
    const f = a.fmt || {};
    const css = [f.lineExact ? 'line-height:' + f.lineExact + 'pt' : 'line-height:' + (f.line || 1.15)];
    css.push('margin-top:' + (f.before || 0) + 'pt', 'margin-bottom:' + (f.after || 0) + 'pt');
    // Docs reads a negative text-indent as "indent start = margin-left -
    // text-indent" (live-tested), so a Word hanging indent (left L, hanging
    // H) is sent as margin-left L - H.
    // Always explicit: a missing indent keeps the caret paragraph's own
    // (live run: a heading after a hanging-indent paragraph inherited it).
    const left = (f.left || 0) + (f.firstLine < 0 ? f.firstLine : 0);
    css.push('margin-left:' + left + 'pt', 'text-indent:' + (f.firstLine || 0) + 'pt');
    css.push('text-align:' + (a.align || 'left'));
    return (
      '<meta charset="utf-8"><b style="font-weight:normal;" id="' + guid() + '"><' + tag + ' dir="ltr" style="' + css.join(';') + ';">' +
      '<span style="' + spanCss(a.font || {}) + '">' + esc(a.empty ? 'x' : a.text) + '</span></' + tag + '></b>'
    );
  }
  // Docs applies edits asynchronously; the only DOM signal is the caret. In
  // a live run a Backspace sent while the caret was still moving from the
  // previous Enter was applied BEFORE the paste (letters split off, empty
  // paragraphs lost), so every step waits for a still caret, then for the
  // movement it expects, in document coordinates (Docs scrolls as it types).
  function docCaret() {
    const c = caret();
    if (!c) return null;
    const sc = document.querySelector('.kix-appview-editor');
    return { x: c.x, y: c.y + (sc ? sc.scrollTop : 0) };
  }
  async function stable(ms) {
    let last = docCaret();
    let same = 0;
    for (let t = 0; t < (ms || 1500) && same < 3; t += 50) {
      await sleep(50);
      const now = docCaret();
      same = now && last && now.x === last.x && now.y === last.y ? same + 1 : 0;
      last = now;
    }
    return last;
  }
  async function until(test, ms) {
    for (let t = 0; t < ms; t += 40) {
      await sleep(40);
      const now = docCaret();
      if (now && test(now)) return true;
    }
    return false;
  }
  async function settle(from, ms) {
    return until((now) => !from || now.x !== from.x || now.y !== from.y, ms);
  }
  async function pasteParagraph(a) {
    const t = target();
    if (!t) return false;
    const data = new t.win.DataTransfer();
    data.setData('text/html', paraHtml(a));
    data.setData('text/plain', a.empty ? 'x' : a.text);
    const before = await stable();
    t.el.dispatchEvent(new t.win.ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data }));
    // The pasted paragraph goes in above the caret's paragraph: the caret moves down.
    await until((now) => !before || now.y > before.y + 2, 3000);
    let at = await stable();
    // Join the empty paragraph after the pasted one: the caret moves up. On a
    // centred, indented or list paragraph Docs' first Backspace only resets
    // that (live-tested: the caret jumps left, same line), so press again
    // until the caret is on the pasted paragraph's line.
    // Press again only while the caret is still on that same line: any
    // other movement means the join happened (a further Backspace would
    // delete the first letter, as seen once in a table cell).
    const y0 = at ? at.y : null;
    for (let k = 0; k < 4; k++) {
      key('Backspace');
      if (y0 === null || (await until((now) => now.y < y0 - 2, 1500))) break;
      const now = await stable(600);
      if (!now || Math.abs(now.y - y0) > 2) break;
    }
    if (a.empty) {
      at = await stable();
      key('Backspace'); // and remove the placeholder character
      if (!(await settle(at, 1500))) {
        key('Backspace');
        await settle(at, 1500);
      }
    }
    await stable(800);
    return true;
  }
  async function pasteText(text, style) {
    const t = target();
    if (!t) return false;
    const data = new t.win.DataTransfer();
    if (style) data.setData('text/html', styledHtml(text, style));
    data.setData('text/plain', String(text));
    const before = await stable(800);
    t.el.dispatchEvent(new t.win.ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data }));
    await settle(before, 1500); // keys typed before the paste lands would go in front of it
    await stable(600);
    return true;
  }

  // --- one planned action ---------------------------------------------------
  // Returns true when the action was dispatched. May be async (tables).
  function perform(action) {
    switch (action.type) {
      case 'char':
        return typeChar(action.ch);
      case 'back':
        return backspace();
      case 'key':
        return key(action.key);
      case 'format':
        return format(action);
      case 'table':
        return insertTable(action.rows, action.cols, action.join, action.widths, action.fills);
      case 'para':
        return pasteParagraph(action);
      case 'fonts':
        return ensureFonts(action.families);
      case 'pageNumbers':
        return insertPageNumbers(action.where, action.skipFirst);
      case 'paste':
        return pasteText(action.text, action.style);
      default:
        return false;
    }
  }

  function focus() {
    const t = target();
    if (!t) return false;
    t.win.focus();
    if (t.el.focus) t.el.focus();
    return true;
  }

  // On-screen caret position; used to confirm that input actually lands.
  function caret() {
    const el = document.querySelector(CARET);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  }

  root.HumanTyperTransport = { ready: () => !!target(), perform, typeChar, backspace, key, format, insertTable, insertPageNumbers, ensureFonts, pasteText, focus, caret, isMac: IS_MAC };
})(typeof globalThis !== 'undefined' ? globalThis : this);
