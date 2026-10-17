import type { ReactNode } from 'react';
import { Broadcast, CheckCircle, Warning } from '@phosphor-icons/react';
import type { AdvisoryView, CommandEvents, CommandSnapshot, ConditionsField, ConditionsView, Sourced } from '../../shared/protocol';
import { Button } from '../ui';
import { ageText, compass16, fahrenheit, feet, knotsWhole, shortSource } from '../conditionsFormat';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

function SourceCell(props: { s: Sourced<unknown> | null; note?: string; computed?: boolean }) {
  if (!props.s) return <span className="src t-small c-muted">{props.note ?? ''}</span>;
  if (props.computed) return <span className="src t-small c-muted">{props.s.source}</span>;
  return <span className="src t-small c-muted" title={props.s.source}>{shortSource(props.s.source)}, <span className="mono">{ageText(props.s.ageMin)}</span></span>;
}

function Row(props: { label: string; first?: boolean; now: ReactNode; detail?: ReactNode; s: Sourced<unknown> | null; missing?: string; testId?: string; computed?: boolean }) {
  const absent = props.now === null;
  return (
    <div className={`cx-row${props.first ? ' first' : ''}`} data-testid={props.testId}>
      <span className="label">{props.label}</span>
      <span className="now mono">{absent ? <span className="nodata">No data</span> : props.now}</span>
      <span className="detail">{absent ? <span className="t-small c-muted">{props.missing ?? 'Not reported'}</span> : props.detail}</span>
      <SourceCell s={absent ? null : props.s} computed={props.computed} />
    </div>
  );
}

function missingText(c: ConditionsView, field: ConditionsField): string | undefined {
  return c.missing[field];
}

function Readings(props: { c: ConditionsView }) {
  const c = props.c;
  const level = c.waterLevelM;
  const trend = c.tideTrend?.value;
  return (
    <div className="cx-readings" data-testid="conditions-readings">
      <div className="cx-row head"><span>Measure</span><span>Now</span><span>Detail</span><span>Source and age</span></div>
      <Row first label="Tide" testId="cx-tide" s={level} missing={missingText(c, 'waterLevel')}
        now={level ? <>{feet(level.value)} ft</> : null}
        detail={<>{trend ? `${trend.charAt(0).toUpperCase()}${trend.slice(1)}. ` : ''}<span className="mono">{level?.value.toFixed(2)}</span> m above {c.datum}</>} />
      <Row label="Next high" s={c.nextHigh} missing={missingText(c, 'nextHigh')}
        now={c.nextHigh ? c.nextHigh.value.label : null} detail={c.nextHigh ? <><span className="mono">{feet(c.nextHigh.value.meters)}</span> ft</> : null} />
      <Row label="Next low" s={c.nextLow} missing={missingText(c, 'nextLow')}
        now={c.nextLow ? c.nextLow.value.label : null} detail={c.nextLow ? <><span className="mono">{feet(c.nextLow.value.meters)}</span> ft</> : null} />
      <Row first label="Wind" testId="cx-wind" s={c.windMps} missing={missingText(c, 'wind')}
        now={c.windMps ? <>{knotsWhole(c.windMps.value)} kn {compass16(c.windFromDeg?.value)}</> : null}
        detail={c.gustMps ? <>Gusts <span className="mono">{knotsWhole(c.gustMps.value)}</span> kn{c.windFromDeg ? <>, from <span className="mono">{Math.round(c.windFromDeg.value)}</span>°</> : null}</> : <span className="t-small c-muted">No gust reported</span>} />
      <Row label="Waves" testId="cx-waves" s={c.waveHeightM} missing={missingText(c, 'waveHeight')}
        now={c.waveHeightM ? <>{feet(c.waveHeightM.value)} ft</> : null}
        detail={<>{c.wavePeriodS ? <><span className="mono">{Math.round(c.wavePeriodS.value)}</span> s</> : 'Period not reported'}{c.waveFromDeg ? <> from {compass16(c.waveFromDeg.value)}</> : null}. <span className="mono">{c.waveHeightM?.value.toFixed(1)}</span> m outside the breakwater</>} />
      <Row first label="Water" s={c.waterTempC} missing={missingText(c, 'waterTemp')}
        now={c.waterTempC ? <>{fahrenheit(c.waterTempC.value)} °F</> : null} detail={c.waterTempC ? <><span className="mono">{c.waterTempC.value.toFixed(1)}</span> °C</> : null} />
      <Row label="Air" s={c.airTempC} missing={missingText(c, 'airTemp')}
        now={c.airTempC ? <>{fahrenheit(c.airTempC.value)} °F</> : null} detail={c.airTempC ? <><span className="mono">{c.airTempC.value.toFixed(1)}</span> °C</> : null} />
      <Row label="Pressure" s={c.pressureHpa} missing={missingText(c, 'pressure')}
        now={c.pressureHpa ? <>{c.pressureHpa.value.toFixed(1)}</> : null} detail={c.pressureHpa ? 'hPa' : null} />
      <Row first computed label="Sunrise" s={c.sunrise} now={c.sunrise ? c.sunrise.value.label : null} detail={c.sunset ? <>Sunset <span className="mono">{c.sunset.value.label}</span></> : null} />
    </div>
  );
}

