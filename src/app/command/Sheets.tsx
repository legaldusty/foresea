import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Gauge, PencilSimple, SealCheck, X } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot } from '../../shared/protocol';
import { ORDER_CARDS, formatBlank } from '../../shared/orders';
import { Button, Simulated, TextBox, TitleBlock } from '../ui';
import type { NightsProgress, NightsResult } from '../workers/nights.worker';
import { wallTime } from '../format';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

function Sheet(props: { title: string; meta?: ReactNode; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div className="sheet-back" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} data-testid={props.testId}>
        <div className="sheet-head">
          <TitleBlock title={props.title} meta={props.meta} />
          <Button variant="quiet" title="Close" icon={<X size={16} />} onClick={props.onClose} />
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

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
  const maxMin = styles.length ? Math.max(...styles.map((x) => Math.max(x.s.tellWarnMin, x.s.baseWarnMin))) : 1;
  return (
    <Sheet title="Run 1,000 nights" meta={<>Every night a simulated intruder picks a target and a style. TELL races a nearest-dock guess. <Simulated /></>} onClose={props.onClose} testId="nights-sheet">
      {!result ? (
        <div className="t-body c-muted">{progress ? `Running ${progress.phase === 'gates' ? 'gate detections' : 'close-in detections'}: ${Math.round(progress.fraction * 100)}%` : 'Starting the worker'}</div>
      ) : (
        <>
          <div className="big-numbers" data-testid="nights-result">
            <div><span className="t-small">TELL warning, gate detection</span><span className="t-data-xl">{g!.tellWarnMin.toFixed(1)}</span><span className="t-small">minutes</span></div>
            <div><span className="t-small">Nearest-dock guess</span><span className="t-data-xl c-muted">{g!.baseWarnMin.toFixed(1)}</span><span className="t-small">minutes</span></div>
            <div><span className="t-small">More warning</span><span className="t-data-xl">{result.acceptance.warningRatio.toFixed(2)}x</span><span className="t-small">bar is 1.4x</span></div>
            <div><span className="t-small">Right target by arrival</span><span className="t-data-xl">{Math.round(g!.tellCalledRight * 100)}%</span><span className="t-small">{g!.wrongCallsPerNight.toFixed(2)} early wrong calls per night</span></div>
          </div>
          <div className="style-bars">
            <span className="t-heading">By intruder style</span>
            {styles.map(({ k, s }) => (
              <div className="style-bar" key={k}>
                <span className="t-body">{k === 'direct' ? 'Direct' : k === 'sloppy' ? 'Sloppy' : 'Decoy'}</span>
                <span className="bars"><i style={{ width: `${(s.tellWarnMin / maxMin) * 100}%` }} /><i className="base" style={{ width: `${(s.baseWarnMin / maxMin) * 100}%` }} /></span>
                <span className="t-data">{s.tellWarnMin.toFixed(0)} vs {s.baseWarnMin.toFixed(0)} min</span>
              </div>
            ))}
            <span className="t-small c-muted">Top bar TELL, lower bar the nearest-dock guess. Decoys fool it once, then it corrects.</span>
          </div>
          <div className="t-body">Close-in detection, 1 to 3 km from the target: TELL {c!.tellWarnMin.toFixed(1)} min against {c!.baseWarnMin.toFixed(1)} min. That is the honest gap: when it is seen late, the nearest dock is often already right.</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="primary" icon={<Gauge size={16} />} onClick={() => run(Math.floor(Math.random() * 100000))}>Run again with a new seed</Button>
            <span className="t-small c-muted">{(result.nights * 2).toLocaleString()} simulated nights in {(result.ms / 1000).toFixed(1)} s, in this browser. Seed {result.seed}. Drone speed 1 m/s; minutes scale with speed.</span>
          </div>
        </>
      )}
    </Sheet>
  );
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
  return (
    <Sheet title="Standing Orders" meta={signed ? `Signed by ${signed} at ${wallTime(props.snap.orders.signedAtWall)}. At 3 AM only signed orders run.` : 'Signed at 6 PM while it is calm, so at 3 AM there is only one tap to make.'} onClose={props.onClose} testId="orders-sheet">
      <div className="order-list">
        {ORDER_CARDS.map((card) => (
          <div className={`order${card.fixed ? ' fixed' : ''}`} key={card.id}>
            <span className="t-strong">{card.title}</span>
            <div className="sentence">
              {card.parts.map((part, i) => typeof part === 'string'
                ? <span key={i}>{part} </span>
                : (
                  <span key={i}>
                    <select value={values[part.key]} onChange={(e) => setValues({ ...values, [part.key]: Number(e.target.value) })}>
                      {[...new Set([...part.options, values[part.key]])].sort((a, b) => a - b).map((o) => <option key={o} value={o}>{formatBlank(part, o)}</option>)}
                    </select>
                    {part.unit ? `${part.unit} ` : ''}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="order">
        <span className="t-strong">Write an order in your own words</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}><TextBox value={plain} onChange={setPlain} placeholder="If a dredge is working, keep boats 300 m away and slow them to 5 knots" /></div>
          <Button variant="secondary" icon={<PencilSimple size={16} />} onClick={() => void draft()} disabled={!plain.trim()}>Draft card</Button>
        </div>
        {suggestion ? <span className="t-body">{suggestion} <span className="t-small c-muted">Drafted by Granite. It only becomes an order when you sign it.</span></span> : null}
      </div>
      <div className="order" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ width: 240 }}><span className="t-small c-muted">Sign as</span><TextBox value={officer} onChange={setOfficer} /></div>
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
    <Sheet title="Join phones" meta="Join the team hotspot, scan, tap Join. Each phone captains one simulated boat." onClose={props.onClose} testId="join-sheet">
      {!data ? <div className="t-body c-muted">Loading join codes</div> : (
        <div className="join-list">
          {data.phones.map((p) => (
            <div className="join-row" key={p.vesselId}>
              <div className="qr" dangerouslySetInnerHTML={{ __html: p.svg }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="t-heading">{p.name}</span>
                <span className="t-body">{joined.has(p.vesselId) ? 'Joined' : 'Waiting for a phone'}</span>
                <span className="url">{p.url}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
