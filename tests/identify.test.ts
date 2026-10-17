import { describe, expect, it } from 'vitest';
import { capability, classify, createLoiterClock, hostility, isSecurityKind, sizeFactor, speedFactor, type HostilityInput } from '../src/engine/identify';
import { defaultSettings } from '../src/engine/settings';

const CELL = 50;

function evidence(overrides: Partial<HostilityInput> = {}): HostilityInput {
  return {
    reply: 'none', minutesSinceDetected: 0, steps: 0, lostOdds: 0.25, evasiveRatio: 1,
    minutesNearTarget: 0, cellsToSecurityTarget: Infinity, night: false, cellMeters: CELL,
    ...overrides,
  };
}

const aiming = { steps: 3, lostOdds: 0.1 };

describe('classify', () => {
  it('reads a hot, steady vehicle as powered', () => {
    expect(classify({ speedMps: 1.6, heat: 'hot', sizeM: 1 }).kind).toBe('powered');
    expect(classify({ speedMps: 1.0, heat: 'hot', sizeM: 0.4 }).kind).toBe('powered');
    expect(classify({ speedMps: 3.5, heat: 'hot', sizeM: 7 }).label).toBe('Powered unknown');
  });

  it('reads a cold contact moving with the current as debris (example 2)', () => {
    const glider = classify({ speedMps: 0.2, heat: 'ambient', sizeM: 1.8, currentSpeedMps: 0.2 });
    expect(glider.kind).toBe('debris');
    expect(glider.powered).toBe(false);
    expect(classify({ speedMps: 0.5, heat: 'ambient', sizeM: 1.8, currentSpeedMps: 0.2 }).kind).toBe('unknown');
  });

  it('reads a warm, large, erratic contact as an animal (example 3)', () => {
    const whale = classify({ speedMps: 1.5, heat: 'warm', sizeM: 18, erratic: true });
    expect(whale.kind).toBe('animal');
    expect(whale.threatScored).toBe(false);
  });

  it('reads a warm, slow, person-sized contact as a person (example 4)', () => {
    const diver = classify({ speedMps: 0.5, heat: 'warm', sizeM: 2 });
    expect(diver.kind).toBe('person');
    expect(diver.threatScored).toBe(false);
  });

  it('prefers animal for an erratic person-sized swimmer and person otherwise', () => {
    expect(classify({ speedMps: 0.8, heat: 'warm', sizeM: 2, erratic: true }).kind).toBe('animal');
    expect(classify({ speedMps: 0.8, heat: 'warm', sizeM: 2 }).kind).toBe('person');
  });

  it('says unknown when nothing fits', () => {
    expect(classify({ speedMps: 6, heat: 'hot', sizeM: 12 }).kind).toBe('unknown');
    expect(classify({ speedMps: 0.2, heat: 'warm', sizeM: 0.3 }).kind).toBe('unknown');
    expect(classify({ speedMps: 6, heat: 'hot', sizeM: 12 }).threatScored).toBe(true);
  });
});

describe('capability K', () => {
  it('matches the worked examples', () => {
    expect(capability(1.2, 1.0, true)).toBeCloseTo(0.28, 10);
    expect(capability(1.8, 0.2, false)).toBeCloseTo(0.12, 10);
    expect(capability(1, 1.6, true)).toBeCloseTo(0.36, 10);
    expect(capability(4, 2.5, true)).toBeCloseTo(0.675, 10);
    expect(capability(7, 3.5, true)).toBe(1);
    expect(capability(0.4, 1.0, true)).toBeCloseTo(0.105, 10);
  });

  it('caps the speed factor at 0.3 without a hot spot', () => {
    expect(speedFactor(3.5, false)).toBe(0.3);
    expect(capability(4, 2.5, false)).toBeCloseTo(0.75 * 0.3, 10);
  });

  it('puts band edges where the reference does', () => {
    expect(sizeFactor(0.49)).toBe(0.15);
    expect(sizeFactor(0.5)).toBe(0.4);
    expect(sizeFactor(2)).toBe(0.75);
    expect(sizeFactor(6)).toBe(1);
    expect(speedFactor(0.29, true)).toBe(0.3);
    expect(speedFactor(0.3, true)).toBe(0.7);
    expect(speedFactor(1.5, true)).toBe(0.9);
    expect(speedFactor(3, true)).toBe(0.9);
    expect(speedFactor(3.01, true)).toBe(1);
  });
});

