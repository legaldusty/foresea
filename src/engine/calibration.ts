import type { Harbor } from './harbor';
import { defaultSettings, type Settings } from './settings';
import { runNightsDetailed, type BenchStep, type Detection, type StyleName } from './bench';
import { FORECAST_DEFAULTS, cellCrossing, forecastPaths, type Forecast, type ForecastOptions } from './forecast';
import { driftOdds, lostOnlyOdds, targetOdds, type TellState } from './tell';

const SECONDS_PER_MINUTE = 60;
const SEED_MIX_RUN = 100003;
const SEED_MIX_NIGHT = 7919;
const FIRST_CHECKPOINT_STEP = 1;
const CALIBRATION_NIGHTS = 1000;
const CALIBRATION_BINS = 10;
const COVERAGE_NIGHTS_PER_STYLE = 30;
const COVERAGE_CHECKPOINTS = [0.1, 0.3, 0.5, 0.7];
const LOOKAHEAD_MINUTES = 30;
const WINDOW_SLACK_MINUTES = 3;

export type CalibrationPhase = 'calibration' | 'coverage';

export interface CalibrationOptions {
  nights: number;
  seed: number;
  nearness: boolean;
  detection: Detection;
  speedMps: number;
  bins: number;
  coverageNightsPerStyle: number;
  checkpoints: number[];
  lookaheadMinutes: number;
  windowSlackMinutes: number;
  carefulShare: number;
  forecastSamples: number;
}

export interface CalibrationRunOptions extends Partial<CalibrationOptions> {
  settings?: Settings;
  forecast?: Partial<ForecastOptions>;
  onProgress?: (phase: CalibrationPhase, fraction: number) => void;
}

export function calibrationDefaults(settings: Settings = defaultSettings): CalibrationOptions {
  return {
    nights: CALIBRATION_NIGHTS,
    seed: settings.bench.seed,
    nearness: true,
    detection: 'gates',
    speedMps: settings.bench.speedMps,
    bins: CALIBRATION_BINS,
    coverageNightsPerStyle: COVERAGE_NIGHTS_PER_STYLE,
    checkpoints: COVERAGE_CHECKPOINTS,
    lookaheadMinutes: LOOKAHEAD_MINUTES,
    windowSlackMinutes: WINDOW_SLACK_MINUTES,
    carefulShare: FORECAST_DEFAULTS.carefulShare,
    forecastSamples: FORECAST_DEFAULTS.samples,
  };
}

export const CALIBRATION_DEFAULTS: CalibrationOptions = calibrationDefaults();

export interface CalibrationBin {
  low: number;
  high: number;
  count: number;
  meanPredicted: number | null;
  hitRate: number | null;
}

export interface CalibrationReport {
  nights: number;
  steps: number;
  bins: CalibrationBin[];
  meanPredicted: number;
  hitRate: number;
  brier: number;
  multiclassBrier: number;
  ece: number;
}

export interface CalibrationSummary {
  all: CalibrationReport;
  direct: CalibrationReport;
  sloppy: CalibrationReport;
  decoy: CalibrationReport;
}

export interface CoverageGroup {
  nights: number;
  forecasts: number;
  trackPoints: number;
  crossedCells: number;
  insideLikely: number;
  insideCareful: number;
  timeWindowRight: number;
}

export interface CoverageReport {
  samples: number;
  nightsPerStyle: number;
  checkpoints: number[];
  lookaheadMinutes: number;
  windowSlackMinutes: number;
  carefulShare: number;
  all: CoverageGroup;
  direct: CoverageGroup;
  sloppy: CoverageGroup;
  decoy: CoverageGroup;
}

export interface CalibrationPitch {
  insideCareful: number;
  trackPoints: number;
  nights: number;
  lookaheadMinutes: number;
}

export interface CalibrationStudy {
  seed: number;
  detection: Detection;
  speedMps: number;
  calibration: CalibrationSummary;
  coverage: CoverageReport;
  pitch: CalibrationPitch;
}

export interface CalibrationResult extends CalibrationStudy {
  ms: number;
}

export interface CalibrationTally {
  binCount: number[];
  binPredicted: number[];
  binHits: number[];
  nights: number;
  steps: number;
  squaredError: number;
  multiclassSquaredError: number;
}

export function emptyTally(bins: number = CALIBRATION_BINS): CalibrationTally {
  return {
    binCount: new Array<number>(bins).fill(0),
    binPredicted: new Array<number>(bins).fill(0),
    binHits: new Array<number>(bins).fill(0),
    nights: 0,
    steps: 0,
    squaredError: 0,
    multiclassSquaredError: 0,
  };
}

export function topCandidate(posterior: ArrayLike<number>, candidates: number): number {
  let best = 0;
  for (let g = 1; g < candidates; g++) if (posterior[g] > posterior[best]) best = g;
  return best;
}

