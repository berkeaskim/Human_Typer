// İçerik betiği: sayfa içi kontrol paneli, yazma döngüsü ve kendi kendini
// sınayan ölçüm testi. Planı planner.js üretir, tuşları transport.js gönderir.
(function () {
  'use strict';
  if (window.top !== window || document.getElementById('human-typer-host')) return;

  const Planner = globalThis.HumanTyperPlanner;
  const T = globalThis.HumanTyperTransport;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // --- küçük DOM yardımcısı (innerHTML kullanmadan) -------------------------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el[k] = v;
    }
    for (const kid of kids) el.append(kid);
    return el;
  }

  // --- panel ----------------------------------------------------------------
  const host = h('div', { id: 'human-typer-host', style: 'position:fixed;right:16px;bottom:16px;z-index:2147483647;' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(
    h('style', {
      textContent: `
        .box{width:300px;font:13px/1.4 system-ui,sans-serif;color:#1f1f1f;background:#fff;
          border:1px solid #c7c7c7;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:10px}
        .head{display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:6px}
        textarea{width:100%;height:110px;box-sizing:border-box;resize:vertical;font:inherit;padding:6px;
          border:1px solid #c7c7c7;border-radius:6px}
        label{display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px}
        input,select{font:inherit;width:90px;padding:2px 4px}
        .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
        button{font:inherit;padding:4px 10px;border:1px solid #c7c7c7;border-radius:6px;background:#f3f3f3;cursor:pointer}
        button.primary{background:#1a73e8;border-color:#1a73e8;color:#fff}
        button:disabled{opacity:.5;cursor:default}
        .status{margin-top:8px;white-space:pre-wrap;font-size:12px;color:#444;max-height:180px;overflow:auto}
        .min .body{display:none}
      `,
    })
  );

  const ui = {};
  ui.text = h('textarea', { placeholder: 'Yazılacak metni buraya yapıştır. Sonra imleci belgede yazının başlayacağı yere koy.' });
  ui.wpm = h('input', { type: 'number', min: 10, max: 200, value: 52 });
  ui.typo = h('input', { type: 'number', min: 0, max: 15, step: 0.5, value: 2 });
  ui.layout = h('select', {}, h('option', { value: 'trq', textContent: 'Türkçe Q' }), h('option', { value: 'qwerty', textContent: 'QWERTY (EN)' }));
  ui.start = h('button', { className: 'primary', textContent: 'Başlat', onclick: start });
  ui.pause = h('button', { textContent: 'Duraklat', disabled: true, onclick: togglePause });
  ui.stop = h('button', { textContent: 'Durdur', disabled: true, onclick: () => stop('Durduruldu.') });
  ui.test = h('button', { textContent: 'Ölçüm testi', onclick: selfTest });
  ui.status = h('div', { className: 'status', textContent: 'Hazır.' });
  const box = h(
    'div',
    { className: 'box' },
    h('div', { className: 'head' }, 'Human Typer', h('button', { textContent: '–', onclick: () => box.classList.toggle('min') })),
    h(
      'div',
      { className: 'body' },
      ui.text,
      h('label', {}, 'Hız (kelime/dk)', ui.wpm),
      h('label', {}, 'Hata oranı (%)', ui.typo),
      h('label', {}, 'Klavye', ui.layout),
      h('div', { className: 'row' }, ui.start, ui.pause, ui.stop, ui.test),
      ui.status
    )
  );
  shadow.append(box);
  // Paneldeki tuşlar Docs'un kısayollarına gitmesin.
  for (const type of ['keydown', 'keypress', 'keyup']) host.addEventListener(type, (e) => e.stopPropagation());
  document.documentElement.append(host);

  const say = (msg) => (ui.status.textContent = msg);
  const fmt = (ms) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} dk ${s % 60} sn` : `${s} sn`;
  };

  // --- yazma döngüsü --------------------------------------------------------
  const job = { status: 'idle', actions: [], idx: 0, token: 0, left: 0 };

  function setButtons() {
    const active = job.status === 'running' || job.status === 'paused';
    ui.start.disabled = active;
    ui.test.disabled = active;
    ui.pause.disabled = !active;
    ui.stop.disabled = !active;
    ui.pause.textContent = job.status === 'paused' ? 'Sürdür' : 'Duraklat';
  }

  function start() {
    const text = ui.text.value;
    if (!text) return say('Önce metin gir.');
    if (!T.ready()) return say('Docs giriş çerçevesi bulunamadı. Sayfa tam yüklendi mi?');
    job.actions = Planner.plan(text, {
      wpm: Number(ui.wpm.value) || 52,
      typoRate: (Number(ui.typo.value) || 0) / 100,
      layout: ui.layout.value,
      seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0,
    });
    const sum = Planner.summarize(job.actions);
    job.idx = 0;
    job.left = sum.ms;
    job.status = 'running';
    setButtons();
    T.focus();
    run(++job.token);
  }

  async function run(token) {
    while (job.idx < job.actions.length) {
      if (job.token !== token) return;
      if (job.status === 'paused') {
        await sleep(200);
        continue;
      }
      const a = job.actions[job.idx];
      await sleep(a.delay);
      if (job.token !== token) return;
      if (job.status === 'paused') continue;
      const ok = a.type === 'char' ? T.typeChar(a.ch) : T.backspace();
      if (!ok) return stop('Docs giriş çerçevesi kayboldu; durduruldu.');
      job.idx++;
      job.left -= a.delay;
      if (job.idx % 5 === 0) say(`Yazılıyor: ${job.idx}/${job.actions.length} tuş, kalan yaklaşık ${fmt(job.left)}`);
    }
    stop('Bitti.');
  }

  function togglePause(reason) {
    if (job.status === 'running') {
      job.status = 'paused';
      say(typeof reason === 'string' ? reason : `Duraklatıldı (${job.idx}/${job.actions.length}).`);
    } else if (job.status === 'paused') {
      job.status = 'running';
      T.focus();
    }
    setButtons();
  }

  function stop(msg) {
    job.token++;
    job.status = 'idle';
    setButtons();
    say(msg);
  }

  // Gizli sekmede zamanlayıcılar kısıtlanır; prototip burada durur.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && job.status === 'running') togglePause('Sekme gizlendi, duraklatıldı. Geri dönünce Sürdür\'e bas.');
  });

  // --- ölçüm testi ----------------------------------------------------------
  // Bilinen bir diziyi yazar, sonra belgenin düz metin dışa aktarımını okuyup
  // karşılaştırır. Sentetik olayların bu Docs sürümünde çalışıp çalışmadığını gösterir.
  const PROBES = [
    ['ASCII', 'abc XYZ 123'],
    ['Türkçe küçük', 'ığüşöç'],
    ['Türkçe büyük', 'İĞÜŞÖÇ'],
    ['Noktalama', 'a.b,c;d?e'],
    ['Backspace', 'sil'], // "silX" yazılır, X silinir
  ];

  function exportText() {
    const m = location.pathname.match(/\/document\/d\/([\w-]+)/);
    if (!m) return Promise.resolve({ ok: false, error: 'belge kimliği bulunamadı' });
    return new Promise((res) => {
      chrome.runtime.sendMessage({ type: 'ht-export', docId: m[1] }, (r) => {
        res(r || { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'yanıt yok' });
      });
    });
  }

  async function selfTest() {
    if (!T.ready()) return say('Docs giriş çerçevesi bulunamadı.');
    ui.start.disabled = ui.test.disabled = true;
    const marker = 'HT' + Date.now().toString(36);
    const gap = 45;
    const lines = [marker, ...PROBES.map((p) => p[1])];
    say('Ölçüm testi yazılıyor…');
    T.focus();

    const before = T.caret();
    T.typeChar(marker[0]);
    await sleep(300);
    const after = T.caret();
    const caretMoved = before && after ? before.x !== after.x || before.y !== after.y : null;

    const seq = Array.from(lines.join('\n')).slice(1);
    for (const ch of seq) {
      T.typeChar(ch);
      await sleep(gap);
    }
    T.typeChar('X');
    await sleep(gap);
    T.backspace();
    await sleep(gap);
    T.typeChar('\n');

    say('Yazıldı. Docs\'un kaydetmesi bekleniyor…');
    let report = [`İmleç ilk tuşta hareket etti: ${caretMoved === null ? 'imleç bulunamadı' : caretMoved ? 'evet' : 'HAYIR'}`];
    let exp = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(2000);
      exp = await exportText();
      if (exp.ok && exp.text.includes(marker)) break;
    }
    if (!exp.ok) {
      report.push(`Dışa aktarım okunamadı: ${exp.error}`, 'Sonucu belgede gözle kontrol et.');
    } else if (!exp.text.includes(marker)) {
      report.push('İşaret satırı belgede yok: sentetik tuşlar metin eklemedi.');
    } else {
      const got = exp.text.replace(/\r\n?/g, '\n').split(marker).pop().split('\n').slice(1);
      PROBES.forEach(([label, want], i) => {
        const have = got[i] === undefined ? '(yok)' : got[i];
        const mark = have === want ? '✓' : have.toLocaleLowerCase('tr') === want.toLocaleLowerCase('tr') ? '≈ (büyük/küçük harf)' : '✗';
        report.push(`${mark} ${label}: beklenen "${want}", gelen "${have}"`);
      });
    }
    say(report.join('\n'));
    console.log('[human-typer] ölçüm testi\n' + report.join('\n'));
    setButtons();
  }

  setButtons();
})();
