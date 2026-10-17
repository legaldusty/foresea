import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLineUp, HandPointing, Info, Moon, RocketLaunch, WifiSlash } from '@phosphor-icons/react';
import type { PilotSnapshot } from '../../shared/protocol';
import type { LonLat } from '../../engine/geo';
import { ChartMap, EMPTY, type ChartData } from '../map/ChartMap';
import { Button, Simulated } from '../ui';
import { Lockup } from '../command/TopBar';
import { usePilotHub } from './usePilotHub';
import { ViewsMenu } from '../ui/Views';
import '../../styles/drive.css';

type F = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

const MAP_PADDING = { top: 32, right: 96, bottom: 32, left: 32 };
const fc = (features: F[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (coordinates: LonLat[], properties: Record<string, unknown>): F => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });
const point = (coordinates: LonLat, properties: Record<string, unknown>): F => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });

function driveChart(s: PilotSnapshot | null): ChartData {
  const drone = s?.drone ?? null;
  const paths: F[] = drone && drone.track.length > 1 ? [line([...drone.track, drone.lonlat], { kind: 'track' })] : [];
  const routes: F[] = drone?.steerTo ? [line([drone.lonlat, drone.steerTo], { kind: 'planned', id: 'steer' })] : [];
  const contacts: F[] = drone ? [point(drone.lonlat, { id: drone.id, state: 'unknown', selected: true, heading: drone.headingDeg, symbol: 'drone-unknown' })] : [];
  const targets: F[] = (s?.targets ?? []).map((t) => point(t.lonlat, { id: `target-${t.id}`, label: '' }));
  return { zones: EMPTY, paths: fc(paths), routes: fc(routes), vessels: EMPTY, contacts: fc(contacts), arrows: EMPTY, you: EMPTY, forecast: EMPTY, ticks: fc(targets), trails: EMPTY, sightings: EMPTY };
}

function Notice(props: { icon: ReactNode; children: ReactNode; testId: string }) {
  return <div className="drive-notice" data-testid={props.testId}>{props.icon}<span>{props.children}</span></div>;
}

const ORDER = ['fuel', 'cruise', 'pier400', 'islands', 'ferry', 'research'];

function near(a: LonLat | null | undefined, b: LonLat): boolean {
  return !!a && Math.abs(a[0] - b[0]) < 0.0012 && Math.abs(a[1] - b[1]) < 0.0012;
}

export function DriveView() {
  const hub = usePilotHub();
  const snap = hub.snapshot;
  const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = snap?.mode === 'live';
  const online = hub.link === 'online';
  const drone = snap?.drone ?? null;
  const driving = !!drone && !live && online;
  const data = useMemo(() => driveChart(snap), [snap]);
  const fit = useMemo<LonLat[] | null>(() => (snap ? [snap.launch.lonlat, ...snap.targets.map((t) => t.lonlat)] : null), [snap ? 'ready' : 'waiting']);
  const targets = useMemo(() => [...(snap?.targets ?? [])].sort((a, b) => (ORDER.indexOf(a.id) + 99) % 99 - (ORDER.indexOf(b.id) + 99) % 99), [snap?.targets.map((t) => t.id).join(',')]);

  const act = async (name: 'launch' | 'surface' | 'night') => {
    setBusy(true);
    setError(null);
    const r = await hub.send(name, {});
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'That did not work. Try again.');
  };
  const headFor = (lonlat: LonLat) => { setError(null); hub.steer(lonlat); };

  return (
    <div className="drive-page" data-testid="drive">
      <header className="drive-head">
        <Lockup />
        <span className="drive-link" data-testid="drive-link">{online ? 'Connected' : hub.link === 'connecting' ? 'Connecting' : 'Offline'}</span>
        <ViewsMenu current="drive" />
      </header>
      <div className="drive-intro">
        <span className="t-title">Drive the drone</span>
        <span className="t-body c-muted">You are the unknown drone. Pick where to go. The harbor desk only sees how you move and tries to call your target before you get there.</span>
      </div>
      {!online && hub.link !== 'connecting' ? <Notice icon={<WifiSlash size={20} />} testId="drive-offline">The hub is offline. Reconnecting.</Notice> : null}
      {error ? <Notice icon={<Info size={20} />} testId="drive-error">{error}</Notice> : null}
      <div className="drive-map" data-driving={driving ? 'yes' : 'no'}>
        <ChartMap theme={theme} compact showLabels data={data} mode={driving ? 'drive' : 'select'} onPointer={driving ? hub.steer : undefined} fitTo={fit} padding={MAP_PADDING} stamp={snap?.clock.wallMs} motionDelayMs={600} />
        <span className="drive-attr">© OpenStreetMap contributors</span>
      </div>
      <footer className="drive-foot">
        {live ? (
          <>
            <div className="drive-status" data-testid="drive-live"><Info size={20} /><span>The harbor is showing real ships right now. Start a simulated night to drive.</span></div>
            <Button variant="primary" size="l" block icon={<Moon size={20} />} onClick={() => void act('night')} disabled={busy || !online} testId="drive-night">Start a night scene</Button>
            <span className="drive-small">This switches the harbor desk to a simulated night at Angels Gate.</span>
          </>
        ) : drone ? (
          <>
            <div className="drive-row">
              <span className="t-heading">Head for</span>
              <span className="drive-speed" data-testid="drive-status"><span className="num">{drone.speedKn.toFixed(1)}</span> kn <Simulated /></span>
            </div>
            <div className="drive-targets" data-testid="drive-targets">
              {targets.map((t) => (
                <Button key={t.id} variant={near(drone.steerTo, t.lonlat) ? 'primary' : 'secondary'} size="l" onClick={() => headFor(t.lonlat)} disabled={!online} testId={`drive-to-${t.id}`}>{t.name}</Button>
              ))}
            </div>
            <span className="drive-small"><HandPointing size={16} />Or tap anywhere on the chart to go there.</span>
            <Button variant="quiet" size="l" block icon={<ArrowLineUp size={20} />} onClick={() => void act('surface')} disabled={busy || !online} testId="drive-surface">Surface and end the run</Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="l" block icon={<RocketLaunch size={20} />} onClick={() => void act('launch')} disabled={busy || !online || !snap} testId="drive-launch">Launch at Angels Gate</Button>
            <span className="drive-small">A simulated drone appears outside Angels Gate. Nothing here touches a real boat.</span>
          </>
        )}
      </footer>
    </div>
  );
}
