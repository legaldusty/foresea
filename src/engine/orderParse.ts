import type { Settings } from './settings';
import { metersBetween, type LonLat } from './geo';
import type { NoticeKind } from '../shared/protocol';
import {
  ORDER_ACTIONS, ORDER_KINDS, ORDER_LEVEL_NAMES,
  type CustomOrder, type OrderDo, type OrderHours, type OrderKind, type OrderReading, type OrderSource, type OrderThen, type OrderWhen, type ShipFlag,
} from '../shared/orders';

const CRITICAL_LEVEL = ORDER_LEVEL_NAMES.indexOf('Critical');
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const METERS_PER_UNIT: Record<string, number> = { m: 1, km: 1000, nm: 1852, mile: 1852, yd: 0.9144 };
const RADIUS_STEP_M = 10;
const KIND_SET = new Set<OrderKind>(ORDER_KINDS.map((k) => k.value));
const DO_SET = new Set<OrderDo>(ORDER_ACTIONS.map((a) => a.value));
const VALUE_DOS = new Set<OrderDo>(['radius', 'slowKnots', 'validMinutes']);
const SAFE_WITHOUT_KIND = new Set<OrderDo>(['neverAuto', 'alert', 'callBackup']);
const KEEP_CLEAR_KINDS = new Set<OrderKind>(['security', 'dredge', 'closure', 'search']);
const SHIP_ONLY_DOS = new Set<OrderDo>(['alert', 'callBackup', 'neverAuto']);
const SOURCES = new Set<OrderSource>(['parser', 'granite', 'officer']);
const NO_ARTICLE = /^(Angels Gate|Queens Gate|Pier \d+|the )/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CURLY_QUOTES = new RegExp(`[${String.fromCodePoint(0x2018, 0x2019)}]`, 'g');
const LONG_DASHES = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`, 'g');

const LEVEL_WORD: Record<string, number> = { low: 0, minor: 0, medium: 1, moderate: 1, serious: 2, high: 3, critical: 4 };
const LEVEL = '(low|minor|medium|moderate|serious|high|critical)';

const KIND_PATTERNS: [OrderKind, RegExp][] = [
  ['flaggedShip', /\b(?:(?:flagged|flags?|anomalous|anomaly|suspicious|unusual|strange|odd)\s+(?:a\s+|the\s+)?(?:ships?|vessels?|boats?)|(?:ships?|vessels?)\s+(?:to watch|on the watch list|that (?:goes|go|went) dark|(?:goes|go|going|went) dark|(?:stops?|stopped) reporting|(?:turns?|turned) off (?:its |their )?ais)|traffic model|ais (?:gaps?|silence)|dark (?:ships?|vessels?)|ships? to watch)\b/],
  ['search', /\b(?:search areas?|lost (?:research )?(?:robots?|gliders?|vehicles?|auvs?|drones?)|missing (?:robots?|gliders?)|(?:robots?|gliders?) (?:is |are |goes |go |gets |get )?(?:lost|missing|silent)|search)\b/],
  ['whale', /\b(?:whales?|marine (?:animals?|mammals?|life)|animals?|humpbacks?)\b/],
  ['divers', /\b(?:divers?|dive plans?|dives?|diving)\b/],
  ['dredge', /\b(?:dredges?|dredging|work zones?|construction)\b/],
  ['closure', /\b(?:closures?|closed areas?|areas? (?:is |are )?closed|closed)\b/],
  ['sighting', /\b(?:sightings?|sighted|spotted)\b/],
  ['security', /\b(?:security|unknown contacts?|unknowns?|contacts?|intruders?|drones?|uuvs?|underwater vehicles?|vehicles?|threats?|give[- ]way notices?|hostile)\b/],
  ['any', /\b(?:anything|everything|any (?:cards?|notices?|alerts?|drafts?|zones?)|all (?:cards|notices|alerts|drafts|zones)|every (?:card|notice|alert|draft|zone))\b/],
];

const VEHICLE = /\b(?:intercept\w*|disable\w*|shoot\w*|neutrali[sz]\w*|destroy\w*|(?:stop|catch|chase|touch|follow) (?:the |a )?(?:drone|vehicle|uuv|contact))\b/;
const RESPONDERS = /\b(?:coast guard|uscg|port police|police|harbou?r patrol|responders?|fire ?boats?)\b/;
const PEOPLE = /\b(?:persons?|people|man overboard|swimmers?|someone|somebody|a body)\b/;
const CLOSING = /\b(?:close|shut|seal)\s+(?:the |a |an |off )?(?:harbou?r|channel|port|berths?|gates?|areas?|terminal)\b/;
const HOLD = /\bhold(?:s|ing)?\b(?!\s+off)/;

const NEVER_AUTO = /\b(?:always ask(?: me)?|ask me(?: first)?|always wait(?: for me)?|wait for me|never (?:auto[- ]?publish\w*|automatically|on (?:its|their) own|by itself|act alone|publish\b[^.;]{0,40}?\b(?:automatically|on (?:its|their) own|by itself|without me|on my behalf))|(?:do not|don'?t|not) (?:auto[- ]?publish\w*|publish\b[^.;]{0,40}?\b(?:automatically|on (?:its|their) own|by itself|without (?:asking|me)|on my behalf)|act alone)|no auto[- ]?publish\w*|nothing automatic(?:ally)?|manual(?:ly)? only)\b/;
const AUTO = /\b(?:auto[- ]?publish\w*|publish\w*\b[^.;]{0,40}?\b(?:automatically|for me|on my behalf|without (?:asking|me|waiting)|on (?:its|their) own|by itself)|automatically publish\w*|on my behalf|go ahead and publish)\b/;
const ALERT = /\b(?:wake (?:me|the officer)(?: up)?|tell me|alert me|let me know|notify me|warn me|ping me|page me|call me|text me|show me|alert the officer|tell the officer|raise a card|give me a card|card for me|bring it to me)\b/;
const BACKUP = /\b(?:(?:call|page|wake|ring|phone|get|alert|notify|bring in)\s+(?:up\s+)?(?:the\s+|my\s+|a\s+)?(?:backup|back-up|back up|second|relief|other)(?:\s+officer)?|backup officer)\b/;
const RADIUS = /\b(\d+(?:\.\d+)?)\s*(m|meters?|metres?|km|kilometers?|kilometres?|nm|nautical miles?|miles?|yards?|yd)\b/;
const RADIUS_BARE = /\bradius\s+(?:of\s+|to\s+)?(\d+(?:\.\d+)?)\b/;
const KNOTS = /\b(\d+(?:\.\d+)?)\s*(?:knots?|kn|kts?)\b/;
const SLOW_TO = /\bslow(?:\s+(?:down|boats|them|traffic))?\s+to\s+(\d+(?:\.\d+)?)\b/;
const VALID = /\b(?:for|valid for|lasts?(?: for)?|keep it (?:up|open|active) for|stays? (?:up|open|active) for)\s+(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|eight|ten|twelve|half an?)\s*(hours?|hrs?|h|minutes?|mins?)\b/;
const WORD_NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12, 'half a': 0.5, 'half an': 0.5 };

const TIME = '(noon|midday|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])|\\d{1,2}:\\d{2}(?!\\d)|\\d{4}(?!\\d)|\\d{1,2}(?![\\d:]))';
const NOT_A_QUANTITY = '(?!\\s*(?:knots?|kn\\b|kts?|m\\b|meters?|metres?|min|minutes?|hours?|hrs?|nm\\b))';
const BETWEEN = new RegExp(`\\b(?:between|from|after)\\s+${TIME}\\s*(?:and|to|until|till|through|-)\\s*${TIME}${NOT_A_QUANTITY}`);
const AFTER = new RegExp(`\\b(?:after|from)\\s+${TIME}${NOT_A_QUANTITY}`);
const BEFORE = new RegExp(`\\b(?:before|until|till)\\s+${TIME}${NOT_A_QUANTITY}`);
const NIGHT = /\b(?:at night|overnight|tonight|nights?|night ?time|after dark|night watch|during the night|in the night)\b/;
const DAY = /\b(?:during the day|daytime|by day|in the day|daylight|day ?shift|in daylight|during daylight)\b/;
const PLACE_PREP = '(?:near|at|by|around|off|outside|close to|next to|in|inside|toward|towards|heading for|heading to|bound for)\\s+(?:the\\s+)?';
const GENERIC_PLACE_WORDS = new Set(['pier', 'dock', 'landing', 'terminal', 'the', 'container']);

export const MISSING_KIND = 'what it is about: a security contact, whale, divers, dredge, closure, search area, sighting or flagged ship';
export const MISSING_ACTION = 'what to do: publish automatically, always ask, keep N m clear, slow to N knots, valid for N minutes, alert me or call the backup';

const REFUSE = {
  vehicle: 'Nothing here touches the vehicle. Anything about the vehicle itself always waits for a person.',
  responders: 'Contacting the Coast Guard, the port police or other responders always waits for a person.',
  people: 'Anything about people in the water always waits for a person. That card comes straight to you with the port police brief.',
  closing: 'Holding or closing anything is never automated, as the fixed card says. It always waits for a person.',
  critical: 'Critical never publishes automatically. It always waits for a person. Try up to High.',
  closureAuto: 'Closures never publish automatically, as the fixed card says. A closure always waits for a person.',
  anyAuto: 'Automatic publishing needs one kind of notice, such as divers or a whale. It is never turned on for everything.',
  shipZone: 'A flagged ship gets a card for you, never a notice. Ask for a card or the backup officer.',
  both: 'The order asks to publish automatically and also to always wait. Pick one.',
  searchRadius: 'The search area comes from the drift forecast. An order cannot set its size.',
};

type Target = Settings['harbor']['targets'][number];

export interface OrderSubject {
  kinds: OrderKind[];
  level: number | null;
  lonlat: LonLat | null;
  targetId: string | null;
  shipLevel: 'normal' | 'watch' | 'anomalous' | null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(CURLY_QUOTES, "'")
    .replace(LONG_DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function hourClock(hour: number): string {
  const total = Math.round(hour * MINUTES_PER_HOUR) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(total / MINUTES_PER_HOUR))}:${pad2(total % MINUTES_PER_HOUR)}`;
}

function clockMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * MINUTES_PER_HOUR + m;
}

function toClock(raw: string): string | null {
  const s = raw.replace(/\./g, '').replace(/\s+/g, '');
  if (s === 'noon' || s === 'midday') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h === 24 && min === 0) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

export function nightWindow(settings: Settings): OrderHours {
  return { from: hourClock(settings.sim.nightStartHour), to: hourClock(settings.sim.nightEndHour) };
}

export function dayWindow(settings: Settings): OrderHours {
  const night = nightWindow(settings);
  return { from: night.to, to: night.from };
}

function readHours(t: string, settings: Settings): OrderHours | null {
  const between = BETWEEN.exec(t);
  if (between) {
    const from = toClock(between[1]);
    const to = toClock(between[2]);
    if (from && to) return { from, to };
  }
  const night = nightWindow(settings);
  const noon = clockMinutes('12:00');
  const after = AFTER.exec(t);
  if (after) {
    const from = toClock(after[1]);
    if (from) return { from, to: clockMinutes(from) >= noon ? night.to : night.from };
  }
  const before = BEFORE.exec(t);
  if (before) {
    const to = toClock(before[1]);
    if (to) return { from: clockMinutes(to) <= noon ? night.from : night.to, to };
  }
  if (NIGHT.test(t)) return night;
  if (DAY.test(t)) return dayWindow(settings);
  return null;
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function placeAliases(target: Target): string[] {
  const short = target.short.toLowerCase();
  const plain = target.name.replace(/\s*\([^)]*\)/, '').toLowerCase();
  const inParens = /\(([^)]+)\)/.exec(target.name)?.[1]?.toLowerCase() ?? null;
  const first = short.split(' ')[0];
  return [short, plain, target.id.toLowerCase(), inParens, GENERIC_PLACE_WORDS.has(first) ? null : first].filter((a): a is string => !!a);
}

