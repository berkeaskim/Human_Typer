// Run: node --test human-typer/test/
// The zone must be set before the first Date is created. Europe/London has DST:
// clocks go forward on 2026-03-29 and back on 2026-10-25.
process.env.TZ = 'Europe/London';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/scheduler.js');

const MIN = 60000;
const HOUR = 60 * MIN;
const SEEDS = 150;
const at = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const DEFAULTS = { hours: { start: 9, end: 23 }, sessionMin: { min: 15, max: 75 }, gapMin: 20 };
const mk = (o) => ({ ...DEFAULTS, ...o });

// Feasible scenarios with comfortable room (2026-06-02 is a Tuesday).
const SCENARIOS = {
  'two hours': mk({ workMs: 30 * MIN, now: at(2026, 6, 2, 14, 7, 13, 421), deadline: at(2026, 6, 2, 16, 7, 13, 421) }),
  'same evening': mk({ workMs: 2 * HOUR, now: at(2026, 6, 2, 16, 20, 5, 9), deadline: at(2026, 6, 2, 22, 30) }),
  'three days': mk({ workMs: 5 * HOUR, now: at(2026, 6, 2, 11, 3, 44, 17), deadline: at(2026, 6, 5, 18, 0) }),
  'two weeks': mk({ workMs: 12 * HOUR, now: at(2026, 6, 2, 10, 41, 2, 300), deadline: at(2026, 6, 16, 17, 0) }),
  'two weeks, little work': mk({ workMs: 3 * HOUR, now: at(2026, 6, 2, 10, 41, 2, 300), deadline: at(2026, 6, 16, 17, 0) }),
  'window wraps past midnight': mk({
    workMs: 6 * HOUR, now: at(2026, 6, 2, 15, 12, 40, 1), deadline: at(2026, 6, 7, 12, 0), hours: { start: 20, end: 2 },
  }),
  'now inside the wrapped part': mk({
    workMs: 3 * HOUR, now: at(2026, 6, 3, 0, 31, 7, 77), deadline: at(2026, 6, 5, 23, 0), hours: { start: 20, end: 2 },
  }),
  'weekdays only': mk({
    workMs: 8 * HOUR, now: at(2026, 6, 5, 15, 2, 9, 5), deadline: at(2026, 6, 10, 12, 0), days: [1, 2, 3, 4, 5],
  }),
  'deadline inside a disallowed stretch': mk({ workMs: 4 * HOUR, now: at(2026, 6, 2, 13, 0, 30, 3), deadline: at(2026, 6, 4, 4, 0) }),
  'now outside a window': mk({ workMs: 2 * HOUR, now: at(2026, 6, 2, 3, 12, 55, 8), deadline: at(2026, 6, 2, 21, 0) }),
  'tiny work': mk({ workMs: 90 * 1000, now: at(2026, 6, 2, 12, 0, 1, 1), deadline: at(2026, 6, 5, 12, 0) }),
  'spring DST change': mk({ workMs: 9 * HOUR, now: at(2026, 3, 27, 10, 9, 3, 2), deadline: at(2026, 3, 31, 18, 0) }),
  'autumn DST change, wrapping window': mk({
    workMs: 7 * HOUR, now: at(2026, 10, 23, 18, 4, 4, 4), deadline: at(2026, 10, 27, 12, 0), hours: { start: 21, end: 3 },
  }),
};

function margin(input) {
  return Math.min(120 * MIN, Math.max(10 * MIN, 0.05 * (input.deadline - input.now)));
}
// The local day on which the window containing `ts` opened.
function sittingDay(ts, hours) {
  const d = new Date(ts);
  const wraps = hours.end <= hours.start;
  const back = wraps && d.getHours() < hours.end ? 1 : 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}
