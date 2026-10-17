import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Export } from '@phosphor-icons/react';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/600.css';
import type { CaptainSnapshot } from '../../shared/protocol';
import { useCaptainHub } from '../hub/useHub';
import { ChartMap, type ChartData } from '../map/ChartMap';
import { captainChart, YOU_TAG_ID } from '../map/toChart';
import { Button } from '../ui';
import { Lockup } from '../command/TopBar';
import { alertTone, buzz, enablePush, keepAwake, primeSound, pushState, registerWorker, secureEnough } from './device';
import { AllClearCard, Banner, NoticeCard, Takeover } from './alerts';
import { Legend, MapControls, OfflineLine, TopBar } from './parts';
import { LanguageScreen, NoticesScreen, TodaySheet } from './screens';
import { ReportFlow } from './report';
import { BulletinStrip } from './conditions';
import { boatBox, framePoints } from './frame';
import { snapshotAt } from './timing';
import { useLanguage } from './words';
import '../../styles/captain.css';

const STALE_MS = 20_000;
const ALL_CLEAR_SHOW_MS = 60_000;
const MAP_PADDING = { top: 48, right: 64, bottom: 40, left: 40 };

type Screen = 'main' | 'notices' | 'language' | 'report';

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
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

type Clear = CaptainSnapshot['allClear'][number];