function readPlace(t: string, settings: Settings): string | null {
  let best: { id: string; at: number } | null = null;
  for (const target of settings.harbor.targets) {
    for (const alias of placeAliases(target)) {
      const m = new RegExp(`\\b${PLACE_PREP}${escapeRegExp(alias)}\\b`).exec(t);
      if (m && (!best || m.index < best.at)) best = { id: target.id, at: m.index };
    }
  }
  return best?.id ?? null;
}

function readKind(t: string): OrderKind | null {
  let best: { kind: OrderKind; at: number } | null = null;
  for (const [kind, re] of KIND_PATTERNS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { kind, at: m.index };
  }
  return best?.kind ?? null;
}

function readLevels(t: string): { min: number | null; max: number | null } | null {
  const word = (s: string): number => LEVEL_WORD[s];
  const range = (a: number, b: number) => ({ min: Math.min(a, b), max: Math.max(a, b) });
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`\\b(?:between|from)\\s+${LEVEL}\\s+(?:and|to|through)\\s+${LEVEL}\\b`).exec(t))) return range(word(m[1]), word(m[2]));
  if ((m = new RegExp(`\\b${LEVEL}\\s+(?:to|through|-)\\s+${LEVEL}\\b`).exec(t))) return range(word(m[1]), word(m[2]));
  if ((m = new RegExp(`\\b(?:up to|at most|no higher than|no more than|not above)\\s+(?:a\\s+)?${LEVEL}\\b`).exec(t))) return { min: null, max: word(m[1]) };
  if ((m = new RegExp(`\\b${LEVEL}\\s+or\\s+(?:lower|below|less|under)\\b`).exec(t))) return { min: null, max: word(m[1]) };
  if ((m = new RegExp(`\\b(?:below|under|lower than|less than)\\s+${LEVEL}\\b`).exec(t))) return word(m[1]) > 0 ? { min: null, max: word(m[1]) - 1 } : null;
  if ((m = new RegExp(`\\b(?:above|over|higher than|more than|beyond)\\s+${LEVEL}\\b`).exec(t))) return word(m[1]) < CRITICAL_LEVEL ? { min: word(m[1]) + 1, max: null } : null;
  if ((m = new RegExp(`\\bat least\\s+${LEVEL}\\b`).exec(t))) return { min: word(m[1]), max: null };
  if ((m = new RegExp(`\\b${LEVEL}\\s+(?:or|and)\\s+(?:above|higher|more|up|over|worse)\\b`).exec(t))) return { min: word(m[1]), max: null };
  if ((m = new RegExp(`\\b${LEVEL}\\b`).exec(t))) return { min: word(m[1]), max: word(m[1]) };
  return null;
}

