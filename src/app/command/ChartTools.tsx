import { useEffect, useState } from 'react';
import {
  Binoculars, CaretDown, ClipboardText, Crane, DotsSixVertical, Eye, EyeSlash, Fish, Gauge, Joystick, ListDashes, Moon, Pause, Play, PersonSimpleSwim, Polygon, Prohibit, ProjectorScreen, Stop, Sun, WifiSlash, X,
} from '@phosphor-icons/react';
import type { CommandEvents, ContactView, Species } from '../../shared/protocol';
import { Button, Field, Segmented, SelectBox, Simulated } from '../ui';
import { usePersisted } from './resize';
import { ViewLinks } from '../ui/Views';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;
export type ZoneKind = 'whale' | 'divers' | 'dredge' | 'closure' | 'slow';
export type Tool = 'select' | 'drive' | ZoneKind | `sighting:${Species}` | 'dive';

const INCIDENTS = [
  { key: 'A', name: 'The straight shot', detail: '2.5 m, silent, night. Angels Gate to the Fuel Pier' },
  { key: 'B', name: 'The fake-out', detail: '1.5 m. Fakes toward the Oil Islands, turns for the Cruise Terminal' },
  { key: 'C', name: 'The lost glider', detail: 'Registered, silent, cold, drifting with the current' },
  { key: 'D', name: 'The tiny drone', detail: '0.4 m, daytime, to the Research Dock' },
  { key: 'E', name: 'Late detection', detail: '5 m at 3.5 m/s, first seen minutes from Pier 400' },
];

const ZONES: { kind: ZoneKind; label: string; detail: string; icon: JSX.Element }[] = [
  { kind: 'slow', label: 'Slow zone', detail: 'Boats slow down here. No reason needed', icon: <Gauge size={16} /> },
  { kind: 'whale', label: 'Whale', detail: 'Slow zone around a sighting', icon: <Fish size={16} /> },
  { kind: 'divers', label: 'Divers', detail: 'Keep clear of divers in the water', icon: <PersonSimpleSwim size={16} /> },
  { kind: 'dredge', label: 'Dredge', detail: 'Keep clear of a work zone', icon: <Crane size={16} /> },
  { kind: 'closure', label: 'Closure', detail: 'Close a small area to all boats', icon: <Prohibit size={16} /> },
];

const SPECIES: { value: Species; label: string }[] = [
  { value: 'whale', label: 'Whale' }, { value: 'dolphin', label: 'Dolphin' }, { value: 'sea lion', label: 'Sea lion' },
  { value: 'debris', label: 'Debris' }, { value: 'hazard', label: 'Other hazard' },
];

export function DeskTools(props: { tool: Tool; setTool: (t: Tool) => void; onDivePlans: () => void }) {
  const [menu, setMenu] = useState<'zone' | 'sighting' | null>(null);
  const choose = (t: Tool) => { setMenu(null); props.setTool(props.tool === t ? 'select' : t); };
  const zoneTool = ZONES.find((z) => z.kind === props.tool);
  const sightingTool = props.tool.startsWith('sighting:');
  return (
    <div className="desk-tools" role="toolbar" aria-label="Desk tools">
      <div className="tool-anchor">
        <button className="tool" aria-pressed={!!zoneTool} onClick={() => setMenu(menu === 'zone' ? null : 'zone')} data-testid="new-zone"><Polygon size={16} />{zoneTool ? `New zone: ${zoneTool.label.toLowerCase()}` : 'New zone'}<CaretDown size={16} /></button>
        {menu === 'zone' ? (
          <div className="menu">
            {ZONES.map((z) => <button key={z.kind} onClick={() => choose(z.kind)} data-testid={`tool-${z.kind}`}><span className="row">{z.icon}{z.label}</span><span className="t-small">{z.detail}</span></button>)}
          </div>
        ) : null}
      </div>
      <div className="tool-anchor">
        <button className="tool" aria-pressed={sightingTool} onClick={() => setMenu(menu === 'sighting' ? null : 'sighting')} data-testid="report-sighting"><Binoculars size={16} />Report sighting</button>
        {menu === 'sighting' ? (
          <div className="menu">
            {SPECIES.map((sp) => <button key={sp.value} onClick={() => choose(`sighting:${sp.value}`)} data-testid={`sight-${sp.value.replace(' ', '-')}`}><span>{sp.label}</span><span className="t-small">Then click where it was seen</span></button>)}
          </div>
        ) : null}
      </div>
      <button className="tool" onClick={props.onDivePlans} data-testid="dive-plans"><ClipboardText size={16} />Dive plans</button>
      {props.tool !== 'select' && props.tool !== 'drive' ? <span className="tool-hint">Click the chart to place it. <button className="link" onClick={() => props.setTool('select')}>Cancel</button></span> : null}
    </div>
  );
}

