// Structured documents: planBlock, estimate, detectLayout, simulateDoc.
// Run from the extension folder: node --test   (or: node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert');
const { planBlock, initialCarry, estimate, targetWpm, detectLayout, simulateDoc, normalizeDoc, FORMAT_OPS, splitLinks } = require('../planner.js');

// --- document builders -----------------------------------------------------
const P = (runs, extra) =>
  Object.assign({ type: 'paragraph', style: 'normal', list: null, align: 'left', runs: typeof runs === 'string' ? [{ text: runs }] : runs }, extra);
const H = (style, text, extra) => P(text, Object.assign({ style }, extra));
const LI = (kind, level, runs, extra) => P(runs, Object.assign({ list: { kind, level } }, extra));
const cell = (...paragraphs) => ({ paragraphs });
const T = (...rows) => ({ type: 'table', rows });
const b = (text) => ({ text, bold: true });
const i = (text) => ({ text, italic: true });

const VARIED = {
  blocks: [
    H('title', 'Yıllık Değerlendirme Raporu', { align: 'center' }),
    H('subtitle', 'İstanbul, ığdır ve çevresi', { align: 'center' }),
    H('h1', 'Giriş'),
    P([{ text: 'Bugün hava ' }, b('çok güzel'), { text: '. Işıl ışıl ' }, { text: 'bir gün', bold: true, italic: true }, { text: '!' }], { align: 'justify' }),
    P([]),
    P([{ text: 'half' }, b('bold'), i('word'), { text: ' and ' }, { text: 'struck', strike: true, underline: true }]),
    H('h2', 'Lists'),
    LI('bullet', 0, 'first item'),
    LI('bullet', 0, [b('second'), { text: ' item' }]),
    LI('bullet', 1, 'nested once'),
    LI('bullet', 3, 'nested deep'),
    LI('number', 3, 'same level, other kind'),
    LI('number', 0, 'back to the top'),
    LI('number', 1, 'şöyle böyle, 123 kere'),
    P('Plain text straight after a nested list.'),
    LI('number', 2, 'a list that starts indented'),
    H('h3', 'Heading directly after a list', { align: 'right' }),
    P('right aligned body', { align: 'right' }),
    P(''),
    P('', { align: 'center' }),
    P([b('bold before the table')], { align: 'center' }),
    T(
      [cell(P('Name')), cell(P([b('Value')]), P('second paragraph', { align: 'right' })), cell(P([]))],
      [cell(LI('bullet', 0, 'a'), LI('bullet', 1, 'b'), P('after list')), cell(H('h4', 'Çığlık')), cell(P([i('üşüdüğü'), { text: ' 😀' }]))]
    ),
    T([cell(P('second table, right below the first'))], [cell(P([{ text: 'x', underline: true }]))]),
    P('Text right after a table.'),
    H('h6', 'Last heading'),
    T([cell(P('the document ends with a table')), cell(P([b('end')]))]),
  ],
};
const TABLE_FIRST = {
  blocks: [T([cell(P('a')), cell(P('b'))]), LI('number', 1, 'list after a table'), P([b('The'), { text: ' end.' }])],
};
const EMPTY_FIRST = { blocks: [P([]), P([]), H('h1', 'After two empty paragraphs'), P([])] };

function planAll(doc, opts) {
  const actions = [];
  const perBlock = [];
  const carries = [];
  let carry = initialCarry();
  for (let k = 0; k < doc.blocks.length; k++) {
    carries.push(carry);
    const res = planBlock(doc, k, opts, carry);
    perBlock.push(res.actions);
    actions.push(...res.actions);
    carry = res.carry;
  }
  return { actions, perBlock, carries, carry };
}
const ops = (actions) =>
  actions.filter((a) => a.type !== 'char' && a.type !== 'back').map((a) => (a.type === 'key' ? a.key : a.type === 'table' ? `table ${a.rows}x${a.cols}` : a.op));

