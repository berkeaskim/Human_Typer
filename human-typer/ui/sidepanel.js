// Human Typer — side panel controller.
// Classic script. Depends on i18n.js (HTI18n) and, optionally, mock.js
// (HumanTyperMock) plus the parser / planner / scheduler libraries.
(function () {
  'use strict';

  var I = window.HTI18n;
  var t = I.t;
  var Mock = window.HumanTyperMock || null;
  var hasRuntime = !!(window.chrome && chrome.runtime && chrome.runtime.id && chrome.runtime.connect);

  // Fill in any library function that is not loaded yet (mock-only stubs).
  if (Mock) Mock.installStubs();
  var Doc = window.HumanTyperDoc || {};
  var Planner = window.HumanTyperPlanner || {};
  var Scheduler = window.HumanTyperScheduler || {};

  var SETTINGS_KEY = 'ht-ui-settings';
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; values are Date#getDay()
  var OUTLINE_MAX = 12;
  var TIMELINE_MAX_DAYS = 5;
  var ACTIVE = { running: 1, paused: 1, waiting: 1 };
  // Sitting shape handed to the scheduler for the preview (minutes).
  var SESSION_MIN = { min: 20, max: 50 };
  var GAP_MIN = 20;

  function $(id) { return document.getElementById(id); }

  // el('p', {class: 'x', text: 'hi'}, [child, …])
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function icon(name, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', size || 14);
    svg.setAttribute('height', size || 14);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // Disclosure: the height animates through a CSS grid-row transition, which
  // can be reversed mid-flight. `inert` keeps closed content out of the tab order.
  function setOpen(id, open) {
    var node = $(id);
    if (node.classList.contains('is-open') === !!open) return;
    node.classList.toggle('is-open', !!open);
    if (open) node.removeAttribute('inert'); else node.setAttribute('inert', '');
  }

  // Replays a short CSS entrance on a node (view change, status change).
  function replay(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  // ───────────────────────── Bridge to the service worker ─────────────────────────
  // Everything the panel says to, or hears from, the worker goes through here.

  function createRealBridge() {
    var port = null;
    var listeners = [];
    var retry = 0;

    function connect() {
      try {
        port = chrome.runtime.connect({ name: 'ht-ui' });
      } catch (e) {
        port = null;
        reconnectLater();
        return;
      }
      port.onMessage.addListener(function (msg) {
        retry = 0;
        listeners.forEach(function (fn) { fn(msg); });
      });
      port.onDisconnect.addListener(function () {
        void chrome.runtime.lastError;
        port = null;
        reconnectLater(); // the worker may have been suspended; it pushes state again on connect
      });
    }

    function reconnectLater() {
      var delay = Math.min(5000, 300 * Math.pow(2, retry++));
      setTimeout(function () { if (!port) connect(); }, delay);
    }

    return {
      isMock: false,
      onMessage: function (fn) { listeners.push(fn); },
      start: connect,
      post: function (msg) {
        if (!port) connect();
        try { port.postMessage(msg); return true; } catch (e) { return false; }
      }
    };
  }

  var bridge = hasRuntime ? createRealBridge() : (Mock ? Mock.createBridge() : {
    isMock: true, onMessage: function () {}, start: function () {}, post: function () { return false; }
  });

  // ───────────────────────── State ─────────────────────────

  var remote = { target: null, job: null }; // last state pushed by the worker

  var ui = {
    doc: null,
    fileName: '',
    pasted: false,
    warnings: [],
    stats: null,
    seed: 1,
    detected: null,      // layout detected from the text
    loading: null,       // file name being read
    docError: null,      // {key, params}
    pasteOpen: false,
    typo: 2,             // percent
    layout: 'auto',
    speed: 'normal',     // 'slow' | 'normal' | 'fast'
    fontFamily: '',      // body font for normal text; '' keeps the Docs default
    fontSize: '',        // points, as typed; '' keeps the Docs default
    fontFromFile: '',    // file the font fields were filled from
    mode: 'now',
    deadline: NaN,       // epoch ms
    hoursStart: 9,
    hoursEnd: 23,
    days: [0, 1, 2, 3, 4, 5, 6],
    estimate: null,      // {ms, chars, keys}
    plan: null,          // scheduler result or {error: key}
    showAllDays: false,
    starting: false,
    stopConfirm: false,
    selftest: null,      // null | {running: true} | {lines: []} | {timeout: true}
    selftestOpen: false,
    aboutOpen: false
  };

  var timers = { estimate: 0, starting: 0, selftest: 0 };
  var timelineSig = { plan: '', run: '' };

  function defaultDeadline() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return d.getTime();
  }

  function saveSettings() {
    I.storageSet(SETTINGS_KEY, {
      typo: ui.typo, layout: ui.layout, mode: ui.mode,
      fontFamily: ui.fontFamily, fontSize: ui.fontSize, speed: ui.speed,
      hoursStart: ui.hoursStart, hoursEnd: ui.hoursEnd, days: ui.days
    });
  }

  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.typo === 'number' && s.typo >= 0 && s.typo <= 8) ui.typo = s.typo;
    if (['auto', 'trq', 'qwerty'].indexOf(s.layout) >= 0) ui.layout = s.layout;
    if (['slow', 'normal', 'fast'].indexOf(s.speed) >= 0) ui.speed = s.speed;
    if (typeof s.fontFamily === 'string') ui.fontFamily = s.fontFamily.slice(0, 60);
    if (typeof s.fontSize === 'string' || typeof s.fontSize === 'number') ui.fontSize = String(s.fontSize).slice(0, 5);
    if (s.mode === 'now' || s.mode === 'deadline') ui.mode = s.mode;
    if (Number.isInteger(s.hoursStart) && Number.isInteger(s.hoursEnd) &&
        s.hoursStart >= 0 && s.hoursEnd <= 24 && s.hoursStart < s.hoursEnd) {
      ui.hoursStart = s.hoursStart;
      ui.hoursEnd = s.hoursEnd;
    }
    if (Array.isArray(s.days)) {
      ui.days = s.days.filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; });
    }
  }

  // ───────────────────────── Document helpers ─────────────────────────

  function paragraphText(p) {
    return ((p && p.runs) || []).map(function (r) { return r.text || ''; }).join('');
  }

  function docText(doc, limit) {
    var out = [];
    var size = 0;
    ((doc && doc.blocks) || []).some(function (b) {
      var s = b.type === 'table'
        ? (b.rows || []).map(function (row) {
          return row.map(function (c) { return (c.paragraphs || []).map(paragraphText).join(' '); }).join(' ');
        }).join(' ')
        : paragraphText(b);
      out.push(s);
      size += s.length;
      return size > limit;
    });
    return out.join('\n');
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
  }

  function setDoc(doc, fileName, warnings, pasted) {
    var stats = null;
    try { stats = Doc.stats ? Doc.stats(doc) : null; } catch (e) { stats = null; }
    if (!doc || !doc.blocks || !doc.blocks.length || (stats && !stats.chars && !stats.tables && !stats.images)) {
      ui.docError = { key: 'doc.err.empty' };
      ui.loading = null;
      return false;
    }
    ui.doc = doc;
    ui.fileName = fileName;
    ui.pasted = !!pasted;
    ui.warnings = Array.isArray(warnings) ? warnings : [];
    ui.stats = stats;
    ui.docError = null;
    ui.loading = null;
    ui.showAllDays = false;
    var sample = docText(doc, 4000);
    ui.seed = hash(fileName + '|' + (stats ? stats.chars : doc.blocks.length) + '|' + sample.slice(0, 200));
    try { ui.detected = Planner.detectLayout ? Planner.detectLayout(sample) : null; } catch (e2) { ui.detected = null; }
    recompute();
    return true;
  }

  function clearDoc() {
    ui.doc = null;
    ui.fileName = '';
    ui.pasted = false;
    ui.warnings = [];
    ui.stats = null;
    ui.detected = null;
    ui.estimate = null;
    ui.plan = null;
    ui.docError = null;
    ui.loading = null;
  }

  function loadFile(file) {
    if (!file) return;
    if (!/\.(docx|md|markdown|txt)$/i.test(file.name)) {
      ui.docError = { key: 'doc.err.type' };
      render();
      return;
    }
    if (!Doc.parseFile) {
      ui.docError = { key: 'doc.err.noParser' };
      render();
      return;
    }
    ui.loading = file.name;
    ui.docError = null;
    render();
    file.arrayBuffer()
      .then(function (buf) { return Doc.parseFile(file.name, buf); })
      .then(function (res) {
        var doc = res && res.doc ? res.doc : res;
        if (setDoc(doc, file.name, res && res.warnings, false) && res && res.font) {
          // The file says which font its body text is in: use it.
          ui.fontFamily = res.font.family || '';
          ui.fontSize = res.font.size ? String(res.font.size) : '';
          ui.fontFromFile = file.name;
          saveSettings();
        }
      })
      .catch(function (err) {
        ui.loading = null;
        ui.docError = { key: 'doc.err.read', params: { name: file.name, error: (err && err.message) || String(err) } };
      })
      .then(function () {
        render();
        if (ui.doc) $('replaceBtn').focus();
      });
  }

  function usePastedText() {
    var text = $('pasteText').value;
    if (!text.trim()) {
      ui.docError = { key: 'doc.err.empty' };
      render();
      return;
    }
    if (!Doc.parsePlain) {
      ui.docError = { key: 'doc.err.noParser' };
      render();
      return;
    }
    try {
      setDoc(Doc.parsePlain(text), '', [], true);
    } catch (err) {
      ui.docError = { key: 'doc.err.read', params: { name: t('doc.pastedName'), error: (err && err.message) || String(err) } };
    }
    render();
    if (ui.doc) $('replaceBtn').focus();
  }

  function displayFileName() {
    return ui.pasted ? t('doc.pastedName') : ui.fileName;
  }

  function warningText(w) {
    if (typeof w === 'string') return I.has(w) ? t(w) : w;
    if (w && w.key && I.has(w.key)) return t(w.key, w.params);
    if (w && w.code && I.has('warn.' + w.code)) return t('warn.' + w.code, w.params || w);
    return (w && (w.message || w.code)) || String(w);
  }

  // ───────────────────────── Estimate and plan ─────────────────────────

  function resolvedLayout() {
    if (ui.layout !== 'auto') return ui.layout;
    return ui.detected || 'auto';
  }

  function typingOptions() {
    var o = { typoRate: ui.typo / 100, layout: resolvedLayout(), speed: ui.speed };
    var font = Planner.resolveFont ? Planner.resolveFont({ family: ui.fontFamily, size: ui.fontSize }) : null;
    if (font) o.font = font;
    return o;
  }

  function recompute() {
    ui.estimate = null;
    ui.plan = null;
    if (!ui.doc) return;
    try {
      if (Planner.estimate) {
        var o = typingOptions();
        ui.estimate = Planner.estimate(ui.doc, { typoRate: o.typoRate, seed: ui.seed, layout: o.layout, font: o.font, speed: o.speed });
      }
    } catch (e) { ui.estimate = null; }
    recomputePlan();
  }

  function recomputePlan() {
    ui.plan = null;
    if (ui.mode !== 'deadline' || !ui.doc) return;
    if (!isFinite(ui.deadline)) { ui.plan = { error: 'sched.invalidDate' }; return; }
    if (!ui.days.length) { ui.plan = { error: 'sched.noDays' }; return; }
    if (!ui.estimate || !Scheduler.planSessions) { ui.plan = { error: 'sched.reason.unknown' }; return; }
    try {
      ui.plan = Scheduler.planSessions({
        workMs: ui.estimate.ms,
        now: Date.now(),
        deadline: ui.deadline,
        hours: { start: ui.hoursStart, end: ui.hoursEnd },
        days: ui.days.slice().sort(),
        sessionMin: SESSION_MIN,
        gapMin: GAP_MIN,
        seed: ui.seed
      }) || { error: 'sched.reason.unknown' };
    } catch (e) {
      ui.plan = { error: 'sched.reason.unknown' };
    }
  }

  function planProblem() {
    var p = ui.plan;
    if (!p) return null;
    if (p.error) return t(p.error);
    if (p.feasible) return null;
    if (p.reason === 'not_enough_time' && isFinite(p.availableMs) && isFinite(p.requiredMs)) {
      return t('sched.reason.not_enough_time_detail', {
        required: I.fmtDuration(p.requiredMs), available: I.fmtDuration(p.availableMs)
      });
    }
    var key = 'sched.reason.' + p.reason;
    return t(I.has(key) ? key : 'sched.reason.unknown');
  }

  // ───────────────────────── Timeline ─────────────────────────

  function dayStart(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Split sittings at local midnight and group the pieces by day.
  function groupByDay(sessions) {
    var days = [];
    var byKey = {};
    function day(ts) {
      var key = dayStart(ts);
      if (!byKey[key]) { byKey[key] = { ts: key, segs: [], count: 0, ms: 0 }; days.push(byKey[key]); }
      return byKey[key];
    }
    sessions.forEach(function (s) {
      if (!(s.end > s.start)) return;
      day(s.start).count++;
      var a = s.start;
      while (a < s.end) {
        var d = day(a);
        var next = new Date(d.ts); next.setDate(next.getDate() + 1);
        var b = Math.min(s.end, next.getTime());
        d.segs.push({ from: (a - d.ts) / 3600000, to: (b - d.ts) / 3600000, start: a, end: b, status: s.status });
        d.ms += b - a;
        a = b;
      }
    });
    days.sort(function (x, y) { return x.ts - y.ts; });
    return days;
  }

  function hourLabel(h) {
    return (h < 10 ? '0' : '') + h;
  }

  // opts: {range: [h0, h1] | null, maxDays, expanded, onExpand}
  function buildTimeline(sessions, opts) {
    var days = groupByDay(sessions || []);
    var wrap = el('div', { class: 'tl' });
    if (!days.length) return wrap;

    var h0 = opts.range ? opts.range[0] : 24;
    var h1 = opts.range ? opts.range[1] : 0;
    days.forEach(function (d) {
      d.segs.forEach(function (s) {
        h0 = Math.min(h0, Math.floor(s.from));
        h1 = Math.max(h1, Math.ceil(s.to));
      });
    });
    if (!opts.range) { h0 = Math.max(0, h0 - 1); h1 = Math.min(24, h1 + 1); }
    while (h1 - h0 < 6) { if (h1 < 24) h1++; if (h1 - h0 < 6 && h0 > 0) h0--; }
    var span = h1 - h0;
    var step = [1, 2, 3, 4, 6, 12].filter(function (s) { return span / s <= 5; })[0] || 12;

    var visible = opts.expanded || days.length <= opts.maxDays ? days : days.slice(0, opts.maxDays);
    var list = el('ul', { class: 'tl__days' });
    var barIndex = 0;
    visible.forEach(function (d) {
      var summary = d.count
        ? t('sched.sittings', { count: d.count }) + ' · ' + I.fmtDuration(d.ms)
        : I.fmtDuration(d.ms);
      var times = d.segs.map(function (s) { return I.fmtTime(s.start) + '–' + I.fmtTime(s.end); });
      var track = el('div', { class: 'tl__track', 'aria-hidden': 'true' });
      track.style.setProperty('--tl-step', (step / span * 100) + '%');
      d.segs.forEach(function (s, i) {
        var bar = el('span', { class: 'tl__bar' + (s.status ? ' tl__bar--' + s.status : ''), title: times[i] });
        bar.style.setProperty('--i', String(barIndex++));
        bar.style.left = ((s.from - h0) / span * 100) + '%';
        bar.style.width = ((s.to - s.from) / span * 100) + '%';
        track.appendChild(bar);
      });
      list.appendChild(el('li', { class: 'tl__day', 'aria-label': I.fmtDay(d.ts) + ': ' + summary + ' (' + times.join(', ') + ')' }, [
        el('div', { class: 'tl__head', 'aria-hidden': 'true' }, [
          el('span', { class: 'tl__date', text: I.fmtDay(d.ts) }),
          el('span', { class: 'tl__sum', text: summary })
        ]),
        track
      ]));
    });
    wrap.appendChild(list);

    var axis = el('div', { class: 'tl__axis', 'aria-hidden': 'true' });
    for (var h = h0; h <= h1; h += step) {
      var tick = el('span', {
        class: 'tl__tick' + (h === h0 ? ' tl__tick--start' : '') + (h === h1 ? ' tl__tick--end' : ''),
        text: hourLabel(h)
      });
      tick.style.left = ((h - h0) / span * 100) + '%';
      axis.appendChild(tick);
    }
    wrap.appendChild(axis);

    if (visible.length < days.length) {
      var more = el('button', { type: 'button', class: 'link tl__more', text: t('sched.showAll', { count: days.length }) });
      more.addEventListener('click', opts.onExpand);
      wrap.appendChild(more);
    }
    return wrap;
  }

  function sessionsSummary(sessions) {
    var days = groupByDay(sessions);
    var n = sessions.length;
    return t('sched.overDays', { count: days.length, sittings: t('sched.sittings', { count: n }) });
  }

  // ───────────────────────── Rendering ─────────────────────────

  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (n) {
      n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria-label')));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (n) {
      n.setAttribute('placeholder', t(n.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('.lang__btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === I.getLanguage()));
    });
  }

  function targetTitle() {
    return (remote.target && remote.target.title) || t('target.untitled');
  }

  function renderHeader() {
    var on = !!remote.target;
    $('target').classList.toggle('is-on', on);
    var text = on ? t('target.connected', { title: targetTitle() }) : t('target.none');
    $('targetText').textContent = text;
    $('targetText').title = on ? targetTitle() : '';
    $('app').classList.toggle('is-typing', !!(remote.job && remote.job.status === 'running'));
  }

  function outlineRow(block, counters) {
    if (block.type === 'table') {
      var rows = (block.rows || []).length;
      var cols = (block.rows || []).reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      return el('li', { class: 'outline__row outline__row--table' }, [
        el('span', { class: 'outline__tag', 'aria-hidden': 'true' }, [icon('i-table', 13)]),
        el('span', { class: 'outline__text', text: t('doc.table', { rows: rows, cols: cols }) })
      ]);
    }
    if (block.type === 'image') {
      return el('li', { class: 'outline__row outline__row--table' }, [
        el('span', { class: 'outline__tag', 'aria-hidden': 'true', text: '▣' }),
        el('span', { class: 'outline__text', text: t('doc.image') })
      ]);
    }
    var text = paragraphText(block).replace(/\s+/g, ' ').trim();
    var style = block.style || 'normal';
    var tag = '';
    var kind = 'para';
    if (block.list) {
      kind = 'list';
      var level = block.list.level || 0;
      if (block.list.kind === 'number') {
        counters[level] = (counters[level] || 0) + 1;
        counters.length = level + 1;
        tag = counters[level] + '.';
      } else {
        tag = '•';
      }
    } else {
      counters.length = 0;
      if (style === 'title') { kind = 'title'; }
      else if (style === 'subtitle') { kind = 'sub'; }
      else if (/^h[1-6]$/.test(style)) { kind = 'heading'; tag = style.toUpperCase(); }
    }
    if (!text) { kind = 'empty'; text = t('doc.emptyLine'); }
    return el('li', { class: 'outline__row outline__row--' + kind }, [
      el('span', { class: 'outline__tag', 'aria-hidden': 'true', text: tag }),
      el('span', { class: 'outline__text', text: text })
    ]);
  }

  function renderDoc() {
    var loaded = !!ui.doc;
    $('docEmpty').hidden = loaded;
    $('docLoaded').hidden = !loaded;

    if (!loaded) {
      var zone = $('dropZone');
      zone.classList.toggle('is-busy', !!ui.loading);
      zone.setAttribute('aria-busy', String(!!ui.loading));
      $('dropMain').textContent = ui.loading
        ? t('doc.loading', { name: ui.loading })
        : zone.classList.contains('is-over') ? t('doc.dropActive') : t('doc.drop');

      $('pasteToggle').textContent = ui.pasteOpen ? t('doc.pasteHide') : t('doc.pasteToggle');
      $('pasteToggle').setAttribute('aria-expanded', String(ui.pasteOpen));
      setOpen('pasteBox', ui.pasteOpen);
      renderPasteCount();

      var err = $('docError');
      err.hidden = !ui.docError;
      clear(err);
      if (ui.docError) {
        err.appendChild(icon('i-warn', 14)).setAttribute('class', 'note__icon');
        err.appendChild(el('span', { text: t(ui.docError.key, ui.docError.params) }));
      }
      return;
    }

    $('fileName').textContent = displayFileName();
    var s = ui.stats;
    var parts = [];
    if (s) {
      parts.push(t('doc.words', { count: s.words || 0 }));
      parts.push(t('doc.paragraphs', { count: s.paragraphs || 0 }));
      if (s.tables) parts.push(t('doc.tables', { count: s.tables }));
      if (s.images) parts.push(t('doc.images', { count: s.images }));
    }
    if (ui.doc.header) parts.push(t('doc.header'));
    if (ui.doc.footer) parts.push(t('doc.footer'));
    // One span per figure so a line break never splits "1 table".
    var statsBox = $('fileStats');
    clear(statsBox);
    parts.forEach(function (part, i) {
      statsBox.appendChild(el('span', { text: part + (i < parts.length - 1 ? ' ·' : '') }));
    });

    var warns = $('docWarnings');
    clear(warns);
    warns.hidden = !ui.warnings.length;
    ui.warnings.slice(0, 3).forEach(function (w) {
      warns.appendChild(el('li', null, [icon('i-warn', 14), el('span', { text: warningText(w) })]));
    });
    if (ui.warnings.length > 3) {
      warns.appendChild(el('li', { class: 'warns__more', text: t('doc.warnMore', { count: ui.warnings.length - 3 }) }));
    }

    var outline = $('outline');
    clear(outline);
    var counters = [];
    ui.doc.blocks.slice(0, OUTLINE_MAX).forEach(function (b) { outline.appendChild(outlineRow(b, counters)); });
    var rest = ui.doc.blocks.length - OUTLINE_MAX;
    $('outlineMore').hidden = rest <= 0;
    $('outlineMore').textContent = rest > 0 ? t('doc.more', { count: rest }) : '';
  }

  function renderPasteCount() {
    var text = $('pasteText').value.trim();
    var words = text ? text.split(/\s+/).length : 0;
    $('pasteCount').textContent = words ? t('doc.words', { count: words }) : '';
    $('pasteUse').disabled = !words;
  }

  function renderStyle() {
    // Estimate line: "About <strong>1 hr 2 min</strong> of active typing"
    var est = $('estimate');
    clear(est);
    if (ui.estimate && isFinite(ui.estimate.ms)) {
      var parts = t('style.estimate', { duration: '\u0000' }).split('\u0000');
      est.appendChild(document.createTextNode(parts[0]));
      est.appendChild(el('strong', { text: I.fmtDuration(ui.estimate.ms) }));
      est.appendChild(document.createTextNode(parts[1] || ''));
    } else {
      est.textContent = t('style.estimateNone');
    }

    $('speedSlow').checked = ui.speed === 'slow';
    $('speedNormal').checked = ui.speed === 'normal';
    $('speedFast').checked = ui.speed === 'fast';
    $('paceHint').textContent = t('style.paceHint.' + ui.speed);

    $('typo').value = String(ui.typo);
    $('typoValue').textContent = I.fmtPercent(ui.typo / 100, 1);
    $('typo').setAttribute('aria-valuetext', I.fmtPercent(ui.typo / 100, 1));
    $('typoHint').textContent = ui.typo > 0 ? t('style.typosHint') : t('style.typosNone');

    var sel = $('layout');
    sel.options[0].textContent = ui.doc && ui.detected && I.has('style.layout.' + ui.detected)
      ? t('style.layout.autoDetected', { layout: t('style.layout.' + ui.detected) })
      : t('style.layout.auto');
    sel.options[1].textContent = t('style.layout.trq');
    sel.options[2].textContent = t('style.layout.qwerty');
    sel.value = ui.layout;

    var fam = $('fontFamily');
    var size = $('fontSize');
    fam.placeholder = t('style.fontPlaceholder');
    if (document.activeElement !== fam) fam.value = ui.fontFamily;
    if (document.activeElement !== size) size.value = ui.fontSize;
    $('fontHint').textContent = ui.fontFromFile && ui.doc && ui.fileName === ui.fontFromFile
      ? t('style.fontHintFile', { name: ui.fontFromFile })
      : t('style.fontHint');
  }

  function toLocalInput(ts) {
    if (!isFinite(ts)) return '';
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fillHourSelect(sel, from, to, value) {
    if (sel.options.length !== to - from + 1) {
      clear(sel);
      for (var h = from; h <= to; h++) sel.appendChild(el('option', { value: h, text: hourLabel(h) + ':00' }));
    }
    sel.value = String(value);
  }

  function renderDayChips() {
    var box = $('dayChips');
    clear(box);
    DAY_ORDER.forEach(function (d) {
      var on = ui.days.indexOf(d) >= 0;
      var chip = el('button', {
        type: 'button', class: 'chip', 'data-day': d, 'aria-pressed': String(on),
        'aria-label': I.fmtWeekday(d, 'long'), text: I.fmtWeekday(d, 'short')
      });
      box.appendChild(chip);
    });
  }

  function renderSchedule() {
    $('modeNow').checked = ui.mode === 'now';
    $('modeDeadline').checked = ui.mode === 'deadline';
    setOpen('nowHint', ui.mode === 'now');
    setOpen('deadlineBox', ui.mode === 'deadline');
    if (ui.mode !== 'deadline') return;

    var input = $('deadline');
    if (document.activeElement !== input) input.value = toLocalInput(ui.deadline);
    input.min = toLocalInput(Date.now());
    fillHourSelect($('hoursStart'), 0, 23, ui.hoursStart);
    fillHourSelect($('hoursEnd'), 1, 24, ui.hoursEnd);

    // Chips keep focus across renders: update in place when they exist.
    var chips = $('dayChips').querySelectorAll('.chip');
    if (chips.length !== 7 || $('dayChips').getAttribute('data-lang') !== I.getLanguage()) {
      renderDayChips();
      $('dayChips').setAttribute('data-lang', I.getLanguage());
    } else {
      chips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(ui.days.indexOf(Number(c.getAttribute('data-day'))) >= 0));
      });
    }

    var problem = planProblem();
    var warn = $('planWarn');
    var empty = $('planEmpty');
    var holder = $('planTimeline');
    clear(warn);
    warn.hidden = !problem;
    if (problem) {
      warn.appendChild(icon('i-warn', 14)).setAttribute('class', 'note__icon');
      warn.appendChild(el('span', { text: problem }));
    }
    empty.hidden = !!ui.doc;
    empty.textContent = ui.doc ? '' : t('sched.needDoc');

    var ok = ui.plan && ui.plan.feasible && ui.plan.sessions && ui.plan.sessions.length;
    $('planSummary').textContent = ok ? sessionsSummary(ui.plan.sessions) : '';
    $('planAwake').hidden = !ok;
    var sig = ok ? JSON.stringify([ui.plan.sessions, ui.hoursStart, ui.hoursEnd, ui.showAllDays, I.getLanguage()]) : '';
    if (sig !== timelineSig.plan) {
      timelineSig.plan = sig;
      holder.classList.toggle('tl-enter', !holder.firstChild);
      clear(holder);
      if (ok) {
        holder.appendChild(buildTimeline(ui.plan.sessions, {
          range: [ui.hoursStart, ui.hoursEnd],
          maxDays: TIMELINE_MAX_DAYS,
          expanded: ui.showAllDays,
          onExpand: function () { ui.showAllDays = true; renderSchedule(); }
        }));
      }
    }
  }

  function startBlocker() {
    if (!ui.doc) return 'action.reason.noDoc';
    if (!remote.target) return 'action.reason.noTarget';
    if (ui.mode === 'deadline' && !(ui.plan && ui.plan.feasible)) return 'action.reason.schedule';
    return null;
  }

  function renderAction() {
    var btn = $('startBtn');
    var blocker = startBlocker();
    btn.textContent = ui.starting ? t('action.starting') : t(ui.mode === 'deadline' ? 'action.schedule' : 'action.start');
    btn.disabled = !!blocker || ui.starting;
    var reason = '';
    if (blocker) reason = t(blocker);
    else if (ui.mode === 'deadline' && ui.plan.sessions && ui.plan.sessions[0]) {
      reason = t('action.readyDeadline', { time: I.fmtDayTime(ui.plan.sessions[0].start) });
    } else reason = t('action.ready', { title: targetTitle() });
    $('startReason').textContent = reason;
  }

  function fact(label, value) {
    return [el('dt', { text: label }), el('dd', { text: value })];
  }

  function sameDay(a, b) { return dayStart(a) === dayStart(b); }

  function renderRunFacts() {
    var job = remote.job;
    var box = $('runFacts');
    clear(box);
    if (!job) return;
    var active = !!ACTIVE[job.status];
    var rows = [];
    if (job.mode !== 'deadline' && active && isFinite(job.startedAt)) {
      rows.push(fact(t('run.elapsed'), I.fmtDuration(Math.max(0, Date.now() - job.startedAt))));
    }
    if (active && isFinite(job.etaMs)) {
      rows.push(fact(t('run.remaining'), t('run.about', { duration: I.fmtDuration(job.etaMs) })));
    }
    if (active && job.status !== 'running' && isFinite(job.nextSessionAt)) {
      var next = job.nextSessionAt;
      rows.push(fact(t('run.nextSitting'), sameDay(next, Date.now()) ? I.fmtTime(next) : I.fmtDayTime(next)));
    }
    if (job.mode === 'deadline' && isFinite(job.deadline) && job.status !== 'done') {
      rows.push(fact(t('run.finishBy'), I.fmtDayTime(job.deadline)));
    }
    box.hidden = !rows.length;
    rows.forEach(function (pair) { box.appendChild(el('div', null, pair)); });
  }

  function jobMessage(job) {
    if (!job.message) return t('run.errorNote');
    return I.has(job.message) ? t(job.message) : String(job.message);
  }

  function renderRun() {
    var job = remote.job;
    if (!job) return;
    var status = job.status;
    var active = !!ACTIVE[status];

    var statusText;
    if (status === 'waiting') {
      statusText = isFinite(job.nextSessionAt)
        ? t('run.status.waiting', {
          time: sameDay(job.nextSessionAt, Date.now()) ? I.fmtTime(job.nextSessionAt) : I.fmtDayTime(job.nextSessionAt)
        })
        : t('run.status.waitingNoTime');
    } else {
      statusText = t(I.has('run.status.' + status) ? 'run.status.' + status : 'run.status.error');
    }
    $('runStatus').setAttribute('data-status', status);
    if ($('runStatusText').textContent !== statusText) {
      $('runStatusText').textContent = statusText;
      replay($('runStatus'), 'is-swapped');
    }
    $('runFile').textContent = job.fileName || t('doc.pastedName');

    var kind = $('runKind');
    kind.hidden = !(job.kind && I.has('run.kind.' + job.kind) && (active || job.kind === 'fill'));
    if (!kind.hidden) kind.textContent = t(active ? 'run.kind.' + job.kind : 'run.kind.fillEnded');

    var p = job.progress || {};
    var frac = p.charsTotal > 0 ? p.charsDone / p.charsTotal : (p.blocksTotal > 0 ? p.blocksDone / p.blocksTotal : 0);
    if (status === 'done') frac = 1;
    frac = Math.max(0, Math.min(1, frac || 0));
    var pct = I.fmtPercent(Math.floor(frac * 100) / 100, 0);
    var blocks = t('run.progress', { done: I.fmtNumber(p.blocksDone || 0), total: I.fmtNumber(p.blocksTotal || 0) });
    $('runPct').textContent = pct;
    $('runBlocks').textContent = blocks;
    var bar = $('runBar');
    bar.setAttribute('data-status', status);
    bar.setAttribute('aria-valuenow', String(Math.floor(frac * 100)));
    bar.setAttribute('aria-valuetext', blocks + ' · ' + pct);
    $('runBarFill').style.width = (frac * 100) + '%';

    renderRunFacts();

    // Template fill summary
    var fill = job.kind === 'fill' && job.fill ? job.fill : null;
    $('runFill').hidden = !fill;
    if (fill) {
      var bits = ['unchanged', 'replaced', 'inserted', 'appended'].filter(function (k) { return fill[k] > 0; })
        .map(function (k) { return t('run.fill.' + k, { count: fill[k] }); });
      var sum = $('runFillSum');
      sum.hidden = !bits.length;
      if (sum.getAttribute('data-sig') !== bits.join('|')) {
        sum.setAttribute('data-sig', bits.join('|'));
        clear(sum);
        bits.forEach(function (bit, i) {
          sum.appendChild(el('span', { text: bit + (i < bits.length - 1 ? ' ·' : '') }));
        });
      }
      var problems = Array.isArray(fill.problems) ? fill.problems : [];
      $('runFillProblems').hidden = !problems.length;
      $('runFillProblemsSum').textContent = t('run.fill.problems', { count: problems.length });
      var list = $('runFillProblemsList');
      var sig = problems.join('\n');
      if (list.getAttribute('data-sig') !== sig) {
        list.setAttribute('data-sig', sig);
        clear(list);
        problems.forEach(function (line) { list.appendChild(el('li', { text: I.has(line) ? t(line) : String(line) })); });
      }
    }

    // Outcome / attention note
    var note = $('runNote');
    var noteKind = null;
    var noteText = '';
    if (status === 'done') { noteKind = 'ok'; noteText = t('run.doneNote'); }
    else if (status === 'stopped') { noteKind = 'plain'; noteText = t('run.stoppedNote'); }
    else if (status === 'error') { noteKind = 'danger'; noteText = jobMessage(job); }
    else if (!remote.target) { noteKind = 'warn'; noteText = t('run.noTarget'); }
    else if (job.message) { noteKind = 'warn'; noteText = jobMessage(job); }
    note.hidden = !noteKind;
    var noteSig = noteKind + '|' + noteText;
    if (note.getAttribute('data-sig') !== noteSig) {
      note.setAttribute('data-sig', noteSig);
      clear(note);
      note.className = 'note' + (noteKind && noteKind !== 'plain' ? ' note--' + noteKind : '');
      if (noteKind === 'danger' || noteKind === 'warn') note.setAttribute('role', 'alert'); else note.removeAttribute('role');
      if (noteKind && noteKind !== 'plain') {
        note.appendChild(icon(noteKind === 'ok' ? 'i-check' : 'i-warn', 14)).setAttribute('class', 'note__icon');
      }
      note.appendChild(el('span', { text: noteText }));
    }

    // Actions
    if (!active) ui.stopConfirm = false;
    var pause = $('pauseBtn');
    pause.hidden = !active;
    pause.textContent = status === 'paused' ? t('run.resume') : t('run.pause');
    pause.className = 'btn ' + (status === 'paused' ? 'btn--primary' : 'btn--quiet');
    $('stopBtn').hidden = !active;
    $('newBtn').hidden = active;
    $('runActions').hidden = ui.stopConfirm;
    setOpen('stopConfirm', ui.stopConfirm);

    // Sittings
    var sessions = Array.isArray(job.sessions) ? job.sessions : [];
    $('runSittings').hidden = !sessions.length;
    if (sessions.length) {
      $('runSittingsSum').textContent = sessionsSummary(sessions);
      var tsig = JSON.stringify([sessions, ui.showAllDays, I.getLanguage()]);
      if (tsig !== timelineSig.run) {
        timelineSig.run = tsig;
        var holder = $('runTimeline');
        holder.classList.toggle('tl-enter', !holder.firstChild); // bars grow in once, not on every update
        clear(holder);
        holder.appendChild(buildTimeline(sessions, {
          range: null, maxDays: TIMELINE_MAX_DAYS, expanded: ui.showAllDays,
          onExpand: function () { ui.showAllDays = true; renderRun(); }
        }));
        var legend = $('runLegend');
        clear(legend);
        ['done', 'current', 'upcoming', 'missed'].forEach(function (k) {
          if (!sessions.some(function (s) { return s.status === k; })) return;
          legend.appendChild(el('li', null, [
            el('span', { class: 'tl__bar tl__bar--' + k }),
            el('span', { text: t('run.legend.' + k) })
          ]));
        });
      }
    }
  }

  // ───────────────────────── Typing strip ─────────────────────────
  // Decorative. The worker reports progress every few seconds, far too coarse
  // to mirror real keystrokes, so while the job is running the strip plays a
  // rhythm of its own: a burst inside each word, a beat on the space, a longer
  // think at the end of a sentence, and the odd slip that gets backspaced.
  // Timings here are assumed (tuned by eye) and unrelated to the planner's model.

  var SCRIBE_MAX_WORDS = 36;
  var scribe = { on: false, timer: null, word: null, len: 0, n: 0, undo: 0, slipAt: -1, noticeAt: -1, sentence: 8 };
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }

  function scribeLength() { return 2 + Math.floor(Math.pow(Math.random(), 1.6) * 9); } // 2–10, mostly short

  function scribeNewWord() {
    var line = $('scribeLine');
    var s = scribe;
    s.word = line.appendChild(el('span', { class: 'scribe__word' }));
    s.len = scribeLength();
    s.n = 0;
    s.undo = 0;
    s.slipAt = s.len >= 4 && Math.random() < 0.12 ? 2 + Math.floor(Math.random() * (s.len - 2)) : -1;
    s.noticeAt = s.slipAt < 0 ? -1 : Math.min(s.len, s.slipAt + (Math.random() < 0.5 ? 1 : 0));
    while (line.children.length > SCRIBE_MAX_WORDS) line.removeChild(line.firstChild);
  }

  // Opening the panel on a job already under way should not look like page one.
  function scribeSeed() {
    var line = $('scribeLine');
    for (var i = 0; i < SCRIBE_MAX_WORDS - 6; i++) {
      line.appendChild(el('span', { class: 'scribe__word' })).style.setProperty('--n', String(scribeLength()));
    }
  }

  function scribeStep() {
    var s = scribe;
    s.timer = null;
    if (!s.on) return;
    var delay;
    if (!s.word) {
      scribeNewWord();
      delay = rnd(140, 300);
    } else if (s.undo > 0) {                    // backspacing a slip
      s.n--;
      s.undo--;
      delay = s.undo ? rnd(70, 120) : rnd(180, 320);
    } else if (s.n < s.len) {                   // a key inside the word
      s.n++;
      delay = rnd(55, 150);
      if (Math.random() < 0.08) delay += rnd(120, 260);
      if (s.n === s.noticeAt) {                 // spotted the slip: stop, then go back
        s.undo = s.noticeAt - s.slipAt + 1;
        s.noticeAt = -1;
        delay = rnd(280, 480);
      }
    } else {                                    // space, on to the next word
      scribeNewWord();
      s.sentence--;
      if (s.sentence <= 0) {
        s.sentence = 5 + Math.floor(Math.random() * 10);
        delay = rnd(750, 1600);
      } else {
        delay = rnd(140, 300);
      }
    }
    s.word.style.setProperty('--n', String(s.n));
    $('scribe').classList.toggle('is-idle', delay > 600);
    s.timer = setTimeout(scribeStep, delay);
  }

  function scribeSync() {
    var job = remote.job;
    var box = $('scribe');
    var show = !!(job && ACTIVE[job.status]);
    var live = show && job.status === 'running' && !document.hidden && !(reduceMotion && reduceMotion.matches);
    if (show && box.hidden) {
      var p = job.progress || {};
      if (p.charsDone > 0 || p.blocksDone > 0) scribeSeed();
    }
    if (!show && !box.hidden) {
      clear($('scribeLine'));
      scribe.word = null;
    }
    box.hidden = !show;
    box.classList.toggle('is-live', live);
    if (live === scribe.on) return;
    scribe.on = live;
    clearTimeout(scribe.timer);
    scribe.timer = null;
    if (live) scribe.timer = setTimeout(scribeStep, 320);
    else box.classList.remove('is-idle');
  }

  function renderFooter() {
    $('selftestBtn').setAttribute('aria-expanded', String(ui.selftestOpen));
    setOpen('selftestBox', ui.selftestOpen);
    var out = '';
    if (ui.selftest) {
      if (ui.selftest.running) out = t('selftest.running');
      else if (ui.selftest.timeout) out = t('selftest.timeout');
      else out = (ui.selftest.lines || []).join('\n');
    }
    $('selftestOut').textContent = out;

    $('aboutBtn').setAttribute('aria-expanded', String(ui.aboutOpen));
    setOpen('aboutBox', ui.aboutOpen);
    var version = '';
    try { if (hasRuntime) version = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
    $('aboutVersion').textContent = t('about.version', { version: version || t('about.versionDev') });

    $('previewBadge').hidden = !(bridge.isMock || (Mock && Mock.stubbed.length));
  }

  function render() {
    var running = !!remote.job;
    $('setupView').hidden = running;
    $('actionBar').hidden = running;
    $('runView').hidden = !running;
    renderHeader();
    if (running) {
      renderRun();
    } else {
      renderDoc();
      renderStyle();
      renderSchedule();
      renderAction();
    }
    scribeSync();
    renderFooter();
  }

  // ───────────────────────── Events ─────────────────────────

  function bindLanguage() {
    document.querySelectorAll('.lang__btn').forEach(function (b) {
      b.addEventListener('click', function () { I.setLanguage(b.getAttribute('data-lang')); });
    });
    I.onChange(function () {
      timelineSig.plan = timelineSig.run = '';
      applyStaticI18n();
      render();
    });
  }

  function bindDocument() {
    var zone = $('dropZone');
    var input = $('fileInput');
    var depth = 0;

    zone.addEventListener('click', function () { if (!ui.loading) input.click(); });
    input.addEventListener('change', function () {
      loadFile(input.files && input.files[0]);
      input.value = '';
    });

    function hasFiles(e) {
      return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
    }
    function setOver(on) {
      zone.classList.toggle('is-over', on);
      if (!ui.doc && !ui.loading) $('dropMain').textContent = on ? t('doc.dropActive') : t('doc.drop');
    }
    // Accept a drop anywhere on the panel; this also stops Chrome from
    // navigating the panel to the dropped file.
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e) || remote.job) return;
      depth++;
      setOver(true);
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = remote.job ? 'none' : 'copy';
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (remote.job || ui.loading) return;
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) { clearDoc(); loadFile(file); }
    });

    $('pasteToggle').addEventListener('click', function () {
      ui.pasteOpen = !ui.pasteOpen;
      ui.docError = null;
      render();
      if (ui.pasteOpen) $('pasteText').focus();
    });
    $('pasteText').addEventListener('input', renderPasteCount);
    $('pasteUse').addEventListener('click', usePastedText);
    $('replaceBtn').addEventListener('click', function () {
      clearDoc();
      render();
      $('dropZone').focus();
    });
  }

  function bindStyle() {
    $('typo').addEventListener('input', function () {
      ui.typo = Number($('typo').value);
      $('typoValue').textContent = I.fmtPercent(ui.typo / 100, 1);
      $('typoHint').textContent = ui.typo > 0 ? t('style.typosHint') : t('style.typosNone');
      // The estimate walks the whole document: wait until the slider rests.
      clearTimeout(timers.estimate);
      timers.estimate = setTimeout(function () { recompute(); saveSettings(); render(); }, 140);
    });
    $('layout').addEventListener('change', function () {
      ui.layout = $('layout').value;
      recompute();
      saveSettings();
      render();
    });
    ['speedSlow', 'speedNormal', 'speedFast'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (!$(id).checked) return;
        ui.speed = $(id).value;
        recompute();
        saveSettings();
        render();
      });
    });
    function onFont() {
      ui.fontFamily = $('fontFamily').value.trim();
      ui.fontSize = $('fontSize').value.trim();
      ui.fontFromFile = '';
      saveSettings();
    }
    $('fontFamily').addEventListener('change', function () { onFont(); render(); });
    $('fontSize').addEventListener('change', function () { onFont(); render(); });
  }

  function bindSchedule() {
    function onMode() {
      ui.mode = $('modeDeadline').checked ? 'deadline' : 'now';
      if (ui.mode === 'deadline' && (!isFinite(ui.deadline) || ui.deadline < Date.now())) ui.deadline = defaultDeadline();
      recomputePlan();
      saveSettings();
      render();
    }
    $('modeNow').addEventListener('change', onMode);
    $('modeDeadline').addEventListener('change', onMode);

    $('deadline').addEventListener('input', function () {
      var v = $('deadline').value;
      ui.deadline = v ? new Date(v).getTime() : NaN;
      ui.showAllDays = false;
      recomputePlan();
      render();
    });

    $('hoursStart').addEventListener('change', function () {
      ui.hoursStart = Number($('hoursStart').value);
      if (ui.hoursEnd <= ui.hoursStart) ui.hoursEnd = Math.min(24, ui.hoursStart + 1);
      recomputePlan(); saveSettings(); render();
    });
    $('hoursEnd').addEventListener('change', function () {
      ui.hoursEnd = Number($('hoursEnd').value);
      if (ui.hoursStart >= ui.hoursEnd) ui.hoursStart = Math.max(0, ui.hoursEnd - 1);
      recomputePlan(); saveSettings(); render();
    });

    $('dayChips').addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.chip') : null;
      if (!chip) return;
      var d = Number(chip.getAttribute('data-day'));
      var i = ui.days.indexOf(d);
      if (i >= 0) ui.days.splice(i, 1); else ui.days.push(d);
      recomputePlan(); saveSettings(); render();
    });

    // "now" moves on: keep the preview honest while the panel stays open.
    setInterval(function () {
      if (!remote.job && ui.mode === 'deadline' && ui.doc && document.activeElement !== $('deadline')) {
        recomputePlan();
        renderSchedule();
        renderAction();
      }
    }, 60000);
  }

  function bindActions() {
    $('startBtn').addEventListener('click', function () {
      if (startBlocker() || ui.starting) return;
      var schedule = ui.mode === 'deadline'
        ? { mode: 'deadline', deadline: ui.deadline, hours: { start: ui.hoursStart, end: ui.hoursEnd }, days: ui.days.slice().sort() }
        : { mode: 'now' };
      var sent = bridge.post({
        type: 'job:create',
        doc: ui.doc,
        fileName: displayFileName(),
        options: typingOptions(),
        schedule: schedule
      });
      if (!sent) return;
      ui.starting = true;
      ui.showAllDays = false;
      renderAction();
      clearTimeout(timers.starting);
      timers.starting = setTimeout(function () { ui.starting = false; render(); }, 6000);
    });

    $('pauseBtn').addEventListener('click', function () {
      if (!remote.job) return;
      bridge.post({ type: remote.job.status === 'paused' ? 'job:resume' : 'job:pause' });
    });

    function closeConfirm(focusStop) {
      ui.stopConfirm = false;
      renderRun();
      if (focusStop && !$('stopBtn').hidden) $('stopBtn').focus();
    }
    $('stopBtn').addEventListener('click', function () {
      ui.stopConfirm = true;
      renderRun();
      $('stopNo').focus();
    });
    $('stopNo').addEventListener('click', function () { closeConfirm(true); });
    $('stopYes').addEventListener('click', function () {
      bridge.post({ type: 'job:stop' });
      ui.stopConfirm = false;
      renderRun();
    });
    $('stopConfirm').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeConfirm(true); }
    });

    $('newBtn').addEventListener('click', function () {
      clearDoc();
      $('pasteText').value = '';
      ui.pasteOpen = false;
      bridge.post({ type: 'job:clear' });
    });
  }

  function bindFooter() {
    $('selftestBtn').addEventListener('click', function () {
      ui.selftestOpen = true;
      ui.selftest = { running: true };
      renderFooter();
      clearTimeout(timers.selftest);
      var sent = bridge.post({ type: 'selftest' });
      timers.selftest = setTimeout(function () {
        if (ui.selftest && ui.selftest.running) { ui.selftest = { timeout: true }; renderFooter(); }
      }, sent ? 8000 : 0);
    });
    $('aboutBtn').addEventListener('click', function () {
      ui.aboutOpen = !ui.aboutOpen;
      renderFooter();
    });
  }

  function onBridgeMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state' && msg.state) {
      var hadJob = !!remote.job;
      remote.target = msg.state.target || null;
      remote.job = msg.state.job || null;
      if (remote.job) { ui.starting = false; clearTimeout(timers.starting); }
      if (hadJob !== !!remote.job) {
        ui.stopConfirm = false;
        ui.showAllDays = false;
        timelineSig.plan = timelineSig.run = '';
      }
      render();
      if (hadJob !== !!remote.job) {
        window.scrollTo(0, 0);
        replay(remote.job ? $('runView') : $('setupView'), 'view-enter');
      }
    } else if (msg.type === 'selftest:result') {
      clearTimeout(timers.selftest);
      ui.selftest = { lines: Array.isArray(msg.lines) ? msg.lines.map(String) : [] };
      ui.selftestOpen = true;
      renderFooter();
    }
  }

  // ───────────────────────── Start ─────────────────────────

  function start() {
    ui.deadline = defaultDeadline();

    // Mock-only: pre-fill the setup view for ?state=loaded|deadline|infeasible.
    if (bridge.isMock && Mock) {
      var preset = Mock.uiPreset(I.getLanguage());
      if (preset) {
        ui.mode = preset.mode;
        if (preset.deadline) ui.deadline = preset.deadline;
        setDoc(preset.doc, preset.fileName, preset.warnings, false);
      }
    }

    applyStaticI18n();
    bindLanguage();
    bindDocument();
    bindStyle();
    bindSchedule();
    bindActions();
    bindFooter();
    recompute();
    render();

    // Hairline under the floating header only while content is beneath it.
    var onScroll = function () { $('app').classList.toggle('is-scrolled', window.scrollY > 2); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    bridge.onMessage(onBridgeMessage);
    bridge.start();

    // The typing strip rests while the panel is out of sight or motion is reduced.
    document.addEventListener('visibilitychange', scribeSync);
    if (reduceMotion && reduceMotion.addEventListener) reduceMotion.addEventListener('change', scribeSync);

    // Keep "elapsed" moving while a job is active.
    setInterval(function () {
      if (remote.job && ACTIVE[remote.job.status]) renderRunFacts();
    }, 1000);
  }

  var forcedLang = bridge.isMock && Mock ? Mock.params.lang : null;
  I.init(forcedLang)
    .then(function () { return I.storageGet(SETTINGS_KEY); })
    .then(function (saved) {
      // A screenshot state should not inherit settings from an earlier visit.
      if (!(bridge.isMock && Mock && Mock.params.state)) applySettings(saved);
      start();
    });
})();
