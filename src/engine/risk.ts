import { defaultSettings, type Settings } from './settings';

export const LEVELS = ['Low', 'Medium', 'Serious', 'High', 'Critical'] as const;
export const RUNGS = ['Log / Watch', 'Ask', 'Slow / give way', 'Hold', 'Hand off'] as const;

export type LevelName = (typeof LEVELS)[number];
export type RungName = (typeof RUNGS)[number];

export const LOW = 0;
export const MEDIUM = 1;
export const SERIOUS = 2;
export const HIGH = 3;
export const CRITICAL = 4;

const CONSEQUENCE_FACTORS = ['people', 'hazard', 'economy', 'environment'] as const;

export function levelIndex(name: string): number {
  const index = (LEVELS as readonly string[]).indexOf(name);
  if (index < 0) throw new Error(`Unknown risk level ${name}`);
  return index;
}

export function levelName(level: number): LevelName {
  return LEVELS[level];
}

export function rungName(level: number): RungName {
  return RUNGS[level];
}

export function consequence(targetId: string, cruiseDocked = true, settings: Settings = defaultSettings): number {
  const target = settings.harbor.targets.find((t) => t.id === targetId) as { emptyId?: string } | undefined;
  const key = !cruiseDocked && target?.emptyId ? target.emptyId : targetId;
  const scores = (settings.consequence as Record<string, Record<(typeof CONSEQUENCE_FACTORS)[number], number>>)[key];
  if (!scores) throw new Error(`No consequence scores for ${key}`);
  const weights = settings.risk.consequenceWeights;
  let sum = 0;
  for (const factor of CONSEQUENCE_FACTORS) sum += scores[factor] * weights[factor];
  return sum / settings.risk.consequenceMaxScore;
}

export function band(value: number, thresholds: readonly number[]): number {
  let b = 1;
  for (const threshold of thresholds) if (value >= threshold) b++;
  return b;
}

export function likelihoodBand(value: number, settings: Settings = defaultSettings): number {
  return band(value, settings.risk.likelihoodBands);
}

export function severityBand(value: number, settings: Settings = defaultSettings): number {
  return band(value, settings.risk.severityBands);
}

export function levelOf(score: number, settings: Settings = defaultSettings): number {
  let level = LOW;
  for (const max of settings.risk.levelMaxScores) if (score > max) level++;
  return level;
}

export interface RiskTargetInput {
  id: string;
  odds: number;
}

export interface TopGoalInput {
  goal: number;
  p: number;
}

export interface RiskInput {
  t: number;
  H: number;
  K: number;
  targets: RiskTargetInput[];
  top: TopGoalInput;
  etaTopMin: number | null;
  cruiseDocked?: boolean;
  ambient?: boolean;
  friendly?: boolean;
}

export interface TargetRisk {
  id: string;
  odds: number;
  consequence: number;
  likelihood: number;
  severity: number;
  L: number;
  S: number;
  R: number;
}

export interface RiskPick {
  id: string;
  odds: number;
  L: number;
  S: number;
  R: number;
  splitWith: string | null;
}

export type RiskRule = 'splitOdds' | 'urgentBump' | 'urgentNeedsSeverity' | 'criticalNeedsCloseIn' | 'highFloor' | 'noFlicker' | 'friendlyStaysAtLog';

export interface RuleFiring {
  rule: RiskRule;
  finalRule: number | null;
  label: string;
}

export interface RiskState {
  shown: number;
  belowSince: number | null;
  peak: number;
}

export interface RiskOptions {
  finalRules?: boolean;
}

export interface RiskExplanation {
  t: number;
  H: number;
  K: number;
  perTarget: TargetRisk[];
  best: RiskPick;
  R: number;
  rawLevel: number;
  rawLevelName: LevelName;
  urgent: boolean;
  candidateLevel: number;
  level: number;
  levelName: LevelName;
  rung: RungName;
  rules: RuleFiring[];
  state: RiskState;
}

export function initialRiskState(): RiskState {
  return { shown: LOW, belowSince: null, peak: LOW };
}

export function scoreTarget(target: RiskTargetInput, H: number, K: number, cruiseDocked: boolean, settings: Settings): TargetRisk {
  const c = consequence(target.id, cruiseDocked, settings);
  const likelihood = H * target.odds;
  const severity = K * c;
  const L = likelihoodBand(likelihood, settings);
  const S = severityBand(severity, settings);
  return { id: target.id, odds: target.odds, consequence: c, likelihood, severity, L, S, R: L * S };
}

function pickWorst(perTarget: TargetRisk[]): RiskPick {
  let best: TargetRisk | null = null;
  for (const r of perTarget) {
    if (!best || r.R > best.R || (r.R === best.R && r.odds > best.odds)) best = r;
  }
  if (!best) throw new Error('Risk needs at least one target');
  return { id: best.id, odds: best.odds, L: best.L, S: best.S, R: best.R, splitWith: null };
}

function splitOddsPick(perTarget: TargetRisk[], H: number, settings: Settings): RiskPick | null {
  const sorted = perTarget.slice().sort((a, b) => b.odds - a.odds);
  const [a, b] = sorted;
  if (!b || b.odds < settings.risk.splitOddsMin) return null;
  const L = likelihoodBand(H * (a.odds + b.odds), settings);
  const S = Math.max(a.S, b.S);
  const worse = a.S >= b.S ? a : b;
  const other = worse === a ? b : a;
  return { id: worse.id, odds: a.odds + b.odds, L, S, R: L * S, splitWith: other.id };
}

