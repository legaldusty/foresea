import { nearestWater } from './grid';
import { targetIndex, type Harbor } from './harbor';
import { capability, cellsToNearest, classify, createLoiterClock, evidenceCells, hostility, isSecurityKind, type EvidenceItem, type EvidenceKey, type Heat, type ReplyStatus } from './identify';
import { createRiskTracker, CRITICAL, HIGH, LEVELS, LOW, MEDIUM, SERIOUS, type RuleFiring } from './risk';
import { defaultSettings, type Settings } from './settings';
import {
  createTell, DRIFT, driftOdds, evasiveness, isTargetGoal, lostOdds, lostOnlyOdds, observe, predictedPath, proximityPrior,
  targetOdds, tellDefaults, topGoal, type CurrentVector, type MoveContext, type TellState,
} from './tell';
import { rng } from './bench';

export type IncidentKey = 'A' | 'B' | 'C' | 'D' | 'E';
export type ScenarioMode = 'final' | 'reference';

export interface TowardLeg {
  goal: string;
  sloppy: number;
  untilNear?: number;
}

export interface DriftLeg {
  drift: [number, number];
  minutes: number;
}

export type Leg = TowardLeg | DriftLeg;

export interface ExpectStep {
  until: string;
  level: number;
  why: string;
}

export interface IncidentSpec {
  key: IncidentKey;
  name: string;
  desc: string;
  lon: number;
  lat: number;
  size: number;
  speed: number;
  heat: Heat;
  reply: ReplyStatus;
  night: boolean;
  cruiseDocked: boolean;
  plan: Leg[];
  seed: number;
  expect: ExpectStep[];
}

export const INCIDENTS: IncidentSpec[] = [
  {
    key: 'A', name: 'The straight shot',
    desc: '2.5 m powered vehicle, hot motor, no reply to ID pings, at night. Enters through Angels Gate and heads for the Fuel Pier.',
    lon: -118.2490, lat: 33.7000, size: 2.5, speed: 2.0, heat: 'hot', reply: 'none', night: true, cruiseDocked: true,
    plan: [{ goal: 'fuel', sloppy: 0.3 }], seed: 11,
    expect: [
      { until: 'detect', level: MEDIUM, why: 'Unknown powered vehicle entering at night: ask' },
      { until: 'clear', level: HIGH, why: 'Clearly aiming at fuel: prepare to hold' },
      { until: 'end', level: CRITICAL, why: 'Under 10 min from fuel: hand off' },
    ],
  },
  {
    key: 'B', name: 'The fake-out',
    desc: '1.5 m powered vehicle, no reply, at night. Enters through Queens Gate, fakes toward the Oil Islands, then turns for the Cruise Terminal (ship docked).',
    lon: -118.1860, lat: 33.7120, size: 1.5, speed: 1.5, heat: 'hot', reply: 'none', night: true, cruiseDocked: true,
    plan: [{ goal: 'islands', sloppy: 0.3, untilNear: 6 }, { goal: 'cruise', sloppy: 0.3 }], seed: 5,
    expect: [
      { until: 'detect', level: MEDIUM, why: 'Unknown, just detected: ask' },
      { until: 'turn', level: SERIOUS, why: 'Small vehicle heading for oil islands: give way' },
      { until: 'last10', level: SERIOUS, why: 'Heading for a docked cruise ship: give way' },
      { until: 'end', level: HIGH, why: 'Last 10 min to a ship full of people: hold' },
    ],
  },
  {
    key: 'C', name: 'The lost glider',
    desc: 'Registered research glider that stopped reporting. Cold, drifting slowly with the current near the Research Dock.',
    lon: -118.2660, lat: 33.7230, size: 1.8, speed: 0.2, heat: 'ambient', reply: 'registeredSilent', night: false, cruiseDocked: true,
    plan: [{ drift: [0.6, 0.8], minutes: 60 }], seed: 3,
    expect: [{ until: 'end', level: LOW, why: 'Lost, not hostile: log, tell the lab' }],
  },
  {
    key: 'D', name: 'The tiny drone',
    desc: '0.4 m micro vehicle, hot motor, no reply, daytime. Comes in through Angels Gate and heads for the Research Dock.',
    lon: -118.2490, lat: 33.7000, size: 0.4, speed: 1.0, heat: 'hot', reply: 'none', night: false, cruiseDocked: true,
    plan: [{ goal: 'research', sloppy: 0.3 }], seed: 8,
    expect: [{ until: 'end', level: MEDIUM, why: 'Tiny payload, low-value target: ask and watch, never move boats' }],
  },
  {
    key: 'E', name: 'Late detection',
    desc: '5 m powered vehicle at 3.5 m/s, no reply, at night. First seen just inside Angels Gate, a few minutes from the container ship at Pier 400.',
    lon: -118.2560, lat: 33.7110, size: 5.0, speed: 3.5, heat: 'hot', reply: 'none', night: true, cruiseDocked: true,
    plan: [{ goal: 'pier400', sloppy: 0.2 }], seed: 2,
    expect: [
      { until: 'detect', level: HIGH, why: 'Big, fast, close to a ship: high right away' },
      { until: 'end', level: CRITICAL, why: 'Minutes away: hand off' },
    ],
  },
];

