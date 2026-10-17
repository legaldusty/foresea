import { useState } from 'react';
import { ArrowCounterClockwise, Bell, Broadcast, ChatText, DeviceMobile, Radio, Warning } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot, DeliveryRow, DeliveryState, Priority } from '../../shared/protocol';
import { DELIVERY_STATES } from '../../shared/protocol';
import { StepTrack } from '../ui';
import { clockOf, signed } from '../format';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

const STATE_WORD: Record<DeliveryState, string> = { sent: 'Sent', delivered: 'Delivered', seen: 'Seen', acknowledged: 'Acknowledged', complying: 'Complying' };
const ORDER: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

function lastState(d: DeliveryRow): DeliveryState {
  let last: DeliveryState = 'sent';
  for (const s of DELIVERY_STATES) if (d.states[s] !== undefined) last = s;
  return last;
}

function ChannelIcon(props: { ch: DeliveryRow['channel'] }) {
  switch (props.ch) {
    case 'app': return <DeviceMobile size={16} />;
    case 'push': return <Bell size={16} />;
    case 'sms': return <ChatText size={16} />;
    case 'vhf': return <Radio size={16} />;
    case 'ais': return <Broadcast size={16} />;
  }
}

const CHANNEL_WORD: Record<DeliveryRow['channel'], string> = { app: 'App', push: 'Push', sms: 'Text', vhf: 'VHF', ais: 'AIS' };

function Delivery(props: { snap: CommandSnapshot }) {
  const { snap } = props;
  const rows = snap.deliveries;
  const shown = rows.filter((d) => d.priority !== 'P4' || !d.vesselId.startsWith('ais-'))
    .sort((a, b) => Number(b.notResponding) - Number(a.notResponding) || ORDER[a.priority] - ORDER[b.priority] || a.vesselName.localeCompare(b.vesselName));
  const mapOnly = rows.length - shown.length;
  const draft = snap.drafts[0] ?? null;
  const counts = DELIVERY_STATES.map((s) => [s, shown.filter((d) => d.states[s] !== undefined).length] as const);
  return (
    <div className="board" data-testid="delivery-board">
      <div className="board-title">
        <span className="t-strong">Delivery</span>
        {rows.length ? (
          <span className="summary" data-testid="delivery-summary">{counts.map(([s, n]) => <span key={s}>{STATE_WORD[s]} <span className="t-mono-small">{n}</span></span>)}</span>
        ) : draft ? (
          <span className="summary">Not sent yet. The draft goes to {snap.vessels.length} boats; {draft.plan.boats.length} {draft.plan.boats.length === 1 ? 'is' : 'are'} in its path.</span>
        ) : <span className="summary">Nothing published. Every public notice waits for the officer's tap.</span>}
      </div>
      <div className="board-rows">
        {!rows.length && draft ? draft.plan.boats.map((b) => (
          <div className="drow" key={b.vesselId}>
            <i className={`edge ${b.priority}`} />
            <span className="pri">{b.priority}</span>
            <span className="name">{b.name}</span>
            <span className="chan"><DeviceMobile size={16} />App</span>
            <StepTrack states={{}} />
            <span className="state c-muted">Ready to send</span>
            <span className="tail">{b.simulated ? 'Simulated' : ''}</span>
          </div>
        )) : null}
        {shown.map((d) => (
          <div className="drow" key={`${d.noticeId}:${d.vesselId}`} data-testid={`delivery-${d.vesselId}`}>
            <i className={`edge ${d.priority}`} />
            <span className="pri">{d.priority}</span>
            <span className="name" title={d.vesselName}>{d.vesselName}</span>
            <span className="chan"><ChannelIcon ch={d.channel} />{CHANNEL_WORD[d.channel]}</span>
            <StepTrack states={d.states} />
            {d.notResponding
              ? <span className="state warn"><Warning size={16} weight="bold" />No reply<span className="vhf"><Radio size={14} />Call on VHF</span></span>
              : <span className="state">{STATE_WORD[lastState(d)]}</span>}
            <span className="tail">{d.simulated ? 'Simulated' : ''}</span>
          </div>
        ))}
        {mapOnly > 0 ? <div className="drow more"><span className="c-muted">{mapOnly} more ships from AIS got it as P4, map only, by VHF and AIS marker.</span></div> : null}
      </div>
    </div>
  );
}

function OnTime(props: { snap: CommandSnapshot }) {
  const rows = [...props.snap.onTime].sort((a, b) => {
    const rank = (s: string) => (s === 'late' ? 0 : s === 'at risk' ? 1 : s === 'on time' ? 2 : 3);
    return (a.source === 'simulated' ? 0 : 1) - (b.source === 'simulated' ? 0 : 1) || rank(a.status) - rank(b.status);
  });
  const rerouted = rows.find((r) => r.source === 'simulated' && (r.deltaMin ?? 0) >= 0.5 && r.status === 'on time');
  return (
    <div className="board" data-testid="ontime-board">
      <div className="board-title">
        <span className="t-strong">On time</span>
        <span className="summary">{rerouted ? <span>{rerouted.name} <span className="t-mono-small">{signed(rerouted.deltaMin)}</span>, still on time</span> : 'Plan is the timetable or the AIS reported ETA'}</span>
      </div>
      <div className="board-rows">
        <div className="orow head"><span className="name">Vessel</span><span className="src">Source</span><span className="t">Plan</span><span className="t">Ours</span><span className="chg">Change</span><span className="status">Status</span></div>
        {rows.map((r) => (
          <div className="orow" key={r.id} title={r.why} data-testid={`ontime-${r.id}`}>
            <span className="name">{r.name}</span>
            <span className="src">{r.source === 'simulated' ? 'Simulated' : r.source === 'ais-live' ? 'AIS live' : 'AIS replay'}</span>
            <span className="t t-mono-small">{r.plannedLabel}</span>
            <span className="t t-mono-small">{r.ourEtaLabel}</span>
            <span className="chg t-mono-small">{signed(r.deltaMin)}</span>
            <span className={`status${r.status === 'at risk' || r.status === 'late' ? ' warn' : ''}`}>{r.status === 'at risk' || r.status === 'late' ? <Warning size={14} /> : null}{r.status}</span>
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
            <span className="actor">{a.actor === 'machine' ? 'GIVE WAY' : a.actor === 'officer' ? props.snap.officer : a.actor === 'system' ? 'System' : a.actor.replace(/^captain:/, 'Captain, ')}</span>
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

export function BottomRail(props: { snap: CommandSnapshot; send: Send }) {
  const [tab, setTab] = useState<'boards' | 'log' | 'marine'>('boards');
  return (
    <div className="cmd-bottom">
      <div className="bottom-head" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'boards'} onClick={() => setTab('boards')}>Delivery and on time</button>
        <button className="tab" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} data-testid="tab-log">Log</button>
        <button className="tab" role="tab" aria-selected={tab === 'marine'} onClick={() => setTab('marine')}>Marine life</button>
      </div>
      {tab === 'boards' ? <div className="bottom-body"><Delivery snap={props.snap} /><OnTime snap={props.snap} /></div> : null}
      {tab === 'log' ? <div className="bottom-body single"><Log snap={props.snap} send={props.send} /></div> : null}
      {tab === 'marine' ? <div className="bottom-body single"><MarineLog snap={props.snap} /></div> : null}
    </div>
  );
}