export function scoreTargets(input: RiskInput, settings: Settings = defaultSettings, options: RiskOptions = {}) {
  const finalRules = options.finalRules ?? true;
  const perTarget = input.targets.map((t) => scoreTarget(t, input.H, input.K, input.cruiseDocked ?? true, settings));
  let best = pickWorst(perTarget);
  let splitApplied = false;
  if (finalRules) {
    const split = splitOddsPick(perTarget, input.H, settings);
    if (split && split.R > best.R) { best = split; splitApplied = true; }
  }
  return { perTarget, best, splitApplied };
}

const RULE_LABELS: Record<RiskRule, string> = {
  splitOdds: 'Split odds count together: the two top targets scored as one',
  urgentBump: 'Little time to react: up one level',
  urgentNeedsSeverity: 'Bump only real danger: severity too low for the time bump',
  criticalNeedsCloseIn: 'Critical means call now: held at High until it is close to its target',
  highFloor: 'No reset by fake-out: stays at least Serious after a High',
  noFlicker: 'No flicker: holding the level until it stays lower for a while',
  friendlyStaysAtLog: 'Confirmed friendly: stays at Log',
};

const FINAL_RULE_NUMBER: Partial<Record<RiskRule, number>> = {
  urgentNeedsSeverity: 1,
  highFloor: 3,
  splitOdds: 4,
  criticalNeedsCloseIn: 5,
};

function fired(rule: RiskRule): RuleFiring {
  return { rule, finalRule: FINAL_RULE_NUMBER[rule] ?? null, label: RULE_LABELS[rule] };
}

function isTopATarget(top: TopGoalInput): boolean {
  return top.goal >= 0;
}

function timeIsShort(input: RiskInput, r: Settings['risk']): boolean {
  return isTopATarget(input.top) && input.top.p >= r.urgentMinOdds && input.etaTopMin !== null
    && input.etaTopMin < r.urgentMinutes && !input.ambient;
}

function settleShownLevel(candidate: number, t: number, state: RiskState, dropAfterMinutes: number): RiskState & { held: boolean } {
  if (candidate >= state.shown) return { shown: candidate, belowSince: null, peak: state.peak, held: false };
  const belowSince = state.belowSince ?? t;
  if (t - belowSince >= dropAfterMinutes) return { shown: candidate, belowSince: null, peak: state.peak, held: false };
  return { shown: state.shown, belowSince, peak: state.peak, held: true };
}

export function scoreRisk(input: RiskInput, state: RiskState = initialRiskState(), settings: Settings = defaultSettings, options: RiskOptions = {}): RiskExplanation {
  const finalRules = options.finalRules ?? true;
  const r = settings.risk;
  const rules: RuleFiring[] = [];
  const { perTarget, best, splitApplied } = scoreTargets(input, settings, options);
  if (splitApplied) rules.push(fired('splitOdds'));

  const rawLevel = levelOf(best.R, settings);
  let level = rawLevel;
  let urgent = false;
  if (timeIsShort(input, r) && !input.friendly) {
    if (!finalRules || best.S >= r.urgentMinSeverity) urgent = true;
    else rules.push(fired('urgentNeedsSeverity'));
  }
  if (urgent) {
    level = Math.min(CRITICAL, level + 1);
    rules.push(fired('urgentBump'));
  }
  if (finalRules && level === CRITICAL && !(input.etaTopMin !== null && input.etaTopMin <= r.criticalWithinMinutes)) {
    level = HIGH;
    rules.push(fired('criticalNeedsCloseIn'));
  }
  const floor = levelIndex(r.highFloorLevel);
  if (finalRules && state.peak >= levelIndex(r.highFloorAfterLevel) && !input.friendly && level < floor) {
    level = floor;
    rules.push(fired('highFloor'));
  }

  if (input.friendly && level > LOW) {
    level = LOW;
    rules.push(fired('friendlyStaysAtLog'));
  }

  const settled = settleShownLevel(level, input.t, state, r.dropAfterMinutes);
  if (settled.held) rules.push(fired('noFlicker'));
  const nextState: RiskState = { shown: settled.shown, belowSince: settled.belowSince, peak: Math.max(state.peak, settled.shown) };

  return {
    t: input.t, H: input.H, K: input.K,
    perTarget, best, R: best.R,
    rawLevel, rawLevelName: levelName(rawLevel),
    urgent,
    candidateLevel: level,
    level: nextState.shown, levelName: levelName(nextState.shown), rung: rungName(nextState.shown),
    rules,
    state: nextState,
  };
}

export interface RiskTracker {
  update(input: RiskInput): RiskExplanation;
  readonly state: RiskState;
  reset(): void;
}

export function createRiskTracker(settings: Settings = defaultSettings, options: RiskOptions = {}): RiskTracker {
  let state = initialRiskState();
  return {
    update(input) {
      const explanation = scoreRisk(input, state, settings, options);
      state = explanation.state;
      return explanation;
    },
    get state() {
      return state;
    },
    reset() {
      state = initialRiskState();
    },
  };
}