export function CaptainView() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('v');
  const hub = useCaptainHub(requested);
  const now = useNow(1000);
  const [lang, setLang] = useLanguage();
  const [joining, setJoining] = useState(false);
  const [alertsOn, setAlertsOn] = useState(pushState() === 'on');
  const [names, setNames] = useState<Record<string, string>>({});
  const [focusId, setFocusId] = useState<string | null>(params.get('notice'));
  const [screen, setScreen] = useState<Screen>('main');
  const [themeChoice, setThemeChoice] = useState<'day' | 'night' | null>(params.get('theme') === 'night' ? 'night' : params.get('theme') === 'day' ? 'day' : null);
  const [centerTick, setCenterTick] = useState(0);
  const [boatMode, setBoatMode] = useState(false);
  const [picking, setPicking] = useState(false);
  const alerted = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());
  const snap = hub.snapshot;
  const theme: 'day' | 'night' = themeChoice ?? (snap?.clock.night ? 'night' : 'day');
  const toggleTheme = () => setThemeChoice(theme === 'day' ? 'night' : 'day');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    void registerWorker();
    void fetch('/api/join').then((r) => r.json()).then((j) => setNames(Object.fromEntries(j.phones.map((p: { vesselId: string; name: string }) => [p.vesselId, p.name])))).catch(() => undefined);
  }, []);

  const notices = snap?.notices ?? [];
  const active = notices.filter((n) => n.priority !== 'P4');
  const urgent = active.find((n) => !n.acknowledged && n.priority === 'P1') ?? null;
  const banner = !urgent ? active.find((n) => !n.acknowledged && n.priority === 'P2') ?? null : null;
  const standing = active.find((n) => n.priority === 'P1' || n.priority === 'P2') ?? null;
  const calm = active.find((n) => n.priority === 'P3') ?? null;
  const focus = focusId ? notices.find((n) => n.id === focusId) ?? null : null;
  const lead = focus ?? banner ?? standing ?? calm;
  const stale = hub.link !== 'online' || (hub.receivedAt !== null && now - hub.receivedAt > STALE_MS);
  const extrapolateMin = stale && hub.receivedAt && snap ? ((now - hub.receivedAt) / 60000) * Math.max(1, snap.clock.timeScale) : 0;
  const data = useMemo(() => captainChart(snap, extrapolateMin, { youTag: true }), [snap, Math.floor(extrapolateMin * 4)]);
  const joinPreview = useMemo(() => captainChart(null, 0), []);
  const vessel = snap?.vessel ?? null;
  const at = snap ? snapshotAt(hub.receivedAt, snap.serverWall) : now;

  const leadKey = lead ? `${lead.id}:${lead.priority}:${lead.area?.version ?? 0}` : 'none';
  const coarse = vessel ? `${Math.round(vessel.lonlat[0] * 50)}:${Math.round(vessel.lonlat[1] * 50)}` : '';
  useEffect(() => { setBoatMode(false); }, [leadKey]);
  const fit = useMemo(() => {
    if (!vessel) return null;
    if (boatMode) return boatBox(vessel.lonlat, 600 + (centerTick % 2));
    return framePoints(vessel.lonlat, vessel.newRoute ?? vessel.route, lead ? [lead] : []);
  }, [hub.vessel?.vesselId, leadKey, boatMode, centerTick, coarse]);
  const youLabels = useMemo(() => (vessel ? [{ id: YOU_TAG_ID, text: 'You', lonlat: vessel.lonlat }] : []), [!!vessel]);

  useEffect(() => {
    for (const n of notices) {
      const last = alerted.current.get(n.id);
      if (!n.acknowledged && (n.priority === 'P1' || n.priority === 'P2') && last !== n.priority && (last === undefined || n.priority === 'P1')) {
        alertTone(n.priority === 'P1');
        buzz(n.priority === 'P1');
      }
      alerted.current.set(n.id, n.priority);
      if (!seen.current.has(n.id) && document.visibilityState === 'visible' && (n.priority !== 'P4' || focusId === n.id || screen === 'notices')) {
        seen.current.add(n.id);
        hub.ack('seen', n.id);
      }
    }
  }, [notices.map((n) => `${n.id}:${n.priority}:${n.acknowledged}`).join('|'), focusId, screen]);

  useEffect(() => {
    if (!alertsOn || !hub.pushKey || !secureEnough() || pushState() !== 'on') return;
    void enablePush(hub.pushKey).then((sub) => { if (sub) hub.sendSubscription(sub); });
  }, [alertsOn, hub.pushKey, hub.vessel?.vesselId]);

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
  const gotIt = (id: string) => { hub.ack('gotIt', id); setFocusId(null); };
  const center = () => { setBoatMode(true); setCenterTick(centerTick + 1); };

  if (!hub.vessel) {
    return <div className="cap"><Join vesselName={requested ? names[requested] ?? null : null} onJoin={() => void join()} joining={joining || hub.link !== 'online'} alerts={alertsOn} onAlerts={() => void toggleAlerts()} data={joinPreview} /></div>;
  }

  const serverNow = snap ? Date.parse(snap.serverWall) : now;
  const clear: Clear | null = snap?.allClear.filter((a) => serverNow - Date.parse(a.atWall) < ALL_CLEAR_SHOW_MS).slice(-1)[0] ?? null;
  const timing = snap ? { clock: snap.clock, at, now } : null;
  const showLegend = !banner && !!lead?.area;

  let sheet: ReactNode = null;
  if (focus && timing) sheet = <NoticeCard n={focus} {...timing} lang={lang} onClose={() => setFocusId(null)} />;
  else if (banner) sheet = banner.area ? <div className="cap-strip"><Legend /></div> : null;
  else if (standing && timing) sheet = <NoticeCard n={standing} {...timing} lang={lang} />;
  else if (calm && timing) sheet = <NoticeCard n={calm} {...timing} lang={lang} />;
  else if (clear && !active.length) sheet = <AllClearCard clear={clear} />;
  else sheet = <TodaySheet snap={snap} lang={lang} onReport={() => setScreen('report')} onLanguage={() => setScreen('language')} />;

  return (
    <div className="cap" data-testid="captain">
      <div className="cap-top">
        {banner && timing ? <Banner n={banner} {...timing} lang={lang} onGotIt={() => gotIt(banner.id)} /> : (
          <TopBar name={hub.vessel.name} speedKn={vessel?.speedKn ?? null} offline={stale} onPick={() => setPicking(true)} onNotices={() => setScreen('notices')} />
        )}
        {stale ? <OfflineLine receivedAt={hub.receivedAt} now={now} /> : null}
        {!banner ? <BulletinStrip bulletins={snap?.bulletins ?? []} /> : null}
      </div>
      <div className="cap-map">
        <ChartMap key={theme} theme={theme} compact showLabels data={data} stamp={snap?.clock.wallMs} motionDelayMs={600} fitTo={fit} padding={MAP_PADDING} labels={youLabels} />
        {showLegend ? <div className="cap-legend-float"><Legend stacked /></div> : null}
        <MapControls theme={theme} onCenter={center} onTheme={toggleTheme} />
        <span className="cap-attr">© OpenStreetMap contributors</span>
      </div>
      {sheet ? <div className="cap-sheet" data-testid="captain-sheet">{sheet}</div> : null}
      {screen === 'notices' ? <NoticesScreen notices={notices} cleared={snap?.allClear ?? []} lang={lang} onBack={() => setScreen('main')} onOpen={(id) => { setFocusId(id); setScreen('main'); }} /> : null}
      {screen === 'language' ? <LanguageScreen lang={lang} onChoose={setLang} onBack={() => setScreen('main')} /> : null}
      {screen === 'report' ? <ReportFlow snap={snap} theme={theme} onTheme={toggleTheme} stamp={snap?.clock.wallMs} onSend={hub.reportSighting} onClose={() => setScreen('main')} /> : null}
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
      {urgent && timing ? <Takeover n={urgent} {...timing} theme={theme} data={data} boat={vessel?.lonlat ?? null} newRoute={vessel?.newRoute ?? null} labels={youLabels} stamp={snap?.clock.wallMs} lang={lang} onGotIt={() => gotIt(urgent.id)} /> : null}
    </div>
  );
}