function maxPerDay(input, sessions) {
  const counts = new Map();
  for (const s of sessions) {
    const k = sittingDay(s.start, input.hours);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

// Invariants that hold for every plan, feasible or best effort.
function checkPlan(input, res, label) {
  const { sessions } = res;
  const latest = input.deadline - margin(input);
  let prevEnd = -Infinity;
  for (const s of sessions) {
    assert.ok(Number.isInteger(s.start) && Number.isInteger(s.end), `${label}: integer times`);
    assert.ok(s.end > s.start, `${label}: positive length`);
    assert.strictEqual(s.budgetMs, s.end - s.start, `${label}: budget equals length`);
    assert.ok(s.budgetMs <= input.sessionMin.max * MIN, `${label}: not longer than the maximum`);
    assert.ok(s.start >= input.now, `${label}: starts after now`);
    assert.ok(s.end <= latest + 1, `${label}: ends before deadline minus margin`);
    assert.ok(s.start >= prevEnd, `${label}: sorted, no overlap`);
    if (prevEnd > -Infinity) assert.ok(s.start - prevEnd >= input.gapMin * MIN, `${label}: minimum break`);
    for (let t = s.start; t < s.end; t += 5 * MIN) {
      assert.ok(S.isWithinHours(t, input.hours, input.days), `${label}: inside allowed hours at ${new Date(t)}`);
    }
    assert.ok(S.isWithinHours(s.end - 1, input.hours, input.days), `${label}: end inside allowed hours`);
    prevEnd = s.end;
  }
  assert.strictEqual(res.totalBudgetMs, sum(sessions.map((s) => s.budgetMs)), `${label}: total budget`);
  assert.strictEqual(res.requiredMs, Math.ceil(input.workMs * 1.15), `${label}: requiredMs`);
}

for (const [name, input] of Object.entries(SCENARIOS)) {
  test(`feasible plan keeps every invariant: ${name}`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const inp = { ...input, seed };
      const res = S.planSessions(inp);
      const label = `${name} seed ${seed}`;
      assert.strictEqual(res.feasible, true, `${label}: feasible`);
      assert.strictEqual(res.reason, undefined, `${label}: no reason`);
      assert.ok(res.sessions.length >= 1, `${label}: has sittings`);
      checkPlan(inp, res, label);
      assert.ok(res.totalBudgetMs >= input.workMs * 1.15, `${label}: budget covers work plus slack`);
      assert.ok(res.totalBudgetMs <= res.availableMs, `${label}: budget within available time`);
      for (const s of res.sessions) {
        assert.ok(s.budgetMs >= input.sessionMin.min * MIN, `${label}: not shorter than the minimum`);
      }
      assert.ok(maxPerDay(inp, res.sessions) <= 4, `${label}: at most 4 sittings per day`);
    }
  });
}

test('same input and seed give the same plan, and the input is not modified', () => {
  for (const input of Object.values(SCENARIOS)) {
    const inp = { ...input, seed: 42 };
    const frozen = JSON.stringify(inp);
    assert.deepStrictEqual(S.planSessions(inp), S.planSessions(JSON.parse(frozen)));
    assert.strictEqual(JSON.stringify(inp), frozen);
  }
  assert.deepStrictEqual(
    S.planSessions({ ...SCENARIOS['two weeks'], seed: 'essay' }),
    S.planSessions({ ...SCENARIOS['two weeks'], seed: 'essay' }),
  );
});

test('different seeds give different plans and sitting counts', () => {
  const plans = new Set();
  const counts = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const res = S.planSessions({ ...SCENARIOS['two weeks'], seed });
    plans.add(JSON.stringify(res.sessions));
    counts.add(res.sessions.length);
  }
  assert.strictEqual(plans.size, 60);
  assert.ok(counts.size >= 3, `sitting counts seen: ${[...counts]}`);
});

test('sittings are irregular: no grid, uneven lengths, unrounded start times', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { sessions } = S.planSessions({ ...SCENARIOS['two weeks'], seed });
    const rounded = sessions.filter((s) => s.start % (5 * MIN) === 0).length;
    assert.ok(rounded <= 1, `seed ${seed}: ${rounded} starts on a 5-minute mark`);
    assert.ok(new Set(sessions.map((s) => s.budgetMs)).size > sessions.length / 2, `seed ${seed}: lengths repeat`);
    const steps = sessions.slice(1).map((s, i) => s.start - sessions[i].start);
    assert.ok(new Set(steps).size > steps.length / 2, `seed ${seed}: start-to-start steps repeat`);
    const clock = new Set(sessions.map((s) => new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes()));
    assert.ok(clock.size > sessions.length / 2, `seed ${seed}: same clock time every day`);
    const lens = sessions.map((s) => s.budgetMs);
    assert.ok(Math.max(...lens) - Math.min(...lens) > 5 * MIN, `seed ${seed}: lengths too similar`);
  }
});