// --- tests -------------------------------------------------------------------
test('replaying every block reproduces the document exactly', () => {
  for (const doc of [VARIED, TABLE_FIRST, EMPTY_FIRST]) {
    const want = normalizeDoc(doc);
    for (const layout of ['trq', 'qwerty']) {
      for (let seed = 1; seed <= 150; seed++) {
        const { actions } = planAll(doc, { seed, layout, typoRate: 0.15 });
        assert.deepStrictEqual(simulateDoc(actions), want, `seed ${seed} layout ${layout}`);
      }
    }
  }
});

test('actions stay inside the agreed vocabulary', () => {
  const keys = new Set(['Enter', 'Tab', 'ShiftTab', 'ArrowDown']);
  for (let seed = 1; seed <= 40; seed++) {
    for (const a of planAll(VARIED, { seed, typoRate: 0.1 }).actions) {
      assert.ok(Number.isInteger(a.delay) && a.delay >= 0, `delay ${a.delay}`);
      if (a.type === 'char') assert.ok(typeof a.ch === 'string' && a.ch !== '\n' && Array.from(a.ch).length === 1);
      else if (a.type === 'key') assert.ok(keys.has(a.key), a.key);
      else if (a.type === 'format') assert.ok(FORMAT_OPS.includes(a.op), a.op);
      else if (a.type === 'table') assert.ok(a.rows > 0 && a.cols > 0);
      else assert.strictEqual(a.type, 'back');
    }
  }
});

test('list:none names the kind and level of the list it leaves', () => {
  const doc = { blocks: [LI('number', 2, 'a'), P('b'), LI('bullet', 0, 'c'), T([cell(P('d'))])] };
  const { actions } = planAll(doc, { seed: 1, typoRate: 0 });
  const leaves = actions.filter((a) => a.op === 'list:none').map(({ kind, level }) => ({ kind, level }));
  assert.deepStrictEqual(leaves, [
    { kind: 'number', level: 2 },
    { kind: 'bullet', level: 0 },
  ]);
  for (const a of actions) if (a.op !== 'list:none') assert.ok(!('kind' in a) && !('level' in a));
  assert.throws(() => simulateDoc([{ type: 'format', op: 'list:bullet', delay: 0 }, { type: 'format', op: 'list:none', kind: 'number', level: 0, delay: 0 }]));
  assert.throws(() => simulateDoc([{ type: 'format', op: 'list:none', delay: 0 }]));
});

test('a Backspace burst never crosses a format/key/table action or a word boundary', () => {
  let bursts = 0;
  for (let seed = 1; seed <= 150; seed++) {
    let since = []; // characters typed since the last structural action
    for (const a of planAll(VARIED, { seed, typoRate: 0.25 }).actions) {
      if (a.type === 'char') since.push(a.ch);
      else if (a.type === 'back') {
        assert.ok(since.length > 0, `seed ${seed}: Backspace reaches past a structural action`);
        assert.ok(/\p{L}/u.test(since.pop()), `seed ${seed}: Backspace removes a non-letter`);
        bursts++;
      } else since = [];
    }
  }
  assert.ok(bursts > 1000, 'the test document should produce plenty of corrections');
});

test('planBlock is deterministic and independent of what was planned before', () => {
  const opts = { seed: 99, typoRate: 0.1, wpm: 60, layout: 'trq' };
  const first = planAll(VARIED, opts);
  assert.deepStrictEqual(planAll(VARIED, opts).perBlock, first.perBlock);
  assert.notDeepStrictEqual(planAll(VARIED, Object.assign({}, opts, { seed: 100 })).perBlock, first.perBlock);
  // Each block alone, in reverse order, from a carry that went through JSON.
  for (let k = VARIED.blocks.length - 1; k >= 0; k--) {
    const carry = JSON.parse(JSON.stringify(first.carries[k]));
    const snapshot = JSON.stringify(carry);
    const res = planBlock(VARIED, k, opts, carry);
    assert.deepStrictEqual(res.actions, first.perBlock[k], `block ${k}`);
    assert.strictEqual(JSON.stringify(carry), snapshot, 'the carry passed in is not modified');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.carry)), res.carry, 'the carry is plain JSON');
  }
  assert.deepStrictEqual(planBlock(VARIED, 999, opts, initialCarry()), { actions: [], carry: initialCarry() });
});

