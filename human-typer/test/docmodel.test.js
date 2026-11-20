'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HT = require('../lib/docmodel.js');
require('../lib/markdown.js');

const para = (runs, extra) => ({
  type: 'paragraph',
  style: 'normal',
  list: null,
  align: 'left',
  runs,
  ...extra,
});
const utf8 = (s) => new TextEncoder().encode(s).buffer;

test('the API is attached to globalThis.HumanTyperDoc', () => {
  assert.strictEqual(globalThis.HumanTyperDoc, HT);
  for (const fn of ['normalize', 'validate', 'parsePlain', 'parseFile', 'toPlainText', 'stats']) {
    assert.strictEqual(typeof HT[fn], 'function', fn);
  }
});

test('normalize merges adjacent runs with identical formatting and drops empty runs', () => {
  const doc = HT.normalize({
    blocks: [
      para([
        { text: 'a' },
        { text: '' },
        { text: 'b', bold: false },
        { text: 'c', bold: true },
        { text: 'd', bold: true },
        { text: 'e', bold: true, italic: true },
      ]),
    ],
  });
  assert.deepStrictEqual(doc.blocks[0].runs, [
    { text: 'ab' },
    { text: 'cd', bold: true },
    { text: 'e', bold: true, italic: true },
  ]);
  assert.deepStrictEqual(HT.validate(doc), []);
});

test('normalize splits paragraphs at line breaks and keeps style, list and align', () => {
  const doc = HT.normalize({
    blocks: [
      para([{ text: 'one\ntw' }, { text: 'o\r\nthree', bold: true }], {
        list: { kind: 'bullet', level: 2 },
        align: 'center',
      }),
    ],
  });
  assert.strictEqual(doc.blocks.length, 3);
  assert.deepStrictEqual(
    doc.blocks.map((b) => b.runs),
    [[{ text: 'one' }], [{ text: 'tw' }, { text: 'o', bold: true }], [{ text: 'three', bold: true }]]
  );
  for (const b of doc.blocks) {
    assert.deepStrictEqual(b.list, { kind: 'bullet', level: 2 });
    assert.strictEqual(b.align, 'center');
  }
  assert.deepStrictEqual(HT.validate(doc), []);
});

test('normalize turns tabs into single spaces', () => {
  const doc = HT.normalize({ blocks: [para([{ text: 'a\tb' }])] });
  assert.strictEqual(doc.blocks[0].runs[0].text, 'a b');
});

test('normalize repairs invalid style, align and list values', () => {
  const doc = HT.normalize({
    blocks: [
      { type: 'paragraph', style: 'h9', align: 'middle', list: { kind: 'bullet', level: 42 }, runs: [{ text: 'x' }] },
      { type: 'paragraph', list: { kind: 'weird', level: 1 }, runs: [{ text: 'y' }] },
      { type: 'unknown' },
      null,
    ],
  });
  assert.deepStrictEqual(doc.blocks, [
    para([{ text: 'x' }], { list: { kind: 'bullet', level: 8 } }),
    para([{ text: 'y' }]),
  ]);
});

test('normalize makes tables rectangular and gives every cell a paragraph', () => {
  const doc = HT.normalize({
    blocks: [
      {
        type: 'table',
        rows: [
          [{ paragraphs: [para([{ text: 'a\nb' }])] }, { paragraphs: [] }, { paragraphs: [para([{ text: 'c' }])] }],
          [{ paragraphs: [para([{ text: 'd' }])] }],
        ],
      },
      { type: 'table', rows: [] },
    ],
  });
  assert.strictEqual(doc.blocks.length, 1);
  const rows = doc.blocks[0].rows;
  assert.deepStrictEqual(rows.map((r) => r.length), [3, 3]);
  assert.strictEqual(rows[0][0].paragraphs.length, 2);
  assert.deepStrictEqual(rows[0][1].paragraphs, [para([])]);
  assert.deepStrictEqual(rows[1][2].paragraphs, [para([])]);
  assert.deepStrictEqual(HT.validate(doc), []);
});

test('normalize does not mutate its input', () => {
  const input = { blocks: [para([{ text: 'a\tb' }, { text: 'c' }])] };
  const copy = JSON.parse(JSON.stringify(input));
  HT.normalize(input);
  assert.deepStrictEqual(input, copy);
});

