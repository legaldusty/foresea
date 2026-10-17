import { describe, expect, it } from 'vitest';
import { CRITICAL, HIGH, LOW, MEDIUM, SERIOUS } from '../src/engine/risk';
import {
  acceptance, agreement, expectedLevel, INCIDENT_KEYS, runAllScenarios, runReferenceScenario, runScenario, wholePercent,
  type IncidentKey, type ScenarioRecord, type ScenarioResult,
} from '../src/engine/scenarios';
import { defaultSettings } from '../src/engine/settings';
import type { EvidenceKey } from '../src/engine/identify';
import { harbor, readJson, referenceHarbor, referenceSettings } from './support';

const h = harbor();
const ref = referenceHarbor();
const referenceRuns = runAllScenarios(ref, referenceSettings);

interface ReferenceRecord {
  t: number;
  odds: number[];
  lost: number;
  H: number;
  ev: string[];
  riskTarget: string;
  R: number;
  L: number;
  S: number;
  rawLevel: number;
  urgent: boolean;
  level: number;
  top: string;
  topP: number;
  etaTopMin: number | null;
  etaTrueMin: number | null;
  call: string | null;
  turned: boolean;
  cell: number;
}

interface ReferenceScenario {
  key: IncidentKey;
  recs: ReferenceRecord[];
  tellWarnMin: number | null;
  baseWarnMin: number | null;
  totalMin: number;
  K: number;
}

const REFERENCE_EVIDENCE: Record<string, EvidenceKey> = {
  'no reply': 'noReply',
  'spoofed ID': 'spoofedId',
  aiming: 'goalDirected',
  'lost-looking': 'lostLooking',
  evasive: 'evasive',
  loitering: 'loiter',
  'security zone': 'securityZone',
  'night, no plan': 'nightNoPlan',
  'classified debris/dead robot': 'debris',
  friendly: 'friendly',
};

const reference = readJson<{ scenarios: ReferenceScenario[] }>('giveway-starter/reference/scenarios/results_fix.json').scenarios;

const finalRuns = runAllScenarios(h, defaultSettings, { withCurrent: false });
const currentRuns = runAllScenarios(h, defaultSettings, { withCurrent: true });

function byKey(results: ScenarioResult[], key: IncidentKey): ScenarioResult {
  const found = results.find((r) => r.key === key);
  if (!found) throw new Error(key);
  return found;
}

function comparable(r: ScenarioRecord) {
  return {
    t: r.t, cell: r.cell, odds: r.odds, lost: r.lost, H: r.H, riskTarget: r.riskTarget, R: r.R, L: r.L, S: r.S,
    rawLevel: r.rawLevel, urgent: r.urgent, level: r.level, top: r.top, topP: r.topP, etaTopMin: r.etaTopMin,
    etaTrueMin: r.etaTrueMin, call: r.call, turned: r.turned,
    ev: r.ev.filter((k) => k !== 'registryNoReply'),
  };
}

function comparableReference(r: ReferenceRecord) {
  return {
    t: r.t, cell: r.cell, odds: r.odds, lost: r.lost, H: r.H, riskTarget: r.riskTarget, R: r.R, L: r.L, S: r.S,
    rawLevel: r.rawLevel, urgent: r.urgent, level: r.level, top: r.top, topP: r.topP, etaTopMin: r.etaTopMin,
    etaTrueMin: r.etaTrueMin, call: r.call, turned: r.turned,
    ev: r.ev.map((e) => REFERENCE_EVIDENCE[e]),
  };
}

describe('parity with the reference runner (final rules)', () => {
  for (const key of INCIDENT_KEYS) {
    it(`reproduces incident ${key} record for record`, () => {
      const ours = byKey(referenceRuns, key);
      const theirs = reference.find((s) => s.key === key) as ReferenceScenario;
      expect(ours.recs.map(comparable)).toEqual(theirs.recs.map(comparableReference));
      expect(ours.tellWarnMin).toBe(theirs.tellWarnMin);
      expect(ours.baseWarnMin).toBe(theirs.baseWarnMin);
      expect(ours.totalMin).toBe(theirs.totalMin);
      expect(ours.K).toBe(theirs.K);
    });
  }
});

function firstIndex(r: ScenarioResult, test: (x: ScenarioRecord) => boolean): number {
  return r.recs.findIndex(test);
}

