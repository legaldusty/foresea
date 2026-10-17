import type { ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from '@phosphor-icons/react';
import type { CaptainBulletin, CaptainConditions, SeriesPoint, TideTrend, TideTurnView } from '../../shared/protocol';
import { ageText, compass16, fahrenheit, feet, knotsWhole } from '../conditionsFormat';
import { Header } from './parts';
import { BulletinStrip } from './conditions';
import { Legend, TimeChart, valueAt, type ChartPoint } from './charts';

const HOUR = 3_600_000;
const KNOT_MPS = 0.514444;
const FEET_PER_METER = 3.28084;
const TIDE_GAP_FEET = 0.5;

const clocks = new Map<string, Intl.DateTimeFormat>();
const hours = new Map<string, Intl.DateTimeFormat>();

function clock(t: number, timeZone: string): string {
  let f = clocks.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); clocks.set(timeZone, f); }
  return f.format(t);
}

function localHour(t: number, timeZone: string): number {
  let f = hours.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }); hours.set(timeZone, f); }
  return Number(f.format(t)) % 24;
}

function hourTicks(from: number, to: number, everyHours: number, timeZone: string, nowAtEnd: boolean): { t: number; label: string }[] {
  const ticks: { t: number; label: string }[] = [];
  const room = (to - from) * 0.15;
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) {
    if (localHour(t, timeZone) % everyHours !== 0) continue;
    if (nowAtEnd && to - t < room) continue;
    ticks.push({ t, label: clock(t, timeZone) });
  }
  if (nowAtEnd) ticks.push({ t: to, label: 'Now' });
  return ticks;
}

function ceilTo(v: number, step: number): number {
  return Math.ceil(v / step) * step;
}

const WEEKDAYS: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

export function dayLabel(label: string): string {
  const m = /^([A-Z][a-z]{2}) (\d{2}:\d{2})$/.exec(label);
  return m && WEEKDAYS[m[1]] ? `Tomorrow ${m[2]}` : label;
}

export function periodName(name: string): string {
  const m = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)( Night)?$/.exec(name);
  return m ? `${WEEKDAYS[m[1]]}${m[2] ? ' night' : ''}` : name;
}

export function plainSource(source: string): string {
  const buoy = /^NDBC \S+ (.+)$/.exec(source);
  if (buoy) return `${buoy[1]} buoy`;
  const station = /^CO-OPS \S+ (.+?)(?: wind| air temperature| pressure| tide)?(?:, .*)?$/.exec(source);
  return station ? station[1] : source;
}

function points(series: SeriesPoint[], scale: number): ChartPoint[] {
  return series.map((p) => ({ t: Date.parse(p.at), v: p.value * scale }));
}

