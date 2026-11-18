// Run from the repo root: node --test human-typer/test/
const test = require('node:test');
const assert = require('node:assert');
const { flatten, planFill, resumeAdvance, applyPlan } = require('../lib/fill.js');

// --- builders --------------------------------------------------------------
const p = (text, style) => ({ type: 'paragraph', style: style || 'normal', list: null, align: 'left', runs: text ? [{ text }] : [] });
// Cells are strings (one paragraph) or arrays of strings (several paragraphs).
const table = (rows) => ({
  type: 'table',
  rows: rows.map((r) => r.map((c) => ({ paragraphs: [].concat(c).map((t) => p(t)) }))),
});
const doc = (...blocks) => ({ blocks: blocks.map((b) => (typeof b === 'string' ? p(b) : b)) });
const texts = (d) => flatten(d).map((x) => x.text);

// Independent replay of the caret rules. Every paragraph remembers its index in
// the original template so each unit can be checked to land on its anchor.
function replay(template, plan) {
  const paras = texts(template).map((text, orig) => ({ text, orig }));
  let i = 0;
  let atEnd = paras[0].text === ''; // DocStart
  plan.units.forEach((u, k) => {
    assert.ok(Number.isInteger(u.advance) && u.advance >= 0, `unit ${k}: advance ${u.advance}`);
    for (let n = 0; n < u.advance; n++) {
      if (!atEnd) atEnd = true;
      else {
        assert.ok(i < paras.length - 1, `unit ${k}: ParaEnd past the last paragraph`);
        i++;
      }
    }
    assert.ok(atEnd, `unit ${k}: caret is not at a paragraph end`);
    assert.strictEqual(paras[i].orig, u.templateIndex, `unit ${k}: caret is on the wrong paragraph`);
    if (u.mode === 'insert') {
      assert.ok(u.paragraphs.length > 0, `unit ${k}: empty insert`);
      for (const q of u.paragraphs) paras.splice(++i, 0, { text: q.text, orig: null });
      assert.strictEqual(u.chars, u.paragraphs.reduce((s, q) => s + Array.from(q.text).length + 1, 0));
    } else {
      assert.ok(u.text.length > 0, `unit ${k}: nothing to type`);
      assert.strictEqual(u.runs.map((r) => r.text).join(''), u.text, `unit ${k}: runs do not match text`);
      assert.strictEqual(u.chars, Array.from(u.text).length);
      paras[i].text = u.mode === 'append' ? paras[i].text + u.text : u.text;
    }
  });
  return paras.map((x) => x.text);
}

// Plans, replays three ways (independent editor, applyPlan, resume at every unit)
// and returns the plan plus the resulting texts.
function run(template, filled) {
  const plan = planFill(template, filled);
  const result = replay(template, plan);
  assert.deepStrictEqual(applyPlan(template, plan), result, 'applyPlan differs from the independent replay');
  for (let k = 0; k < plan.units.length; k++) {
    assert.deepStrictEqual(applyPlan(template, plan, { resumeAt: k }), result, `resume at unit ${k}`);
  }
  if (plan.units.length) assert.strictEqual(resumeAdvance(plan, 0), plan.units[0].advance);
  assert.strictEqual(plan.stats.charsToType, plan.units.reduce((s, u) => s + u.chars, 0));
  return { plan, result };
}
function fills(template, filled) {
  const { plan, result } = run(template, filled);
  assert.deepStrictEqual(plan.problems, []);
  assert.deepStrictEqual(result, texts(filled));
  return plan;
}
const shape = (plan) => plan.units.map((u) => [u.advance, u.mode, u.mode === 'insert' ? u.paragraphs.map((q) => q.text) : u.text, u.templateIndex]);

// --- fixtures ---------------------------------------------------------------
const FORM_TEMPLATE = doc(
  p('Application Form', 'h1'),
  'Name:',
  'Please answer every question in full sentences.',
  table([
    ['Question', 'Answer'],
    ['Why do you apply?', ''],
    ['When can you start?', ''],
  ]),
  '',
  'Signature: '
);
const FORM_FILLED = doc(
  p('Application Form', 'h1'),
  'Name: Ada Lovelace',
  'Please answer every question in full sentences.',
  table([
    ['Question', 'Answer'],
    ['Why do you apply?', 'I enjoy careful work.'],
    ['When can you start?', 'Next month.'],
  ]),
  'Thank you for your time.',
  'Signature: A. L.'
);

