import { useMemo } from 'react';
import { Check, CheckCircle, Eye, MapPin, Siren, Warning, X } from '@phosphor-icons/react';
import type { CaptainNotice, CaptainSnapshot, ClockView, Priority } from '../../shared/protocol';
import type { LonLat } from '../../engine/geo';
import { ChartMap, type ChartData } from '../map/ChartMap';
import { Button, PriorityBand } from '../ui';
import { Countdown, Legend, Num } from './parts';
import { noticePoints, routeAhead } from './frame';
import { PRIORITY_NAME, headline, isSecurityWatch, splitDetail, translated } from './words';

interface Timing { clock: ClockView; at: number; now: number }

function ReasonLine(props: { n: CaptainNotice; lang: string }) {
  const n = props.n;
  const local = translated(n, props.lang);
  return (
    <p className="reason">
      {local ? <b lang={props.lang}>{local}.</b> : <b>{headline(n)}.</b>}
      {' '}Approved by {n.approvedBy} at <span className="num">{n.publishedAtLabel}</span>.
    </p>
  );
}

export function Takeover(props: Timing & { n: CaptainNotice; theme: 'day' | 'night'; data: ChartData; boat: LonLat | null; newRoute: LonLat[] | null; labels: { id: string; text: string; lonlat: LonLat }[]; stamp?: number; lang: string; onGotIt: () => void }) {
  const n = props.n;
  const boatKey = props.boat ? `${Math.round(props.boat[0] * 200)}:${Math.round(props.boat[1] * 200)}` : '';
  const fit = useMemo(() => {
    const pts: LonLat[] = [...noticePoints(n), ...routeAhead(props.newRoute, 800)];
    if (props.boat) pts.push(props.boat);
    return pts;
  }, [n.id, n.area?.version, boatKey]);
  return (
    <div className="cap-take" data-testid="takeover">
      <PriorityBand priority="P1" />
      <div className="rule" />
      <div className="body">
        <div className="instr" data-testid="takeover-instruction"><Num text={n.instructionText} /></div>
        <Countdown n={n} clock={props.clock} at={props.at} now={props.now} size="xl" />
        <div className="panel">
          <div className="map">
            <ChartMap key={props.theme} theme={props.theme} compact showLabels interactive={false} data={props.data} fitTo={fit} padding={{ top: 28, right: 40, bottom: 28, left: 28 }} stamp={props.stamp} motionDelayMs={600} labels={props.labels} />
            <span className="attr">© OpenStreetMap contributors</span>
          </div>
          {n.area ? <div className="strip"><Legend /></div> : null}
        </div>
        <ReasonLine n={n} lang={props.lang} />
      </div>
      <div className="action">
        <button type="button" className="gotit-red" onClick={props.onGotIt} data-testid="got-it"><Check size={24} />Got it</button>
      </div>
    </div>
  );
}

export function Banner(props: Timing & { n: CaptainNotice; lang: string; onGotIt: () => void }) {
  const n = props.n;
  return (
    <div className="cap-banner" data-testid="banner">
      <PriorityBand priority="P2" />
      <div className="body">
        <div className="instr"><Num text={n.instructionText} /></div>
        <div className="act">
          <Countdown n={n} clock={props.clock} at={props.at} now={props.now} size="l" />
          <Button variant="primary" size="l" icon={<Check size={20} />} onClick={props.onGotIt} testId="got-it">Got it</Button>
        </div>
        <ReasonLine n={n} lang={props.lang} />
      </div>
    </div>
  );
}

const ICONS: Record<Priority, typeof Siren> = { P1: Siren, P2: Warning, P3: Eye, P4: MapPin };

export function NoticeCard(props: Timing & { n: CaptainNotice; lang: string; onClose?: () => void }) {
  const n = props.n;
  const Icon = ICONS[n.priority];
  const watch = isSecurityWatch(n);
  const [first, rest] = splitDetail(n.detail);
  const urgent = n.priority === 'P1' || n.priority === 'P2';
  const local = translated(n, props.lang);
  return (
    <div className="cap-card" data-testid={props.onClose ? 'notice-detail' : `card-${n.priority}`}>
      <Icon size={24} className={`lead ${n.priority}`} />
      <div className="text">
        {watch ? <p className="title"><Num text={first} /></p> : <p className={urgent ? 'title big' : 'title'}><Num text={n.instructionText} /></p>}
        {urgent ? <Countdown n={n} clock={props.clock} at={props.at} now={props.now} size="s" /> : null}
        <p className="sub">{watch ? rest : <><Num text={`${headline(n)}. ${n.detail}`} /></>}</p>
        {local ? <p className="sub strong" lang={props.lang}>{local}</p> : null}
        <p className="meta">
          {n.priority} {PRIORITY_NAME[n.priority]}{n.priority === 'P4' ? ', silent' : ''}. {n.acknowledgedAtLabel ? <>Acknowledged <span className="num">{n.acknowledgedAtLabel}</span>.</> : <>Updated <span className="num">{n.publishedAtLabel}</span>.</>}
        </p>
      </div>
      {props.onClose ? <button type="button" className="icon-btn close" onClick={props.onClose} aria-label="Close" title="Close" data-testid="close-notice"><X size={24} /></button> : null}
    </div>
  );
}

export function AllClearCard(props: { clear: CaptainSnapshot['allClear'][number] }) {
  const c = props.clear;
  return (
    <div className="cap-card" data-testid="all-clear-banner">
      <CheckCircle size={24} className="lead clear" />
      <div className="text">
        <p className="title big">ALL CLEAR</p>
        <p className="sub">{c.publicReason} lifted. Resume normal navigation.</p>
        <p className="meta">All clear at <span className="num">{c.atLabel}</span>. Approved by {c.approvedBy}.</p>
      </div>
    </div>
  );
}
