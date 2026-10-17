import { useEffect, useState, type ReactNode } from 'react';
import { ClockClockwise, Crosshair, Files, PaperPlaneTilt, StopCircle, X } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot, DeliveryState, Notice, NoticeDraft } from '../../shared/protocol';
import { DELIVERY_STATES } from '../../shared/protocol';
import { Button, NumberBox, Simulated } from '../ui';
import { clockOf } from '../format';
import { withMono } from './Headline';
import '../../styles/inspect.css';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

const STATE_WORD: Record<DeliveryState, string> = { sent: 'Sent', delivered: 'Delivered', seen: 'Seen', acknowledged: 'Acknowledged', complying: 'Complying' };

function Row(props: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div data-testid={props.testId}>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function minutesLeft(n: Notice, now: number): string {
  const left = n.expiresAtMin - now;
  if (left <= 0) return 'ending now';
  return left < 90 ? `${Math.round(left)} min left` : `${(left / 60).toFixed(1)} h left`;
}

export function ZoneInspector(props: { snap: CommandSnapshot; zoneId: string; send: Send; onClose: () => void; onCenter: () => void; onDossier: (contactId: string) => void }) {
  const { snap } = props;
  const zone = snap.zones.find((z) => z.id === props.zoneId) ?? null;
  const notice: Notice | null = snap.notices.find((n) => n.zoneId === props.zoneId && n.status === 'active') ?? null;
  const draft: NoticeDraft | null = notice ? null : snap.drafts.find((d) => d.zoneId === props.zoneId) ?? null;
  const doc = notice ?? draft;
  const [radius, setRadius] = useState(zone?.radiusM ?? 250);
  useEffect(() => { if (zone) setRadius(zone.radiusM); }, [zone?.radiusM]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!zone || !doc) {
    return (
      <aside className="insp" data-testid="zone-inspector">
        <div className="insp-head">
          <div className="insp-title"><h2>Zone closed</h2><p className="insp-meta">It was lifted or expired. The log keeps the record.</p></div>
          <div className="insp-actions"><button className="icon-btn" onClick={props.onClose} aria-label="Close" data-testid="zone-close"><X size={20} /></button></div>
        </div>
      </aside>
    );
  }
  const deliveries = notice ? snap.deliveries.filter((d) => d.noticeId === notice.id && !d.vesselId.startsWith('ais-')) : [];
  const acked = deliveries.filter((d) => d.states.acknowledged !== undefined).length;
  const lastState = (s: Partial<Record<DeliveryState, number>>): DeliveryState => DELIVERY_STATES.filter((k) => s[k] !== undefined).pop() ?? 'sent';
  const ships = notice ? snap.deliveries.filter((d) => d.noticeId === notice.id && d.vesselId.startsWith('ais-')).length : 0;
  const today = snap.today.find((r) => r.noticeId === notice?.id || r.id === zone.id);
  const kindWord = zone.kind === 'keepOut' ? 'Keep-out zone' : 'Slow zone';
  const status = notice ? `Published ${clockOf(notice.publishedAtMin)}, approved by ${notice.approvedBy}` : `Draft from ${clockOf(doc.createdAtMin)}, not published`;
  const simulated = doc.simulated || doc.kind === 'security';
  const contactId = doc.contactId;
  return (
    <aside className="insp" data-testid="zone-inspector">
      <div className="insp-head">
        <div className="insp-title">
          <h2 data-testid="zone-title">{doc.label ?? doc.publicReason}</h2>
          <p className="insp-meta"><span>{kindWord}</span><span>{status}</span>{simulated ? <Simulated /> : null}</p>
        </div>
        <div className="insp-actions">
          <button className="icon-btn" onClick={props.onCenter} aria-label="Center on the chart" title="Center on the chart"><Crosshair size={20} /></button>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close" data-testid="zone-close"><X size={20} /></button>
        </div>
      </div>
      <dl className="insp-kv">
        <Row label="Instruction" testId="zone-instruction"><span className="mono">{doc.instructionText}</span></Row>
        <Row label="Public reason">{doc.publicReason}</Row>
        <Row label="Where">{withMono(`${zone.center[1].toFixed(4)} N ${Math.abs(zone.center[0]).toFixed(4)} W`)}</Row>
        <Row label="Size">{zone.area ? withMono(`Forecast area plus ${zone.radiusM} m around the contact`) : withMono(`${zone.radiusM} m radius`)}</Row>
        {zone.movingTowardDeg !== null && !zone.area ? <Row label="Moving">{withMono(`${(zone.movingSpeedMps / 0.5144).toFixed(1)} kn toward ${Math.round(zone.movingTowardDeg)}°`)}</Row> : null}
        {notice ? <Row label="Valid">{withMono(`${clockOf(notice.publishedAtMin)} to ${clockOf(notice.expiresAtMin)}, ${minutesLeft(notice, snap.clock.simMin)}`)}</Row> : <Row label="Valid for">{withMono(`${doc.validForMin} min once published`)}</Row>}
        {doc.filedBy ? <Row label="Filed by">{doc.filedBy}</Row> : null}
        {doc.largeShipsOnly ? <Row label="Applies to">Ships over 300 tons</Row> : null}
        {doc.kind !== 'security' && doc.slowKnots ? <Row label="Speed limit">{withMono(`${doc.slowKnots} kn`)}</Row> : null}
        <Row label="Boats it moves">{withMono(`${doc.plan.boats.filter((b) => b.action !== 'none' && b.action !== 'headsUp' && b.priority !== 'P4').length} boats, +${Math.round(doc.plan.boats.reduce((s, b) => s + b.addedMin, 0))} boat-min`)}</Row>
        {notice ? <Row label="Phones told" testId="zone-acked">{withMono(`${acked} of ${deliveries.length} acknowledged${ships ? `, ${ships} ships by AIS and VHF` : ''}`)}</Row> : null}
        {today?.ackRate !== undefined && today?.ackRate !== null && !notice ? <Row label="Ack rate">{withMono(`${Math.round((today.ackRate ?? 0) * 100)}%`)}</Row> : null}
      </dl>
      {deliveries.length ? (
        <section className="insp-sec">
          <div className="insp-sec-head"><h3>Boats told</h3></div>
          <dl className="insp-kv flush">
            {deliveries.slice(0, 8).map((d) => <Row key={d.vesselId} label={d.vesselName}>{withMono(`${d.priority}, ${d.notResponding ? 'no reply' : STATE_WORD[lastState(d.states)]}`)}</Row>)}
          </dl>
        </section>
      ) : null}
      <section className="insp-sec">
        <div className="insp-sec-head"><h3>Change it</h3></div>
        <div className="zone-radius">
          <NumberBox value={radius} unit="m" min={50} max={3000} step={50} onChange={setRadius} testId="zone-radius" />
          <Button variant="secondary" onClick={() => void props.send('resizeZone', { zoneId: zone.id, radiusM: radius })} testId="zone-radius-set">Set radius</Button>
        </div>
        <p className="t-small c-muted">Or drag the square handle on the chart.</p>
        <div className="row-btns">
          {draft ? <Button variant="primary" icon={<PaperPlaneTilt size={16} />} onClick={() => void props.send('publish', { draftId: draft.id })} testId="zone-publish">Publish</Button> : null}
          {notice ? <Button variant="secondary" icon={<ClockClockwise size={16} />} onClick={() => void props.send('extendZone', { noticeId: notice.id, minutes: 30 })} testId="zone-extend">Extend 30 min</Button> : null}
          {notice ? <Button variant="secondary" icon={<StopCircle size={16} />} onClick={() => void props.send('endZone', { noticeId: notice.id })} testId="zone-end">{doc.kind === 'security' ? 'All clear' : 'End now'}</Button> : null}
          {draft ? <Button variant="quiet" onClick={() => void props.send('discardDraft', { draftId: draft.id })} testId="zone-discard">Discard</Button> : null}
          {contactId ? <Button variant="quiet" icon={<Files size={16} />} onClick={() => props.onDossier(contactId)} testId="zone-dossier">Contact dossier</Button> : null}
        </div>
      </section>
    </aside>
  );
}
