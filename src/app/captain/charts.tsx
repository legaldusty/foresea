import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

export interface ChartPoint { t: number; v: number }

export interface ChartSeries { key: string; points: ChartPoint[]; tone: 'ink' | 'muted'; dashed?: boolean; area?: boolean }

export interface ChartMark { t: number; v: number; label: string; place: 'above' | 'below' }

export interface ChartProps {
  series: ChartSeries[];
  from: number;
  to: number;
  min: number;
  max: number;
  height: number;
  grid: { v: number; label: string }[];
  ticks: { t: number; label: string }[];
  now?: number;
  marks?: ChartMark[];
  legend: ReactNode;
  readout: (t: number) => ReactNode;
  label: string;
  testId?: string;
}

const WIDTH = 1000;
const PAD = 6;

export function valueAt(points: ChartPoint[], t: number): number | null {
  if (!points.length || t < points[0].t || t > points[points.length - 1].t) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1].v;
}

function edgeClass(pct: number): string {
  return pct < 10 ? ' start' : pct > 90 ? ' end' : '';
}

export function TimeChart(props: ChartProps) {
  const [scrub, setScrub] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const span = props.to - props.from;
  const range = props.max - props.min || 1;
  const h = props.height;
  const x = (t: number) => ((t - props.from) / span) * WIDTH;
  const pct = (t: number) => ((t - props.from) / span) * 100;
  const y = (v: number) => PAD + (1 - (v - props.min) / range) * (h - PAD * 2);
  const line = (pts: ChartPoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = (pts: ChartPoint[]) => `${line(pts)} L${x(pts[pts.length - 1].t).toFixed(1)} ${h} L${x(pts[0].t).toFixed(1)} ${h} Z`;

  const pick = (clientX: number) => {
    const r = plot.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setScrub(props.from + f * span);
  };
  const onPointerDown = (e: PointerEvent) => { pick(e.clientX); };
  const onPointerMove = (e: PointerEvent) => { if (e.pointerType === 'mouse' || e.buttons) pick(e.clientX); };
  const onKey = (e: KeyboardEvent) => {
    const step = span / 24;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const base = scrub ?? props.now ?? props.to;
      setScrub(Math.max(props.from, Math.min(props.to, base + (e.key === 'ArrowLeft' ? -step : step))));
    }
    if (e.key === 'Escape') setScrub(null);
  };

  const series = props.series.map((s) => ({ ...s, points: s.points.filter((p) => p.t >= props.from && p.t <= props.to) }));
  const lastPoints = series.filter((s) => s.tone === 'ink' && s.points.length).map((s) => ({ key: s.key, p: s.points[s.points.length - 1] }));

  return (
    <div className="cap-chart" data-testid={props.testId}>
      <div className="cap-chart-top" aria-live="polite">{scrub === null ? props.legend : <span className="cap-chart-readout">{props.readout(scrub)}</span>}</div>
      <div className="cap-chart-body" style={{ height: h }}>
      <div
        className="cap-chart-plot"
        ref={plot}
        style={{ height: h }}
        role="img"
        aria-label={props.label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setScrub(null)}
        onPointerCancel={() => setScrub(null)}
        onKeyDown={onKey}
        onBlur={() => setScrub(null)}
      >
        <svg viewBox={`0 0 ${WIDTH} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true">
          {series.filter((s) => s.area && s.points.length > 1).map((s) => <path key={`${s.key}-area`} className="area" d={area(s.points)} />)}
          {props.grid.map((g) => <line key={g.v} className="grid" x1={0} x2={WIDTH} y1={y(g.v)} y2={y(g.v)} vectorEffect="non-scaling-stroke" />)}
          <line className="grid" x1={0} x2={WIDTH} y1={h - 0.5} y2={h - 0.5} vectorEffect="non-scaling-stroke" />
          {props.now !== undefined ? <line className="now" x1={x(props.now)} x2={x(props.now)} y1={0} y2={h} vectorEffect="non-scaling-stroke" /> : null}
          {series.filter((s) => s.points.length > 1).map((s) => (
            <path key={s.key} className={`line ${s.tone}${s.dashed ? ' dashed' : ''}`} d={line(s.points)} vectorEffect="non-scaling-stroke" />
          ))}
          {scrub !== null ? <line className="scrub" x1={x(scrub)} x2={x(scrub)} y1={0} y2={h} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {props.now !== undefined ? <span className={`cap-chart-now${edgeClass(pct(props.now))}`} style={{ left: `${pct(props.now)}%` }}>Now</span> : null}
        {(props.marks ?? []).map((m) => <i key={`dot-${m.t}`} className="dot muted" style={{ left: `${pct(m.t)}%`, top: y(m.v) - 4 }} />)}
        {(props.marks ?? []).map((m) => (
          <span key={`label-${m.t}`} className={`cap-chart-mark${edgeClass(pct(m.t))}`} style={{ left: `${pct(m.t)}%`, top: m.place === 'above' ? y(m.v) - 26 : y(m.v) + 8 }}>{m.label}</span>
        ))}
        {scrub === null ? lastPoints.map((l) => <i key={l.key} className="dot ink" style={{ left: `${pct(l.p.t)}%`, top: y(l.p.v) - 4 }} />) : series.map((s) => {
          const v = valueAt(s.points, scrub);
          return v === null ? null : <i key={s.key} className={`dot ${s.tone}`} style={{ left: `${pct(scrub)}%`, top: y(v) - 4 }} />;
        })}
      </div>
      <div className="cap-chart-axis" aria-hidden="true">
        {props.grid.map((g) => <span key={g.v} style={{ top: y(g.v) - 9 }}>{g.label}</span>)}
      </div>
      </div>
      <div className="cap-chart-ticks" aria-hidden="true">
        {props.ticks.map((tk) => <span key={tk.t} className={edgeClass(pct(tk.t)).trim()} style={{ left: `${pct(tk.t)}%` }}>{tk.label}</span>)}
      </div>
    </div>
  );
}

export function Legend(props: { items: { label: string; tone: 'ink' | 'muted'; dashed?: boolean; area?: boolean }[] }) {
  return (
    <span className="cap-chart-legend">
      {props.items.map((i) => <span key={i.label} className="key"><i className={`swatch ${i.tone}${i.dashed ? ' dashed' : ''}${i.area ? ' area' : ''}`} />{i.label}</span>)}
    </span>
  );
}
