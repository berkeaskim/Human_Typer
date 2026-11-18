'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HT = require('../lib/markdown.js');

const para = (runs, extra) => ({
  type: 'paragraph',
  style: 'normal',
  list: null,
  align: 'left',
  runs,
  ...extra,
});
const runsOf = (md) => {
  const doc = HT.parseMarkdown(md);
  assert.strictEqual(doc.blocks.length, 1, JSON.stringify(doc.blocks));
  return doc.blocks[0].runs;
};
const parse = (md) => {
  const doc = HT.parseMarkdown(md);
  assert.deepStrictEqual(HT.validate(doc), []);
  return doc.blocks;
};

test('headings from # to ######', () => {
  const blocks = parse('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six ##\n####### Seven\n#NoSpace');
  assert.deepStrictEqual(
    blocks.map((b) => [b.style, b.runs[0].text]),
    [
      ['h1', 'One'],
      ['h2', 'Two'],
      ['h3', 'Three'],
      ['h4', 'Four'],
      ['h5', 'Five'],
      ['h6', 'Six'],
      ['normal', '####### Seven #NoSpace'],
    ]
  );
});

test('headings keep inline formatting', () => {
  assert.deepStrictEqual(parse('## A **bold** title'), [
    para([{ text: 'A ' }, { text: 'bold', bold: true }, { text: ' title' }], { style: 'h2' }),
  ]);
});

test('bold, italic and strikethrough', () => {
  assert.deepStrictEqual(runsOf('a **b** __c__ *d* _e_ ~~f~~ g'), [
    { text: 'a ' },
    { text: 'b', bold: true },
    { text: ' ' },
    { text: 'c', bold: true },
    { text: ' ' },
    { text: 'd', italic: true },
    { text: ' ' },
    { text: 'e', italic: true },
    { text: ' ' },
    { text: 'f', strike: true },
    { text: ' g' },
  ]);
});

test('nested and combined emphasis', () => {
  assert.deepStrictEqual(runsOf('***both*** and **bold with *italic* inside**'), [
    { text: 'both', bold: true, italic: true },
    { text: ' and ' },
    { text: 'bold with ', bold: true },
    { text: 'italic', bold: true, italic: true },
    { text: ' inside', bold: true },
  ]);
  assert.deepStrictEqual(runsOf('*a **b** c*'), [
    { text: 'a ', italic: true },
    { text: 'b', bold: true, italic: true },
    { text: ' c', italic: true },
  ]);
});

test('unpaired markers, snake_case and escapes stay literal', () => {
  assert.deepStrictEqual(runsOf('2 * 3 * 4'), [{ text: '2 * 3 * 4' }]);
  assert.deepStrictEqual(runsOf('a **b'), [{ text: 'a **b' }]);
  assert.deepStrictEqual(runsOf('my_var_name and ~tilde'), [{ text: 'my_var_name and ~tilde' }]);
  assert.deepStrictEqual(runsOf('\\*not italic\\* \\# x'), [{ text: '*not italic* # x' }]);
});

test('links keep their visible text, images are skipped, code is plain', () => {
  assert.deepStrictEqual(runsOf('See [the **site**](https://example.com) and <https://a.b/c>.'), [
    { text: 'See the ' },
    { text: 'site', bold: true },
    { text: ' and https://a.b/c.' },
  ]);
  assert.deepStrictEqual(runsOf('pic ![alt](x.png) here'), [{ text: 'pic  here' }]);
  assert.deepStrictEqual(runsOf('use `a * b * c` now'), [{ text: 'use a * b * c now' }]);
  assert.deepStrictEqual(parse('![only an image](x.png)'), []);
});

test('Turkish characters survive, including inside emphasis', () => {
  assert.deepStrictEqual(runsOf('ığüşöç **İĞÜŞÖÇ** _çağrı_'), [
    { text: 'ığüşöç ' },
    { text: 'İĞÜŞÖÇ', bold: true },
    { text: ' ' },
    { text: 'çağrı', italic: true },
  ]);
});

