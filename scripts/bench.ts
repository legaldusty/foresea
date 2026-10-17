import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHarbor } from '../src/engine/harbor';
import { benchAcceptance, runNights, type BenchGroup, type BenchSummary, type Detection } from '../src/engine/bench';
import { defaultSettings } from '../src/engine/settings';
import type { GridJson } from '../src/engine/grid';

const gridPath = fileURLToPath(new URL('../src/data/harbor_grid.json', import.meta.url));
const harbor = buildHarbor(JSON.parse(fs.readFileSync(gridPath, 'utf8')) as GridJson, defaultSettings);
const nights = Number(process.argv[2] ?? defaultSettings.bench.nights);
const seed = defaultSettings.bench.seed;

const minutes = (value: number) => `${value.toFixed(1)} min`;
const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

function run(detection: Detection, nearness: boolean): BenchSummary {
  return runNights(harbor, { nights, seed, detection, nearness });
}

function tableRow(label: string, g: BenchGroup): string {
  return `| ${label} | ${minutes(g.tellWarnMin)} | ${minutes(g.baseWarnMin)} | ${percent(g.tellCalledRight)} | ${g.wrongCallsPerNight.toFixed(2)} |`;
}

function styleLine(name: string, g: BenchGroup): string {
  return `   ${name.padEnd(7)} ${minutes(g.tellWarnMin)} vs ${minutes(g.baseWarnMin)} | right ${percent(g.tellCalledRight)} | wrong calls per run ${g.wrongCallsPerNight.toFixed(2)}`;
}

const started = Date.now();
const gates = run('gates', true);
const closeIn = run('closeIn', true);
const starterGates = run('gates', false);

console.log(`Benchmark: ${nights} simulated intruders each, final rules, seed ${seed}, beta ${defaultSettings.tell.beta}\n`);
console.log('| Detection | TELL warning | Nearest-dock guess | Right by arrival | Early wrong calls per run |');
console.log('| --- | --- | --- | --- | --- |');
console.log(tableRow('At the harbor gates', gates.all));
console.log(tableRow('Close in, 1 to 3 km from the target', closeIn.all));

for (const [label, summary] of [['Gates, final rules', gates], ['Close in, final rules', closeIn], ['Gates, starter rules (no nearness prior)', starterGates]] as const) {
  console.log(`\n${label} (trip ${minutes(summary.all.tripMin)})`);
  for (const style of ['direct', 'sloppy', 'decoy'] as const) console.log(styleLine(style, summary[style]));
}

const bar = benchAcceptance(gates, defaultSettings);
const verdict = (ok: boolean) => (ok ? 'pass' : 'FAIL');
console.log('\nAcceptance bar');
console.log(`   gate warning ${bar.warningRatio.toFixed(2)}x the nearest-dock guess (needs ${bar.minWarningRatio}x): ${verdict(bar.warningRatio >= bar.minWarningRatio)}`);
console.log(`   right target by arrival ${percent(bar.rightByArrival)} (needs ${percent(bar.minRightByArrival)}): ${verdict(bar.rightByArrival >= bar.minRightByArrival)}`);
console.log(`\n${bar.passes ? 'Benchmark bar met' : 'Benchmark bar missed'} in ${Date.now() - started} ms`);
process.exit(bar.passes ? 0 : 1);
