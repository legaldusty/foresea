import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAisMessage } from '../server/ais/normalize';
import { RECORDINGS_DIR } from '../server/ais/replay';
import {
  loadTrafficModel,
  scoreVessel,
  trainTrafficModel,
  TRAFFIC_DEFAULTS,
  type TrafficLevel,
  type TrafficModel,
  type TrafficReport,
  type TrafficScore,
} from '../src/engine/traffic';

const MODEL_PATH = fileURLToPath(new URL('../src/data/traffic_model.json', import.meta.url));
const MAX_MODEL_BYTES = 300 * 1024;
const TRAIN_SHARE = 0.7;
const INJECTED_GAP_MINUTES = 15;
const STOP_MINUTES = 10;
const STOP_REPORTS = 4;
const TIMING_CALLS = 100_000;
const HISTORY_KEEP = 60;
const MS_PER_MINUTE = 60_000;
const HALF_TURN_DEG = 180;
const FULL_TURN_DEG = 360;
const FEED_SILENCE_NOTE_MINUTES = 2;
const TOP_REASONS = 6;
const MEDIAN_LEVEL = 0.5;

interface Corpus {
  reports: TrafficReport[];
  files: { file: string; lines: number; kept: number; note: string }[];
  longestFeedSilenceMinutes: number;
}

function readCorpus(dir: string): Corpus {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort() : [];
  const seenFiles = new Map<string, string>();
  const seenLines = new Set<string>();
  const shipTypes = new Map<number, number>();
  const positions: TrafficReport[] = [];
  const files: Corpus['files'] = [];
  let longestFeedSilenceMs = 0;

  for (const name of names) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const digest = crypto.createHash('sha256').update(text).digest('hex');
    const twin = seenFiles.get(digest);
    const lines = text.split('\n').filter((line) => line.trim());
    if (twin) {
      files.push({ file: name, lines: lines.length, kept: 0, note: `same bytes as ${twin}, skipped` });
      continue;
    }
    seenFiles.set(digest, name);
    let kept = 0;
    let previousAt: number | null = null;
    for (const line of lines) {
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      let parsed: { t?: unknown; m?: unknown };
      try {
        parsed = JSON.parse(line) as { t?: unknown; m?: unknown };
      } catch {
        continue;
      }
      if (typeof parsed.t !== 'number') continue;
      if (previousAt !== null) longestFeedSilenceMs = Math.max(longestFeedSilenceMs, parsed.t - previousAt);
      previousAt = parsed.t;
      const update = parseAisMessage(parsed.m, parsed.t);
      if (!update) continue;
      if (update.kind === 'static') {
        if (update.shipType) shipTypes.set(update.mmsi, update.shipType);
        continue;
      }
      if (!update.position) continue;
      kept++;
      positions.push({
        mmsi: update.mmsi,
        at: update.at,
        lat: update.position.lat,
        lon: update.position.lon,
        sogKn: update.sogKn ?? null,
        cogDeg: update.cogDeg ?? null,
        headingDeg: update.headingDeg ?? null,
        aisClass: update.aisClass ?? 'A',
        navStatus: update.navStatus,
      });
    }
    files.push({ file: name, lines: lines.length, kept, note: '' });
  }

  const unique = new Map<string, TrafficReport>();
  for (const report of positions) {
    const key = `${report.mmsi}|${report.at}|${report.lat}|${report.lon}`;
    if (!unique.has(key)) unique.set(key, { ...report, shipType: shipTypes.get(report.mmsi) });
  }
  const reports = [...unique.values()].sort((a, b) => a.at - b.at || a.mmsi - b.mmsi);
  return { reports, files, longestFeedSilenceMinutes: longestFeedSilenceMs / MS_PER_MINUTE };
}

function tracksOf(reports: TrafficReport[]): Map<number, TrafficReport[]> {
  const tracks = new Map<number, TrafficReport[]>();
  for (const report of reports) {
    const track = tracks.get(report.mmsi) ?? [];
    track.push(report);
    tracks.set(report.mmsi, track);
  }
  for (const track of tracks.values()) track.sort((a, b) => a.at - b.at);
  return tracks;
}