function roundRadius(meters: number): number {
  return Math.round(meters / RADIUS_STEP_M) * RADIUS_STEP_M;
}

function readRadius(t: string): number | null {
  const m = RADIUS.exec(t);
  if (m) {
    const unit = m[2].startsWith('nautical') || m[2] === 'nm' ? 'nm' : m[2].startsWith('mile') ? 'mile' : m[2].startsWith('k') ? 'km' : m[2].startsWith('y') ? 'yd' : 'm';
    return roundRadius(Number(m[1]) * METERS_PER_UNIT[unit]);
  }
  const bare = RADIUS_BARE.exec(t);
  return bare ? roundRadius(Number(bare[1])) : null;
}

function readKnots(t: string): number | null {
  const m = KNOTS.exec(t) ?? SLOW_TO.exec(t);
  return m ? Number(m[1]) : null;
}

function readValidMinutes(t: string): number | null {
  const m = VALID.exec(t);
  if (!m) return null;
  const amount = WORD_NUMBER[m[1]] ?? Number(m[1]);
  if (!Number.isFinite(amount)) return null;
  return Math.round(m[2].startsWith('h') ? amount * MINUTES_PER_HOUR : amount);
}

function readActions(t: string, kind: OrderKind | null): { then: OrderThen[]; conflict: boolean } {
  const then: OrderThen[] = [];
  const never = NEVER_AUTO.exec(t);
  const rest = never ? t.slice(0, never.index) + ' '.repeat(never[0].length) + t.slice(never.index + never[0].length) : t;
  const auto = AUTO.test(rest);
  if (auto) then.push({ do: 'autoPublish', value: null });
  if (never) then.push({ do: 'neverAuto', value: null });
  if (kind !== 'flaggedShip') {
    const radius = readRadius(t);
    if (radius !== null) then.push({ do: 'radius', value: radius });
    const knots = readKnots(t);
    if (knots !== null) then.push({ do: 'slowKnots', value: knots });
    const minutes = readValidMinutes(t);
    if (minutes !== null) then.push({ do: 'validMinutes', value: minutes });
  }
  if (ALERT.test(t)) then.push({ do: 'alert', value: null });
  if (BACKUP.test(t)) then.push({ do: 'callBackup', value: null });
  return { then, conflict: auto && !!never };
}

function textRefusal(t: string): string | null {
  if (VEHICLE.test(t)) return REFUSE.vehicle;
  if (RESPONDERS.test(t)) return REFUSE.responders;
  if (PEOPLE.test(t)) return REFUSE.people;
  if (CLOSING.test(t) || HOLD.test(t)) return REFUSE.closing;
  return null;
}

function withArticle(name: string): string { return NO_ARTICLE.test(name) ? name : `the ${name}`; }

function levelPhrase(min: number | null, max: number | null): string {
  const lo = min ?? 0;
  const hi = max ?? CRITICAL_LEVEL;
  if (lo <= 0 && hi >= CRITICAL_LEVEL) return '';
  if (lo === hi) return `rated ${ORDER_LEVEL_NAMES[lo]}`;
  if (lo <= 0) return `rated up to ${ORDER_LEVEL_NAMES[hi]}`;
  if (hi >= CRITICAL_LEVEL) return `rated ${ORDER_LEVEL_NAMES[lo]} or above`;
  return `rated ${ORDER_LEVEL_NAMES[lo]} to ${ORDER_LEVEL_NAMES[hi]}`;
}

