import type { AisVessel } from '../shared/ais-types';
import { metersBetween, type LonLat } from './geo';
import { defaultSettings } from './settings';

export type TrafficLevel = 'normal' | 'watch' | 'anomalous';
export type TrafficAisClass = 'A' | 'B';
export type TrafficMotion = 'moving' | 'stationary';
export type TrafficFeatureKey = 'lane' | 'heading' | 'speed' | 'stopped' | 'gap' | 'course';

export interface TrafficReport {
  mmsi: number;
  at: number;
  lat: number;
  lon: number;
  sogKn: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  aisClass: TrafficAisClass;
  navStatus?: number;
  shipType?: number;
}

export interface TrafficRamp {
  from: number;
  full: number;
}

export interface TrafficTrainingOptions {
  bbox: number[][];
  cellMeters: number;
  movingKn: number;
  headingBins: number;
  smoothingSigmaCells: number;
  smoothingRadiusCells: number;
  trackBreakMinutes: number;
  longGapQuantile: number;
  densityLevels: number[];
  storageDecimals: { speed: number; heading: number; density: number; share: number };
  fallback: { speedKn: number; logSpeedSd: number; stationaryShare: number };
  trainedAtMs: number | null;
}

export interface TrafficScoringOptions {
  historyWindowMinutes: number;
  headingPseudoCount: number;
  againstLaneDeg: number;
  speedPriorWeight: number;
  speedLogSdFloor: number;
  slowSideFactor: number;
  stopPriorWeight: number;
  dwellRadiusMeters: number;
  dwellFullMinutes: number;
  dwellMinFactor: number;
  gapPriorWeight: number;
  gapPriorSeconds: Record<TrafficAisClass, Record<TrafficMotion, number>>;
  stationaryGapFactor: number;
  gapMemoryMinutes: number;
  courseMinKn: number;
  courseSpreadDeg: number;
  courseHabitToleranceDeg: number;
  courseHabitReports: number;
  courseExemptFactor: number;
  towingNavStatuses: number[];
  tugShipTypes: number[];
  ramps: Record<TrafficFeatureKey, TrafficRamp>;
  weights: Record<TrafficFeatureKey, number>;
  watchAt: number;
  anomalousAt: number;
  reasonMinContribution: number;
}

export interface TrafficDefaults {
  training: TrafficTrainingOptions;
  scoring: TrafficScoringOptions;
}

export type TrafficScoringOverrides = Partial<Omit<TrafficScoringOptions, 'ramps' | 'weights' | 'gapPriorSeconds'>> & {
  ramps?: Partial<Record<TrafficFeatureKey, TrafficRamp>>;
  weights?: Partial<Record<TrafficFeatureKey, number>>;
  gapPriorSeconds?: Partial<Record<TrafficAisClass, Partial<Record<TrafficMotion, number>>>>;
};