function Section(props: { title: string; source?: string | null; testId: string; children: ReactNode }) {
  return (
    <section className="cap-cond-sec" data-testid={props.testId}>
      <div className="head">
        <h2 className="t-heading">{props.title}</h2>
        {props.source ? <span className="src">{props.source}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

function Direction(props: { toDeg: number | null; children: ReactNode }) {
  return (
    <span className="dir">
      {props.toDeg !== null ? <ArrowUp size={20} style={{ transform: `rotate(${Math.round(props.toDeg)}deg)` }} aria-hidden="true" /> : null}
      <span>{props.children}</span>
    </span>
  );
}

function Readout(props: { value: string; unit: string; children: ReactNode }) {
  return (
    <div className="cap-cond-readout">
      <span className="big"><span className="n">{props.value}</span><span className="u">{props.unit}</span></span>
      <span className="side">{props.children}</span>
    </div>
  );
}

function NoReading(props: { what: string }) {
  return <p className="cap-cond-none">No {props.what} reading right now. It comes back on its own when the feed answers.</p>;
}

function Wind(props: { c: CaptainConditions; now: number }) {
  const w = props.c.wind;
  if (!w) return <Section title="Wind" testId="cond-wind"><NoReading what="wind" /></Section>;
  const tz = props.c.timeZone;
  const speed = w.history.map((p) => ({ t: Date.parse(p.at), v: p.speedMps / KNOT_MPS }));
  const gust = w.history.filter((p) => p.gustMps !== null).map((p) => ({ t: Date.parse(p.at), v: (p.gustMps as number) / KNOT_MPS }));
  const from = speed.length ? speed[0].t : props.now - HOUR;
  const max = ceilTo(Math.max(10, ...speed.map((p) => p.v), ...gust.map((p) => p.v)), 10);
  return (
    <Section title="Wind" source={`${plainSource(w.source)}, ${ageText(w.ageMin)}`} testId="cond-wind">
      <Readout value={knotsWhole(w.speedMps)} unit="kn">
        <Direction toDeg={w.fromDeg === null ? null : w.fromDeg + 180}>{w.fromDeg === null ? 'Direction not reported' : `From ${compass16(w.fromDeg)}`}</Direction>
        <span className="t-body c-muted">{w.gustMps !== null ? <>Gusts <span className="num">{knotsWhole(w.gustMps)}</span> kn</> : 'No gust reported'}</span>
      </Readout>
      {speed.length > 1 ? (
        <TimeChart
          testId="chart-wind"
          label={`Wind over the last ${Math.round((props.now - from) / HOUR)} hours, ${Math.round(Math.min(...speed.map((p) => p.v)))} to ${Math.round(Math.max(...speed.map((p) => p.v)))} knots`}
          series={[{ key: 'gust', points: gust, tone: 'muted', dashed: true }, { key: 'wind', points: speed, tone: 'ink' }]}
          from={from} to={props.now} min={0} max={max} height={96}
          grid={[{ v: max / 2, label: `${max / 2} kn` }, { v: max, label: `${max} kn` }]}
          ticks={hourTicks(from, props.now, 2, tz, true)}
          legend={<Legend items={[{ label: 'Wind', tone: 'ink' }, { label: 'Gusts', tone: 'muted', dashed: true }]} />}
          readout={(t) => {
            const s = valueAt(speed, t);
            const g = valueAt(gust, t);
            return <><span className="num">{clock(t, tz)}</span> Wind <span className="num">{s === null ? '-' : Math.round(s)}</span> kn{g !== null ? <>, gusts <span className="num">{Math.round(g)}</span> kn</> : null}</>;
          }}
        />
      ) : null}
    </Section>
  );
}

function trendIcon(trend: TideTrend | null) {
  if (trend === 'rising') return <ArrowUp size={20} aria-hidden="true" />;
  if (trend === 'falling') return <ArrowDown size={20} aria-hidden="true" />;
  if (trend === 'steady') return <ArrowRight size={20} aria-hidden="true" />;
  return null;
}

function turnLine(t: TideTurnView | undefined) {
  if (!t) return null;
  return <span className="t-body c-muted">{t.kind === 'high' ? 'High' : 'Low'} <span className="num">{dayLabel(t.label)}</span>, <span className="num">{feet(t.meters)}</span> ft</span>;
}

function Tide(props: { c: CaptainConditions; now: number }) {
  const tide = props.c.tide;
  if (!tide) return <Section title="Tide" testId="cond-tide"><NoReading what="tide" /></Section>;
  const tz = props.c.timeZone;
  const curve = points(tide.curve, FEET_PER_METER);
  const measured = points(tide.measured, FEET_PER_METER);
  const ahead = tide.turns.filter((t) => Date.parse(t.at) > props.now);
  const nextHigh = ahead.find((t) => t.kind === 'high');
  const nextLow = ahead.find((t) => t.kind === 'low');
  const all = [...curve, ...measured].map((p) => p.v);
  const lo = all.length ? Math.floor(Math.min(...all) - 0.5) : 0;
  const hi = all.length ? Math.ceil(Math.max(...all) + 0.5) : 6;
  const gridStep = hi - lo > 6 ? 4 : 2;
  const grid: { v: number; label: string }[] = [];
  for (let v = Math.ceil(lo / gridStep) * gridStep; v <= hi; v += gridStep) if (v > lo) grid.push({ v, label: `${v} ft` });
  const from = curve.length ? curve[0].t : props.now - 6 * HOUR;
  const to = curve.length ? curve[curve.length - 1].t : props.now + 18 * HOUR;
  const predictedNow = valueAt(curve, props.now);
  const measuredNow = tide.levelM ? tide.levelM.value * FEET_PER_METER : null;
  const gap = predictedNow !== null && measuredNow !== null ? measuredNow - predictedNow : null;
  const marks = tide.turns.filter((t) => Date.parse(t.at) >= from && Date.parse(t.at) <= to).map((t) => ({
    t: Date.parse(t.at), v: t.meters * FEET_PER_METER, label: `${t.kind === 'high' ? 'High' : 'Low'} ${t.label.slice(-5)}`, place: t.kind === 'high' ? 'above' as const : 'below' as const,
  }));
  const trendWord = tide.trend ? `${tide.trend.charAt(0).toUpperCase()}${tide.trend.slice(1)}` : null;
  return (
    <Section title="Tide" source={`${plainSource(tide.source)}${tide.levelM ? `, ${ageText(tide.levelM.ageMin)}` : ''}`} testId="cond-tide">
      {tide.levelM ? (
        <Readout value={feet(tide.levelM.value)} unit="ft">
          {trendWord ? <span className="dir">{trendIcon(tide.trend)}<span>{trendWord}</span></span> : null}
          {turnLine(nextHigh)}
          {turnLine(nextLow)}
        </Readout>
      ) : (
        <div className="cap-cond-turns">
          <p className="cap-cond-none">No water level reading right now. Predicted times:</p>
          {turnLine(nextHigh)}
          {turnLine(nextLow)}
        </div>
      )}
      {curve.length > 1 ? (
        <TimeChart
          testId="chart-tide"
          label={`Tide for the day, ${Math.min(...curve.map((p) => p.v)).toFixed(1)} to ${Math.max(...curve.map((p) => p.v)).toFixed(1)} feet predicted`}
          series={[{ key: 'predicted', points: curve, tone: 'muted', area: true }, { key: 'measured', points: measured, tone: 'ink' }]}
          from={from} to={to} now={props.now} min={lo} max={hi} height={112} grid={grid} marks={marks}
          ticks={hourTicks(from, to, 6, tz, false)}
          legend={<Legend items={measured.length > 1 ? [{ label: 'Measured', tone: 'ink' }, { label: 'Predicted', tone: 'muted', area: true }] : [{ label: 'Predicted', tone: 'muted', area: true }]} />}
          readout={(t) => {
            const p = valueAt(curve, t);
            const m = valueAt(measured, t);
            return <><span className="num">{clock(t, tz)}</span>{m !== null ? <> Measured <span className="num">{m.toFixed(1)}</span> ft,</> : null} {m !== null ? 'predicted' : 'Predicted'} <span className="num">{p === null ? '-' : p.toFixed(1)}</span> ft</>;
          }}
        />
      ) : null}
      {gap !== null && Math.abs(gap) >= TIDE_GAP_FEET ? (
        <p className="cap-cond-note" data-testid="tide-gap">Measured water is running about <span className="num">{Math.abs(gap).toFixed(1)}</span> ft {gap > 0 ? 'above' : 'below'} the prediction.</p>
      ) : null}
    </Section>
  );
}

function Waves(props: { c: CaptainConditions; now: number }) {
  const w = props.c.waves;
  if (!w) return <Section title="Waves" testId="cond-waves"><NoReading what="wave" /></Section>;
  const tz = props.c.timeZone;
  const series = points(w.history, FEET_PER_METER);
  const from = series.length ? series[0].t : props.now - HOUR;
  const max = ceilTo(Math.max(4, ...series.map((p) => p.v)), 2);
  const detail = [w.periodS !== null ? `${Math.round(w.periodS)} s` : null, w.fromDeg !== null ? `from ${compass16(w.fromDeg)}` : null].filter(Boolean).join(', ');
  return (
    <Section title="Waves" source={`${plainSource(w.source)}, ${ageText(w.ageMin)}`} testId="cond-waves">
      <Readout value={feet(w.heightM)} unit="ft">
        <Direction toDeg={w.fromDeg === null ? null : w.fromDeg + 180}>{detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : 'Period not reported'}</Direction>
        <span className="t-body c-muted">Outside the breakwater</span>
      </Readout>
      {series.length > 1 ? (
        <TimeChart
          testId="chart-waves"
          label={`Wave height over the last ${Math.round((props.now - from) / HOUR)} hours`}
          series={[{ key: 'waves', points: series, tone: 'ink' }]}
          from={from} to={props.now} min={0} max={max} height={96}
          grid={[{ v: max / 2, label: `${max / 2} ft` }, { v: max, label: `${max} ft` }]}
          ticks={hourTicks(from, props.now, 4, tz, true)}
          legend={<span className="cap-chart-legend"><span className="key">Wave height, last <span className="num">{Math.round((props.now - from) / HOUR)}</span> hours</span></span>}
          readout={(t) => {
            const v = valueAt(series, t);
            return <><span className="num">{clock(t, tz)}</span> Waves <span className="num">{v === null ? '-' : v.toFixed(1)}</span> ft</>;
          }}
        />
      ) : null}
    </Section>
  );
}

function Row(props: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="cap-cond-row">
      <span className="k">{props.label}</span>
      {props.detail ? <span className="d">{props.detail}</span> : null}
      <span className="v">{props.value}</span>
    </div>
  );
}

function WaterAndAir(props: { c: CaptainConditions }) {
  const c = props.c;
  const none = <span className="c-muted">No reading</span>;
  return (
    <Section title="Water and air" source="NOAA" testId="cond-air">
      <div className="cap-cond-rows">
        <Row label="Water" value={c.waterTempC ? `${fahrenheit(c.waterTempC.value)} °F` : none} detail={c.waterTempC ? `${c.waterTempC.value.toFixed(1)} °C` : null} />
        <Row label="Air" value={c.airTempC ? `${fahrenheit(c.airTempC.value)} °F` : none} detail={c.airTempC ? `${c.airTempC.value.toFixed(1)} °C` : null} />
        <Row label="Pressure" value={c.pressureHpa ? `${c.pressureHpa.value.toFixed(1)} hPa` : none} />
        <Row label="Sunrise" value={c.sunrise ? dayLabel(c.sunrise) : none} />
        <Row label="Sunset" value={c.sunset ? dayLabel(c.sunset) : none} />
      </div>
    </Section>
  );
}

function Forecast(props: { c: CaptainConditions }) {
  const f = props.c.forecast;
  return (
    <Section title="Marine forecast" source={f ? `NWS${f.issuedLabel ? `, issued ${f.issuedLabel}` : ''}` : null} testId="cond-forecast">
      {f ? (
        <>
          <p className="t-small c-muted">{f.zoneName}</p>
          {f.periods.map((p) => (
            <div className="cap-cond-period" key={p.name}>
              <span className="t-strong">{periodName(p.name)}</span>
              <span className="t-body">{p.text}</span>
            </div>
          ))}
        </>
      ) : <NoReading what="forecast" />}
    </Section>
  );
}

export function ConditionsScreen(props: { c: CaptainConditions | null | undefined; bulletins: CaptainBulletin[]; onBack: () => void }) {
  const c = props.c;
  const now = c ? Date.parse(c.nowWall) : Date.now();
  return (
    <div className="cap-screen cap-cond" data-testid="conditions-screen">
      <Header title="Conditions" onBack={props.onBack} testId="conditions-back" />
      <div className="scroll">
        <p className="intro">Live from NOAA and the National Weather Service. Drag across a chart to read any time.</p>
        <BulletinStrip bulletins={props.bulletins} full />
        {c ? (
          <>
            <Wind c={c} now={now} />
            <Tide c={c} now={now} />
            <Waves c={c} now={now} />
            <WaterAndAir c={c} />
            <Forecast c={c} />
          </>
        ) : <NoReading what="conditions" />}
        <p className="cap-cond-foot">Readings are real. Your boat and the notices are simulated.</p>
      </div>
    </div>
  );
}
