export interface OrderBlank {
  key: string;
  unit: string;
  options: number[];
  format?: 'percent';
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
      'THEN draft the notice for my tap.',
    ],
  },
  {
    id: 'zone',
    title: 'Safety zone',
    parts: [
      'Keep', { key: 'zoneMeters', unit: 'm around the contact', options: [150, 250, 400, 500] },
      'plus its predicted path to the top', { key: 'zoneTopTargets', unit: 'targets', options: [1, 2, 3] },
      'for the next', { key: 'zonePathMinutes', unit: 'min.', options: [5, 10, 15, 20] },
    ],
  },
  {
    id: 'unsure',
    title: 'When TELL is unsure',
    parts: [
      'IF no target is above', { key: 'unsureBelowOdds', unit: '', options: [0.3, 0.4, 0.5], format: 'percent' },
      'THEN multiply the zone by', { key: 'zoneGrowWhenUnsure', unit: '', options: [1.5, 2, 3] },
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

export function formatBlank(b: OrderBlank, v: number): string {
  return b.format === 'percent' ? `${Math.round(v * 100)}%` : String(v);
}
