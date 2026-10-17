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
