import { useEffect, useMemo, useRef, useState } from 'react';
import { Broadcast, CheckCircle, Clock, Export, Moon, NavigationArrow, Path, SealCheck, Sun, Translate, WifiSlash, X } from '@phosphor-icons/react';
import type { CaptainNotice, CaptainSnapshot } from '../../shared/protocol';
import { useCaptainHub } from '../hub/useHub';
import { ChartMap, type ChartData } from '../map/ChartMap';
import { captainChart } from '../map/toChart';
import { Button, PriorityBand } from '../ui';
import { Lockup } from '../command/TopBar';
import { alertTone, buzz, enablePush, keepAwake, primeSound, pushState, registerWorker, secureEnough } from './device';
import { ago } from '../format';
import type { LonLat } from '../../engine/geo';
import '../../styles/captain.css';

const LANGS: Record<string, string> = { es: 'Español', zh: '中文', ko: '한국어', tl: 'Tagalog', vi: 'Tiếng Việt' };
const STALE_MS = 20_000;
const ALL_CLEAR_SHOW_MS = 60_000;

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function headline(n: CaptainNotice): string {
  if (!n.place) return n.publicReason;
  return /nearby$/i.test(n.publicReason) ? n.publicReason.replace(/nearby$/i, `near ${n.place}`) : `${n.publicReason} near ${n.place}`;
}

function routeNote(n: CaptainNotice): string {
  const around = n.kind === 'whale' ? 'the whale' : n.kind === 'divers' ? 'the divers' : 'the zone';
  const cost = n.addedMin >= 0.5 ? ` +${Math.round(n.addedMin)} min.` : '';
  return n.rerouted ? `Your new route bends around ${around}.${cost}` : `${n.instructionText.charAt(0)}${n.instructionText.slice(1).toLowerCase()} until it is lifted.`;
}

function zonePoints(n: CaptainNotice): LonLat[] {
  return n.zone.rings.flatMap((poly) => poly[0] ?? []);
}

function Join(props: { vesselName: string | null; onJoin: () => void; joining: boolean; alerts: boolean; onAlerts: () => void; data: ChartData }) {
  return (
    <div className="cap-join" data-testid="captain-join">
      <div className="head"><Lockup /></div>
      <div className="preview"><ChartMap theme="day" compact interactive={false} showLabels={false} data={props.data} /></div>
      <div className="intro">
        <span className="t-display">{props.vesselName ? `You are ${props.vesselName}` : 'Join as a captain'}</span>
        <span className="t-body c-muted">Harbor notices for your boat: where not to go, and your new route.</span>
      </div>
      <div className="settings">
        <div className="setting">
          <div className="text"><span className="t-strong">Turn on alerts</span><span className="t-small">Buzz and sound when a notice reaches your route</span></div>
          <button className="switch" role="switch" aria-checked={props.alerts} aria-label="Turn on alerts" onClick={props.onAlerts} />
        </div>
        <div className="setting">
          <div className="text"><span className="t-strong">Add to Home Screen for alerts when the app is closed</span><span className="t-small">In Safari, tap Share, then Add to Home Screen.</span></div>
          <Export size={24} />
        </div>
      </div>
      <div className="spacer" />
      <div className="foot">
        <Button variant="primary" size="l" block onClick={props.onJoin} disabled={props.joining} testId="join">{props.joining ? 'Joining' : 'Join'}</Button>
        <span className="t-small c-muted">Your boat is simulated for this demo.</span>
      </div>
    </div>
  );
}