function AdvisoryRow(props: { a: AdvisoryView; send: Send }) {
  const a = props.a;
  return (
    <div className="cx-adv" data-testid={`advisory-${a.id}`}>
      <Warning size={20} className="lead" />
      <div className="text">
        <span className="t-strong">{a.event}{a.endsLabel ? <> until <span className="mono">{a.endsLabel}</span></> : null}</span>
        <span className="t-body">{a.summary}</span>
        <span className="t-small c-muted">{a.sender}. Severity {a.severity.toLowerCase()}.</span>
        <div className="acts">
          {a.relayedBy
            ? <span className="t-small"><CheckCircle size={16} />Relayed to captains by {a.relayedBy} at <span className="mono">{a.relayedAtLabel}</span></span>
            : <Button variant="secondary" icon={<Broadcast size={16} />} onClick={() => void props.send('relayAdvisory', { advisoryId: a.id })} testId={`relay-${a.id}`}>Relay to captains</Button>}
        </div>
      </div>
    </div>
  );
}

function Advisories(props: { c: ConditionsView; send: Send }) {
  const adv = props.c.advisories;
  const f = props.c.forecast;
  return (
    <div className="cx-side">
      <div className="cx-head">
        <span className="t-strong">NWS advisories</span>
        <SourceCell s={adv} />
      </div>
      {adv === null ? <p className="cx-note"><span className="nodata">No data.</span> {props.c.missing.advisories}</p> : null}
      {adv && !adv.value.length ? <p className="cx-note">No watches, warnings or advisories in effect for the marine zone.</p> : null}
      {adv?.value.map((a) => <AdvisoryRow key={a.id} a={a} send={props.send} />)}
      <div className="cx-head">
        <span className="t-strong">Marine forecast{f ? `, ${f.value.zoneName}` : ''}</span>
        <SourceCell s={f} />
      </div>
      {f ? f.value.periods.map((p) => (
        <div className="cx-period" key={p.name}><span className="t-strong">{p.name}</span><span>{p.text}</span></div>
      )) : <p className="cx-note"><span className="nodata">No data.</span> {props.c.missing.forecast}</p>}
    </div>
  );
}

function Sources(props: { c: ConditionsView }) {
  return (
    <div className="cx-sources" data-testid="conditions-sources">
      {props.c.sources.map((s) => (
        <span key={s.id} className={s.ok ? 'ok' : 'bad'} title={s.detail}>
          {s.ok ? null : <Warning size={16} />}
          {s.label}, <span className="mono">{s.observedAt ? ageText(s.ageMin) : 'no reading'}</span>{s.ok ? '' : `. ${s.detail}`}
        </span>
      ))}
      {!props.c.sources.length ? <span>Waiting for the first fetch from NOAA and NWS.</span> : null}
    </div>
  );
}

export function ConditionsPane(props: { snap: CommandSnapshot; send: Send }) {
  const c = props.snap.conditions;
  return (
    <div className="desk-pane" data-testid="conditions">
      <div className="cx">
        <Readings c={c} />
        <Advisories c={c} send={props.send} />
      </div>
      <Sources c={c} />
    </div>
  );
}

export function TodayAdvisories(props: { snap: CommandSnapshot; send: Send }) {
  const list = props.snap.conditions.advisories?.value ?? [];
  if (!list.length) return null;
  return (
    <>
      {list.map((a) => (
        <div className="today-adv" key={a.id} data-testid={`today-advisory-${a.id}`}>
          <Warning size={16} />
          <span className="t-strong">NWS {a.event}{a.endsLabel ? <> until <span className="mono">{a.endsLabel}</span></> : null}</span>
          <span className="t-small c-muted">{a.relayedBy ? <>Relayed to captains at <span className="mono">{a.relayedAtLabel}</span></> : 'Not relayed to captains'}</span>
          {a.relayedBy ? <span /> : <Button variant="quiet" onClick={() => void props.send('relayAdvisory', { advisoryId: a.id })} testId={`today-relay-${a.id}`}>Relay</Button>}
        </div>
      ))}
    </>
  );
}

export function conditionsTabLabel(snap: CommandSnapshot): string {
  const n = snap.conditions.advisories?.value.length ?? 0;
  return n ? `Conditions, ${n} advisor${n === 1 ? 'y' : 'ies'}` : 'Conditions';
}