test('paragraphs: soft-wrapped lines join, blank lines separate, hard breaks split', () => {
  assert.deepStrictEqual(parse('line one\nline two\n\nnext para  \nafter break\\\nlast'), [
    para([{ text: 'line one line two' }]),
    para([{ text: 'next para' }]),
    para([{ text: 'after break' }]),
    para([{ text: 'last' }]),
  ]);
});

test('bullet lists with -, * and + nested by indentation', () => {
  const blocks = parse('- a\n  - b\n    - c\n  - d\n* e\n+ f\n\ttab nested? no, continuation');
  assert.deepStrictEqual(
    blocks.map((b) => [b.list.kind, b.list.level, b.runs[0].text]),
    [
      ['bullet', 0, 'a'],
      ['bullet', 1, 'b'],
      ['bullet', 2, 'c'],
      ['bullet', 1, 'd'],
      ['bullet', 0, 'e'],
      ['bullet', 0, 'f tab nested? no, continuation'],
    ]
  );
});

test('ordered lists, mixed nesting and tab indentation', () => {
  const blocks = parse('1. one\n2. two\n   - inner bullet\n\t\t1) deep\n3. three\n\nafter');
  assert.deepStrictEqual(
    blocks.map((b) => [b.list && b.list.kind, b.list && b.list.level, b.runs[0].text]),
    [
      ['number', 0, 'one'],
      ['number', 0, 'two'],
      ['bullet', 1, 'inner bullet'],
      ['number', 2, 'deep'],
      ['number', 0, 'three'],
      [null, null, 'after'],
    ]
  );
});

test('list nesting is capped at level 8', () => {
  const md = Array.from({ length: 12 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n');
  const levels = parse(md).map((b) => b.list.level);
  assert.strictEqual(Math.max(...levels), 8);
});

test('GFM pipe tables with alignment, inline formatting and ragged rows', () => {
  const blocks = parse(
    'before\n\n| Name | Qty | Note |\n|:-----|:---:|-----:|\n| **Çay** | 2 | a \\| b |\n| Kahve |\nafter'
  );
  assert.strictEqual(blocks.length, 3);
  const table = blocks[1];
  assert.strictEqual(table.type, 'table');
  assert.deepStrictEqual(table.rows.map((r) => r.length), [3, 3, 3]);
  assert.deepStrictEqual(table.rows[0].map((c) => c.paragraphs[0].align), ['left', 'center', 'right']);
  assert.deepStrictEqual(table.rows[1][0].paragraphs[0].runs, [{ text: 'Çay', bold: true }]);
  assert.deepStrictEqual(table.rows[1][2].paragraphs[0].runs, [{ text: 'a | b' }]);
  assert.deepStrictEqual(table.rows[2][1].paragraphs[0].runs, []);
  assert.strictEqual(HT.toPlainText({ blocks: [table] }), 'Name\tQty\tNote\nÇay\t2\ta | b\nKahve\t\t');
  assert.strictEqual(blocks[2].runs[0].text, 'after');
});

test('a pipe without a separator row is plain text', () => {
  assert.deepStrictEqual(parse('a | b\nc | d'), [para([{ text: 'a | b c | d' }])]);
});

test('fenced code is kept verbatim, rules are dropped, quotes lose their marker', () => {
  assert.deepStrictEqual(parse('```js\nconst a = **b**;\n\n  indented_x_y\n```\n---\n> quoted *text*\n***'), [
    para([{ text: 'const a = **b**;' }]),
    para([{ text: '  indented_x_y' }]),
    para([{ text: 'quoted ' }, { text: 'text', italic: true }]),
  ]);
});

test('empty input and CRLF line endings', () => {
  assert.deepStrictEqual(parse(''), []);
  assert.deepStrictEqual(parse('﻿# T\r\n\r\ntext\r\n'), [
    para([{ text: 'T' }], { style: 'h1' }),
    para([{ text: 'text' }]),
  ]);
});
