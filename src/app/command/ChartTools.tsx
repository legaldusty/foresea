import { useState } from 'react';
import { CaretDown, Crane, Cursor, Fish, Joystick, PersonSimpleSwim, Plus, Stop, WifiSlash } from '@phosphor-icons/react';
import type { CommandEvents, ContactView } from '../../shared/protocol';
import { Button } from '../ui';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;
export type Tool = 'select' | 'drive' | 'whale' | 'divers' | 'dredge';

const INCIDENTS = [
  { key: 'A', name: 'The straight shot', detail: '2.5 m, silent, night. Angels Gate to the Fuel Pier' },
  { key: 'B', name: 'The fake-out', detail: '1.5 m. Fakes toward the Oil Islands, turns for the Cruise Terminal' },
  { key: 'C', name: 'The lost glider', detail: 'Registered, silent, cold, drifting with the current' },
  { key: 'D', name: 'The tiny drone', detail: '0.4 m, daytime, to the Research Dock' },
  { key: 'E', name: 'Late detection', detail: '5 m at 3.5 m/s, first seen minutes from Pier 400' },
];

export function ChartTools(props: { tool: Tool; setTool: (t: Tool) => void; send: Send; driven: ContactView | null }) {
  const [open, setOpen] = useState(false);
  const spawn = (payload: CommandEvents['spawn']) => { setOpen(false); void props.send('spawn', payload); };
  const pick = (t: Tool) => {
    if (t === 'drive' && !props.driven) void props.send('spawn', { preset: 'driven' });
    props.setTool(props.tool === t ? 'select' : t);
  };
  return (
    <div className="tools">
      <div className="toolbar" role="toolbar" aria-label="Chart tools">
        <button aria-pressed={props.tool === 'select'} onClick={() => props.setTool('select')} data-testid="tool-select"><Cursor size={16} />Select</button>
        <button aria-pressed={props.tool === 'drive'} onClick={() => pick('drive')} data-testid="tool-drive"><Joystick size={16} />Drive</button>
        <button aria-pressed={props.tool === 'whale'} onClick={() => pick('whale')} data-testid="tool-whale"><Fish size={16} />Whale zone</button>
        <button aria-pressed={props.tool === 'divers'} onClick={() => pick('divers')} data-testid="tool-divers"><PersonSimpleSwim size={16} />Divers zone</button>
        <button aria-pressed={props.tool === 'dredge'} onClick={() => pick('dredge')} data-testid="tool-dredge"><Crane size={16} />Dredge zone</button>
      </div>
      <div style={{ position: 'relative' }}>
        <div className="toolbar"><button onClick={() => setOpen(!open)} data-testid="add-contact"><Plus size={16} />Add contact<CaretDown size={14} /></button></div>
        {open ? (
          <div className="menu">
            <div className="menu-head">Simulated sensor contacts</div>
            <button onClick={() => { spawn({ preset: 'driven' }); props.setTool('drive'); }} data-testid="spawn-driven"><span>Unknown contact to drive</span><span className="t-small">Appears outside Angels Gate. Move the mouse to steer.</span></button>
            <button onClick={() => spawn({ preset: 'bot' })}><span>Bot intruder</span><span className="t-small">Picks a target and a style on its own</span></button>
            <button onClick={() => spawn({ preset: 'pair' })} data-testid="spawn-pair"><span>Coordinated pair</span><span className="t-small">Two small unknowns from both gates, for the Fuel Pier and the Oil Islands</span></button>
            {INCIDENTS.map((i) => (
              <button key={i.key} onClick={() => spawn({ preset: 'scenario', scenarioKey: i.key })} data-testid={`incident-${i.key}`}><span>Incident {i.key}: {i.name}</span><span className="t-small">{i.detail}</span></button>
            ))}
            <button onClick={() => spawn({ preset: 'glider' })} data-testid="spawn-glider"><span>Lost glider</span><span className="t-small">AltaSea Glider 3, silent, drifting with the NOAA current</span></button>
            <button onClick={() => spawn({ preset: 'whale' })}><span>Whale</span><span className="t-small">Warm, 18 m, erratic, surfacing</span></button>
            <button onClick={() => spawn({ preset: 'diver' })}><span>Diver</span><span className="t-small">Warm, 2 m, slow, near the Cruise Terminal</span></button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DriveControl(props: { c: ContactView; send: Send; onStop: () => void }) {
  const c = props.c;
  return (
    <div className="drive" data-testid="drive-control">
      <div className="what">
        <span className="t-strong">Driving {c.label}</span>
        <span className="hint">Move the mouse over the water. It steers there at {c.speedMps.toFixed(1)} m/s. {c.sizeM.toFixed(1)} m, hot motor.</span>
      </div>
      <Button variant="secondary" icon={<WifiSlash size={16} />} onClick={() => void props.send('sensorLoss', { contactId: c.id, silent: !c.silent })}>{c.silent ? 'Sensor back' : 'Sensor lost'}</Button>
      <Button variant="secondary" icon={<Stop size={16} />} onClick={props.onStop}>Stop</Button>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend-wrap">
      <div className="legend">
        <span className="key"><i className="sw keepout" />Keep-out zone</span>
        <span className="key"><i className="sw slow" />Slow zone</span>
        <span className="key"><i className="sw path" />Predicted path</span>
        <span className="key"><i className="sw route" />New route</span>
        <span className="note" title="Breakwaters in the engine grid are hand placed and approximate">Simulated: sensor contacts and small craft</span>
      </div>
      <span className="attr">Map data: OpenStreetMap contributors</span>
    </div>
  );
}
