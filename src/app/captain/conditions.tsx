import { Warning, Wind } from '@phosphor-icons/react';
import type { CaptainBulletin, CaptainConditions } from '../../shared/protocol';
import { ageText, compass16, feet, knotsWhole } from '../conditionsFormat';

export function BulletinStrip(props: { bulletins: CaptainBulletin[] }) {
  if (!props.bulletins.length) return null;
  return (
    <div className="cap-bulletins" data-testid="bulletins">
      {props.bulletins.map((b) => (
        <div className="cap-bulletin" key={b.id} data-testid={`bulletin-${b.id}`}>
          <Warning size={20} className="lead" />
          <div className="text">
            <span className="title">{b.title}{b.untilLabel ? <> until <span className="num">{b.untilLabel}</span></> : null}</span>
            <span className="detail">{b.detail}</span>
            <span className="meta">Relayed by {b.relayedBy} at <span className="num">{b.relayedAtLabel}</span>. Source {b.source}.</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function sourcesLine(c: CaptainConditions): string {
  const parts: string[] = [];
  if (c.wind) parts.push(`wind ${ageText(c.wind.ageMin)}`);
  if (c.waves) parts.push(`waves ${ageText(c.waves.ageMin)}`);
  return parts.length ? `NOAA, ${parts.join(', ')}.` : '';
}

export function ConditionsLine(props: { c: CaptainConditions | null | undefined }) {
  const c = props.c;
  if (!c) return null;
  const wind = c.wind
    ? <>Wind{c.wind.fromDeg !== null ? ` ${compass16(c.wind.fromDeg)}` : ''} <span className="num">{knotsWhole(c.wind.speedMps)}</span> kn{c.wind.gustMps !== null ? <>, gusts <span className="num">{knotsWhole(c.wind.gustMps)}</span></> : null}.</>
    : <>Wind: no data.</>;
  const waves = c.waves
    ? <> Waves <span className="num">{feet(c.waves.heightM)}</span> ft{c.waves.periodS !== null ? <> at <span className="num">{Math.round(c.waves.periodS)}</span> s</> : null}.</>
    : <> Waves: no data.</>;
  const tide = c.nextTide ? <> {c.nextTide.kind === 'high' ? 'High' : 'Low'} tide <span className="num">{c.nextTide.label}</span>.</> : <> Tide: no data.</>;
  return (
    <div className="cap-wx" data-testid="captain-conditions">
      <Wind size={20} className="lead" />
      <div className="text">
        <span className="line">{wind}{waves}{tide}</span>
        <span className="meta">{sourcesLine(c)}</span>
      </div>
    </div>
  );
}
