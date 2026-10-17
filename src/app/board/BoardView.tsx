import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle, Prohibit, Gauge, WifiSlash } from '@phosphor-icons/react';
import type { PublicBoard } from '../../shared/protocol';
import { ChartMap, EMPTY, type ChartData } from '../map/ChartMap';
import { silhouetteFor } from '../map/chartImages';
import { Lockup } from '../command/TopBar';
import '../../styles/board.css';
import { api } from '../hub/harbor';

const POLL_MS = 5000;

function boardChart(b: PublicBoard | null): ChartData {
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
  if (!b) return { zones: EMPTY, paths: EMPTY, routes: EMPTY, vessels: EMPTY, contacts: EMPTY, arrows: EMPTY, you: EMPTY, forecast: EMPTY, ticks: EMPTY, trails: EMPTY, sightings: EMPTY };
  return {
    zones: fc(b.notices.map((n) => ({ type: 'Feature', properties: { id: n.id, kind: n.kind, status: 'published', area: false }, geometry: { type: 'MultiPolygon', coordinates: n.rings } }))),
    vessels: fc(b.ships.map((s) => ({ type: 'Feature', properties: { id: s.id, type: silhouetteFor(s.type, null), heading: s.headingDeg, inZone: false, stale: false, scale: 0.9, bg: true }, geometry: { type: 'Point', coordinates: s.lonlat } }))),
    paths: EMPTY, routes: EMPTY, contacts: EMPTY, arrows: EMPTY, you: EMPTY, forecast: EMPTY, ticks: EMPTY, trails: EMPTY, sightings: EMPTY,
  };
}

export function BoardView() {
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [offline, setOffline] = useState(false);
  const [qr, setQr] = useState('');
  const theme: 'night' | 'day' = new URLSearchParams(location.search).get('theme') === 'night' ? 'night' : 'day';
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    let live = true;
    const load = () => fetch(api('/api/board.json')).then((r) => r.json() as Promise<PublicBoard>).then((b) => { if (live) { setBoard(b); setOffline(false); } }).catch(() => { if (live) setOffline(true); });
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!board?.link) return;
    void QRCode.toString(board.link, { type: 'svg', margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [board?.link]);
  const data = useMemo(() => boardChart(board), [board]);
  const fit = useMemo(() => {
    const pts = board?.notices.flatMap((n) => n.rings.flat(2)) ?? [];
    return pts.length > 2 ? pts.filter((_, i) => i % 6 === 0) : null;
  }, [board?.notices.map((n) => n.id).join(',')]);
  const notices = board?.notices ?? [];
  return (
    <div className="board" data-testid="board">
      <header className="board-top">
        <Lockup />
        <span className="board-title">Harbor notices</span>
        <span className="board-station">{board?.station ?? ''}</span>
        <span style={{ flex: 1 }} />
        {offline ? <span className="board-offline"><WifiSlash size={20} />Showing the last notices</span> : null}
        <span className="board-clock mono">{board?.clockLabel ?? ''}</span>
      </header>
      {board?.mode === 'sim' ? <div className="board-exercise">Exercise. These notices are simulated for a demonstration.</div> : null}
      <main className="board-main">
        <section className="board-map">
          <ChartMap theme={theme} data={data} compact interactive showLabels fitTo={fit} padding={{ top: 60, right: 60, bottom: 60, left: 60 }} />
        </section>
        <aside className="board-list">
          {notices.length ? notices.map((n) => (
            <article className={`board-notice ${n.kind}`} key={n.id} data-testid="board-notice">
              <div className="bn-head">
                {n.kind === 'keepOut' ? <Prohibit size={24} /> : <Gauge size={24} />}
                <span className="bn-reason">{n.label ?? n.publicReason}</span>
              </div>
              <span className="bn-instruction mono">{n.instructionText}{n.largeShipsOnly ? ', ships over 300 tons' : ''}</span>
              <span className="bn-meta">Near {n.place.replace(/^the /, 'the ')}. Until <span className="mono">{n.untilLabel}</span>.</span>
            </article>
          )) : (
            <div className="board-clear">
              <CheckCircle size={32} />
              <span className="bc-title">No notices in force</span>
              <span className="bc-meta">{board?.allClear.length ? `Last all clear ${board.allClear[board.allClear.length - 1].atLabel}.` : 'The harbor is open.'}</span>
            </div>
          )}
          <div className="board-join">
            {qr ? <span className="qr" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
            <div className="bj-text">
              <span className="bj-title">Get notices on your route, on your phone</span>
              <span className="bj-meta">Scan, pick your boat, tap Join. No app store, no account.</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