function binIndex(p: number, bins: number): number {
  return Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
}

export function tallyPosterior(tally: CalibrationTally, posterior: ArrayLike<number>, candidates: number, truth: number): void {
  const top = topCandidate(posterior, candidates);
  const p = posterior[top];
  const hit = top === truth ? 1 : 0;
  const bin = binIndex(p, tally.binCount.length);
  tally.binCount[bin]++;
  tally.binPredicted[bin] += p;
  tally.binHits[bin] += hit;
  tally.steps++;
  tally.squaredError += (p - hit) ** 2;
  let multiclass = 0;
  for (let k = 0; k < posterior.length; k++) multiclass += (posterior[k] - (k === truth ? 1 : 0)) ** 2;
  tally.multiclassSquaredError += multiclass;
}

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function calibrationReport(tally: CalibrationTally): CalibrationReport {
  const bins = tally.binCount.length;
  const n = tally.steps;
  let ece = 0;
  const report: CalibrationBin[] = tally.binCount.map((count, b) => {
    if (!count) return { low: b / bins, high: (b + 1) / bins, count, meanPredicted: null, hitRate: null };
    const meanPredicted = tally.binPredicted[b] / count;
    const hitRate = tally.binHits[b] / count;
    ece += (count / n) * Math.abs(meanPredicted - hitRate);
    return { low: b / bins, high: (b + 1) / bins, count, meanPredicted, hitRate };
  });
  const sum = (values: number[]) => values.reduce((a, x) => a + x, 0);
  return {
    nights: tally.nights,
    steps: n,
    bins: report,
    meanPredicted: share(sum(tally.binPredicted), n),
    hitRate: share(sum(tally.binHits), n),
    brier: share(tally.squaredError, n),
    multiclassBrier: share(tally.multiclassSquaredError, n),
    ece,
  };
}

interface OddsSnapshot {
  targetOdds: number[];
  lost: number;
  drift: number;
}

interface RecordedNight {
  night: number;
  style: StyleName;
  track: number[];
  pathCells: number[];
  oddsAfterStep: OddsSnapshot[];
}

interface CoverageTally {
  nights: number;
  forecasts: number;
  trackPoints: number;
  crossedCells: number;
  insideLikely: number;
  insideCareful: number;
  timeWindowRight: number;
}

function emptyCoverage(): CoverageTally {
  return { nights: 0, forecasts: 0, trackPoints: 0, crossedCells: 0, insideLikely: 0, insideCareful: 0, timeWindowRight: 0 };
}

function addCoverage(into: CoverageTally, from: CoverageTally): void {
  into.nights += from.nights;
  into.forecasts += from.forecasts;
  into.trackPoints += from.trackPoints;
  into.crossedCells += from.crossedCells;
  into.insideLikely += from.insideLikely;
  into.insideCareful += from.insideCareful;
  into.timeWindowRight += from.timeWindowRight;
}

function coverageGroup(t: CoverageTally): CoverageGroup {
  return {
    nights: t.nights,
    forecasts: t.forecasts,
    trackPoints: t.trackPoints,
    crossedCells: t.crossedCells,
    insideLikely: share(t.insideLikely, t.trackPoints),
    insideCareful: share(t.insideCareful, t.trackPoints),
    timeWindowRight: share(t.timeWindowRight, t.crossedCells),
  };
}

function snapshotOdds(T: TellState): OddsSnapshot {
  return { targetOdds: targetOdds(T), lost: lostOnlyOdds(T), drift: driftOdds(T) };
}

export function checkpointSteps(trackLength: number, fractions: number[]): number[] {
  const steps = fractions.map((f) => Math.floor(trackLength * f)).filter((s) => s >= FIRST_CHECKPOINT_STEP && s < trackLength - 1);
  return [...new Set(steps)].sort((a, b) => a - b);
}

function forecastSeed(seed: number, night: number, step: number): number {
  return (seed * SEED_MIX_RUN + night * SEED_MIX_NIGHT + step) >>> 0;
}

function scoreCheckpoint(tally: CoverageTally, f: Forecast, night: RecordedNight, step: number, minutesPerCell: number, o: CalibrationOptions): void {
  for (let k = step + 1; k < night.track.length; k++) {
    const minutes = (night.pathCells[k] - night.pathCells[step]) * minutesPerCell;
    if (minutes > o.lookaheadMinutes) break;
    const crossing = cellCrossing(f, night.track[k], o.carefulShare);
    tally.trackPoints++;
    if (crossing.layer === 'likely') tally.insideLikely++;
    if (crossing.layer !== null) tally.insideCareful++;
    if (Number.isNaN(crossing.early)) continue;
    tally.crossedCells++;
    if (minutes >= crossing.early - o.windowSlackMinutes && minutes <= crossing.late + o.windowSlackMinutes) tally.timeWindowRight++;
  }
}