test('sittings are spread over the span with a mild bias toward the start', () => {
  for (const name of ['two weeks', 'two weeks, little work', 'three days']) {
    const input = SCENARIOS[name];
    const mid = (input.now + input.deadline) / 2;
    let early = 0;
    let late = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { sessions } = S.planSessions({ ...input, seed });
      assert.ok(sessions[0].start < mid, `${name} seed ${seed}: nothing in the first half`);
      assert.ok(sessions[sessions.length - 1].end > mid, `${name} seed ${seed}: crammed at the start`);
      for (const s of sessions) {
        if ((s.start + s.end) / 2 < mid) early += s.budgetMs;
        else late += s.budgetMs;
      }
    }
    assert.ok(early > late, `${name}: early ${early} should exceed late ${late}`);
    assert.ok(late > early * 0.4, `${name}: late ${late} too small against early ${early}`);
  }
  // Plenty of work over two weeks uses (nearly) every day.
  for (let seed = 1; seed <= 30; seed++) {
    const sum = S.summarize(S.planSessions({ ...SCENARIOS['two weeks'], seed }).sessions);
    assert.ok(sum.perDay.length >= 13, `seed ${seed}: only ${sum.perDay.length} days used`);
  }
});

test('first sitting starts at now when now is inside an allowed window', () => {
  for (const name of ['two hours', 'same evening', 'three days', 'now inside the wrapped part']) {
    for (let seed = 1; seed <= 40; seed++) {
      const input = { ...SCENARIOS[name], seed };
      assert.strictEqual(S.planSessions(input).sessions[0].start, input.now, `${name} seed ${seed}`);
    }
  }
  const two = S.planSessions({ ...SCENARIOS['two hours'], seed: 7 });
  assert.strictEqual(two.sessions.length, 1, 'a short span needs a single sitting');
  const outside = { ...SCENARIOS['now outside a window'], seed: 7 };
  assert.ok(S.planSessions(outside).sessions[0].start >= at(2026, 6, 2, 9));
});

test('more than 4 sittings in a day only when needed to fit', () => {
  // 09:00 to roughly 22:20 of one day holds 8 full sittings; 9 h of work needs them all.
  const input = mk({ workMs: 9 * HOUR, now: at(2026, 6, 2, 8, 0), deadline: at(2026, 6, 2, 23, 0) });
  for (let seed = 1; seed <= 40; seed++) {
    const inp = { ...input, seed };
    const res = S.planSessions(inp);
    assert.strictEqual(res.feasible, true);
    checkPlan(inp, res, `crammed seed ${seed}`);
    assert.ok(res.totalBudgetMs >= input.workMs * 1.15);
    assert.ok(maxPerDay(inp, res.sessions) > 4);
  }
});

test('huge work is infeasible and fills all available time', () => {
  for (const name of ['three days', 'window wraps past midnight', 'weekdays only', 'spring DST change']) {
    for (let seed = 1; seed <= 10; seed++) {
      const inp = { ...SCENARIOS[name], workMs: 400 * HOUR, seed };
      const res = S.planSessions(inp);
      assert.strictEqual(res.feasible, false);
      assert.strictEqual(res.reason, 'not_enough_time');
      assert.ok(res.availableMs > 0 && res.availableMs < res.requiredMs);
      assert.strictEqual(res.totalBudgetMs, res.availableMs);
      assert.ok(res.sessions.length > 4);
      checkPlan(inp, res, `${name} infeasible seed ${seed}`);
    }
  }
});

test('deadline in the past or too close', () => {
  const now = at(2026, 6, 2, 12, 0);
  for (const deadline of [now - HOUR, now, NaN]) {
    const res = S.planSessions(mk({ workMs: HOUR, now, deadline, seed: 1 }));
    assert.deepStrictEqual(
      { feasible: res.feasible, reason: res.reason, sessions: res.sessions, availableMs: res.availableMs },
      { feasible: false, reason: 'deadline_passed', sessions: [], availableMs: 0 },
    );
    assert.strictEqual(res.requiredMs, Math.ceil(HOUR * 1.15));
  }
  // The whole span is eaten by the 10-minute safety margin.
  const close = S.planSessions(mk({ workMs: MIN, now, deadline: now + 8 * MIN, seed: 1 }));
  assert.strictEqual(close.feasible, false);
  assert.strictEqual(close.reason, 'not_enough_time');
});

