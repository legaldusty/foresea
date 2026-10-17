import { useState } from 'react';
import { ArrowCounterClockwise, CheckCircle, PaperPlaneTilt, Radio, Trash, WifiSlash } from '@phosphor-icons/react';
import type { Card, CommandEvents, CommandSnapshot, ContactView, Level, Notice, NoticeDraft, PublicReason, Recipients } from '../../shared/protocol';
import { Button, DecisionCard, Field, NumberBox, OddsRows, RiskBand, Segmented, SelectBox, Simulated, Slider, TextBox, TitleBlock } from '../ui';
import { clockOf, minutes } from '../format';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

const INSTRUCTIONS = [
  { value: 'KEEP CLEAR', label: 'KEEP CLEAR' },
  { value: 'SLOW', label: 'SLOW' },
  { value: 'USE EAST CHANNEL', label: 'USE EAST CHANNEL' },
  { value: 'USE MAIN CHANNEL', label: 'USE MAIN CHANNEL' },
  { value: 'WAIT', label: 'WAIT' },
];

const REASONS: { value: PublicReason; label: string }[] = [
  { value: 'Security zone', label: 'Security zone' },
  { value: 'Whale nearby', label: 'Whale nearby' },
  { value: 'Divers in water', label: 'Divers in water' },
  { value: 'Dredge working', label: 'Dredge working' },
  { value: 'Person in the water', label: 'Person in the water' },
];

const ACTION_ICON: Record<string, JSX.Element | null> = {
  publish: <PaperPlaneTilt size={16} />, publishZone: <PaperPlaneTilt size={16} />, send: <PaperPlaneTilt size={16} />,
  called: <Radio size={16} />, approve: <CheckCircle size={16} />,
};

export function CardSlot(props: { card: Card; waiting: number; send: Send; simMin: number }) {
  const c = props.card;
  const meta = [
    `Raised ${clockOf(c.createdAtMin)}`,
    c.realerts ? `re-alerted ${c.realerts} ${c.realerts === 1 ? 'time' : 'times'}` : '',
    c.backupCalled ? 'backup officer called' : '',
    props.waiting ? `${props.waiting} more waiting` : '',
  ].filter(Boolean).join(', ');
  return (
    <div className="card-wrap" data-testid="card">
      <DecisionCard
        title={c.title}
        meta={meta}
        body={c.body}
        facts={c.facts.length ? <div className="facts">{c.facts.map((f) => <span key={f}>{f}</span>)}</div> : null}
        script={c.script}
        actions={c.actions.map((a) => (
          <Button key={a.id} variant={a.primary ? 'primary' : 'secondary'} icon={a.primary ? ACTION_ICON[a.id] ?? null : null}
            testId={`card-${a.id}`} onClick={() => void props.send('cardAction', { cardId: c.id, actionId: a.id })}>{a.label}</Button>
        ))}
      />
    </div>
  );
}