function historyBefore(track: TrafficReport[], index: number): TrafficReport[] {
  return track.slice(Math.max(0, index - HISTORY_KEEP), index);
}

const isMoving = (model: TrafficModel, report: TrafficReport) => report.sogKn !== null && report.sogKn > model.movingKn;
const flagged = (score: TrafficScore) => score.level !== 'normal';
const percent = (part: number, whole: number) => (whole === 0 ? '-' : `${((100 * part) / whole).toFixed(1)}%`);
const whole = (value: number) => value.toLocaleString('en-US');
const turn = (deg: number | null) => (deg === null ? null : (deg + HALF_TURN_DEG) % FULL_TURN_DEG);

interface Tally {
  scored: number;
  watch: number;
  anomalous: number;
  reasons: Map<string, number>;
}

function newTally(): Tally {
  return { scored: 0, watch: 0, anomalous: 0, reasons: new Map() };
}

function count(tally: Tally, score: TrafficScore): void {
  tally.scored++;
  const level: TrafficLevel = score.level;
  if (level === 'watch') tally.watch++;
  if (level === 'anomalous') tally.anomalous++;
  for (const reason of score.reasons) {
    const general = reason.replace(/\d+(\.\d+)?/g, 'N');
    tally.reasons.set(general, (tally.reasons.get(general) ?? 0) + 1);
  }
}

function tallyLine(label: string, tally: Tally): string {
  const caught = tally.watch + tally.anomalous;
  return `| ${label} | ${whole(tally.scored)} | ${percent(caught, tally.scored)} | ${percent(tally.anomalous, tally.scored)} |`;
}

const started = performance.now();
const corpus = readCorpus(RECORDINGS_DIR);
const readSeconds = (performance.now() - started) / 1000;
if (corpus.reports.length === 0) {
  console.log(`No AIS position reports found in ${RECORDINGS_DIR}.`);
  process.exit(1);
}

const trainStarted = performance.now();
const model = trainTrafficModel(corpus.reports, { trainedAtMs: Date.now() });
const trainMs = performance.now() - trainStarted;
const json = JSON.stringify(model);
fs.writeFileSync(MODEL_PATH, `${json}\n`);
const bytes = Buffer.byteLength(json);

const meta = model.meta;
console.log('Traffic model trained on real AIS from aisstream.io over San Pedro Bay\n');
console.log('| Recording | Lines | Position reports kept | Note |');
console.log('| --- | --- | --- | --- |');
for (const file of corpus.files) console.log(`| ${file.file} | ${whole(file.lines)} | ${whole(file.kept)} | ${file.note} |`);
console.log('');
console.log(`Sample: ${whole(meta.reports)} position reports from ${whole(meta.vessels)} vessels inside the box (${whole(meta.outsideArea)} outside).`);
console.log(`Moving (over ${model.movingKn} kn): ${whole(meta.movingReports)} reports from ${whole(meta.movingVessels)} vessels. Stopped: ${whole(meta.stationaryReports)} reports.`);
console.log(`Time covered: ${new Date(meta.fromMs).toISOString()} to ${new Date(meta.toMs).toISOString()}, ${(meta.spanMinutes / 60).toFixed(1)} hours end to end, with breaks between recordings.`);
console.log(`Grid: ${model.grid.rows} x ${model.grid.cols} cells of ${model.grid.cellMeters} m, ${whole(meta.cellsWithReports)} cells hold at least one report.`);
const gapLine = (aisClass: 'A' | 'B') =>
  (['moving', 'stationary'] as const)
    .map((motion) => {
      const stats = model.gaps[aisClass][motion];
      return `${motion} ${stats.gaps} gaps, median ${(stats.medianSeconds / 60).toFixed(1)} min, 95th ${(stats.longSeconds / 60).toFixed(1)} min`;
    })
    .join('; ');
