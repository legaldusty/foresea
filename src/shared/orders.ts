export interface OrderBlank {
  key: string;
  unit: string;
  options: number[];
  format?: 'percent' | 'level';
}

export type OrderPart = string | OrderBlank;

export interface OrderCard {
  id: string;
  title: string;
  parts: OrderPart[];
  fixed?: boolean;
}

export const ORDER_CARDS: OrderCard[] = [
  {
    id: 'draft',
    title: 'Draft a give-way notice',
    parts: [
      'IF risk is', { key: 'draftRiskMin', unit: 'or more', options: [8, 10, 12, 15] },
      'AND the top target is', { key: 'draftOddsMin', unit: 'likely or more', options: [0.5, 0.6, 0.7, 0.8], format: 'percent' },
      'AND each boat is delayed', { key: 'maxDelayPerBoatMin', unit: 'min or less', options: [4, 6, 8, 10, 15] },
      'THEN draft the notice.',
    ],
  },
  {
    id: 'auto',
    title: 'Publish on my behalf',
    parts: [
      'Publish give-way notices automatically up to', { key: 'autoPublishUpToLevel', unit: 'risk', options: [-1, 1, 2, 3], format: 'level' },
      'after a', { key: 'vetoSeconds', unit: 'second countdown I can stop. Every one is logged and can be undone.', options: [10, 20, 30, 60] },
    ],
  },
  {
    id: 'zone',
    title: 'Safety zone',
    parts: [
      'Keep', { key: 'zoneMeters', unit: 'm clear around the contact, plus the forecast area for the next 30 minutes.', options: [150, 250, 400, 500] },
    ],
  },
  {
    id: 'animal',
    title: 'Marine animals',
    parts: [
      'IF a whale or other animal is seen THEN boats within', { key: 'animalSlowMeters', unit: 'm', options: [300, 500, 800] },
      'slow to', { key: 'animalSlowKnots', unit: 'knots, from the routine template.', options: [5, 8, 10, 12] },
    ],
  },
  {
    id: 'cards',
    title: 'If nobody answers',
    parts: [
      'Re-alert every', { key: 'realertMinutes', unit: 'min', options: [1, 2, 3, 5] },
      'and call the backup officer after', { key: 'backupOfficerMinutes', unit: 'min. Never publish or climb a rung alone.', options: [3, 4, 6, 10] },
    ],
  },
  {
    id: 'never',
    title: 'Never automated',
    fixed: true,
    parts: ['Holding or closing anything, contacting responders, anything touching the vehicle, and anything about people in the water always wait for a person.'],
  },
];

const LEVEL_WORDS: Record<number, string> = { [-1]: 'never', 0: 'Low', 1: 'Medium', 2: 'Serious', 3: 'High', 4: 'Critical' };

export function formatBlank(b: OrderBlank, v: number): string {
  if (b.format === 'level') return LEVEL_WORDS[v] ?? String(v);
  return b.format === 'percent' ? `${Math.round(v * 100)}%` : String(v);
}

export type OrderKind = 'security' | 'whale' | 'divers' | 'dredge' | 'closure' | 'search' | 'slow' | 'sighting' | 'flaggedShip' | 'any';
export type OrderDo = 'autoPublish' | 'neverAuto' | 'radius' | 'slowKnots' | 'validMinutes' | 'alert' | 'callBackup';
export type ShipFlag = 'watch' | 'anomalous';
export type OrderSource = 'parser' | 'granite' | 'officer';

export interface OrderHours { from: string; to: string }

export interface OrderWhen {
  kind: OrderKind;
  levelMin: number | null;
  levelMax: number | null;
  hours: OrderHours | null;
  place: string | null;
  shipFlag: ShipFlag | null;
}

export interface OrderThen { do: OrderDo; value: number | null }

export interface CustomOrder {
  id: string;
  text: string;
  when: OrderWhen;
  then: OrderThen[];
  understood: string;
  source: OrderSource;
}

export interface OrderReading {
  order: CustomOrder | null;
  understood: string;
  missing: string[];
  refused: string | null;
}

export interface OrderDraftReply extends OrderReading {
  source: OrderSource | 'none';
  examples: string[];
}

export const ORDER_KINDS: { value: OrderKind; label: string }[] = [
  { value: 'security', label: 'a security contact' },
  { value: 'whale', label: 'a whale' },
  { value: 'divers', label: 'divers' },
  { value: 'dredge', label: 'a dredge' },
  { value: 'closure', label: 'a closure' },
  { value: 'slow', label: 'a slow zone' },
  { value: 'search', label: 'a lost robot search area' },
  { value: 'sighting', label: 'a reported sighting' },
  { value: 'flaggedShip', label: 'a flagged ship' },
  { value: 'any', label: 'anything' },
];

export const ORDER_ACTIONS: { value: OrderDo; label: string; unit: string | null; options: number[] }[] = [
  { value: 'autoPublish', label: 'publish automatically after the countdown', unit: null, options: [] },
  { value: 'neverAuto', label: 'never publish automatically', unit: null, options: [] },
  { value: 'radius', label: 'set the zone radius to', unit: 'm', options: [100, 200, 300, 400, 500, 800, 1000, 1500] },
  { value: 'slowKnots', label: 'ask boats to slow to', unit: 'knots', options: [3, 4, 5, 6, 8, 10, 12] },
  { value: 'validMinutes', label: 'keep the notice valid for', unit: 'min', options: [30, 60, 120, 240, 480] },
  { value: 'alert', label: 'alert the officer with a card', unit: null, options: [] },
  { value: 'callBackup', label: 'call the backup officer at once', unit: null, options: [] },
];

export const ORDER_LEVEL_NAMES = ['Low', 'Medium', 'Serious', 'High', 'Critical'];

export const ORDER_EXAMPLES = [
  'At night, publish divers zones automatically after the countdown',
  'If the traffic model flags a ship as anomalous, alert me and call the backup',
];