function Diamond(props: { kind: string; level: Level | null }) {
  const color = props.level ? `var(--risk-${props.level.toLowerCase()})` : 'var(--text)';
  const fill = props.kind === 'friendly' ? 'var(--muted)' : props.level ? color : 'none';
  return (
    <svg className="glyph-diamond" viewBox="0 0 24 24" aria-hidden>
      <defs><clipPath id="dclip"><path d="M12 3 21 12 12 21 3 12Z" /></clipPath></defs>
      {props.level && props.kind !== 'friendly' ? <rect x="0" y="12" width="24" height="12" fill={fill} clipPath="url(#dclip)" /> : null}
      {props.kind === 'friendly' ? <path d="M12 3 21 12 12 21 3 12Z" fill={fill} /> : null}
      <path d="M12 3 21 12 12 21 3 12Z" fill="none" stroke={props.kind === 'friendly' ? 'var(--muted)' : color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function ContactSection(props: { c: ContactView; send: Send }) {
  const c = props.c;
  const h = c.hostility;
  const scored = c.risk !== null;
  return (
    <section className="section" data-testid="contact">
      <div className="contact-head">
        <Diamond kind={c.classification.kind} level={c.risk?.level ?? null} />
        <div className="title-block" style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="t-title">{c.label}</span>
            <Simulated />
          </div>
          <span className="t-small c-muted">{c.classification.label}. {c.classification.detail}</span>
        </div>
      </div>
      <dl className="kv">
        <dt>Registry</dt><dd>{c.registry.match ? `${c.registry.match}, ${c.registry.owner}` : 'No registry or dive-plan match'}</dd>
        <dt>ID ping</dt><dd>{c.registry.reply === 'correct' ? 'Correct reply' : c.registry.reply === 'wrong' ? 'Replied with an unregistered ID' : `${c.registry.pings} ${c.registry.pings === 1 ? 'ping' : 'pings'}, no reply`}</dd>
        {c.silent ? (<><dt>Sensor</dt><dd className="icon-text"><WifiSlash size={14} /> Lost {minutes(c.silentForMin)} ago. Score frozen, zone growing</dd></>) : null}
      </dl>
      {scored ? (
        <>
          <div className="hbar">
            <span className="t-strong">Hostility</span>
            <span className="track"><i style={{ width: `${Math.round(h.H * 100)}%` }} /></span>
            <span className="t-data">H {h.H.toFixed(2)}</span>
          </div>
          <div className="evidence">
            <div className="row head"><span className="what">Evidence</span><span className="eff">Effect</span></div>
            {h.items.map((i) => (
              <div className="row" key={i.key}><span className="what">{i.label}</span><span className="eff">{i.effect}</span></div>
            ))}
          </div>
        </>
      ) : null}
      <div className="why-line" data-testid="contact-why">{c.why}</div>
      <div className="contact-actions">
        <Button variant="quiet" icon={<WifiSlash size={16} />} onClick={() => void props.send('sensorLoss', { contactId: c.id, silent: !c.silent })}>{c.silent ? 'Sensor back' : 'Sensor lost'}</Button>
        <Button variant="quiet" icon={<Trash size={16} />} onClick={() => void props.send('removeContact', { contactId: c.id })}>Remove</Button>
      </div>
    </section>
  );
}

export function OddsSection(props: { c: ContactView }) {
  const c = props.c;
  return (
    <section className="section">
      <TitleBlock size="heading" title="Where it is heading" meta={c.call ? <>TELL called <b>{c.call.name}</b> at <span className="t-mono-small">{clockOf(c.call.sinceMin)}</span>{c.call.etaMin !== null ? <>, about {minutes(c.call.etaMin)} out</> : null}</> : 'TELL odds, updated every move. No call yet.'} />
      <OddsRows rows={c.odds} />
    </section>
  );
}

function levelForScore(score: number): string {
  return score <= 4 ? 'low' : score <= 9 ? 'medium' : score <= 14 ? 'serious' : score <= 19 ? 'high' : 'critical';
}

export function RiskSection(props: { c: ContactView }) {
  const r = props.c.risk;
  if (!r) return null;
  const rows = [5, 4, 3, 2, 1];
  return (
    <section className="section" data-testid="risk">
      <TitleBlock size="heading" title="Risk" meta={`Worst target: ${r.targetName}. Likelihood ${r.L} times severity ${r.S}.`} />
      <RiskBand level={r.level} score={r.score} testId="risk-band" />
      <div className="risk-split">
        <div className="matrix" aria-label="5 by 5 risk matrix">
          {rows.map((s) => (
            [<span className="axis" key={`a${s}`}>{s}</span>, ...[1, 2, 3, 4, 5].map((l) => (
              <span key={`${s}-${l}`} className={`cell lv-${levelForScore(l * s)}${l === r.L && s === r.S ? ' here' : ''}`}>{l * s}</span>
            ))]
          ))}
          <span />
          {[1, 2, 3, 4, 5].map((l) => <span className="axis" key={`l${l}`}>{l}</span>)}
        </div>
        <div className="risk-notes">
          <span>Rows: severity. Columns: likelihood.</span>
          {r.notes.length ? r.notes.map((n) => <span key={n}><b>Rule</b> {n}</span>) : <span>No final rule changed the score.</span>}
          {r.rawLevel !== r.level ? <span>Raw level {r.rawLevel}, shown {r.level}.</span> : null}
        </div>
      </div>
    </section>
  );
}

export function NoticeEditor(props: { d: NoticeDraft; send: Send; simMin: number }) {
  const d = props.d;
  const [radius, setRadius] = useState(d.radiusM);
  const edit = (edits: CommandEvents['editDraft']['edits']) => void props.send('editDraft', { draftId: d.id, edits });
  const plan = d.plan;
  const instructionKey = d.instruction;
  return (
    <section className="section" data-testid="notice-editor">
      <TitleBlock title="Notice to boats" meta={d.routine ? 'Drafted from a routine template you signed' : 'Drafted by GIVE WAY from signed Standing Orders'} />
      <Field label="Instruction">
        <SelectBox value={instructionKey} options={INSTRUCTIONS.map((o) => ({ value: o.value, label: o.value === instructionKey ? d.instructionText : o.label }))} onChange={(v) => edit({ instruction: v })} />
      </Field>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
        <Field label="Zone radius" width={120}>
          <NumberBox value={Math.round(radius)} unit="m" min={50} max={2000} step={50} testId="radius-input" onChange={(v) => { setRadius(v); edit({ radiusM: v }); }} />
        </Field>
        <Slider value={radius} min={100} max={2000} step={50} minLabel="100 m" maxLabel="2,000 m" onChange={(v) => { setRadius(v); edit({ radiusM: v }); }} />
      </div>
      <Field label="Who gets it">
        <Segmented<Recipients> value={d.recipients} onChange={(v) => edit({ recipients: v })}
          options={[{ value: 'all', label: 'All boats' }, { value: 'small', label: 'Small craft' }, { value: 'named', label: 'Named vessels' }]} />
      </Field>
      <Field label="Public reason">
        <SelectBox<PublicReason> value={d.publicReason} options={REASONS} onChange={(v) => edit({ publicReason: v })} />
      </Field>
      <div style={{ display: 'flex', gap: 16 }}>
        <Field label="Valid for" width={132}>
          <NumberBox value={d.validForMin} unit="min" min={10} max={480} step={10} onChange={(v) => edit({ validForMin: v })} />
        </Field>
        <Field label="Approved by">
          <TextBox value={d.approvedBy} readOnly />
        </Field>
      </div>
      <div className="t-small c-muted">{d.wording.source === 'granite' ? `Worded by ${d.wording.model ?? 'Granite'} on this laptop from the facts. It decides nothing.` : 'Worded from templates.'} Valid until {clockOf(props.simMin + d.validForMin)}.</div>
      <div className="t-body">{d.wording.notice}</div>
      <div className="compare">
        <div><span className="t-small c-muted">{plan.kind === 'hold' ? 'Gentlest response' : plan.kind === 'speedAdvisory' ? 'Slowing' : 'Rerouting'}</span><span className="t-strong" data-testid="plan-chosen">{plan.comparison.chosen.replace(/^(Rerouting|Slowing): /, '')}</span></div>
        <div><span className="t-small">Closing the harbor</span><span className="t-body">Every ship delayed</span></div>
      </div>
      {plan.boats.length ? (
        <div className="evidence">
          <div className="row head"><span className="what">Boat</span><span className="eff">Added</span><span className="why">Instruction</span></div>
          {plan.boats.slice(0, 8).map((b) => (
            <div className="row" key={b.vesselId}><span className="what">{b.name} <span className="t-mono-small c-muted">{b.priority}</span></span><span className="eff">+{b.addedMin.toFixed(1)}</span><span className="why">{b.instruction}</span></div>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" block icon={<PaperPlaneTilt size={16} />} testId="publish" onClick={() => void props.send('publish', { draftId: d.id })}>Publish notice</Button>
        <Button variant="secondary" onClick={() => void props.send('discardDraft', { draftId: d.id })}>Discard</Button>
      </div>
      <div className="t-small c-muted">Next step up: {plan.nextStepUp}. Nothing reaches the public without this tap.</div>
    </section>
  );
}

export function NoticeSummary(props: { n: Notice; snap: CommandSnapshot; send: Send }) {
  const n = props.n;
  const [showWords, setShowWords] = useState(false);
  const undoEntry = props.snap.audit.find((a) => a.action === 'Published' && a.undoable && !a.undone && a.detail.startsWith(`${n.publicReason}: ${n.instructionText}`));
  return (
    <section className="section" data-testid="notice-summary">
      <TitleBlock title={n.instructionText} meta={`${n.publicReason}. Published ${clockOf(n.publishedAtMin)} by ${n.approvedBy}. Valid until ${clockOf(n.expiresAtMin)}.`} />
      <div className="t-body">{n.wording.notice}</div>
      <div className="compare">
        <div><span className="t-small c-muted">Response</span><span className="t-strong">{n.plan.comparison.chosen}</span></div>
        <div><span className="t-small">Closing the harbor</span><span className="t-body">Every ship delayed</span></div>
      </div>
      <button className="tab" aria-selected={showWords} onClick={() => setShowWords(!showWords)}>{showWords ? 'Hide radio script and translations' : 'Radio script, AIS marker, text and translations'}</button>
      {showWords ? (
        <div className="evidence">
          <div className="row"><span className="what">VHF script</span><span className="why c-text">{n.wording.vhf}</span></div>
          <div className="row"><span className="what">AIS marker</span><span className="why c-text t-mono-small">{n.wording.aisMarker}</span></div>
          <div className="row"><span className="what">Text message</span><span className="why c-text">{n.wording.sms}</span></div>
          {Object.entries(n.wording.translations).map(([lang, text]) => (
            <div className="row" key={lang}><span className="what">{({ es: 'Spanish', zh: 'Chinese', ko: 'Korean', tl: 'Tagalog', vi: 'Vietnamese' } as Record<string, string>)[lang] ?? lang}</span><span className="why c-text">{text}</span></div>
          ))}
          <div className="row"><span className="what">Words by</span><span className="why">{n.wording.source === 'granite' ? `${n.wording.model} on this laptop, from the facts` : 'Templates'}</span></div>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" icon={<CheckCircle size={16} />} testId="all-clear" onClick={() => void props.send('allClear', {})}>All clear</Button>
        {undoEntry ? <Button variant="secondary" icon={<ArrowCounterClockwise size={16} />} onClick={() => void props.send('undo', { auditId: undoEntry.id })}>Undo publish</Button> : null}
      </div>
    </section>
  );
}