export const TRAFFIC_DEFAULTS: TrafficDefaults = {
  training: {
    bbox: defaultSettings.ais.bbox,
    cellMeters: 250,
    movingKn: 1,
    headingBins: 12,
    smoothingSigmaCells: 1,
    smoothingRadiusCells: 2,
    trackBreakMinutes: 30,
    longGapQuantile: 0.95,
    densityLevels: [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    storageDecimals: { speed: 3, heading: 2, density: 3, share: 4 },
    fallback: { speedKn: 8, logSpeedSd: 0.6, stationaryShare: 0.5 },
    trainedAtMs: null,
  },
  scoring: {
    historyWindowMinutes: 30,
    headingPseudoCount: 0.5,
    againstLaneDeg: 120,
    speedPriorWeight: 3,
    speedLogSdFloor: 0.2,
    slowSideFactor: 0.5,
    stopPriorWeight: 1,
    dwellRadiusMeters: 150,
    dwellFullMinutes: 10,
    dwellMinFactor: 0.5,
    gapPriorWeight: 30,
    gapPriorSeconds: { A: { moving: 300, stationary: 720 }, B: { moving: 600, stationary: 1260 } },
    stationaryGapFactor: 0.5,
    gapMemoryMinutes: 10,
    courseMinKn: 3,
    courseSpreadDeg: 12,
    courseHabitToleranceDeg: 25,
    courseHabitReports: 2,
    courseExemptFactor: 0.3,
    towingNavStatuses: [11, 12],
    tugShipTypes: [31, 32, 52],
    ramps: {
      lane: { from: 1.64, full: 2.58 },
      heading: { from: 1, full: 3 },
      speed: { from: 2, full: 4 },
      stopped: { from: 1, full: 3 },
      gap: { from: 1, full: 2.5 },
      course: { from: 2.5, full: 7.5 },
    },
    weights: { lane: 0.45, heading: 0.8, speed: 0.75, stopped: 0.85, gap: 0.9, course: 0.5 },
    watchAt: 0.4,
    anomalousAt: 0.7,
    reasonMinContribution: 0.25,
  },
};

export const TRAFFIC_MODEL_FORMAT = 'giveway-traffic';
export const TRAFFIC_MODEL_VERSION = 1;

export interface TrafficGapStats {
  gaps: number;
  medianSeconds: number;
  longSeconds: number;
}

export interface TrafficDensityReference {
  reports: number;
  levels: number[];
  values: number[];
}

export interface TrafficGrid {
  latMin: number;
  lonMin: number;
  latStepDeg: number;
  lonStepDeg: number;
  rows: number;
  cols: number;
  cellMeters: number;
}

export interface TrafficModelMeta {
  reports: number;
  movingReports: number;
  stationaryReports: number;
  outsideArea: number;
  vessels: number;
  movingVessels: number;
  fromMs: number;
  toMs: number;
  spanMinutes: number;
  cellMeters: number;
  cellsWithReports: number;
  trainedAtMs: number;
  trainedAt: string;
}

export interface TrafficModel {
  format: typeof TRAFFIC_MODEL_FORMAT;
  version: typeof TRAFFIC_MODEL_VERSION;
  meta: TrafficModelMeta;
  grid: TrafficGrid;
  movingKn: number;
  headingBins: number;
  smoothing: { sigmaCells: number; radiusCells: number };
  global: { stationaryShare: number; logSpeedMean: number; logSpeedSd: number };
  gaps: Record<TrafficAisClass, Record<TrafficMotion, TrafficGapStats>>;
  density: Record<TrafficMotion, TrafficDensityReference>;
  cellColumns: string[];
  cells: number[][];
}

export interface TrafficFeature {
  key: TrafficFeatureKey;
  label: string;
  value: number;
  unit: string;
  z: number;
  contribution: number;
}

export interface TrafficScore {
  score: number;
  level: TrafficLevel;
  reasons: string[];
  features: TrafficFeature[];
  nearbyReports: number;
}

const FULL_CIRCLE_DEG = 360;
const HALF_CIRCLE_DEG = 180;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const DEGREES_OF_LATITUDE_PROBE = 1;
const DISPLAY_DECIMALS = 2;
const SCORE_DECIMALS = 3;
const WHOLE_KNOTS_FROM = 3;

const COL_CELL = 0;
const COL_REPORTS = 1;
const COL_MOVING = 2;
const COL_STATIONARY = 3;
const COL_LOG_SPEED_SUM = 4;
const COL_LOG_SPEED_SQUARE_SUM = 5;
const COL_HEADING = 6;

const NORMAL_TAIL_C = [2.515517, 0.802853, 0.010328];
const NORMAL_TAIL_D = [1.432788, 0.189269, 0.001308];
const MEDIAN_TAIL = 0.5;

function headingColumns(bins: number): string[] {
  return Array.from({ length: bins }, (_, bin) => `heading${bin}`);
}

function cellColumnsFor(bins: number): string[] {
  return ['cell', 'reports', 'moving', 'stationary', 'logSpeedSum', 'logSpeedSquareSum', ...headingColumns(bins)];
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function ramp(value: number, range: TrafficRamp): number {
  if (range.full === range.from) return value >= range.full ? 1 : 0;
  return clamp01((value - range.from) / (range.full - range.from));
}

function normalizeDeg(deg: number): number {
  return ((deg % FULL_CIRCLE_DEG) + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG;
}

function angleBetween(a: number, b: number): number {
  const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return diff > HALF_CIRCLE_DEG ? FULL_CIRCLE_DEG - diff : diff;
}

function upperTailDeviate(tail: number): number {
  if (!(tail < MEDIAN_TAIL)) return 0;
  const t = Math.sqrt(-2 * Math.log(Math.max(tail, Number.MIN_VALUE)));
  const numerator = NORMAL_TAIL_C[0] + NORMAL_TAIL_C[1] * t + NORMAL_TAIL_C[2] * t * t;
  const denominator = 1 + NORMAL_TAIL_D[0] * t + NORMAL_TAIL_D[1] * t * t + NORMAL_TAIL_D[2] * t * t * t;
  return Math.max(0, t - numerator / denominator);
}

function quantileOfSorted(sorted: number[], level: number): number {
  if (sorted.length === 0) return 0;
  const position = clamp01(level) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function motionOf(movingKn: number, sogKn: number | null): TrafficMotion | null {
  if (sogKn === null || !Number.isFinite(sogKn)) return null;
  return sogKn > movingKn ? 'moving' : 'stationary';
}

function travelDirection(report: TrafficReport): number | null {
  if (report.cogDeg !== null && Number.isFinite(report.cogDeg)) return normalizeDeg(report.cogDeg);
  if (report.headingDeg !== null && Number.isFinite(report.headingDeg)) return normalizeDeg(report.headingDeg);
  return null;
}

function isUsableReport(report: TrafficReport): boolean {
  return Number.isFinite(report.at) && Number.isFinite(report.lat) && Number.isFinite(report.lon) && Number.isFinite(report.mmsi);
}

function compareReports(a: TrafficReport, b: TrafficReport): number {
  return a.at - b.at || a.mmsi - b.mmsi || a.lat - b.lat || a.lon - b.lon || (a.sogKn ?? -1) - (b.sogKn ?? -1) || (a.cogDeg ?? -1) - (b.cogDeg ?? -1);
}

function gridFor(bbox: number[][], cellMeters: number): TrafficGrid {
  const latMin = Math.min(bbox[0][0], bbox[1][0]);
  const latMax = Math.max(bbox[0][0], bbox[1][0]);
  const lonMin = Math.min(bbox[0][1], bbox[1][1]);
  const lonMax = Math.max(bbox[0][1], bbox[1][1]);
  const latMid = (latMin + latMax) / 2;
  const metersPerDegLat = metersBetween([lonMin, latMid], [lonMin, latMid + DEGREES_OF_LATITUDE_PROBE]);
  const metersPerDegLon = metersBetween([lonMin, latMid], [lonMin + DEGREES_OF_LATITUDE_PROBE, latMid]);
  const latStepDeg = cellMeters / metersPerDegLat;
  const lonStepDeg = cellMeters / metersPerDegLon;
  return {
    latMin,
    lonMin,
    latStepDeg,
    lonStepDeg,
    rows: Math.max(1, Math.ceil((latMax - latMin) / latStepDeg)),
    cols: Math.max(1, Math.ceil((lonMax - lonMin) / lonStepDeg)),
    cellMeters,
  };
}

export function trafficCellIndex(grid: TrafficGrid, lat: number, lon: number): number {
  const row = Math.floor((lat - grid.latMin) / grid.latStepDeg);
  const col = Math.floor((lon - grid.lonMin) / grid.lonStepDeg);
  if (!(row >= 0 && row < grid.rows && col >= 0 && col < grid.cols)) return -1;
  return row * grid.cols + col;
}

interface KernelOffset {
  dRow: number;
  dCol: number;
  weight: number;
}

function kernelFor(sigmaCells: number, radiusCells: number): KernelOffset[] {
  const offsets: KernelOffset[] = [];
  const radius = Math.max(0, Math.floor(radiusCells));
  const twoSigmaSquared = 2 * Math.max(sigmaCells, Number.EPSILON) ** 2;
  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      offsets.push({ dRow, dCol, weight: Math.exp(-(dRow * dRow + dCol * dCol) / twoSigmaSquared) });
    }
  }
  return offsets;
}

function forEachNeighbor(grid: TrafficGrid, kernel: KernelOffset[], cell: number, visit: (neighbor: number, weight: number) => void): void {
  const row = Math.floor(cell / grid.cols);
  const col = cell - row * grid.cols;
  for (const offset of kernel) {
    const r = row + offset.dRow;
    const c = col + offset.dCol;
    if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue;
    visit(r * grid.cols + c, offset.weight);
  }
}

interface PreparedTraffic {
  bins: number;
  reports: Float64Array;
  moving: Float64Array;
  stationary: Float64Array;
  logSpeedSum: Float64Array;
  logSpeedSquareSum: Float64Array;
  heading: Float64Array;
}

function smoothCells(grid: TrafficGrid, bins: number, smoothing: { sigmaCells: number; radiusCells: number }, cells: number[][]): PreparedTraffic {
  const size = grid.rows * grid.cols;
  const prepared: PreparedTraffic = {
    bins,
    reports: new Float64Array(size),
    moving: new Float64Array(size),
    stationary: new Float64Array(size),
    logSpeedSum: new Float64Array(size),
    logSpeedSquareSum: new Float64Array(size),
    heading: new Float64Array(size * bins),
  };
  const kernel = kernelFor(smoothing.sigmaCells, smoothing.radiusCells);
  for (const cell of cells) {
    forEachNeighbor(grid, kernel, cell[COL_CELL], (neighbor, weight) => {
      prepared.reports[neighbor] += weight * cell[COL_REPORTS];
      prepared.moving[neighbor] += weight * cell[COL_MOVING];
      prepared.stationary[neighbor] += weight * cell[COL_STATIONARY];
      prepared.logSpeedSum[neighbor] += weight * cell[COL_LOG_SPEED_SUM];
      prepared.logSpeedSquareSum[neighbor] += weight * cell[COL_LOG_SPEED_SQUARE_SUM];
      const base = neighbor * bins;
      for (let bin = 0; bin < bins; bin++) prepared.heading[base + bin] += weight * cell[COL_HEADING + bin];
    });
  }
  return prepared;
}

const preparedModels = new WeakMap<TrafficModel, PreparedTraffic>();

export function prepareTrafficModel(model: TrafficModel): void {
  preparedFor(model);
}

function preparedFor(model: TrafficModel): PreparedTraffic {
  let prepared = preparedModels.get(model);
  if (!prepared) {
    prepared = smoothCells(model.grid, model.headingBins, model.smoothing, model.cells);
    preparedModels.set(model, prepared);
  }
  return prepared;
}

interface RawCell {
  reports: number;
  moving: number;
  stationary: number;
  logSpeedSum: number;
  logSpeedSquareSum: number;
  heading: number[];
}

interface VesselCellCount {
  reports: number;
  moving: number;
}

function addHeading(heading: number[], direction: number, bins: number): void {
  const position = (direction / FULL_CIRCLE_DEG) * bins;
  const lowerRaw = Math.floor(position);
  const fraction = position - lowerRaw;
  const lower = ((lowerRaw % bins) + bins) % bins;
  const upper = (lower + 1) % bins;
  heading[lower] += 1 - fraction;
  heading[upper] += fraction;
}

function densityReference(values: number[], levels: number[], decimals: number): TrafficDensityReference {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { reports: 0, levels: [], values: [] };
  return {
    reports: sorted.length,
    levels: [...levels],
    values: levels.map((level) => roundTo(quantileOfSorted(sorted, level), decimals)),
  };
}

function gapStats(gapsSeconds: number[], longQuantile: number): TrafficGapStats {
  const sorted = [...gapsSeconds].sort((a, b) => a - b);
  return {
    gaps: sorted.length,
    medianSeconds: roundTo(quantileOfSorted(sorted, MEDIAN_TAIL), 1),
    longSeconds: roundTo(quantileOfSorted(sorted, longQuantile), 1),
  };
}

function resolveTraining(overrides: Partial<TrafficTrainingOptions> | undefined): TrafficTrainingOptions {
  const base = TRAFFIC_DEFAULTS.training;
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    storageDecimals: { ...base.storageDecimals, ...overrides.storageDecimals },
    fallback: { ...base.fallback, ...overrides.fallback },
  };
}

export function trainTrafficModel(reports: TrafficReport[], overrides?: Partial<TrafficTrainingOptions>): TrafficModel {
  const options = resolveTraining(overrides);
  const bins = options.headingBins;
  const decimals = options.storageDecimals;
  const grid = gridFor(options.bbox, options.cellMeters);
  const ordered = reports.filter(isUsableReport).sort(compareReports);

  const rawCells = new Map<number, RawCell>();
  const vesselCells = new Map<number, Map<number, VesselCellCount>>();
  const tracks = new Map<number, TrafficReport[]>();
  const movingVessels = new Set<number>();
  const logSpeeds: number[] = [];
  let inside = 0;
  let outside = 0;
  let movingReports = 0;
  let stationaryReports = 0;

  for (const report of ordered) {
    let track = tracks.get(report.mmsi);
    if (!track) {
      track = [];
      tracks.set(report.mmsi, track);
    }
    track.push(report);

    const cell = trafficCellIndex(grid, report.lat, report.lon);
    if (cell < 0) {
      outside++;
      continue;
    }
    inside++;
    let raw = rawCells.get(cell);
    if (!raw) {
      raw = { reports: 0, moving: 0, stationary: 0, logSpeedSum: 0, logSpeedSquareSum: 0, heading: new Array<number>(bins).fill(0) };
      rawCells.set(cell, raw);
    }
    let own = vesselCells.get(report.mmsi);
    if (!own) {
      own = new Map();
      vesselCells.set(report.mmsi, own);
    }
    let ownCell = own.get(cell);
    if (!ownCell) {
      ownCell = { reports: 0, moving: 0 };
      own.set(cell, ownCell);
    }
    raw.reports++;
    ownCell.reports++;

    const motion = motionOf(options.movingKn, report.sogKn);
    if (motion === 'stationary') {
      raw.stationary++;
      stationaryReports++;
    }
    if (motion === 'moving' && report.sogKn !== null) {
      const logSpeed = Math.log(report.sogKn);
      raw.moving++;
      ownCell.moving++;
      raw.logSpeedSum += logSpeed;
      raw.logSpeedSquareSum += logSpeed * logSpeed;
      logSpeeds.push(logSpeed);
      movingReports++;
      movingVessels.add(report.mmsi);
      const direction = travelDirection(report);
      if (direction !== null) addHeading(raw.heading, direction, bins);
    }
  }

  const cells: number[][] = [...rawCells.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cell, raw]) => [
      cell,
      raw.reports,
      raw.moving,
      raw.stationary,
      roundTo(raw.logSpeedSum, decimals.speed),
      roundTo(raw.logSpeedSquareSum, decimals.speed),
      ...raw.heading.map((count) => roundTo(count, decimals.heading)),
    ]);

  const smoothing = { sigmaCells: options.smoothingSigmaCells, radiusCells: options.smoothingRadiusCells };
  const smoothed = smoothCells(grid, bins, smoothing, cells);
  const kernel = kernelFor(smoothing.sigmaCells, smoothing.radiusCells);
  const movingDensities: number[] = [];
  const stationaryDensities: number[] = [];
  for (const [mmsi, track] of tracks) {
    const own = vesselCells.get(mmsi);
    if (!own) continue;
    const ownDensity = new Map<number, VesselCellCount>();
    for (const report of track) {
      const cell = trafficCellIndex(grid, report.lat, report.lon);
      if (cell < 0) continue;
      let mine = ownDensity.get(cell);
      if (!mine) {
        const sum: VesselCellCount = { reports: 0, moving: 0 };
        forEachNeighbor(grid, kernel, cell, (neighbor, weight) => {
          const count = own.get(neighbor);
          if (!count) return;
          sum.reports += weight * count.reports;
          sum.moving += weight * count.moving;
        });
        mine = sum;
        ownDensity.set(cell, mine);
      }
      const motion = motionOf(options.movingKn, report.sogKn);
      if (motion === 'moving') movingDensities.push(Math.max(0, smoothed.moving[cell] - mine.moving));
      if (motion === 'stationary') stationaryDensities.push(Math.max(0, smoothed.reports[cell] - mine.reports));
    }
  }

  const gapSamples: Record<TrafficAisClass, Record<TrafficMotion, number[]>> = {
    A: { moving: [], stationary: [] },
    B: { moving: [], stationary: [] },
  };
  const trackBreakMs = options.trackBreakMinutes * MS_PER_MINUTE;
  for (const track of tracks.values()) {
    for (let i = 1; i < track.length; i++) {
      const previous = track[i - 1];
      const gapMs = track[i].at - previous.at;
      const motion = motionOf(options.movingKn, previous.sogKn);
      if (gapMs <= 0 || gapMs > trackBreakMs || motion === null) continue;
      gapSamples[previous.aisClass === 'B' ? 'B' : 'A'][motion].push(gapMs / MS_PER_SECOND);
    }
  }

  const knownMotion = movingReports + stationaryReports;
  const logSpeedMean = logSpeeds.length > 0 ? logSpeeds.reduce((sum, value) => sum + value, 0) / logSpeeds.length : Math.log(options.fallback.speedKn);
  const logSpeedVariance = logSpeeds.length > 1
    ? logSpeeds.reduce((sum, value) => sum + (value - logSpeedMean) ** 2, 0) / (logSpeeds.length - 1)
    : options.fallback.logSpeedSd ** 2;

  const fromMs = ordered.length > 0 ? ordered[0].at : 0;
  const toMs = ordered.length > 0 ? ordered[ordered.length - 1].at : 0;
  const trainedAtMs = options.trainedAtMs ?? toMs;

  return {
    format: TRAFFIC_MODEL_FORMAT,
    version: TRAFFIC_MODEL_VERSION,
    meta: {
      reports: inside,
      movingReports,
      stationaryReports,
      outsideArea: outside,
      vessels: vesselCells.size,
      movingVessels: movingVessels.size,
      fromMs,
      toMs,
      spanMinutes: roundTo((toMs - fromMs) / MS_PER_MINUTE, 1),
      cellMeters: options.cellMeters,
      cellsWithReports: cells.length,
      trainedAtMs,
      trainedAt: new Date(trainedAtMs).toISOString(),
    },
    grid,
    movingKn: options.movingKn,
    headingBins: bins,
    smoothing,
    global: {
      stationaryShare: roundTo(knownMotion > 0 ? stationaryReports / knownMotion : options.fallback.stationaryShare, decimals.share),
      logSpeedMean: roundTo(logSpeedMean, decimals.speed),
      logSpeedSd: roundTo(Math.sqrt(logSpeedVariance), decimals.speed),
    },
    gaps: {
      A: { moving: gapStats(gapSamples.A.moving, options.longGapQuantile), stationary: gapStats(gapSamples.A.stationary, options.longGapQuantile) },
      B: { moving: gapStats(gapSamples.B.moving, options.longGapQuantile), stationary: gapStats(gapSamples.B.stationary, options.longGapQuantile) },
    },
    density: {
      moving: densityReference(movingDensities, options.densityLevels, decimals.density),
      stationary: densityReference(stationaryDensities, options.densityLevels, decimals.density),
    },
    cellColumns: cellColumnsFor(bins),
    cells,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadTrafficModel(json: unknown): TrafficModel {
  if (!isRecord(json) || json.format !== TRAFFIC_MODEL_FORMAT) throw new Error('This file is not a Foresea traffic model.');
  if (json.version !== TRAFFIC_MODEL_VERSION) throw new Error(`Traffic model version ${String(json.version)} is not supported; expected ${TRAFFIC_MODEL_VERSION}.`);
  if (!isRecord(json.grid) || !isRecord(json.meta) || !isRecord(json.gaps) || !isRecord(json.density) || !Array.isArray(json.cells)) {
    throw new Error('The traffic model is missing its grid, meta, gaps, density or cells.');
  }
  const bins = json.headingBins;
  if (typeof bins !== 'number' || !json.cells.every((cell) => Array.isArray(cell) && cell.length === COL_HEADING + bins)) {
    throw new Error('The traffic model cells do not match its heading bins.');
  }
  return json as unknown as TrafficModel;
}

export function trafficReportFromVessel(vessel: AisVessel): TrafficReport {
  return {
    mmsi: vessel.mmsi,
    at: vessel.lastSeen,
    lat: vessel.lat,
    lon: vessel.lon,
    sogKn: vessel.sogKn,
    cogDeg: vessel.cogDeg,
    headingDeg: vessel.headingDeg,
    aisClass: vessel.aisClass,
    navStatus: vessel.navStatus.code,
    shipType: vessel.shipType,
  };
}

export function rememberReport(history: TrafficReport[], report: TrafficReport, windowMinutes = TRAFFIC_DEFAULTS.scoring.historyWindowMinutes): TrafficReport[] {
  const last = history[history.length - 1];
  const isNewer = !last || report.at > last.at;
  const newest = isNewer ? report.at : last.at;
  const kept = history.filter((past) => past.at >= newest - windowMinutes * MS_PER_MINUTE);
  if (isNewer) kept.push(report);
  return kept;
}

function resolveScoring(overrides: TrafficScoringOverrides | undefined): TrafficScoringOptions {
  const base = TRAFFIC_DEFAULTS.scoring;
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    ramps: { ...base.ramps, ...overrides.ramps },
    weights: { ...base.weights, ...overrides.weights },
    gapPriorSeconds: {
      A: { ...base.gapPriorSeconds.A, ...overrides.gapPriorSeconds?.A },
      B: { ...base.gapPriorSeconds.B, ...overrides.gapPriorSeconds?.B },
    },
  };
}

