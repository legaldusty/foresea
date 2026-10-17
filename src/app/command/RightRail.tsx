import { useState } from 'react';
import { ArrowCounterClockwise, CheckCircle, HandPalm, PaperPlaneTilt, Radio, Trash, WifiSlash } from '@phosphor-icons/react';
import type { Card, CommandEvents, CommandSnapshot, ContactView, Level, Notice, NoticeDraft, PublicReason, Recipients } from '../../shared/protocol';
import { Button, DecisionCard, Field, NumberBox, OddsRows, RiskBand, Segmented, SelectBox, Simulated, Slider, TextBox, TitleBlock } from '../ui';
import { clockOf, minutes } from '../format';
import { OddsHistory } from './OddsHistory';

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
  called: <Radio size={16} />, approve: <HandPalm size={16} />,
};

function cardMeta(c: Card, waiting: number): string {
  const first = c.kind === 'publish' ? 'Drafted by GIVE WAY from signed Standing Orders'
    : c.kind === 'notResponding' ? 'No acknowledgment in 4 min. Read this on VHF:'
    : `Raised ${clockOf(c.createdAtMin)}`;
  return [first, c.realerts ? `Re-alerted ${c.realerts} ${c.realerts === 1 ? 'time' : 'times'}` : '', c.backupCalled ? 'Backup officer called' : '', waiting ? `${waiting} more waiting` : '']
    .filter(Boolean).join('. ');
}

