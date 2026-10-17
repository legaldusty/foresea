import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/engine/settings';
import { inHours, orderApplies, orderFromFields, parseOrder, validCustomOrder } from '../src/engine/orderParse';

const read = (text: string) => parseOrder(text, defaultSettings);
const does = (text: string) => read(text).order?.then.map((s) => [s.do, s.value]) ?? [];

describe('parseOrder reads real phrasings', () => {
  it('a whale sighting between 22:00 and 6 am publishes the slow zone automatically', () => {
    const r = read('When a whale sighting is confirmed between 22:00 and 6 am, publish the slow zone automatically');
    expect(r.refused).toBeNull();
    expect(r.order!.when).toMatchObject({ kind: 'whale', hours: { from: '22:00', to: '06:00' }, place: null });
    expect(does('When a whale sighting is confirmed between 22:00 and 6 am, publish the slow zone automatically')).toEqual([['autoPublish', null]]);
    expect(r.understood).toBe('When a whale sighting is confirmed between 22:00 and 06:00, publish the slow zone automatically after the 20 s countdown.');
    expect(r.order!.source).toBe('parser');
  });

  it('"at night" uses the signed night hours', () => {
    const r = read('At night, auto-publish divers zones');
    expect(r.order!.when.kind).toBe('divers');
    expect(r.order!.when.hours).toEqual({ from: '19:00', to: '06:00' });
    expect(r.order!.then[0].do).toBe('autoPublish');
  });

  it('"during the day" with "keep 300 m clear" sets the radius for divers', () => {
    const r = read('During the day keep 300 m clear around divers');
    expect(r.order!.when).toMatchObject({ kind: 'divers', hours: { from: '06:00', to: '19:00' } });
    expect(r.order!.then).toEqual([{ do: 'radius', value: 300 }]);
    expect(r.understood).toBe('When divers are in the water between 06:00 and 19:00, set the zone radius to 300 m.');
  });

  it('"up to Serious near the Cruise Terminal" for give-way notices on my behalf', () => {
    const r = read('Publish give-way notices on my behalf up to Serious near the Cruise Terminal');
    expect(r.order!.when).toMatchObject({ kind: 'security', levelMin: null, levelMax: 2, place: 'cruise' });
    expect(r.order!.then[0].do).toBe('autoPublish');
    expect(r.understood).toBe('When a security contact is rated up to Serious near the Cruise Terminal, publish the give-way notice automatically after the 20 s countdown.');
  });

  it('"above High" with "never automatically" is a block, not a refusal', () => {
    const r = read('Security contacts above High: never automatically, always ask me');
    expect(r.refused).toBeNull();
    expect(r.order!.when).toMatchObject({ kind: 'security', levelMin: 4, levelMax: null });
    expect(r.order!.then).toEqual([{ do: 'neverAuto', value: null }]);
  });

  it('"always ask me" on its own covers anything', () => {
    const r = read('Always ask me');
    expect(r.order!.when.kind).toBe('any');
    expect(r.order!.then).toEqual([{ do: 'neverAuto', value: null }]);
    expect(r.understood).toBe('When anything needs the officer, always wait for the officer before publishing.');
  });

  it('a flagged anomalous ship wakes me and calls the backup', () => {
    const r = read('If the traffic model flags a ship as anomalous, wake me and call the backup');
    expect(r.order!.when).toMatchObject({ kind: 'flaggedShip', shipFlag: 'anomalous' });
    expect(r.order!.then.map((s) => s.do)).toEqual(['alert', 'callBackup']);
  });

  it('a ship that goes dark only needs a watch flag and ignores the minutes', () => {
    const r = read('Tell me when a ship goes dark for 10 minutes');
    expect(r.order!.when).toMatchObject({ kind: 'flaggedShip', shipFlag: 'watch' });
    expect(r.order!.then).toEqual([{ do: 'alert', value: null }]);
  });

  it('"slow to 6 knots for 2 hours" sets the speed and how long it lasts', () => {
    const r = read('Whale zones: slow to 6 knots for 2 hours');
    expect(r.order!.when.kind).toBe('whale');
    expect(r.order!.then).toEqual([{ do: 'slowKnots', value: 6 }, { do: 'validMinutes', value: 120 }]);
    expect(r.understood).toBe('When a whale sighting is confirmed, ask boats to slow to 6 knots and keep the notice valid for 2 hours.');
  });

  it('"between 10 pm and 5 am" and "for 90 minutes" for divers', () => {
    const r = read('Between 10 pm and 5 am, divers zones stay up for 90 minutes');
    expect(r.order!.when.hours).toEqual({ from: '22:00', to: '05:00' });
    expect(r.order!.then).toEqual([{ do: 'validMinutes', value: 90 }]);
  });

  it('a security range near Pier 400 calls the backup at once', () => {
    const r = read('When a contact is between Serious and High near Pier 400, call the backup officer at once');
    expect(r.order!.when).toMatchObject({ kind: 'security', levelMin: 2, levelMax: 3, place: 'pier400' });
    expect(r.order!.then).toEqual([{ do: 'callBackup', value: null }]);
    expect(r.understood).toBe('When a security contact is rated Serious to High near Pier 400, call the backup officer at once.');
  });

  it('lost robots get their search area published on my behalf', () => {
    const r = read('Publish the search area for a lost robot on my behalf');
    expect(r.order!.when.kind).toBe('search');
    expect(r.order!.then[0].do).toBe('autoPublish');
  });

  it('"alert me" when a sighting is reported, near the Fuel Pier', () => {
    const r = read('Alert me when a sighting comes in near the fuel pier');
    expect(r.order!.when).toMatchObject({ kind: 'sighting', place: 'fuel' });
    expect(r.order!.then).toEqual([{ do: 'alert', value: null }]);
  });

  it('"never automatically" for divers zones', () => {
    const r = read('Divers zones: never publish them automatically');
    expect(r.order!.when.kind).toBe('divers');
    expect(r.order!.then).toEqual([{ do: 'neverAuto', value: null }]);
  });
});

