import { describe, expect, it } from 'vitest';
import { defaultSettings, withOverrides } from '../src/engine/settings';

describe('settings', () => {
  it('merges nested overrides without touching the base', () => {
    const before = JSON.stringify(defaultSettings);
    const s = withOverrides(defaultSettings, { tell: { beta: 2 }, risk: { evidence: { noReply: 0.2 } } });
    expect(s.tell.beta).toBe(2);
    expect(s.tell.lostPrior).toBe(defaultSettings.tell.lostPrior);
    expect(s.risk.evidence.noReply).toBe(0.2);
    expect(s.risk.evidence.spoofedId).toBe(defaultSettings.risk.evidence.spoofedId);
    expect(JSON.stringify(defaultSettings)).toBe(before);
  });

  it('replaces arrays instead of merging them', () => {
    const s = withOverrides(defaultSettings, { risk: { likelihoodBands: [0.2, 0.3, 0.5, 0.7] } });
    expect(s.risk.likelihoodBands).toEqual([0.2, 0.3, 0.5, 0.7]);
    expect(s.risk.severityBands).toEqual(defaultSettings.risk.severityBands);
  });

  it('returns a copy that can change freely', () => {
    const s = withOverrides(defaultSettings);
    s.harbor.targets[0].lon = 0;
    expect(defaultSettings.harbor.targets[0].lon).not.toBe(0);
  });
});