function mustStayTrue(label: string, results: ScenarioResult[]) {
  describe(`must stay true: ${label}`, () => {
    it('A reaches High within 2 min and Critical only inside 30 min of the pier', () => {
      const a = byKey(results, 'A');
      const pingWindow = defaultSettings.evidenceRules.noReplyAfterMinutes;
      const firstHigh = firstIndex(a, (x) => x.level >= HIGH);
      const firstAfterWindow = firstIndex(a, (x) => x.t >= pingWindow);
      expect(firstHigh).toBeGreaterThanOrEqual(0);
      expect(firstHigh).toBeLessThanOrEqual(firstAfterWindow);
      expect(a.recs[firstHigh].t).toBeLessThan(pingWindow + a.recs[1].t);
      const criticals = a.recs.filter((x) => x.level === CRITICAL);
      expect(criticals.length).toBeGreaterThan(0);
      for (const c of criticals) expect(c.etaTrueMin).toBeLessThanOrEqual(defaultSettings.risk.criticalWithinMinutes);
    });

    it('B never drops below Serious after its first High', () => {
      const b = byKey(results, 'B');
      const firstHigh = firstIndex(b, (x) => x.level >= HIGH);
      expect(firstHigh).toBeGreaterThanOrEqual(0);
      for (const x of b.recs.slice(firstHigh)) expect(x.level).toBeGreaterThanOrEqual(SERIOUS);
    });

    it('C stays Low the whole time', () => {
      for (const x of byKey(results, 'C').recs) expect(x.level).toBe(LOW);
    });

    it('D never goes above Medium', () => {
      for (const x of byKey(results, 'D').recs) expect(x.level).toBeLessThanOrEqual(MEDIUM);
    });

    it('E is Critical within 1 minute of first sighting', () => {
      const e = byKey(results, 'E');
      const first = e.recs.find((x) => x.level === CRITICAL);
      expect(first).toBeDefined();
      expect(first?.t).toBeLessThanOrEqual(1);
    });

    it('stays within one level of expectation: A and B at least 92%, C, D, E 100%', () => {
      expect(wholePercent(agreement(byKey(results, 'A')).withinOne)).toBeGreaterThanOrEqual(92);
      expect(wholePercent(agreement(byKey(results, 'B')).withinOne)).toBeGreaterThanOrEqual(92);
      expect(agreement(byKey(results, 'C')).withinOne).toBe(1);
      expect(agreement(byKey(results, 'D')).withinOne).toBe(1);
      expect(agreement(byKey(results, 'E')).withinOne).toBe(1);
    });

    it('passes every acceptance check', () => {
      for (const r of results) for (const check of acceptance(r)) expect(check.holds, `${check.key}: ${check.rule} (${check.detail})`).toBe(true);
    });
  });
}

mustStayTrue('no current', finalRuns);
mustStayTrue('with the current', currentRuns);

describe('agreement numbers', () => {
  it('matches the spec table without the current, on the starter grid the table was made on', () => {
    const table = Object.fromEntries(referenceRuns.map((r) => {
      const a = agreement(r);
      return [r.key, [wholePercent(a.exact), wholePercent(a.withinOne)]];
    }));
    expect(table).toEqual({ A: [62, 100], B: [5, 92], C: [100, 100], D: [89, 100], E: [79, 100] });
  });

  it('final rules agree at least as well as the reference rules in every incident', () => {
    for (const key of INCIDENT_KEYS) {
      const before = agreement(runReferenceScenario(key, ref, referenceSettings));
      const after = agreement(byKey(referenceRuns, key));
      expect(after.withinOne).toBeGreaterThanOrEqual(before.withinOne);
    }
  });

  it('shows the weaknesses the final rules fixed', () => {
    const refA = runReferenceScenario('A', ref, referenceSettings);
    const refB = runReferenceScenario('B', ref, referenceSettings);
    const refD = runReferenceScenario('D', ref, referenceSettings);
    const refE = runReferenceScenario('E', ref, referenceSettings);
    expect(acceptance(refA, referenceSettings).some((c) => !c.holds)).toBe(true);
    expect(acceptance(refB, referenceSettings).some((c) => !c.holds)).toBe(true);
    expect(Math.max(...refD.recs.map((x) => x.level))).toBeGreaterThan(MEDIUM);
    expect(refE.recs.find((x) => x.level === CRITICAL)?.t ?? Infinity).toBeGreaterThan(1);
  });
});

describe('expected level', () => {
  it('follows the expectations written before running', () => {
    expect(expectedLevel('A', { t: 1, etaTrueMin: 40, turned: false })).toBe(MEDIUM);
    expect(expectedLevel('A', { t: 5, etaTrueMin: 10, turned: false })).toBe(HIGH);
    expect(expectedLevel('A', { t: 5, etaTrueMin: 9.9, turned: false })).toBe(CRITICAL);
    expect(expectedLevel('B', { t: 5, etaTrueMin: 5, turned: false })).toBe(SERIOUS);
    expect(expectedLevel('B', { t: 5, etaTrueMin: 5, turned: true })).toBe(HIGH);
    expect(expectedLevel('C', { t: 5, etaTrueMin: null, turned: false })).toBe(LOW);
    expect(expectedLevel('D', { t: 5, etaTrueMin: 3, turned: false })).toBe(MEDIUM);
    expect(expectedLevel('E', { t: 1.9, etaTrueMin: 6, turned: false })).toBe(HIGH);
    expect(expectedLevel('E', { t: 2, etaTrueMin: 6, turned: false })).toBe(CRITICAL);
  });
});

describe('runScenario', () => {
  it('is deterministic', () => {
    expect(runScenario('B', h)).toEqual(runScenario('B', h));
  });

  it('labels the run with its mode and current', () => {
    const r = runScenario('C', h, defaultSettings, { withCurrent: true, mode: 'reference' });
    expect(r.mode).toBe('reference');
    expect(r.withCurrent).toBe(true);
    expect(r.kind).toBe('Debris / dead robot');
    expect(r.trueGoal).toBeNull();
  });
});
