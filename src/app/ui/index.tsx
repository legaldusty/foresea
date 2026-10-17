import type { ReactNode } from 'react';
import { CaretDown, Eye, MapPin, ShieldCheck, Siren, Warning } from '@phosphor-icons/react';
import type { DeliveryState, Level, Priority } from '../../shared/protocol';
import { DELIVERY_STATES } from '../../shared/protocol';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button(props: {
  variant?: Variant; size?: 'm' | 'l'; block?: boolean; icon?: ReactNode; children?: ReactNode; onClick?: () => void;
  disabled?: boolean; title?: string; testId?: string; type?: 'button' | 'submit';
}) {
  const cls = ['btn', `btn-${props.variant ?? 'secondary'}`, props.size === 'l' ? 'btn-l' : '', props.block ? 'btn-block' : '', !props.children ? 'btn-icon' : ''].filter(Boolean).join(' ');
  return (
    <button type={props.type ?? 'button'} className={cls} onClick={props.onClick} disabled={props.disabled} title={props.title ?? (typeof props.children === 'string' ? props.children : undefined)} aria-label={props.title} data-testid={props.testId}>
      {props.icon}
      {props.children !== undefined && props.children !== null ? <span className="btn-label">{props.children}</span> : null}
    </button>
  );
}

export function TitleBlock(props: { title: ReactNode; meta?: ReactNode; size?: 'title' | 'heading'; aside?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="title-block">
        <div className={props.size === 'heading' ? 't-heading' : 't-title'}>{props.title}</div>
        {props.meta ? <div className="t-small">{props.meta}</div> : null}
      </div>
      {props.aside}
    </div>
  );
}

export function Field(props: { label: string; children: ReactNode; width?: number | string }) {
  return (
    <label className="field" style={props.width !== undefined ? { width: props.width, flex: 'none' } : { flex: 1 }}>
      <span className="label">{props.label}</span>
      {props.children}
    </label>
  );
}

export function NumberBox(props: { value: number; unit: string; onChange: (v: number) => void; min?: number; max?: number; step?: number; testId?: string }) {
  return (
    <div className="box">
      <input type="number" value={props.value} min={props.min} max={props.max} step={props.step ?? 1} data-testid={props.testId}
        onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) props.onChange(v); }} />
      <span className="unit">{props.unit}</span>
    </div>
  );
}

export function TextBox(props: { value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean; mono?: boolean; unit?: string }) {
  return (
    <div className="box">
      <input className={props.mono ? 'mono' : ''} value={props.value} placeholder={props.placeholder} readOnly={props.readOnly} onChange={(e) => props.onChange?.(e.target.value)} />
      {props.unit ? <span className="unit">{props.unit}</span> : null}
    </div>
  );
}

export function SelectBox<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="box">
      <select value={String(props.value)} data-testid={props.testId}
        onChange={(e) => { const found = props.options.find((o) => String(o.value) === e.target.value); if (found) props.onChange(found.value); }}>
        {props.options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
      <CaretDown size={16} className="caret" />
    </div>
  );
}