function subjectPhrase(when: OrderWhen): string {
  const rated = levelPhrase(when.levelMin, when.levelMax);
  switch (when.kind) {
    case 'security': return rated ? `a security contact is ${rated}` : 'a security contact needs a give-way notice';
    case 'whale': return 'a whale sighting is confirmed';
    case 'divers': return 'divers are in the water';
    case 'dredge': return 'a dredge is working';
    case 'closure': return 'an area is closed';
    case 'search': return 'a lost robot needs a search area';
    case 'sighting': return 'a sighting is reported';
    case 'flaggedShip': return when.shipFlag === 'anomalous' ? 'the traffic model flags a ship as anomalous' : 'the traffic model flags a ship to watch';
    default: return rated ? `anything is ${rated}` : 'anything needs the officer';
  }
}

function noticeNoun(kind: OrderKind): string {
  switch (kind) {
    case 'security': return 'the give-way notice';
    case 'whale':
    case 'sighting': return 'the slow zone';
    case 'divers': return 'the divers zone';
    case 'dredge': return 'the dredge zone';
    case 'search': return 'the search area';
    case 'closure': return 'the closure';
    default: return 'the notice';
  }
}

function durationWords(minutes: number): string {
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}

function reachesCritical(when: OrderWhen): boolean {
  return (when.levelMax ?? CRITICAL_LEVEL) >= CRITICAL_LEVEL;
}