describe('parseOrder refuses what the fixed limits forbid', () => {
  it('closures never publish automatically', () => {
    const r = read('Publish closures automatically');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/Closures never publish automatically/);
  });

  it('Critical never publishes automatically', () => {
    const r = read('Auto-publish when a contact is Critical');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/Critical never publishes automatically/);
    expect(r.understood).toContain('rated Critical');
  });

  it('people in the water never publish automatically', () => {
    const r = read('Publish automatically when a person is in the water');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/people in the water/);
  });

  it('holds are never automated', () => {
    const r = read('Hold the cruise berth on my behalf when a contact is High');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/Holding or closing/);
  });

  it('automatic publishing is never turned on for everything', () => {
    const r = read('Publish everything automatically');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/one kind of notice/);
  });

  it('cannot both publish automatically and always ask', () => {
    const r = read('Publish whale zones automatically but always ask me');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/Pick one/);
  });

  it('radius limits come from the settings', () => {
    const r = read('Divers zones keep 5000 m clear');
    expect(r.order).toBeNull();
    expect(r.refused).toMatch(/between 50 and 3000 m/);
  });

  it('says what it did not understand', () => {
    const r = read('Make it nicer');
    expect(r.order).toBeNull();
    expect(r.refused).toBeNull();
    expect(r.missing.length).toBe(2);
    const half = read('When divers are in the water');
    expect(half.order).toBeNull();
    expect(half.missing).toHaveLength(1);
    expect(half.understood).toBe('Read so far: when divers are in the water.');
  });
});

describe('orders from Granite and from the sheet are checked the same way', () => {
  it('drops anything outside the vocabulary and keeps the rest', () => {
    const r = orderFromFields({ kind: 'divers', levelMin: -1, levelMax: 9, hoursFrom: '22:00', hoursTo: '06:00', place: 'atlantis', shipFlag: 'none', actions: [{ do: 'autoPublish', value: 0 }, { do: 'launch', value: 3 }, { do: 'radius', value: 0 }] }, 'divers at night on my behalf', 'granite', defaultSettings);
    expect(r.order!.when).toEqual({ kind: 'divers', levelMin: null, levelMax: null, hours: { from: '22:00', to: '06:00' }, place: null, shipFlag: null });
    expect(r.order!.then).toEqual([{ do: 'autoPublish', value: null }]);
    expect(r.order!.source).toBe('granite');
  });

  it('a signed order that breaks a limit is not accepted', () => {
    const closure = { id: 'c1', text: '', source: 'officer', understood: 'anything', when: { kind: 'closure', levelMin: null, levelMax: null, hours: null, place: null, shipFlag: null }, then: [{ do: 'autoPublish', value: null }] };
    expect(validCustomOrder(closure, defaultSettings)).toBeNull();
    const fine = validCustomOrder({ ...closure, then: [{ do: 'callBackup', value: null }] }, defaultSettings);
    expect(fine!.understood).toBe('When an area is closed, call the backup officer at once.');
  });
});

describe('matching an order', () => {
  it('hours wrap midnight on the sim clock', () => {
    const night = { from: '22:00', to: '06:00' };
    expect(inHours(23 * 60, night)).toBe(true);
    expect(inHours(2 * 60 + 1440, night)).toBe(true);
    expect(inHours(12 * 60, night)).toBe(false);
  });

  it('place, level and kind all have to fit', () => {
    const order = read('When a contact is between Serious and High near the Fuel Pier, call the backup').order!;
    const fuel = defaultSettings.harbor.targets.find((t) => t.id === 'fuel')!;
    const base = { kinds: ['security' as const], level: 3, lonlat: null, targetId: 'fuel', shipLevel: null };
    expect(orderApplies(order, base, 600, defaultSettings)).toBe(true);
    expect(orderApplies(order, { ...base, level: 4 }, 600, defaultSettings)).toBe(false);
    expect(orderApplies(order, { ...base, targetId: 'cruise' }, 600, defaultSettings)).toBe(false);
    expect(orderApplies(order, { ...base, targetId: null, lonlat: [fuel.lon + 0.002, fuel.lat] }, 600, defaultSettings)).toBe(true);
    expect(orderApplies(order, { ...base, kinds: ['whale'] }, 600, defaultSettings)).toBe(false);
  });
});