export function CardSlot(props: { card: Card; waiting: number; send: Send; simMin: number }) {
  const c = props.card;
  const compare = c.kind === 'publish' && c.facts.length >= 2;
  const [chosen, closing] = compare ? c.facts : ['', ''];
  return (
    <div className="card-slot" data-testid="card">
      <DecisionCard
        title={c.title}
        meta={cardMeta(c, props.waiting)}
        body={c.kind === 'notResponding' && c.script ? c.script : c.body}
        facts={compare
          ? <div className="compare"><div><span className="t-small c-muted">{chosen.includes(': ') ? chosen.split(': ')[0] : 'Gentlest response'}</span><span className="t-strong">{chosen.includes(': ') ? chosen.split(': ').slice(1).join(': ') : chosen}</span></div><div><span className="t-small">Closing the harbor</span><span className="t-body">{closing.split(': ').slice(1).join(': ') || 'every ship delayed'}</span></div></div>
          : c.facts.length && c.kind !== 'notResponding' ? <div className="facts">{c.facts.map((f) => <span key={f}>{f}</span>)}</div> : null}
        script={c.kind === 'notResponding' ? null : c.script}
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
  const filled = props.kind === 'friendly' || props.kind === 'debris';
  return (
    <svg className="glyph-diamond" viewBox="0 0 24 24" aria-hidden>
      <defs><clipPath id="dclip"><path d="M12 3 21 12 12 21 3 12Z" /></clipPath></defs>
      {filled ? <path d="M12 3 21 12 12 21 3 12Z" fill="var(--muted)" /> : props.level ? <rect x="0" y="0" width="12" height="24" fill={color} clipPath="url(#dclip)" /> : null}
      <path d="M12 3 21 12 12 21 3 12Z" fill="none" stroke={filled ? 'var(--muted)' : color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function registryLine(c: ContactView): string {
  const r = c.registry;
  const match = r.match ? `Registry match: ${r.match}, ${r.owner}.` : 'No registry or dive-plan match.';
  const reply = r.reply === 'correct' ? 'Correct reply to the ID ping.' : r.reply === 'wrong' ? 'Replied with an unregistered ID.' : `${r.pings} ID ${r.pings === 1 ? 'ping' : 'pings'}, no reply.`;
  return `${match} ${reply}`;
}

export function ContactSection(props: { c: ContactView; send: Send }) {
  const c = props.c;
  const h = c.hostility;
  const scored = c.risk !== null && c.classification.kind !== 'debris';
  return (
    <section className="section" data-testid="contact">
      <div className="contact-head">
        <Diamond kind={c.classification.kind} level={c.risk?.level ?? null} />
        <div className="title-block" style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span className="t-title">{c.label}</span><Simulated /></div>
          <span className="t-small c-muted">{c.classification.label}. {c.classification.detail}</span>
          <span className="t-small c-muted">{registryLine(c)}</span>
          {c.silent ? <span className="t-small icon-text c-text"><WifiSlash size={14} />Sensor lost {minutes(c.silentForMin)} ago. Score frozen, zone growing.</span> : null}
        </div>
      </div>
      {scored ? (
        <>
          <div className="hbar">
            <span className="t-strong">Hostility</span>
            <span className="track"><i style={{ width: `${Math.round(h.H * 100)}%` }} /></span>
            <span className="t-data">H {h.H.toFixed(2)}</span>
          </div>
          <div className="evidence two">
            <div className="row head"><span className="what">Evidence</span><span className="eff">Effect</span></div>
            {h.items.map((i) => <div className="row" key={i.key}><span className="what">{i.label}</span><span className="eff">{i.effect}</span></div>)}
            <div className="row total"><span className="what">Hostility H</span><span className="eff">{h.H.toFixed(2)}</span></div>
          </div>
        </>
      ) : <div className="why-line" data-testid="contact-why">{c.why}</div>}
      <div className="contact-actions">
        <Button variant="quiet" icon={<WifiSlash size={16} />} onClick={() => void props.send('sensorLoss', { contactId: c.id, silent: !c.silent })}>{c.silent ? 'Sensor back' : 'Sensor lost'}</Button>
        <Button variant="quiet" icon={<Trash size={16} />} onClick={() => void props.send('removeContact', { contactId: c.id })}>Remove</Button>
      </div>
    </section>
  );
}

export function OddsSection(props: { c: ContactView }) {
  const c = props.c;
  const meta = c.call
    ? <>Called {c.call.name} at <span className="t-mono-small">{clockOf(c.call.sinceMin)}</span>{c.call.etaMin !== null ? <>, ETA about {minutes(c.call.etaMin)}</> : null}</>
    : 'TELL odds, updated after every move. No call yet.';
  return (
    <section className="section">
      <TitleBlock size="heading" title="Where it is heading" meta={meta} />
      <OddsRows rows={c.odds} />
      <OddsHistory c={c} />
    </section>
  );
}

function levelForScore(score: number): string {
  return score <= 4 ? 'low' : score <= 9 ? 'medium' : score <= 14 ? 'serious' : score <= 19 ? 'high' : 'critical';
}

const DAMAGE: Record<string, string> = {
  fuel: 'could start a fire or a spill', islands: 'could start a fire or a spill', cruise: 'could hurt people on board or ashore',
  ferry: 'could hurt people on board or ashore', pier400: 'could damage a loaded ship and stop cargo work', research: 'could damage research equipment',
};

export function RiskSection(props: { c: ContactView }) {
  const c = props.c;
  const r = c.risk;
  if (!r || c.classification.kind === 'debris') {
    if (!r) return null;
    return (
      <section className="section-flush" data-testid="risk">
        <div className="section-title"><span className="t-heading">Risk</span><Simulated /></div>
        <RiskBand level={r.level} score={r.score} testId="risk-band" />
      </section>
    );
  }
  const rows = [5, 4, 3, 2, 1];
  return (
    <section className="section-flush" data-testid="risk">
      <div className="section-title"><span className="t-heading">Risk</span><Simulated /></div>
      <div className="risk-body">
        <div className="matrix" aria-label="5 by 5 risk matrix, likelihood by severity">
          <span className="ylabel">Likelihood</span>
          {rows.map((l) => (
            <div className="mrow" key={l}>
              <span className="axis">{l}</span>
              {[1, 2, 3, 4, 5].map((s) => {
                const here = l === r.L && s === r.S;
                return <span key={s} className={`cell lv-${levelForScore(l * s)}${here ? ' here' : ''}`}>{here ? l * s : ''}</span>;
              })}
            </div>
          ))}
          <div className="mrow"><span className="axis" />{[1, 2, 3, 4, 5].map((s) => <span className="axis" key={s}>{s}</span>)}</div>
          <span className="xlabel">Severity</span>
        </div>
        <div className="score">
          <span className="t-data-xl" data-testid="risk-score">{r.score}</span>
          <span className="t-small c-muted">Likelihood {r.L}</span>
          <span className="t-small c-muted">Severity {r.S}</span>
          <span className="target"><span className="t-small c-muted">Target</span><span className="t-strong">{r.targetName}</span></span>
        </div>
      </div>
      <div className="consequence t-body">A {c.sizeM.toFixed(1)} m {c.classification.label.toLowerCase()} at the {r.targetName} {DAMAGE[r.targetId] ?? 'could cause damage'}.</div>
      {r.notes.length ? <div className="consequence t-small c-muted">{r.notes.map((n) => `Rule: ${n}.`).join(' ')}</div> : null}
      <RiskBand level={r.level} score={r.score} testId="risk-band" />
    </section>
  );
}

export function NoticeEditor(props: { d: NoticeDraft; send: Send; simMin: number }) {
  const d = props.d;
  const [radius, setRadius] = useState(d.radiusM);
  const edit = (edits: CommandEvents['editDraft']['edits']) => void props.send('editDraft', { draftId: d.id, edits });
  const plan = d.plan;
  return (
    <section className="section" data-testid="notice-editor">
      <TitleBlock title="Notice to boats" meta={d.routine ? 'Drafted from a routine template you signed' : 'Drafted by GIVE WAY from signed Standing Orders'} />
      <Field label="Instruction">
        <SelectBox value={d.instruction} options={INSTRUCTIONS.map((o) => ({ value: o.value, label: o.value === d.instruction ? d.instructionText : o.label }))} onChange={(v) => edit({ instruction: v })} />
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
        <Field label="Valid until" width={132}>
          <div className="box"><span className="mono" style={{ flex: 1 }}>{clockOf(props.simMin + d.validForMin)}</span><span className="unit">local</span></div>
        </Field>
        <Field label="Approved by"><TextBox value={d.approvedBy} readOnly /></Field>
      </div>
      <div className="t-body">{d.wording.notice}</div>
      <div className="t-small c-muted">{d.wording.source === 'granite' ? `Worded by ${d.wording.model ?? 'Granite'} on this laptop from the facts. It decides nothing.` : 'Worded from templates.'}</div>
      <div className="compare">
        <div><span className="t-small c-muted">{plan.kind === 'hold' ? 'Gentlest response' : plan.kind === 'speedAdvisory' ? 'Slowing' : 'Rerouting'}</span><span className="t-strong" data-testid="plan-chosen">{plan.comparison.chosen.replace(/^(Rerouting|Slowing): /, '')}</span></div>
        <div><span className="t-small">Closing the harbor</span><span className="t-body">every ship delayed</span></div>
      </div>
      <Button variant="primary" block icon={<PaperPlaneTilt size={16} />} testId="publish" onClick={() => void props.send('publish', { draftId: d.id })}>Publish notice</Button>
      <div className="editor-foot">
        <span className="t-small c-muted">Next step up: {plan.nextStepUp}.</span>
        <Button variant="quiet" onClick={() => void props.send('discardDraft', { draftId: d.id })}>Discard</Button>
      </div>
    </section>
  );
}

export function PublishedNotice(props: { n: Notice; snap: CommandSnapshot; send: Send }) {
  const n = props.n;
  const [showWords, setShowWords] = useState(false);
  const undoEntry = props.snap.audit.find((a) => a.action === 'Published' && a.undoable && !a.undone && a.detail.startsWith(`${n.publicReason}: ${n.instructionText}`));
  const audience = n.recipients === 'all' ? 'All boats' : n.recipients === 'small' ? 'Small craft' : `Named: ${n.named.join(', ')}`;
  return (
    <section className="section" data-testid="notice-summary">
      <TitleBlock title="Notice published" meta={`Published ${clockOf(n.publishedAtMin)} by ${n.approvedBy}${n.routine ? ' from the routine template' : ''}`} />
      <div className="cap-instruction">{n.instructionText}</div>
      <dl className="kv-rows">
        <div><dt>Zone radius</dt><dd className="t-data">{Math.round(n.radiusM)} m</dd></div>
        <div><dt>Who gets it</dt><dd>{audience}</dd></div>
        <div><dt>Public reason</dt><dd>{n.publicReason}</dd></div>
        <div><dt>Valid until</dt><dd><span className="t-data">{clockOf(n.expiresAtMin)}</span> or All clear</dd></div>
        <div><dt>Response</dt><dd>{n.plan.comparison.chosen}</dd></div>
      </dl>
      <button className="tab" aria-selected={showWords} onClick={() => setShowWords(!showWords)}>{showWords ? 'Hide radio script and translations' : 'Radio script, AIS marker, text and translations'}</button>
      {showWords ? (
        <div className="evidence">
          <div className="row"><span className="what">VHF script</span><span className="why c-text">{n.wording.vhf}</span></div>
          <div className="row"><span className="what">AIS marker</span><span className="why c-text t-mono-small">{n.wording.aisMarker}</span></div>
          <div className="row"><span className="what">Text message</span><span className="why c-text">{n.wording.sms}</span></div>
          {Object.entries(n.wording.translations).map(([lang, text]) => (
            <div className="row" key={lang}><span className="what">{({ es: 'Español', zh: '中文', ko: '한국어', tl: 'Tagalog', vi: 'Tiếng Việt' } as Record<string, string>)[lang] ?? lang}</span><span className="why c-text">{text}</span></div>
          ))}
          <div className="row"><span className="what">Words by</span><span className="why">{n.wording.source === 'granite' ? `${n.wording.model} on this laptop, from the facts` : 'Templates'}</span></div>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" icon={<CheckCircle size={16} />} testId="all-clear" onClick={() => void props.send('allClear', {})}>All clear</Button>
        {undoEntry ? <Button variant="quiet" icon={<ArrowCounterClockwise size={16} />} onClick={() => void props.send('undo', { auditId: undoEntry.id })}>Undo publish</Button> : null}
      </div>
    </section>
  );
}
