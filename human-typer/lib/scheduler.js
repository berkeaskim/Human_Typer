// Scheduler: spreads the typing of a document over several sittings between
// `now` and a deadline, at allowed local hours of the day.
// Pure and deterministic: the same input (including `seed` and `now`) gives the
// same plan. All times are epoch milliseconds; hours and weekdays are local.
// Runs in the page, in the service worker and under `node --test`.
(function (root) {
  'use strict';

  const MIN = 60000;
  const SLACK = 1.15; // budget / estimated work, leaves room for overruns
  const MAX_PER_DAY = 4; // sittings per allowed window unless more are needed to fit
  const MAX_DAYS = 366; // planning horizon, also guards against endless loops

  // --- randomness ----------------------------------------------------------
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toSeed(seed) {
    if (typeof seed !== 'string') return Number(seed) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function mixSeed(seed, now) {
    let h = Math.imul(toSeed(seed) ^ 0x9e3779b9 ^ (now >>> 0), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13) ^ Math.floor(now / 4294967296), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // --- small helpers -------------------------------------------------------
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  function normalize(input) {
    const hours = input.hours || {};
    const len = input.sessionMin || {};
    const minLen = Math.round(Math.max(1, len.min ?? 15) * MIN);
    return {
      workMs: Math.max(0, input.workMs || 0),
      now: input.now,
      deadline: input.deadline,
      hours: { start: hours.start ?? 9, end: hours.end ?? 23 },
      days: input.days,
      minLen,
      maxLen: Math.max(minLen, Math.round((len.max ?? 75) * MIN)),
      minPiece: Math.min(minLen, 5 * MIN), // shortest sitting ever produced
      gap: Math.round(Math.max(0, input.gapMin ?? 20) * MIN),
      seed: toSeed(input.seed),
    };
  }

  // --- allowed windows -----------------------------------------------------
  // Local wall-clock hour `h` (may be fractional) on a local calendar day.
  // Building the Date from local fields keeps this correct across DST changes.
  function localTime(y, m, d, h) {
    return new Date(y, m, d, Math.floor(h), Math.round((h % 1) * 60)).getTime();
  }
  // The allowed window that opens on local day (y, m, d), or null if that
  // weekday is excluded. A wrapping window belongs to the day it opens on.
  function dayWindow(y, m, d, hours, days) {
    if (Array.isArray(days) && !days.includes(new Date(y, m, d).getDay())) return null;
    const wraps = hours.end <= hours.start;
    return { start: localTime(y, m, d, hours.start), end: localTime(y, m, wraps ? d + 1 : d, hours.end) };
  }

  function isWithinHours(ts, hours, days) {
    const h = { start: (hours && hours.start) ?? 9, end: (hours && hours.end) ?? 23 };
    const t = new Date(ts);
    for (const off of [-1, 0]) {
      const w = dayWindow(t.getFullYear(), t.getMonth(), t.getDate() + off, h, days);
      if (w && ts >= w.start && ts < w.end) return true;
    }
    return false;
  }

  // Most sitting time a stretch of `len` ms can hold: full-length sittings
  // separated by minimum gaps, plus a shorter last one if it is worth having.
  function capacity(len, c) {
    const k = Math.floor((len + c.gap) / (c.maxLen + c.gap));
    const rest = len - k * (c.maxLen + c.gap);
    return k * c.maxLen + (rest >= c.minPiece ? rest : 0);
  }

  // Allowed windows clipped to [from, to]. Each window starts at least one gap
  // after the previous one, so windows can be filled independently.
  function listWindows(c, from, to) {
    const first = new Date(from);
    const out = [];
    for (let i = -1; i <= MAX_DAYS; i++) {
      const y = first.getFullYear();
      const m = first.getMonth();
      const d = first.getDate() + i;
      if (new Date(y, m, d).getTime() >= to) break;
      const w = dayWindow(y, m, d, c.hours, c.days);
      if (!w) continue;
      const prev = out[out.length - 1];
      const start = Math.max(w.start, from, prev ? prev.end + c.gap : from);
      const end = Math.min(w.end, to);
      if (end <= start) continue;
      const cap = capacity(end - start, c);
      // `soft` is the capacity when the window is used politely: sittings of
      // regular length, at most MAX_PER_DAY of them.
      const soft = cap >= c.minLen ? Math.min(cap, MAX_PER_DAY * c.maxLen) : 0;
      out.push({ start, end, cap, soft });
    }
    return out;
  }

  // --- building blocks -----------------------------------------------------
  // Split `target` over items in proportion to `weights`, never above `caps`.
  // Returns null when the caps cannot hold the target.
  function allocate(target, weights, caps) {
    if (sum(caps) < target) return null;
    const out = caps.map(() => 0);
    let active = caps.map((_, i) => i).filter((i) => caps[i] > 0 && weights[i] > 0);
    let left = target;
    while (active.length) {
      const total = sum(active.map((i) => weights[i]));
      const full = active.filter((i) => (left * weights[i]) / total >= caps[i]);
      if (!full.length) {
        for (const i of active) out[i] = (left * weights[i]) / total;
        break;
      }
      for (const i of full) {
        out[i] = caps[i];
        left -= caps[i];
      }
      active = active.filter((i) => !full.includes(i));
    }
    return out;
  }

  // Split `total` ms into `k` uneven integer parts, each within [lo, hi].
  // Requires k * lo <= total <= k * hi.
  function split(r, total, k, lo, hi) {
    let parts = Array.from({ length: k }, () => 0.6 + 0.8 * r());
    const scale = total / sum(parts);
    parts = parts.map((p) => clamp(p * scale, lo, hi));
    for (let i = 0; i < k; i++) {
      const diff = total - sum(parts);
      if (Math.abs(diff) < 1e-6) break;
      const free = parts.map((_, j) => j).filter((j) => (diff > 0 ? parts[j] < hi : parts[j] > lo));
      parts = parts.map((p, j) => (free.includes(j) ? clamp(p + diff / free.length, lo, hi) : p));
    }
    parts = parts.map(Math.floor);
    for (let j = 0, d = total - sum(parts); d > 0; j = (j + 1) % k) {
      if (parts[j] < hi) {
        parts[j]++;
        d--;
      }
    }
    return parts;
  }

  // Lay sittings of the given lengths into a window. `lead[i]` is the idle
  // time before sitting i, on top of the minimum gap between sittings.
  function place(w, lengths, lead, gap) {
    const out = [];
    let t = w.start;
    lengths.forEach((len, i) => {
      t += lead[i];
      out.push({ start: t, end: t + len, budgetMs: len });
      t += len + gap;
    });
    return out;
  }

  // Best effort when the work cannot fit: pack every window to capacity.
  function fillAll(c, windows) {
    const out = [];
    for (const w of windows) {
      const lengths = [];
      for (let left = w.cap; left > 0; left -= c.maxLen) lengths.push(Math.min(left, c.maxLen));
      out.push(...place(w, lengths, lengths.map(() => 0), c.gap));
    }
    return out;
  }

  // How much of the budget each window gets. Tries the polite layouts first:
  // a spread-out subset of windows, then all windows, then every last minute.
  function budgets(c, r, windows, required) {
    const usable = windows.map((_, i) => i).filter((i) => windows[i].soft > 0);
    const startsNow = usable.length > 0 && windows[usable[0]].start === c.now;
    const count = Math.max(1, Math.round(required / lerp(c.minLen, c.maxLen, 0.4 + 0.2 * r())));
    const k = Math.min(count, usable.length);

    // One window per stratum keeps the sittings spread over the whole span;
    // min(r, r) leans each pick, and the weights below, toward the earlier side.
    const chosen = new Set();
    for (let j = 0; j < k; j++) {
      const lo = Math.floor((j * usable.length) / k);
      const hi = Math.floor(((j + 1) * usable.length) / k);
      const pick = lo + Math.floor(Math.min(r(), r()) * (hi - lo));
      chosen.add(usable[j === 0 && startsNow ? 0 : pick]);
    }
    const weights = windows.map((_, i) => lerp(1.25, 0.75, i / Math.max(1, windows.length - 1)) * (0.8 + 0.4 * r()));
    const soft = windows.map((w) => w.soft);
    const hard = windows.map((w) => w.cap);

    const b =
      allocate(required, weights, soft.map((s, i) => (chosen.has(i) ? s : 0))) ||
      allocate(required, weights, soft) ||
      allocate(required, weights, hard);
    // Whole milliseconds, no sitting below the minimum length if it can be helped.
    const out = b.map((x, i) => (x > 0 ? Math.min(hard[i], Math.max(Math.ceil(x), c.minLen)) : 0));
    for (let i = 0, short = required - sum(out); short > 0 && i < out.length; i++) {
      const add = Math.min(short, hard[i] - out[i]);
      out[i] += add;
      short -= add;
    }
    return out;
  }

  // Turn one window's budget into irregular sittings inside that window.
  function sittings(c, r, w, budget) {
    const len = w.end - w.start;
    const kMin = Math.ceil(budget / c.maxLen);
    const kRoom = c.gap > 0 ? Math.floor((len - budget) / c.gap) + 1 : Infinity;
    const kMax = Math.max(kMin, Math.min(kRoom, Math.floor(budget / c.minLen), MAX_PER_DAY));
    const k = clamp(Math.round(budget / lerp(c.minLen, c.maxLen, 0.3 + 0.5 * r())), kMin, kMax);
    const lengths = split(r, budget, k, Math.min(c.minLen, Math.floor(budget / k)), c.maxLen);

    // Scatter the idle time before, between and after the sittings. When the
    // window opens at `now` the first sitting starts right away.
    const idle = len - budget - (k - 1) * c.gap;
    const cuts = Array.from({ length: k + 1 }, () => r());
    if (w.start === c.now) cuts[0] = 0;
    const total = sum(cuts) || 1;
    return place(w, lengths, lengths.map((_, i) => Math.floor((idle * cuts[i]) / total)), c.gap);
  }

  // --- public API ----------------------------------------------------------
  function planSessions(input) {
    const c = normalize(input);
    const requiredMs = Math.ceil(c.workMs * SLACK);
    const fail = (reason, sessions, availableMs) => ({
      feasible: false,
      sessions,
      totalBudgetMs: availableMs,
      reason,
      availableMs,
      requiredMs,
    });
    if (!(c.deadline > c.now)) return fail('deadline_passed', [], 0);

    // Safety margin before the deadline: 5% of the span, 10 min to 2 h.
    const span = c.deadline - c.now;
    const to = c.deadline - Math.round(clamp(span * 0.05, 10 * MIN, 120 * MIN));
    if (to <= c.now) return fail('not_enough_time', [], 0);

    const windows = listWindows(c, c.now, to);
    if (!windows.length) return fail('no_allowed_window', [], 0);
    const availableMs = sum(windows.map((w) => w.cap));
    if (availableMs < requiredMs) return fail('not_enough_time', fillAll(c, windows), availableMs);
    if (requiredMs === 0) return { feasible: true, sessions: [], totalBudgetMs: 0, availableMs, requiredMs };

    const r = rng32(c.seed);
    const sessions = [];
    budgets(c, r, windows, requiredMs).forEach((budget, i) => {
      if (budget > 0) sessions.push(...sittings(c, r, windows[i], budget));
    });
    return { feasible: true, sessions, totalBudgetMs: sum(sessions.map((s) => s.budgetMs)), availableMs, requiredMs };
  }

  // Plan the remaining work again from a new `now` (after sleep, a missed or
  // over-run sitting), with a fresh seed so the old pattern is not repeated.
  function replan(input, state) {
    return planSessions({
      ...input,
      workMs: state.remainingWorkMs,
      now: state.now,
      seed: mixSeed(input.seed, state.now),
    });
  }

  // The sitting in progress, or the next upcoming one.
  function nextSession(sessions, now) {
    return sessions.find((s) => s.end > now) || null;
  }

  function summarize(sessions) {
    const perDay = [];
    for (const s of sessions) {
      const t = new Date(s.start);
      const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      let day = perDay[perDay.length - 1];
      if (!day || day.dayStart !== dayStart) perDay.push((day = { dayStart, count: 0, budgetMs: 0 }));
      day.count++;
      day.budgetMs += s.budgetMs;
    }
    return {
      count: sessions.length,
      firstStart: sessions.length ? sessions[0].start : null,
      lastEnd: sessions.length ? sessions[sessions.length - 1].end : null,
      totalBudgetMs: sum(sessions.map((s) => s.budgetMs)),
      perDay,
    };
  }

  const api = { planSessions, replan, nextSession, isWithinHours, summarize };
  root.HumanTyperScheduler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
