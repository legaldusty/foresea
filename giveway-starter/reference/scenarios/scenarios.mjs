import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const { buildHarbor } = await import(`${ROOT}/src/engine/harbor.js`);
const { nearestWater } = await import(`${ROOT}/src/engine/grid.js`);
const { createTell, observe, topGoal, predictedPath, evasiveness, LOST } = await import(`${ROOT}/src/engine/tell.js`);
const { rng } = await import(`${ROOT}/src/engine/bench.js`);

const h = buildHarbor(JSON.parse(fs.readFileSync(`${ROOT}/src/data/harbor_grid.json`)), JSON.parse(fs.readFileSync(`${ROOT}/src/data/harbor.json`)));
const G = h.grid, CELL = G.cellMeters;
const T_IDS = h.targets.map((t) => t.id);

const CONSEQ = { cruise: [5, 2, 3, 2], cruiseEmpty: [2, 2, 3, 2], research: [1, 1, 1, 1], pier400: [1, 3, 5, 3], fuel: [2, 5, 4, 5], ferry: [4, 2, 2, 2], islands: [2, 5, 3, 5] };
const W = [0.4, 0.3, 0.2, 0.1];
const conseq = (id, cruiseDocked) => { const v = CONSEQ[id === 'cruise' && !cruiseDocked ? 'cruiseEmpty' : id]; return v.reduce((s, x, i) => s + x * W[i], 0) / 5; };
const sizeF = (m) => m < 0.5 ? 0.15 : m < 2 ? 0.40 : m < 6 ? 0.75 : 1.0;
const speedF = (v, powered) => !powered ? 0.3 : v < 0.3 ? 0.3 : v < 1.5 ? 0.7 : v <= 3 ? 0.9 : 1.0;
const Lband = (x) => x < 0.10 ? 1 : x < 0.25 ? 2 : x < 0.45 ? 3 : x < 0.65 ? 4 : 5;
const Sband = (x) => x < 0.08 ? 1 : x < 0.18 ? 2 : x < 0.32 ? 3 : x < 0.50 ? 4 : 5;
const LEVELS = ['Low', 'Medium', 'Serious', 'High', 'Critical'];
const levelOf = (r) => r <= 4 ? 0 : r <= 9 ? 1 : r <= 14 ? 2 : r <= 19 ? 3 : 4;
const SECURITY = new Set(['fuel', 'islands', 'cruise', 'ferry']);

function stepToward(D, cell, rand, sloppy) {
  const nb = G.neighbors[cell]; let best = -1, bs = Infinity;
  for (let k = 0; k < nb.length; k += 2) { const s = nb[k + 1] + D[nb[k]] + sloppy * 2.5 * rand(); if (s < bs) { bs = s; best = nb[k]; } }
  return best;
}
function stepDrift(cell, rand, dir) {
  const nb = G.neighbors[cell]; const [x, y] = G.xy(cell); let best = -1, bs = -Infinity;
  for (let k = 0; k < nb.length; k += 2) { const [X, Y] = G.xy(nb[k]); const s = (X - x) * dir[0] + (Y - y) * dir[1] + 2.2 * rand(); if (s > bs) { bs = s; best = nb[k]; } }
  return best;
}
const at = (lon, lat) => { const [x, y] = G.toCell(lon, lat); return nearestWater(G, x, y, 30); };
const tid = (id) => T_IDS.indexOf(id);

