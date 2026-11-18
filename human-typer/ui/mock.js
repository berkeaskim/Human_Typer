// Human Typer — MOCK-ONLY helpers for developing and screenshotting the panel.
//
// Nothing in this file talks to Google Docs or to the service worker.
//   1. Library stubs: tiny stand-ins for HumanTyperDoc / HumanTyperPlanner /
//      HumanTyperScheduler, installed function by function ONLY where the real
//      library has not been loaded. They are rough approximations.
//   2. A fake bridge, used by sidepanel.js when chrome.runtime is unavailable
//      (panel opened from disk or a static server). It simulates a connected
//      Google Doc and a job that goes running → waiting → running → done.
//   3. Query parameters to jump to a state:
//        ?state=empty|notarget|loaded|deadline|infeasible|running|paused|waiting|done|error|stopped|fill|filldone
//        &lang=en|tr
//        &kind=fill   (jobs created from the setup view report a template fill)
(function (root) {
  'use strict';

  var MIN = 60000;
  var HOUR = 3600000;
  var DAY = 86400000;

  var params = {};
  try {
    new URLSearchParams(root.location.search).forEach(function (v, k) { params[k] = v; });
  } catch (e) { /* no location (tests) */ }

  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var x = Math.imul(s ^ (s >>> 15), 1 | s);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ───────────────────────── Library stubs (mock-only) ─────────────────────────

  var stubbed = [];

  function para(text, style, list) {
    return { type: 'paragraph', style: style || 'normal', list: list || null, align: 'left', runs: [{ text: text }] };
  }

  function stubParsePlain(text) {
    var blocks = [];
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (line.trim()) blocks.push(para(line.trim()));
    });
    return { blocks: blocks };
  }

  function stubParseMarkdown(text) {
    var blocks = [];
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var table = null;
    lines.forEach(function (raw) {
      var line = raw.trim();
      var m;
      if (/^\|.*\|$/.test(line)) {
        if (/^\|[\s:|-]+\|$/.test(line)) return; // separator row
        if (!table) { table = { type: 'table', rows: [] }; blocks.push(table); }
        table.rows.push(line.slice(1, -1).split('|').map(function (c) {
          return { paragraphs: [para(c.trim())] };
        }));
        return;
      }
      table = null;
      if (!line) return;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) blocks.push(para(m[2], 'h' + m[1].length));
      else if ((m = /^[-*+]\s+(.*)$/.exec(line))) blocks.push(para(m[1], 'normal', { kind: 'bullet', level: 0 }));
      else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) blocks.push(para(m[1], 'normal', { kind: 'number', level: 0 }));
      else blocks.push(para(line));
    });
    return { blocks: blocks };
  }

  function stubParseFile(name, buffer) {
    return new Promise(function (resolve, reject) {
      var ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1];
      ext = ext ? ext.toLowerCase() : '';
      if (ext === 'docx') {
        reject(new Error('mock parser cannot read .docx (lib/docx.js is not loaded)'));
        return;
      }
      var text = new TextDecoder('utf-8').decode(buffer);
      var doc = ext === 'md' || ext === 'markdown' ? stubParseMarkdown(text) : stubParsePlain(text);
      resolve({ doc: doc, warnings: ['Mock parser in use: formatting is approximated.'] });
    });
  }

  function paragraphText(p) {
    return (p.runs || []).map(function (r) { return r.text || ''; }).join('');
  }

  function stubStats(doc) {
    var s = { blocks: 0, paragraphs: 0, tables: 0, words: 0, chars: 0 };
    function count(p) {
      var text = paragraphText(p);
      s.chars += text.length + 1;
      var w = text.trim().split(/\s+/).filter(Boolean);
      s.words += w.length;
    }
    ((doc && doc.blocks) || []).forEach(function (b) {
      s.blocks++;
      if (b.type === 'table') {
        s.tables++;
        (b.rows || []).forEach(function (row) {
          row.forEach(function (cell) { (cell.paragraphs || []).forEach(count); });
        });
      } else {
        s.paragraphs++;
        count(b);
      }
    });
    return s;
  }

  function stubEstimate(doc, o) {
    var chars = stubStats(doc).chars;
    var wpm = 52; // the real planner picks and varies the pace itself
    var typo = (o && o.typoRate) || 0;
    var keys = Math.round(chars * (1 + typo * 2.4));
    // Mean inter-key time plus a flat allowance for pauses and corrections.
    var ms = chars * (60000 / (wpm * 5)) * (1.14 + typo * 5);
    return { ms: Math.round(ms), chars: chars, keys: keys };
  }

  function stubDetectLayout(text) {
    return /[çğıöşüÇĞİÖŞÜ]/.test(String(text)) ? 'trq' : 'qwerty';
  }

  function stubPlanSessions(o) {
    var now = o.now;
    var deadline = o.deadline;
    var workMs = Math.max(0, o.workMs || 0);
    if (!(deadline > now)) return { feasible: false, sessions: [], totalBudgetMs: 0, reason: 'deadline_passed' };

    var days = o.days || [0, 1, 2, 3, 4, 5, 6];
    var hStart = o.hours ? o.hours.start : 0;
    var hEnd = o.hours ? o.hours.end : 24;
    var windows = [];
    var d = new Date(now);
    d.setHours(0, 0, 0, 0);
    for (; d.getTime() < deadline; d.setDate(d.getDate() + 1)) {
      if (days.indexOf(d.getDay()) < 0) continue;
      var a = new Date(d); a.setHours(hStart, 0, 0, 0);
      var b = new Date(d); b.setHours(hEnd, 0, 0, 0);
      var s = Math.max(now + MIN, a.getTime());
      var e = Math.min(deadline, b.getTime());
      if (e - s >= 10 * MIN) windows.push({ start: s, end: e });
    }
    if (!windows.length) return { feasible: false, sessions: [], totalBudgetMs: 0, reason: 'no_allowed_window' };

    var total = windows.reduce(function (acc, w) { return acc + (w.end - w.start); }, 0);
    var capacity = Math.round(total * 0.6); // leave room for breaks between sittings
    if (capacity < workMs) {
      return { feasible: false, sessions: [], totalBudgetMs: 0, reason: 'not_enough_time', availableMs: capacity, requiredMs: workMs };
    }

    var r = rng(o.seed || 1);
    var sMin = ((o.sessionMin && o.sessionMin.min) || 20) * MIN;
    var sMax = ((o.sessionMin && o.sessionMin.max) || 45) * MIN;
    var gap = (o.gapMin || 15) * MIN;
    var sessions = [];
    var left = workMs;

    windows.forEach(function (w, i) {
      if (left <= 0) return;
      var len = w.end - w.start;
      var share = i === windows.length - 1 ? left : Math.min(left, Math.ceil(workMs * (len / total) * 1.15));
      share = Math.min(share, Math.round(len * 0.6));
      var parts = [];
      var rest = share;
      while (rest > 0) {
        var dur = Math.round((sMin + r() * (sMax - sMin)) / MIN) * MIN;
        if (rest - dur < 8 * MIN) dur = rest; // do not leave a tiny tail
        dur = Math.min(dur, rest);
        parts.push(dur);
        rest -= dur;
      }
      var slack = len - share - gap * Math.max(0, parts.length - 1);
      var weights = parts.map(function () { return 0.4 + r(); });
      weights.push(0.4 + r());
      var wsum = weights.reduce(function (x, y) { return x + y; }, 0);
      var cursor = w.start;
      parts.forEach(function (dur, k) {
        cursor += Math.max(0, slack) * (weights[k] / wsum);
        cursor = Math.round(cursor / MIN) * MIN;
        sessions.push({ start: cursor, end: cursor + dur, budgetMs: dur });
        cursor += dur + gap;
      });
      left -= share;
    });

    if (left > 0) {
      return { feasible: false, sessions: [], totalBudgetMs: 0, reason: 'not_enough_time', availableMs: workMs - left, requiredMs: workMs };
    }
    return { feasible: true, sessions: sessions, totalBudgetMs: workMs };
  }

  // Install a stub only where the real function is missing.
  function installStubs() {
    function fillIn(globalName, fns) {
      var lib = root[globalName] || (root[globalName] = {});
      Object.keys(fns).forEach(function (name) {
        if (typeof lib[name] !== 'function') {
          lib[name] = fns[name];
          stubbed.push(globalName + '.' + name);
        }
      });
    }
    fillIn('HumanTyperDoc', { parseFile: stubParseFile, parsePlain: stubParsePlain, stats: stubStats });
    fillIn('HumanTyperPlanner', { estimate: stubEstimate, detectLayout: stubDetectLayout });
    fillIn('HumanTyperScheduler', { planSessions: stubPlanSessions });
    return stubbed;
  }

  // ───────────────────────── Sample document ─────────────────────────

  var SAMPLE = {
    en: {
      fileName: 'urban-heat-islands-essay.docx',
      title: 'Urban Heat Islands and the Case for Street Trees',
      subtitle: 'Environmental Policy 204 · Term essay',
      heads: ['Introduction', 'How a city stores heat', 'What shade actually changes', 'Costs and maintenance', 'Who benefits first', 'Conclusion'],
      sub: 'Measured effects',
      body: [
        'On a still summer evening the centre of a large city can be several degrees warmer than the fields around it. The difference is not an accident of weather but a property of the materials we build with and the way we arrange them along a street.',
        'Asphalt and dark roofing absorb most of the sunlight that reaches them and release it slowly after dusk. Narrow streets trap that warmth between facing walls, and waste heat from traffic and air conditioning adds a little more every hour.',
        'A mature tree changes this balance in two ways at once. Its canopy keeps direct sun off the pavement, and the water it moves from the soil to its leaves cools the surrounding air as it evaporates.',
        'None of this is free. Young trees need watering for their first three summers, roots lift paving when pits are too small, and a species that thrives today may struggle in the climate the street will have in forty years.',
        'The households that gain most are those with the least control over their own cooling: tenants in top-floor flats, older residents, and people who work outdoors through the hottest part of the day.'
      ],
      bullets: ['Surface temperature under canopy compared with open asphalt', 'Night-time air temperature at two metres', 'Peak electricity demand on the hottest afternoons'],
      steps: ['Map existing canopy street by street', 'Rank streets by exposure and by who lives there', 'Plant the widest pits the pavement allows'],
      table: [['Surface', 'Midday', 'After dusk'], ['Open asphalt', '52 °C', '34 °C'], ['Shaded asphalt', '33 °C', '27 °C'], ['Grass under canopy', '27 °C', '22 °C']]
    },
    tr: {
      fileName: 'kentsel-isi-adalari-odev.docx',
      title: 'Kentsel Isı Adaları ve Sokak Ağaçlarının Önemi',
      subtitle: 'Çevre Politikası 204 · Dönem ödevi',
      heads: ['Giriş', 'Kent ısıyı nasıl depolar', 'Gölge gerçekte neyi değiştirir', 'Maliyet ve bakım', 'İlk kimler yararlanır', 'Sonuç'],
      sub: 'Ölçülen etkiler',
      body: [
        'Rüzgârsız bir yaz akşamında büyük bir kentin merkezi, çevresindeki tarlalardan birkaç derece daha sıcak olabilir. Bu fark hava durumunun bir cilvesi değil, kullandığımız yapı malzemelerinin ve onları sokak boyunca dizme biçimimizin bir sonucudur.',
        'Asfalt ve koyu renkli çatılar üzerlerine düşen güneş ışığının çoğunu emer, gün battıktan sonra da yavaş yavaş geri verir. Dar sokaklar bu sıcaklığı karşılıklı duvarlar arasında hapseder; trafiğin ve klimaların atık ısısı her saat biraz daha ekler.',
        'Yetişkin bir ağaç bu dengeyi aynı anda iki yoldan değiştirir. Tacı doğrudan güneşi kaldırımdan uzak tutar, topraktan yapraklarına taşıdığı su da buharlaşırken çevresindeki havayı serinletir.',
        'Bunların hiçbiri bedelsiz değildir. Genç ağaçlar ilk üç yaz sulanmak ister, çukurlar küçük kaldığında kökler kaldırımı kaldırır, bugün iyi gelişen bir tür de sokağın kırk yıl sonraki ikliminde zorlanabilir.',
        'En çok kazananlar, kendi serinliğini en az denetleyebilen hanelerdir: çatı katında oturan kiracılar, yaşlılar ve günün en sıcak saatlerinde açık havada çalışanlar.'
      ],
      bullets: ['Ağaç tacı altındaki yüzey sıcaklığının açık asfaltla karşılaştırılması', 'İki metre yükseklikte gece hava sıcaklığı', 'En sıcak öğleden sonralarda en yüksek elektrik talebi'],
      steps: ['Mevcut ağaç örtüsünü sokak sokak haritalayın', 'Sokakları maruziyete ve orada yaşayanlara göre sıralayın', 'Kaldırımın izin verdiği en geniş çukurları açın'],
      table: [['Yüzey', 'Öğle', 'Gün batımından sonra'], ['Açık asfalt', '52 °C', '34 °C'], ['Gölgeli asfalt', '33 °C', '27 °C'], ['Ağaç altı çim', '27 °C', '22 °C']]
    }
  };

  // A document long enough (≈ 2 600 words, 48 blocks) for a multi-sitting plan.
  function sampleDoc(lang) {
    var s = SAMPLE[lang] || SAMPLE.en;
    var blocks = [para(s.title, 'title'), para(s.subtitle, 'subtitle')];
    s.heads.forEach(function (h, i) {
      blocks.push(para(h, 'h1'));
      blocks.push(para(s.body[i % s.body.length] + ' ' + s.body[(i + 2) % s.body.length]));
      if (i === 2) {
        blocks.push(para(s.sub, 'h2'));
        s.bullets.forEach(function (b) { blocks.push(para(b, 'normal', { kind: 'bullet', level: 0 })); });
        blocks.push({
          type: 'table',
          rows: s.table.map(function (row) {
            return row.map(function (c) { return { paragraphs: [para(c)] }; });
          })
        });
      }
      if (i === 4) s.steps.forEach(function (b) { blocks.push(para(b, 'normal', { kind: 'number', level: 0 })); });
      for (var k = 0; k < 4; k++) {
        blocks.push(para(s.body[(i + k + 1) % s.body.length] + ' ' + s.body[(i + k + 3) % s.body.length] + ' ' + s.body[(i + k) % s.body.length]));
      }
    });
    return {
      doc: { blocks: blocks },
      fileName: s.fileName,
      warnings: lang === 'tr'
        ? ['2 görsel atlandı: görseller yazılamaz.', 'Bir dipnot düz metne çevrildi.']
        : ['2 images were skipped: images cannot be typed.', 'One footnote was converted to plain text.']
    };
  }

  // ───────────────────────── Fake bridge ─────────────────────────

  var TARGET = {
    en: { tabId: 101, title: 'Environmental Policy 204 – Term essay', url: 'https://docs.google.com/document/d/mock/edit' },
    tr: { tabId: 101, title: 'Çevre Politikası 204 – Dönem ödevi', url: 'https://docs.google.com/document/d/mock/edit' }
  };

  function mockSessions(now, phase) {
    // phase 0: first sitting is current; 1: between sittings; 2: second is current; 3: all done
    var tomorrow = new Date(now + DAY);
    tomorrow.setHours(10, 20, 0, 0);
    var t = tomorrow.getTime();
    var list = [
      { start: now - 3 * HOUR, end: now - 3 * HOUR + 35 * MIN },
      { start: now - 25 * MIN, end: now + 15 * MIN },
      { start: now + 100 * MIN, end: now + 140 * MIN },
      { start: t, end: t + 45 * MIN },
      { start: t + 3 * HOUR, end: t + 3 * HOUR + 30 * MIN },
      { start: t + 5.5 * HOUR, end: t + 5.5 * HOUR + 40 * MIN }
    ];
    var status = [
      ['missed', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      ['missed', 'done', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      ['missed', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'],
      ['missed', 'done', 'done', 'done', 'done', 'done']
    ][phase];
    return list.map(function (s, i) {
      return { start: s.start, end: s.end, budgetMs: s.end - s.start, status: status[i] };
    });
  }

  function createBridge() {
    var listeners = [];
    var lang = params.lang === 'tr' ? 'tr' : 'en';
    var state = { target: TARGET[lang], job: null };
    var timer = null;
    var waitTimer = null;
    var didWait = false;

    function emit(msg) {
      var copy = JSON.parse(JSON.stringify(msg));
      listeners.forEach(function (fn) { fn(copy); });
    }
    function push() { emit({ type: 'state', state: state }); }

    function stopTimers() {
      clearInterval(timer); timer = null;
      clearTimeout(waitTimer); waitTimer = null;
    }

    function makeJob(status, fraction, opts) {
      opts = opts || {};
      var now = Date.now();
      var total = opts.blocksTotal || 48;
      var charsTotal = opts.charsTotal || 16480;
      var mode = opts.mode || 'deadline';
      var job = {
        id: 'mock-' + now,
        status: status,
        mode: mode,
        fileName: opts.fileName || SAMPLE[lang].fileName,
        kind: opts.kind || 'compose',
        options: opts.options || { typoRate: 0.02, layout: lang === 'tr' ? 'trq' : 'qwerty' },
        progress: {
          blocksDone: Math.floor(total * fraction),
          blocksTotal: total,
          charsDone: Math.round(charsTotal * fraction),
          charsTotal: charsTotal
        },
        startedAt: now - Math.round(fraction * 62 * MIN),
        etaMs: Math.round((1 - fraction) * 62 * MIN)
      };
      if (mode === 'deadline') {
        var dl = new Date(now + DAY); dl.setHours(18, 0, 0, 0);
        job.deadline = opts.deadline || dl.getTime();
        var phase = status === 'done' ? 3 : (status === 'waiting' || status === 'error' || status === 'stopped') ? 1 : 0;
        job.sessions = mockSessions(now, phase);
        if (status === 'waiting') job.nextSessionAt = job.sessions[2].start;
      }
      if (status === 'done') job.etaMs = 0;
      if (status === 'error') job.message = 'err.tab_closed';
      if (job.kind === 'fill') {
        job.fill = {
          unchanged: 31, appended: 2, replaced: 11, inserted: 4,
          problems: lang === 'tr'
            ? ['“Yöntem” başlığı şablonda bulunamadı; bölüm belgenin sonuna eklendi.', 'Tablo 2: şablonda 3 sütun var, dosyada 4. Son sütun atlandı.']
            : ['Heading “Method” was not found in the template; the section was added at the end.', 'Table 2: the template has 3 columns, the file has 4. The last column was skipped.']
        };
      }
      return job;
    }

    function tick() {
      var job = state.job;
      if (!job || job.status !== 'running') return;
      var p = job.progress;
      p.charsDone = Math.min(p.charsTotal, p.charsDone + Math.ceil(p.charsTotal / 70));
      var f = p.charsDone / p.charsTotal;
      p.blocksDone = Math.min(p.blocksTotal, Math.floor(p.blocksTotal * f));
      job.etaMs = Math.round((1 - f) * 62 * MIN);

      if (job.mode === 'deadline' && !didWait && f >= 0.42) {
        // End of the first sitting: wait, then carry on with the next one.
        didWait = true;
        job.status = 'waiting';
        job.sessions = mockSessions(Date.now(), 1);
        job.nextSessionAt = job.sessions[2].start;
        waitTimer = setTimeout(function () {
          if (!state.job || state.job.status !== 'waiting') return;
          state.job.status = 'running';
          state.job.sessions = mockSessions(Date.now(), 2);
          delete state.job.nextSessionAt;
          push();
        }, 7000);
      } else if (f >= 1) {
        job.status = 'done';
        p.blocksDone = p.blocksTotal;
        job.etaMs = 0;
        if (job.sessions) job.sessions = mockSessions(Date.now(), 3);
        stopTimers();
      }
      push();
    }

    function run() {
      stopTimers();
      timer = setInterval(tick, 600);
    }

    function post(msg) {
      if (!msg || !msg.type) return false;
      var job = state.job;
      switch (msg.type) {
        case 'job:create': {
          var stats = root.HumanTyperDoc && root.HumanTyperDoc.stats ? root.HumanTyperDoc.stats(msg.doc) : { blocks: 48, chars: 16480 };
          didWait = false;
          state.job = makeJob('running', 0, {
            kind: params.kind === 'fill' ? 'fill' : 'compose',
            mode: msg.schedule && msg.schedule.mode,
            deadline: msg.schedule && msg.schedule.deadline,
            fileName: msg.fileName,
            options: msg.options,
            blocksTotal: stats.blocks || 1,
            charsTotal: stats.chars || 1
          });
          setTimeout(function () { push(); run(); }, 350);
          break;
        }
        case 'job:pause':
          if (job && (job.status === 'running' || job.status === 'waiting')) { job.status = 'paused'; clearTimeout(waitTimer); push(); }
          break;
        case 'job:resume':
          if (job && job.status === 'paused') { job.status = 'running'; delete job.nextSessionAt; if (!timer) run(); push(); }
          break;
        case 'job:stop':
          if (job) { job.status = 'stopped'; stopTimers(); push(); }
          break;
        case 'job:clear':
          state.job = null; stopTimers(); push();
          break;
        case 'selftest':
          setTimeout(function () {
            emit({
              type: 'selftest:result',
              lines: [
                'mock bridge: no extension runtime',
                'ok   planner     estimate ' + (stubbed.indexOf('HumanTyperPlanner.estimate') < 0 ? '(real)' : '(stub)'),
                'ok   scheduler   planSessions ' + (stubbed.indexOf('HumanTyperScheduler.planSessions') < 0 ? '(real)' : '(stub)'),
                'ok   parser      parseFile ' + (stubbed.indexOf('HumanTyperDoc.parseFile') < 0 ? '(real)' : '(stub)'),
                'skip transport   needs a Google Doc tab'
              ]
            });
          }, 500);
          break;
      }
      return true;
    }

    // Initial state from ?state=
    var want = params.state || 'empty';
    if (want === 'notarget') state.target = null;
    if (want === 'running') { state.job = makeJob('running', 0.25); didWait = true; }
    if (want === 'paused') state.job = makeJob('paused', 0.37);
    if (want === 'waiting') state.job = makeJob('waiting', 0.42);
    if (want === 'done') state.job = makeJob('done', 1);
    if (want === 'error') state.job = makeJob('error', 0.58);
    if (want === 'stopped') state.job = makeJob('stopped', 0.31);
    // Template fill: the worker only types what the existing Google Doc lacks.
    if (want === 'fill') { state.job = makeJob('running', 0.3, { kind: 'fill', mode: 'now' }); didWait = true; }
    if (want === 'filldone') state.job = makeJob('done', 1, { kind: 'fill', mode: 'now' });

    return {
      isMock: true,
      post: post,
      onMessage: function (fn) { listeners.push(fn); },
      start: function () {
        push();
        if (want === 'running' || want === 'fill') timer = setInterval(tick, 2500);
      }
    };
  }

  // What the setup view should be pre-filled with for a given ?state=.
  function uiPreset(lang) {
    var want = params.state;
    if (want !== 'loaded' && want !== 'deadline' && want !== 'infeasible') return null;
    var sample = sampleDoc(lang);
    var preset = { doc: sample.doc, fileName: sample.fileName, warnings: sample.warnings, mode: want === 'loaded' ? 'now' : 'deadline' };
    if (want === 'infeasible') preset.deadline = Date.now() + 40 * MIN;
    return preset;
  }

  root.HumanTyperMock = {
    params: params,
    stubbed: stubbed,
    installStubs: installStubs,
    sampleDoc: sampleDoc,
    createBridge: createBridge,
    uiPreset: uiPreset
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
