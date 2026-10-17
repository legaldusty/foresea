import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, Clock, Play, X } from '@phosphor-icons/react';
import { Button } from './index';

export interface TourStep {
  id: string;
  chapter: string;
  title: string;
  body: ReactNode;
  target?: string | string[];
  action?: { label: string; run: () => void | Promise<void> };
  waitFor?: { done: () => boolean; waiting: string; ready: string; advance?: boolean };
  enter?: () => void;
}

interface Box { x: number; y: number; w: number; h: number }

const GAP = 12;
const MARGIN = 16;
const RING = 6;

function find(selector: string | string[] | undefined): HTMLElement | null {
  if (!selector) return null;
  for (const one of Array.isArray(selector) ? selector : [selector]) {
    for (const el of document.querySelectorAll<HTMLElement>(one)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

function boxOf(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const w = Math.min(window.innerWidth, r.right) - x;
  const h = Math.min(window.innerHeight, r.bottom) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function placePopover(target: Box | null, pop: { w: number; h: number }, compact: boolean): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - pop.w - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(vh - pop.h - MARGIN, y));
  if (!target) return { left: clampX((vw - pop.w) / 2), top: clampY((vh - pop.h) / 2) };
  if (compact) {
    const below = target.y + target.h / 2 < vh / 2;
    return { left: MARGIN, top: below ? vh - pop.h - MARGIN : MARGIN };
  }
  const cx = target.x + target.w / 2 - pop.w / 2;
  if (target.y + target.h + GAP + pop.h <= vh - MARGIN) return { left: clampX(cx), top: target.y + target.h + GAP };
  if (target.y - GAP - pop.h >= MARGIN) return { left: clampX(cx), top: target.y - GAP - pop.h };
  const cy = clampY(target.y + target.h / 2 - pop.h / 2);
  if (target.x + target.w + GAP + pop.w <= vw - MARGIN) return { left: target.x + target.w + GAP, top: cy };
  if (target.x - GAP - pop.w >= MARGIN) return { left: target.x - GAP - pop.w, top: cy };
  return { left: clampX(cx), top: clampY(vh - pop.h - MARGIN) };
}

export function TourOverlay(props: { steps: TourStep[]; index: number; onIndex: (i: number) => void; onClose: () => void; compact?: boolean; testId?: string }) {
  const step = props.steps[Math.min(props.index, props.steps.length - 1)];
  const [target, setTarget] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [ran, setRan] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const advanced = useRef(false);
  const advanceTimer = useRef<number | null>(null);
  const indexRef = useRef(props.index);
  indexRef.current = props.index;
  const last = props.index >= props.steps.length - 1;

  useEffect(() => {
    setRan(false);
    setReady(false);
    advanced.current = false;
    step.enter?.();
    const el = find(step.target);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [step.id]);

  useEffect(() => {
    const poll = () => {
      setTarget(boxOf(find(step.target)));
      const done = step.waitFor ? step.waitFor.done() : false;
      setReady(done);
      if (done && step.waitFor?.advance && !advanced.current && !last) {
        advanced.current = true;
        const from = props.index;
        advanceTimer.current = window.setTimeout(() => { if (indexRef.current === from) props.onIndex(from + 1); }, 900);
      }
    };
    poll();
    const t = window.setInterval(poll, 250);
    window.addEventListener('resize', poll);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('resize', poll);
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    };
  }, [step.id, props.index]);

  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    setPos(placePopover(target, { w: el.offsetWidth, h: el.offsetHeight }, !!props.compact));
  }, [target?.x, target?.y, target?.w, target?.h, step.id, ready, ran]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if (typing) return;
      if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); }
      if (e.key === 'ArrowRight' && !last) props.onIndex(props.index + 1);
      if (e.key === 'ArrowLeft' && props.index > 0) props.onIndex(props.index - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props.index, last]);

  const runAction = async () => {
    if (!step.action) return;
    setRan(true);
    await step.action.run();
  };
  const showAction = !!step.action && !ran && !(step.waitFor && ready);
  const next = () => (last ? props.onClose() : props.onIndex(props.index + 1));

  return (
    <div className={`tour${props.compact ? ' compact' : ''}`} data-testid={props.testId ?? 'tour'}>
      {target ? (
        <div className="tour-ring" style={{ transform: `translate(${target.x - RING}px, ${target.y - RING}px)`, width: target.w + RING * 2, height: target.h + RING * 2 }} aria-hidden="true" />
      ) : <div className="tour-scrim" aria-hidden="true" />}
      <div className="tour-pop" ref={popRef} role="dialog" aria-label={step.title} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }} data-testid="tour-step" data-step={step.id}>
        <div className="tour-head">
          <span className="t-heading">{step.title}</span>
          <button type="button" className="tour-x" onClick={props.onClose} aria-label="Close the tour" title="Close the tour (Esc)" data-testid="tour-close"><X size={16} /></button>
        </div>
        <div className="tour-body">{step.body}</div>
        {step.waitFor && (ran || !step.action || ready) ? (
          <div className={`tour-wait${ready ? ' ok' : ''}`} data-testid="tour-wait">
            {ready ? <CheckCircle size={16} /> : <Clock size={16} />}
            <span>{ready ? step.waitFor.ready : step.waitFor.waiting}</span>
          </div>
        ) : null}
        <div className="tour-foot">
          <span className="count">{step.chapter}, {props.index + 1} of {props.steps.length}</span>
          {props.index > 0 ? <Button variant="quiet" onClick={() => props.onIndex(props.index - 1)} testId="tour-back">Back</Button> : null}
          {showAction ? <Button variant="quiet" onClick={next} testId="tour-skip">Skip</Button> : null}
          {showAction
            ? <Button variant="primary" icon={<Play size={16} />} onClick={() => void runAction()} testId="tour-action">{step.action?.label}</Button>
            : <Button variant="primary" onClick={next} testId="tour-next">{last ? 'Finish' : 'Next'}</Button>}
        </div>
      </div>
    </div>
  );
}

