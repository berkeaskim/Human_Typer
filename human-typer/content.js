// Content script: the executor. It pulls planned actions from the service
// worker one block at a time and performs them through transport.js. All
// planning, scheduling and persistence live in the worker; this file keeps no
// state that matters across a page reload.
(function () {
  'use strict';
  if (window.top !== window || window.__humanTyperLoaded) return;
  window.__humanTyperLoaded = true;

  const T = globalThis.HumanTyperTransport;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const run = { jobId: null, gen: 0, paused: false, fresh: true };

  function send(msg) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => {
          void chrome.runtime.lastError;
          res(reply || null);
        });
      } catch (e) {
        res(null); // extension reloaded: this page keeps an orphaned script
      }
    });
  }

  // --- on-page indicator ----------------------------------------------------
  // A glow breathing around the edge of the window plus a small pill, so it is
  // obvious at a glance that the page is being typed into. Everything lives in
  // a shadow root, ignores the pointer, and animates opacity/transform only, so
  // it costs next to nothing over a sitting that lasts an hour.
  const INDICATOR_CSS = `
    :host { all: initial; }
    .frame, .frame::after { position: fixed; inset: 0; pointer-events: none; }
    .frame {
      box-shadow: inset 0 0 0 2px rgb(74 85 214 / .5), inset 0 0 22px 2px rgb(74 85 214 / .22);
      animation: in .5s ease-out both;
    }
    .frame::after {
      content: "";
      box-shadow: inset 0 0 0 3px rgb(96 108 255 / .55), inset 0 0 64px 10px rgb(96 108 255 / .42);
      animation: breathe 3.4s ease-in-out infinite alternate;
    }
    .pill {
      position: fixed; right: 16px; bottom: 16px;
      display: flex; align-items: center; gap: 7px;
      padding: 7px 12px 7px 9px; border-radius: 999px;
      font: 500 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .01em;
      color: #fff; background: rgb(24 26 34 / .9);
      box-shadow: 0 0 0 1px rgb(150 160 255 / .35), 0 4px 16px rgb(20 24 60 / .3);
      user-select: none; pointer-events: none;
      animation: rise .5s cubic-bezier(.2, .8, .2, 1) both;
    }
    svg { flex: none; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .wave { stroke: #fff; stroke-dasharray: 16; animation: write 2.6s ease-in-out infinite; }
    .caret { stroke: #99a1ff; animation: blink 1.06s steps(1, end) infinite; }
    .held .frame::after, .held .wave, .held .caret { animation: none; }
    .held .frame::after { opacity: 0; }
    @keyframes in { from { opacity: 0; } }
    @keyframes breathe { from { opacity: .12; } to { opacity: 1; } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.96); } }
    @keyframes write { 0% { stroke-dashoffset: 16; } 55%, 100% { stroke-dashoffset: 0; } }
    @keyframes blink { 50% { opacity: .15; } }
    @media (prefers-reduced-motion: reduce) {
      .frame, .pill, .wave, .caret { animation: none; }
      .frame::after { animation: none; opacity: .5; }
    }
    @media print { .frame, .pill { display: none; } }
  `;
  const SVG = 'http://www.w3.org/2000/svg';
  function svgPath(cls, d) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    return p;
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    // Constructed sheets are CSSOM, so the page's style CSP cannot refuse them.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(INDICATOR_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (e) {
    const style = document.createElement('style');
    style.textContent = INDICATOR_CSS;
    shadow.append(style);
  }
  const wrap = document.createElement('div');
  const frame = document.createElement('div');
  frame.className = 'frame';
  const pill = document.createElement('div');
  pill.className = 'pill';
  const mark = document.createElementNS(SVG, 'svg');
  mark.setAttribute('viewBox', '0 0 24 24');
  mark.setAttribute('width', '16');
  mark.setAttribute('height', '16');
  // Same artwork as icons/icon.svg: the wave writes itself, the caret blinks.
  mark.append(svgPath('wave', 'M4.2 14.6c1.5-4 3.4-4 4.9-.6s3.4 3.4 4.9-.6'), svgPath('caret', 'M18.4 6.4v11.2'));
  const label = document.createElement('span');
  pill.append(mark, label);
  wrap.append(frame, pill);
  shadow.append(wrap);
  document.documentElement.append(host);
  // `held` freezes the motion for states where nothing is being typed.
  function indicate(text, held) {
    host.style.display = text ? 'block' : 'none';
    wrap.className = held ? 'held' : '';
    label.textContent = text || '';
  }

  // --- executor loop --------------------------------------------------------
  // Waits `ms` in small slices so pause and stop take effect quickly.
  async function wait(ms, gen) {
    let left = ms;
    while (left > 0 && run.gen === gen) {
      if (run.paused) {
        await sleep(200);
        continue;
      }
      const slice = Math.min(left, 250);
      await sleep(slice);
      left -= slice;
    }
    while (run.paused && run.gen === gen) await sleep(200);
    return run.gen === gen;
  }

  async function loop(jobId) {
    const gen = ++run.gen;
    run.jobId = jobId;
    run.paused = document.hidden;
    indicate('Human Typer · typing');
    let finished = null;
    let misses = 0;
    while (run.gen === gen) {
      const reply = await send({ type: 'ht-next', jobId, finished, fresh: run.fresh });
      if (!reply) {
        // The worker may be restarting; retry for a while before giving up.
        if (++misses > 15) break;
        await sleep(2000);
        continue;
      }
      misses = 0;
      finished = null;
      run.fresh = false;
      if (reply.done || reply.stop || reply.wait) break;
      if (!T.ready()) {
        await send({ type: 'ht-error', jobId, message: 'docs_input_missing' });
        break;
      }
      T.focus();
      let lastReport = Date.now();
      let aborted = false;
      const steps = (reply.pre || []).map((a) => [a, -1]).concat(reply.actions.slice(reply.startAt || 0).map((a, i) => [a, (reply.startAt || 0) + i]));
      for (const [action, index] of steps) {
        if (!(await wait(action.delay, gen))) {
          aborted = true;
          break;
        }
        if (!(await T.perform(action))) {
          await send({ type: 'ht-error', jobId, message: 'docs_input_missing' });
          aborted = true;
          break;
        }
        if (index >= 0 && Date.now() - lastReport > 4000) {
          lastReport = Date.now();
          send({ type: 'ht-progress', jobId, token: reply.token, index: index + 1 });
        }
      }
      if (aborted) break;
      finished = reply.token;
    }
    if (run.gen === gen) indicate('');
  }

  function halt() {
    run.gen++;
    run.paused = false;
    indicate('');
  }

  // Timers are throttled in hidden tabs, so typing pauses until the tab is
  // visible again.
  document.addEventListener('visibilitychange', () => {
    if (!run.jobId) return;
    run.paused = document.hidden;
    send({ type: 'ht-visibility', jobId: run.jobId, hidden: document.hidden });
    if (host.style.display !== 'none') indicate(document.hidden ? 'Human Typer · paused (tab hidden)' : 'Human Typer · typing', document.hidden);
  });

  // --- self-test ------------------------------------------------------------
  // Types a known sequence at the caret; the worker then exports the document
  // and compares. Shows whether synthetic input works on this Docs build.
  const PROBES = [
    ['ASCII', 'abc XYZ 123'],
    ['Turkish lower', 'ığüşöç'],
    ['Turkish upper', 'İĞÜŞÖÇ'],
    ['Punctuation', 'a.b,c;d?e'],
    ['Backspace', 'del'], // "delX" is typed, then X is removed
  ];
  async function selfTest() {
    if (!T.ready()) return { ok: false, error: 'docs_input_missing' };
    const marker = 'HT' + Date.now().toString(36);
    const lines = [marker, ...PROBES.map((p) => p[1])];
    T.focus();
    const before = T.caret();
    T.typeChar(marker[0]);
    await sleep(300);
    const after = T.caret();
    const caretMoved = before && after ? before.x !== after.x || before.y !== after.y : null;
    for (const ch of Array.from(lines.join('\n')).slice(1)) {
      T.typeChar(ch);
      await sleep(45);
    }
    T.typeChar('X');
    await sleep(45);
    T.backspace();
    await sleep(45);
    T.key('Enter');
    return { ok: true, marker, probes: PROBES, caretMoved };
  }

  // --- messages from the worker ---------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case 'ht-ping':
        respond({ ok: true, ready: T.ready(), hidden: document.hidden, running: run.jobId && host.style.display !== 'none' });
        return false;
      case 'ht-start':
        loop(msg.jobId);
        respond({ ok: true });
        return false;
      case 'ht-pause':
      case 'ht-stop':
        halt();
        respond({ ok: true });
        return false;
      case 'ht-selftest':
        selfTest().then(respond);
        return true;
      default:
        return false;
    }
  });

  // A reloaded page picks its job back up.
  send({ type: 'ht-hello', url: location.href }).then((reply) => {
    if (reply && reply.start) loop(reply.start);
  });
})();