export const INCIDENT_KEYS: IncidentKey[] = INCIDENTS.map((s) => s.key);

export interface ScenarioOptions {
  withCurrent?: boolean;
  mode?: ScenarioMode;
}

export interface ScenarioRecord {
  t: number;
  cell: number;
  xy: [number, number];
  odds: number[];
  lost: number;
  drift: number;
  lostOdds: number;
  H: number;
  ev: EvidenceKey[];
  evidence: EvidenceItem[];
  K: number;
  riskTarget: string;
  R: number;
  L: number;
  S: number;
  rawLevel: number;
  urgent: boolean;
  level: number;
  rules: RuleFiring[];
  top: string;
  topP: number;
  etaTopMin: number | null;
  etaTrueMin: number | null;
  call: string | null;
  turned: boolean;
}

export interface ScenarioSnap {
  i: number;
  t: number;
  top: string;
  p: number;
  path: [number, number][];
}

export interface ScenarioResult {
  key: IncidentKey;
  name: string;
  desc: string;
  size: number;
  speed: number;
  heat: Heat;
  kind: string;
  K: number;
  mode: ScenarioMode;
  withCurrent: boolean;
  trueGoal: string | null;
  decoy: string | null;
  turnIdx: number | null;
  expect: ExpectStep[];
  recs: ScenarioRecord[];
  track: [number, number][];
  snaps: ScenarioSnap[];
  tellWarnMin: number | null;
  baseWarnMin: number | null;
  totalMin: number;
}

const SECONDS_PER_MINUTE = 60;
const SNAP_FRACTIONS = [0.25, 0.5, 0.75];

function isDriftLeg(leg: Leg): leg is DriftLeg {
  return 'drift' in leg;
}

function round(value: number, digits: number): number {
  return +value.toFixed(digits);
}

function roundEta(value: number | null): number | null {
  return value === null ? null : round(value, 1);
}

export function incident(key: IncidentKey): IncidentSpec {
  const spec = INCIDENTS.find((s) => s.key === key);
  if (!spec) throw new Error(`Unknown incident ${key}`);
  return spec;
}

export function scenarioCurrent(settings: Settings = defaultSettings): CurrentVector {
  const { gridDirection, speedMps } = settings.scenarios.current;
  const [gx, gy] = gridDirection;
  const length = Math.hypot(gx, gy);
  return { currentU: speedMps * gx / length, currentV: -speedMps * gy / length };
}

function goalName(goal: number, ids: string[]): string {
  if (isTargetGoal(goal)) return ids[goal];
  return goal === DRIFT ? 'drift' : 'lost';
}

function stepToward(h: Harbor, D: Float32Array, cell: number, rand: () => number, sloppy: number, noise: number): number {
  const nb = h.grid.neighbors[cell];
  let best = -1;
  let bs = Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const s = nb[k + 1] + D[nb[k]] + sloppy * noise * rand();
    if (s < bs) { bs = s; best = nb[k]; }
  }
  return best;
}

function stepDrift(h: Harbor, cell: number, rand: () => number, dir: [number, number], noise: number): number {
  const G = h.grid;
  const nb = G.neighbors[cell];
  const [x, y] = G.xy(cell);
  let best = -1;
  let bs = -Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const [X, Y] = G.xy(nb[k]);
    const s = (X - x) * dir[0] + (Y - y) * dir[1] + noise * rand();
    if (s > bs) { bs = s; best = nb[k]; }
  }
  return best;
}

