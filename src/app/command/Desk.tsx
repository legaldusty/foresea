import { useState } from 'react';
import { ArrowCounterClockwise, DownloadSimple, Warning } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot, OnTimeRow } from '../../shared/protocol';
import { Button, Field, SelectBox, TextBox } from '../ui';
import { clockOf, signed } from '../format';
import '../../styles/desk.css';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;
type DeskTab = 'today' | 'ontime' | 'sightings' | 'report' | 'log';

const HOURS = Array.from({ length: 33 }, (_, i) => 6 + i * 0.5).map((h) => ({ value: h, label: `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}` }));

function Today(props: { snap: CommandSnapshot; send: Send; divePoint: [number, number] | null; onPickDive: () => void }) {
  const [by, setBy] = useState('Harbor Divers LLC');
  const [start, setStart] = useState(13);
  const [end, setEnd] = useState(14);
  const rows = props.snap.today;
  return (
    <div className="desk-pane" data-testid="today">
      <div className="today-row head"><span>Zone</span><span>Times</span><span className="num">Boats</span><span className="num">Ack</span><span /></div>
      {rows.map((r) => (
        <div className={`today-row${r.status === 'scheduled' ? ' scheduled' : ''}`} key={r.id} data-testid={`today-${r.id}`}>
          <span className="zone"><span className="t-strong">{r.label}</span><span className="t-small c-muted">{r.status === 'scheduled' ? `Scheduled. ${r.filedBy ?? ''}` : r.filedBy ?? ''}{r.simulated ? '. Simulated' : ''}</span></span>
          <span className="mono">{r.timesLabel}</span>
          <span className="num mono">{r.status === 'active' ? r.boatsAffected : ''}</span>
          <span className="num mono">{r.ackRate === null ? '' : `${Math.round(r.ackRate * 100)}%`}</span>
          <span className="acts">
            {r.noticeId ? (
              <>
                <Button variant="quiet" onClick={() => void props.send('extendZone', { noticeId: r.noticeId as string, minutes: 30 })} testId={`extend-${r.id}`}>Extend</Button>
                <Button variant="quiet" onClick={() => void props.send('endZone', { noticeId: r.noticeId as string })} testId={`end-${r.id}`}>End</Button>
              </>
            ) : null}
          </span>
        </div>
      ))}
      {!rows.length ? <p className="desk-empty">No zones today.</p> : null}
      <div className="dive-form" data-testid="dive-form">
        <span className="t-heading">File a dive plan</span>
        <div className="fields">
          <Field label="Filed by"><TextBox value={by} onChange={setBy} /></Field>
          <Field label="From"><SelectBox value={start} options={HOURS} onChange={setStart} /></Field>
          <Field label="To"><SelectBox value={end} options={HOURS} onChange={setEnd} /></Field>
        </div>
        <div className="row-btns">
          <Button variant="secondary" onClick={props.onPickDive} testId="dive-place">{props.divePoint ? 'Move the spot' : 'Place on the chart'}</Button>
          <Button variant="primary" onClick={() => props.divePoint && void props.send('fileDivePlan', { by, lonlat: props.divePoint, startHour: start, endHour: Math.max(end, start + 0.5) })} testId="dive-file">File dive plan</Button>
          <span className="t-small c-muted">{props.divePoint ? `${props.divePoint[1].toFixed(4)} N ${Math.abs(props.divePoint[0]).toFixed(4)} W` : 'Pick the spot first'}</span>
        </div>
      </div>
    </div>
  );
}

function sourceWord(r: OnTimeRow): string {
  return r.source === 'simulated' ? 'Simulated' : r.source === 'ais-live' ? 'AIS live' : 'AIS replay';
}

function OnTime(props: { snap: CommandSnapshot }) {
  const rank = (s: string) => (s === 'late' ? 0 : s === 'at risk' ? 1 : s === 'on time' ? 2 : 3);
  const rows = [...props.snap.onTime].sort((a, b) => (a.source === 'simulated' ? 1 : 0) - (b.source === 'simulated' ? 1 : 0) || rank(a.status) - rank(b.status) || Number(!!b.zoneNote) - Number(!!a.zoneNote));
  return (
    <div className="desk-pane" data-testid="ontime-board">
      <div className="ot-row head"><span>Vessel</span><span>Source</span><span className="num">Plan</span><span className="num">Ours</span><span className="num">Change</span><span>Status</span></div>
      {rows.map((r) => {
        const warn = r.status === 'late' || r.status === 'at risk';
        return (
          <div className={`ot-row${warn ? ' warn' : ''}`} key={r.id} data-testid={`ontime-${r.id}`} title={r.why}>
            <span className="name"><span className="t-strong">{r.name}</span>{r.zoneNote ? <span className="t-small c-muted" data-testid="zone-note">{r.zoneNote}</span> : null}</span>
            <span className="t-small c-muted">{sourceWord(r)}</span>
            <span className="num mono">{r.plannedLabel}</span>
            <span className="num mono">{r.ourEtaLabel}</span>
            <span className="num mono">{signed(r.deltaMin)}</span>
            <span className="status">{warn ? <Warning size={16} /> : null}{r.status}</span>
          </div>
        );
      })}
    </div>
  );
}

