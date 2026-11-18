// Service worker: owns the job. It decides what to type next, when sittings
// start and stop, and keeps everything in chrome.storage so it survives the
// worker being shut down between events. The content script only executes.
importScripts('lib/docmodel.js', 'lib/zip.js', 'lib/docx.js', 'lib/markdown.js', 'planner.js', 'lib/scheduler.js', 'lib/fill.js');

const Doc = self.HumanTyperDoc;
const Planner = self.HumanTyperPlanner;
const Scheduler = self.HumanTyperScheduler;
const Fill = self.HumanTyperFill;

const K = { job: 'ht:job', doc: 'ht:doc', fill: 'ht:fill' };
const ALARM = { session: 'ht-session', watch: 'ht-watch' };
const DOC_URL = /^https:\/\/docs\.google\.com\/document\/((?:u\/\d+\/)?)d\/([\w-]+)/;
const ports = new Set();

// --- storage ----------------------------------------------------------------
const get = async (key) => (await chrome.storage.local.get(key))[key] || null;
const set = (key, value) => chrome.storage.local.set({ [key]: value });
const loadJob = () => get(K.job);
async function saveJob(job) {
  await set(K.job, job);
  pushState(job);
}

// --- state for the side panel -------------------------------------------------
async function findTarget() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || !DOC_URL.test(tab.url)) return null;
  return { tabId: tab.id, title: (tab.title || '').replace(/ - Google (Docs|Dokümanlar)$/, ''), url: tab.url };
}

function publicJob(job) {
  if (!job) return null;
  const now = Date.now();
  const sessions = job.mode === 'deadline'
    ? job.sessions.map((s, i) => ({
        start: s.start,
        end: s.end,
        budgetMs: s.budgetMs,
        status: s.state || (i === job.sessionIndex && job.status === 'running' ? 'current' : s.end <= now ? 'missed' : 'upcoming'),
      }))
    : undefined;
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    kind: job.kind,
    fileName: job.fileName,
    options: job.options,
    progress: { blocksDone: job.item, blocksTotal: job.total, charsDone: job.charsDone, charsTotal: job.charsTotal },
    startedAt: job.startedAt,
    deadline: job.deadline,
    sessions,
    nextSessionAt: job.status === 'waiting' ? job.nextSessionAt : undefined,
    etaMs: Math.max(0, job.workMs - job.workDoneMs),
    message: job.message,
    fill: job.fillSummary,
  };
}

async function pushState(job) {
  if (!ports.size) return;
  const state = { target: await findTarget(), job: publicJob(job === undefined ? await loadJob() : job) };
  for (const port of ports) {
    try {
      port.postMessage({ type: 'state', state });
    } catch (e) {
      ports.delete(port);
    }
  }
}