function nearestTarget(fields: Float32Array[], cell: number): number {
  let ng = 0;
  let nd = Infinity;
  fields.forEach((D, g) => { if (D[cell] < nd) { nd = D[cell]; ng = g; } });
  return ng;
}

function lastGoal(spec: IncidentSpec): string | null {
  const leg = spec.plan[spec.plan.length - 1];
  return isDriftLeg(leg) ? null : leg.goal;
}

export function runScenario(key: IncidentKey, h: Harbor, settings: Settings = defaultSettings, options: ScenarioOptions = {}): ScenarioResult {
  const s = incident(key);
  const mode = options.mode ?? 'final';
  const finalRules = mode === 'final';
  const withCurrent = options.withCurrent ?? false;
  const sc = settings.scenarios;
  const G = h.grid;
  const ids = h.targets.map((t) => t.id);
  const rand = rng(s.seed);
  const current = withCurrent ? scenarioCurrent(settings) : null;
  const T = createTell(G, h.targets, { ...tellDefaults(settings), fields: h.fields, current });
  const [sx, sy] = G.toCell(s.lon, s.lat);
  const start = nearestWater(G, sx, sy, settings.harbor.placeSearchCells);
  const secPerCell = G.cellMeters / s.speed;
  const stepMinutes = secPerCell / SECONDS_PER_MINUTE;
  if (finalRules) proximityPrior(T, start);
  const moveContext: MoveContext = current ? { ...current, contactSpeedMps: s.speed } : {};

  const classification = classify({ speedMps: s.speed, heat: s.heat, sizeM: s.size, currentSpeedMps: current ? sc.current.speedMps : 0 }, settings);
  const powered = s.heat === 'hot';
  const K = capability(s.size, s.speed, powered, settings);
  const { loiterCells } = evidenceCells(G.cellMeters, settings);
  const securityGoal = (g: number) => isSecurityKind(h.targets[g].kind, settings);
  const loiter = createLoiterClock();
  const tracker = createRiskTracker(settings, { finalRules });
  const trueGoalId = lastGoal(s);
  const trueGoal = trueGoalId ? targetIndex(h, trueGoalId) : -1;

  let cell = start;
  let t = 0;
  let turnStep: number | null = null;
  const recs: ScenarioRecord[] = [];
  const track = [cell];

  const record = () => {
    const odds = targetOdds(T);
    const minutesNearTarget = loiter.update(t, cellsToNearest(T.fields, cell) <= loiterCells);
    const hostile = hostility({
      reply: s.reply,
      minutesSinceDetected: t,
      steps: T.steps,
      lostOdds: lostOdds(T),
      evasiveRatio: evasiveness(T, start, cell),
      minutesNearTarget,
      cellsToSecurityTarget: cellsToNearest(T.fields, cell, securityGoal),
      night: s.night,
      cellMeters: G.cellMeters,
      debris: classification.kind === 'debris',
    }, settings);
    const top = topGoal(T);
    const etaTop = isTargetGoal(top.goal) ? T.fields[top.goal][cell] * secPerCell / SECONDS_PER_MINUTE : null;
    const risk = tracker.update({
      t, H: hostile.H, K,
      targets: ids.map((id, g) => ({ id, odds: odds[g] })),
      top, etaTopMin: etaTop,
      cruiseDocked: s.cruiseDocked,
      ambient: s.heat === 'ambient',
      friendly: s.reply === 'friendly',
    });
    const etaTrue = trueGoal >= 0 ? T.fields[trueGoal][cell] * secPerCell / SECONDS_PER_MINUTE : null;
    recs.push({
      t: round(t, 2), cell, xy: G.xy(cell),
      odds: odds.map((v) => round(v, 4)), lost: round(lostOnlyOdds(T), 4), drift: round(driftOdds(T), 4), lostOdds: round(lostOdds(T), 4),
      H: round(hostile.H, 2), ev: hostile.items.filter((i) => i.key !== 'start').map((i) => i.key), evidence: hostile.items,
      K: round(K, 3),
      riskTarget: risk.best.id, R: risk.R, L: risk.best.L, S: risk.best.S, rawLevel: risk.rawLevel, urgent: risk.urgent, level: risk.level, rules: risk.rules,
      top: goalName(top.goal, ids), topP: round(top.p, 3), etaTopMin: roundEta(etaTop), etaTrueMin: roundEta(etaTrue),
      call: T.call ? ids[T.call.goal] : null, turned: turnStep !== null,
    });
  };

  const advance = (next: number) => {
    observe(T, cell, next, moveContext);
    cell = next;
    t += stepMinutes;
    track.push(cell);
    record();
  };

  record();
  for (const leg of s.plan) {
    if (isDriftLeg(leg)) {
      const n = Math.round(leg.minutes * SECONDS_PER_MINUTE / secPerCell);
      for (let i = 0; i < n; i++) advance(stepDrift(h, cell, rand, leg.drift, sc.driftNoise));
      continue;
    }
    const D = T.fields[targetIndex(h, leg.goal)];
    let guard = 0;
    while (D[cell] > (leg.untilNear ?? sc.arriveCells) && guard++ < sc.maxLegSteps) advance(stepToward(h, D, cell, rand, leg.sloppy, sc.towardNoise));
    if (leg.untilNear) turnStep = recs.length - 1;
  }

  const snaps = SNAP_FRACTIONS.map((f) => snapAt(T, recs, f, ids));
  const firstLeg = s.plan[0];
  return {
    key: s.key, name: s.name, desc: s.desc, size: s.size, speed: s.speed, heat: s.heat, kind: classification.label, K,
    mode, withCurrent,
    trueGoal: trueGoalId, decoy: s.plan.length > 1 && !isDriftLeg(firstLeg) ? firstLeg.goal : null,
    turnIdx: turnStep, expect: s.expect, recs, track: track.map((c) => G.xy(c)), snaps,
    tellWarnMin: trueGoal >= 0 ? warningFrom(recs, (r) => r.call === ids[trueGoal]) : null,
    baseWarnMin: trueGoal >= 0 ? warningFrom(recs, (r) => nearestTarget(T.fields, r.cell) === trueGoal) : null,
    totalMin: recs[recs.length - 1].t,
  };
}

