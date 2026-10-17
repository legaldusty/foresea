import { useState } from 'react';
import { ArrowCounterClockwise, Bell, Broadcast, ChatText, DeviceMobile, Radio, Warning } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot, DeliveryRow, DeliveryState } from '../../shared/protocol';
import { DELIVERY_STATES } from '../../shared/protocol';
import { StepTrack } from '../ui';
import { clockOf, elapsed, signed } from '../format';
import { Sources } from './TopBar';
import type { Link } from '../hub/useHub';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

const STATE_WORD: Record<DeliveryState, string> = { sent: 'Sent', delivered: 'Delivered', seen: 'Seen', acknowledged: 'Acknowledged', complying: 'Complying' };
const ORDER = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;

function lastState(d: DeliveryRow): DeliveryState {
  let last: DeliveryState = 'sent';
  for (const s of DELIVERY_STATES) if (d.states[s] !== undefined) last = s;
  return last;
}

function channelIcon(ch: DeliveryRow['channel']) {
  switch (ch) {
    case 'app': return <DeviceMobile size={16} />;
    case 'push': return <Bell size={16} />;
    case 'sms': return <ChatText size={16} />;
    case 'vhf': return <Radio size={16} />;
    case 'ais': return <Broadcast size={16} />;
  }
}

const CHANNEL_WORD: Record<DeliveryRow['channel'], string> = { app: 'App', push: 'Push', sms: 'Text', vhf: 'VHF', ais: 'AIS' };