export function Segmented<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; compact?: boolean; testId?: string }) {
  return (
    <div className={`seg${props.compact ? ' compact' : ''}`} role="group" data-testid={props.testId}>
      {props.options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Slider(props: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; minLabel: string; maxLabel: string }) {
  const fill = `${((props.value - props.min) / (props.max - props.min)) * 100}%`;
  return (
    <div className="slider">
      <div className="track">
        <div className="rail" />
        <div className="fill" style={{ width: fill }} />
        <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      </div>
      <div className="range"><span>{props.minLabel}</span><span>{props.maxLabel}</span></div>
    </div>
  );
}

export const RUNG_TEXT: Record<Level, string> = {
  Low: 'Log / Watch. No notice',
  Medium: 'Ask. ID ping, registry check, watch',
  Serious: 'Slow / give way. Officer publishes',
  High: 'Hold one berth. Officer approves',
  Critical: 'Hand off. Officer approves the brief',
};

export function RiskBand(props: { level: Level; score: number; rung?: string; testId?: string }) {
  const Icon = props.level === 'Critical' ? Siren : props.level === 'High' || props.level === 'Serious' ? Warning : props.level === 'Medium' ? Eye : ShieldCheck;
  const bold = props.level === 'High' || props.level === 'Critical';
  return (
    <div className={`band band-${props.level.toLowerCase()}`} data-testid={props.testId}>
      <Icon size={20} weight={bold ? 'bold' : 'regular'} />
      <div className="level"><b>{props.level}</b><span className="t-data" data-testid="risk-score">{props.score}</span></div>
      <div className="rung">{props.rung ?? RUNG_TEXT[props.level]}</div>
    </div>
  );
}

export const PRIORITY_WORDS: Record<Priority, { words: string; when: string }> = {
  P1: { words: 'Act now', when: 'In the zone, or entering within 5 min' },
  P2: { words: 'Act soon', when: 'Your route reaches it within 15 min' },
  P3: { words: 'Heads up', when: 'Your route crosses it later' },
  P4: { words: 'Info', when: 'Not on your route' },
};

export function PriorityBand(props: { priority: Priority; when?: string; testId?: string }) {
  const p = props.priority;
  const Icon = p === 'P1' ? Siren : p === 'P2' ? Warning : p === 'P3' ? Eye : MapPin;
  return (
    <div className={`pband pband-${p}`} data-testid={props.testId}>
      <Icon size={24} weight={p === 'P1' || p === 'P2' ? 'bold' : 'regular'} />
      <div className="who"><span className="t-data">{p}</span><b>{PRIORITY_WORDS[p].words}</b></div>
      <div className="when">{props.when ?? PRIORITY_WORDS[p].when}</div>
    </div>
  );
}

export function OddsRows(props: { rows: { id: string; name: string; p: number; kind: 'target' | 'lost' | 'drift' }[]; limit?: number }) {
  const targets = props.rows.filter((r) => r.kind === 'target').slice(0, props.limit ?? 4);
  const others = props.rows.filter((r) => r.kind !== 'target');
  const top = targets[0];
  return (
    <div className="odds" data-testid="tell-odds">
      {[...targets, ...others].map((r) => (
        <div key={r.id} className={`odds-row${r === top ? ' top' : ''}${r.kind !== 'target' ? ' quiet' : ''}`} data-testid={r === top ? 'tell-top' : undefined}>
          <span className="name">{r.name}</span>
          <span className="bar"><i style={{ width: `${Math.max(1, Math.round(r.p * 100))}%` }} /></span>
          <span className="pct">{Math.round(r.p * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export function StepTrack(props: { states: Partial<Record<DeliveryState, number>> }) {
  const reached = DELIVERY_STATES.filter((s) => props.states[s] !== undefined).length;
  return (
    <span className="steps" aria-label={`${reached} of 5 steps`}>
      <span className="fill" style={{ width: Math.max(0, (reached - 1) * 24) }} />
      {DELIVERY_STATES.map((s, i) => <i key={s} className={props.states[s] !== undefined ? 'on' : ''} style={{ left: i * 24 }} />)}
    </span>
  );
}

export function Simulated(props: { text?: string }) {
  return <span className="simulated">{props.text ?? 'Simulated'}</span>;
}

export function DecisionCard(props: {
  title: string; meta?: ReactNode; body: ReactNode; facts?: ReactNode; script?: string | null; actions: ReactNode; testId?: string;
}) {
  return (
    <div className="card-single" data-testid={props.testId}>
      <TitleBlock title={<span data-testid="card-title">{props.title}</span>} meta={props.meta} />
      <div className="t-body">{props.body}</div>
      {props.facts}
      {props.script ? <div className="script">{props.script}</div> : null}
      <div className="actions">{props.actions}</div>
    </div>
  );
}