function warningFrom(recs: ScenarioRecord[], right: (r: ScenarioRecord) => boolean): number | null {
  let from: number | null = null;
  for (const r of recs) {
    if (right(r)) from ??= r.etaTrueMin;
    else from = null;
  }
  return from;
}

function snapAt(T: TellState, recs: ScenarioRecord[], fraction: number, ids: string[]): ScenarioSnap {
  const i = Math.min(recs.length - 1, Math.round(fraction * (recs.length - 1)));
  const r = recs[i];
  const tg = topGoal({ fields: T.fields, post: Float64Array.from([...r.odds, r.lost, r.drift]) });
  const path = isTargetGoal(tg.goal) ? predictedPath(T, tg.goal, r.cell).map((c) => T.grid.xy(c)) : [];
  return { i, t: r.t, top: goalName(tg.goal, ids), p: tg.p, path };
}

export function runAllScenarios(h: Harbor, settings: Settings = defaultSettings, options: ScenarioOptions = {}): ScenarioResult[] {
  return INCIDENT_KEYS.map((key) => runScenario(key, h, settings, options));
}

export function runReferenceScenario(key: IncidentKey, h: Harbor, settings: Settings = defaultSettings, options: Omit<ScenarioOptions, 'mode'> = {}): ScenarioResult {
  return runScenario(key, h, settings, { ...options, mode: 'reference' });
}

const EXPECT_DETECT_MINUTES = 2;
const EXPECT_LAST_MINUTES = 10;

export function expectedLevel(key: IncidentKey, rec: Pick<ScenarioRecord, 't' | 'etaTrueMin' | 'turned'>): number {
  const { t } = rec;
  const eta = rec.etaTrueMin ?? Infinity;
  if (key === 'A') return t < EXPECT_DETECT_MINUTES ? MEDIUM : (eta >= EXPECT_LAST_MINUTES ? HIGH : CRITICAL);
  if (key === 'B') return t < EXPECT_DETECT_MINUTES ? MEDIUM : ((!rec.turned || eta >= EXPECT_LAST_MINUTES) ? SERIOUS : HIGH);
  if (key === 'C') return LOW;
  if (key === 'D') return MEDIUM;
  return t < EXPECT_DETECT_MINUTES ? HIGH : CRITICAL;
}

export interface Agreement {
  records: number;
  exact: number;
  withinOne: number;
  hotter: number;
}

