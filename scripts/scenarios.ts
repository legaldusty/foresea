import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHarbor } from '../src/engine/harbor';
import { LEVELS } from '../src/engine/risk';
import { acceptance, agreement, runAllScenarios, wholePercent, type ScenarioRecord, type ScenarioResult } from '../src/engine/scenarios';
import { defaultSettings } from '../src/engine/settings';
import type { GridJson } from '../src/engine/grid';

const gridPath = fileURLToPath(new URL('../src/data/harbor_grid.json', import.meta.url));
const harbor = buildHarbor(JSON.parse(fs.readFileSync(gridPath, 'utf8')) as GridJson, defaultSettings);
const SAMPLE_FRACTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

function pct(value: number): string {
  return `${(value * 100).toFixed(0).padStart(3)}%`;
}

function recordLine(r: ScenarioRecord): string {
  const odds = `top=${r.top.padEnd(8)} ${pct(r.topP)} lost=${pct(r.lost)} drift=${pct(r.drift)}`;
  const risk = `H=${r.H} R=${String(r.R).padStart(2)} (${r.riskTarget} L${r.L}xS${r.S})${r.urgent ? ' +urgent' : ''}`;
  return `   t=${String(r.t).padStart(6)}m ${odds} ${risk} -> ${LEVELS[r.level].padEnd(8)} eta=${r.etaTopMin ?? '-'} call=${r.call ?? '-'} [${r.ev.join(', ')}]`;
}

function printIncident(s: ScenarioResult): boolean {
  console.log(`\n== ${s.key}. ${s.name}  (${s.kind}, K=${s.K.toFixed(2)}, trip ${s.totalMin.toFixed(1)} min)`);
  console.log(`   TELL locked on true target with ${s.tellWarnMin ?? '-'} min to go | nearest-dock guess: ${s.baseWarnMin ?? '-'} min`);
  for (const f of SAMPLE_FRACTIONS) console.log(recordLine(s.recs[Math.round(f * (s.recs.length - 1))]));
  const a = agreement(s);
  console.log(`   matches expectation: ${wholePercent(a.exact)}% exact / ${wholePercent(a.withinOne)}% within one level / ${wholePercent(a.hotter)}% hotter`);
  let allHold = true;
  for (const check of acceptance(s, defaultSettings)) {
    allHold &&= check.holds;
    console.log(`   ${check.holds ? 'holds' : 'BROKEN'}: ${check.rule} (${check.detail})`);
  }
  return allHold;
}

function summaryTable(label: string, results: ScenarioResult[]): void {
  console.log(`\n${label}`);
  console.log('| Incident | TELL called the true target | Nearest-dock guess | Exact / within one |');
  console.log('| --- | --- | --- | --- |');
  for (const s of results) {
    const a = agreement(s);
    const tell = s.tellWarnMin === null ? 'none' : `${s.tellWarnMin} min before arrival`;
    const base = s.baseWarnMin === null ? 'none' : `${s.baseWarnMin} min`;
    console.log(`| ${s.key}. ${s.name} | ${tell} | ${base} | ${wholePercent(a.exact)}% / ${wholePercent(a.withinOne)}% |`);
  }
}

let ok = true;
const runs = [
  ['Final rules, no current', runAllScenarios(harbor, defaultSettings, { withCurrent: false })],
  ['Final rules, with the current (drift hypothesis on)', runAllScenarios(harbor, defaultSettings, { withCurrent: true })],
] as const;
for (const [label, results] of runs) {
  console.log(`\n######## ${label}`);
  for (const s of results) ok = printIncident(s) && ok;
}
for (const [label, results] of runs) summaryTable(label, results);
const reference = runAllScenarios(harbor, defaultSettings, { mode: 'reference' });
summaryTable('Reference rules (before the final five), no current', reference);
console.log(`\n${ok ? 'Every incident holds its must-stay-true rules' : 'Some incident broke its must-stay-true rules'}`);
process.exit(ok ? 0 : 1);