test('initialCarry has the agreed shape', () => {
  assert.deepStrictEqual(initialCarry(), {
    style: 'normal',
    list: null,
    align: 'left',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    afterTable: false,
    started: false,
  });
});

test('only the needed format and key actions are emitted, in the agreed order', () => {
  const o = { seed: 5, typoRate: 0 };
  const doc = {
    blocks: [
      H('h1', 'T'), // first block: no Enter
      P('a'), // Enter already gives normal: no style op
      P([b('b')], { align: 'center' }),
      P([b('c')], { align: 'center' }), // bold and centre persist: only Enter
      LI('bullet', 1, 'd', { style: 'h2', align: 'right' }),
      LI('bullet', 1, 'e', { align: 'right' }), // same kind and level persist; style reset by Enter
      LI('number', 0, 'f', { align: 'right' }),
      T([cell(P('g')), cell(P('h'), P([i('i')]))]),
      T([cell(P('j'))]), // directly after a table: no Enter
      P('k'), // directly after a table: no Enter
      T([cell(P(''))]),
    ],
  };
  const { perBlock, carry } = planAll(doc, o);
  assert.deepStrictEqual(perBlock.map(ops), [
    ['style:h1'],
    ['Enter'],
    ['Enter', 'align:center', 'bold'],
    ['Enter'],
    ['Enter', 'list:bullet', 'indent', 'style:h2', 'align:right', 'bold'],
    ['Enter'],
    ['Enter', 'list:number', 'outdent'],
    ['Enter', 'list:none', 'align:left', 'table 1x2', 'Tab', 'Enter', 'italic', 'italic', 'ArrowDown'],
    ['table 1x1', 'ArrowDown'],
    [],
    ['Enter', 'table 1x1', 'ArrowDown'],
  ]);
  assert.deepStrictEqual(carry, Object.assign(initialCarry(), { afterTable: true, started: true }));
  assert.deepStrictEqual(simulateDoc(perBlock.flat()), normalizeDoc(doc));
});

test('simulateDoc follows the editor rules', () => {
  const ch = (c) => ({ type: 'char', ch: c, delay: 0 });
  const key = (k) => ({ type: 'key', key: k, delay: 0 });
  const fmt = (op) => ({ type: 'format', op, delay: 0 });
  assert.deepStrictEqual(simulateDoc([]), { blocks: [] });
  assert.deepStrictEqual(
    simulateDoc([fmt('style:h1'), fmt('list:number'), fmt('indent'), fmt('align:center'), fmt('bold'), ch('a'), key('Enter'), ch('b'), ch('x'), { type: 'back', delay: 0 }]),
    normalizeDoc({
      blocks: [LI('number', 1, [b('a')], { style: 'h1', align: 'center' }), LI('number', 1, [b('b')], { align: 'center' })],
    })
  );
  assert.deepStrictEqual(
    simulateDoc([{ type: 'table', rows: 2, cols: 2, delay: 0 }, ch('a'), key('Tab'), key('Tab'), key('Tab'), ch('d'), key('ArrowDown'), ch('z')]),
    normalizeDoc({ blocks: [T([cell(P('a')), cell(P(''))], [cell(P('')), cell(P('d'))]), P('z')] })
  );
  assert.throws(() => simulateDoc([key('Tab')]));
  assert.throws(() => simulateDoc([ch('a'), key('Enter'), { type: 'back', delay: 0 }]));
  assert.throws(() => simulateDoc([ch('a'), { type: 'table', rows: 1, cols: 1, delay: 0 }]));
});