export function agreement(result: Pick<ScenarioResult, 'key' | 'recs'>): Agreement {
  const n = result.recs.length;
  let exact = 0;
  let withinOne = 0;
  let hotter = 0;
  for (const r of result.recs) {
    const expected = expectedLevel(result.key, r);
    if (r.level === expected) exact++;
    if (Math.abs(r.level - expected) <= 1) withinOne++;
    if (r.level > expected) hotter++;
  }
  return { records: n, exact: exact / n, withinOne: withinOne / n, hotter: hotter / n };
}

export interface AcceptanceCheck {
  key: IncidentKey;
  rule: string;
  holds: boolean;
  detail: string;
}

const CRITICAL_FIRST_SIGHTING_MINUTES = 1;

function firstAtOrAfter(recs: ScenarioRecord[], minutes: number): number {
  const i = recs.findIndex((r) => r.t >= minutes);
  return i < 0 ? recs.length - 1 : i;
}

function checkA(r: ScenarioResult, settings: Settings): AcceptanceCheck[] {
  const firstHigh = r.recs.findIndex((x) => x.level >= HIGH);
  const pingWindowEnds = firstAtOrAfter(r.recs, settings.evidenceRules.noReplyAfterMinutes);
  const criticals = r.recs.filter((x) => x.level === CRITICAL);
  const farthestCritical = Math.max(...criticals.map((x) => x.etaTrueMin ?? Infinity));
  return [
    { key: 'A', rule: 'High within 2 min', holds: firstHigh >= 0 && firstHigh <= pingWindowEnds,
      detail: firstHigh >= 0 ? `first High at ${r.recs[firstHigh].t} min` : 'never High' },
    { key: 'A', rule: 'Critical only inside 30 min of the pier', holds: farthestCritical <= settings.risk.criticalWithinMinutes || criticals.length === 0,
      detail: criticals.length ? `first Critical ${farthestCritical} min out` : 'never Critical' },
  ];
}

function checkB(r: ScenarioResult): AcceptanceCheck[] {
  const firstHigh = r.recs.findIndex((x) => x.level >= HIGH);
  const after = firstHigh >= 0 ? r.recs.slice(firstHigh) : [];
  const lowest = after.length ? Math.min(...after.map((x) => x.level)) : LOW;
  return [{ key: 'B', rule: 'Never below Serious after its first High', holds: firstHigh >= 0 && lowest >= SERIOUS,
    detail: firstHigh >= 0 ? `lowest after first High: ${LEVELS[lowest]}` : 'never High' }];
}

function checkC(r: ScenarioResult): AcceptanceCheck[] {
  const peak = Math.max(...r.recs.map((x) => x.level));
  return [{ key: 'C', rule: 'Low the whole time', holds: peak === LOW, detail: `peak ${LEVELS[peak]}` }];
}

function checkD(r: ScenarioResult): AcceptanceCheck[] {
  const peak = Math.max(...r.recs.map((x) => x.level));
  return [{ key: 'D', rule: 'Never above Medium', holds: peak <= MEDIUM, detail: `peak ${LEVELS[peak]}` }];
}

function checkE(r: ScenarioResult): AcceptanceCheck[] {
  const first = r.recs.find((x) => x.level === CRITICAL);
  return [{ key: 'E', rule: 'Critical within 1 minute of first sighting', holds: !!first && first.t <= CRITICAL_FIRST_SIGHTING_MINUTES,
    detail: first ? `first Critical at ${first.t} min` : 'never Critical' }];
}

export function wholePercent(fraction: number): number {
  return Math.round(fraction * 100);
}

export function acceptance(r: ScenarioResult, settings: Settings = defaultSettings): AcceptanceCheck[] {
  const byKey: Record<IncidentKey, (x: ScenarioResult) => AcceptanceCheck[]> = {
    A: (x) => checkA(x, settings), B: checkB, C: checkC, D: checkD, E: checkE,
  };
  const agree = agreement(r);
  const bar = settings.scenarios.acceptance.minWithinOne;
  const withinOneCheck: AcceptanceCheck = {
    key: r.key, rule: `Within one level at least ${wholePercent(bar)}%`,
    holds: wholePercent(agree.withinOne) >= wholePercent(bar),
    detail: `${wholePercent(agree.withinOne)}% within one, ${wholePercent(agree.exact)}% exact`,
  };
  return [...byKey[r.key](r), withinOneCheck];
}