export function TourWelcome(props: { title: string; body: string; chapters: { icon: ReactNode; title: string; detail: string }[]; brand: ReactNode; onStart: () => void; onSkip: () => void; startLabel?: string }) {
  return (
    <div className="tour-welcome" role="dialog" aria-label={props.title} data-testid="tour-welcome">
      <div className="tour-dialog">
        {props.brand}
        <div className="tour-dialog-text">
          <span className="t-display">{props.title}</span>
          <span className="t-body c-muted">{props.body}</span>
        </div>
        <div className="tour-chapters">
          {props.chapters.map((c) => (
            <div className="tour-chapter" key={c.title}>
              {c.icon}
              <span className="text"><span className="t-strong">{c.title}</span><span className="t-small c-muted">{c.detail}</span></span>
            </div>
          ))}
        </div>
        <div className="tour-dialog-acts">
          <Button variant="secondary" size="l" onClick={props.onSkip} testId="tour-skip-all">Explore on my own</Button>
          <Button variant="primary" size="l" icon={<Play size={16} />} onClick={props.onStart} testId="tour-start">{props.startLabel ?? 'Start the tour'}</Button>
        </div>
      </div>
    </div>
  );
}

export function useTourState(key: string): { index: number | null; setIndex: (i: number | null) => void; seen: boolean; markSeen: () => void } {
  const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v) as T; } catch { return fallback; } };
  const [index, setIndexState] = useState<number | null>(() => read<number | null>(`${key}.step`, null));
  const [seen, setSeen] = useState<boolean>(() => read<boolean>(`${key}.seen`, false));
  const setIndex = (i: number | null) => {
    setIndexState(i);
    try { if (i === null) localStorage.removeItem(`${key}.step`); else localStorage.setItem(`${key}.step`, JSON.stringify(i)); } catch { return; }
  };
  const markSeen = () => {
    setSeen(true);
    try { localStorage.setItem(`${key}.seen`, 'true'); } catch { return; }
  };
  return { index, setIndex, seen, markSeen };
}