test('structural delays are in a human range and typing keeps the 60 ms floor', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const a of planAll(VARIED, { seed, wpm: 180, typoRate: 0.05 }).actions) {
      if (a.type === 'char' || a.type === 'back') assert.ok(a.delay >= 60);
      else if (a.type === 'table') assert.ok(a.delay >= 1500 && a.delay <= 4000 + 40000, `table ${a.delay}`);
      else assert.ok(a.delay >= 120, `${a.type} ${a.op || a.key} ${a.delay}`);
    }
  }
  // Without a preceding paragraph break there is no thinking pause on top.
  for (let seed = 1; seed <= 60; seed++) {
    const { actions } = planBlock({ blocks: [T([cell(P([b('a')])), cell(P('b'))])] }, 0, { seed }, initialCarry());
    for (const a of actions) {
      if (a.type === 'table') assert.ok(a.delay >= 1500 && a.delay <= 4000);
      if (a.type === 'key') assert.ok(a.delay >= 300 && a.delay <= 900, `${a.key} ${a.delay}`);
      if (a.type === 'format') assert.ok(a.delay >= 250 && a.delay <= 800, `${a.op} ${a.delay}`);
    }
  }
});

const SENTENCES = [
  'The quick brown fox jumps over the lazy dog and keeps running.',
  'It was not amused, but nobody had really expected it to be.',
  'Later that day we walked home along the river without saying much.',
  'Some of these things are easier to explain than they are to do.',
];
function longDoc(words) {
  const blocks = [H('h1', 'A long document')];
  let n = 0;
  for (let k = 0; n < words; k++) {
    const count = 2 + (k % 6);
    const text = Array.from({ length: count }, (_, j) => SENTENCES[(k + j) % SENTENCES.length]).join(' ');
    n += text.split(' ').length;
    blocks.push(k % 9 === 8 ? H('h2', 'Section ' + k) : P(k % 4 === 1 ? [{ text: text.slice(0, 30) }, b(text.slice(30, 50)), { text: text.slice(50) }] : text));
  }
  return { blocks };
}

test('estimate matches the plans, is fast, and lands near the requested speed', () => {
  const small = estimate(VARIED, { seed: 3, typoRate: 0.05 });
  const { perBlock } = planAll(VARIED, { seed: 3, typoRate: 0.05 });
  assert.deepStrictEqual(small.perBlockMs, perBlock.map((acts) => acts.reduce((s, a) => s + a.delay, 0)));
  assert.strictEqual(small.ms, small.perBlockMs.reduce((s, x) => s + x, 0));
  assert.strictEqual(small.keys, perBlock.flat().length);
  const flat = perBlock.flat();
  const pasted = flat.filter((a) => a.type === 'paste').reduce((n, a) => n + Array.from(a.text).length, 0);
  assert.strictEqual(small.chars, flat.filter((a) => a.type === 'char').length - flat.filter((a) => a.type === 'back').length + pasted);
  assert.deepStrictEqual(estimate({ blocks: [] }, {}), { ms: 0, chars: 0, keys: 0, perBlockMs: [] });

  const doc = longDoc(10000);
  for (const seed of [1, 2, 3, 4, 5]) {
    const t0 = process.hrtime.bigint();
    const e = estimate(doc, { seed, wpm: 52, typoRate: 0.03 });
    const tookMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const wpm = e.chars / 5 / (e.ms / 60000);
    console.log(`  seed ${seed}: ${e.chars} chars in ${doc.blocks.length} blocks planned in ${tookMs.toFixed(0)} ms, effective ${wpm.toFixed(1)} wpm incl. structure`);
    assert.ok(tookMs < 1000, `estimate took ${tookMs} ms`);
    assert.ok(wpm > 42 && wpm < 54, `effective speed ${wpm}`);
  }
});

