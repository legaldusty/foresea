import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, CaretDown, CheckCircle, Clock, FileText, SealCheck, ShieldCheck, UserCircle, X } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot } from '../../shared/protocol';
import { ORDER_CARDS, formatBlank } from '../../shared/orders';
import { Button, Simulated, TextBox } from '../ui';
import type { NightsProgress, NightsResult } from '../workers/nights.worker';
import { wallTime } from '../format';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

function Sheet(props: { title: ReactNode; meta?: ReactNode; onClose: () => void; children: ReactNode; testId?: string; width?: number }) {
  return (
    <div className="sheet-back" onClick={props.onClose}>
      <div className="sheet" style={props.width ? { width: `min(${props.width}px, calc(100vw - 48px))` } : undefined} onClick={(e) => e.stopPropagation()} data-testid={props.testId}>
        <div className="sheet-head">
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
    <Sheet title={<span className="sheet-title">Run 1,000 nights <Simulated /></span>} meta={meta} onClose={props.onClose} testId="nights-sheet" width={848}>
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

export function OrdersSheet(props: { snap: CommandSnapshot; send: Send; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, number>>({ ...props.snap.orders.orders });
  const [officer, setOfficer] = useState(props.snap.officer);
  const [plain, setPlain] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const signed = props.snap.orders.signedBy;
  const draft = async () => {
    setSuggestion('Drafting');
    try {
      const r = await fetch('/api/orders/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: plain }) });
      const j = await r.json();
      setSuggestion(j.rule ?? 'The model is not available. Write the card by hand.');
    } catch { setSuggestion('The model is not available. Write the card by hand.'); }
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
      <div className="order-free">
        <span className="t-small c-muted">Write an order in your own words</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><TextBox value={plain} onChange={setPlain} placeholder="Type one order in plain English" /></div>
          <Button variant="secondary" icon={<FileText size={16} />} onClick={() => void draft()} disabled={!plain.trim()}>Draft card</Button>
        </div>
        {suggestion ? <span className="t-body">{suggestion} <span className="t-small c-muted">Drafted by Granite. It becomes an order only when you sign.</span></span> : null}
      </div>
      <div className="order-sign">
        <span className="icon-text"><UserCircle size={20} /><span className="t-strong">Sign as</span></span>
        <div style={{ width: 240 }}><TextBox value={officer} onChange={setOfficer} /></div>
        <span style={{ flex: 1 }} />
        <Button variant="primary" icon={<SealCheck size={16} />} testId="sign-orders" onClick={() => { void props.send('officer', { name: officer }); void props.send('signOrders', { officer, orders: values }); props.onClose(); }}>Sign</Button>
      </div>
    </Sheet>
  );
}

interface JoinPhone { vesselId: string; name: string; type: string; url: string; svg: string; joined: boolean }

export function JoinSheet(props: { snap: CommandSnapshot; onClose: () => void }) {
  const [data, setData] = useState<{ urls: string[]; phones: JoinPhone[] } | null>(null);
  useEffect(() => { void fetch('/api/join').then((r) => r.json()).then(setData).catch(() => setData(null)); }, []);
  const joined = new Set(props.snap.captains.filter((c) => c.connected).map((c) => c.vesselId));
  return (
    <Sheet title="Join phones" meta={<>Join the team hotspot, scan, tap Join. Or open <span className="t-mono-small">{data?.urls[0] ?? ''}</span></>} onClose={props.onClose} testId="join-sheet" width={640}>
      {!data ? <div className="t-body c-muted">Loading join codes</div> : (
        <div className="join-list">
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