function recentHistory(current: TrafficReport, history: TrafficReport[], windowMs: number): TrafficReport[] {
  const oldest = current.at - windowMs;
  const recent: TrafficReport[] = [];
  let sorted = true;
  for (const past of history) {
    if (past.at >= current.at || past.at < oldest || !isUsableReport(past)) continue;
    if (recent.length > 0 && past.at < recent[recent.length - 1].at) sorted = false;
    recent.push(past);
  }
  if (!sorted) recent.sort((a, b) => a.at - b.at);
  return recent;
}

interface FeatureResult {
  key: TrafficFeatureKey;
  label: string;
  value: number;
  unit: string;
  z: number;
  anomaly: number;
  reason: string;
}

interface ScoringContext {
  model: TrafficModel;
  prepared: PreparedTraffic;
  options: TrafficScoringOptions;
  current: TrafficReport;
  recent: TrafficReport[];
  nowMs: number;
  motion: TrafficMotion | null;
  cell: number;
}

function densityTail(reference: TrafficDensityReference, density: number): number {
  const { levels, values, reports } = reference;
  if (reports === 0 || values.length === 0) return 1;
  const floor = 1 / (reports + 1);
  if (density >= values[values.length - 1]) return 1;
  let index = -1;
  for (let i = 0; i < values.length; i++) if (values[i] <= density) index = i;
  if (index < 0) return floor;
  const span = values[index + 1] - values[index];
  const fraction = span > 0 ? (density - values[index]) / span : 0;
  return Math.max(floor, levels[index] + (levels[index + 1] - levels[index]) * fraction);
}