test('block durations vary instead of being proportional to length', () => {
  const doc = { blocks: Array.from({ length: 60 }, () => P('A short paragraph of ordinary words.')) };
  const { perBlockMs } = estimate(doc, { seed: 8, typoRate: 0.02 });
  const rest = perBlockMs.slice(1);
  assert.ok(Math.max(...rest) / Math.min(...rest) > 1.3);
});

test('detectLayout', () => {
  assert.strictEqual(detectLayout('Bugün hava çok güzel, ışıl ışıl.'), 'trq');
  assert.strictEqual(detectLayout('ISTANBUL İSTANBUL'), 'trq');
  assert.strictEqual(detectLayout('çok güzel bir gün'), 'trq');
  assert.strictEqual(detectLayout('The quick brown fox.'), 'qwerty');
  assert.strictEqual(detectLayout('A naïve café, über cool.'), 'qwerty');
  assert.strictEqual(detectLayout(''), 'qwerty');
  assert.strictEqual(detectLayout(VARIED), 'trq');
  assert.strictEqual(detectLayout({ blocks: [P('plain'), T([cell(P('table text'))])] }), 'qwerty');
});

test('automatic speed: deterministic per seed, drifting over the document, inside the human range', () => {
  const doc = longDoc(3000);
  const n = doc.blocks.length;
  const speeds = (seed) => Array.from({ length: n }, (_, k) => targetWpm({ seed }, k));
  const bases = [];
  for (let seed = 1; seed <= 300; seed++) {
    const w = speeds(seed);
    assert.deepStrictEqual(speeds(seed), w);
    // base in 40–68 wpm, block factor in 0.75–1.3
    const lo = Math.min(...w);
    const hi = Math.max(...w);
    assert.ok(lo >= 40 * 0.75 && hi <= 68 * 1.3, `seed ${seed}: ${lo}–${hi}`);
    assert.ok(hi / lo <= 1.3 / 0.75 + 1e-9, `seed ${seed}: spread ${hi / lo}`);
    assert.ok(hi / lo > 1.2, `seed ${seed}: the pace should drift, spread ${hi / lo}`);
    // neighbouring blocks have a similar pace
    for (let k = 1; k < n; k++) assert.ok(Math.abs(Math.log(w[k] / w[k - 1])) < 0.25, `seed ${seed} block ${k}`);
    bases.push(Math.sqrt(lo * hi));
  }
  assert.notDeepStrictEqual(speeds(1), speeds(2));
  assert.ok(Math.max(...bases) / Math.min(...bases) > 1.3, 'writers differ in base speed');
  const meanBase = bases.reduce((s, x) => s + x, 0) / bases.length;
  assert.ok(meanBase > 47 && meanBase < 57, `mean base ${meanBase}`);

  // A numeric wpm is a fixed target; anything else means automatic.
  assert.strictEqual(targetWpm({ seed: 1, wpm: 61 }, 7), 61);
  assert.strictEqual(targetWpm({ seed: 1, wpm: 'auto' }, 7), targetWpm({ seed: 1 }, 7));
  assert.strictEqual(targetWpm({ seed: 1, wpm: null }, 7), targetWpm({ seed: 1 }, 7));
});

