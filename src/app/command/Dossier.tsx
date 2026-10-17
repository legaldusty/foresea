import { useEffect, type ReactNode } from 'react';
import { CaretRight, Crosshair, Cpu, FileText, ShieldCheck, WifiSlash, X } from '@phosphor-icons/react';
import type { ConsequenceView, ContactView, Level, RiskMathView, RiskView } from '../../shared/protocol';
import { LEVELS } from '../../shared/protocol';
import { Button, RiskBand, Simulated } from '../ui';
import { clockOf, compassAbbr } from '../format';
import { withMono } from './Headline';
import { OddsHistory } from './OddsHistory';
import '../../styles/inspect.css';

const DEFAULT_LEVEL_MAX = [4, 9, 14, 19];
const PARTS = ['people', 'hazard', 'economy', 'environment'] as const;
type Part = (typeof PARTS)[number];
const PART_LABEL: Record<Part, string> = { people: 'People', hazard: 'Hazard', economy: 'Economy', environment: 'Environ.' };
const PART_WORD: Record<Part, string> = { people: 'people', hazard: 'hazard', economy: 'economy', environment: 'environment' };

const f2 = (x: number): string => x.toFixed(2);
const pct = (p: number): string => `${Math.round(p * 100)}%`;
const signed1 = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const part = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const bearing = (deg: number): string => `${String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')}°`;

function levelFor(score: number, maxes: number[]): Level {
  let i = 0;
  for (const m of maxes) if (score > m) i++;
  return LEVELS[Math.min(i, LEVELS.length - 1)];
}

function levelRanges(maxes: number[]): { level: Level; text: string }[] {
  return LEVELS.map((level, i) => {
    if (i === 0) return { level, text: `1 to ${maxes[0]}` };
    if (i >= maxes.length) return { level, text: `above ${maxes[maxes.length - 1]}` };
    return { level, text: `${maxes[i - 1] + 1} to ${maxes[i]}` };
  });
}

function levelSentence(maxes: number[]): string {
  return LEVELS.map((lv, i) => (i < maxes.length ? `${lv} to ${maxes[i]}` : `${lv} above ${maxes[maxes.length - 1]}`)).join(', ');
}

function consequenceScale(cons: ConsequenceView[], w: Record<string, number>): number | null {
  const k = cons.find((x) => x.C > 0);
  if (!k) return null;
  const sum = PARTS.reduce((s, p) => s + (w[p] ?? 0) * k[p], 0);
  const d = sum / k.C;
  const r = Math.round(d);
  return r >= 1 && Math.abs(d - r) < 0.02 ? r : null;
}

function registryLine(c: ContactView): string {
  const r = c.registry;
  const match = r.match ? `Registry match: ${r.match}${r.owner ? `, ${r.owner}` : ''}.` : 'No registry or dive-plan match.';
  const plan = r.divePlan ? ' Dive plan on file.' : '';
  const reply = r.reply === 'correct' ? ' Correct reply to the ID ping.'
    : r.reply === 'wrong' ? ' Replied with an unregistered ID.'
    : r.reply === 'pending' ? ' ID ping not sent yet.'
    : ` ${r.pings} ID ${r.pings === 1 ? 'ping' : 'pings'}, no reply.`;
  return `${match}${plan}${reply}`;
}

function modeWord(c: ContactView): string {
  if (c.mode === 'driven') return 'Driven from the desk';
  if (c.mode === 'bot') return 'Scripted track';
  if (c.mode === 'drift') return 'Drifting with the current';
  return c.scenarioKey ? `Scenario ${c.scenarioKey}` : 'Scenario';
}

function unscoredWords(c: ContactView): { title: string; detail: string } {
  const k = c.classification.kind;
  if (k === 'friendly') return { title: 'Friendly', detail: 'Positive ID. Stays at Log; never scored as a threat.' };
  if (k === 'animal') return { title: 'Marine animal', detail: 'Never scored as a threat. Boats slow down.' };
  if (k === 'person') return { title: 'Person in the water', detail: 'Never scored as a threat. Boats are routed away.' };
  if (k === 'debris') return { title: 'Navigation hazard', detail: 'Not a threat. Logged with a keep-clear area.' };
  return { title: 'Not scored yet', detail: 'Waiting for enough track to score.' };
}