function Takeover(props: { n: CaptainNotice; theme: 'day' | 'night'; you: LonLat | null; data: ChartData; onGotIt: () => void }) {
  const n = props.n;
  const fit = useMemo(() => [...zonePoints(n), ...(props.you ? [props.you] : [])], [n.id, props.you?.[0], props.you?.[1]]);
  const km = n.distanceM !== null && n.distanceM >= 1000;
  const distance = n.distanceM === null ? 'n/a' : n.distanceM === 0 ? 'inside' : km ? (n.distanceM / 1000).toFixed(1) : String(Math.round(n.distanceM / 10) * 10);
  const distUnit = n.distanceM === null || n.distanceM === 0 ? '' : km ? 'km' : 'm';
  const time = n.minutesToZone === null ? 'n/a' : n.minutesToZone < 1 ? 'now' : String(Math.round(n.minutesToZone));
  return (
    <div className="cap-take" data-testid="takeover">
      <PriorityBand priority="P1" />
      <div className="content">
        <div className="cap-instruction" data-testid="takeover-instruction">{n.instructionText}</div>
        <div className="title-block">
          <span className="t-heading">{n.publicReason}</span>
          <span className="t-body c-muted">{n.relative ?? n.detail}</span>
        </div>
        <div className="mini"><ChartMap theme={props.theme} compact showLabels={false} interactive={false} data={props.data} fitTo={fit} padding={{ top: 30, right: 30, bottom: 30, left: 30 }} /></div>
        <div className="nums">
          <div className="title-block"><span className="t-small c-muted">Distance to zone</span><span className="val"><span className="t-data-xl">{distance}</span><span className="unit">{distUnit}</span></span></div>
          <div className="title-block"><span className="t-small c-muted">Time to zone</span><span className="val"><span className="t-data-xl">{time}</span><span className="unit">{time !== 'now' && time !== 'n/a' ? 'min' : ''}</span></span></div>
        </div>
        <span className="t-small c-muted">Valid until <span className="t-mono-small">{n.validUntilLabel}</span> or All clear. Approved by {n.approvedBy}.</span>
      </div>
      <div className="foot"><Button variant="primary" size="l" block onClick={props.onGotIt} testId="got-it">Got it</Button></div>
    </div>
  );
}

function Detail(props: { n: CaptainNotice; onGotIt: () => void }) {
  const n = props.n;
  return (
    <>
      <PriorityBand priority={n.priority} />
      <div className="inner">
        <div className="title-block">
          <span className="cap-instruction">{n.instructionText}</span>
          <span className="t-heading">{headline(n)}</span>
          <span className="t-body c-muted">{n.relative ?? n.detail}</span>
        </div>
        <div className="divider" />
        <div className="cap-facts">
          <span className="cap-fact"><Clock size={20} /><span>Valid until <span className="t-data">{n.validUntilLabel}</span> or All clear</span></span>
          <span className="cap-fact"><SealCheck size={20} /><span>Approved by {n.approvedBy}</span></span>
        </div>
        <div className="divider" />
        <div className="cap-tr">
          <span className="cap-fact"><Translate size={20} /><span className="t-strong">Translations</span></span>
          {Object.entries(n.translations).map(([lang, text]) => (
            <div className="row" key={lang}><span className="lang">{LANGS[lang] ?? lang}</span><span className="text">{text}</span></div>
          ))}
        </div>
        {!n.acknowledged ? <Button variant="primary" size="l" block onClick={props.onGotIt} testId="got-it">Got it</Button> : null}
      </div>
      {n.acknowledged ? <div className="cap-ack"><CheckCircle size={24} /><span>Acknowledged at <span className="t-data">{n.acknowledgedAtLabel}</span></span></div> : null}
    </>
  );
}

function Strip(props: { name: string; speedKn: number | null; stale: boolean; onPick: () => void }) {
  return (
    <div className="cap-strip">
      <div className="who" onClick={props.onPick} role="button" tabIndex={0} aria-label="Change boat"><b>{props.name}</b>{props.speedKn !== null ? <span className="t-mono-small">{props.speedKn.toFixed(1)} kn</span> : null}<span className="simulated">Simulated</span></div>
      {props.stale ? null : <span className="live"><Broadcast size={14} />Live</span>}
    </div>
  );
}

type Clear = CaptainSnapshot['allClear'][number];

