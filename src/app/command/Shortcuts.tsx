import { useEffect } from 'react';
import { X } from '@phosphor-icons/react';
import { Button } from '../ui';

const KEYS: [string, string][] = [
  ['P', 'Presenter panel'],
  ['M', 'Models'],
  ['O', 'Standing Orders'],
  ['J', 'Join phones'],
  ['R', 'After-action report for the contact in focus'],
  ['D', 'Fold or open the desk'],
  ['1 to 5', 'Desk tabs: Today, On time, Marine life, Daily report, Log'],
  ['S', 'Mute or unmute alert sounds'],
  ['Esc', 'Close panels, cancel a tool, clear the highlight'],
  ['?', 'This list'],
];

export function ShortcutsSheet(props: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="sheet-back" onClick={props.onClose}>
      <div className="sheet" style={{ width: 'min(560px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()} data-testid="shortcuts">
        <div className="sheet-head">
          <div className="title-block"><span className="t-display">Keyboard</span><span className="t-small c-muted">Every control is also on screen. Keys are for the watch officer at 3 AM.</span></div>
          <Button variant="quiet" icon={<X size={16} />} onClick={props.onClose}>Close</Button>
        </div>
        <div className="sheet-body">
          <div className="keys">
            {KEYS.map(([k, what]) => <div key={k}><span className="mono key-cap">{k}</span><span>{what}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