test('validate reports problems', () => {
  assert.deepStrictEqual(HT.validate(null), ['doc.blocks: must be an array']);
  const problems = HT.validate({
    blocks: [
      para([{ text: 'a\nb' }, { text: 'c\t' }, { text: '', bold: false }]),
      para([{ text: 'x' }], { style: 'big', align: 'middle', list: { kind: 'bullet', level: 9 } }),
      { type: 'table', rows: [[{ paragraphs: [para([])] }], []] },
      { type: 'table', rows: [[{ paragraphs: [] }]] },
      { type: 'video' },
      { type: 'image', id: 'img1', align: 'left' },
    ],
  });
  const has = (re) => assert.ok(problems.some((p) => re.test(p)), `${re} not in ${problems}`);
  has(/blocks\[0\]\.runs\[0\]\.text: contains a line break/);
  has(/blocks\[0\]\.runs\[1\]\.text: contains a tab/);
  has(/blocks\[0\]\.runs\[1\]: has the same formatting/);
  has(/blocks\[0\]\.runs\[2\]\.text: must be a non-empty string/);
  has(/blocks\[1\]\.style/);
  has(/blocks\[1\]\.align/);
  has(/blocks\[1\]\.list\.level/);
  has(/blocks\[2\]\.rows\[1\]: table is not rectangular/);
  has(/blocks\[3\]\.rows\[0\]\[0\]\.paragraphs/);
  has(/blocks\[4\]: unknown block type/);
  has(/blocks\[5\]\.id: no image data/);
});

test('parsePlain makes one normal paragraph per non-blank line', () => {
  const doc = HT.parsePlain('\uFEFFfirst line\r\n\r\n  \nsecond\tline  \nığüşöçİĞÜŞÖÇ\n');
  assert.deepStrictEqual(doc.blocks, [
    para([{ text: 'first line' }]),
    para([{ text: 'second line' }]),
    para([{ text: 'ığüşöçİĞÜŞÖÇ' }]),
  ]);
  assert.deepStrictEqual(HT.parsePlain('').blocks, []);
});

test('toPlainText joins paragraphs, cells and rows', () => {
  const cell = (...texts) => ({ paragraphs: texts.map((t) => para(t ? [{ text: t }] : [])) });
  const doc = {
    blocks: [
      para([{ text: 'Hello ' }, { text: 'world', bold: true }]),
      { type: 'table', rows: [[cell('a'), cell('b', 'c')], [cell(''), cell('d')]] },
      para([{ text: 'end' }]),
    ],
  };
  assert.strictEqual(HT.toPlainText(doc), 'Hello world\na\tb c\n\td\nend');
});

test('stats counts blocks, paragraphs, tables, words and characters', () => {
  const cell = (t) => ({ paragraphs: [para([{ text: t }])] });
  const doc = {
    blocks: [
      para([{ text: 'Hello ' }, { text: 'wörld 😀', bold: true }]),
      { type: 'table', rows: [[cell('a b'), cell('c')]] },
      para([]),
    ],
  };
  assert.deepStrictEqual(HT.stats(doc), { blocks: 3, paragraphs: 2, tables: 1, words: 6, chars: 17 });
});

test('parseFile dispatches on the file extension', async () => {
  const txt = await HT.parseFile('notes.TXT', utf8('one\n\ntwo'));
  assert.deepStrictEqual(txt.warnings, []);
  assert.strictEqual(HT.toPlainText(txt.doc), 'one\ntwo');

  const md = await HT.parseFile('C:\\docs\\read.me.md', utf8('# Başlık\n\ntext'));
  assert.strictEqual(md.doc.blocks[0].style, 'h1');
  assert.strictEqual(md.doc.blocks[0].runs[0].text, 'Başlık');

  const markdown = await HT.parseFile('a.markdown', new TextEncoder().encode('- item'));
  assert.deepStrictEqual(markdown.doc.blocks[0].list, { kind: 'bullet', level: 0 });
});

test('parseFile decodes UTF-16 text files with a byte order mark', async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x31, 0x01, 0x0a, 0x00, 0x62, 0x00]); // "ı\nb"
  const { doc } = await HT.parseFile('a.txt', bytes.buffer);
  assert.strictEqual(HT.toPlainText(doc), 'ı\nb');
});

test('parseFile rejects unsupported file types with a clear error', async () => {
  await assert.rejects(HT.parseFile('report.pdf', utf8('x')), /Unsupported file type "\.pdf"/);
  await assert.rejects(HT.parseFile('noextension', utf8('x')), /Unsupported file type/);
  await assert.rejects(HT.parseFile('old.doc', utf8('x')), (e) => e instanceof Error);
});