// --- reading the live Google Doc ---------------------------------------------
async function exportDoc(url) {
  const m = url.match(DOC_URL);
  if (!m) throw new Error('not_a_google_doc');
  const res = await fetch(`https://docs.google.com/document/${m[1]}d/${m[2]}/export?format=docx`, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error('export_failed_' + res.status);
  return (await Doc.parseDocx(await res.arrayBuffer())).doc;
}

// Docs rewrites straight quotes and a few other characters as you type.
// Comparisons are done on text with those differences folded away.
const FOLD = [[/[‘’‚′]/g, "'"], [/[“”„″]/g, '"'], [/[–—]/g, '-'], [/…/g, '...'], [/ /g, ' ']];
const fold = (s) => FOLD.reduce((t, [re, to]) => t.replace(re, to), s);
function foldDoc(doc) {
  const para = (p) => Object.assign({}, p, { runs: p.runs.map((r) => Object.assign({}, r, { text: fold(r.text) })) });
  return {
    blocks: doc.blocks.map((b) =>
      b.type === 'table' ? { type: 'table', rows: b.rows.map((row) => row.map((c) => ({ paragraphs: c.paragraphs.map(para) }))) } : para(b)
    ),
  };
}

// Stores a fill plan and switches the job to working through its units.
async function adoptFillPlan(job, template, plan) {
  const flat = Fill.flatten(template);
  for (const u of plan.units) {
    // Full paragraph text, used when a unit has to be redone after a reload.
    u.full = u.mode === 'append' ? flat[u.templateIndex].text + u.text : u.text;
  }
  await set(K.fill, plan);
  const chars = plan.units.reduce((s, u) => s + u.chars, 0);
  job.kind = 'fill';
  job.item = 0;
  job.actionIndex = 0;
  job.total = plan.units.length;
  job.charsDone = 0;
  job.charsTotal = chars;
  job.itemMs = plan.units.map((u) => Math.round(u.chars * MS_PER_CHAR + u.advance * 150));
  job.workMs = job.itemMs.reduce((s, x) => s + x, 0);
  job.workDoneMs = 0;
  job.fillSummary = Object.assign({}, plan.stats, { problems: plan.problems.map((p) => p.detail) });
}
const MS_PER_CHAR = 60000 / (52 * 5) * 1.15; // rough cost of a character incl. pauses

// --- creating a job -----------------------------------------------------------
async function createJob(msg) {
  const target = await findTarget();
  if (!target) return saveJob({ id: uid(), status: 'error', message: 'msg.no_target', item: 0, total: 0, workMs: 0, workDoneMs: 0 });
  const source = Doc.normalize(msg.doc);
  const text = Doc.toPlainText(source);
  const layout = msg.options.layout && msg.options.layout !== 'auto' ? msg.options.layout : Planner.detectLayout(text);
  const job = {
    id: uid(),
    status: 'running',
    mode: msg.schedule.mode,
    fileName: msg.fileName,
    options: { typoRate: msg.options.typoRate, layout, font: Planner.resolveFont(msg.options.font), speed: Planner.SPEEDS.includes(msg.options.speed) ? msg.options.speed : 'normal' },
    seed: (Math.random() * 2 ** 32) >>> 0,
    tabId: target.tabId,
    docUrl: target.url.match(DOC_URL)[0] + '/edit',
    startedAt: Date.now(),
    carry: Planner.initialCarry(),
    item: 0,
    actionIndex: 0,
    repairRound: 0,
    sessions: [],
    sessionIndex: 0,
  };
  await set(K.doc, source);

  // An existing template in the target document means "fill in", otherwise
  // the whole document is typed.
  let template = null;
  try {
    template = await exportDoc(target.url);
  } catch (e) {
    job.message = 'msg.template_check_failed';
  }
  const tStats = template ? Doc.stats(template) : { chars: 0, tables: 0, paragraphs: 0 };
  let filled = false;
  if (tStats.chars > 0 || tStats.tables > 0) {
    const plan = Fill.planFill(foldDoc(template), foldDoc(source));
    const kept = plan.stats.unchanged + plan.stats.appended + plan.stats.replaced;
    if (kept >= Math.max(1, 0.3 * plan.stats.paragraphs)) {
      await adoptFillPlan(job, template, plan);
      filled = true;
    }
  }
  if (!filled) {
    const est = Planner.estimate(source, plannerOpts(job));
    job.kind = 'compose';
    job.total = Planner.itemCount(source); // body blocks, then header/footer
    job.charsDone = 0;
    job.charsTotal = est.chars;
    job.itemMs = est.perBlockMs;
    job.workMs = est.ms;
    job.workDoneMs = 0;
  }
  if (job.total === 0) {
    job.status = 'done';
    job.message = 'msg.nothing_to_type';
    return saveJob(job);
  }

  if (job.mode === 'deadline') {
    job.deadline = msg.schedule.deadline;
    job.window = { hours: msg.schedule.hours, days: msg.schedule.days };
    const plan = Scheduler.planSessions(scheduleInput(job, job.workMs, Date.now()));
    if (!plan.feasible) {
      job.status = 'error';
      job.message = 'msg.' + plan.reason;
      return saveJob(job);
    }
    job.sessions = plan.sessions;
  }
  await chrome.alarms.create(ALARM.watch, { periodInMinutes: 1 });
  await saveJob(job);
  return advanceSchedule(job);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const plannerOpts = (job) => ({ typoRate: job.options.typoRate, layout: job.options.layout, font: job.options.font, speed: job.options.speed, seed: job.seed });
const scheduleInput = (job, workMs, now) => ({
  workMs,
  now,
  deadline: job.deadline,
  hours: job.window.hours,
  days: job.window.days,
  sessionMin: { min: 20, max: 50 },
  gapMin: 20,
  seed: job.seed,
});

// --- sittings -----------------------------------------------------------------
// Starts the current sitting if it is due, otherwise waits for the next one.
async function advanceSchedule(job) {
  const now = Date.now();
  if (job.mode === 'now') return startSitting(job);
  let next = Scheduler.nextSession(job.sessions.filter((s) => !s.state), now);
  if (!next) {
    // Every planned sitting has passed (computer was asleep, or typing ran
    // slower than estimated): plan the remaining work again.
    const plan = Scheduler.replan(scheduleInput(job, job.workMs, now), { remainingWorkMs: Math.max(60000, job.workMs - job.workDoneMs), now });
    const done = job.sessions.filter((s) => s.state);
    job.sessions = done.concat(plan.sessions);
    job.late = !plan.feasible;
    next = plan.sessions[0] || { start: now, end: now + 3600e3, budgetMs: 3600e3 };
    if (!plan.sessions.length) job.sessions.push(next);
  }
  job.sessionIndex = job.sessions.indexOf(next);
  if (next.start <= now + 5000) return startSitting(job);
  job.status = 'waiting';
  job.nextSessionAt = next.start;
  await chrome.alarms.create(ALARM.session, { when: next.start });
  return saveJob(job);
}

async function ensureTab(job) {
  const id = job.docUrl.match(DOC_URL)[2];
  let tab = null;
  try {
    tab = await chrome.tabs.get(job.tabId);
    if (!tab.url || !tab.url.includes(id)) tab = null;
  } catch (e) {
    tab = null;
  }
  if (!tab) {
    const all = await chrome.tabs.query({ url: 'https://docs.google.com/document/*' });
    tab = all.find((t) => t.url && t.url.includes(id)) || (await chrome.tabs.create({ url: job.docUrl, active: true }));
  }
  job.tabId = tab.id;
  if (job.mode === 'deadline' && !tab.active) await chrome.tabs.update(tab.id, { active: true });
  // Wait for the content script to answer.
  for (let i = 0; i < 40; i++) {
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'ht-ping' });
      if (pong && pong.ready) return pong;
    } catch (e) {
      /* still loading */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function startSitting(job) {
  job.status = 'running';
  job.nextSessionAt = undefined;
  job.lastBeat = Date.now();
  const pong = await ensureTab(job);
  if (!pong) {
    job.status = 'error';
    job.message = 'msg.docs_tab_unreachable';
    return saveJob(job);
  }
  await saveJob(job);
  if (!pong.running) await chrome.tabs.sendMessage(job.tabId, { type: 'ht-start', jobId: job.id });
}

async function endSitting(job) {
  const s = job.sessions[job.sessionIndex];
  if (s) s.state = 'done';
  await saveJob(job);
  return advanceSchedule(job);
}

// --- what to type next ----------------------------------------------------------
const navKeys = (key, n, delay) => Array.from({ length: n }, () => ({ type: 'key', key, delay }));

async function buildCompose(job, fresh) {
  const doc = await get(K.doc);
  const planned = Planner.planBlock(doc, job.item, plannerOpts(job), job.carry);
  if (fresh && job.actionIndex > 0) {
    // Header/footer and tables are entered once at their start; a restart in
    // the middle would type into the wrong place.
    if (job.item >= doc.blocks.length) throw new Error('resume_inside_section');
    if (doc.blocks[job.item].type === 'table') throw new Error('resume_inside_table');
  }
  const pre = [];
  if (fresh) {
    // Fonts first: Docs drops pasted fonts that are not in the user's font menu.
    const families = Planner.docFonts(doc, plannerOpts(job));
    if (families.length) pre.push({ type: 'fonts', families, delay: 600 });
    // Docs' spelling autocorrect would "fix" typos the document keeps.
    pre.push({ type: 'noAutocorrect', delay: 500 });
    pre.push({ type: 'key', key: 'DocEnd', delay: 800 });
  }
  return { pre, actions: planned.actions, carry: planned.carry };
}

async function buildFill(job, fresh) {
  const plan = await get(K.fill);
  const unit = plan.units[job.item];
  const redo = fresh && job.actionIndex > 0; // interrupted in the middle of this unit
  if (redo && unit.mode === 'insert') throw new Error('resume_inside_insert');
  const typing = (text, salt) => Planner.plan(text, Object.assign(plannerOpts(job), {
      seed: (job.seed + job.item * 7919 + salt) >>> 0,
      wpm: Planner.targetWpm(plannerOpts(job), job.item), // same drifting pace as whole-document typing
    }));
  const pre = fresh
    ? [{ type: 'noAutocorrect', delay: 500 }, { type: 'key', key: 'DocStart', delay: 900 }].concat(navKeys('ParaEnd', Fill.resumeAdvance(plan, job.item), 90))
    : navKeys('ParaEnd', unit.advance, 140);
  if (pre.length > 1) pre[pre.length - 1].delay += 400;
  let actions = [];
  if (unit.mode === 'insert') {
    unit.paragraphs.forEach((p, i) => {
      actions.push({ type: 'key', key: 'Enter', delay: 500 });
      actions = actions.concat(typing(p.text, i));
    });
  } else {
    if (unit.mode === 'replace' || redo) actions.push({ type: 'key', key: 'SelectPara', delay: 600 });
    actions = actions.concat(typing(redo ? unit.full : unit.text, 0));
  }
  if (redo) job.actionIndex = 0;
  return { pre, actions, carry: job.carry };
}

// After the last item the document is exported and compared with the source.
// Anything still missing is typed in one repair pass.
async function finish(job) {
  await new Promise((r) => setTimeout(r, 3500)); // let Docs save
  try {
    const current = await exportDoc(job.docUrl);
    const plan = Fill.planFill(foldDoc(current), foldDoc(await get(K.doc)));
    if (plan.units.length && job.repairRound < 1) {
      job.repairRound++;
      await adoptFillPlan(job, current, plan);
      job.fresh = true;
      job.message = 'msg.repairing';
      await saveJob(job);
      return false;
    }
    job.message = plan.units.length || plan.problems.length ? 'msg.finished_with_differences' : 'msg.verified';
    job.fillSummary = Object.assign({}, job.fillSummary, { remaining: plan.units.length, problems: plan.problems.map((p) => p.detail) });
  } catch (e) {
    job.message = 'msg.finished_unverified';
  }
  job.status = 'done';
  for (const s of job.sessions) if (!s.state && s.start <= Date.now()) s.state = 'done';
  await chrome.alarms.clearAll();
  await saveJob(job);
  return true;
}

async function next(msg) {
  const job = await loadJob();
  if (!job || job.id !== msg.jobId || ['done', 'error', 'stopped'].includes(job.status)) return { stop: true };
  job.lastBeat = Date.now();
  if (msg.finished && msg.finished === job.token) {
    job.workDoneMs += job.itemMs[job.item] || 0;
    job.charsDone = Math.round(job.charsTotal * Math.min(1, job.workDoneMs / Math.max(1, job.workMs)));
    job.item++;
    job.actionIndex = 0;
    job.carry = job.pendingCarry || job.carry;
    job.token = null;
  }
  if (job.status === 'paused' || job.status === 'waiting') {
    await saveJob(job);
    return { wait: true };
  }
  if (job.item >= job.total) {
    await saveJob(job);
    if (await finish(job)) return { done: true };
    return next({ jobId: job.id, fresh: true });
  }
  // A sitting ends at a block boundary once its time is up; the last sitting
  // runs until the document is complete.
  if (job.mode === 'deadline' && job.actionIndex === 0) {
    const s = job.sessions[job.sessionIndex];
    const later = job.sessions.some((x, i) => i > job.sessionIndex && !x.state);
    if (s && Date.now() >= s.end && (later || Date.now() < job.deadline - 2 * 3600e3)) {
      await endSitting(job);
      return { wait: true };
    }
  }
  const fresh = !!msg.fresh || !!job.fresh;
  job.fresh = false;
  try {
    const built = job.kind === 'fill' ? await buildFill(job, fresh) : await buildCompose(job, fresh);
    job.token = uid();
    job.pendingCarry = built.carry;
    await saveJob(job);
    return { pre: built.pre, actions: built.actions, startAt: job.actionIndex, token: job.token };
  } catch (e) {
    job.status = 'error';
    job.message = 'msg.' + e.message;
    await saveJob(job);
    return { stop: true };
  }
}

// --- self-test ------------------------------------------------------------------
async function selfTest() {
  const target = await findTarget();
  if (!target) return ['No Google Doc tab is active.'];
  let r;
  try {
    r = await chrome.tabs.sendMessage(target.tabId, { type: 'ht-selftest' });
  } catch (e) {
    return ['The page is not ready. Reload the Google Doc tab and try again.'];
  }
  if (!r || !r.ok) return ['Docs input frame not found.'];
  const lines = ['Caret moved on first key: ' + (r.caretMoved === null ? 'caret not found' : r.caretMoved ? 'yes' : 'NO')];
  const m = target.url.match(DOC_URL);
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((res) => setTimeout(res, 2000));
    try {
      const res = await fetch(`https://docs.google.com/document/${m[1]}d/${m[2]}/export?format=txt`, { credentials: 'include', cache: 'no-store' });
      const text = (await res.text()).replace(/\r\n?/g, '\n');
      if (!text.includes(r.marker)) continue;
      const got = text.split(r.marker).pop().split('\n').slice(1);
      r.probes.forEach(([label, want], i) => lines.push(`${got[i] === want ? 'PASS' : 'FAIL'} ${label}: expected "${want}", got "${got[i] === undefined ? '(missing)' : got[i]}"`));
      return lines;
    } catch (e) {
      /* retry */
    }
  }
  lines.push('Could not read the document back; check the result by eye.');
  return lines;
}

// --- wiring -----------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ht-ui') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (msg) => {
    const job = await loadJob();
    const tell = (type) => job && chrome.tabs.sendMessage(job.tabId, { type, jobId: job.id }).catch(() => {});
    switch (msg.type) {
      case 'job:create':
        return createJob(msg);
      case 'job:pause':
        if (job && job.status === 'running') {
          job.status = 'paused';
          await saveJob(job);
          await tell('ht-pause');
        }
        return;
      case 'job:resume':
        if (job && job.status === 'paused') return job.mode === 'deadline' ? advanceSchedule(job) : startSitting(job);
        return;
      case 'job:stop':
        if (job) {
          job.status = 'stopped';
          await chrome.alarms.clearAll();
          await saveJob(job);
          await tell('ht-stop');
        }
        return;
      case 'job:clear':
        await chrome.alarms.clearAll();
        await chrome.storage.local.remove([K.job, K.doc, K.fill]);
        return pushState(null);
      case 'selftest':
        return port.postMessage({ type: 'selftest:result', lines: await selfTest() });
    }
  });
  pushState();
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ht-')) return false;
  (async () => {
    const job = await loadJob();
    switch (msg.type) {
      case 'ht-next':
        return respond(await next(msg));
      case 'ht-hello': {
        const mine = job && job.status === 'running' && sender.tab && msg.url.includes(job.docUrl.match(DOC_URL)[2]);
        if (mine) {
          job.tabId = sender.tab.id;
          await saveJob(job);
        }
        return respond(mine ? { start: job.id } : {});
      }
      case 'ht-progress':
        if (job && job.id === msg.jobId && job.token === msg.token) {
          job.actionIndex = msg.index;
          job.lastBeat = Date.now();
          await saveJob(job);
        }
        return respond({});
      case 'ht-visibility':
        if (job && job.id === msg.jobId && job.status === 'running') {
          job.message = msg.hidden ? 'msg.tab_hidden' : undefined;
          await saveJob(job);
        }
        return respond({});
      case 'ht-error':
        if (job && job.id === msg.jobId) {
          job.status = 'error';
          job.message = 'msg.' + msg.message;
          await saveJob(job);
        }
        return respond({});
      default:
        return respond({});
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const job = await loadJob();
  if (!job) return chrome.alarms.clearAll();
  if (job.status === 'waiting' && Date.now() >= job.nextSessionAt - 5000) return advanceSchedule(job);
  // Watchdog: a running job that has been silent for a while lost its page.
  if (alarm.name === ALARM.watch && job.status === 'running' && job.message !== 'msg.tab_hidden' && Date.now() - (job.lastBeat || 0) > 3 * 60000) {
    return startSitting(job);
  }
});

chrome.tabs.onActivated.addListener(() => pushState());
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete' || change.title) pushState();
});
