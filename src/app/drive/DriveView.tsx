import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLineUp, HandPointing, Info, RocketLaunch, WifiSlash } from '@phosphor-icons/react';
import type { PilotSnapshot } from '../../shared/protocol';
import type { LonLat } from '../../engine/geo';
import { ChartMap, EMPTY, type ChartData } from '../map/ChartMap';
import { Button, Simulated } from '../ui';
import { Lockup } from '../command/TopBar';
import { usePilotHub } from './usePilotHub';
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

  const act = async (name: 'launch' | 'surface') => {
    setBusy(true);
    setError(null);
    const r = await hub.send(name, {});
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'That did not work. Try again.');
  };

  return (
    <div className="drive-page" data-testid="drive">
      <header className="drive-head">
        <Lockup />
        <span className="drive-link" data-testid="drive-link">{online ? 'Connected' : hub.link === 'connecting' ? 'Connecting' : 'Offline'}</span>
      </header>
      <p className="drive-intro">You are the unknown drone. Pick a target and steer. The harbor only sees how you move.</p>
      {!online && hub.link !== 'connecting' ? <Notice icon={<WifiSlash size={20} />} testId="drive-offline">The hub is offline. Reconnecting.</Notice> : null}
      {live ? <Notice icon={<Info size={20} />} testId="drive-live">The desk is in Live mode. Ask the desk to switch to Simulation.</Notice> : null}
      {error && !live ? <Notice icon={<Info size={20} />} testId="drive-error">{error}</Notice> : null}
      <div className="drive-map" data-driving={driving ? 'yes' : 'no'}>
        <ChartMap theme={theme} compact showLabels data={data} mode={driving ? 'drive' : 'select'} onPointer={driving ? hub.steer : undefined} fitTo={fit} padding={MAP_PADDING} stamp={snap?.clock.wallMs} motionDelayMs={600} />
        <span className="drive-attr">© OpenStreetMap contributors</span>
      </div>
      <footer className="drive-foot">
        {drone && !live ? (
          <>
            <div className="drive-status" data-testid="drive-status">
              <HandPointing size={20} />
              <span>Touch and drag on the chart to steer. <span className="num">{drone.speedKn.toFixed(1)}</span> kn</span>
              <Simulated />
            </div>
            <Button variant="secondary" size="l" block icon={<ArrowLineUp size={20} />} onClick={() => void act('surface')} disabled={busy || !online} testId="drive-surface">Surface</Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="l" block icon={<RocketLaunch size={20} />} onClick={() => void act('launch')} disabled={busy || !online || live || !snap} testId="drive-launch">Launch at Angels Gate</Button>
            <span className="drive-small">A simulated drone appears outside Angels Gate. Nothing here touches a real boat.</span>
          </>
        )}
      </footer>
    </div>
  );
}
