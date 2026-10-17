import type { CalibrationResult, CalibrationReport } from '../../engine/calibration';

type Bin = CalibrationReport['bins'][number];

function mergeBins(a: Bin[], b: Bin[]): Bin[] {
  return a.map((x, i) => {
    const y = b[i];
    const count = x.count + y.count;
    if (!count) return { ...x, count: 0, meanPredicted: null, hitRate: null };
    const mp = ((x.meanPredicted ?? 0) * x.count + (y.meanPredicted ?? 0) * y.count) / count;
    const hr = ((x.hitRate ?? 0) * x.count + (y.hitRate ?? 0) * y.count) / count;
    return { ...x, count, meanPredicted: mp, hitRate: hr };
  });
}

const W = 340;
const H = 240;
const PAD = { left: 40, right: 12, top: 10, bottom: 34 };

function Reliability(props: { honest: Bin[]; decoy: Bin[] }) {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (p: number) => PAD.left + p * iw;
  const y = (p: number) => PAD.top + (1 - p) * ih;
  const pts = (bins: Bin[]) => bins.filter((b) => b.count >= 20 && b.meanPredicted !== null && b.hitRate !== null);
  const line = (bins: Bin[]) => pts(bins).map((b, i) => `${i ? 'L' : 'M'}${x(b.meanPredicted as number).toFixed(1)},${y(b.hitRate as number).toFixed(1)}`).join('');
  return (
    <svg width={W} height={H} role="img" aria-label="Reliability of TELL's top target" className="reliability">
      {[0, 0.5, 1].map((t) => <line key={`g${t}`} className="grid" x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} />)}
      <line className="diag" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
      <path className="ln honest" d={line(props.honest)} />
      <path className="ln decoy" d={line(props.decoy)} />
      {pts(props.honest).map((b, i) => <circle key={`h${i}`} className="pt honest" cx={x(b.meanPredicted as number)} cy={y(b.hitRate as number)} r={4} />)}
      {pts(props.decoy).map((b, i) => <circle key={`d${i}`} className="pt decoy" cx={x(b.meanPredicted as number)} cy={y(b.hitRate as number)} r={4} />)}
      {[0, 50, 100].map((t) => <text key={`y${t}`} className="axis" x={PAD.left - 6} y={y(t / 100) + 4} textAnchor="end">{t}%</text>)}
      {[0, 50, 100].map((t) => <text key={`x${t}`} className="axis" x={x(t / 100)} y={H - 18} textAnchor="middle">{t}%</text>)}
      <text className="axis" x={x(0.5)} y={H - 2} textAnchor="middle">How sure TELL was</text>
      <text className="axis" x={x(0.02)} y={y(0.98)}>How often it was right</text>
    </svg>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function NightsProof(props: { c: CalibrationResult | null; running: string | null }) {
  if (!props.c) return <div className="proof-wait t-body c-muted" data-testid="calibration-wait">{props.running ?? 'Measuring calibration and forecast coverage'}</div>;
  const { calibration: cal, coverage: cov, pitch } = props.c;
  const honest = mergeBins(cal.direct.bins, cal.sloppy.bins);
  const honestEce = (cal.direct.ece * cal.direct.steps + cal.sloppy.ece * cal.sloppy.steps) / Math.max(1, cal.direct.steps + cal.sloppy.steps);
  const styles = [
    { k: 'Direct', g: cov.direct },
    { k: 'Sloppy', g: cov.sloppy },
    { k: 'Decoy', g: cov.decoy },
  ];
  return (
    <div className="proof" data-testid="calibration-result">
      <p className="proof-pitch">{`In ${pitch.nights} simulated nights the drone's real next ${pitch.lookaheadMinutes} minutes stayed inside the yellow ${pct(pitch.insideCareful)} of the time.`}</p>
      <div className="proof-grid">
        <div className="proof-block">
          <span className="t-heading">Is TELL as sure as it should be?</span>
          <Reliability honest={honest} decoy={cal.decoy.bins} />
          <div className="proof-legend">
            <span><i className="sw honest" />Direct and sloppy intruders, off by <span className="mono">{pct(honestEce)}</span> on average</span>
            <span><i className="sw decoy" />Decoys, off by <span className="mono">{pct(cal.decoy.ece)}</span>: they fool it at first</span>
            <span className="c-muted">On the diagonal means right as often as it said. <span className="mono">{cal.all.steps.toLocaleString()}</span> TELL steps over <span className="mono">{cal.all.nights.toLocaleString()}</span> nights.</span>
          </div>
        </div>
        <div className="proof-block">
          <span className="t-heading">Does the forecast hold the real path?</span>
          <div className="cov">
            <div className="cov-row head"><span /><span>Inside red</span><span>Inside yellow</span><span className="num">Time right</span></div>
            {styles.map(({ k, g }) => (
              <div className="cov-row" key={k}>
                <span className="t-body">{k}</span>
                <span className="cov-bar"><i className="likely" style={{ width: pct(g.insideLikely) }} /><span className="mono">{pct(g.insideLikely)}</span></span>
                <span className="cov-bar"><i className="careful" style={{ width: pct(g.insideCareful) }} /><span className="mono">{pct(g.insideCareful)}</span></span>
                <span className="num mono">{pct(g.timeWindowRight)}</span>
              </div>
            ))}
          </div>
          <span className="t-small c-muted">Share of the true next 30 minutes inside each layer, and of crossings within plus or minus 3 minutes of the forecast window. <span className="mono">{cov.direct.nights + cov.sloppy.nights + cov.decoy.nights}</span> nights.</span>
        </div>
      </div>
    </div>
  );
}
