import { createTell, observe, resetTell, topGoal, LOST } from './tell.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function step(grid, D, cell, rand, sloppy) {
  const nb = grid.neighbors[cell]; let best = -1, bestScore = Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const j = nb[k], score = nb[k + 1] + D[j] + sloppy * 2.5 * rand();
    if (score < bestScore) { bestScore = score; best = j; }
  }
  return best;
}

export const STYLES = {
  direct: { sloppy: 0.15, decoy: false },
  sloppy: { sloppy: 0.9, decoy: false },
  decoy:  { sloppy: 0.3, decoy: true },
};

export function runNights(h, { nights = 1000, seed = 7, speedMps = 1.0, tellOpts = {}, onProgress } = {}) {
  const rand = rng(seed);
  const T = createTell(h.grid, h.targets, tellOpts);
  const cellM = h.grid.cellMeters;
  const res = [];
  const styleNames = Object.keys(STYLES);
  for (let n = 0; n < nights; n++) {
    const style = styleNames[n % styleNames.length], S = STYLES[style];
    const goal = Math.floor(rand() * h.targets.length);
    const spawn = h.spawns[Math.floor(rand() * h.spawns.length)].cell;
    let decoyGoal = -1, decoyUntil = 0;
    if (S.decoy) { do { decoyGoal = Math.floor(rand() * h.targets.length); } while (decoyGoal === goal);
      decoyUntil = 0.35 + 0.3 * rand(); }
    const Dtrue = T.fields[goal], total = Dtrue[spawn];
    resetTell(T);
    let cell = spawn, guard = 0, decoyDone = !S.decoy;
    let tellRightFrom = null, tellWrongCalls = 0, lastCall = null;
    let baseRightFrom = null;
    while (Dtrue[cell] > 1.5 && guard++ < 3000) {
      if (!decoyDone && (T.fields[decoyGoal][cell] <= 3 || guard > decoyUntil * total * 1.4)) decoyDone = true;
      const usingDecoy = !decoyDone;
      const D = usingDecoy ? T.fields[decoyGoal] : Dtrue;
      const next = step(h.grid, D, cell, rand, S.sloppy);
      if (next < 0) break;
      observe(T, cell, next); cell = next;
      if (T.call && T.call !== lastCall) { lastCall = T.call; if (T.call.goal !== goal) tellWrongCalls++; }
      const tellRight = T.call && T.call.goal === goal;
      if (tellRight && tellRightFrom === null) tellRightFrom = Dtrue[cell];
      if (!tellRight) tellRightFrom = null;
      let nearest = 0, nd = Infinity;
      for (let g = 0; g < T.fields.length; g++) if (T.fields[g][cell] < nd) { nd = T.fields[g][cell]; nearest = g; }
      if (nearest === goal) { if (baseRightFrom === null) baseRightFrom = Dtrue[cell]; } else baseRightFrom = null;
    }
    const toMin = (cells) => cells === null ? 0 : (cells * cellM) / speedMps / 60;
    res.push({ style, goal, tellMin: toMin(tellRightFrom), baseMin: toMin(baseRightFrom),
      tellCorrect: tellRightFrom !== null, wrongCalls: tellWrongCalls, totalMin: toMin(total) });
    if (onProgress && n % 50 === 0) onProgress(n / nights);
  }
  return summarize(res);
}

function summarize(res) {
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const by = (filter) => {
    const r = res.filter(filter);
    return {
      nights: r.length,
      tellWarnMin: avg(r.map((x) => x.tellMin)),
      baseWarnMin: avg(r.map((x) => x.baseMin)),
      tellCalledRight: r.filter((x) => x.tellCorrect).length / (r.length || 1),
      wrongCallsPerNight: avg(r.map((x) => x.wrongCalls)),
      tripMin: avg(r.map((x) => x.totalMin)),
    };
  };
  return { all: by(() => true), direct: by((x) => x.style === 'direct'), sloppy: by((x) => x.style === 'sloppy'), decoy: by((x) => x.style === 'decoy') };
}
