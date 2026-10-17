import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Broadcast, CheckCircle, DeviceMobile, Moon, Sun, WifiSlash } from '@phosphor-icons/react';
import type { CaptainNotice } from '../../shared/protocol';
import { useCaptainHub } from '../hub/useHub';
import { ChartMap } from '../map/ChartMap';
import { captainChart } from '../map/toChart';
import { Button, PriorityBand, Simulated } from '../ui';
import { Lockup } from '../command/TopBar';
import { alertTone, buzz, enablePush, keepAwake, primeSound, pushState, registerWorker, secureEnough } from './device';
import { ago } from '../format';
import { compassPoint, type LonLat } from '../../engine/geo';
import '../../styles/captain.css';

const LANGS: Record<string, string> = { es: 'Spanish', zh: 'Chinese', ko: 'Korean', tl: 'Tagalog', vi: 'Vietnamese' };
const STALE_MS = 20_000;

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function distanceText(n: CaptainNotice): string {
  if (n.distanceM === null) return 'n/a';
  if (n.distanceM === 0) return 'inside';
  return n.distanceM >= 1000 ? `${(n.distanceM / 1000).toFixed(1)} km` : `${Math.round(n.distanceM / 10) * 10} m`;
}

function zonePoints(n: CaptainNotice): LonLat[] {
  return n.zone.rings.flatMap((poly) => poly[0] ?? []);
}

function Join(props: { vesselName: string | null; onJoin: () => void; joining: boolean }) {
  return (
    <div className="cap-join" data-testid="captain-join">
      <Lockup />
      <div className="mid">
        <span className="t-display">{props.vesselName ? `You are ${props.vesselName}` : 'Join as a captain'}</span>
        <span className="t-body">Harbor notices for your boat: where not to go, and your new route.</span>
        <span className="hint"><DeviceMobile size={18} />Add to Home Screen for alerts when the app is closed.</span>
      </div>
      <div className="mid">
        <Button variant="primary" size="l" block onClick={props.onJoin} disabled={props.joining} testId="join">{props.joining ? 'Joining' : 'Join'}</Button>
        <span className="t-small c-muted">Your boat is simulated for this demo. Zones and instructions are what a real captain would see.</span>
      </div>
    </div>
  );
}

function Takeover(props: { n: CaptainNotice; theme: 'day' | 'night'; you: LonLat | null; data: ReturnType<typeof captainChart>; onGotIt: () => void }) {
  const n = props.n;
  const fit = useMemo(() => [...zonePoints(n), ...(props.you ? [props.you] : [])], [n.id, props.you?.[0], props.you?.[1]]);
  return (
    <div className="cap-take" data-testid="takeover">
      <PriorityBand priority="P1" />
      <div className="content">
        <div className="cap-instruction" data-testid="takeover-instruction">{n.instructionText}</div>
        <div className="title-block">
          <span className="t-heading">{n.publicReason}</span>
          <span className="t-small c-muted">{n.detail} Follow the new route in teal.</span>
        </div>
        <div className="mini"><ChartMap theme={props.theme} compact showLabels={false} interactive={false} data={props.data} fitTo={fit} padding={{ top: 30, right: 30, bottom: 30, left: 30 }} /></div>
        <div className="nums">
          <div><span className="t-small c-muted">Distance to zone</span><span className="t-data-xl">{distanceText(n)}</span></div>
          <div><span className="t-small c-muted">Time to zone</span><span className="t-data-xl">{n.minutesToZone === null ? 'n/a' : n.minutesToZone < 1 ? 'now' : `${Math.round(n.minutesToZone)} min`}</span></div>
        </div>
        <span className="t-small c-muted">Valid until {n.validUntilLabel} or All clear. Approved by {n.approvedBy}.</span>
      </div>
      <div className="foot"><Button variant="primary" size="l" block onClick={props.onGotIt} testId="got-it">Got it</Button></div>
    </div>
  );
}

function Detail(props: { n: CaptainNotice; onGotIt: () => void; onClose: () => void }) {
  const n = props.n;
  return (
    <div className="cap-sheet cap-detail" data-testid="notice-detail">
      <PriorityBand priority={n.priority} />
      <div className="cap-instruction">{n.instructionText}</div>
      <div className="title-block">
        <span className="t-heading">{n.publicReason}</span>
        <span className="t-small c-muted">{n.detail}{n.zone.movingTowardDeg !== null ? ` The zone is moving ${compassPoint(n.zone.movingTowardDeg)} at about ${(n.zone.movingSpeedMps / 0.514444).toFixed(1)} kn.` : ''}</span>
      </div>
      <dl className="kv">
        <dt>Valid until</dt><dd className="t-data">{n.validUntilLabel}</dd>
        <dt>Approved by</dt><dd>{n.approvedBy}</dd>
        <dt>Published</dt><dd className="t-data">{n.publishedAtLabel}</dd>
      </dl>
      <div>
        {Object.entries(n.translations).map(([lang, text]) => (
          <div className="tr" key={lang}><span className="t-small">{LANGS[lang] ?? lang}</span><span className="t-body">{text}</span></div>
        ))}
      </div>
      {n.acknowledged
        ? <span className="cap-acked"><CheckCircle size={20} />Acknowledged</span>
        : <Button variant="primary" size="l" block onClick={props.onGotIt} testId="got-it">Got it</Button>}
      <Button variant="secondary" size="l" block onClick={props.onClose}>Back to the chart</Button>
    </div>
  );
}