export type LayerKey = 'forecast' | 'zones' | 'sightings' | 'routes' | 'ais' | 'boats' | 'labels' | 'callouts';
export const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'forecast', label: 'Forecast areas and time marks' },
  { key: 'zones', label: 'Zones and notices' },
  { key: 'sightings', label: 'Marine life and debris sightings' },
  { key: 'routes', label: 'Boat routes and new plans' },
  { key: 'ais', label: 'Real ships from AIS' },
  { key: 'boats', label: 'Simulated boats' },
  { key: 'labels', label: 'Names on the chart' },
  { key: 'callouts', label: 'Boat callouts' },
];

export function ChartCorner(props: { onPresenter: () => void; presenterOpen: boolean; hidden: Set<LayerKey>; onLayer: (k: LayerKey) => void }) {
  const [keyOpen, setKeyOpen] = useState(false);
  return (
    <div className="chart-corner">
      {keyOpen ? (
        <div className="chart-key" data-testid="chart-key">
          <span className="t-heading">Layers</span>
          {LAYERS.map((l) => {
            const on = !props.hidden.has(l.key);
            return (
              <button key={l.key} className="layer-row" aria-pressed={on} onClick={() => props.onLayer(l.key)} data-testid={`layer-${l.key}`}>
                {on ? <Eye size={16} /> : <EyeSlash size={16} />}<span>{l.label}</span>
              </button>
            );
          })}
          <span className="t-heading key-title">Key</span>
          <span className="key"><i className="sw careful" />Be careful: at least 1 in 8 futures pass here</span>
          <span className="key"><i className="sw likely" />Where it is going: half of the futures stay inside</span>
          <span className="key"><i className="sw mark" />Where it should be at that time</span>
          <span className="key"><i className="sw drone" />Unknown drone, colored by risk</span>
          <span className="key"><i className="sw zone" />Published zone for boats</span>
          <span className="key"><i className="sw route" />New plan for a boat</span>
          <span className="note">Simulated: sensor contacts and small craft</span>
        </div>
      ) : null}
      <div className="corner-row">
        <button className="corner-btn" aria-pressed={props.presenterOpen} onClick={props.onPresenter} title="Presenter (P)" data-testid="presenter"><ProjectorScreen size={16} /><span className="t-mono-small">P</span></button>
        <button className="corner-btn" aria-pressed={keyOpen} onClick={() => setKeyOpen(!keyOpen)} data-testid="key-toggle"><ListDashes size={16} />Key</button>
      </div>
    </div>
  );
}

