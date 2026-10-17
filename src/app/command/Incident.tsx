import { useEffect, useState, type ReactNode } from 'react';
import { DownloadSimple, Printer, X } from '@phosphor-icons/react';
import type { IncidentReport } from '../../shared/protocol';
import { Button, Simulated } from '../ui';
import { withMono } from './Headline';
import { api } from '../hub/harbor';

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="ir-row">
      <span className="k">{props.label}</span>
      <span className="v">{props.children}</span>
    </div>
  );
}

function Stat(props: { value: string; unit?: string; label: string; testId?: string }) {
  return (
    <div className="ir-stat" data-testid={props.testId}>
      <span className="n"><span className="mono">{props.value}</span>{props.unit ? <span className="u">{props.unit}</span> : null}</span>
      <span className="l">{props.label}</span>
    </div>
  );
}

const fmt = (v: number | null, digits = 0) => (v === null ? 'n/a' : v.toFixed(digits));

function actorWord(a: string): string {
  if (a === 'machine') return 'GIVE WAY';
  if (a === 'officer') return 'Officer';
  if (a === 'system') return 'System';
  if (a === 'simulated') return 'Simulated';
  return a.replace(/^captain:/, 'Captain, ');
}

export function IncidentSheet(props: { contactId: string; onClose: () => void }) {
  const [r, setR] = useState<IncidentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch(api(`/api/incident/${encodeURIComponent(props.contactId)}`)).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Not found');
      return res.json() as Promise<IncidentReport>;
    }).then((j) => { if (live) { setR(j); setError(null); } }).catch((e: Error) => { if (live) setError(e.message); });
    void load();
    const t = setInterval(load, 2000);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [props.contactId]);
  const download = () => {
    if (!r) return;
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `giveway-incident-${r.label.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="sheet-back ir-back" onClick={props.onClose}>
      <div className="sheet ir" style={{ width: 'min(1000px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()} data-testid="incident-report">
        <div className="sheet-head">
          <div className="title-block">
            <span className="t-display">After-action report{r ? `: ${r.label}` : ''}</span>
            {r ? <span className="t-small c-muted">{r.station}. {r.status === 'open' ? 'Still open, updating live' : r.status === 'all clear' ? `All clear ${r.allClearLabel}` : 'Closed'}. {r.durationMin.toFixed(0)} min from first detection. {r.simulated ? <Simulated text={`${r.source} contact`} /> : r.source}</span> : null}
          </div>
          <div className="ir-actions">
            <Button variant="secondary" icon={<Printer size={16} />} onClick={() => window.print()} testId="incident-print">Print</Button>
            <Button variant="secondary" icon={<DownloadSimple size={16} />} onClick={download} testId="incident-json">JSON</Button>
            <Button variant="quiet" icon={<X size={16} />} onClick={props.onClose} testId="incident-close">Close</Button>
          </div>
        </div>
        <div className="sheet-body">
          {error ? <p className="t-body c-muted">{error}</p> : null}
          {!r && !error ? <p className="t-body c-muted">Loading the report</p> : null}
          {r ? (
            <>
              <div className="ir-stats">
                <Stat value={fmt(r.leadMin)} unit="min" label={r.arrival?.reached ? `Target called before it arrived at ${r.arrival.place}` : 'Target called before its expected arrival'} testId="incident-lead" />
                <Stat value={fmt(r.notice?.afterDetectionMin ?? null, 1)} unit="min" label="From first detection to the notice going out" />
                <Stat value={`${r.boats.acknowledged}/${r.boats.told}`} label="Boats told that acknowledged" />
                <Stat value={fmt(r.delayBoatMin, 0)} unit="boat-min" label={`Delay caused, ${r.gatesClosed} gates closed`} />
              </div>
              <section className="ir-sec">
                <span className="t-heading">What happened</span>
                <Row label="Detected">{withMono(`${r.detected.atLabel} near ${r.detected.place}. ${r.detected.readings}.`)}</Row>
                <Row label="Identified">{withMono(`${r.classification}${r.hostility !== null ? `, hostility estimate ${r.hostility.toFixed(2)}` : ''}.`)}</Row>
                <Row label="Predicted">{r.call ? withMono(`${r.call.atLabel}: heading to ${r.call.target} at ${Math.round(r.call.odds * 100)}%, ${r.call.afterDetectionMin.toFixed(1)} min after detection.`) : 'No target called.'}</Row>
                <Row label="Arrival">{r.arrival ? withMono(`${r.arrival.reached ? 'Reached' : 'Expected at'} ${r.arrival.place} ${r.arrival.atLabel}.`) : 'Did not reach a target.'}</Row>
                <Row label="Risk peak">{r.peak ? withMono(`${r.peak.score} of 25, ${r.peak.level}, at ${r.peak.atLabel}.`) : 'Not scored.'}</Row>
                <Row label="Notice">{r.notice ? withMono(`${r.notice.draftedLabel ? `Drafted ${r.notice.draftedLabel}. ` : ''}${r.notice.publishedLabel ? `Published ${r.notice.publishedLabel} by ${r.notice.publishedBy}: ${r.notice.instruction}.` : 'Not published.'}${r.notice.warningBeforeArrivalMin !== null ? ` ${r.notice.warningBeforeArrivalMin.toFixed(1)} min before it arrived.` : ''}`) : 'No notice.'}</Row>
                <Row label="Boats">{withMono(`${r.boats.told} phones told (${r.boats.p1} P1, ${r.boats.p2} P2), ${r.boats.acknowledged} acknowledged${r.boats.medianAckSec !== null ? `, median ${Math.round(r.boats.medianAckSec)} s to acknowledge` : ''}. ${r.boats.shipsByAis} ships told by AIS and VHF.`)}{r.boats.notResponding.length ? ` No reply: ${r.boats.notResponding.join(', ')}.` : ''}{r.boats.vhfCalled.length ? ` Called on VHF: ${r.boats.vhfCalled.join(', ')}.` : ''}</Row>
                <Row label="All clear">{r.allClearLabel ? withMono(r.allClearLabel) : 'Not yet.'}</Row>
              </section>
              <section className="ir-sec ir-split">
                <div>
                  <span className="t-heading">GIVE WAY did on its own</span>
                  <ul>{r.machineDid.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
                <div>
                  <span className="t-heading">People decided</span>
                  <ul>{r.peopleDid.length ? r.peopleDid.map((a) => <li key={a}>{a}</li>) : <li>Nothing yet</li>}</ul>
                </div>
              </section>
              <section className="ir-sec">
                <span className="t-heading">Timeline</span>
                <div className="ir-timeline">
                  {r.timeline.map((e, i) => (
                    <div key={i}><span className="mono">{e.atLabel}</span><span className="t-strong">{actorWord(e.actor)}</span><span>{e.action}</span><span className="c-muted">{e.detail}</span></div>
                  ))}
                </div>
              </section>
              <p className="t-small c-muted">Nothing touched the vehicle. Every public notice and its approver are in the log. {r.simulated ? 'The contact, its readings and the small boats are simulated; AIS ships and NOAA data are real.' : ''}</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