export function CaptainView() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('v');
  const hub = useCaptainHub(requested);
  const now = useNow(5000);
  const [joining, setJoining] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<'day' | 'night' | null>(params.get('theme') === 'night' ? 'night' : params.get('theme') === 'day' ? 'day' : null);
  const [push, setPush] = useState(pushState());
  const alerted = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());
  const snap = hub.snapshot;
  const theme: 'day' | 'night' = themeChoice ?? (snap?.clock.night ? 'night' : 'day');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void registerWorker(); void fetch('/api/join').then((r) => r.json()).then((j) => setNames(Object.fromEntries(j.phones.map((p: { vesselId: string; name: string }) => [p.vesselId, p.name])))).catch(() => undefined); }, []);

  const notices = snap?.notices ?? [];
  const urgent = notices.find((n) => !n.acknowledged && n.priority === 'P1') ?? null;
  const banner = !urgent ? notices.find((n) => !n.acknowledged && n.priority === 'P2') ?? null : null;
  const stale = hub.link !== 'online' || (hub.receivedAt !== null && now - hub.receivedAt > STALE_MS);
  const extrapolateMin = stale && hub.receivedAt && snap ? ((now - hub.receivedAt) / 60000) * Math.max(1, snap.clock.timeScale) : 0;
  const data = useMemo(() => captainChart(snap, extrapolateMin), [snap, Math.floor(extrapolateMin * 4)]);

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

  const join = async () => {
    setJoining(true);
    primeSound();
    void keepAwake();
    await hub.join(requested ?? undefined);
    setJoining(false);
  };
  const gotIt = (id: string) => { hub.ack('gotIt', id); setOpenId(null); };
  const turnOnAlerts = async () => {
    if (!hub.pushKey) return;
    const sub = await enablePush(hub.pushKey);
    if (sub) hub.sendSubscription(sub);
    setPush(pushState());
  };

  if (!hub.vessel) return <div className="cap"><Join vesselName={requested ? names[requested] ?? null : null} onJoin={() => void join()} joining={joining || hub.link !== 'online'} /></div>;

  const vessel = snap?.vessel ?? null;
  const open = openId ? notices.find((n) => n.id === openId) ?? null : null;
  const clear = snap?.allClear.find((a) => Date.parse(snap.serverWall) - Date.parse(a.atWall) < 15000) ?? null;

  return (
    <div className="cap" data-testid="captain">
      <ChartMap theme={theme} compact data={data} follow={vessel?.lonlat ?? null} showLabels />
      <div className="cap-strip">
        <div className="who"><b>{hub.vessel.name}</b><span className="t-data c-muted">{vessel ? `${vessel.speedKn.toFixed(1)} kn` : ''}</span></div>
        {stale
          ? <span className="live off" data-testid="stale"><WifiSlash size={14} />Updated {hub.receivedAt ? ago(hub.receivedAt, now) : 'a while ago'}</span>
          : <span className="live"><Broadcast size={14} />Live</span>}
      </div>
      {stale ? (
        <div className="cap-banner" style={{ top: 49 }}>
          <div className="body"><span className="t-small">Zones keep moving along their predicted path. Last instruction still stands.</span></div>
        </div>
      ) : null}
      {banner && !stale ? (
        <div className="cap-banner" style={{ top: 49 }} onClick={() => setOpenId(banner.id)} data-testid="banner">
          <PriorityBand priority="P2" when={banner.publicReason} />
          <div className="body">
            <span className="cap-instruction">{banner.instructionText}</span>
            <span className="t-small c-muted">{banner.detail}</span>
          </div>
        </div>
      ) : null}
      {clear && !notices.length ? (
        <div className="cap-clear" style={{ top: 49 }} data-testid="all-clear-banner">
          <span className="cap-instruction">ALL CLEAR</span>
          <span className="t-body">{clear.publicReason} lifted. Resume normal navigation.</span>
          <span className="t-small c-muted t-data">{clear.atLabel}</span>
        </div>
      ) : null}
      {open ? <Detail n={open} onGotIt={() => gotIt(open.id)} onClose={() => setOpenId(null)} /> : (
        <div className="cap-sheet" data-testid="captain-sheet">
          {notices.length === 0 ? (
            <div className="title-block"><span className="t-heading">No notices on your route</span><span className="t-small c-muted">{vessel?.newRoute ? 'Following your new route.' : 'Your route is clear.'}</span></div>
          ) : (
            <div className="nlist">
              {notices.map((n) => (
                <button key={n.id} className="nitem" onClick={() => setOpenId(n.id)} data-testid={`notice-${n.priority}`}>
                  <span className="title-block"><span className="t-strong">{n.instructionText}</span><span className="t-small c-muted">{n.publicReason}. {n.detail}</span></span>
                  <span className="t-data">{n.acknowledged ? 'Got it' : n.priority}</span>
                </button>
              ))}
            </div>
          )}
          {banner ? <Button variant="primary" size="l" block onClick={() => gotIt(banner.id)} testId="got-it">Got it</Button> : null}
          <div className="row">
            {push === 'on' ? <span className="t-small c-muted icon-text"><Bell size={14} />Alerts on</span>
              : push === 'off' && secureEnough() ? <Button variant="secondary" icon={<Bell size={16} />} onClick={() => void turnOnAlerts()}>Turn on alerts</Button>
              : <span className="t-small c-muted">Keep this page open for alerts{push === 'insecure' ? '; push needs the HTTPS link' : ''}.</span>}
            <Button variant="quiet" title={theme === 'day' ? 'Night chart' : 'Day chart'} icon={theme === 'day' ? <Moon size={18} /> : <Sun size={18} />} onClick={() => setThemeChoice(theme === 'day' ? 'night' : 'day')} />
          </div>
          <Simulated text="Your boat is simulated for this demo." />
          <Simulated text="Map data OpenStreetMap contributors" />
        </div>
      )}
      {urgent ? <Takeover n={urgent} theme={theme} you={vessel?.lonlat ?? null} data={data} onGotIt={() => gotIt(urgent.id)} /> : null}
    </div>
  );
}
