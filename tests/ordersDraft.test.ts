import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/engine/settings';
import { readTypedOrder } from '../server/llm';

function fakeGranite(reply: Record<string, unknown> | null) {
  const asked: string[] = [];
  return { asked, language: { readOrder: async (text: string) => { asked.push(text); return reply; } } };
}

const signed = defaultSettings.orders as unknown as Record<string, number>;

describe('typed orders: the parser first, Granite second', () => {
  it('the parser answers without asking Granite', async () => {
    const g = fakeGranite(null);
    const r = await readTypedOrder('Publish divers zones automatically at night', defaultSettings, signed, g.language);
    expect(r.source).toBe('parser');
    expect(r.order!.when.kind).toBe('divers');
    expect(g.asked).toHaveLength(0);
  });

  it('Granite reads what the parser could not, and anything it made up is dropped', async () => {
    const g = fakeGranite({ kind: 'dredge', levelMin: -1, levelMax: -1, hoursFrom: '', hoursTo: '', place: 'cruise', shipFlag: 'none', actions: [{ do: 'alert', value: 0 }, { do: 'radius', value: 300 }] });
    const r = await readTypedOrder('Give me a heads up whenever the mud boat starts up', defaultSettings, signed, g.language);
    expect(g.asked).toHaveLength(1);
    expect(r.source).toBe('granite');
    expect(r.order!.when).toMatchObject({ kind: 'dredge', place: null });
    expect(r.order!.then).toEqual([{ do: 'alert', value: null }]);
    expect(r.understood).toBe('When a dredge is working, alert the officer with a card.');
  });

  it('Granite is held to the same limits', async () => {
    const g = fakeGranite({ kind: 'closure', levelMin: -1, levelMax: -1, hoursFrom: '', hoursTo: '', place: 'anywhere', shipFlag: 'none', actions: [{ do: 'autoPublish', value: 0 }] });
    const r = await readTypedOrder('Shutdowns go out without me', defaultSettings, signed, g.language);
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/Closures never publish automatically/);
  });

  it('with no Granite and no parse it says what was missing and shows two examples', async () => {
    const r = await readTypedOrder('Make it nicer', defaultSettings, signed, fakeGranite(null).language);
    expect(r.source).toBe('none');
    expect(r.order).toBeNull();
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.examples).toHaveLength(2);
  });
});