function Sheet(props: { snap: CaptainSnapshot | null; notices: CaptainNotice[]; banner: CaptainNotice | null; clear: Clear | null; stale: boolean; open: (id: string) => void; gotIt: (id: string) => void }) {
  const { snap, notices, banner, clear, stale } = props;
  if (clear && !notices.length) {
    return (
      <div className="inner" data-testid="all-clear-banner">
        <span className="cap-fact"><CheckCircle size={24} /><span className="cap-clear-title">ALL CLEAR</span></span>
        <span className="t-body">{clear.publicReason} lifted. Resume normal navigation.</span>
        <div className="cap-facts">
          <span className="cap-fact"><Clock size={20} /><span>All clear at <span className="t-data">{clear.atLabel}</span></span></span>
          <span className="cap-fact"><SealCheck size={20} /><span>Approved by {clear.approvedBy}</span></span>
        </div>
      </div>
    );
  }
  if (stale && notices.length) {
    const n = notices[0];
    return (
      <>
        <PriorityBand priority={n.priority} />
        <div className="inner">
          <div className="title-block"><span className="cap-instruction">{n.instructionText}</span><span className="t-heading">{headline(n)}</span></div>
          <span className="t-small c-muted">Valid until <span className="t-mono-small">{n.validUntilLabel}</span> or All clear.{n.acknowledgedAtLabel ? <> Acknowledged at <span className="t-mono-small">{n.acknowledgedAtLabel}</span>.</> : null}</span>
        </div>
      </>
    );
  }
  if (banner) {
    return (
      <div className="inner">
        <span className="cap-fact"><Path size={20} /><span>{routeNote(banner)}</span></span>
        <Button variant="primary" size="l" block onClick={() => props.gotIt(banner.id)} testId="got-it">Got it</Button>
      </div>
    );
  }
  if (!notices.length) {
    return (
      <div className="inner">
        <span className="cap-fact"><CheckCircle size={20} /><span className="sub"><span className="t-strong">No notices on your route</span><span className="t-small">{snap?.lastAllClearLabel ? `Last notice: All clear at ${snap.lastAllClearLabel}` : snap?.vessel?.newRoute ? 'Following your new route.' : 'Your route is clear.'}</span></span></span>
      </div>
    );
  }
  return (
    <div className="inner">
      <div className="cap-list">
        {notices.map((n) => (
          <button key={n.id} className="cap-item" onClick={() => props.open(n.id)} data-testid={`notice-${n.priority}`}>
            <span className="title-block"><span className="t-strong">{n.instructionText}</span><span className="t-small c-muted">{n.publicReason}. {n.detail}</span></span>
            <span className="t-data">{n.acknowledged ? 'Got it' : n.priority}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CaptainView() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('v');
  const hub = useCaptainHub(requested);
  const now = useNow(5000);
  const [joining, setJoining] = useState(false);
  const [alertsOn, setAlertsOn] = useState(pushState() === 'on');
  const [names, setNames] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<'day' | 'night' | null>(params.get('theme') === 'night' ? 'night' : params.get('theme') === 'day' ? 'day' : null);
  const [recenter, setRecenter] = useState(0);
  const [picking, setPicking] = useState(false);
  const alerted = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());
  const snap = hub.snapshot;
  const theme: 'day' | 'night' = themeChoice ?? (snap?.clock.night ? 'night' : 'day');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    void registerWorker();
    void fetch('/api/join').then((r) => r.json()).then((j) => setNames(Object.fromEntries(j.phones.map((p: { vesselId: string; name: string }) => [p.vesselId, p.name])))).catch(() => undefined);
  }, []);

  const notices = snap?.notices ?? [];
  const urgent = notices.find((n) => !n.acknowledged && n.priority === 'P1') ?? null;
  const banner = !urgent ? notices.find((n) => !n.acknowledged && n.priority === 'P2') ?? null : null;
  const stale = hub.link !== 'online' || (hub.receivedAt !== null && now - hub.receivedAt > STALE_MS);
  const extrapolateMin = stale && hub.receivedAt && snap ? ((now - hub.receivedAt) / 60000) * Math.max(1, snap.clock.timeScale) : 0;
  const data = useMemo(() => captainChart(snap, extrapolateMin), [snap, Math.floor(extrapolateMin * 4)]);
  const joinPreview = useMemo(() => captainChart(null, 0), []);

  useEffect(() => {
    for (const n of notices) {
      const last = alerted.current.get(n.id);
      if (!n.acknowledged && (n.priority === 'P1' || n.priority === 'P2') && last !== n.priority && (last === undefined || n.priority === 'P1')) {
        alertTone(n.priority === 'P1');
        buzz(n.priority === 'P1');
      }
      alerted.current.set(n.id, n.priority);
      if (!seen.current.has(n.id) && document.visibilityState === 'visible' && (n.priority !== 'P4' || openId === n.id)) {
        seen.current.add(n.id);
        hub.ack('seen', n.id);
      }
    }
  }, [notices.map((n) => `${n.id}:${n.priority}:${n.acknowledged}`).join('|'), openId]);

  useEffect(() => {
    if (!alertsOn || !hub.pushKey || !secureEnough() || pushState() !== 'on') return;
    void enablePush(hub.pushKey).then((sub) => { if (sub) hub.sendSubscription(sub); });
  }, [alertsOn, hub.pushKey]);

  const join = async () => {
    setJoining(true);
    primeSound();
    void keepAwake();
    await hub.join(requested ?? undefined);
    setJoining(false);
  };
  const toggleAlerts = async () => {
    primeSound();
    if (alertsOn) { setAlertsOn(false); return; }
    setAlertsOn(true);
    buzz(false);
    if (hub.pushKey && secureEnough()) {
      const sub = await enablePush(hub.pushKey);
      if (sub) hub.sendSubscription(sub);
    }
  };
  const gotIt = (id: string) => { hub.ack('gotIt', id); setOpenId(null); };

  if (!hub.vessel) {
    return <div className="cap"><Join vesselName={requested ? names[requested] ?? null : null} onJoin={() => void join()} joining={joining || hub.link !== 'online'} alerts={alertsOn} onAlerts={() => void toggleAlerts()} data={joinPreview} /></div>;
  }

  const vessel = snap?.vessel ?? null;
  const open = openId ? notices.find((n) => n.id === openId) ?? null : null;
  const serverNow = snap ? Date.parse(snap.serverWall) : now;
  const clear = snap?.allClear.filter((a) => serverNow - Date.parse(a.atWall) < ALL_CLEAR_SHOW_MS).slice(-1)[0] ?? null;

  return (
    <div className="cap" data-testid="captain">
      <div className="cap-top">
        {banner && !stale && !open ? (
          <div className="cap-alert" onClick={() => setOpenId(banner.id)} data-testid="banner">
            <PriorityBand priority="P2" />
            <div className="instr">
              <span className="cap-instruction">{banner.instructionText}</span>
              <span className="t-small c-muted">{banner.publicReason}. {banner.detail}</span>
            </div>
          </div>
        ) : (
          <Strip name={hub.vessel.name} speedKn={vessel?.speedKn ?? null} stale={stale} onPick={() => setPicking(true)} />
        )}
        {stale ? (
          <div className="cap-offline" data-testid="stale"><WifiSlash size={18} /><span>Updated {hub.receivedAt ? ago(hub.receivedAt, now) : 'a while ago'}. Zones keep moving along their predicted path.</span></div>
        ) : null}
      </div>
      <div className="cap-map">
        <ChartMap theme={theme} compact data={data} follow={vessel?.lonlat ?? null} recenter={recenter} showLabels />
        {open ? <div className="cap-close"><Button variant="secondary" size="l" title="Close" icon={<X size={24} />} onClick={() => setOpenId(null)} /></div> : null}
        <div className="cap-mapbtns">
          <button className="cap-mapbtn" title="Center on my boat" aria-label="Center on my boat" onClick={() => setRecenter(recenter + 1)}><NavigationArrow size={20} /></button>
          <button className="cap-mapbtn" title={theme === 'day' ? 'Night chart' : 'Day chart'} aria-label="Day or night chart" onClick={() => setThemeChoice(theme === 'day' ? 'night' : 'day')}>{theme === 'day' ? <Moon size={20} /> : <Sun size={20} />}</button>
        </div>
        <span className="cap-attr">OpenStreetMap contributors</span>
      </div>
      <div className="cap-sheet" data-testid={open ? 'notice-detail' : 'captain-sheet'}>
        {open ? <Detail n={open} onGotIt={() => gotIt(open.id)} /> : <Sheet snap={snap} notices={notices} banner={banner} clear={clear} stale={stale} open={setOpenId} gotIt={gotIt} />}
      </div>
      {picking ? (
        <div className="cap-picker" data-testid="boat-picker">
          <div className="inner">
            <span className="t-title">Change boat</span>
            <span className="t-small c-muted">Each phone captains one simulated boat.</span>
            <div className="cap-list">
              {Object.entries(names).map(([id, name]) => (
                <button key={id} className="cap-item" onClick={() => { setPicking(false); void hub.join(id); }}>
                  <span className="t-strong">{name}</span>
                  <span className="t-data">{id === hub.vessel?.vesselId ? 'You' : ''}</span>
                </button>
              ))}
            </div>
            <Button variant="secondary" size="l" block onClick={() => setPicking(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {urgent ? <Takeover n={urgent} theme={theme} you={vessel?.lonlat ?? null} data={data} onGotIt={() => gotIt(urgent.id)} /> : null}
    </div>
  );
}