// --- tests -------------------------------------------------------------------
test('flatten lists paragraphs in reading order with table coordinates', () => {
  const flat = flatten(doc('a', table([['b', ['c', 'd']], ['e', 'f']]), 'g'));
  assert.deepStrictEqual(flat.map((x) => x.text), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepStrictEqual(flat.map((x) => x.inTable), [false, true, true, true, true, true, false]);
  const d = flat[3];
  assert.deepStrictEqual([d.block, d.row, d.col, d.para], [1, 0, 1, 1]);
  assert.deepStrictEqual(flat[6].block, 2);
  assert.deepStrictEqual(flat[0].runs, [{ text: 'a' }]);
});

test('form template: types only the answers', () => {
  const plan = fills(FORM_TEMPLATE, FORM_FILLED);
  assert.deepStrictEqual(shape(plan), [
    [2, 'append', ' Ada Lovelace', 1],
    [5, 'append', 'I enjoy careful work.', 6],
    [2, 'append', 'Next month.', 8],
    [1, 'append', 'Thank you for your time.', 9],
    [1, 'append', 'A. L.', 10],
  ]);
  assert.deepStrictEqual(plan.stats, { paragraphs: 11, unchanged: 6, appended: 5, replaced: 0, inserted: 0, charsToType: 74 });
});

test('identical documents need no typing', () => {
  const plan = fills(FORM_FILLED, FORM_FILLED);
  assert.deepStrictEqual(plan.units, []);
  assert.strictEqual(plan.stats.unchanged, 11);
  assert.strictEqual(plan.stats.charsToType, 0);
});

test('a document starting with an empty paragraph needs one press less', () => {
  const plan = fills(doc('', 'Label:', ''), doc('Intro', 'Label: x', 'Outro'));
  assert.deepStrictEqual(shape(plan), [
    [0, 'append', 'Intro', 0],
    [1, 'append', ' x', 1],
    [1, 'append', 'Outro', 2],
  ]);
  // After unit 0 the first paragraph is no longer empty.
  assert.deepStrictEqual([0, 1, 2].map((k) => resumeAdvance(plan, k)), [0, 2, 3]);

  // The first paragraph stays empty: later units keep the shorter count on resume.
  const plan2 = fills(doc('', 'A:', 'B:'), doc('', 'A: 1', 'B: 2'));
  assert.deepStrictEqual(plan2.units.map((u) => u.advance), [1, 1]);
  assert.deepStrictEqual([0, 1].map((k) => resumeAdvance(plan2, k)), [1, 2]);
});

test('an empty first paragraph absorbs the first of several new paragraphs', () => {
  const plan = fills(doc(''), doc('One', 'Two', 'Three'));
  assert.deepStrictEqual(shape(plan), [
    [0, 'append', 'One', 0],
    [0, 'insert', ['Two', 'Three'], 0],
  ]);
  assert.strictEqual(plan.stats.inserted, 2);
});

test('new paragraphs are inserted after their anchor, consecutive ones merged', () => {
  const plan = fills(doc('Title', 'Q1:', 'End'), doc('Title', 'Q1: yes', 'More detail.', '', 'Even more.', 'End', 'PS'));
  assert.deepStrictEqual(shape(plan), [
    [2, 'append', ' yes', 1],
    [0, 'insert', ['More detail.', '', 'Even more.'], 1],
    [1, 'insert', ['PS'], 2],
  ]);
  assert.deepStrictEqual([0, 1, 2].map((k) => resumeAdvance(plan, k)), [2, 2, 6]);
});

test('extra paragraphs inside a cell stay inside that cell', () => {
  const template = doc('T', table([['Q', ''], ['Notes', 'n/a']]), '');
  const filled = doc('T', table([['Q', ['First point.', 'Second point.']], ['Notes', ['n/a', 'Nothing else.']]]), 'Bye');
  const plan = fills(template, filled);
  assert.deepStrictEqual(shape(plan), [
    [3, 'append', 'First point.', 2],
    [0, 'insert', ['Second point.'], 2],
    [2, 'insert', ['Nothing else.'], 4],
    [1, 'append', 'Bye', 5],
  ]);
});

test('a similar paragraph is replaced, a dissimilar one is reported', () => {
  const template = doc('Report', 'Date: 01.01.2025', 'Write your summary here', '');
  const filled = doc('Report', 'Date: 12.03.2025', 'I wrote my summary here!', 'Done');
  const plan = fills(template, filled);
  assert.deepStrictEqual(shape(plan), [
    [2, 'replace', 'Date: 12.03.2025', 1],
    [1, 'replace', 'I wrote my summary here!', 2],
    [1, 'append', 'Done', 3],
  ]);
  assert.strictEqual(plan.stats.replaced, 2);

  // Below the similarity threshold the template text is kept and reported.
  const r = run(doc('Title', '[type your answer]'), doc('Title', 'Forty-two.'));
  assert.deepStrictEqual(r.plan.problems.map((x) => [x.code, x.templateIndex]), [['template_text_missing', 1]]);
  assert.deepStrictEqual(r.result, ['Title', '[type your answer]', 'Forty-two.']);
});

test('two tables are paired in order', () => {
  const template = doc('A', table([['x', '']]), 'B:', table([['', 'y'], ['', '']]), '');
  const filled = doc('A', table([['x', '1']]), 'B: 2', table([['3', 'y'], ['4', '5']]), '6');
  const plan = fills(template, filled);
  assert.deepStrictEqual(shape(plan), [
    [3, 'append', '1', 2],
    [1, 'append', ' 2', 3],
    [1, 'append', '3', 4],
    [2, 'append', '4', 6],
    [1, 'append', '5', 7],
    [1, 'append', '6', 8],
  ]);
});

test('table shape mismatch fills the overlapping cells and reports a problem', () => {
  const template = doc('T', table([['Q', ''], ['R', '']]), '');
  const filled = doc('T', table([['Q', 'a', 'extra'], ['R', 'b', 'extra'], ['S', 'c', 'extra']]), 'end');
  const { plan, result } = run(template, filled);
  assert.deepStrictEqual(plan.problems.map((x) => [x.code, x.templateIndex]), [['table_shape_mismatch', 1]]);
  assert.deepStrictEqual(result, ['T', 'Q', 'a', 'R', 'b', 'end']);
});

test('a different number of tables is a structure mismatch, the rest is still planned', () => {
  const template = doc('Name:', table([['', '']]), 'Tail:');
  const filled = doc('Name: x', 'Tail: y');
  const { plan, result } = run(template, filled);
  assert.deepStrictEqual(plan.problems.map((x) => x.code), ['structure_mismatch']);
  assert.deepStrictEqual(result, ['Name: x', '', '', 'Tail: y']);
});

test('text that cannot be typed is reported, never thrown', () => {
  // A new paragraph before the first one has no anchor.
  let r = run(doc('Body'), doc('Preface', 'Body', 'After'));
  assert.deepStrictEqual(r.plan.problems.map((x) => [x.code, x.templateIndex]), [['insert_before_first', 0]]);
  assert.deepStrictEqual(r.result, ['Body', 'After']);

  // Template text that is absent from the filled document is left alone.
  r = run(doc('Keep', 'Delete this instruction paragraph', 'Name:'), doc('Keep', 'Name: x'));
  assert.deepStrictEqual(r.plan.problems.map((x) => [x.code, x.templateIndex]), [['template_text_missing', 1]]);
  assert.deepStrictEqual(r.result, ['Keep', 'Delete this instruction paragraph', 'Name: x']);

  // Malformed input.
  for (const bad of [null, {}, { blocks: [] }, { blocks: [{ type: 'table', rows: [] }, { type: 'paragraph' }] }]) {
    assert.doesNotThrow(() => planFill(bad, FORM_FILLED));
    assert.doesNotThrow(() => planFill(FORM_TEMPLATE, bad));
    assert.doesNotThrow(() => applyPlan(bad, planFill(bad, bad)));
  }
});

test('append keeps the remainder exactly and never doubles the separator', () => {
  const cases = [
    ['Name:', 'Name:Ada', 'Ada'],
    ['Name:', 'Name: Ada', ' Ada'],
    ['Name: ', 'Name: Ada', 'Ada'],
    ['Name: ', 'Name: Ada', 'Ada'],
    ['Name:', 'Name:\tAda', '\tAda'],
  ];
  for (const [t, f, typed] of cases) {
    const plan = run(doc('x', t), doc('x', f)).plan;
    assert.deepStrictEqual(shape(plan), [[2, 'append', typed, 1]], JSON.stringify([t, f]));
  }
  // Whitespace-only differences are not worth typing.
  assert.deepStrictEqual(planFill(doc('Name: ', 'a  b'), doc('Name:', 'a b ')).units, []);
});

test('formatting of the typed part is kept in runs', () => {
  const filled = doc('x');
  filled.blocks[0].runs = [{ text: 'Name: ' }, { text: 'Ada', bold: true }, { text: ' Lovelace', italic: true }];
  const plan = fills(doc('Name: A'), filled);
  assert.deepStrictEqual(plan.units[0].runs, [{ text: 'da', bold: true }, { text: ' Lovelace', italic: true }]);
  assert.strictEqual(plan.units[0].text, 'da Lovelace');
});

test('Turkish text, including decomposed input, is matched and typed correctly', () => {
  const template = doc(
    p('Başvuru Formu', 'h1'),
    'Adı Soyadı:',
    'Öğrenci numarası: ',
    table([['Soru', 'Yanıt'], ['Neden İstanbul?', '']]),
    'İmza:'
  );
  const filled = doc(
    p('Başvuru Formu'.normalize('NFD'), 'h1'),
    'Adı Soyadı: Çağrı Öztürk'.normalize('NFD'),
    'Öğrenci numarası: 2021ŞĞ',
    table([['Soru', 'Yanıt'], ['Neden İstanbul?', 'Çünkü ışıl ışıl, güzel bir şehir.']]),
    'İmza: Ç. Ö.'
  );
  const { plan, result } = run(template, filled);
  assert.deepStrictEqual(plan.problems, []);
  assert.deepStrictEqual(shape(plan), [
    [2, 'append', ' Çağrı Öztürk', 1],
    [1, 'append', '2021ŞĞ', 2],
    [4, 'append', 'Çünkü ışıl ışıl, güzel bir şehir.', 6],
    [1, 'append', ' Ç. Ö.', 7],
  ]);
  assert.deepStrictEqual(result, texts(filled).map((s) => s.normalize('NFC')));
  // Dotted and dotless i are different letters: no accidental match.
  assert.strictEqual(planFill(doc('ISIK'), doc('IŞIK')).units[0].mode, 'replace');
  assert.strictEqual(planFill(doc('sınıf'), doc('sinif')).units.length, 1);
});

// --- property test -----------------------------------------------------------
function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ('name date answer question because the student şehir öğrenci çalışma ığdır İzmir güneş yağmur ' +
  'report total note first second signature imza açıklama değerlendirme sonuç 2024 42 yes no maybe').split(' ');

function randomPair(seed, allowDrop) {
  const r = rng32(seed);
  const int = (n) => Math.floor(r() * n);
  const sentence = () => (r() < 0.12 ? '' : Array.from({ length: 1 + int(7) }, () => WORDS[int(WORDS.length)]).join(' ') + (r() < 0.3 ? '.' : ''));
  // Template version of one filled paragraph: kept, blanked or cut at a word boundary.
  const derive = (text) => {
    const x = r();
    if (x < 0.35) return text;
    if (x < 0.65) return '';
    const words = text.split(' ');
    const cut = words.slice(0, 1 + int(words.length)).join(' ');
    return cut + (cut !== text && r() < 0.5 ? ' ' : '');
  };
  const filled = [];
  const template = [];
  const blocks = 1 + int(7);
  for (let b = 0; b < blocks; b++) {
    if (r() < 0.25 && b > 0) {
      const rows = 1 + int(3);
      const cols = 1 + int(3);
      const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Array.from({ length: r() < 0.2 ? 2 : 1 }, sentence)));
      filled.push(table(cells));
      // A cell keeps its first paragraph; later ones may be missing from the template.
      template.push(table(cells.map((row) => row.map((c) => c.filter((_, k) => k === 0 || !allowDrop || r() < 0.5).map(derive)))));
    } else {
      const text = sentence();
      filled.push(p(text));
      if (!(allowDrop && r() < 0.2)) template.push(p(derive(text)));
    }
  }
  if (!template.some((b) => b.type === 'paragraph')) template.unshift(p(''));
  return { template: { blocks: template }, filled: { blocks: filled } };
}

