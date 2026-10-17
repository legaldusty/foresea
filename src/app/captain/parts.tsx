import type { ReactNode } from 'react';
import { Bell, Broadcast, CaretLeft, CellSignalSlash, Circle, Fish, Gauge, HandPalm, Moon, NavigationArrow, RadioButton, Sun, Warning, WifiSlash, X } from '@phosphor-icons/react';
import type { CaptainNotice, ClockView, PublicReason, Species } from '../../shared/protocol';
import { minutesUntil } from './timing';

const NUMBER = /(\d{1,2}:\d{2}|\d+(?:\.\d+)?)/g;

export function Num(props: { text: string }) {
  const parts = props.text.split(NUMBER);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="num">{p}</span> : p))}</>;
}

export function TopBar(props: { name: string; speedKn: number | null; offline: boolean; onPick: () => void; onNotices: () => void }) {
  return (
    <div className="cap-bar">
      <div className="row">
        <button type="button" className="who" onClick={props.onPick} aria-label="Change boat">{props.name}</button>
        {props.speedKn !== null ? <span className="speed">{props.speedKn.toFixed(1)} kn</span> : null}
        <span className="simulated">Simulated</span>
        <span className="cap-linkstate" data-testid="link-state">{props.offline ? <CellSignalSlash size={16} /> : <Broadcast size={16} />}{props.offline ? 'Offline' : 'Live'}</span>
        <button type="button" className="icon-btn" onClick={props.onNotices} aria-label="Notices" title="Notices" data-testid="open-notices"><Bell size={24} /></button>
      </div>
    </div>
  );
}

export function Header(props: { title: string; onBack: () => void; close?: boolean; testId?: string }) {
  return (
    <div className="cap-head">
      <div className="row">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label={props.close ? 'Close' : 'Back'} title={props.close ? 'Close' : 'Back'} data-testid={props.testId}>
          {props.close ? <X size={24} /> : <CaretLeft size={24} />}
        </button>
        <span className="t-title">{props.title}</span>
      </div>
    </div>
  );
}

export function OfflineLine(props: { receivedAt: number | null; now: number }) {
  const minutes = props.receivedAt === null ? null : Math.floor((props.now - props.receivedAt) / 60000);
  return (
    <div className="cap-offline" data-testid="stale">
      <WifiSlash size={20} />
      <span>
        {minutes === null ? 'Updated a while ago.' : minutes < 1 ? 'Updated under a minute ago.' : <>Updated <span className="num">{minutes}</span> min ago.</>}
        {' '}Zones keep moving along their predicted path.
      </span>
    </div>
  );
}

export function Legend(props: { stacked?: boolean }) {
  return (
    <div className={`cap-legend${props.stacked ? ' stacked' : ''}`} data-testid="legend">
      <span className="key"><i className="swatch likely" />Where it is going</span>
      <span className="key"><i className="swatch careful" />Be careful</span>
    </div>
  );
}

export function MapControls(props: { theme: 'day' | 'night'; onCenter: () => void; onTheme: () => void }) {
  return (
    <div className="cap-controls">
      <button type="button" onClick={props.onCenter} aria-label="Center on my boat" title="Center on my boat" data-testid="center-boat"><NavigationArrow size={24} /></button>
      <i />
      <button type="button" onClick={props.onTheme} aria-label="Day or night chart" title={props.theme === 'day' ? 'Night chart' : 'Day chart'}>{props.theme === 'day' ? <Moon size={24} /> : <Sun size={24} />}</button>
    </div>
  );
}

export type PinKind = 'whale' | 'divers' | 'slow' | 'keepOut' | 'hazard';

export function pinForReason(reason: PublicReason): PinKind {
  switch (reason) {
    case 'Whale nearby': return 'whale';
    case 'Divers in water': return 'divers';
    case 'Dredge working': return 'slow';
    default: return 'keepOut';
  }
}

export function pinForSpecies(s: Species): PinKind {
  return s === 'debris' || s === 'hazard' ? 'hazard' : 'whale';
}

export function Pin(props: { kind: PinKind }) {
  if (props.kind === 'divers') {
    return (
      <svg className="cap-flag" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path className="flag-field" d="M27 4H1V24H27V4Z" />
        <path className="stripe" d="M1 4H6.5L27 19V24H21.5L1 9V4Z" />
        <path className="edge" d="M2 5H26V23H2V5Z" />
      </svg>
    );
  }
  const Icon = props.kind === 'whale' ? Fish : props.kind === 'slow' ? Gauge : props.kind === 'keepOut' ? HandPalm : Warning;
  return <span className={`cap-pin ${props.kind === 'keepOut' ? 'red' : 'amber'}`} aria-hidden="true"><Icon size={16} /></span>;
}

export function ChoiceRow(props: { label: ReactNode; meta?: ReactNode; selected: boolean; onSelect: () => void; testId?: string; lang?: string }) {
  return (
    <button type="button" role="radio" aria-checked={props.selected} className="cap-choice" onClick={props.onSelect} data-testid={props.testId}>
      <span className="text">
        <span className="label" lang={props.lang}>{props.label}</span>
        {props.meta ? <span className="meta">{props.meta}</span> : null}
      </span>
      {props.selected ? <RadioButton size={24} className="radio on" /> : <Circle size={24} className="radio" />}
    </button>
  );
}

export function Countdown(props: { n: CaptainNotice; clock: ClockView; at: number; now: number; size: 'xl' | 'l' | 's' }) {
  const n = props.n;
  const left = n.untilLabel ? minutesUntil(n.untilLabel, props.clock, props.at, props.now) : null;
  if (n.untilLabel && left !== null) {
    return (
      <p className={`cap-count ${props.size}`} data-testid="countdown">
        <span className="n">{Math.max(0, Math.ceil(left))}</span><span className="u">min</span><span className="w">until</span><span className="t">{n.untilLabel}</span>
      </p>
    );
  }
  return (
    <p className={`cap-count ${props.size}`} data-testid="countdown">
      <span className="w first">Until</span><span className="t">{n.validUntilLabel}</span><span className="w">or All clear</span>
    </p>
  );
}
