// Aktarım: tek bir karakteri ya da Backspace'i Docs'un gizli giriş çerçevesine
// sentetik tuş olayı olarak gönderir. Docs'un belgelenmemiş iç yapısına
// dayanır; seçiciler değişirse yalnızca bu dosya güncellenir.
(function (root) {
  'use strict';

  const IFRAME = 'iframe.docs-texteventtarget-iframe';
  const CARET = '.kix-cursor-caret';

  function target() {
    const iframe = document.querySelector(IFRAME);
    if (!iframe || !iframe.contentDocument) return null;
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"]') || doc.activeElement || doc.body;
    return el ? { win: iframe.contentWindow, doc, el } : null;
  }

  function keyInfo(ch) {
    if (ch === '\n') return { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 };
    if (ch === ' ') return { key: ' ', code: 'Space', keyCode: 32, charCode: 32 };
    if (ch === '\t') return { key: 'Tab', code: 'Tab', keyCode: 9, charCode: 0 };
    const cp = ch.codePointAt(0);
    if (/^[a-zA-Z]$/.test(ch)) {
      const up = ch.toUpperCase();
      return { key: ch, code: 'Key' + up, keyCode: up.charCodeAt(0), charCode: cp, shiftKey: ch === up };
    }
    if (/^[0-9]$/.test(ch)) return { key: ch, code: 'Digit' + ch, keyCode: cp, charCode: cp };
    // ASCII dışı harfler ve noktalama: fiziksel tuş bilinmiyor, karakter
    // keypress'in charCode alanıyla taşınır.
    const shifted = ch.toLocaleLowerCase('tr') !== ch;
    return { key: ch, code: '', keyCode: 0, charCode: cp, shiftKey: shifted };
  }

  function fire(t, type, init) {
    const Ctor = t.win.KeyboardEvent || KeyboardEvent;
    const ev = new Ctor(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: t.win }, init));
    t.el.dispatchEvent(ev);
  }

  function typeChar(ch) {
    const t = target();
    if (!t) return false;
    const k = keyInfo(ch);
    const base = { key: k.key, code: k.code, shiftKey: !!k.shiftKey };
    fire(t, 'keydown', Object.assign({ keyCode: k.keyCode, which: k.keyCode }, base));
    if (k.charCode) {
      fire(t, 'keypress', Object.assign({ keyCode: k.charCode, charCode: k.charCode, which: k.charCode }, base));
    }
    fire(t, 'keyup', Object.assign({ keyCode: k.keyCode, which: k.keyCode }, base));
    return true;
  }

  function backspace() {
    const t = target();
    if (!t) return false;
    const init = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 };
    fire(t, 'keydown', init);
    fire(t, 'keyup', init);
    return true;
  }

  function focus() {
    const t = target();
    if (!t) return false;
    t.win.focus();
    if (t.el.focus) t.el.focus();
    return true;
  }

  // İmlecin ekrandaki konumu; yazının gerçekten düştüğünü anlamak için.
  function caret() {
    const el = document.querySelector(CARET);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  }

  root.HumanTyperTransport = { ready: () => !!target(), typeChar, backspace, focus, caret };
})(typeof globalThis !== 'undefined' ? globalThis : this);
