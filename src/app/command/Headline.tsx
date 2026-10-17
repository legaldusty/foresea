import type { ReactNode } from 'react';
import { BellRinging, CheckCircle, Crosshair, Gauge, Path, Warning } from '@phosphor-icons/react';
import type { Headline as HeadlineView, Level, StepKey, StepView } from '../../shared/protocol';

const NUMBERS = /(\d{1,2}:\d{2}|\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b)/g;

export function withMono(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMBERS)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<span key={at} className="mono">{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Headline(props: { h: HeadlineView; level: Level | null }) {
  const edge = props.h.tone === 'calm' ? null : props.level ? `risk-${props.level.toLowerCase()}` : props.h.tone === 'alert' ? 'risk-high' : 'risk-medium';
  return (
    <div className="cmd-headline" data-testid="headline">
      {edge ? <i className={`edge ${edge}`} /> : null}
      {props.h.tone === 'alert' ? <Warning size={24} weight="bold" className="alert-icon" /> : null}
      <p className="text">{withMono(props.h.text)}</p>
    </div>
  );
}

const STEP_ICON: Record<StepKey, ReactNode> = {
  detect: <Crosshair size={16} />,
  predict: <Path size={16} />,
  assess: <Gauge size={16} />,
  warn: <BellRinging size={16} />,
  confirm: <CheckCircle size={16} />,
};

export function StepStrip(props: { steps: StepView[] }) {
  return (
    <div className="cmd-steps" data-testid="steps">
      {props.steps.map((s) => (
        <div key={s.key} className={`step${s.current ? ' current' : ''}${s.reached || s.current ? '' : ' next'}`} data-testid={`step-${s.key}`}>
          {STEP_ICON[s.key]}
          <span className="label">{s.label}</span>
          {s.fact && (s.reached || s.current) ? <span className="fact">{withMono(s.fact)}</span> : null}
        </div>
      ))}
    </div>
  );
}