function actionPhrase(step: OrderThen, when: OrderWhen, vetoSeconds: number): string {
  switch (step.do) {
    case 'autoPublish': {
      const guard = (when.kind === 'security' || when.kind === 'any') && reachesCritical(when) ? ', never at Critical' : '';
      return `publish ${noticeNoun(when.kind)} automatically after the ${vetoSeconds} s countdown${guard}`;
    }
    case 'neverAuto': return 'always wait for the officer before publishing';
    case 'radius': return when.kind === 'security' ? `keep ${step.value} m clear around the contact` : `set the zone radius to ${step.value} m`;
    case 'slowKnots': return `ask boats to slow to ${step.value} knots`;
    case 'validMinutes': return `keep the notice valid for ${durationWords(step.value ?? 0)}`;
    case 'alert': return 'alert the officer with a card';
    default: return 'call the backup officer at once';
  }
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function conditionPhrase(when: OrderWhen, settings: Settings): string {
  const target = when.place ? settings.harbor.targets.find((t) => t.id === when.place) : undefined;
  const place = target ? ` near ${withArticle(target.short)}` : '';
  const hours = when.hours ? ` between ${when.hours.from} and ${when.hours.to}` : '';
  return `When ${subjectPhrase(when)}${place}${hours}`;
}

export function restateOrder(when: OrderWhen, then: OrderThen[], settings: Settings, vetoSeconds = settings.orders.vetoSeconds): string {
  return `${conditionPhrase(when, settings)}, ${joinWords(then.map((s) => actionPhrase(s, when, vetoSeconds)))}.`;
}

function partialPhrase(when: OrderWhen | null, then: OrderThen[], settings: Settings, vetoSeconds: number): string {
  if (when) return `Read so far: ${conditionPhrase(when, settings).replace(/^When/, 'when')}.`;
  if (then.length) {
    const blank: OrderWhen = { kind: 'any', levelMin: null, levelMax: null, hours: null, place: null, shipFlag: null };
    return `Read so far: ${joinWords(then.map((s) => actionPhrase(s, blank, vetoSeconds)))}.`;
  }
  return '';
}

function outOfRange(value: number | null, min: number, max: number): boolean {
  return value === null || !Number.isFinite(value) || value < min || value > max;
}

export function orderRefusal(when: OrderWhen, then: OrderThen[], settings: Settings): string | null {
  const limits = settings.customOrders;
  const does = new Set(then.map((t) => t.do));
  if (does.has('autoPublish') && does.has('neverAuto')) return REFUSE.both;
  if (does.has('autoPublish')) {
    if (when.kind === 'closure') return REFUSE.closureAuto;
    if (when.kind === 'any') return REFUSE.anyAuto;
    if (when.kind === 'flaggedShip') return REFUSE.shipZone;
    if (when.levelMin !== null && when.levelMin >= CRITICAL_LEVEL) return REFUSE.critical;
  }
  if (when.kind === 'flaggedShip' && then.some((t) => !SHIP_ONLY_DOS.has(t.do))) return REFUSE.shipZone;
  for (const step of then) {
    if (step.do === 'radius') {
      if (when.kind === 'search') return REFUSE.searchRadius;
      if (outOfRange(step.value, limits.radiusMinM, limits.radiusMaxM)) return `A zone radius must be between ${limits.radiusMinM} and ${limits.radiusMaxM} m.`;
    }
    if (step.do === 'slowKnots') {
      if (KEEP_CLEAR_KINDS.has(when.kind)) return `${ORDER_KINDS.find((k) => k.value === when.kind)?.label.replace(/^a /, 'A ') ?? 'That zone'} keeps boats clear. It has no slow-down speed to set.`;
      if (outOfRange(step.value, limits.slowKnotsMin, limits.slowKnotsMax)) return `A slow-down speed must be between ${limits.slowKnotsMin} and ${limits.slowKnotsMax} knots.`;
    }
    if (step.do === 'validMinutes' && outOfRange(step.value, limits.validMinutesMin, limits.validMinutesMax)) return `A notice can be valid for ${limits.validMinutesMin} to ${limits.validMinutesMax} minutes.`;
  }
  return null;
}

function orderId(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `order-${hash.toString(36)}`;
}

export function buildOrder(when: OrderWhen, then: OrderThen[], text: string, source: OrderSource, settings: Settings, vetoSeconds = settings.orders.vetoSeconds, id?: string): OrderReading {
  const steps = dedupeSteps(then);
  const missing = steps.length ? [] : [MISSING_ACTION];
  if (missing.length) return { order: null, understood: partialPhrase(when, steps, settings, vetoSeconds), missing, refused: null };
  const understood = restateOrder(when, steps, settings, vetoSeconds);
  const refused = orderRefusal(when, steps, settings);
  if (refused) return { order: null, understood, missing: [], refused };
  const clean = text.trim().slice(0, settings.customOrders.maxTextLength);
  return { order: { id: id ?? orderId(normalize(clean) || understood), text: clean, when, then: steps, understood, source }, understood, missing: [], refused: null };
}

function dedupeSteps(then: OrderThen[]): OrderThen[] {
  const byDo = new Map<OrderDo, OrderThen>();
  for (const step of then) byDo.set(step.do, { do: step.do, value: VALUE_DOS.has(step.do) ? step.value : null });
  return ORDER_ACTIONS.map((a) => byDo.get(a.value)).filter((s): s is OrderThen => !!s);
}

export function parseOrder(text: string, settings: Settings, signed?: Partial<Record<string, number>>): OrderReading {
  const vetoSeconds = signed?.vetoSeconds ?? settings.orders.vetoSeconds;
  const t = normalize(text.slice(0, settings.customOrders.maxTextLength));
  if (!t) return { order: null, understood: '', missing: [MISSING_KIND, MISSING_ACTION], refused: null };
  const refusedByText = textRefusal(t);
  let kind = readKind(t);
  const { then, conflict } = readActions(t, kind);
  if (!kind && then.length && then.every((s) => SAFE_WITHOUT_KIND.has(s.do))) kind = 'any';
  const levels = kind === 'security' || kind === 'any' ? readLevels(t) : null;
  const when: OrderWhen | null = kind ? {
    kind,
    levelMin: levels?.min ?? null,
    levelMax: levels?.max ?? null,
    hours: readHours(t, settings),
    place: readPlace(t, settings),
    shipFlag: kind === 'flaggedShip' ? (/\b(?:anomal\w*|suspicious|strange|odd|unusual)\b/.test(t) ? 'anomalous' : 'watch') : null,
  } : null;
  if (refusedByText) return { order: null, understood: when && then.length ? restateOrder(when, dedupeSteps(then), settings, vetoSeconds) : partialPhrase(when, then, settings, vetoSeconds), missing: [], refused: refusedByText };
  if (conflict && when) return { order: null, understood: restateOrder(when, dedupeSteps(then), settings, vetoSeconds), missing: [], refused: REFUSE.both };
  if (!when) return { order: null, understood: partialPhrase(null, then, settings, vetoSeconds), missing: then.length ? [MISSING_KIND] : [MISSING_KIND, MISSING_ACTION], refused: null };
  return buildOrder(when, then, text, 'parser', settings, vetoSeconds);
}

function asLevel(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= CRITICAL_LEVEL ? value : null;
}

function asClock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (CLOCK_PATTERN.test(s)) return s;
  return s ? toClock(s.toLowerCase()) : null;
}

function asHours(from: unknown, to: unknown): OrderHours | null {
  const f = asClock(from);
  const t = asClock(to);
  return f && t && f !== t ? { from: f, to: t } : null;
}