export function Presenter(props: {
  open: boolean; onClose: () => void; send: Send; timeScale: number; paused: boolean; focus: ContactView | null; driven: ContactView | null;
  tool: Tool; setTool: (t: Tool) => void; theme: 'night' | 'day'; onTheme: () => void; onNights: () => void;
}) {
  const spawn = (payload: CommandEvents['spawn']) => void props.send('spawn', payload);
  const [pos, setPos] = usePersisted<{ x: number; y: number } | null>('giveway.presenter.pos', null);
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const panel = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx));
      const y = Math.max(48, Math.min(window.innerHeight - 120, ev.clientY - dy));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
      setPos({ x: Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx)), y: Math.max(48, Math.min(window.innerHeight - 120, ev.clientY - dy)) });
    };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && props.open) props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open]);
  if (!props.open) return null;
  return (
    <aside className={`presenter${pos ? ' floating' : ''}`} data-testid="presenter-panel" style={pos ? { left: pos.x, top: Math.min(pos.y, window.innerHeight - 200), maxHeight: window.innerHeight - Math.min(pos.y, window.innerHeight - 200) - 16 } : undefined}>
      <div className="presenter-head" onPointerDown={startDrag} onDoubleClick={() => setPos(null)} title="Drag to move. Double-click to dock."><span className="t-heading"><DotsSixVertical size={16} className="grip-dots" />Presenter</span><span className="t-small c-muted">Demo controls, not part of the product</span><button className="icon-btn" onClick={props.onClose} aria-label="Close"><X size={16} /></button></div>
      <section>
        <span className="sec">Scene</span>
        <div className="row-btns">
          <Button variant="secondary" onClick={() => void props.send('reset', { mode: 'tuesday' })} testId="reset-tuesday">Tuesday</Button>
          <Button variant="secondary" onClick={() => void props.send('reset', { mode: 'night' })} testId="reset-night">Night</Button>
          <Button variant="secondary" onClick={() => void props.send('reset', { mode: 'empty' })} testId="reset-empty">Empty harbor</Button>
        </div>
      </section>
      <section>
        <span className="sec">Open a view</span>
        <ViewLinks exclude="desk" />
      </section>
      <section>
        <span className="sec">Time</span>
        <div className="row-btns">
          <Segmented compact value={props.timeScale} onChange={(v) => void props.send('clock', { timeScale: v })} options={[1, 10, 20, 60].map((v) => ({ value: v, label: `${v}x` }))} testId="time-scale" />
          <Button variant="secondary" icon={props.paused ? <Play size={16} /> : <Pause size={16} />} onClick={() => void props.send('clock', { paused: !props.paused })} testId="pause">{props.paused ? 'Resume' : 'Pause'}</Button>
        </div>
      </section>
      <section>
        <span className="sec">Add contact</span>
        <div className="preset-list">
          <button onClick={() => { if (!props.driven) spawn({ preset: 'driven' }); props.setTool('drive'); }} data-testid="spawn-driven"><Joystick size={16} /><span>Drone to drive</span><span className="t-small">Appears outside Angels Gate. Drag on the chart to steer.</span></button>
          {INCIDENTS.map((i) => <button key={i.key} onClick={() => spawn({ preset: 'scenario', scenarioKey: i.key })} data-testid={`incident-${i.key}`}><span className="t-mono-small">{i.key}</span><span>{i.name}</span><span className="t-small">{i.detail}</span></button>)}
          <button onClick={() => spawn({ preset: 'bot' })} data-testid="spawn-bot"><span /><span>Bot intruder</span><span className="t-small">Picks a target and a style on its own</span></button>
          <button onClick={() => spawn({ preset: 'pair' })} data-testid="spawn-pair"><span /><span>Coordinated pair</span><span className="t-small">Two unknowns from both gates</span></button>
          <button onClick={() => spawn({ preset: 'glider' })} data-testid="spawn-glider"><span /><span>Lost glider</span><span className="t-small">AltaSea Glider 3, drifting with the NOAA current</span></button>
          <button onClick={() => spawn({ preset: 'friendly' })} data-testid="spawn-friendly"><span /><span>Friendly hull robot</span><span className="t-small">Registered, answers its ID ping</span></button>
          <button onClick={() => spawn({ preset: 'whale' })} data-testid="spawn-whale"><span /><span>Whale</span><span className="t-small">Warm, 18 m, erratic</span></button>
          <button onClick={() => spawn({ preset: 'diver' })} data-testid="spawn-diver"><span /><span>Diver</span><span className="t-small">Warm, 2 m, slow</span></button>
        </div>
      </section>
      <section>
        <span className="sec">Contact</span>
        <div className="row-btns">
          <Button variant="secondary" icon={<Joystick size={16} />} onClick={() => props.setTool(props.tool === 'drive' ? 'select' : 'drive')} testId="tool-drive">{props.tool === 'drive' ? 'Stop driving' : 'Drive'}</Button>
          <Button variant="secondary" icon={<WifiSlash size={16} />} onClick={() => props.focus && void props.send('sensorLoss', { contactId: props.focus.id, silent: !props.focus.silent })} testId="sensor-lost">{props.focus?.silent ? 'Sensor back' : 'Sensor lost'}</Button>
        </div>
      </section>
      <section>
        <span className="sec">Show</span>
        <div className="row-btns">
          <Button variant="secondary" icon={props.theme === 'night' ? <Sun size={16} /> : <Moon size={16} />} onClick={props.onTheme} testId="theme">{props.theme === 'night' ? 'Day chart' : 'Night chart'}</Button>
          <Button variant="secondary" icon={<Gauge size={16} />} onClick={props.onNights} testId="run-nights">Run 1,000 nights</Button>
        </div>
      </section>
    </aside>
  );
}

const SIZES = [0.4, 1.0, 1.5, 1.9, 2.5, 4.0, 5.0, 7.0];
const SPEEDS = [0.5, 1.0, 1.6, 2.0, 2.5, 3.5];

export function DriveControl(props: { c: ContactView; send: Send; onStop: () => void }) {
  const c = props.c;
  const sizes = [...new Set([...SIZES, Number(c.sizeM.toFixed(1))])].sort((a, b) => a - b);
  const speeds = [...new Set([...SPEEDS, Number(c.speedMps.toFixed(1))])].sort((a, b) => a - b);
  return (
    <div className="drive" data-testid="drive-control">
      <div className="drive-title"><span className="t-heading">Driving {c.label}</span><Simulated /></div>
      <div className="drive-fields">
        <Field label="Size"><SelectBox value={Number(c.sizeM.toFixed(1))} options={sizes.map((v) => ({ value: v, label: `${v.toFixed(1)} m` }))} onChange={(v) => void props.send('contactParams', { contactId: c.id, sizeM: v })} /></Field>
        <Field label="Speed"><SelectBox value={Number(c.speedMps.toFixed(1))} options={speeds.map((v) => ({ value: v, label: `${v.toFixed(1)} m/s` }))} onChange={(v) => void props.send('contactParams', { contactId: c.id, speedMps: v })} /></Field>
      </div>
      <span className="t-small c-muted">Drag on the chart to steer.</span>
      <Button variant="secondary" block icon={<Stop size={16} />} onClick={props.onStop}>Stop</Button>
    </div>
  );
}