const SCEN = [
  { key: 'A', name: 'The straight shot', desc: '2.5 m powered vehicle, hot motor, no reply to ID pings, at night. Enters through Angels Gate and heads for the Fuel Pier.',
    start: at(-118.2490, 33.7000), size: 2.5, speed: 2.0, heat: 'hot', reply: 'none', night: true, cruiseDocked: true,
    plan: [{ goal: 'fuel', sloppy: 0.3 }], seed: 11,
    expect: [{ until: 'detect', level: 1, why: 'Unknown powered vehicle entering at night: ask' }, { until: 'clear', level: 3, why: 'Clearly aiming at fuel: prepare to hold' }, { until: 'end', level: 4, why: 'Under 10 min from fuel: hand off' }] },
  { key: 'B', name: 'The fake-out', desc: '1.5 m powered vehicle, no reply, at night. Enters through Queens Gate, fakes toward the Oil Islands, then turns for the Cruise Terminal (ship docked).',
    start: at(-118.1860, 33.7120), size: 1.5, speed: 1.5, heat: 'hot', reply: 'none', night: true, cruiseDocked: true,
    plan: [{ goal: 'islands', sloppy: 0.3, untilNear: 6 }, { goal: 'cruise', sloppy: 0.3 }], seed: 5,
    expect: [{ until: 'detect', level: 1, why: 'Unknown, just detected: ask' }, { until: 'turn', level: 2, why: 'Small vehicle heading for oil islands: give way' }, { until: 'last10', level: 2, why: 'Heading for a docked cruise ship: give way' }, { until: 'end', level: 3, why: 'Last 10 min to a ship full of people: hold' }] },
  { key: 'C', name: 'The lost glider', desc: 'Registered research glider that stopped reporting. Cold, drifting slowly with the current near the Research Dock.',
    start: at(-118.2660, 33.7230), size: 1.8, speed: 0.2, heat: 'ambient', reply: 'registeredSilent', night: false, cruiseDocked: true,
    plan: [{ drift: [0.6, 0.8], minutes: 60 }], seed: 3,
    expect: [{ until: 'end', level: 0, why: 'Lost, not hostile: log, tell the lab' }] },
  { key: 'D', name: 'The tiny drone', desc: '0.4 m micro vehicle, hot motor, no reply, daytime. Comes in through Angels Gate and heads for the Research Dock.',
    start: at(-118.2490, 33.7000), size: 0.4, speed: 1.0, heat: 'hot', reply: 'none', night: false, cruiseDocked: true,
    plan: [{ goal: 'research', sloppy: 0.3 }], seed: 8,
    expect: [{ until: 'end', level: 1, why: 'Tiny payload, low-value target: ask and watch, never move boats' }] },
  { key: 'E', name: 'Late detection', desc: '5 m powered vehicle at 3.5 m/s, no reply, at night. First seen just inside Angels Gate, a few minutes from the container ship at Pier 400.',
    start: at(-118.2560, 33.7110), size: 5.0, speed: 3.5, heat: 'hot', reply: 'none', night: true, cruiseDocked: true,
    plan: [{ goal: 'pier400', sloppy: 0.2 }], seed: 2,
    expect: [{ until: 'detect', level: 3, why: 'Big, fast, close to a ship: high right away' }, { until: 'end', level: 4, why: 'Minutes away: hand off' }] },
];

