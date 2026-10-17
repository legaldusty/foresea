import { describe, expect, it } from 'vitest';
import {
  consequence, createRiskTracker, CRITICAL, HIGH, initialRiskState, LEVELS, levelOf, likelihoodBand, LOW, RUNGS,
  scoreRisk, SERIOUS, severityBand, type RiskInput,
} from '../src/engine/risk';
import { LOST } from '../src/engine/tell';
import { defaultSettings } from '../src/engine/settings';

const IDS = ['cruise', 'research', 'pier400', 'fuel', 'ferry', 'islands'];

function input(odds: Record<string, number>, rest: Partial<RiskInput> & Pick<RiskInput, 'H' | 'K'>): RiskInput {
  const targets = IDS.map((id) => ({ id, odds: odds[id] ?? 0 }));
  let goal = 0;
  targets.forEach((t, g) => { if (t.odds > targets[goal].odds) goal = g; });
  return {
    t: 0, targets, top: { goal, p: targets[goal].odds }, etaTopMin: null,
    cruiseDocked: true, ambient: false, friendly: false,
    ...rest,
  };
}

function fresh(i: RiskInput, finalRules = true) {
  return scoreRisk(i, initialRiskState(), undefined, { finalRules });
}

function target(result: ReturnType<typeof fresh>, id: string) {
  const found = result.perTarget.find((t) => t.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe('consequence C', () => {
  it('matches the spec table', () => {
    expect(consequence('fuel')).toBeCloseTo(0.72, 12);
    expect(consequence('cruise', true)).toBeCloseTo(0.68, 12);
    expect(consequence('islands')).toBeCloseTo(0.68, 12);
    expect(consequence('ferry')).toBeCloseTo(0.56, 12);
    expect(consequence('pier400')).toBeCloseTo(0.52, 12);
    expect(consequence('cruise', false)).toBeCloseTo(0.44, 12);
    expect(consequence('research')).toBeCloseTo(0.2, 12);
  });
});

describe('bands and levels', () => {
  it('puts likelihood band edges at 0.10, 0.25, 0.45, 0.65', () => {
    expect([0, 0.0999, 0.1, 0.2499, 0.25, 0.4499, 0.45, 0.6499, 0.65, 1].map((x) => likelihoodBand(x))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('puts severity band edges at 0.08, 0.18, 0.32, 0.50', () => {
    expect([0, 0.0799, 0.08, 0.1799, 0.18, 0.3199, 0.32, 0.4999, 0.5, 1].map((x) => severityBand(x))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('maps risk scores to levels and rungs', () => {
    expect([1, 4, 5, 9, 10, 14, 15, 19, 20, 25].map((r) => levelOf(r))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(LEVELS).toEqual(['Low', 'Medium', 'Serious', 'High', 'Critical']);
    expect(RUNGS).toEqual(['Log / Watch', 'Ask', 'Slow / give way', 'Hold', 'Hand off']);
  });
});

describe('worked examples', () => {
  it('1: friendly hull robot is Low', () => {
    const r = fresh(input({ pier400: 0.8 }, { H: 0.02, K: 0.28, friendly: true }));
    expect(target(r, 'pier400')).toMatchObject({ L: 1, S: 2, R: 2 });
    expect(r.levelName).toBe('Low');
    expect(r.rung).toBe('Log / Watch');
  });

  it('2: lost research glider is Low', () => {
    const r = fresh(input({ research: 0.2 }, { H: 0.05, K: 0.12, ambient: true }));
    expect(target(r, 'research')).toMatchObject({ L: 1, S: 1, R: 1 });
    expect(r.levelName).toBe('Low');
  });

  it('5: small unknown at night is Medium because of the 15% cruise odds', () => {
    const r = fresh(input({ research: 0.65, cruise: 0.15, fuel: 0.05, pier400: 0.05, ferry: 0.03, islands: 0.02 }, { H: 0.8, K: 0.36 }));
    expect(target(r, 'research')).toMatchObject({ L: 4, S: 1, R: 4 });
    expect(target(r, 'cruise')).toMatchObject({ L: 2, S: 3, R: 6 });
    expect(r.best.id).toBe('cruise');
    expect(r.R).toBe(6);
    expect(r.levelName).toBe('Medium');
    expect(r.rung).toBe('Ask');
  });

  it('6a: 14 minutes from the Fuel Pier is Serious', () => {
    const r = fresh(input({ fuel: 0.72, islands: 0.1 }, { H: 0.8, K: 0.36, etaTopMin: 14 }));
    expect(r.best).toMatchObject({ id: 'fuel', L: 4, S: 3, R: 12 });
    expect(r.levelName).toBe('Serious');
    expect(r.rung).toBe('Slow / give way');
  });

  it('6b: inside the fuel security zone is High', () => {
    const r = fresh(input({ fuel: 0.85, islands: 0.05 }, { H: 0.9, K: 0.36 }));
    expect(r.best).toMatchObject({ id: 'fuel', L: 5, S: 3, R: 15 });
    expect(r.levelName).toBe('High');
    expect(r.rung).toBe('Hold');
  });

  it('6b with an arrival under 10 minutes gets the time bump', () => {
    const r = fresh(input({ fuel: 0.85, islands: 0.05 }, { H: 0.9, K: 0.36, etaTopMin: 3 }));
    expect(r.levelName).toBe('Critical');
  });

  it('7: large spoofing vehicle at the cruise berth is Critical', () => {
    const r = fresh(input({ cruise: 0.8, research: 0.05 }, { H: 0.95, K: 0.675, etaTopMin: 20 }));
    expect(r.best).toMatchObject({ id: 'cruise', L: 5, S: 4, R: 20 });
    expect(r.levelName).toBe('Critical');
    expect(r.rung).toBe('Hand off');
  });

  it('9: very large vehicle 7 minutes out is bumped to Critical', () => {
    const r = fresh(input({ pier400: 0.55, fuel: 0.1, research: 0.05 }, { H: 0.8, K: 1, etaTopMin: 7 }));
    expect(r.best).toMatchObject({ id: 'pier400', L: 3, S: 5, R: 15 });
    expect(r.rawLevelName).toBe('High');
    expect(r.urgent).toBe(true);
    expect(r.levelName).toBe('Critical');
  });
});

describe('per-target scoring', () => {
  it('breaks a tie on R with the higher odds', () => {
    const r = fresh(input({ fuel: 0.3, islands: 0.31 }, { H: 0.5, K: 0.36 }), false);
    expect(target(r, 'fuel').R).toBe(target(r, 'islands').R);
    expect(r.best.id).toBe('islands');
  });
});

describe('time to react', () => {
  const near = (overrides: Partial<RiskInput>) => fresh(input({ pier400: 0.55, fuel: 0.1 }, { H: 0.8, K: 1, etaTopMin: 7, ...overrides }));

  it('bumps only with top odds of at least 0.40', () => {
    expect(near({ top: { goal: 2, p: 0.39 } }).urgent).toBe(false);
    expect(near({ top: { goal: 2, p: 0.4 } }).urgent).toBe(true);
  });

  it('bumps only under 10 minutes', () => {
    expect(near({ etaTopMin: 10 }).urgent).toBe(false);
    expect(near({ etaTopMin: 9.9 }).urgent).toBe(true);
  });

  it('never bumps an ambient contact or a lost one', () => {
    expect(near({ ambient: true }).urgent).toBe(false);
    expect(near({ top: { goal: LOST, p: 0.9 } }).urgent).toBe(false);
  });
});

describe('final rules', () => {
  it('rule 1: a tiny drone near a low-value dock stays Medium', () => {
    const i = input({ research: 0.9, cruise: 0.02 }, { H: 0.75, K: 0.105, etaTopMin: 5 });
    const r = fresh(i);
    expect(r.best.S).toBe(1);
    expect(r.levelName).toBe('Medium');
    expect(r.rules.map((x) => x.rule)).toContain('urgentNeedsSeverity');
    expect(r.rules.find((x) => x.rule === 'urgentNeedsSeverity')?.finalRule).toBe(1);
    expect(fresh(i, false).levelName).toBe('Serious');
  });

  it('rule 3: after a High it never drops below Serious unless friendly', () => {
    const high = input({ fuel: 0.85 }, { H: 0.9, K: 0.36 });
    const calm = (t: number, friendly = false) => input({ fuel: 0.05 }, { H: 0.5, K: 0.36, t, friendly });
    const tracker = createRiskTracker();
    expect(tracker.update(high).level).toBe(HIGH);
    const levels = [1, 2, 3, 4, 8, 20].map((t) => tracker.update(calm(t)));
    expect(levels.map((x) => x.level)).toEqual([HIGH, HIGH, SERIOUS, SERIOUS, SERIOUS, SERIOUS]);
    expect(levels[2].rules.map((x) => x.rule)).toContain('highFloor');
    const friend = createRiskTracker();
    friend.update(high);
    expect([1, 3, 5].map((t) => friend.update(calm(t, true)).level)).toEqual([HIGH, LOW, LOW]);
  });

  it('rule 4: split odds count together with the worse severity', () => {
    const i = input({ fuel: 0.35, islands: 0.35, research: 0.1 }, { H: 0.8, K: 0.36 });
    const r = fresh(i);
    expect(target(r, 'fuel').R).toBe(9);
    expect(r.best).toMatchObject({ L: 4, S: 3, R: 12 });
    expect(r.best.splitWith).not.toBeNull();
    expect(r.levelName).toBe('Serious');
    expect(r.rules.map((x) => x.rule)).toContain('splitOdds');
    expect(fresh(i, false).levelName).toBe('Medium');
    const lopsided = fresh(input({ fuel: 0.7, islands: 0.19 }, { H: 0.8, K: 0.36 }));
    expect(lopsided.best.splitWith).toBeNull();
  });

  it('rule 5: Critical only within the signed close-in window of the top target', () => {
    const within = defaultSettings.risk.criticalWithinMinutes;
    const at = (eta: number | null) => fresh(input({ cruise: 0.8 }, { H: 0.95, K: 0.675, etaTopMin: eta }));
    expect(at(45).levelName).toBe('High');
    expect(at(45).rules.map((x) => x.rule)).toContain('criticalNeedsCloseIn');
    expect(at(null).levelName).toBe('High');
    expect(at(within).levelName).toBe('Critical');
    expect(at(within + 1).levelName).toBe('High');
    expect(fresh(input({ cruise: 0.8 }, { H: 0.95, K: 0.675, etaTopMin: 45 }), false).levelName).toBe('Critical');
  });

  it('no flicker: drops only after 2 minutes below', () => {
    const serious = (t: number) => input({ fuel: 0.72 }, { H: 0.8, K: 0.36, t, etaTopMin: 14 });
    const low = (t: number) => input({ fuel: 0.05 }, { H: 0.5, K: 0.36, t });
    const tracker = createRiskTracker();
    expect(tracker.update(serious(0)).level).toBe(SERIOUS);
    const held = tracker.update(low(1));
    expect(held.level).toBe(SERIOUS);
    expect(held.candidateLevel).toBe(LOW);
    expect(held.rules.map((x) => x.rule)).toContain('noFlicker');
    expect(tracker.update(low(2.9)).level).toBe(SERIOUS);
    expect(tracker.update(low(3)).level).toBe(LOW);
    expect(tracker.update(serious(3.5)).level).toBe(SERIOUS);
  });

  it('going up is immediate', () => {
    const tracker = createRiskTracker();
    tracker.update(input({ fuel: 0.05 }, { H: 0.5, K: 0.36 }));
    expect(tracker.update(input({ cruise: 0.8 }, { H: 0.95, K: 0.675, etaTopMin: 20, t: 0.1 })).level).toBe(CRITICAL);
  });
});

describe('scoreRisk', () => {
  it('is pure and explains itself', () => {
    const state = { shown: HIGH, belowSince: null, peak: HIGH };
    const r = scoreRisk(input({ fuel: 0.05 }, { H: 0.5, K: 0.36, t: 1 }), state);
    expect(state).toEqual({ shown: HIGH, belowSince: null, peak: HIGH });
    expect(r.state).toEqual({ shown: HIGH, belowSince: 1, peak: HIGH });
    expect(r.perTarget).toHaveLength(IDS.length);
    for (const t of r.perTarget) {
      expect(t.likelihood).toBeCloseTo(0.5 * t.odds, 12);
      expect(t.severity).toBeCloseTo(0.36 * t.consequence, 12);
      expect(t.R).toBe(t.L * t.S);
    }
    expect(r.rawLevelName).toBe('Low');
    expect(r.levelName).toBe('High');
    expect(r.level).toBe(HIGH);
  });
});
