import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHarbor } from '../src/engine/harbor';
import { defaultSettings } from '../src/engine/settings';
import type { GridJson } from '../src/engine/grid';
import { CALIBRATION_DEFAULTS, runCalibration, type CalibrationRunOptions, type CoverageGroup } from '../src/engine/calibration';

const gridPath = fileURLToPath(new URL('../src/data/harbor_grid.json', import.meta.url));
const harbor = buildHarbor(JSON.parse(fs.readFileSync(gridPath, 'utf8')) as GridJson, defaultSettings);

function flag(name: string): number | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || at + 1 >= process.argv.length) return undefined;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : undefined;
}

const options: CalibrationRunOptions = {
  nights: flag('nights') ?? CALIBRATION_DEFAULTS.nights,
  seed: flag('seed') ?? CALIBRATION_DEFAULTS.seed,
  coverageNightsPerStyle: flag('per-style') ?? CALIBRATION_DEFAULTS.coverageNightsPerStyle,
  forecastSamples: flag('samples') ?? CALIBRATION_DEFAULTS.forecastSamples,
};

const percent = (value: number | null) => (value === null ? '-' : `${(value * 100).toFixed(1)}%`);
const whole = (value: number) => value.toLocaleString('en-US');

const started = performance.now();
const study = runCalibration(harbor, options);
const seconds = (performance.now() - started) / 1000;
const { calibration, coverage: cov, pitch } = study;
const cal = calibration.all;
const where = study.detection === 'gates' ? 'detected at the harbor gates' : 'detected close in';
const styleReports = [['Direct', calibration.direct], ['Sloppy', calibration.sloppy], ['Decoy', calibration.decoy]] as const;

console.log(`Calibration study, simulated: ${whole(cal.nights)} nights ${where}, seed ${study.seed}, drone at ${study.speedMps.toFixed(1)} m/s\n`);
console.log(`TELL calibration: top target odds after every move (${whole(cal.steps)} steps from ${whole(cal.nights)} nights)`);
console.log('| Top target odds | Steps | Mean predicted | Observed right | Direct right | Sloppy right | Decoy right |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
cal.bins.forEach((bin, b) => {
  const label = `${Math.round(bin.low * 100)} to ${Math.round(bin.high * 100)}%`;
  const byStyle = styleReports.map(([, r]) => percent(r.bins[b].hitRate)).join(' | ');
  console.log(`| ${label} | ${whole(bin.count)} | ${percent(bin.meanPredicted)} | ${percent(bin.hitRate)} | ${byStyle} |`);
});
console.log(`| All | ${whole(cal.steps)} | ${percent(cal.meanPredicted)} | ${percent(cal.hitRate)} | ${styleReports.map(([, r]) => percent(r.hitRate)).join(' | ')} |`);

console.log('\n| Style | Nights | Steps | Brier, top target | Brier, all hypotheses | Expected calibration error |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const [label, r] of [...styleReports, ['All', cal] as const]) {
  console.log(`| ${label} | ${whole(r.nights)} | ${whole(r.steps)} | ${r.brier.toFixed(4)} | ${r.multiclassBrier.toFixed(4)} | ${r.ece.toFixed(4)} |`);
}

const checkpoints = cov.checkpoints.map((c) => `${Math.round(c * 100)}%`).join(', ');
console.log(`\nForecast coverage: the true next ${cov.lookaheadMinutes} minutes against the forecast from TELL's live odds`);
console.log(`(${whole(cov.samples)} futures per forecast, checkpoints at ${checkpoints} of each track, up to ${cov.nightsPerStyle} nights per style)`);
console.log(`| Style | Nights | Forecasts | Track points | Inside red | Inside yellow | Crossed cells | Time window right (${cov.windowSlackMinutes} min slack) |`);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
const onPoints = (g: CoverageGroup, value: number) => (g.trackPoints ? value : null);
const row = (label: string, g: CoverageGroup) =>
  console.log(`| ${label} | ${g.nights} | ${g.forecasts} | ${whole(g.trackPoints)} | ${percent(onPoints(g, g.insideLikely))} | ${percent(onPoints(g, g.insideCareful))} | ${whole(g.crossedCells)} | ${percent(g.crossedCells ? g.timeWindowRight : null)} |`);
row('Direct', cov.direct);
row('Sloppy', cov.sloppy);
row('Decoy', cov.decoy);
row('All', cov.all);

console.log(`\nPitch: ${percent(pitch.insideCareful)} of the true next ${pitch.lookaheadMinutes} minutes of track stayed inside the yellow layer (${whole(pitch.trackPoints)} track points, ${pitch.nights} nights, simulated).`);
console.log(`Ran in ${seconds.toFixed(1)} s.`);