function Qty(props: { v: string; u?: string; testId?: string }) {
  return (
    <span className="qty" data-testid={props.testId}>
      <span className="mono">{props.v}</span>
      {props.u ? <span className="u">{props.u}</span> : null}
    </span>
  );
}

function Section(props: { title: string; aside?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <section className="dsr-sec" data-testid={props.testId}>
      <div className="dsr-sec-head">
        <h3>{props.title}</h3>
        {props.aside ? <span className="dsr-aside">{props.aside}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

function SensorSection(props: { c: ContactView }) {
  const c = props.c;
  const s = c.sensor;
  const [lon, lat] = s.lonlat;
  const conf = s.confidence <= 1 ? s.confidence * 100 : s.confidence;
  return (
    <Section title="Sensor" aside={s.simulated ? <Simulated /> : 'Live sensor'} testId="dossier-sensor">
      <dl className="dsr-readout">
        <div className="wide">
          <dt>Position</dt>
          <dd data-testid="dossier-position"><Qty v={Math.abs(lat).toFixed(4)} u={lat >= 0 ? 'N' : 'S'} /><Qty v={Math.abs(lon).toFixed(4)} u={lon >= 0 ? 'E' : 'W'} /></dd>
        </div>
        <div><dt>Depth</dt><dd><Qty v={s.depthM.toFixed(1)} u="m" testId="dossier-depth" /></dd></div>
        <div><dt>Heading</dt><dd><Qty v={bearing(s.headingDeg)} u={compassAbbr(s.headingDeg)} testId="dossier-heading" /></dd></div>
        <div><dt>Speed</dt><dd><Qty v={s.speedKn.toFixed(1)} u="kn" testId="dossier-speed-kn" /><Qty v={s.speedMps.toFixed(2)} u="m/s" testId="dossier-speed-mps" /></dd></div>
        <div><dt>Size</dt><dd><Qty v={s.sizeM.toFixed(1)} u="m" testId="dossier-size" /></dd></div>
        <div className="wide"><dt>Heat signature</dt><dd><span className="word">{s.heatLabel}</span><Qty v={signed1(s.heatDeltaC)} u="°C above water" testId="dossier-heat" /></dd></div>
        <div><dt>Acoustic level</dt><dd><Qty v={s.acousticDb.toFixed(0)} u="dB" testId="dossier-acoustic" /></dd></div>
        <div><dt>Observed for</dt><dd><Qty v={s.observedMin.toFixed(s.observedMin < 10 ? 1 : 0)} u="min" testId="dossier-observed" /></dd></div>
        <div><dt>Last fix</dt><dd><Qty v={s.lastFixSec < 100 ? s.lastFixSec.toFixed(0) : (s.lastFixSec / 60).toFixed(1)} u={s.lastFixSec < 100 ? 's ago' : 'min ago'} testId="dossier-last-fix" /></dd></div>
        <div><dt>Track length</dt><dd><Qty v={s.trackKm.toFixed(2)} u="km" testId="dossier-track" /></dd></div>
        <div><dt>Sensor confidence</dt><dd><Qty v={conf.toFixed(0)} u="%" testId="dossier-confidence" /></dd></div>
        <div><dt>Track state</dt><dd data-testid="dossier-track-state">{c.silent ? <span className="word">Lost</span> : <span className="word">Tracking</span>}</dd></div>
      </dl>
      {c.silent ? (
        <p className="dsr-warn" data-testid="dossier-silent"><WifiSlash size={16} /><span>{withMono(`Sensor lost ${Math.round(c.silentForMin)} min ago. Score frozen, zone growing.`)}</span></p>
      ) : null}
    </Section>
  );
}

function WhatSection(props: { c: ContactView }) {
  const c = props.c;
  return (
    <Section title="What it is" testId="dossier-what">
      <p className="dsr-lead"><b data-testid="dossier-class">{c.classification.label}</b><span className="c-muted">. {withMono(c.classification.detail)}.</span></p>
      {c.classificationWhy.length ? (
        <ul className="dsr-lines" data-testid="dossier-class-why">
          {c.classificationWhy.map((line, i) => <li key={i}><CaretRight size={16} /><span>{withMono(line)}</span></li>)}
        </ul>
      ) : null}
      {c.classificationWhy.some((line) => line.startsWith('Registry')) ? null : <p className="dsr-small">{withMono(registryLine(c))}</p>}
    </Section>
  );
}

function HostileSection(props: { c: ContactView }) {
  const h = props.c.hostility;
  return (
    <Section title="Is it hostile?" aside={withMono('H runs from 0, harmless, to 1, hostile')} testId="dossier-hostile">
      {h.items.length ? (
        <div className="dsr-table dsr-ev" data-testid="dossier-evidence">
          <div className="dsr-row head"><span>Evidence</span><span className="num">Effect on H</span></div>
          {h.items.map((e, i) => (
            <div className="dsr-row" key={`${e.key}-${i}`} data-testid={`dossier-ev-${e.key}`}>
              <span>{e.label}{e.why ? <span className="basis"> {withMono(e.why)}</span> : null}</span>
              <span className="num">{e.effect}</span>
            </div>
          ))}
          <div className="dsr-row sum"><span>Hostility H</span><span className="num" data-testid="dossier-h">{f2(h.H)}</span></div>
        </div>
      ) : <p className="dsr-text c-muted">{withMono(`No evidence scored. ${props.c.why}`)}</p>}
    </Section>
  );
}

function BadSection(props: { c: ContactView }) {
  const c = props.c;
  const k = c.capability;
  const m = c.riskMath;
  const worstId = c.risk?.targetId ?? null;
  const cons = [...c.consequences].sort((a, b) => b.odds - a.odds || b.C - a.C);
  const scale = m ? consequenceScale(cons, m.weights) : null;
  const formula = m
    ? `C = (${PARTS.map((p) => `${f2(m.weights[p] ?? 0)} × ${PART_WORD[p]}`).join(' + ')})${scale ? ` ÷ ${scale}, so C runs from 0 to 1` : ''}.`
    : null;
  return (
    <Section title="How bad" aside="What it could do, and what each target stands to lose" testId="dossier-bad">
      <div className="dsr-table dsr-k" data-testid="dossier-capability">
        <div className="dsr-row"><span>Size factor</span><span className="basis">{withMono(`${c.sizeM.toFixed(1)} m long`)}</span><span className="num">{f2(k.sizeFactor)}</span></div>
        <div className="dsr-row"><span>Speed factor</span><span className="basis">{withMono(`${c.speedMps.toFixed(1)} m/s`)}</span><span className="num">{f2(k.speedFactor)}</span></div>
        <div className="dsr-row sum"><span>Capability K</span><span className="basis">{withMono(`size × speed = ${f2(k.sizeFactor)} × ${f2(k.speedFactor)}`)}</span><span className="num" data-testid="dossier-k">{f2(k.K)}</span></div>
      </div>
      {cons.length ? (
        <>
          <p className="dsr-sub">Consequence C at each target</p>
          {formula ? <p className="dsr-small">{withMono(formula)}</p> : null}
          <div className="dsr-table dsr-cons" data-testid="dossier-consequences">
            <div className="dsr-row head">
              <span>Target</span>
              {PARTS.map((p) => <span className="num" key={p}>{PART_LABEL[p]}{m ? <span className="w">{`× ${f2(m.weights[p] ?? 0)}`}</span> : null}</span>)}
              <span className="num">C</span>
              <span className="num">Odds</span>
              <span className="num">ETA<span className="w">min</span></span>
            </div>
            {cons.map((t) => (
              <div className={`dsr-row${t.targetId === worstId ? ' worst' : ''}`} key={t.targetId} data-testid={`dossier-c-${t.targetId}`}>
                <span className="name" title={t.name}>{t.name}</span>
                {PARTS.map((p) => <span className="num" key={p}>{part(t[p])}</span>)}
                <span className="num">{f2(t.C)}</span>
                <span className="num">{pct(t.odds)}</span>
                <span className="num">{t.etaMin === null ? <span className="na">n/a</span> : Math.round(t.etaMin)}</span>
              </div>
            ))}
          </div>
          {worstId ? <p className="dsr-small">Bold row: the target that sets the risk.</p> : null}
        </>
      ) : null}
    </Section>
  );
}

function Matrix(props: { L: number; S: number; maxes: number[] }) {
  return (
    <div className="dsr-matrix" data-testid="dossier-grid" aria-label={`Risk grid, likelihood ${props.L}, severity ${props.S}`}>
      <span className="ylab">How bad if it does</span>
      <div className="yticks">{[5, 4, 3, 2, 1].map((s) => <span key={s}>{s}</span>)}</div>
      <div className="cells">
        {[5, 4, 3, 2, 1].map((s) => [1, 2, 3, 4, 5].map((l) => {
          const score = l * s;
          const here = l === props.L && s === props.S;
          return (
            <span key={`${l}-${s}`} className={`cell lv-${levelFor(score, props.maxes).toLowerCase()}${here ? ' here' : ''}`} data-testid={here ? 'dossier-grid-here' : undefined}>
              {score}
            </span>
          );
        }))}
      </div>
      <div className="xticks">{[1, 2, 3, 4, 5].map((l) => <span key={l}>{l}</span>)}</div>
      <span className="xlab">How likely it reaches a target</span>
    </div>
  );
}

function Calc(props: { m: RiskMathView; risk: RiskView; maxes: number[] }) {
  const { m, risk } = props;
  const lv = levelFor(m.R, props.maxes);
  const split = risk.notes.some((n) => n.startsWith('Split odds'));
  return (
    <div className="dsr-calc" data-testid="dossier-calc">
      <div className="dsr-crow" data-testid="dossier-calc-likelihood">
        <span className="lbl">Likelihood</span>
        <span className="f">{`H × P = ${f2(m.H)} × ${f2(m.P)} = ${f2(m.likelihood)}`}</span>
        <span className="res">band <span className="mono">{m.L}</span> of <span className="mono">5</span></span>
        <span className="bands">{withMono(`Bands at ${m.likelihoodBands.map(f2).join(', ')}. ${split ? 'P is the TELL odds for the two top targets together.' : `P is the TELL odds for ${risk.targetName}.`}`)}</span>
      </div>
      <div className="dsr-crow" data-testid="dossier-calc-severity">
        <span className="lbl">Severity</span>
        <span className="f">{`K × C = ${f2(m.K)} × ${f2(m.C)} = ${f2(m.severity)}`}</span>
        <span className="res">band <span className="mono">{m.S}</span> of <span className="mono">5</span></span>
        <span className="bands">{withMono(`Bands at ${m.severityBands.map(f2).join(', ')}. C is the consequence at ${risk.targetName}.`)}</span>
      </div>
      <div className="dsr-crow total" data-testid="dossier-calc-risk">
        <span className="lbl">Risk</span>
        <span className="f">{`L × S = ${m.L} × ${m.S} = ${m.R}`}</span>
        <span className="res">{lv}</span>
        <span className="bands">{withMono(`${levelSentence(props.maxes)}.`)}</span>
      </div>
    </div>
  );
}

function PerTarget(props: { c: ContactView; risk: RiskView }) {
  const { c, risk } = props;
  const H = c.hostility.H;
  const K = c.capability.K;
  const cOf = new Map(c.consequences.map((t) => [t.targetId, t.C]));
  const rows = [...risk.perTarget].sort((a, b) => b.R - a.R || b.p - a.p);
  if (!rows.length) return null;
  return (
    <div className="dsr-table dsr-pt" data-testid="dossier-per-target">
      <div className="dsr-row head">
        <span>Target</span><span className="num">P</span><span className="num">H × P</span><span className="num">L</span>
        <span className="num">K × C</span><span className="num">S</span><span className="num">R</span>
      </div>
      {rows.map((t) => {
        const C = cOf.get(t.id);
        return (
          <div className={`dsr-row${t.id === risk.targetId ? ' worst' : t.p < 0.02 ? ' quiet' : ''}`} key={t.id} data-testid={`dossier-pt-${t.id}`}>
            <span className="name" title={t.name}>{t.name}</span>
            <span className="num">{f2(t.p)}</span>
            <span className="num">{f2(H * t.p)}</span>
            <span className="num">{t.L}</span>
            <span className="num">{C === undefined ? <span className="na">n/a</span> : f2(K * C)}</span>
            <span className="num">{t.S}</span>
            <span className="num">{t.R}</span>
          </div>
        );
      })}
    </div>
  );
}

function RiskSection(props: { c: ContactView }) {
  const c = props.c;
  const risk = c.risk;
  if (!risk) {
    return (
      <Section title="Risk math" testId="dossier-risk-none">
        <p className="dsr-text c-muted">{withMono(`Not scored as a threat. ${c.why}`)}</p>
      </Section>
    );
  }
  const m = c.riskMath;
  const maxes = m?.levelMaxScores.length ? m.levelMaxScores : DEFAULT_LEVEL_MAX;
  const scoreLevel = levelFor(risk.score, maxes);
  const ranges = levelRanges(maxes);
  const shown = risk.level !== risk.rawLevel
    ? `The score alone gives ${risk.rawLevel}. Shown as ${risk.level} because of the rules below.`
    : `Shown as ${risk.level}: ${risk.rung}.`;
  return (
    <Section title="Risk math" aside={<>Worst target {risk.targetName}</>} testId="dossier-risk">
      {m ? <Calc m={m} risk={risk} maxes={maxes} /> : null}
      <p className="dsr-text" data-testid="dossier-shown">{withMono(shown)}</p>
      <div className="dsr-risk">
        <Matrix L={risk.L} S={risk.S} maxes={maxes} />
        <div className="dsr-levels" data-testid="dossier-levels">
          {[...ranges].reverse().map((r) => (
            <div key={r.level} className={r.level === scoreLevel ? 'on' : ''}>
              <i className={`sw lv-${r.level.toLowerCase()}`} />
              <span>{r.level}</span>
              <span className="range">{r.text}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="dsr-sub">Every target</p>
      <PerTarget c={c} risk={risk} />
      <p className="dsr-sub">Rules that fired</p>
      {risk.notes.length ? (
        <ol className="dsr-rules" data-testid="dossier-rules">
          {risk.notes.map((n, i) => <li key={i}><span className="mono">{i + 1}</span><span>{withMono(n)}</span></li>)}
        </ol>
      ) : <p className="dsr-small" data-testid="dossier-rules-none">None. The level is the level of the score.</p>}
    </Section>
  );
}

function GoingSection(props: { c: ContactView }) {
  const c = props.c;
  const f = c.forecast;
  const etaById = new Map<string, number | null>(c.consequences.map((t) => [t.targetId, t.etaMin]));
  if (c.eta && (etaById.get(c.eta.targetId) ?? null) === null) etaById.set(c.eta.targetId, c.eta.minutes);
  const rows = [...c.odds].sort((a, b) => (a.kind === 'target' ? 0 : 1) - (b.kind === 'target' ? 0 : 1) || b.p - a.p);
  const topId = rows.find((r) => r.kind === 'target')?.id ?? null;
  return (
    <Section title="Where it is going" aside={f ? <>Forecast at <span className="mono">{f.madeAtLabel}</span></> : undefined} testId="dossier-going">
      <p className="dsr-text" data-testid="dossier-forecast">{f ? withMono(f.words) : 'Waiting for the first moves.'}</p>
      {f?.arrival ? (
        <p className="dsr-small" data-testid="dossier-arrival">
          {withMono(`Arrival window at ${f.arrival.name}: ${f.arrival.earlyLabel} to ${f.arrival.lateLabel}, the 10th to 90th percentile of forecast paths. ${pct(f.arrival.share)} of paths toward it arrive.`)}
        </p>
      ) : null}
      {c.call ? (
        <p className="dsr-small" data-testid="dossier-call">{withMono(`TELL called ${c.call.name} at ${clockOf(c.call.sinceMin)} with ${pct(c.call.p)}.`)}</p>
      ) : null}
      {rows.length ? (
        <div className="dsr-odds" data-testid="dossier-odds">
          <div className="dsr-orow head"><span>Target</span><span>TELL odds</span><span className="num">P</span><span className="num">ETA</span></div>
          {rows.map((r) => {
            const eta = r.kind === 'target' ? etaById.get(r.id) ?? null : null;
            return (
              <div key={r.id} className={`dsr-orow${r.id === topId ? ' top' : r.kind !== 'target' || r.p < 0.05 ? ' quiet' : ''}`} data-testid={`dossier-odds-${r.id}`}>
                <span className="name" title={r.name}>{r.name}</span>
                <span className="bar"><i style={{ width: `${Math.max(1, Math.round(r.p * 100))}%` }} /></span>
                <span className="num">{pct(r.p)}</span>
                <span className="num">{eta === null ? '' : `${Math.round(eta)} min`}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="dsr-chart"><OddsHistory c={c} /></div>
    </Section>
  );
}

function TimelineSection(props: { c: ContactView }) {
  const items = props.c.timeline;
  return (
    <Section title="Timeline" testId="dossier-timeline">
      {items.length ? (
        <div className="dsr-table dsr-tl">
          {items.map((t, i) => (
            <div className="dsr-row" key={`${t.atMin}-${i}`} data-testid="dossier-timeline-row">
              <span className="when">{clockOf(t.atMin)}</span>
              <span className="what"><b>{withMono(t.label)}</b>{t.detail ? <span>{withMono(t.detail)}</span> : null}</span>
              <span className="actor">{t.actor}</span>
            </div>
          ))}
        </div>
      ) : <p className="dsr-small">Nothing logged yet.</p>}
    </Section>
  );
}

function NoteSection(props: { c: ContactView }) {
  const n = props.c.analystNote;
  return (
    <Section title="Analyst note" testId="dossier-note">
      {n ? (
        <>
          <p className="dsr-note" data-testid="dossier-note-text">{withMono(n.text)}</p>
          <p className="dsr-source" data-testid="dossier-note-source">
            {n.source === 'granite' ? <Cpu size={16} /> : <FileText size={16} />}
            <span>{n.source === 'granite' ? 'Written by IBM Granite on this laptop from the facts above' : 'Template'}</span>
          </p>
        </>
      ) : <p className="dsr-small">No note yet.</p>}
    </Section>
  );
}

export function ContactDossier(props: { c: ContactView; onClose: () => void; onCenter: () => void }) {
  const { c, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const un = c.risk ? null : unscoredWords(c);
  return (
    <aside className="dossier" data-testid="dossier" aria-label={`Dossier for ${c.label}`}>
      <div className="dsr-top">
        <header className="dsr-head">
          <div className="dsr-title">
            <div className="dsr-name"><h2 data-testid="dossier-label">{c.label}</h2>{c.sensor.simulated ? <Simulated /> : null}</div>
            <p className="dsr-meta">{withMono(`${c.classification.label}. First seen ${clockOf(c.firstSeenMin)}. ${modeWord(c)}.`)}</p>
          </div>
          <div className="dsr-actions">
            <Button variant="secondary" icon={<Crosshair size={16} />} onClick={props.onCenter} testId="dossier-center">Center</Button>
            <Button variant="quiet" icon={<X size={16} />} onClick={onClose} testId="dossier-close">Close</Button>
          </div>
        </header>
        {c.risk ? <RiskBand level={c.risk.level} score={c.risk.score} testId="dossier-band" /> : (
          <div className="dsr-unscored" data-testid="dossier-unscored"><ShieldCheck size={20} /><b>{un?.title}</b><span>{un?.detail}</span></div>
        )}
      </div>
      <div className="dsr-body">
        <SensorSection c={c} />
        <WhatSection c={c} />
        <HostileSection c={c} />
        <BadSection c={c} />
        <RiskSection c={c} />
        <GoingSection c={c} />
        <TimelineSection c={c} />
        <NoteSection c={c} />
      </div>
    </aside>
  );
}
