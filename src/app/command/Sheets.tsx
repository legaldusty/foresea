import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, BookOpenText, CaretDown, CheckCircle, Clock, ListPlus, PencilSimple, Plus, Prohibit, SealCheck, ShieldCheck, Trash, UserCircle, X } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot } from '../../shared/protocol';
import {
  ORDER_ACTIONS, ORDER_CARDS, ORDER_EXAMPLES, ORDER_KINDS, ORDER_LEVEL_NAMES, formatBlank,
  type CustomOrder, type OrderDo, type OrderDraftReply, type OrderHours, type OrderSource, type OrderThen, type OrderWhen, type ShipFlag,
} from '../../shared/orders';
import { buildOrder, dayWindow, nightWindow, parseOrder, restateOrder } from '../../engine/orderParse';
import { defaultSettings } from '../../engine/settings';
import { Button, Simulated, TextBox } from '../ui';
import type { NightsProgress, NightsResult } from '../workers/nights.worker';
import { wallTime } from '../format';
import { NightsProof } from './NightsProof';
import { api } from '../hub/harbor';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

function Sheet(props: { title: ReactNode; meta?: ReactNode; onClose: () => void; children: ReactNode; testId?: string; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="sheet-back" onClick={props.onClose}>
      <div className="sheet" style={props.width ? { width: `min(${props.width}px, calc(100vw - 48px))` } : undefined} onClick={(e) => e.stopPropagation()} data-testid={props.testId}>
        <div className="sheet-head" role="dialog" aria-modal="true">
          <div className="title-block">
            <span className="t-display">{props.title}</span>
            {props.meta ? <span className="t-small c-muted">{props.meta}</span> : null}
          </div>
          <Button variant="quiet" icon={<X size={16} />} onClick={props.onClose}>Close</Button>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

const AXIS_STEP = 20;

export function NightsSheet(props: { onClose: () => void }) {
  const [progress, setProgress] = useState<NightsProgress | null>(null);
  const [result, setResult] = useState<NightsResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const run = (seed: number) => {
    workerRef.current?.terminate();
    const w = new Worker(new URL('../workers/nights.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    setResult(null);
    w.onmessage = (e: MessageEvent<NightsProgress | NightsResult>) => {
      if (e.data.type === 'progress') setProgress(e.data);
      else { setResult(e.data); setProgress(null); }
    };
    w.postMessage({ nights: 1000, seed });
  };
  useEffect(() => { run(7); return () => workerRef.current?.terminate(); }, []);
  const g = result?.gates.all;
  const c = result?.closeIn.all;
  const styles = result ? (['direct', 'sloppy', 'decoy'] as const).map((k) => ({ k, s: result.gates[k] })) : [];
  const top = styles.length ? Math.ceil(Math.max(...styles.map((x) => Math.max(x.s.tellWarnMin, x.s.baseWarnMin))) / AXIS_STEP) * AXIS_STEP : 80;
  const ticks = Array.from({ length: top / AXIS_STEP + 1 }, (_, i) => i * AXIS_STEP);
  const meta = result
    ? <><span className="t-mono-small">{result.nights.toLocaleString()}</span> nights detected at the gates and <span className="t-mono-small">{result.nights.toLocaleString()}</span> close in, in <span className="t-mono-small">{(result.ms / 1000).toFixed(1)}</span> s in this browser. TELL against the nearest-dock guess.</>
    : 'Running in a Web Worker in this browser.';
  return (
    <Sheet title={<span className="sheet-title">Run 1,000 nights <Simulated /></span>} meta={meta} onClose={props.onClose} testId="nights-sheet" width={1200}>
      {!result ? (
        <div className="t-body c-muted">{progress ? `Running ${progress.phase === 'gates' ? 'gate detections' : 'close-in detections'}: ${Math.round(progress.fraction * 100)}%` : 'Starting the worker'}</div>
      ) : (
        <>
          <div className="stat-grid" data-testid="nights-result">
            <div><span className="t-small c-muted">TELL warning</span><span className="stat"><span className="t-data-xl">{g!.tellWarnMin.toFixed(1)}</span><span className="unit">min</span></span></div>
            <div><span className="t-small c-muted">Nearest-dock guess</span><span className="stat"><span className="t-data-xl c-muted">{g!.baseWarnMin.toFixed(1)}</span><span className="unit">min</span></span></div>
            <div><span className="t-small c-muted">Warning gained</span><span className="stat"><span className="t-data-xl">{result.acceptance.warningRatio.toFixed(2)}x</span><span className="unit">bar 1.4x</span></span></div>
          </div>
          <div className="stat-row">
            <div><span className="t-small c-muted">Right target by arrival</span><span className="t-data">{Math.round(g!.tellCalledRight * 100)}%</span></div>
            <div><span className="t-small c-muted">Wrong calls per night</span><span className="t-data">{g!.wrongCallsPerNight.toFixed(2)}</span></div>
            <div><span className="t-small c-muted">Close-in starts</span><span className="t-data">{c!.tellWarnMin.toFixed(1)} vs {c!.baseWarnMin.toFixed(1)} min</span></div>
          </div>
          <div className="chart">
            <div className="chart-head">
              <span className="t-heading">Warning by intruder style, minutes</span>
              <span className="chart-legend"><span><i className="sw tell" />TELL</span><span><i className="sw base" />Nearest-dock guess</span></span>
            </div>
            <div className="chart-body">
              {styles.map(({ k, s }) => (
                <div className="chart-row" key={k}>
                  <span className="t-body">{k === 'direct' ? 'Direct' : k === 'sloppy' ? 'Sloppy' : 'Decoy'}</span>
                  <span className="bars">
                    <span className="bar"><i className="tell" style={{ width: `${(s.tellWarnMin / top) * 100}%` }} /><span className="t-mono-small">{s.tellWarnMin.toFixed(1)}</span></span>
                    <span className="bar"><i className="base" style={{ width: `${(s.baseWarnMin / top) * 100}%` }} /><span className="t-mono-small">{s.baseWarnMin.toFixed(1)}</span></span>
                  </span>
                </div>
              ))}
              <div className="chart-axis">
                <span />
                <span className="ticks">{ticks.map((t) => <span key={t} style={{ left: `${(t / top) * 100}%` }} className="t-mono-small">{t}</span>)}</span>
              </div>
            </div>
            <span className="t-small c-muted">Means: TELL <span className="t-mono-small">{g!.tellWarnMin.toFixed(1)}</span> min, nearest-dock guess <span className="t-mono-small">{g!.baseWarnMin.toFixed(1)}</span> min. Detection at the harbor gates; drone at 1 m/s, so minutes scale with speed. Decoys fool it once, then it corrects.</span>
          </div>
          <NightsProof c={result.calibration} running={progress ? `Measuring ${progress.phase === 'coverage' ? 'forecast coverage' : 'calibration'}: ${Math.round(progress.fraction * 100)}%` : null} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" icon={<ArrowCounterClockwise size={16} />} onClick={() => run(Math.floor(Math.random() * 100000))}>Run again</Button>
            <Button variant="secondary" onClick={props.onClose}>Close</Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function Sentence(props: { text: string }) {
  const parts = props.text.split(/\b(IF|AND|THEN)\b/);
  return <>{parts.map((p, i) => (p === 'IF' || p === 'AND' || p === 'THEN' ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
}

interface TypedDraft { when: OrderWhen; then: OrderThen[]; text: string; source: OrderSource }

const SOURCE_WORDS: Record<OrderSource, string> = {
  parser: 'Read by the order parser on this laptop.',
  granite: 'Read by IBM Granite on this laptop, then checked against the fixed limits.',
  officer: 'Set by you.',
};
const LEVEL_CHOICES = ORDER_LEVEL_NAMES.map((label, value) => ({ value, label }));
const PLACE_CHOICES = [{ value: '', label: 'anywhere' }, ...defaultSettings.harbor.targets.map((t) => ({ value: t.id, label: `near ${t.short}` }))];
const SHIP_CHOICES: { value: ShipFlag; label: string }[] = [{ value: 'watch', label: 'to watch or anomalous' }, { value: 'anomalous', label: 'as anomalous' }];
const VALUE_DOS = new Set<OrderDo>(['radius', 'slowKnots', 'validMinutes']);

function hoursKey(h: OrderHours | null): string { return h ? `${h.from}-${h.to}` : ''; }

function hoursFromKey(key: string): OrderHours | null {
  const [from, to] = key.split('-');
  return from && to ? { from, to } : null;
}

function hoursChoices(current: OrderHours | null): { value: string; label: string }[] {
  const night = nightWindow(defaultSettings);
  const day = dayWindow(defaultSettings);
  const out = [
    { value: '', label: 'at any hour' },
    { value: hoursKey(night), label: `at night, ${night.from} to ${night.to}` },
    { value: hoursKey(day), label: `by day, ${day.from} to ${day.to}` },
  ];
  if (current && !out.some((o) => o.value === hoursKey(current))) out.push({ value: hoursKey(current), label: `between ${current.from} and ${current.to}` });
  return out;
}

function defaultValue(what: OrderDo): number | null {
  const options = ORDER_ACTIONS.find((a) => a.value === what)?.options ?? [];
  return options.length ? options[Math.floor(options.length / 2)] : null;
}

function Choice<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; mono?: boolean }) {
  return (
    <span className="blank">
      <span className="box">
        <select aria-label={props.label} className={props.mono ? undefined : 'words'} value={String(props.value)}
          onChange={(e) => { const found = props.options.find((o) => String(o.value) === e.target.value); if (found) props.onChange(found.value); }}>
          {props.options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
        <CaretDown size={14} className="caret" />
      </span>{' '}
    </span>
  );
}

function TypedOrderCard(props: { draft: TypedDraft; onChange: (d: TypedDraft) => void }) {
  const { when, then } = props.draft;
  const change = (w: Partial<OrderWhen>, t: OrderThen[] = then) => props.onChange({ ...props.draft, when: { ...when, ...w }, then: t, source: 'officer' });
  const levelled = when.kind === 'security' || when.kind === 'any';
  const from = when.levelMin ?? (when.levelMax !== null ? 0 : -1);
  const to = when.levelMax ?? ORDER_LEVEL_NAMES.length - 1;
  const setStep = (i: number, what: OrderDo) => change({}, then.map((s, j) => (j === i ? { do: what, value: VALUE_DOS.has(what) ? defaultValue(what) : null } : s)));
  const setValue = (i: number, value: number) => change({}, then.map((s, j) => (j === i ? { ...s, value } : s)));
  const unused = ORDER_ACTIONS.filter((a) => !then.some((s) => s.do === a.value));
  return (
    <div className="order typed" data-testid="order-typed">
      <span className="order-title"><PencilSimple size={20} />Your order</span>
      <div className="sentence">
        <Sentence text="IF " />
        <Choice label="What it is about" value={when.kind} options={ORDER_KINDS}
          onChange={(kind) => change({ kind, levelMin: kind === 'security' || kind === 'any' ? when.levelMin : null, levelMax: kind === 'security' || kind === 'any' ? when.levelMax : null, shipFlag: kind === 'flaggedShip' ? when.shipFlag ?? 'watch' : null })} />
        {when.kind === 'flaggedShip' ? <Choice label="Flag" value={when.shipFlag ?? 'watch'} options={SHIP_CHOICES} onChange={(shipFlag) => change({ shipFlag })} /> : null}
        {levelled ? (
          <>
            <span>rated </span>
            <Choice label="Lowest level" value={from} options={[{ value: -1, label: 'any level' }, ...LEVEL_CHOICES]} onChange={(v) => change(v < 0 ? { levelMin: null, levelMax: null } : { levelMin: v, levelMax: Math.max(v, to) })} />
            {from >= 0 ? <><span>to </span><Choice label="Highest level" value={to} options={LEVEL_CHOICES.filter((l) => l.value >= from)} onChange={(v) => change({ levelMin: from, levelMax: v })} /></> : null}
          </>
        ) : null}
        <Choice label="Place" value={when.place ?? ''} options={PLACE_CHOICES} onChange={(p) => change({ place: p || null })} />
        <Choice label="Hours" value={hoursKey(when.hours)} options={hoursChoices(when.hours)} onChange={(k) => change({ hours: hoursFromKey(k) })} />
        {then.map((step, i) => {
          const action = ORDER_ACTIONS.find((a) => a.value === step.do)!;
          return (
            <span key={`${step.do}-${i}`}>
              <Sentence text={i === 0 ? 'THEN ' : 'AND '} />
              <Choice label="Action" value={step.do} options={[action, ...unused]} onChange={(what) => setStep(i, what)} />
              {VALUE_DOS.has(step.do) && step.value !== null ? (
                <>
                  <Choice label="Value" mono value={step.value} options={[...new Set([...action.options, step.value])].sort((a, b) => a - b).map((v) => ({ value: v, label: String(v) }))} onChange={(v) => setValue(i, v)} />
                  <span>{action.unit} </span>
                </>
              ) : null}
              {then.length > 1 ? <Button variant="quiet" icon={<X size={16} />} title="Remove this action" onClick={() => change({}, then.filter((_, j) => j !== i))} /> : null}
            </span>
          );
        })}
        {unused.length ? <Button variant="quiet" icon={<Plus size={16} />} onClick={() => change({}, [...then, { do: unused[0].value, value: VALUE_DOS.has(unused[0].value) ? defaultValue(unused[0].value) : null }])}>Add action</Button> : null}
      </div>
    </div>
  );
}

export function OrdersSheet(props: { snap: CommandSnapshot; send: Send; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, number>>({ ...props.snap.orders.orders });
  const [officer, setOfficer] = useState(props.snap.officer);
  const [plain, setPlain] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<OrderDraftReply | null>(null);
  const [typed, setTyped] = useState<TypedDraft | null>(null);
  const [custom, setCustom] = useState<CustomOrder[]>(props.snap.orders.custom ?? []);
  const signed = props.snap.orders.signedBy;
  const signedIds = new Set((props.snap.orders.custom ?? []).map((o) => o.id));
  const vetoSeconds = values.vetoSeconds ?? defaultSettings.orders.vetoSeconds;
  const live = typed ? buildOrder(typed.when, typed.then, typed.text, typed.source, defaultSettings, vetoSeconds) : null;
  const show = (r: OrderDraftReply) => {
    setReply(r);
    setTyped(r.order ? { when: r.order.when, then: r.order.then, text: r.order.text, source: r.order.source } : null);
  };
  const readIt = async () => {
    if (!plain.trim()) return;
    setBusy(true);
    setReply(null);
    setTyped(null);
    try {
      const r = await fetch(api('/api/orders/draft'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: plain }) });
      if (!r.ok) throw new Error(String(r.status));
      show((await r.json()) as OrderDraftReply);
    } catch {
      const local = parseOrder(plain, defaultSettings, values);
      show({ ...local, source: local.order ? 'parser' : 'none', examples: local.order || local.refused ? [] : ORDER_EXAMPLES });
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    if (!live?.order) return;
    setCustom([...custom, { ...live.order, id: `typed-${Date.now().toString(36)}` }]);
    setTyped(null);
    setReply(null);
    setPlain('');
  };
  const sign = () => {
    void props.send('officer', { name: officer });
    void props.send('signOrders', { officer, orders: values, custom });
    props.onClose();
  };
  const meta = signed
    ? `Signed by ${signed} at ${wallTime(props.snap.orders.signedAtWall)}. The machine acts only inside these orders.`
    : 'Fill in the blanks, then sign. The machine acts only inside these orders.';
  return (
    <Sheet title="Standing Orders" meta={meta} onClose={props.onClose} testId="orders-sheet" width={1040}>
      <div className="orders">
        {ORDER_CARDS.map((card) => (
          <div className={`order${card.fixed ? ' fixed' : ''}`} key={card.id}>
            <span className="order-title">{card.fixed ? <ShieldCheck size={20} /> : null}{card.fixed ? `${card.title} (fixed)` : card.title}</span>
            <div className="sentence">
              {card.parts.map((part, i) => typeof part === 'string'
                ? <Sentence key={i} text={`${part} `} />
                : (
                  <span key={i} className="blank">
                    <span className="box">
                      <select value={values[part.key]} onChange={(e) => setValues({ ...values, [part.key]: Number(e.target.value) })}>
                        {[...new Set([...part.options, values[part.key]])].sort((a, b) => a - b).map((o) => <option key={o} value={o}>{formatBlank(part, o)}</option>)}
                      </select>
                      <CaretDown size={14} className="caret" />
                    </span>
                    {part.unit ? <Sentence text={` ${part.unit} `} /> : ' '}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
      {custom.length ? (
        <div className="orders-custom">
          <span className="t-heading">Orders in your words</span>
          {custom.map((o) => {
            const isSigned = signedIds.has(o.id);
            return (
              <div className="order custom" key={o.id} data-testid={`custom-order-${o.id}`}>
                <span className="order-title-block">
                  <span className="order-title">{isSigned ? <SealCheck size={20} /> : <PencilSimple size={20} />}In your words</span>
                  <span className="t-small c-muted">{isSigned && signed ? `Signed by ${signed}` : 'Not signed yet'}</span>
                </span>
                <span className="custom-sentence">
                  <span className="t-body">{restateOrder(o.when, o.then, defaultSettings, vetoSeconds)}</span>
                  {o.text ? <span className="t-small c-muted">You wrote: {o.text}</span> : null}
                </span>
                <Button variant="quiet" icon={<Trash size={16} />} onClick={() => setCustom(custom.filter((x) => x.id !== o.id))}>Remove</Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="order-free">
        <span className="t-small c-muted">Write an order in your own words</span>
        <div className="order-type-row">
          <span className="box">
            <input data-testid="order-text" value={plain} placeholder="For example: at night, publish divers zones automatically" onChange={(e) => setPlain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void readIt(); }} />
          </span>
          <Button variant="secondary" icon={<BookOpenText size={16} />} testId="order-read" onClick={() => void readIt()} disabled={!plain.trim() || busy}>Read it</Button>
        </div>
        {busy ? <span className="t-body c-muted">Reading</span> : null}
        {typed && live ? (
          <div className="order-read-out">
            <TypedOrderCard draft={typed} onChange={setTyped} />
            <span className="t-body">{live.understood}</span>
            <span className="t-small c-muted">{SOURCE_WORDS[typed.source]} It becomes an order only when you add it and sign.</span>
            {live.refused ? <span className="icon-text t-body"><Prohibit size={16} />{live.refused}</span> : null}
            {live.missing.map((m) => <span key={m} className="t-small c-muted">Still needed: {m}.</span>)}
            <span><Button variant="secondary" icon={<ListPlus size={16} />} testId="order-add" onClick={add} disabled={!live.order}>Add to orders</Button></span>
          </div>
        ) : reply && !reply.order ? (
          <div className="order-read-out">
            {reply.refused ? <span className="icon-text t-body"><Prohibit size={16} />{reply.refused}</span> : null}
            {reply.understood ? <span className="t-body">{reply.understood}</span> : null}
            {reply.missing.map((m) => <span key={m} className="t-small c-muted">Not understood: {m}.</span>)}
            {reply.examples.length ? <span className="t-small c-muted">Try: {reply.examples.map((e) => `"${e}"`).join(' or ')}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="order-sign">
        <span className="icon-text"><UserCircle size={20} /><span className="t-strong">Sign as</span></span>
        <div style={{ width: 240 }}><TextBox value={officer} onChange={setOfficer} /></div>
        <span style={{ flex: 1 }} />
        <Button variant="primary" icon={<SealCheck size={16} />} testId="sign-orders" onClick={sign}>Sign</Button>
      </div>
    </Sheet>
  );
}

interface JoinPhone { vesselId: string; name: string; type: string; url: string; svg: string; joined: boolean }

export function JoinSheet(props: { snap: CommandSnapshot; onClose: () => void }) {
  const [data, setData] = useState<{ urls: string[]; phones: JoinPhone[]; drive?: { url: string; svg: string } } | null>(null);
  useEffect(() => { void fetch(api('/api/join')).then((r) => r.json()).then(setData).catch(() => setData(null)); }, []);
  const joined = new Set(props.snap.captains.filter((c) => c.connected).map((c) => c.vesselId));
  return (
    <Sheet title="Join phones" meta={<>Join the team hotspot, scan, tap Join. Or open <span className="t-mono-small">{data?.urls[0] ?? ''}</span>. Public board for a marina screen: <a className="t-mono-small" href={api('/board')} target="_blank" rel="noreferrer" data-testid="board-link">{(data?.urls[0] ?? '').replace(/\/captain.*$/, '')}{api('/board')}</a></>} onClose={props.onClose} testId="join-sheet" width={640}>
      {!data ? <div className="t-body c-muted">Loading join codes</div> : (
        <div className="join-list">
          {data.drive ? (
            <div className="join-row" data-testid="join-drive">
              <div className="qr" dangerouslySetInnerHTML={{ __html: data.drive.svg }} />
              <div className="title-block">
                <span className="t-title">Let a judge drive</span>
                <span className="t-body c-muted">{props.snap.mode === 'live' ? 'Switch to Simulation first. The drive page does nothing in Live mode.' : 'A judge steers the unknown drone from a phone. The chart calls the target before it arrives.'}</span>
                <span className="t-mono-small c-muted">{data.drive.url}</span>
              </div>
            </div>
          ) : null}
          {data.phones.map((p) => (
            <div className="join-row" key={p.vesselId}>
              <div className="qr" dangerouslySetInnerHTML={{ __html: p.svg }} />
              <div className="title-block">
                <span className="t-title">{p.name}</span>
                {joined.has(p.vesselId)
                  ? <span className="icon-text t-body"><CheckCircle size={16} />Joined</span>
                  : <span className="icon-text t-body c-muted"><Clock size={16} />Waiting</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