test('no allowed window before the deadline', () => {
  const cases = [
    mk({ workMs: HOUR, now: at(2026, 6, 2, 23, 30), deadline: at(2026, 6, 3, 6, 0) }),
    mk({ workMs: HOUR, now: at(2026, 6, 6, 10, 0), deadline: at(2026, 6, 7, 20, 0), days: [1, 2, 3, 4, 5] }),
    mk({ workMs: HOUR, now: at(2026, 6, 2, 10, 0), deadline: at(2026, 6, 9, 10, 0), days: [] }),
  ];
  for (const input of cases) {
    const res = S.planSessions({ ...input, seed: 3 });
    assert.strictEqual(res.feasible, false);
    assert.strictEqual(res.reason, 'no_allowed_window');
    assert.deepStrictEqual(res.sessions, []);
    assert.strictEqual(res.availableMs, 0);
  }
});

test('zero work needs no sittings', () => {
  const res = S.planSessions({ ...SCENARIOS['three days'], workMs: 0, seed: 1 });
  assert.strictEqual(res.feasible, true);
  assert.deepStrictEqual(res.sessions, []);
  assert.strictEqual(res.totalBudgetMs, 0);
});

test('defaults apply when optional fields are missing', () => {
  const { now, deadline } = SCENARIOS['three days'];
  const res = S.planSessions({ workMs: 4 * HOUR, now, deadline, seed: 5 });
  assert.strictEqual(res.feasible, true);
  checkPlan(mk({ workMs: 4 * HOUR, now, deadline }), res, 'defaults');
});

test('replan plans the remaining work from the new now with a fresh pattern', () => {
  for (const name of ['three days', 'two weeks', 'window wraps past midnight']) {
    for (let seed = 1; seed <= 40; seed++) {
      const input = { ...SCENARIOS[name], seed };
      const first = S.planSessions(input);
      // Woke up a day and a bit later with 60% of the work left.
      const state = { remainingWorkMs: Math.round(input.workMs * 0.6), now: input.now + 26 * HOUR + seed * 7919 };
      const again = S.replan(input, state);
      const label = `${name} replan seed ${seed}`;
      assert.strictEqual(again.feasible, true, label);
      checkPlan({ ...input, workMs: state.remainingWorkMs, now: state.now }, again, label);
      assert.ok(again.totalBudgetMs >= state.remainingWorkMs * 1.15, label);
      assert.deepStrictEqual(again, S.replan(input, state), `${label}: deterministic`);
      // Same now and same work still give a new pattern, since the seed changes.
      const same = S.replan(input, { remainingWorkMs: input.workMs, now: input.now });
      assert.notDeepStrictEqual(same.sessions, first.sessions, `${label}: repeats the old pattern`);
      const later = S.replan(input, { ...state, now: state.now + 1 });
      assert.notDeepStrictEqual(later.sessions, again.sessions, `${label}: seed ignores now`);
    }
  }
  const input = { ...SCENARIOS['three days'], seed: 9 };
  const late = S.replan(input, { remainingWorkMs: 30 * HOUR, now: input.deadline - 20 * HOUR });
  assert.strictEqual(late.feasible, false);
  assert.strictEqual(late.reason, 'not_enough_time');
  assert.strictEqual(S.replan(input, { remainingWorkMs: HOUR, now: input.deadline + 1 }).reason, 'deadline_passed');
});

test('nextSession returns the sitting in progress or the next one', () => {
  const sessions = [
    { start: 1000, end: 2000, budgetMs: 1000 },
    { start: 5000, end: 7000, budgetMs: 2000 },
  ];
  assert.strictEqual(S.nextSession(sessions, 0), sessions[0]);
  assert.strictEqual(S.nextSession(sessions, 1500), sessions[0]);
  assert.strictEqual(S.nextSession(sessions, 2000), sessions[1]);
  assert.strictEqual(S.nextSession(sessions, 6999), sessions[1]);
  assert.strictEqual(S.nextSession(sessions, 7000), null);
  assert.strictEqual(S.nextSession([], 0), null);
});

