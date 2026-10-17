import type { ReactNode } from 'react';
import { ClipboardText, Files, HandPalm, PaperPlaneTilt, PencilSimple, Question, Radio, ShieldWarning, Stop, Timer, X } from '@phosphor-icons/react';
import type { Card, CommandEvents, CommandSnapshot, ContactView, Level, NoticeDraft, PlanView } from '../../shared/protocol';
import { LEVELS } from '../../shared/protocol';
import { Button, RiskBand, Simulated } from '../ui';
import { clockOf } from '../format';
import { withMono } from './Headline';
import { OddsHistory } from './OddsHistory';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

const ACTION_ICON: Record<string, ReactNode> = {
  publish: <PaperPlaneTilt size={16} />, publishZone: <PaperPlaneTilt size={16} />, publishUpdate: <PaperPlaneTilt size={16} />,
  send: <ShieldWarning size={16} />, called: <Radio size={16} />, approve: <HandPalm size={16} />, holdAuto: <Stop size={16} />,
};

function AutoPublish(props: { card: Card; wallMs: number; vetoSeconds: number }) {
  const at = props.card.autoAtWall;
  if (!at) return null;
  const left = Math.max(0, (at - props.wallMs) / 1000);
  const share = Math.max(0, Math.min(1, left / Math.max(1, props.vetoSeconds)));
  return (
    <div className="auto-publish" data-testid="auto-publish">
      <Timer size={20} />
      <div className="ap-text">
        <span className="t-strong">Publishing on your behalf in <span className="mono">{Math.ceil(left)}</span> s</span>
        <span className="t-small c-muted">{props.card.autoOrder}. Stop keeps it waiting for you.</span>
      </div>
      <span className="ap-track"><i style={{ width: `${share * 100}%` }} /></span>
    </div>
  );
}

const COMPASS: Record<string, string> = { NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };

export function sentence(text: string): string {
  if (text === 'NO ACTION NEEDED YET' || text === 'KEEP CLEAR AND STAND BY') return 'Heads-up only';
  const short = text.replace(/\b(NORTHEAST|NORTHWEST|SOUTHEAST|SOUTHWEST|NORTH|SOUTH|EAST|WEST)\b/g, (w) => `@${COMPASS[w]}`);
  const lower = short.toLowerCase().replace(/@([a-z]+)/g, (_, c: string) => c.toUpperCase());
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function minutesText(m: number): string {
  return m < 0.5 ? '0 min' : `+${Math.round(m)} min`;
}

function cardMeta(c: Card, waiting: number): string {
  const first = c.kind === 'publish' ? `Drafted ${clockOf(c.createdAtMin)} from the signed Standing Orders`
    : c.kind === 'notResponding' ? 'No acknowledgment in 4 min'
    : `Raised ${clockOf(c.createdAtMin)}`;
  return [first, c.realerts ? `re-alerted ${c.realerts} ${c.realerts === 1 ? 'time' : 'times'}` : '', c.backupCalled ? 'backup officer called' : '', waiting ? `${waiting} more waiting` : '']
    .filter(Boolean).join(', ');
}

function BoatTable(props: { plan: PlanView }) {
  const rows = props.plan.boats.filter((b) => b.priority !== 'P4' && !b.vesselId.startsWith('ais-'));
  const ships = props.plan.boats.filter((b) => b.priority !== 'P4' && b.vesselId.startsWith('ais-')).length;
  const total = rows.reduce((s, b) => s + b.addedMin, 0);
  if (!rows.length) return <p className="t-small c-muted">No boat meets it in place and time. Everyone else sees it on the map.</p>;
  return (
    <div className="boat-table" data-testid="boat-table">
      <div className="brow head"><span>Boat</span><span>Action</span><span className="num">Delay</span><span className="num">Crosses</span></div>
      {rows.map((b) => (
        <div className={`brow ${b.priority}${b.noGentle ? ' stuck' : ''}`} key={b.vesselId} data-testid={`boat-${b.vesselId}`}>
          <span className="boat">{b.name}</span>
          <span>{b.noGentle ? 'No gentle option' : sentence(b.instruction)}{b.untilLabel && !b.noGentle && b.action !== 'headsUp' ? <span className="c-muted"> until <span className="mono">{b.untilLabel}</span></span> : null}</span>
          <span className="num mono">{b.action === 'headsUp' || b.action === 'none' ? '' : minutesText(b.addedMin)}</span>
          <span className="num mono">{b.crossingLabel ?? ''}</span>
        </div>
      ))}
      <div className="brow total"><span>Total</span><span><span className="mono">{total < 0.5 ? '0' : `+${Math.round(total)}`}</span> boat-minutes, no gate closed{ships ? `. ${ships} ships told by AIS and VHF` : ''}</span><span /><span /></div>
    </div>
  );
}

export function DecisionSlot(props: {
  snap: CommandSnapshot; send: Send; onWhy: () => void; editing: boolean; onEdit: () => void; editor: ReactNode;
}) {
  const { snap } = props;
  const c = snap.card;
  if (!c) return null;
  const draft: NoticeDraft | null = c.draftId ? snap.drafts.find((d) => d.id === c.draftId) ?? null : null;
  const act = (id: string) => void props.send('cardAction', { cardId: c.id, actionId: id });
  const isDraft = c.kind === 'publish' && draft;
  const stuck = draft ? draft.plan.boats.filter((b) => b.noGentle).map((b) => b.name) : [];
  const moving = draft ? draft.plan.boats.filter((b) => !b.vesselId.startsWith('ais-') && b.action !== 'none' && b.action !== 'headsUp' && b.priority !== 'P4').length : 0;
  const headsUp = draft ? draft.plan.boats.filter((b) => !b.vesselId.startsWith('ais-') && b.action === 'headsUp').length : 0;
  const title = isDraft && draft.kind === 'security'
    ? stuck.length ? `No gentle option for ${stuck.join(' and ')}. Hand it off or edit the notice.`
      : `Publish this notice. ${moving} boat${moving === 1 ? '' : 's'} give${moving === 1 ? 's' : ''} way${headsUp ? `, ${headsUp} get${headsUp === 1 ? 's' : ''} a heads-up` : ''} and nothing closes.`
    : c.title;
  return (
    <div className="decision" data-testid="decision-card">
      <p className="d-title" data-testid="card-title">{withMono(title)}</p>
      <p className="d-meta">{withMono(cardMeta(c, snap.cardsWaiting))}</p>
      {isDraft ? <BoatTable plan={draft.plan} /> : (
        <>
          {c.body ? <p className="d-body">{withMono(c.body)}</p> : null}
          {c.facts.length ? <div className="d-facts">{c.facts.filter(Boolean).map((f, i) => <span key={i}>{withMono(f)}</span>)}</div> : null}
        </>
      )}
      {c.script ? <div className="script">{c.script}</div> : null}
      <AutoPublish card={c} wallMs={snap.clock.wallMs} vetoSeconds={snap.orders.orders.vetoSeconds ?? 20} />
      <div className="d-actions">
        {c.actions.map((a) => (
          <Button key={a.id} variant={a.primary ? 'primary' : a.id === 'discard' || a.id === 'notNow' || a.id === 'dismiss' || a.id === 'ok' ? 'quiet' : 'secondary'}
            icon={ACTION_ICON[a.id]} onClick={() => act(a.id)} testId={`card-${a.id}`}>{a.label}</Button>
        ))}
        {isDraft ? <Button variant="secondary" icon={<PencilSimple size={16} />} onClick={props.onEdit} testId="edit-draft">{props.editing ? 'Close' : 'Edit'}</Button> : null}
      </div>
      {props.editing ? props.editor : null}
      {c.contactId ? <div className="d-why">
        <Button variant="quiet" icon={<Question size={16} />} onClick={props.onWhy} testId="why">Why?</Button>
        <span className="t-small c-muted">Evidence, risk grid, odds, rules</span>
      </div> : null}
    </div>
  );
}

export function HeadingBlock(props: { c: ContactView }) {
  const c = props.c;
  const f = c.forecast;
  const rows = c.odds.filter((o) => o.kind === 'target').sort((a, b) => b.p - a.p).slice(0, 4);
  return (
    <section className="rail-block" data-testid="heading-block">
      <div className="block-title"><span className="t-heading">{f?.drifting ? 'Where it is drifting' : 'Where it is heading'}</span><Simulated /></div>
      <p className="t-small c-muted">{f ? withMono(f.arrival ? `Arrives ${f.arrival.earlyLabel} to ${f.arrival.lateLabel}. TELL odds, updated every second.` : f.words) : 'Waiting for the first moves.'}</p>
      {f?.drifting ? null : rows.map((r, i) => (
        <div className={`odds-row${i === 0 ? ' top' : r.p < 0.05 ? ' muted' : ''}`} key={r.id}>
          <span className="name">{r.name}</span>
          <span className="bar"><i style={{ width: `${Math.round(r.p * 100)}%` }} /></span>
          <span className="mono">{Math.round(r.p * 100)}%</span>
        </div>
      ))}
    </section>
  );
}

export function ContactBlock(props: { c: ContactView; onDossier: () => void; onReport: () => void }) {
  const c = props.c;
  return (
    <section className="rail-block contact-block" data-testid="contact-block">
      {c.risk ? <RiskBand level={c.risk.level} score={c.risk.score} /> : null}
      <div className="block-title"><span className="t-heading">{c.label}</span><Simulated /></div>
      <p className="t-small c-muted">{withMono(`${c.classification.label}: ${c.classification.detail}. ${c.registry.match ? `Registry match: ${c.registry.match}.` : 'No registry or dive-plan match.'} ${c.registry.pings} ID ping${c.registry.pings === 1 ? '' : 's'}, ${c.registry.reply === 'correct' ? 'correct reply' : 'no reply'}.`)}</p>
      <Button variant="secondary" icon={<Files size={16} />} onClick={props.onDossier} testId="open-dossier">Full dossier: sensor, size, heat, path, risk math</Button>
      <Button variant="quiet" icon={<ClipboardText size={16} />} onClick={props.onReport} testId="open-report">After-action report</Button>
    </section>
  );
}

function RiskGrid(props: { L: number; S: number; R: number; level: Level }) {
  const levelFor = (score: number): Level => (score <= 4 ? 'Low' : score <= 9 ? 'Medium' : score <= 14 ? 'Serious' : score <= 19 ? 'High' : 'Critical');
  return (
    <div className="risk-grid">
      <span className="axis-y">How bad if it does</span>
      <div className="cells">
        {[5, 4, 3, 2, 1].map((s) => [1, 2, 3, 4, 5].map((l) => {
          const lv = levelFor(l * s);
          const here = l === props.L && s === props.S;
          return <span key={`${l}-${s}`} className={`cell risk-${lv.toLowerCase()}${here ? ' here' : ''}`}>{here ? props.R : ''}</span>;
        }))}
      </div>
      <span className="axis-x">How likely it reaches a target</span>
    </div>
  );
}

export function WhyDrawer(props: { snap: CommandSnapshot; c: ContactView | null; plan: PlanView | null; onClose: () => void }) {
  const { c, plan } = props;
  const options = (plan?.boats ?? []).filter((b) => b.options.length && !b.vesselId.startsWith('ais-'));
  return (
    <aside className="why" data-testid="why-drawer">
      <div className="why-head"><span className="t-title">Why Foresea suggests this</span><button className="icon-btn" onClick={props.onClose} aria-label="Close"><X size={20} /></button></div>
      {c ? (
        <>
          <section>
            <span className="t-heading">Is it hostile?</span>
            <div className="ev-table">
              {c.hostility.items.map((e) => <div key={e.key}><span>{e.label}</span><span className="mono">{e.effect}</span></div>)}
              <div className="sum"><span>Hostility estimate</span><span className="mono">{c.hostility.H.toFixed(2)}</span></div>
            </div>
          </section>
          {c.risk ? (
            <section>
              <span className="t-heading">How bad, how likely</span>
              <p className="t-small c-muted">{withMono(`Risk ${c.risk.score} of 25: ${c.risk.level}. Worst target ${c.risk.targetName}.`)}</p>
              <RiskGrid L={c.risk.L} S={c.risk.S} R={c.risk.score} level={c.risk.level} />
            </section>
          ) : null}
          <section>
            <span className="t-heading">Where it is going, over time</span>
            <OddsHistory c={c} />
          </section>
          {c.risk?.notes.length ? (
            <section>
              <span className="t-heading">Rules that fired</span>
              <ul className="rules">{c.risk.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </section>
          ) : null}
        </>
      ) : <p className="t-body c-muted">No contact selected.</p>}
      {options.length ? (
        <section>
          <span className="t-heading">The gentlest fix for each boat</span>
          {options.map((b) => (
            <div className="fix-table" key={b.vesselId}>
              <span className="t-strong">{b.name}</span>
              {b.options.map((o) => <div key={o.kind}><span>{o.label}</span><span className="mono">{o.addedMin === null ? 'no' : `+${o.addedMin.toFixed(1)} min`}</span><span className="c-muted">{o.why}</span></div>)}
            </div>
          ))}
        </section>
      ) : null}
      <section>
        <span className="t-heading">Log</span>
        <div className="why-log">
          {props.snap.audit.slice(0, 14).map((a) => <div key={a.id}><span className="mono">{clockOf(a.atMin)}</span><span>{a.action}</span><span className="c-muted">{a.detail}</span></div>)}
        </div>
      </section>
    </aside>
  );
}

export const LEVEL_ORDER = LEVELS;