const FIX = process.argv.includes('--fix');
export function proximityPrior(T, start, secPerCell, power = 2) {
  const n = T.fields.length, lost = T.prior[n];
  const dmin = Math.min(...T.fields.map((D) => D[start]));
  const w = T.fields.map((D) => Math.pow(dmin / D[start], power));
  const s = w.reduce((a, b) => a + b, 0);
  for (let g = 0; g < n; g++) T.prior[g] = (1 - lost) * w[g] / s;
  T.post = Float64Array.from(T.prior);
}
function run(s) {
  const rand = rng(s.seed);
  const T = createTell(G, h.targets);
  const secPerCell = CELL / s.speed;
  if (FIX) proximityPrior(T, s.start, secPerCell);
  const powered = s.heat === 'hot';
  const K = sizeF(s.size) * speedF(s.speed, powered);
  const kind = s.heat === 'hot' ? 'Powered unknown' : s.heat === 'ambient' ? 'Debris / dead robot' : 'Animal';
  let cell = s.start, t = 0, phaseIdx = 0, steps = 0, turnStep = null;
  const startCell = s.start, recs = [], track = [cell];
  let shown = 0, belowSince = null, loiterSince = null, peak = 0;
  const trueGoal = s.plan.at(-1).goal ? tid(s.plan.at(-1).goal) : -1;
  const record = () => {
    const n = T.fields.length;
    const odds = Array.from(T.post.slice(0, n)); const lost = T.post[n];
    let H, ev = [];
    if (s.reply === 'friendly') { H = 0.02; ev.push('friendly'); }
    else {
      H = s.reply === 'registeredSilent' ? 0.25 : 0.5;
      if (s.reply === 'none' && t >= 2) { H += 0.15; ev.push('no reply'); }
      if (s.reply === 'spoof') { H += 0.30; ev.push('spoofed ID'); }
      if (T.steps >= 3 && lost < 0.20) { H += 0.10; ev.push('aiming'); }
      if (lost > 0.50) { H -= 0.20; ev.push('lost-looking'); }
      if (evasiveness(T, startCell, cell) > 1.5 && T.steps > 10) { H += 0.10; ev.push('evasive'); }
      const nearAny = T_IDS.some((id, g) => T.fields[g][cell] <= 4);
      if (nearAny) { loiterSince ??= t; if (t - loiterSince > 5) { H += 0.10; ev.push('loitering'); } } else loiterSince = null;
      if (T_IDS.some((id, g) => SECURITY.has(id) && T.fields[g][cell] <= 6)) { H += 0.10; ev.push('security zone'); }
      if (s.night) { H += 0.05; ev.push('night, no plan'); }
      if (s.heat === 'ambient') { H = 0.05; ev.push('classified debris/dead robot'); }
      H = Math.min(0.98, Math.max(0.02, H));
    }
    let best = { R: 0 };
    const perT = T_IDS.map((id, g) => {
      const like = H * odds[g], sev = K * conseq(id, s.cruiseDocked);
      const L = Lband(like), S = Sband(sev), R = L * S;
      const r = { id, p: odds[g], L, S, R, like, sev };
      if (R > best.R || (R === best.R && odds[g] > (best.p ?? 0))) best = r;
      return r;
    });
    if (FIX) {
      const sorted = perT.slice().sort((a, b) => b.p - a.p), a = sorted[0], b = sorted[1];
      if (b && b.p >= 0.2) {
        const L = Lband(H * (a.p + b.p)), S = Math.max(a.S, b.S), R = L * S;
        if (R > best.R) best = { id: a.S >= b.S ? a.id : b.id, p: a.p + b.p, L, S, R, zone: true };
      }
    }
    const top = topGoal(T);
    const etaTop = top.goal === LOST ? null : T.fields[top.goal][cell] * secPerCell / 60;
    let lvl = levelOf(best.R);
    const urgent = top.goal !== LOST && top.p >= 0.4 && etaTop !== null && etaTop < 10 && s.heat !== 'ambient' && (!FIX || best.S >= 3);
    if (urgent) lvl = Math.min(4, lvl + 1);
    if (FIX && lvl === 4 && !(etaTop !== null && etaTop <= 30)) lvl = 3;
    if (FIX && peak >= 3 && s.reply !== 'friendly') lvl = Math.max(lvl, 2);
    if (lvl >= shown) { shown = lvl; belowSince = null; } else { belowSince ??= t; if (t - belowSince >= 2) { shown = lvl; belowSince = null; } }
    peak = Math.max(peak, shown);
    const etaTrue = trueGoal >= 0 ? T.fields[trueGoal][cell] * secPerCell / 60 : null;
    recs.push({ t: +t.toFixed(2), cell, xy: G.xy(cell), odds: odds.map((v) => +v.toFixed(4)), lost: +lost.toFixed(4), H: +H.toFixed(2), ev, K: +K.toFixed(3),
      riskTarget: best.id, R: best.R, L: best.L, S: best.S, rawLevel: levelOf(best.R), urgent, level: shown,
      top: top.goal === LOST ? 'lost' : T_IDS[top.goal], topP: +top.p.toFixed(3), etaTopMin: etaTop && +etaTop.toFixed(1), etaTrueMin: etaTrue && +etaTrue.toFixed(1),
      call: T.call ? T_IDS[T.call.goal] : null, turned: turnStep !== null });
  };
  record();
  for (const leg of s.plan) {
    if (leg.drift) {
      const n = Math.round(leg.minutes * 60 / secPerCell);
      for (let i = 0; i < n; i++) { const nx = stepDrift(cell, rand, leg.drift); observe(T, cell, nx); cell = nx; t += secPerCell / 60; track.push(cell); record(); }
      continue;
    }
    const D = T.fields[tid(leg.goal)];
    let guard = 0;
    while (D[cell] > (leg.untilNear ?? 1.5) && guard++ < 4000) {
      const nx = stepToward(D, cell, rand, leg.sloppy); observe(T, cell, nx); cell = nx; t += secPerCell / 60; track.push(cell); record();
    }
    if (leg.untilNear) turnStep = recs.length - 1;
  }
  const snaps = [0.25, 0.5, 0.75].map((f) => {
    const i = Math.min(recs.length - 1, Math.round(f * (recs.length - 1))), r = recs[i];
    const tg = topGoal({ ...T, post: Float64Array.from([...r.odds, r.lost]), fields: T.fields });
    const path = tg.goal === LOST ? [] : predictedPath(T, tg.goal, r.cell).map((c) => G.xy(c));
    return { i, t: r.t, top: tg.goal === LOST ? 'lost' : T_IDS[tg.goal], p: tg.p, path };
  });
  let baseFrom = null;
  if (trueGoal >= 0) recs.forEach((r) => { let ng = 0, nd = Infinity; T.fields.forEach((D, g) => { if (D[r.cell] < nd) { nd = D[r.cell]; ng = g; } });
    if (ng === trueGoal) baseFrom ??= r.etaTrueMin; else baseFrom = null; });
  let tellFrom = null;
  if (trueGoal >= 0) recs.forEach((r) => { if (r.call === T_IDS[trueGoal]) tellFrom ??= r.etaTrueMin; else tellFrom = null; });
  return { key: s.key, name: s.name, desc: s.desc, size: s.size, speed: s.speed, heat: s.heat, kind, K, trueGoal: trueGoal >= 0 ? T_IDS[trueGoal] : null,
    decoy: s.plan.length > 1 ? s.plan[0].goal : null, turnIdx: turnStep, expect: s.expect, recs, track: track.map((c) => G.xy(c)), snaps,
    tellWarnMin: tellFrom, baseWarnMin: baseFrom, totalMin: recs.at(-1).t };
}