console.log(`Feed reporting gaps, class A: ${gapLine('A')}.`);
console.log(`Feed reporting gaps, class B: ${gapLine('B')}.`);
console.log(`Longest silence of the whole feed inside one recording: ${corpus.longestFeedSilenceMinutes.toFixed(1)} min${corpus.longestFeedSilenceMinutes > FEED_SILENCE_NOTE_MINUTES ? ' (every vessel looks quiet then)' : ''}.`);
console.log(`Read ${readSeconds.toFixed(2)} s, trained in ${trainMs.toFixed(0)} ms, wrote ${path.relative(process.cwd(), MODEL_PATH)} (${(bytes / 1024).toFixed(1)} KB${bytes > MAX_MODEL_BYTES ? ', over the 300 KB budget' : ''}).\n`);

const ordered = corpus.reports;
const cutoffMs = ordered[Math.floor(ordered.length * TRAIN_SHARE)].at;
const trainPart = ordered.filter((report) => report.at < cutoffMs);
const testPart = ordered.filter((report) => report.at >= cutoffMs);
const heldOutModel = trainTrafficModel(trainPart, { trainedAtMs: cutoffMs });
const allTracks = tracksOf(ordered);
const heldOut = newTally();
const heldOutMoving = newTally();
const flaggedVessels = new Map<number, string[]>();
for (const track of allTracks.values()) {
  track.forEach((report, index) => {
    if (report.at < cutoffMs) return;
    const score = scoreVessel(heldOutModel, report, historyBefore(track, index), report.at);
    count(heldOut, score);
    if (isMoving(heldOutModel, report)) count(heldOutMoving, score);
    if (flagged(score)) flaggedVessels.set(report.mmsi, score.reasons);
  });
}
console.log(`Held-out check: trained on the first ${Math.round(TRAIN_SHARE * 100)}% by time (${whole(trainPart.length)} reports, up to ${new Date(cutoffMs).toISOString()}), scored the last ${whole(testPart.length)} real reports as they arrived.`);
console.log('| Real reports | Scored | Watch or anomalous | Anomalous |');
console.log('| --- | --- | --- | --- |');
console.log(tallyLine('All held-out reports', heldOut));
console.log(tallyLine('Held-out moving reports', heldOutMoving));
const heldOutReasons = [...heldOut.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_REASONS);
if (heldOutReasons.length > 0) console.log(`Reasons on real reports: ${heldOutReasons.map(([reason, n]) => `${reason} (${n})`).join('; ')}.`);
console.log(`Vessels flagged at least once: ${flaggedVessels.size} of ${new Set(testPart.map((report) => report.mmsi)).size}.\n`);

function medianDensity(unseen: TrafficModel): number {
  const reference = unseen.density.moving;
  const index = reference.levels.findIndex((level) => level >= MEDIAN_LEVEL);
  return index < 0 ? 0 : reference.values[index];
}

const reverseReport = (report: TrafficReport): TrafficReport => ({ ...report, cogDeg: turn(report.cogDeg), headingDeg: turn(report.headingDeg) });
const doubleReport = (report: TrafficReport): TrafficReport => ({ ...report, sogKn: report.sogKn === null ? null : report.sogKn * 2 });