test('isWithinHours handles plain, wrapping and weekday-restricted windows', () => {
  const day = { start: 9, end: 23 };
  assert.strictEqual(S.isWithinHours(at(2026, 6, 2, 9, 0), day), true);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 2, 8, 59, 59, 999), day), false);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 2, 22, 59, 59, 999), day), true);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 2, 23, 0), day), false);

  const night = { start: 20, end: 2 };
  assert.strictEqual(S.isWithinHours(at(2026, 6, 2, 21, 0), night), true);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 3, 1, 59), night), true);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 3, 2, 0), night), false);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 3, 12, 0), night), false);

  // 2026-06-05 is a Friday. A wrapping window belongs to the day it opens on.
  const weekdays = [1, 2, 3, 4, 5];
  assert.strictEqual(S.isWithinHours(at(2026, 6, 5, 21, 0), night, weekdays), true);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 6, 1, 0), night, weekdays), true);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 6, 21, 0), night, weekdays), false);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 8, 1, 0), night, weekdays), false);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 6, 12, 0), day, weekdays), false);
  assert.strictEqual(S.isWithinHours(at(2026, 6, 6, 12, 0), day, [6]), true);

  // start === end means the whole day.
  assert.strictEqual(S.isWithinHours(at(2026, 6, 2, 4, 0), { start: 6, end: 6 }), true);
});

test('allowed windows follow the local clock across DST changes', () => {
  // Spring forward on 2026-03-29: that local day has 23 hours, the 09-23 window still has 14.
  const spring = { ...SCENARIOS['spring DST change'], workMs: 400 * HOUR, gapMin: 0, sessionMin: { min: 15, max: 60 }, seed: 1 };
  const sunday = S.summarize(S.planSessions(spring).sessions).perDay.find((d) => d.dayStart === at(2026, 3, 29));
  assert.strictEqual(sunday.budgetMs, 14 * HOUR);
  assert.strictEqual(at(2026, 3, 30) - at(2026, 3, 29), 23 * HOUR);

  // Fall back on 2026-10-25: the 21 -> 03 window opened on the 24th lasts 7 real hours.
  const autumn = {
    ...SCENARIOS['autumn DST change, wrapping window'], workMs: 400 * HOUR, gapMin: 0, sessionMin: { min: 15, max: 60 }, seed: 1,
  };
  const night = S.planSessions(autumn).sessions.filter((s) => s.start >= at(2026, 10, 24, 21) && s.end <= at(2026, 10, 25, 3));
  assert.strictEqual(sum(night.map((s) => s.budgetMs)), 7 * HOUR);
  assert.strictEqual(S.isWithinHours(at(2026, 10, 25, 3) - 1, autumn.hours), true);
  assert.strictEqual(S.isWithinHours(at(2026, 10, 25, 3), autumn.hours), false);
});

test('summarize reports totals and per-day figures', () => {
  assert.deepStrictEqual(S.summarize([]), { count: 0, firstStart: null, lastEnd: null, totalBudgetMs: 0, perDay: [] });
  const sessions = [
    { start: at(2026, 6, 2, 10, 0), end: at(2026, 6, 2, 10, 30), budgetMs: 30 * MIN },
    { start: at(2026, 6, 2, 22, 50), end: at(2026, 6, 2, 23, 30), budgetMs: 40 * MIN },
    { start: at(2026, 6, 4, 9, 5), end: at(2026, 6, 4, 9, 25), budgetMs: 20 * MIN },
  ];
  assert.deepStrictEqual(S.summarize(sessions), {
    count: 3,
    firstStart: sessions[0].start,
    lastEnd: sessions[2].end,
    totalBudgetMs: 90 * MIN,
    perDay: [
      { dayStart: at(2026, 6, 2), count: 2, budgetMs: 70 * MIN },
      { dayStart: at(2026, 6, 4), count: 1, budgetMs: 20 * MIN },
    ],
  });
  for (let seed = 1; seed <= 20; seed++) {
    const res = S.planSessions({ ...SCENARIOS['two weeks'], seed });
    const sm = S.summarize(res.sessions);
    assert.strictEqual(sm.count, res.sessions.length);
    assert.strictEqual(sm.totalBudgetMs, res.totalBudgetMs);
    assert.strictEqual(sum(sm.perDay.map((d) => d.count)), sm.count);
    assert.strictEqual(sum(sm.perDay.map((d) => d.budgetMs)), sm.totalBudgetMs);
  }
});

test('module attaches to globalThis', () => {
  assert.strictEqual(globalThis.HumanTyperScheduler, S);
});
