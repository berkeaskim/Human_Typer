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
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none;';
  const pill = document.createElement('div');
  pill.style.cssText =
    'font:12px/1.3 system-ui,sans-serif;color:#fff;background:rgba(32,33,36,.88);padding:6px 10px;border-radius:999px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.25);user-select:none;';
  host.attachShadow({ mode: 'open' }).append(pill);
  document.documentElement.append(host);
  function indicate(text) {
    host.style.display = text ? 'block' : 'none';
    pill.textContent = text || '';
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
    if (host.style.display !== 'none') indicate(document.hidden ? 'Human Typer · paused (tab hidden)' : 'Human Typer · typing');
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