function laneFeature(context: ScoringContext): FeatureResult | null {
  const { motion, cell, prepared, model, options } = context;
  if (motion === null || cell < 0) return null;
  const density = motion === 'moving' ? prepared.moving[cell] : prepared.reports[cell];
  const z = upperTailDeviate(densityTail(model.density[motion], density));
  return {
    key: 'lane',
    label: motion === 'moving' ? 'Moving ships seen near this position' : 'Ships seen near this position',
    value: density,
    unit: 'reports',
    z,
    anomaly: ramp(z, options.ramps.lane),
    reason: motion === 'moving' ? 'Outside the lanes this traffic normally uses' : 'Stopped where ships are rarely seen',
  };
}

function headingProbability(counts: Float64Array, base: number, bins: number, total: number, pseudoCount: number, direction: number): number {
  const position = (direction / FULL_CIRCLE_DEG) * bins;
  const lowerRaw = Math.floor(position);
  const fraction = position - lowerRaw;
  const lower = ((lowerRaw % bins) + bins) % bins;
  const upper = (lower + 1) % bins;
  const denominator = total + bins * pseudoCount;
  const lowerShare = (counts[base + lower] + pseudoCount) / denominator;
  const upperShare = (counts[base + upper] + pseudoCount) / denominator;
  return lowerShare * (1 - fraction) + upperShare * fraction;
}

