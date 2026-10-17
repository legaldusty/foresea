import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Clock, Lifebuoy, MapPin, Radio, WarningCircle } from '@phosphor-icons/react';
import type { CaptainSos } from '../../shared/protocol';
import { formatLatLon, type LonLat } from '../../engine/geo';
import { Button } from '../ui';
import { Header } from './parts';
import { buzz } from './device';

const HOLD_MS = 2000;

function position(lonlat: LonLat | null): string {
  return lonlat ? formatLatLon(lonlat) : 'Waiting for your position';
}

function HoldToSend(props: { onDone: () => void; disabled: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (props.disabled || timer.current !== null) return;
    setHolding(true);
    buzz(false);
    timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); props.onDone(); }, HOLD_MS);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className={`cap-hold${holding ? ' on' : ''}`}
      style={{ ['--hold-ms' as string]: `${HOLD_MS}ms` }}
      onPointerDown={(e) => { e.preventDefault(); start(); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') stop(); }}
      onContextMenu={(e) => e.preventDefault()}
      disabled={props.disabled}
      data-testid="sos-hold"
    >
      <span className="fill" aria-hidden="true" />
      <Lifebuoy size={28} />
      <span className="label">{props.disabled ? 'Sending' : holding ? 'Keep holding' : 'Hold to send'}</span>
    </button>
  );
}

function StatusRow(props: { done: boolean; title: string; detail: string; testId?: string }) {
  return (
    <div className="cap-sos-row" data-testid={props.testId}>
      {props.done ? <CheckCircle size={20} className="lead ok" /> : <Clock size={20} className="lead" />}
      <span className="text"><span className="t-strong">{props.title}</span><span className="t-small c-muted">{props.detail}</span></span>
    </div>
  );
}

const STEPS = [
  'Shout "Man overboard" and point at the person. Keep pointing.',
  'Throw a life ring or anything that floats.',
  'Call MAYDAY on VHF channel 16.',
  'Come back slowly. Stop the propeller before you reach them.',
];

export function SosScreen(props: { sos: CaptainSos | null; lonlat: LonLat | null; online: boolean; onSend: () => Promise<boolean>; onEnd: (action: 'cancel' | 'recovered') => void; onClose: () => void }) {
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sos = props.sos;
  const send = async () => {
    setSending(true);
    setFailed(false);
    const ok = await props.onSend();
    setSending(false);
    if (ok) buzz(true);
    else setFailed(true);
  };
  if (sos && (sos.state === 'recovered' || sos.state === 'falseAlarm')) {
    return (
      <div className="cap-screen cap-sos-screen" data-testid="sos-screen">
        <Header title="Person overboard" onBack={props.onClose} close testId="sos-close" />
        <div className="cap-sos-band done" data-testid="sos-band">
          <CheckCircle size={24} />
          <span className="text">
            <span className="t-heading">{sos.state === 'recovered' ? 'Person back aboard' : 'Cancelled, false alarm'}</span>
            <span className="t-body">At <span className="num">{sos.atLabel}</span>. The search area is lifted on every phone.</span>
          </span>
        </div>
        <div className="cap-sos-foot"><Button variant="secondary" size="l" block onClick={props.onClose} testId="sos-done">Close</Button></div>
      </div>
    );
  }
  if (sos) {
    return (
      <div className="cap-screen cap-sos-screen" data-testid="sos-screen">
        <Header title="Person overboard" onBack={props.onClose} close testId="sos-close" />
        <div className="scroll">
          <div className="cap-sos-band" data-testid="sos-band">
            <Lifebuoy size={24} />
            <span className="text">
              <span className="t-heading">Sent at <span className="num">{sos.atLabel}</span></span>
              <span className="t-body">The harbor desk has your position.</span>
            </span>
          </div>
          <div className="cap-sos-status">
            <StatusRow done title="Position marked" detail={`${sos.position}, near ${sos.place.replace(/^the /, '')}`} />
            <StatusRow done={sos.state === 'published'} testId="sos-search"
              title={sos.state !== 'published' ? 'Search area drafted for the desk' : sos.boatsTold ? `Search area published to ${sos.boatsTold} ${sos.boatsTold === 1 ? 'boat' : 'boats'}${sos.publishedAtLabel ? ` at ${sos.publishedAtLabel}` : ''}` : `Search area published${sos.publishedAtLabel ? ` at ${sos.publishedAtLabel}` : ''}. No boats in its way yet`}
              detail={sos.state === 'published' ? `Drifting ${sos.drift}` : `Waiting for the officer to publish. Drifting ${sos.drift}.`} />
            <StatusRow done={sos.briefSent} title={sos.briefSent ? 'Coast Guard brief sent by the desk' : 'Coast Guard brief ready at the desk'} detail={sos.briefSent ? 'Help is being asked for' : 'The officer sends it with one tap'} />
          </div>
          <div className="cap-sos-steps">
            <h2 className="t-heading">Do this now</h2>
            <ol>{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        </div>
        <div className="cap-sos-foot">
          <Button variant="primary" size="l" block icon={<CheckCircle size={20} />} onClick={() => props.onEnd('recovered')} testId="sos-recovered">Person is back aboard</Button>
          <Button variant="secondary" size="l" block onClick={() => props.onEnd('cancel')} testId="sos-cancel">False alarm, cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="cap-screen cap-sos-screen" data-testid="sos-screen">
      <Header title="Person overboard" onBack={props.onClose} close testId="sos-close" />
      <div className="scroll pad">
        <span className="t-display">Hold to send your position to the harbor desk.</span>
        <span className="t-body c-muted">Foresea marks where you are now. The desk sees a search area that drifts with the current and moves other boats out of it.</span>
        <span className="cap-sos-pos"><MapPin size={20} /><span className="num">{position(props.lonlat)}</span></span>
        <HoldToSend onDone={() => void send()} disabled={sending || !props.online} />
        {failed || !props.online ? (
          <p className="cap-sos-fail" data-testid="sos-failed"><WarningCircle size={20} />Not sent. No connection to the harbor desk. Call MAYDAY on VHF channel 16 now.</p>
        ) : <span className="t-small c-muted">Keep holding for 2 seconds. Let go to stop.</span>}
        <div className="cap-sos-vhf"><Radio size={24} /><span className="t-strong">Also call MAYDAY on VHF channel 16.</span></div>
        <Button variant="secondary" size="l" block onClick={props.onClose} testId="sos-dismiss">Cancel</Button>
      </div>
    </div>
  );
}

export function SosBand(props: { sos: CaptainSos; onOpen: () => void }) {
  const done = props.sos.state === 'recovered' || props.sos.state === 'falseAlarm';
  return (
    <button type="button" className={`cap-sos-band strip${done ? ' done' : ''}`} onClick={props.onOpen} data-testid="sos-strip">
      {done ? <CheckCircle size={20} /> : <Lifebuoy size={20} />}
      <span className="text">
        <span className="t-strong">{done ? (props.sos.state === 'recovered' ? 'Person back aboard. Search lifted.' : 'False alarm. Search lifted.') : <>Person overboard sent <span className="num">{props.sos.atLabel}</span></>}</span>
        {done ? null : <span className="t-small">{props.sos.state === 'published' ? 'Search area published. Tap for steps.' : 'The desk has your position. Tap for steps.'}</span>}
      </span>
    </button>
  );
}