describe('hostility', () => {
  it('starts every unknown at 0.50', () => {
    expect(hostility(evidence()).H).toBe(0.5);
  });

  it('example 1: a confirmed friendly is 0.02', () => {
    const r = hostility(evidence({ reply: 'friendly', night: true, ...aiming }));
    expect(r.H).toBe(0.02);
    expect(r.items).toEqual([expect.objectContaining({ key: 'friendly', set: 0.02 })]);
  });

  it('example 2: a silent registered glider classified as debris is 0.05', () => {
    const r = hostility(evidence({ reply: 'registeredSilent', debris: true, lostOdds: 0.8 }));
    expect(r.H).toBe(0.05);
    expect(r.items.map((i) => i.key)).toEqual(['registryNoReply', 'lostLooking', 'debris']);
  });

  it('example 5: silent, aiming, at night is 0.80', () => {
    expect(hostility(evidence({ minutesSinceDetected: 3, night: true, ...aiming })).H).toBeCloseTo(0.8, 12);
  });

  it('example 6b: entering the fuel security zone adds 0.10', () => {
    expect(hostility(evidence({ minutesSinceDetected: 3, night: true, cellsToSecurityTarget: 5, ...aiming })).H).toBeCloseTo(0.9, 12);
  });

  it('example 7: an unregistered reply at night while aiming is 0.95', () => {
    expect(hostility(evidence({ reply: 'spoof', minutesSinceDetected: 3, night: true, ...aiming })).H).toBeCloseTo(0.95, 12);
  });

  it('example 9: silent, aiming, at night is 0.80', () => {
    expect(hostility(evidence({ minutesSinceDetected: 10, night: true, ...aiming })).H).toBeCloseTo(0.8, 12);
  });

  it('starts a registry match without a reply at 0.25 and never adds the no-reply penalty', () => {
    expect(hostility(evidence({ reply: 'registeredSilent', minutesSinceDetected: 30 })).H).toBe(0.25);
  });

  it('adds the no-reply penalty from 2 minutes', () => {
    expect(hostility(evidence({ minutesSinceDetected: 1.99 })).H).toBe(0.5);
    expect(hostility(evidence({ minutesSinceDetected: 2 })).H).toBeCloseTo(0.65, 12);
  });

  it('needs 3 steps and lost odds under 0.20 for goal-directed', () => {
    expect(hostility(evidence({ steps: 2, lostOdds: 0.1 })).H).toBe(0.5);
    expect(hostility(evidence({ steps: 3, lostOdds: 0.2 })).H).toBe(0.5);
    expect(hostility(evidence({ steps: 3, lostOdds: 0.19 })).H).toBeCloseTo(0.6, 12);
  });

  it('subtracts 0.20 only above 0.50 lost odds', () => {
    expect(hostility(evidence({ lostOdds: 0.5 })).H).toBe(0.5);
    expect(hostility(evidence({ lostOdds: 0.51 })).H).toBeCloseTo(0.3, 12);
  });

  it('needs a ratio over 1.5 after more than 10 steps for evasive', () => {
    expect(hostility(evidence({ evasiveRatio: 1.6, steps: 10, lostOdds: 0.3 })).H).toBe(0.5);
    expect(hostility(evidence({ evasiveRatio: 1.5, steps: 11, lostOdds: 0.3 })).H).toBe(0.5);
    expect(hostility(evidence({ evasiveRatio: 1.6, steps: 11, lostOdds: 0.3 })).H).toBeCloseTo(0.6, 12);
  });

  it('adds loitering after more than 5 minutes near a target', () => {
    expect(hostility(evidence({ minutesNearTarget: 5 })).H).toBe(0.5);
    expect(hostility(evidence({ minutesNearTarget: 5.1 })).H).toBeCloseTo(0.6, 12);
  });

  it('measures the security zone in cells from meters', () => {
    const cells = defaultSettings.evidenceRules.securityZoneMeters / CELL;
    expect(hostility(evidence({ cellsToSecurityTarget: cells })).H).toBeCloseTo(0.6, 12);
    expect(hostility(evidence({ cellsToSecurityTarget: cells + 0.1 })).H).toBe(0.5);
    expect(hostility(evidence({ cellsToSecurityTarget: cells, cellMeters: 25 })).H).toBeCloseTo(0.6, 12);
    expect(isSecurityKind('fuel')).toBe(true);
    expect(isSecurityKind('passenger')).toBe(true);
    expect(isSecurityKind('research')).toBe(false);
  });

  it('adds night only without a filed plan', () => {
    expect(hostility(evidence({ night: true })).H).toBeCloseTo(0.55, 12);
    expect(hostility(evidence({ night: true, planFiled: true })).H).toBe(0.5);
  });

  it('adds 0.15 per coordinated contact up to 0.30', () => {
    expect(hostility(evidence({ coordinatedCount: 1 })).H).toBeCloseTo(0.65, 12);
    expect(hostility(evidence({ coordinatedCount: 3 })).H).toBeCloseTo(0.8, 12);
  });

  it('clamps between 0.02 and 0.98', () => {
    const worst = evidence({ reply: 'spoof', minutesSinceDetected: 5, night: true, cellsToSecurityTarget: 1, minutesNearTarget: 9, coordinatedCount: 2, ...aiming });
    expect(hostility(worst).H).toBe(0.98);
    const best = evidence({ reply: 'registeredSilent', lostOdds: 0.9 });
    expect(hostility(best).H).toBeCloseTo(0.05, 12);
  });

  it('explains every step with a label and a delta or a set value', () => {
    const r = hostility(evidence({ minutesSinceDetected: 3, night: true, ...aiming }));
    expect(r.items.map((i) => i.key)).toEqual(['start', 'noReply', 'goalDirected', 'nightNoPlan']);
    for (const item of r.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.delta !== undefined || item.set !== undefined).toBe(true);
    }
  });
});

describe('loiter clock', () => {
  it('counts minutes spent near a target and resets when it leaves', () => {
    const clock = createLoiterClock();
    expect(clock.update(1, true)).toBe(0);
    expect(clock.update(4, true)).toBe(3);
    expect(clock.update(5, false)).toBe(0);
    expect(clock.update(6, true)).toBe(0);
  });
});