function measureCoverage(h: Harbor, recorded: RecordedNight[], styleNames: StyleName[], o: CalibrationOptions, forecast: Partial<ForecastOptions>, onProgress?: CalibrationRunOptions['onProgress']): CoverageReport {
  const byStyle = new Map<StyleName, CoverageTally>(styleNames.map((s) => [s, emptyCoverage()]));
  const minutesPerCell = h.grid.cellMeters / o.speedMps / SECONDS_PER_MINUTE;
  const plans = recorded.map((night) => ({ night, steps: checkpointSteps(night.track.length, o.checkpoints) }));
  const total = plans.reduce((a, p) => a + p.steps.length, 0);
  let done = 0;
  for (const { night, steps } of plans) {
    const tally = byStyle.get(night.style) ?? emptyCoverage();
    byStyle.set(night.style, tally);
    if (steps.length) tally.nights++;
    for (const step of steps) {
      const odds = night.oddsAfterStep[step - 1];
      const f = forecastPaths(h.grid, h.fields, { cell: night.track[step], speedMps: o.speedMps, targetOdds: odds.targetOdds, lost: odds.lost, drift: odds.drift, current: null }, { ...forecast, samples: o.forecastSamples, seed: forecastSeed(o.seed, night.night, step) });
      tally.forecasts++;
      scoreCheckpoint(tally, f, night, step, minutesPerCell, o);
      done++;
      if (onProgress) onProgress('coverage', done / total);
    }
  }
  const all = emptyCoverage();
  for (const t of byStyle.values()) addCoverage(all, t);
  const groupOf = (style: StyleName) => coverageGroup(byStyle.get(style) ?? emptyCoverage());
  return {
    samples: o.forecastSamples,
    nightsPerStyle: o.coverageNightsPerStyle,
    checkpoints: o.checkpoints,
    lookaheadMinutes: o.lookaheadMinutes,
    windowSlackMinutes: o.windowSlackMinutes,
    carefulShare: o.carefulShare,
    all: coverageGroup(all),
    direct: groupOf('direct'),
    sloppy: groupOf('sloppy'),
    decoy: groupOf('decoy'),
  };
}

export function runCalibration(h: Harbor, options: CalibrationRunOptions = {}): CalibrationStudy {
  const { settings = defaultSettings, forecast = {}, onProgress, ...overrides } = options;
  const o: CalibrationOptions = { ...calibrationDefaults(settings), ...overrides };
  const styleNames = Object.keys(settings.bench.styles) as StyleName[];
  const all = emptyTally(o.bins);
  const byStyle = new Map<StyleName, CalibrationTally>(styleNames.map((name) => [name, emptyTally(o.bins)]));
  const recorded: RecordedNight[] = [];
  const recordedPerStyle = new Map<StyleName, number>();
  let currentNight = -1;
  let recording: RecordedNight | null = null;

  const onStep = (step: BenchStep) => {
    const T = step.tell;
    const styleTally = byStyle.get(step.style) ?? emptyTally(o.bins);
    byStyle.set(step.style, styleTally);
    if (step.night !== currentNight) {
      currentNight = step.night;
      all.nights++;
      styleTally.nights++;
      recording = null;
      const taken = recordedPerStyle.get(step.style) ?? 0;
      if (taken < o.coverageNightsPerStyle) {
        recordedPerStyle.set(step.style, taken + 1);
        recording = { night: step.night, style: step.style, track: [step.from], pathCells: [0], oddsAfterStep: [] };
        recorded.push(recording);
      }
    }
    tallyPosterior(all, T.post, T.fields.length, step.goal);
    tallyPosterior(styleTally, T.post, T.fields.length, step.goal);
    if (!recording) return;
    recording.track.push(step.to);
    recording.pathCells.push(T.pathCells);
    recording.oddsAfterStep.push(snapshotOdds(T));
  };

  runNightsDetailed(h, {
    nights: o.nights, seed: o.seed, speedMps: o.speedMps, nearness: o.nearness, detection: o.detection, settings, onStep,
    onProgress: onProgress ? (f: number) => onProgress('calibration', f) : undefined,
  });
  if (onProgress) onProgress('calibration', 1);

  const reportOf = (style: StyleName) => calibrationReport(byStyle.get(style) ?? emptyTally(o.bins));
  const calibration: CalibrationSummary = { all: calibrationReport(all), direct: reportOf('direct'), sloppy: reportOf('sloppy'), decoy: reportOf('decoy') };
  const coverage = measureCoverage(h, recorded, styleNames, o, forecast, onProgress);
  return {
    seed: o.seed,
    detection: o.detection,
    speedMps: o.speedMps,
    calibration,
    coverage,
    pitch: { insideCareful: coverage.all.insideCareful, trackPoints: coverage.all.trackPoints, nights: coverage.all.nights, lookaheadMinutes: o.lookaheadMinutes },
  };
}