function Sightings(props: { snap: CommandSnapshot }) {
  const rows = props.snap.sightings;
  return (
    <div className="desk-pane" data-testid="sightings">
      <div className="pane-actions">
        <span className="t-small c-muted"><span className="mono">{rows.length}</span> sightings over 7 days. Older ones are simulated history.</span>
        <a className="dl" href="/api/sightings.csv" download data-testid="export-sightings-csv"><DownloadSimple size={16} />CSV</a>
        <a className="dl" href="/api/sightings.geojson" download data-testid="export-sightings-geojson"><DownloadSimple size={16} />GeoJSON</a>
      </div>
      {rows.map((x) => (
        <div className="sg-row" key={x.id}>
          <span className="mono">{x.whenLabel}</span>
          <span className="t-strong">{x.species.charAt(0).toUpperCase() + x.species.slice(1)}</span>
          <span>{x.reporter}<span className="c-muted">{x.status === 'reported' ? ', not confirmed yet' : ''}{x.simulated ? ', simulated' : ''}</span></span>
          <span className="c-muted">{x.note}</span>
        </div>
      ))}
    </div>
  );
}

function Report(props: { snap: CommandSnapshot }) {
  const r = props.snap.report;
  return (
    <div className="desk-pane" data-testid="daily-report">
      <div className="pane-actions">
        <span className="t-heading">{r.dayLabel}</span>
        <a className="dl" href="/api/report.csv" download data-testid="export-report"><DownloadSimple size={16} />Export CSV</a>
      </div>
      <div className="report-nums">
        <div><span className="mono big">{r.zonesIssued}</span><span className="t-small c-muted">zones issued</span></div>
        <div><span className="mono big">{r.boatsNotified}</span><span className="t-small c-muted">boats notified</span></div>
        <div><span className="mono big">{r.ackRate === null ? 'none' : `${Math.round(r.ackRate * 100)}%`}</span><span className="t-small c-muted">acknowledged</span></div>
        <div><span className="mono big">{r.delayMinutes.toFixed(1)}</span><span className="t-small c-muted">minutes of delay</span></div>
        <div><span className="mono big">{r.whaleShips ? `${r.whaleHonored} of ${r.whaleShips}` : '0'}</span><span className="t-small c-muted">whale slowdowns honored</span></div>
      </div>
      <ul className="report-lines">{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

function Log(props: { snap: CommandSnapshot; send: Send }) {
  return (
    <div className="desk-pane" data-testid="audit-log">
      {props.snap.audit.map((a) => (
        <div className={`log-row${a.undone ? ' undone' : ''}`} key={a.id}>
          <span className="mono">{clockOf(a.atMin)}</span>
          <span className="t-strong">{a.actor === 'machine' ? 'GIVE WAY' : a.actor === 'officer' ? props.snap.officer : a.actor === 'system' ? 'System' : a.actor.replace(/^captain:/, 'Captain, ')}</span>
          <span>{a.action}</span>
          <span className="c-muted">{a.detail}</span>
          {a.undoable && !a.undone ? <button className="undo" onClick={() => void props.send('undo', { auditId: a.id })}><ArrowCounterClockwise size={16} />Undo</button> : <span />}
        </div>
      ))}
    </div>
  );
}

export function DeskRail(props: { snap: CommandSnapshot; send: Send; divePoint: [number, number] | null; onPickDive: () => void }) {
  const [tab, setTab] = useState<DeskTab>('today');
  const atRisk = props.snap.onTime.filter((r) => r.status === 'late' || r.status === 'at risk').length;
  const tabs: { id: DeskTab; label: string }[] = [
    { id: 'today', label: `Today, ${props.snap.today.filter((r) => r.status === 'active').length} zones` },
    { id: 'ontime', label: atRisk ? `On time, ${atRisk} at risk` : 'On time' },
    { id: 'sightings', label: 'Marine life' },
    { id: 'report', label: 'Daily report' },
    { id: 'log', label: 'Log' },
  ];
  return (
    <div className="desk-rail">
      <div className="desk-tabs" role="tablist">
        {tabs.map((t) => <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`desk-${t.id}`}>{t.label}</button>)}
      </div>
      {tab === 'today' ? <Today snap={props.snap} send={props.send} divePoint={props.divePoint} onPickDive={props.onPickDive} /> : null}
      {tab === 'ontime' ? <OnTime snap={props.snap} /> : null}
      {tab === 'sightings' ? <Sightings snap={props.snap} /> : null}
      {tab === 'report' ? <Report snap={props.snap} /> : null}
      {tab === 'log' ? <Log snap={props.snap} send={props.send} /> : null}
    </div>
  );
}
