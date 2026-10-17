import { useState } from 'react';
import { Broadcast, Gauge, Moon, Pause, Play, QrCode, Scroll, Sun, Translate, Waves, WifiSlash, ClockCounterClockwise } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot } from '../../shared/protocol';
import { Button, Segmented } from '../ui';
import type { Link } from '../hub/useHub';
import { toward } from '../format';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

export function Sources(props: { snap: CommandSnapshot; link: Link }) {
  const ais = props.snap.sources.ais;
  const noaa = props.snap.sources.noaa;
  const lang = props.snap.sources.language;
  return (
    <div className="top-sources">
      {props.link !== 'online' ? <span className="src warn"><WifiSlash size={14} />Hub offline. Showing the last picture.</span> : null}
      <span className="src" title={ais.detail}><Broadcast size={14} />{ais.mode === 'live' ? `AIS live, ${ais.vessels} vessels` : ais.mode === 'replay' ? `AIS replay, ${ais.vessels} vessels` : 'AIS offline'}</span>
      <span className="src" title={noaa.detail}><Waves size={14} />{noaa.currentKn !== null ? `NOAA current ${noaa.currentKn.toFixed(1)} kn ${toward(noaa.towardDeg)}, predicted` : 'No current data'}</span>
      <span className="src" title={lang.detail}><Translate size={14} />{lang.source === 'granite' ? 'Granite wording, on this laptop' : 'Template wording'}</span>
    </div>
  );
}

export function Lockup() {
  return <span className="lockup"><span className="mark" /><span className="word">GIVE WAY</span></span>;
}

export function TopBar(props: {
  snap: CommandSnapshot; link: Link; send: Send; theme: 'night' | 'day'; onTheme: () => void;
  onOrders: () => void; onJoin: () => void; onNights: () => void;
}) {
  const { snap } = props;
  const [sceneOpen, setSceneOpen] = useState(false);
  return (
    <header className="cmd-top">
      <Lockup />
      <div className="top-clock" data-testid="clock">
        <span className="t-data">{snap.clock.label}</span>
        <span className="t-small c-muted">{snap.clock.night ? 'Night watch' : 'Day operations'}</span>
      </div>
      <Segmented compact value={snap.clock.timeScale} onChange={(v) => void props.send('clock', { timeScale: v })}
        options={[1, 10, 20, 60].map((v) => ({ value: v, label: `${v}x` }))} testId="time-scale" />
      <Button variant="quiet" title={snap.clock.paused ? 'Resume' : 'Pause'} icon={snap.clock.paused ? <Play size={16} /> : <Pause size={16} />}
        onClick={() => void props.send('clock', { paused: !snap.clock.paused })} />
      <div style={{ flex: 1 }} />
      <div className="top-actions">
        <div style={{ position: 'relative' }}>
          <Button variant="secondary" icon={<ClockCounterClockwise size={16} />} onClick={() => setSceneOpen(!sceneOpen)} testId="scene">Scene</Button>
          {sceneOpen ? (
            <div className="menu" style={{ right: 0, left: 'auto' }}>
              <button data-testid="reset-tuesday" onClick={() => { setSceneOpen(false); void props.send('reset', { mode: 'tuesday' }); }}><span>Tuesday, 09:00</span><span className="t-small">Ops desk: ships, divers, whales, on-time board</span></button>
              <button data-testid="reset-night" onClick={() => { setSceneOpen(false); void props.send('reset', { mode: 'night' }); }}><span>Night watch, 02:00</span><span className="t-small">Same harbor, ready for an unknown contact</span></button>
              <button onClick={() => { setSceneOpen(false); void props.send('reset', { mode: 'empty' }); }}><span>Empty harbor</span><span className="t-small">Only real AIS ships</span></button>
            </div>
          ) : null}
        </div>
        <Button variant="secondary" icon={<Scroll size={16} />} onClick={props.onOrders} testId="open-orders">Standing Orders</Button>
        <Button variant="secondary" icon={<QrCode size={16} />} onClick={props.onJoin} testId="open-join">Join phones</Button>
        <Button variant="secondary" icon={<Gauge size={16} />} onClick={props.onNights} testId="run-nights">Run 1,000 nights</Button>
        <Button variant="quiet" title={props.theme === 'night' ? 'Day chart' : 'Night chart'} icon={props.theme === 'night' ? <Sun size={16} /> : <Moon size={16} />} onClick={props.onTheme} />
      </div>
    </header>
  );
}
