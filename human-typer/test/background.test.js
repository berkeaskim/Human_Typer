// Drives the service worker with a fake `chrome` and plays the role of the
// content script, to check the job state machine end to end.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..');
const store = {};
const alarms = {};
const sent = [];
const listeners = { connect: null, message: null, alarm: null };
const tab = { id: 7, active: true, title: 'Target - Google Docs', url: 'https://docs.google.com/document/d/abc123/edit' };

globalThis.self = globalThis;
globalThis.importScripts = (...files) => files.forEach((f) => require(path.join(root, f)));
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' });
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] === undefined ? undefined : JSON.parse(store[key]) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => (store[k] = JSON.stringify(v))),
      remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
    },
  },
  tabs: {
    query: async () => [tab],
    get: async () => tab,
    create: async () => tab,
    update: async () => tab,
    sendMessage: async (_id, msg) => {
      sent.push(msg.type);
      return { ok: true, ready: true, running: false };
    },
    onActivated: { addListener() {} },
    onUpdated: { addListener() {} },
  },
  alarms: {
    create: async (name, info) => (alarms[name] = info),
    clearAll: async () => Object.keys(alarms).forEach((k) => delete alarms[k]),
    onAlarm: { addListener: (fn) => (listeners.alarm = fn) },
  },
  sidePanel: { setPanelBehavior: async () => {} },
  runtime: {
    onInstalled: { addListener() {} },
    onConnect: { addListener: (fn) => (listeners.connect = fn) },
    onMessage: { addListener: (fn) => (listeners.message = fn) },
  },
};
require(path.join(root, 'background.js'));

const Doc = globalThis.HumanTyperDoc;
const Planner = globalThis.HumanTyperPlanner;
const Fill = globalThis.HumanTyperFill;

// What the "live document" currently contains; the worker reads it through
// parseDocx(export).
let live = { blocks: [] };
Doc.parseDocx = async () => ({ doc: live, warnings: [] });

function connect() {
  const states = [];
  let onMessage;
  const port = {
    name: 'ht-ui',
    postMessage: (m) => states.push(m),
    onDisconnect: { addListener() {} },
    onMessage: { addListener: (fn) => (onMessage = fn) },
  };
  listeners.connect(port);
  return { states, send: (m) => onMessage(m), last: () => states.filter((s) => s.type === 'state').pop().state };
}
const fromPage = (msg) => new Promise((res) => listeners.message(msg, { tab }, res));
const P = (text, extra) => Object.assign({ type: 'paragraph', style: 'normal', list: null, align: 'left', runs: text ? [{ text }] : [] }, extra);
const cell = (text) => ({ paragraphs: [P(text)] });

// Pulls blocks like content.js does. `onChunk` sees every reply.
async function drive(jobId, onChunk) {
  let finished = null;
  let fresh = true;
  for (let guard = 0; guard < 500; guard++) {
    const reply = await fromPage({ type: 'ht-next', jobId, finished, fresh });
    fresh = false;
    if (reply.done || reply.stop || reply.wait) return reply;
    onChunk(reply);
    finished = reply.token;
  }
  throw new Error('job never finished');
}

test('types a whole formatted document into an empty Google Doc and verifies it', async () => {
  const source = {
    blocks: [
      P('Rapor Başlığı', { style: 'h1' }),
      P('', { runs: [{ text: 'Kalın ', bold: true }, { text: 've normal metin, çığlık.' }] }),
      P('ilk madde', { list: { kind: 'bullet', level: 0 } }),
      P('ikinci madde', { list: { kind: 'bullet', level: 0 } }),
      { type: 'table', rows: [[cell('Soru'), cell('Cevap')], [cell('Bir'), cell('İki')]] },
      P('Son paragraf.', { align: 'center' }),
    ],
  };
  live = { blocks: [] };
  const ui = connect();
  await ui.send({ type: 'job:create', doc: source, fileName: 'rapor.docx', options: { typoRate: 0.05, layout: 'auto' }, schedule: { mode: 'now' } });
  let job = ui.last().job;
  assert.strictEqual(job.status, 'running');
  assert.strictEqual(job.kind, 'compose');
  assert.strictEqual(job.options.layout, 'trq');
  assert.ok(sent.includes('ht-start'));

  const all = [];
  let firstPre = null;
  // Once everything is typed the worker exports the document: hand it the
  // result of replaying the actions.
  Doc.parseDocx = async () => ({ doc: Planner.simulateDoc(all), warnings: [] });
  const end = await drive(job.id, (reply) => {
    if (!firstPre) firstPre = reply.pre;
    all.push(...reply.actions);
  });
  assert.deepStrictEqual(firstPre.map((a) => a.key), ['DocEnd']);
  assert.ok(end.done);
  assert.deepStrictEqual(Planner.simulateDoc(all), Planner.normalizeDoc(source));
  job = ui.last().job;
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.message, 'msg.verified');
  assert.strictEqual(job.progress.blocksDone, job.progress.blocksTotal);
});