function headingFeature(context: ScoringContext): FeatureResult | null {
  const { motion, cell, prepared, options, current } = context;
  const direction = travelDirection(current);
  if (motion !== 'moving' || direction === null || cell < 0) return null;
  const bins = prepared.bins;
  const base = cell * bins;
  let total = 0;
  let busiestBin = 0;
  for (let bin = 0; bin < bins; bin++) {
    total += prepared.heading[base + bin];
    if (prepared.heading[base + bin] > prepared.heading[base + busiestBin]) busiestBin = bin;
  }
  const share = headingProbability(prepared.heading, base, bins, total, options.headingPseudoCount, direction);
  const likelihoodAgainstRandom = share * bins;
  const z = Math.max(0, -Math.log2(likelihoodAgainstRandom));
  const usualDirection = (busiestBin * FULL_CIRCLE_DEG) / bins;
  const against = angleBetween(direction, usualDirection) >= options.againstLaneDeg;
  return {
    key: 'heading',
    label: 'How common this heading is here, against a random heading',
    value: likelihoodAgainstRandom,
    unit: 'times random',
    z,
    anomaly: ramp(z, options.ramps.heading),
    reason: against ? 'Heading against the usual traffic in this lane' : 'Heading across the usual traffic here',
  };
}

function formatKnots(knots: number): string {
  return knots >= WHOLE_KNOTS_FROM ? String(Math.round(knots)) : knots.toFixed(1);
}

