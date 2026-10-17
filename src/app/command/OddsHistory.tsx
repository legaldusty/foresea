import { useEffect, useRef, useState } from 'react';
import type { ContactView } from '../../shared/protocol';
import { clockOf } from '../format';

const H = 112;
const PAD = { top: 8, right: 132, bottom: 18, left: 28 };

interface Series { id: string; name: string; idx: number; style: 'top' | 'second' | 'lost' }

export function OddsHistory(props: { c: ContactView }) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(352);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const c = props.c;
  const hist = c.history;
  if (hist.length < 2) return null;
  const targets = c.odds.filter((o) => o.kind === 'target').slice(0, 2);
  const series: Series[] = ([
    ...targets.map((t, i): Series => ({ id: t.id, name: t.name, idx: c.historyIds.indexOf(t.id), style: i === 0 ? 'top' : 'second' })),
    { id: 'lost', name: 'Lost or drifting', idx: c.historyIds.indexOf('lost'), style: 'lost' as const },
  ] as Series[]).filter((s) => s.idx >= 0);
  const t0 = hist[0].t, t1 = hist[hist.length - 1].t;
  const span = Math.max(0.01, t1 - t0);
  const innerW = Math.max(40, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / span) * innerW;
  const y = (p: number) => PAD.top + (1 - p) * innerH;
  const path = (idx: number) => hist.map((h, i) => `${i ? 'L' : 'M'}${x(h.t).toFixed(1)},${y(h.p[idx]).toFixed(1)}`).join('');
  const lastP = (idx: number) => hist[hist.length - 1].p[idx];
  const labelYs = series.map((s) => y(lastP(s.idx)));
  for (let k = 1; k < labelYs.length; k++) {
    const order = labelYs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    for (let j = 1; j < order.length; j++) if (order[j][0] - order[j - 1][0] < 14) labelYs[order[j][1]] = order[j - 1][0] + 14;
  }
  const callX = c.call && c.call.sinceMin >= t0 ? x(c.call.sinceMin) : null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - PAD.left) / innerW) * span;
    let best = 0, bd = Infinity;
    hist.forEach((h, i) => { const d = Math.abs(h.t - t); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const hv = hover !== null ? hist[hover] : null;
  return (
    <div className="odds-history" ref={holder}>
      <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="TELL odds over time">
        <line className="grid" x1={PAD.left} x2={PAD.left + innerW} y1={y(0)} y2={y(0)} />
        <line className="grid" x1={PAD.left} x2={PAD.left + innerW} y1={y(0.5)} y2={y(0.5)} />
        <line className="grid" x1={PAD.left} x2={PAD.left + innerW} y1={y(1)} y2={y(1)} />
        <text className="axis" x={PAD.left - 6} y={y(1) + 4} textAnchor="end">100</text>
        <text className="axis" x={PAD.left - 6} y={y(0.5) + 4} textAnchor="end">50</text>
        <text className="axis" x={PAD.left - 6} y={y(0) + 4} textAnchor="end">0</text>
        <text className="axis" x={PAD.left} y={H - 4}>{clockOf(t0)}</text>
        <text className="axis" x={PAD.left + innerW} y={H - 4} textAnchor="end">{clockOf(t1)}</text>
        {callX !== null ? (<><line className="call" x1={callX} x2={callX} y1={PAD.top} y2={y(0)} /><text className="axis" x={callX + 4} y={PAD.top + 10}>Called</text></>) : null}
        {series.map((s) => <path key={s.id} className={`ln ${s.style}`} d={path(s.idx)} />)}
        {series.map((s, i) => (
          <g key={`l${s.id}`}>
            <circle className={`end ${s.style}`} cx={x(t1)} cy={y(lastP(s.idx))} r={4} />
            <text className={`lbl ${s.style}`} x={x(t1) + 10} y={labelYs[i] + 4}>{s.style === 'lost' ? 'Lost' : s.name} {Math.round(lastP(s.idx) * 100)}%</text>
          </g>
        ))}
        {hv ? <line className="cross" x1={x(hv.t)} x2={x(hv.t)} y1={PAD.top} y2={y(0)} /> : null}
      </svg>
      {hv ? (
        <div className="odds-tip" style={{ left: Math.min(width - 168, Math.max(0, x(hv.t) + 8)) }}>
          <span className="t-mono-small">{clockOf(hv.t)}</span>
          {series.map((s) => <span key={s.id} className="row"><span>{s.name}</span><span className="t-mono-small">{Math.round(hv.p[s.idx] * 100)}%</span></span>)}
        </div>
      ) : null}
      <div className="odds-legend"><span><i className="sw top" />Top target</span><span><i className="sw second" />Second</span><span><i className="sw lost" />Lost or drifting</span></div>
    </div>
  );
}
