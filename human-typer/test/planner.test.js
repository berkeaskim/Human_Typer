// Çalıştırma: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { plan, simulate, summarize } = require('../planner.js');

const TR = 'Bugün hava çok güzel. İstanbul\'da ışıl ışıl bir gün!\nİkinci paragraf: şöyle böyle, 123 kere.';
const EN = 'The quick brown fox jumps over the lazy dog. It was not amused.\n\nSecond paragraph here.';

test('plan oynatılınca girdi metnini birebir verir', () => {
  for (const [text, layout] of [[TR, 'trq'], [EN, 'qwerty'], [TR, 'qwerty'], ['', 'trq'], ['a', 'trq'], ['😀 emoji ok', 'trq']]) {
    for (let seed = 1; seed <= 300; seed++) {
      const actions = plan(text, { seed, layout, typoRate: 0.15 });
      assert.strictEqual(simulate(actions), text, `seed ${seed} layout ${layout}`);
    }
  }
});

test('aynı tohum aynı planı üretir', () => {
  assert.deepStrictEqual(plan(TR, { seed: 42 }), plan(TR, { seed: 42 }));
  assert.notDeepStrictEqual(plan(TR, { seed: 42 }), plan(TR, { seed: 43 }));
});

test('hata oranı sıfırken Backspace yok', () => {
  assert.strictEqual(summarize(plan(TR, { seed: 7, typoRate: 0 })).backs, 0);
});

test('gecikmeler 60 ms tabanının altına inmez', () => {
  const actions = plan(EN.repeat(20), { seed: 3, wpm: 200, typoRate: 0.05 });
  assert.ok(actions.every((a) => a.delay >= 60));
});

test('hız ve Backspace payı ölçülen aralıklara yakın', () => {
  const text = EN.repeat(60);
  const actions = plan(text, { seed: 11, wpm: 52, typoRate: 0.03 });
  const s = summarize(actions);
  const wpm = text.length / 5 / (s.ms / 60000);
  const backShare = s.backs / s.keys;
  console.log(`  etkin hız ${wpm.toFixed(1)} kelime/dk, Backspace payı %${(backShare * 100).toFixed(1)}`);
  assert.ok(wpm > 47 && wpm < 54, `etkin hız ${wpm}`);
  assert.ok(backShare > 0.02 && backShare < 0.1, `Backspace payı ${backShare}`);
});

test('Türkçe düzende hatalı harfler Türkçe klavyeden gelir', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    for (const a of plan('şöyle çığlık üşüdüğü ığdır', { seed, typoRate: 0.3 })) if (a.type === 'char') seen.add(a.ch);
  }
  assert.ok(['ğ', 'ü', 'ş', 'ö', 'ç', 'ı'].every((c) => seen.has(c)));
  assert.ok(![...seen].some((c) => /[A-Z]/.test(c)), 'küçük harfli metinde büyük harf üretilmemeli');
});

test('hız metin boyunca dalgalanır ve her tohumda farklıdır', () => {
  const text = EN.repeat(40);
  const windowWpm = (seed) => {
    const out = [];
    let ms = 0;
    let n = 0;
    for (const a of plan(text, { seed, wpm: 52, typoRate: 0.02 })) {
      ms += a.delay;
      if (a.type === 'char' && ++n % 60 === 0) {
        out.push(12 / (ms / 60000));
        ms = 0;
      }
    }
    return out;
  };
  for (const seed of [1, 2, 3]) {
    const w = windowWpm(seed);
    const mean = w.reduce((s, x) => s + x, 0) / w.length;
    const cv = Math.sqrt(w.reduce((s, x) => s + (x - mean) ** 2, 0) / w.length) / mean;
    console.log(`  tohum ${seed}: 60 karakterlik pencerelerde ${Math.min(...w).toFixed(0)}–${Math.max(...w).toFixed(0)} kelime/dk, değişkenlik %${(cv * 100).toFixed(0)}`);
    assert.ok(cv > 0.12, `değişkenlik ${cv}`);
  }
  assert.notDeepStrictEqual(windowWpm(1), windowWpm(2));
});
