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
  function tableHtml(rows, cols) {
    const width = Math.max(60, Math.floor(450 / cols));
    const cell = '<td style="border:1px solid #000;padding:5pt"><p dir="ltr"><br /></p></td>';
    const id = 'docs-internal-guid-' + Math.random().toString(16).slice(2, 10) + '-7fff-4a1b-9c2d-' + Date.now().toString(16).padStart(12, '0');
    return (
      '<meta charset="utf-8"><b style="font-weight:normal;" id="' + id + '"><div dir="ltr" align="left">' +
      '<table style="border:none;border-collapse:collapse;"><colgroup>' + ('<col width="' + width + '" />').repeat(cols) +
      '</colgroup><tbody>' + ('<tr>' + cell.repeat(cols) + '</tr>').repeat(rows) + '</tbody></table></div></b>'
    );
  }

  // `join`: the table was pasted into an empty paragraph made for it (Enter
  // after the previous paragraph). Docs keeps that empty paragraph above the
  // table; it is removed by deleting forward from the end of the paragraph
  // before it, then the caret steps back into the first cell. (Pasting at the
  // end of the previous paragraph instead would give the cells and the
  // paragraph after the table that paragraph's alignment and list.)
  async function insertTable(rows, cols, join) {
    const t = target();
    if (!t) return false;
    const before = caret();
    const data = new t.win.DataTransfer();
    data.setData('text/html', tableHtml(rows, cols));
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
  function styledHtml(text, st) {
    const css = [];
    if (st.size) css.push('font-size:' + st.size + 'pt');
    if (st.family) css.push("font-family:'" + String(st.family).replace(/['";\\<>]/g, '') + "'");
    css.push('color:#000000', 'background-color:transparent');
    css.push('font-weight:' + (st.bold ? 700 : 400), 'font-style:' + (st.italic ? 'italic' : 'normal'));
    const deco = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ');
    css.push('text-decoration:' + (deco || 'none'), 'vertical-align:baseline', 'white-space:pre-wrap');
    const id = 'docs-internal-guid-' + Math.random().toString(16).slice(2, 10) + '-7fff-4a1b-9c2d-' + Date.now().toString(16).padStart(12, '0');
    return '<meta charset="utf-8"><b style="font-weight:normal;" id="' + id + '"><span style="' + css.join(';') + ';">' + esc(text) + '</span></b>';
  }
  function pasteText(text, style) {
    const t = target();
    if (!t) return false;
    const data = new t.win.DataTransfer();
    if (style) data.setData('text/html', styledHtml(text, style));
    data.setData('text/plain', String(text));
    t.el.dispatchEvent(new t.win.ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data }));
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
        return insertTable(action.rows, action.cols, action.join);
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

  root.HumanTyperTransport = { ready: () => !!target(), perform, typeChar, backspace, key, format, insertTable, insertPageNumbers, pasteText, focus, caret, isMac: IS_MAC };
})(typeof globalThis !== 'undefined' ? globalThis : this);