function speedFeature(context: ScoringContext): FeatureResult | null {
  const { motion, cell, prepared, options, model, current } = context;
  if (motion !== 'moving' || current.sogKn === null) return null;
  const moving = cell < 0 ? 0 : prepared.moving[cell];
  const sum = cell < 0 ? 0 : prepared.logSpeedSum[cell];
  const squareSum = cell < 0 ? 0 : prepared.logSpeedSquareSum[cell];
  const prior = options.speedPriorWeight;
  const globalMean = model.global.logSpeedMean;
  const globalSd = model.global.logSpeedSd;
  const weight = moving + prior;
  const mean = (sum + prior * globalMean) / weight;
  const spread = Math.max(0, squareSum - 2 * mean * sum + moving * mean * mean);
  const variance = (spread + prior * (globalSd * globalSd + (globalMean - mean) ** 2)) / weight;
  const sd = Math.max(Math.sqrt(variance), options.speedLogSdFloor);
  const signed = (Math.log(current.sogKn) - mean) / sd;
  const z = signed >= 0 ? signed : -signed * options.slowSideFactor;
  const low = formatKnots(Math.exp(mean - sd));
  const high = formatKnots(Math.exp(mean + sd));
  const usual = low === high ? `about ${low} kn` : `${low} to ${high} kn`;
  return {
    key: 'speed',
    label: 'Speed against ships here',
    value: current.sogKn,
    unit: 'kn',
    z,
    anomaly: ramp(z, options.ramps.speed),
    reason: `Speed ${formatKnots(current.sogKn)} kn where ships here make ${usual}`,
  };
}