test('property: random template/filled pairs replay to the filled document', () => {
  const trimEnd = (list) => list.map((s) => s.replace(/\s+$/, ''));
  for (const allowDrop of [false, true]) {
    let clean = 0;
    let unitsSeen = 0;
    const N = 1500;
    for (let seed = 1; seed <= N; seed++) {
      const { template, filled } = randomPair(seed * 7919 + (allowDrop ? 1 : 0), allowDrop);
      let out;
      try {
        out = run(template, filled);
      } catch (e) {
        e.message = `seed ${seed} drop=${allowDrop}: ${e.message}\n${JSON.stringify(texts(template))}\n${JSON.stringify(texts(filled))}`;
        throw e;
      }
      unitsSeen += out.plan.units.length;
      for (const pr of out.plan.problems) assert.ok(typeof pr.code === 'string' && typeof pr.detail === 'string');
      if (out.plan.problems.length) continue;
      clean++;
      // Kept trailing whitespace of the template is the only tolerated difference.
      assert.deepStrictEqual(trimEnd(out.result), trimEnd(texts(filled)), `seed ${seed} drop=${allowDrop}`);
    }
    assert.ok(unitsSeen > N, 'the generator should produce work to do');
    // Without dropped paragraphs the structures match, so (almost) every plan is clean.
    assert.ok(clean >= (allowDrop ? 0.4 : 0.98) * N, `only ${clean}/${N} problem-free plans (drop=${allowDrop})`);
  }
});