test('automatic speed: plans follow the block targets and stay order-independent', () => {
  const doc = { blocks: Array.from({ length: 40 }, (_, k) => P(Array.from({ length: 12 }, (_, j) => SENTENCES[(k + j) % 4]).join(' '))) };
  const opts = { seed: 21, typoRate: 0.03 };
  const first = planAll(doc, opts);
  assert.deepStrictEqual(planAll(doc, opts).perBlock, first.perBlock);
  assert.notDeepStrictEqual(planAll(doc, { seed: 22, typoRate: 0.03 }).perBlock, first.perBlock);
  for (let k = doc.blocks.length - 1; k >= 0; k--) {
    assert.deepStrictEqual(planBlock(doc, k, opts, first.carries[k]).actions, first.perBlock[k], `block ${k}`);
  }
  // Typing time of a long block tracks its own target speed.
  first.perBlock.forEach((acts, k) => {
    const chars = Array.from(doc.blocks[k].runs[0].text).length;
    const typingMs = acts.filter((a) => a.type === 'char' || a.type === 'back').reduce((s, a) => s + a.delay, 0) - (k ? acts[1].delay : 0);
    const wpm = chars / 5 / (typingMs / 60000);
    const target = targetWpm(opts, k);
    assert.ok(Math.abs(wpm / target - 1) < 0.2, `block ${k}: ${wpm.toFixed(1)} vs target ${target.toFixed(1)}`);
  });
  // estimate() reflects automatic mode and differs from a fixed speed.
  const auto = estimate(doc, opts);
  assert.deepStrictEqual(auto.perBlockMs, first.perBlock.map((acts) => acts.reduce((s, a) => s + a.delay, 0)));
  assert.notStrictEqual(auto.ms, estimate(doc, Object.assign({ wpm: 52 }, opts)).ms);
  assert.deepStrictEqual(simulateDoc(first.actions), normalizeDoc(doc));
});

test('some blocks start with a longer rest, never the first one', () => {
  const doc = { blocks: Array.from({ length: 400 }, (_, k) => (k % 10 === 0 ? H('h2', 'Section') : P('Ordinary words in a short paragraph.'))) };
  const { perBlock } = planAll(doc, { seed: 4, typoRate: 0 });
  // Block k > 0 is [Enter, first action carrying the pause, ...].
  const starts = perBlock.slice(1).map((acts) => acts[1].delay);
  const rested = starts.filter((d) => d >= 5000 + 60).length / starts.length;
  console.log(`  ${(rested * 100).toFixed(1)}% of blocks start after a pause of 5 s or more, longest ${(Math.max(...starts) / 1000).toFixed(1)} s`);
  assert.ok(rested > 0.03 && rested < 0.16, `share ${rested}`);
  assert.ok(Math.max(...starts) < 25000 * 1.6 + 30000);
  for (let seed = 1; seed <= 200; seed++) {
    const a = planBlock(doc, 0, { seed, typoRate: 0 }, initialCarry()).actions;
    assert.ok(a[0].delay < 1000 && a[1].delay < 5000, `seed ${seed}`);
  }
});

test('links are pasted one by one, the rest is typed', () => {
  assert.deepStrictEqual(splitLinks('See https://example.com/a_(b). And www.x.org, ok'), [
    { text: 'See ', link: false },
    { text: 'https://example.com/a_(b)', link: true },
    { text: '. And ', link: false },
    { text: 'www.x.org', link: true },
    { text: ', ok', link: false },
  ]);
  assert.deepStrictEqual(splitLinks('(Smith, 2020, https://doi.org/10.1/abc)'), [
    { text: '(Smith, 2020, ', link: false },
    { text: 'https://doi.org/10.1/abc', link: true },
    { text: ')', link: false },
  ]);
  assert.deepStrictEqual(splitLinks('no links here'), [{ text: 'no links here', link: false }]);

  const doc = {
    blocks: [
      H('h1', 'References'),
      P([{ text: 'Smith, J. (2020). A study. ' }, { text: 'Journal', italic: true }, { text: '. https://doi.org/10.1000/xyz123' }]),
      P('Doe, A. (2021). Retrieved from https://example.com/page?id=4 and http://b.org/c.'),
    ],
  };
  for (let seed = 1; seed <= 40; seed++) {
    const { actions } = planAll(doc, { seed, typoRate: 0.3 });
    const pastes = actions.filter((a) => a.type === 'paste').map((a) => a.text);
    assert.deepStrictEqual(pastes, ['https://doi.org/10.1000/xyz123', 'https://example.com/page?id=4', 'http://b.org/c']);
    for (const a of actions) if (a.type === 'paste') assert.ok(a.delay >= 1200, `paste delay ${a.delay}`);
    assert.deepStrictEqual(simulateDoc(actions), normalizeDoc(doc));
  }
});