function lonLatOf(report: TrafficReport): LonLat {
  return [report.lon, report.lat];
}

function dwellMinutes(context: ScoringContext): number {
  const { current, recent, options, model, nowMs } = context;
  let earliest = current.at;
  const here = lonLatOf(current);
  for (let i = recent.length - 1; i >= 0; i--) {
    const past = recent[i];
    if (motionOf(model.movingKn, past.sogKn) !== 'stationary') break;
    if (metersBetween(here, lonLatOf(past)) > options.dwellRadiusMeters) break;
    earliest = past.at;
  }
  return Math.max(0, Math.max(nowMs, current.at) - earliest) / MS_PER_MINUTE;
}

function minutesText(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes));
  return `${whole} minute${whole === 1 ? '' : 's'}`;
}

function stoppedFeature(context: ScoringContext): FeatureResult | null {
  const { motion, cell, prepared, options, model } = context;
  if (motion !== 'stationary' || cell < 0) return null;
  const known = prepared.moving[cell] + prepared.stationary[cell];
  const harborShare = model.global.stationaryShare;
  const localShare = (prepared.stationary[cell] + options.stopPriorWeight * harborShare) / (known + options.stopPriorWeight);
  const z = localShare > 0 && harborShare > 0 ? Math.max(0, Math.log2(harborShare / localShare)) : 0;
  const dwell = dwellMinutes(context);
  const dwellFactor = options.dwellMinFactor + (1 - options.dwellMinFactor) * clamp01(dwell / options.dwellFullMinutes);
  const stoppedFor = dwell >= 1 ? ` for ${minutesText(dwell)}` : '';
  return {
    key: 'stopped',
    label: 'Share of ships that stop here',
    value: localShare,
    unit: 'share',
    z,
    anomaly: ramp(z, options.ramps.stopped) * dwellFactor,
    reason: `Stopped${stoppedFor} in a lane where ships keep moving`,
  };
}

function expectedGapSeconds(model: TrafficModel, options: TrafficScoringOptions, aisClass: TrafficAisClass, motion: TrafficMotion): number {
  const learned = model.gaps[aisClass]?.[motion];
  const prior = options.gapPriorSeconds[aisClass][motion];
  const samples = learned?.gaps ?? 0;
  const learnedSeconds = learned?.longSeconds ?? prior;
  return (samples * learnedSeconds + options.gapPriorWeight * prior) / (samples + options.gapPriorWeight);
}

interface SilenceCandidate {
  minutes: number;
  ratio: number;
  motion: TrafficMotion;
  ongoing: boolean;
  anomaly: number;
}