function Delivery(props: { snap: CommandSnapshot }) {
  const rows = props.snap.deliveries;
  const shown = [...rows].filter((d) => d.priority !== 'P4' || d.vesselId.startsWith('ais-') === false)
    .sort((a, b) => Number(b.notResponding) - Number(a.notResponding) || ORDER[a.priority] - ORDER[b.priority] || a.vesselName.localeCompare(b.vesselName));
  const mapOnly = rows.length - shown.length;
  const counts = DELIVERY_STATES.map((s) => [s, shown.filter((d) => d.states[s] !== undefined).length] as const);
  const now = props.snap.clock.simMin;
  return (
    <div className="board" data-testid="delivery-board">
      <div className="board-head">
        <span className="t-heading">Delivery</span>
        <span className="summary" data-testid="delivery-summary">{counts.map(([s, n]) => <span key={s}>{STATE_WORD[s]}<b>{n}</b></span>)}</span>
        <span className="meta">Phone replies are real. Other small craft replies are simulated.</span>
      </div>
      <div className="board-rows">
        {rows.length === 0 ? <div className="rail-empty">Nothing published. Every public notice waits for the officer's tap.</div> : null}
        {shown.map((d) => {
          const st = lastState(d);
          const since = d.states.sent ?? now;
          const at = d.notResponding ? now : d.states[st] ?? now;
          return (
            <div className="drow" key={`${d.noticeId}:${d.vesselId}`} data-testid={`delivery-${d.vesselId}`}>
              <span className="name" title={d.vesselName}>{d.vesselName}</span>
              <span className={`pri ${d.priority}`}>{d.priority}</span>
              <span className="chan">{channelIcon(d.channel)}{CHANNEL_WORD[d.channel]}</span>
              <StepTrack states={d.states} />
              {d.notResponding
                ? <span className="state warn" title="No reply. The VHF script is on the card."><Warning size={16} weight="bold" />No reply</span>
                : <span className="state">{STATE_WORD[st]}</span>}
              <span className="time">{elapsed(at - since)}</span>
            </div>
          );
        })}
        {mapOnly > 0 ? <div className="drow"><span className="name c-muted" style={{ gridColumn: '1 / 7', fontWeight: 400 }}>{mapOnly} more ships from AIS got it as P4, map only, by VHF and AIS marker</span></div> : null}
      </div>
    </div>
  );
}

function OnTime(props: { snap: CommandSnapshot }) {
  const rows = [...props.snap.onTime].sort((a, b) => {
    const rank = (s: string) => (s === 'late' ? 0 : s === 'at risk' ? 1 : s === 'on time' ? 2 : 3);
    return rank(a.status) - rank(b.status) || (a.source === 'simulated' ? -1 : 1);
  });
  return (
    <div className="board" data-testid="ontime-board">
      <div className="board-head">
        <span className="t-heading">On time</span>
        <span className="meta" style={{ order: 3 }}>Reported arrival against our route ETA</span>
        <span className="summary"><span>Real AIS<b>{rows.filter((r) => r.source !== 'simulated').length}</b></span><span>Simulated<b>{rows.filter((r) => r.source === 'simulated').length}</b></span></span>
      </div>
      <div className="board-rows">
        <div className="orow rowhead"><span className="name">Vessel</span><span>Planned</span><span>Ours</span><span className="delta">Delta</span><span className="status">Status</span></div>
        {rows.map((r) => (
          <div className="orow" key={r.id} title={r.why} data-testid={`ontime-${r.id}`}>
            <span className="name"><b>{r.name}</b><span className="src">{r.source === 'simulated' ? 'Simulated' : r.source === 'ais-live' ? 'AIS live' : 'AIS replay'}, {r.destination}</span></span>
            <span className="t-data">{r.plannedLabel}</span>
            <span className="t-data">{r.ourEtaLabel}</span>
            <span className="t-data delta">{signed(r.deltaMin)}</span>
            <span className={`status${r.status === 'at risk' ? ' risk' : r.status === 'late' ? ' late' : ''}`}>{r.status === 'on time' && (r.deltaMin ?? 0) > 0.5 ? 'still on time' : r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Log(props: { snap: CommandSnapshot; send: Send }) {
  return (
    <div className="board" data-testid="audit-log">
      <div className="board-rows">
        {props.snap.audit.map((a) => (
          <div className={`lrow${a.undone ? ' undone' : ''}`} key={a.id}>
            <span className="t-mono-small">{clockOf(a.atMin)}</span>
            <span className="actor">{a.actor === 'machine' ? 'GIVE WAY' : a.actor === 'officer' ? props.snap.officer : a.actor.replace(/^captain:/, 'Captain, ')}</span>
            <span className="act">{a.action}</span>
            <span>{a.detail}</span>
            {a.undoable && !a.undone ? <button className="undo" onClick={() => void props.send('undo', { auditId: a.id })}><ArrowCounterClockwise size={12} /> Undo</button> : <span />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MarineLog(props: { snap: CommandSnapshot }) {
  return (
    <div className="board">
      <div className="board-rows">
        {props.snap.marineLog.length === 0 ? <div className="rail-empty">No marine life logged yet. Every animal the sensors classify is logged here for researchers.</div> : null}
        {props.snap.marineLog.map((m) => (
          <div className="lrow" key={m.id}>
            <span className="t-mono-small">{clockOf(m.atMin)}</span>
            <span className="actor">{m.kind}</span>
            <span className="t-mono-small">{m.lonlat[1].toFixed(4)} N {Math.abs(m.lonlat[0]).toFixed(4)} W</span>
            <span>{m.detail}</span>
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BottomRail(props: { snap: CommandSnapshot; send: Send; link: Link }) {
  const [tab, setTab] = useState<'boards' | 'log' | 'marine'>('boards');
  return (
    <div className="cmd-bottom">
      <div className="bottom-head" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'boards'} onClick={() => setTab('boards')}>Delivery and on time</button>
        <button className="tab" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} data-testid="tab-log">Log<span className="t-data">{props.snap.audit.length}</span></button>
        <button className="tab" role="tab" aria-selected={tab === 'marine'} onClick={() => setTab('marine')}>Marine life<span className="t-data">{props.snap.marineLog.length}</span></button>
        <Sources snap={props.snap} link={props.link} />
      </div>
      {tab === 'boards' ? <div className="bottom-body"><Delivery snap={props.snap} /><OnTime snap={props.snap} /></div> : null}
      {tab === 'log' ? <div className="bottom-body single"><Log snap={props.snap} send={props.send} /></div> : null}
      {tab === 'marine' ? <div className="bottom-body single"><MarineLog snap={props.snap} /></div> : null}
    </div>
  );
}
