import type { ReactNode } from 'react';
import { Crosshair, DeviceMobile, X } from '@phosphor-icons/react';
import type { DataSource, VesselIntel, VesselView } from '../../shared/protocol';
import { Button, PriorityBand, Simulated } from '../ui';
import { compassAbbr } from '../format';
import { withMono } from './Headline';
import '../../styles/inspect.css';

const LEVEL_WORD: Record<VesselIntel['level'], string> = { normal: 'Normal', watch: 'Watch', anomalous: 'Anomalous' };

const bearing = (deg: number): string => `${String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')}°`;

function sourceWords(s: DataSource): ReactNode {
  if (s === 'ais-live') return <span>AIS live</span>;
  if (s === 'ais-replay') return <span>AIS replay</span>;
  return <Simulated />;
}

function Qty(props: { v: string; u?: string }) {
  return (
    <span className="qty">
      <span className="mono">{props.v}</span>
      {props.u ? <span className="u">{props.u}</span> : null}
    </span>
  );
}

function Missing(props: { text?: string }) {
  return <span className="na">{props.text ?? 'Not reported'}</span>;
}

function seen(sec: number | null): ReactNode {
  if (sec === null || !isFinite(sec)) return <Missing />;
  if (sec < 90) return <Qty v={sec.toFixed(0)} u="s ago" />;
  if (sec < 5400) return <Qty v={(sec / 60).toFixed(0)} u="min ago" />;
  return <Qty v={(sec / 3600).toFixed(1)} u="h ago" />;
}

function zText(z: number): string {
  return `${z >= 0 ? '+' : ''}${z.toFixed(1)}`;
}

function Row(props: { label: string; children: ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div data-testid={props.testId}>
      <dt>{props.label}</dt>
      <dd className={props.strong ? 'strong' : undefined}>{props.children}</dd>
    </div>
  );
}

function IntelSection(props: { intel: VesselIntel }) {
  const i = props.intel;
  const frac = Math.max(0, Math.min(1, i.score <= 1 ? i.score : i.score / 100));
  return (
    <section className="insp-sec" data-testid="inspector-intel">
      <div className="insp-sec-head">
        <h3>Behavior</h3>
        <span className={`insp-level ${i.level}`} data-testid="inspector-intel-level">{LEVEL_WORD[i.level]}</span>
      </div>
      <div className={`insp-score ${i.level}`} aria-label={`Behavior score ${i.score.toFixed(2)}`}>
        <span className="track"><i style={{ width: `${Math.max(1, Math.round(frac * 100))}%` }} /></span>
        <span className="mono" data-testid="inspector-intel-score">{i.score.toFixed(2)}</span>
      </div>
      <div className="insp-scale"><span>0</span><span>1</span></div>
      {i.reasons.length ? (
        <ul className="insp-reasons" data-testid="inspector-intel-reasons">
          {i.reasons.map((r, k) => <li key={k}>{withMono(r)}</li>)}
        </ul>
      ) : <p className="insp-note">Nothing unusual in its track.</p>}
      {i.features.length ? (
        <div className="insp-feat" data-testid="inspector-intel-features">
          <div className="insp-frow head"><span>Feature</span><span className="v">Value</span><span className="z">z</span></div>
          {i.features.map((f) => (
            <div className="insp-frow" key={f.label}>
              <span>{f.label}</span>
              <span className="v">{withMono(f.value)}</span>
              <span className={`z${f.z !== null && Math.abs(f.z) >= 2 ? ' far' : ''}`}>{f.z === null ? <span className="na">n/a</span> : zText(f.z)}</span>
            </div>
          ))}
          <p className="insp-note">z is how many standard deviations the value sits from the harbor's normal traffic.</p>
        </div>
      ) : null}
    </section>
  );
}

export function VesselInspector(props: { v: VesselView; onClose: () => void; onCenter: () => void }) {
  const { v } = props;
  const d = v.detail;
  const a = v.affected;
  return (
    <aside className="insp" data-testid="vessel-inspector" aria-label={`Vessel ${v.name}`}>
      <header className="insp-head">
        <div className="insp-title">
          <h2 data-testid="inspector-name">{v.name}</h2>
          <p className="insp-meta" data-testid="inspector-source"><span>{v.type}</span>{sourceWords(v.source)}</p>
        </div>
        <div className="insp-actions">
          <Button variant="quiet" icon={<Crosshair size={16} />} onClick={props.onCenter} title="Center on chart" testId="inspector-center" />
          <Button variant="quiet" icon={<X size={16} />} onClick={props.onClose} title="Close" testId="inspector-close" />
        </div>
      </header>
      {v.phone?.joined ? (
        <div className="insp-phone" data-testid="inspector-phone">
          <DeviceMobile size={16} />
          <span>Captain phone joined{v.phone.captain ? `, ${v.phone.captain}` : ''}</span>
        </div>
      ) : null}
      {a ? (
        <div className="insp-block" data-testid="inspector-affected">
          <PriorityBand priority={a.priority} testId="inspector-priority" />
          <dl className="insp-kv">
            <Row label="Action" strong testId="inspector-action">{withMono(a.text)}</Row>
            <Row label="Crosses">{a.crossingLabel ? <span className="mono">{a.crossingLabel}</span> : <Missing text="n/a" />}</Row>
            <Row label="Until">{a.untilLabel ? <span className="mono">{a.untilLabel}</span> : <Missing text="n/a" />}</Row>
          </dl>
        </div>
      ) : null}
      <dl className="insp-kv" data-testid="inspector-detail">
        <Row label="Length">{v.lengthM === null ? <Missing /> : <Qty v={v.lengthM.toFixed(0)} u="m" />}</Row>
        <Row label="Speed" testId="inspector-speed"><Qty v={d.sogKn.toFixed(1)} u="kn" /></Row>
        <Row label="Course"><Qty v={bearing(d.cogDeg)} u={compassAbbr(d.cogDeg)} /></Row>
        <Row label="Heading">{d.headingDeg === null ? <Missing /> : <Qty v={bearing(d.headingDeg)} u={compassAbbr(d.headingDeg)} />}</Row>
        <Row label="Destination">{d.destination ? withMono(d.destination) : <Missing />}</Row>
        <Row label="Reported ETA">{d.etaReported ? <span className="mono">{d.etaReported}</span> : <Missing />}</Row>
        <Row label="Last seen" testId="inspector-last-seen">{seen(d.lastSeenSec)}</Row>
        <Row label="Status">{withMono(d.status)}</Row>
        {d.activity ? <Row label="Activity">{withMono(d.activity)}</Row> : null}
        {d.mmsi !== null ? <Row label="MMSI"><span className="mono">{d.mmsi}</span></Row> : null}
        {v.inZone ? <Row label="Zone" strong>Inside a published zone</Row> : null}
      </dl>
      {v.intel ? <IntelSection intel={v.intel} /> : null}
    </aside>
  );
}