const baselineMoving = newTally();
const baselineStopped = newTally();
const reversed = newTally();
const stopAll = newTally();
const stopBusy = newTally();
const silent = newTally();
const reappeared = newTally();
const doubled = newTally();
const windowMs = TRAFFIC_DEFAULTS.scoring.historyWindowMinutes * MS_PER_MINUTE;
let unseenModels = 0;
for (const [mmsi, track] of allTracks) {
  const unseen = trainTrafficModel(ordered.filter((report) => report.mmsi !== mmsi), { trainedAtMs: meta.trainedAtMs });
  unseenModels++;
  const busyLane = medianDensity(unseen);
  track.forEach((report, index) => {
    const history = historyBefore(track, index);
    if (!isMoving(unseen, report)) {
      if (report.sogKn !== null) count(baselineStopped, scoreVessel(unseen, report, history, report.at));
      return;
    }
    const plain = scoreVessel(unseen, report, history, report.at);
    count(baselineMoving, plain);

    count(reversed, scoreVessel(unseen, reverseReport(report), history.map(reverseReport), report.at));

    const stopStart = report.at - STOP_MINUTES * MS_PER_MINUTE;
    const stops: TrafficReport[] = Array.from({ length: STOP_REPORTS }, (_, k) => ({
      ...report,
      at: stopStart + (k * STOP_MINUTES * MS_PER_MINUTE) / STOP_REPORTS,
      sogKn: 0,
    }));
    const stopped = scoreVessel(unseen, { ...report, sogKn: 0 }, [...history.filter((past) => past.at < stopStart), ...stops], report.at);
    count(stopAll, stopped);
    const laneDensity = plain.features.find((feature) => feature.key === 'lane')?.value ?? 0;
    if (busyLane > 0 && laneDensity >= busyLane) count(stopBusy, stopped);

    count(silent, scoreVessel(unseen, report, history, report.at + INJECTED_GAP_MINUTES * MS_PER_MINUTE));
    const darkFrom = report.at - INJECTED_GAP_MINUTES * MS_PER_MINUTE;
    const beforeDark = history.filter((past) => past.at <= darkFrom);
    const lastBeforeDark = beforeDark[beforeDark.length - 1];
    if (lastBeforeDark && report.at - lastBeforeDark.at <= windowMs && isMoving(unseen, lastBeforeDark)) {
      count(reappeared, scoreVessel(unseen, report, beforeDark, report.at));
    }

    count(doubled, scoreVessel(unseen, doubleReport(report), history.map(doubleReport), report.at));
  });
}
console.log(`Synthetic check: every vessel scored by a model trained without it (${unseenModels} models), then its real moving reports with one anomaly injected.`);
console.log('| Reports | Scored | Watch or anomalous | Anomalous |');
console.log('| --- | --- | --- | --- |');
console.log(tallyLine('Real moving reports, unchanged (false alarm baseline)', baselineMoving));
console.log(tallyLine('Real stopped reports, unchanged (false alarm baseline)', baselineStopped));
console.log(tallyLine('Heading reversed for the whole track', reversed));
console.log(tallyLine(`Stopped ${STOP_MINUTES} min, anywhere on its track`, stopAll));
console.log(tallyLine(`Stopped ${STOP_MINUTES} min in a busy lane (moving traffic at or above the median)`, stopBusy));
console.log(tallyLine(`No report for ${INJECTED_GAP_MINUTES} min while under way`, silent));
console.log(tallyLine(`Reappears under way after ${INJECTED_GAP_MINUTES} min dark`, reappeared));
console.log(tallyLine('Speed doubled for the whole track', doubled));
console.log('');

const timingPairs: { report: TrafficReport; history: TrafficReport[] }[] = [];
for (const track of allTracks.values()) track.forEach((report, index) => timingPairs.push({ report, history: historyBefore(track, index) }));
let checksum = 0;
const timingStarted = performance.now();
for (let call = 0; call < TIMING_CALLS; call++) {
  const pair = timingPairs[call % timingPairs.length];
  checksum += scoreVessel(model, pair.report, pair.history, pair.report.at + MS_PER_MINUTE).score;
}
const microseconds = ((performance.now() - timingStarted) * 1000) / TIMING_CALLS;
const coldStarted = performance.now();
scoreVessel(loadTrafficModel(JSON.parse(json)), ordered[0], [], ordered[0].at);
const coldMs = performance.now() - coldStarted;
console.log(`Speed: ${microseconds.toFixed(1)} microseconds per scoreVessel call over ${whole(TIMING_CALLS)} calls with real histories (checksum ${checksum.toFixed(0)}).`);
console.log(`First call on a freshly loaded model, which builds the smoothed grid once: ${coldMs.toFixed(1)} ms.`);