function asSteps(value: unknown): OrderThen[] {
  if (!Array.isArray(value)) return [];
  const out: OrderThen[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const step = item as Record<string, unknown>;
    const what = step.do;
    if (typeof what !== 'string' || !DO_SET.has(what as OrderDo)) continue;
    const needsValue = VALUE_DOS.has(what as OrderDo);
    const amount = typeof step.value === 'number' && Number.isFinite(step.value) && step.value > 0 ? step.value : null;
    if (needsValue && amount === null) continue;
    out.push({ do: what as OrderDo, value: needsValue ? (what === 'radius' ? roundRadius(amount!) : Math.round(amount! * 10) / 10) : null });
  }
  return out;
}

function asWhen(raw: Record<string, unknown>, settings: Settings): OrderWhen | null {
  const kind = typeof raw.kind === 'string' && KIND_SET.has(raw.kind as OrderKind) ? (raw.kind as OrderKind) : null;
  if (!kind) return null;
  const levelled = kind === 'security' || kind === 'any';
  let levelMin = levelled ? asLevel(raw.levelMin) : null;
  let levelMax = levelled ? asLevel(raw.levelMax) : null;
  if (levelMin !== null && levelMax !== null && levelMin > levelMax) [levelMin, levelMax] = [levelMax, levelMin];
  const hoursRaw = raw.hours && typeof raw.hours === 'object' ? (raw.hours as Record<string, unknown>) : null;
  const hours = hoursRaw ? asHours(hoursRaw.from, hoursRaw.to) : asHours(raw.hoursFrom, raw.hoursTo);
  const place = typeof raw.place === 'string' && settings.harbor.targets.some((t) => t.id === raw.place) ? raw.place : null;
  const shipFlag: ShipFlag | null = kind === 'flaggedShip' ? (raw.shipFlag === 'anomalous' ? 'anomalous' : 'watch') : null;
  return { kind, levelMin, levelMax, hours, place, shipFlag };
}

export function orderFromFields(raw: unknown, text: string, source: OrderSource, settings: Settings, vetoSeconds = settings.orders.vetoSeconds): OrderReading {
  const fields = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const then = asSteps(fields.then ?? fields.actions);
  const when = asWhen(fields.when && typeof fields.when === 'object' ? (fields.when as Record<string, unknown>) : fields, settings);
  if (!when) return { order: null, understood: partialPhrase(null, then, settings, vetoSeconds), missing: then.length ? [MISSING_KIND] : [MISSING_KIND, MISSING_ACTION], refused: null };
  const refusedByText = textRefusal(normalize(text));
  if (refusedByText) return { order: null, understood: then.length ? restateOrder(when, dedupeSteps(then), settings, vetoSeconds) : '', missing: [], refused: refusedByText };
  return buildOrder(when, then, text, source, settings, vetoSeconds);
}

function clockWasSaid(clock: string, t: string, said: (n: number) => boolean): boolean {
  const hour = Number(clock.slice(0, 2));
  if (clock === '12:00' && /\b(?:noon|midday)\b/.test(t)) return true;
  if (clock === '00:00' && /\bmidnight\b/.test(t)) return true;
  return said(hour) || said(hour % 12 || 12) || said(Number(clock.replace(':', '')));
}

export function groundedFields(raw: unknown, text: string, settings: Settings): Record<string, unknown> {
  const fields: Record<string, unknown> = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  const t = normalize(text);
  const numbers = new Set((t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  const said = (n: number): boolean => numbers.has(n);
  const actions = Array.isArray(fields.actions) ? fields.actions : [];
  fields.actions = actions.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const step = item as Record<string, unknown>;
    const value = typeof step.value === 'number' ? step.value : 0;
    if (step.do === 'radius' || step.do === 'slowKnots') return said(value);
    if (step.do === 'validMinutes') return said(value) || said(value / MINUTES_PER_HOUR) || VALID.test(t);
    return true;
  });
  if (typeof fields.place === 'string') {
    const target = settings.harbor.targets.find((x) => x.id === fields.place);
    if (!target || !placeAliases(target).some((alias) => t.includes(alias))) fields.place = 'anywhere';
  }
  const hoursNamed = NIGHT.test(t) || DAY.test(t);
  for (const key of ['hoursFrom', 'hoursTo']) {
    const clock = asClock(fields[key]);
    if (clock && !hoursNamed && !clockWasSaid(clock, t, said)) fields[key] = '';
  }
  return fields;
}