const out = { grid: { nx: G.nx, ny: G.ny, water: Array.from(G.water) }, targets: h.targets.map((t) => ({ id: t.id, name: t.name, xy: G.xy(t.cell) })),
  levels: LEVELS, scenarios: SCEN.map(run) };
fs.writeFileSync(new URL(FIX ? './results_fix.json' : './results.json', import.meta.url), JSON.stringify(out));
for (const s of out.scenarios) {
  console.log(`\n== ${s.key}. ${s.name}  (${s.kind}, K=${s.K.toFixed(2)}, trip ${s.totalMin.toFixed(1)} min)`);
  console.log(`   TELL locked on true target with ${s.tellWarnMin ?? '-'} min to go | nearest-dock guess: ${s.baseWarnMin ?? '-'} min`);
  const pick = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((f) => s.recs[Math.round(f * (s.recs.length - 1))]);
  for (const r of pick) console.log(`   t=${String(r.t).padStart(5)}m top=${r.top.padEnd(8)} ${(r.topP*100).toFixed(0).padStart(3)}% lost=${(r.lost*100).toFixed(0).padStart(3)}% H=${r.H} R=${String(r.R).padStart(2)} (${r.riskTarget} L${r.L}xS${r.S})${r.urgent?' +urgent':''} -> ${LEVELS[r.level].padEnd(8)} eta=${r.etaTopMin ?? '-'} call=${r.call ?? '-'} [${r.ev.join(', ')}]`);
}