function gapFeature(context: ScoringContext): FeatureResult {
  const { current, recent, nowMs, model, options } = context;
  const classOf = (report: TrafficReport): TrafficAisClass => (report.aisClass === 'B' ? 'B' : 'A');
  const motionFor = (report: TrafficReport): TrafficMotion => motionOf(model.movingKn, report.sogKn) ?? 'stationary';
  const candidate = (before: TrafficReport, gapMs: number, ongoing: boolean, endedAt: number): SilenceCandidate => {
    const motion = motionFor(before);
    const ratio = gapMs / MS_PER_SECOND / expectedGapSeconds(model, options, classOf(before), motion);
    const motionFactor = motion === 'moving' ? 1 : options.stationaryGapFactor;
    const sinceEnded = Math.max(0, nowMs - endedAt) / MS_PER_MINUTE;
    const memoryFactor = ongoing ? 1 : clamp01(1 - sinceEnded / options.gapMemoryMinutes);
    return { minutes: gapMs / MS_PER_MINUTE, ratio, motion, ongoing, anomaly: ramp(ratio, options.ramps.gap) * motionFactor * memoryFactor };
  };
  let worst = candidate(current, Math.max(0, nowMs - current.at), true, nowMs);
  const chain = [...recent, current];
  for (let i = 1; i < chain.length; i++) {
    const past = candidate(chain[i - 1], chain[i].at - chain[i - 1].at, false, chain[i].at);
    if (past.anomaly > worst.anomaly) worst = past;
  }
  const state = worst.motion === 'moving' ? 'while under way' : 'while stopped';
  const reason = worst.ongoing
    ? `No AIS report for ${minutesText(worst.minutes)} ${state}`
    : `Went ${minutesText(worst.minutes)} without an AIS report ${state}`;
  return {
    key: 'gap',
    label: 'Longest silence against the usual reporting interval',
    value: worst.minutes,
    unit: 'minutes',
    z: worst.ratio,
    anomaly: worst.anomaly,
    reason,
  };
}

function courseOffset(report: TrafficReport): number | null {
  if (report.cogDeg === null || report.headingDeg === null) return null;
  if (!Number.isFinite(report.cogDeg) || !Number.isFinite(report.headingDeg)) return null;
  return angleBetween(report.cogDeg, report.headingDeg);
}

function courseFeature(context: ScoringContext): FeatureResult | null {
  const { motion, current, options, recent, model } = context;
  const offset = courseOffset(current);
  if (motion !== 'moving' || offset === null || current.sogKn === null || current.sogKn < options.courseMinKn) return null;
  let matchingPast = 0;
  for (const past of recent) {
    const pastOffset = courseOffset(past);
    if (pastOffset === null || motionOf(model.movingKn, past.sogKn) !== 'moving') continue;
    if (Math.abs(pastOffset - offset) <= options.courseHabitToleranceDeg) matchingPast++;
  }
  const habitual = matchingPast >= options.courseHabitReports;
  const towing = current.navStatus !== undefined && options.towingNavStatuses.includes(current.navStatus);
  const tug = current.shipType !== undefined && options.tugShipTypes.includes(current.shipType);
  const factor = habitual || towing || tug ? options.courseExemptFactor : 1;
  const z = offset / options.courseSpreadDeg;
  return {
    key: 'course',
    label: 'Course over ground against the bow heading',
    value: offset,
    unit: 'degrees',
    z,
    anomaly: ramp(z, options.ramps.course) * factor,
    reason: `Course ${Math.round(offset)} degrees off its heading while under way`,
  };
}

function levelFor(score: number, options: TrafficScoringOptions): TrafficLevel {
  if (score >= options.anomalousAt) return 'anomalous';
  if (score >= options.watchAt) return 'watch';
  return 'normal';
}

export function scoreVessel(
  model: TrafficModel,
  current: TrafficReport,
  history: TrafficReport[],
  nowMs: number,
  overrides?: TrafficScoringOverrides,
): TrafficScore {
  const options = resolveScoring(overrides);
  const prepared = preparedFor(model);
  const cell = trafficCellIndex(model.grid, current.lat, current.lon);
  const context: ScoringContext = {
    model,
    prepared,
    options,
    current,
    recent: recentHistory(current, history, options.historyWindowMinutes * MS_PER_MINUTE),
    nowMs,
    motion: motionOf(model.movingKn, current.sogKn),
    cell,
  };
  const results = [
    laneFeature(context),
    headingFeature(context),
    speedFeature(context),
    stoppedFeature(context),
    gapFeature(context),
    courseFeature(context),
  ].filter((result): result is FeatureResult => result !== null);

  let calm = 1;
  const features: TrafficFeature[] = [];
  const explained: { reason: string; contribution: number }[] = [];
  for (const result of results) {
    const contribution = clamp01(options.weights[result.key] * result.anomaly);
    calm *= 1 - contribution;
    features.push({
      key: result.key,
      label: result.label,
      value: roundTo(result.value, DISPLAY_DECIMALS),
      unit: result.unit,
      z: roundTo(result.z, DISPLAY_DECIMALS),
      contribution: roundTo(contribution, SCORE_DECIMALS),
    });
    if (contribution >= options.reasonMinContribution) explained.push({ reason: result.reason, contribution });
  }
  const score = roundTo(clamp01(1 - calm), SCORE_DECIMALS);
  const level = levelFor(score, options);
  const reasons = level === 'normal' ? [] : explained.sort((a, b) => b.contribution - a.contribution).map((entry) => entry.reason);
  return { score, level, reasons, features, nearbyReports: roundTo(cell < 0 ? 0 : prepared.reports[cell], DISPLAY_DECIMALS) };
}