export function validCustomOrder(raw: unknown, settings: Settings, vetoSeconds = settings.orders.vetoSeconds): CustomOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const fields = raw as Record<string, unknown>;
  const id = typeof fields.id === 'string' && ID_PATTERN.test(fields.id) ? fields.id : null;
  if (!id) return null;
  const text = typeof fields.text === 'string' ? fields.text : '';
  const source = typeof fields.source === 'string' && SOURCES.has(fields.source as OrderSource) ? (fields.source as OrderSource) : 'officer';
  const when = fields.when && typeof fields.when === 'object' ? asWhen(fields.when as Record<string, unknown>, settings) : null;
  if (!when) return null;
  return buildOrder(when, asSteps(fields.then), text, source, settings, vetoSeconds, id).order;
}

export function inHours(simMin: number, hours: OrderHours | null): boolean {
  if (!hours) return true;
  const now = ((simMin % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const from = clockMinutes(hours.from);
  const to = clockMinutes(hours.to);
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

function shipFlagMet(flag: ShipFlag | null, level: OrderSubject['shipLevel']): boolean {
  if (level === null || level === 'normal') return false;
  return flag !== 'anomalous' || level === 'anomalous';
}

export function orderApplies(order: CustomOrder, subject: OrderSubject, simMin: number, settings: Settings): boolean {
  const w = order.when;
  if (w.kind !== 'any' && !subject.kinds.includes(w.kind)) return false;
  if (w.kind === 'flaggedShip' && !shipFlagMet(w.shipFlag, subject.shipLevel)) return false;
  if (w.levelMin !== null || w.levelMax !== null) {
    if (subject.level === null) return false;
    if (subject.level < (w.levelMin ?? 0) || subject.level > (w.levelMax ?? CRITICAL_LEVEL)) return false;
  }
  if (!inHours(simMin, w.hours)) return false;
  if (w.place) {
    const target = settings.harbor.targets.find((t) => t.id === w.place);
    if (!target) return false;
    const near = subject.lonlat !== null && metersBetween(subject.lonlat, [target.lon, target.lat]) <= settings.customOrders.placeNearMeters;
    if (subject.targetId !== w.place && !near) return false;
  }
  return true;
}

export function orderDoes(order: CustomOrder, what: OrderDo): OrderThen | null {
  return order.then.find((s) => s.do === what) ?? null;
}

export function noticeOrderKinds(kind: NoticeKind, fromSighting: boolean): OrderKind[] {
  switch (kind) {
    case 'security': return ['security'];
    case 'whale': return fromSighting ? ['whale', 'sighting'] : ['whale'];
    case 'divers': return ['divers'];
    case 'dredge': return ['dredge'];
    case 'closure': return ['closure'];
    case 'search': return ['search'];
    default: return [];
  }
}

export function orderJsonSchema(settings: Settings): object {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...ORDER_KINDS.map((k) => k.value), 'unknown'] },
      levelMin: { type: 'integer', minimum: -1, maximum: CRITICAL_LEVEL },
      levelMax: { type: 'integer', minimum: -1, maximum: CRITICAL_LEVEL },
      hoursFrom: { type: 'string' },
      hoursTo: { type: 'string' },
      place: { type: 'string', enum: [...settings.harbor.targets.map((t) => t.id), 'anywhere'] },
      shipFlag: { type: 'string', enum: ['watch', 'anomalous', 'none'] },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { do: { type: 'string', enum: ORDER_ACTIONS.map((a) => a.value) }, value: { type: 'number' } },
          required: ['do', 'value'],
        },
      },
    },
    required: ['kind', 'levelMin', 'levelMax', 'hoursFrom', 'hoursTo', 'place', 'shipFlag', 'actions'],
  };
}

export function orderVocabulary(settings: Settings): string {
  return [
    `kind: ${ORDER_KINDS.map((k) => `${k.value} (${k.label})`).join(', ')}, or unknown.`,
    `levelMin and levelMax: risk levels for security only, ${ORDER_LEVEL_NAMES.map((n, i) => `${i} ${n}`).join(', ')}; -1 when not given.`,
    `hoursFrom and hoursTo: 24 hour HH:MM on the harbor clock, empty when not given. Night is ${hourClock(settings.sim.nightStartHour)} to ${hourClock(settings.sim.nightEndHour)}.`,
    `place: one of ${settings.harbor.targets.map((t) => `${t.id} (${t.short})`).join(', ')}, or anywhere.`,
    'shipFlag: for flaggedShip only, watch or anomalous; otherwise none.',
    `actions: ${ORDER_ACTIONS.map((a) => `${a.value} (${a.label}${a.unit ? `, value in ${a.unit}` : ''})`).join(', ')}. value is 0 when the action takes no number.`,
  ].join('\n');
}
