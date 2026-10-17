import { CaretRight, Warning, Wind } from '@phosphor-icons/react';
import type { CaptainBulletin, CaptainConditions } from '../../shared/protocol';
import { ageText, compass16, feet, knotsWhole } from '../conditionsFormat';

function BulletinBody(props: { b: CaptainBulletin }) {
  const b = props.b;
  return (
    <>
      <Warning size={20} className="lead" />
      <span className="text">
        <span className="title">{b.title}{b.untilLabel ? <> until <span className="num">{b.untilLabel}</span></> : null}</span>
        <span className="detail">{b.detail}</span>
        <span className="meta">Relayed by {b.relayedBy} at <span className="num">{b.relayedAtLabel}</span>. Source {b.source}.</span>
      </span>
    </>
  );
}

export function BulletinStrip(props: { bulletins: CaptainBulletin[]; full?: boolean; onOpen?: () => void }) {
  if (!props.bulletins.length) return null;
  return (
    <div className={`cap-bulletins${props.full ? ' full' : ''}`} data-testid="bulletins">
      {props.bulletins.map((b) => props.onOpen ? (
        <button type="button" className="cap-bulletin" key={b.id} onClick={props.onOpen} data-testid={`bulletin-${b.id}`} aria-label={`${b.title}. Open conditions`}>
          <BulletinBody b={b} />
          <CaretRight size={20} className="go" />
        </button>
      ) : (
        <div className="cap-bulletin" key={b.id} data-testid={`bulletin-${b.id}`}><BulletinBody b={b} /></div>
      ))}
    </div>
  );
}

export function conditionsAges(c: CaptainConditions): string {
  const parts: string[] = [];
  if (c.wind) parts.push(`wind ${ageText(c.wind.ageMin)}`);
  if (c.waves) parts.push(`waves ${ageText(c.waves.ageMin)}`);
  return parts.length ? `NOAA, ${parts.join(', ')}.` : '';
}

export function ConditionsSummary(props: { c: CaptainConditions }) {
  const c = props.c;
  const wind = c.wind
    ? <>Wind{c.wind.fromDeg !== null ? ` ${compass16(c.wind.fromDeg)}` : ''} <span className="num">{knotsWhole(c.wind.speedMps)}</span> kn{c.wind.gustMps !== null ? <>, gusts <span className="num">{knotsWhole(c.wind.gustMps)}</span></> : null}.</>
    : <>Wind: no data.</>;
  const waves = c.waves
    ? <> Waves <span className="num">{feet(c.waves.heightM)}</span> ft{c.waves.periodS !== null ? <> at <span className="num">{Math.round(c.waves.periodS)}</span> s</> : null}.</>
    : <> Waves: no data.</>;
  const tide = c.nextTide ? <> {c.nextTide.kind === 'high' ? 'High' : 'Low'} tide <span className="num">{c.nextTide.label}</span>.</> : <> Tide: no data.</>;
  return <>{wind}{waves}{tide}</>;
}

export function ConditionsLine(props: { c: CaptainConditions | null | undefined; onOpen: () => void }) {
  const c = props.c;
  if (!c) return null;
  return (
    <button type="button" className="cap-wx" onClick={props.onOpen} data-testid="captain-conditions">
      <Wind size={20} className="lead" />
      <span className="text">
        <span className="line"><ConditionsSummary c={c} /></span>
        <span className="meta">{conditionsAges(c)} Tap for tide, wind and the forecast.</span>
      </span>
      <CaretRight size={20} className="go" />
    </button>
  );
}
