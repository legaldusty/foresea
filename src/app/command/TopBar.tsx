import { useState } from 'react';
import { Broadcast, ClockCounterClockwise, FileText, Gauge, Moon, Pause, Play, QrCode, Scroll, Sun, UserCircle, Waves, WifiSlash } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot } from '../../shared/protocol';
import { Button, Segmented } from '../ui';
import type { Link } from '../hub/useHub';
import { compassAbbr } from '../format';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

export function Lockup() {
  return <span className="lockup"><span className="mark" /><span className="word">GIVE WAY</span></span>;
}

export function TopBar(props: { snap: CommandSnapshot; send: Send; onOrders: () => void; onJoin: () => void; onNights: () => void }) {
  const { snap } = props;
  return (
    <header className="cmd-top">
      <Lockup />
      <span className="vdiv" />
      <div className="top-clock" data-testid="clock">
        <span className="t-data">{snap.clock.label}</span>
        <span className="t-small c-muted">{snap.clock.night ? 'Night watch' : 'Tuesday'}</span>
      </div>
      <Segmented compact value={snap.clock.timeScale} onChange={(v) => void props.send('clock', { timeScale: v })}
        options={[1, 10, 20, 60].map((v) => ({ value: v, label: `${v}x` }))} testId="time-scale" />
      <Button variant="secondary" icon={snap.clock.paused ? <Play size={16} /> : <Pause size={16} />} onClick={() => void props.send('clock', { paused: !snap.clock.paused })}>{snap.clock.paused ? 'Resume' : 'Pause'}</Button>
      <span style={{ flex: 1 }} />
      <span className="top-officer"><UserCircle size={20} />{snap.officer}</span>
      <span className="vdiv" />
      <div className="top-actions">
        <Button variant="secondary" icon={<Scroll size={16} />} onClick={props.onOrders} testId="open-orders">Standing Orders</Button>
        <Button variant="secondary" icon={<QrCode size={16} />} onClick={props.onJoin} testId="open-join">Join phones</Button>
        <Button variant="secondary" icon={<Gauge size={16} />} onClick={props.onNights} testId="run-nights">Run 1,000 nights</Button>
      </div>
    </header>
  );
}

export function DataLine(props: { snap: CommandSnapshot; link: Link; send: Send; theme: 'night' | 'day'; onTheme: () => void }) {
  const { snap } = props;
  const [sceneOpen, setSceneOpen] = useState(false);
  const ais = snap.sources.ais;
  const noaa = snap.sources.noaa;
  const lang = snap.sources.language;
  return (
    <div className="cmd-data">
      {props.link !== 'online' ? <span className="src warn"><WifiSlash size={16} />Hub offline. Showing the last picture.</span> : null}
      <span className="src" title={ais.detail}><Broadcast size={16} />{ais.mode === 'live' ? `AIS live, ${ais.vessels} vessels` : ais.mode === 'replay' ? `AIS replay, ${ais.vessels} vessels` : 'AIS offline'}</span>
      <span className="src" title={noaa.detail}><Waves size={16} />{noaa.currentKn !== null ? <>Current: predicted <span className="t-mono-small">{noaa.currentKn.toFixed(1)}</span> kn toward {compassAbbr(noaa.towardDeg)} (NOAA Queens Gate)</> : 'Current: no data'}</span>
      <span className="src" title={lang.detail}><FileText size={16} />{lang.source === 'granite' ? 'Wording: Granite on this laptop' : 'Wording: templates'}</span>
      <span style={{ flex: 1 }} />
      <div style={{ position: 'relative' }}>
        <button className="data-btn" onClick={() => setSceneOpen(!sceneOpen)} data-testid="scene"><ClockCounterClockwise size={14} />Scene</button>
        {sceneOpen ? (
          <div className="menu" style={{ right: 0, left: 'auto', top: 28 }}>
            <button data-testid="reset-tuesday" onClick={() => { setSceneOpen(false); void props.send('reset', { mode: 'tuesday' }); }}><span>Tuesday, 09:00</span><span className="t-small">Ops desk: ships, divers, whales, on-time board</span></button>
            <button data-testid="reset-night" onClick={() => { setSceneOpen(false); void props.send('reset', { mode: 'night' }); }}><span>Night watch, 02:00</span><span className="t-small">Same harbor, ready for an unknown contact</span></button>
            <button onClick={() => { setSceneOpen(false); void props.send('reset', { mode: 'empty' }); }}><span>Empty harbor</span><span className="t-small">Only real AIS ships</span></button>
          </div>
        ) : null}
      </div>
      <button className="data-btn" onClick={props.onTheme} title={props.theme === 'night' ? 'Day chart' : 'Night chart'}>{props.theme === 'night' ? <Sun size={14} /> : <Moon size={14} />}{props.theme === 'night' ? 'Day' : 'Night'}</button>
    </div>
  );
}