test('fills only the missing parts when the Google Doc already holds the template', async () => {
  const template = {
    blocks: [P('Başvuru Formu', { style: 'h1' }), P('Ad Soyad:'), { type: 'table', rows: [[cell('Soru'), cell('Cevap')], [cell('Şehir'), cell('')]] }, P('')],
  };
  const filled = {
    blocks: [P('Başvuru Formu', { style: 'h1' }), P('Ad Soyad: Ayşe Yılmaz'), { type: 'table', rows: [[cell('Soru'), cell('Cevap')], [cell('Şehir'), cell('İzmir')]] }, P('Teşekkürler.')],
  };
  live = template;
  Doc.parseDocx = async () => ({ doc: live, warnings: [] });
  const ui = connect();
  await ui.send({ type: 'job:create', doc: filled, fileName: 'form.docx', options: { typoRate: 0, layout: 'auto' }, schedule: { mode: 'now' } });
  let job = ui.last().job;
  assert.strictEqual(job.kind, 'fill');
  assert.strictEqual(job.progress.blocksTotal, 3);

  const typed = [];
  const end = await drive(job.id, (reply) => {
    const nav = reply.pre.map((a) => a.key);
    typed.push({ nav, text: Planner.simulate(reply.actions.filter((a) => a.type !== 'key')) });
    if (typed.length === 3) live = filled; // after the last unit the document matches
  });
  assert.ok(end.done);
  assert.deepStrictEqual(typed.map((t) => t.text), [' Ayşe Yılmaz', 'İzmir', 'Teşekkürler.']);
  assert.strictEqual(typed[0].nav[0], 'DocStart'); // a fresh page walks from the top
  assert.ok(typed[1].nav.every((k) => k === 'ParaEnd') && typed[1].nav.length > 0);
  assert.strictEqual(ui.last().job.status, 'done');
});

test('a deadline job waits for its first sitting when started outside the allowed hours', async () => {
  live = { blocks: [] };
  Doc.parseDocx = async () => ({ doc: live, warnings: [] });
  const now = new Date();
  const closedHour = (now.getHours() + 12) % 24; // a two-hour window half a day away
  const ui = connect();
  await ui.send({
    type: 'job:create',
    doc: { blocks: [P('Kısa bir metin.'), P('İkinci paragraf.')] },
    fileName: 'a.txt',
    options: { typoRate: 0.02, layout: 'auto' },
    schedule: { mode: 'deadline', deadline: Date.now() + 3 * 86400e3, hours: { start: closedHour, end: (closedHour + 2) % 24 }, days: [0, 1, 2, 3, 4, 5, 6] },
  });
  const job = ui.last().job;
  assert.strictEqual(job.status, 'waiting');
  assert.ok(job.nextSessionAt > Date.now());
  assert.ok(job.sessions.length >= 1 && job.sessions.every((s) => s.status === 'upcoming'));
  assert.strictEqual(alarms['ht-session'].when, job.nextSessionAt);

  // Pausing and stopping are reflected in the state the panel receives.
  await ui.send({ type: 'job:stop' });
  assert.strictEqual(ui.last().job.status, 'stopped');
  await ui.send({ type: 'job:clear' });
  assert.strictEqual(ui.last().job, null);
});
