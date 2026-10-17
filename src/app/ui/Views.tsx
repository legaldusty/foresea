import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowSquareOut, Desktop, DeviceMobile, Joystick, SquaresFour, Television } from '@phosphor-icons/react';
import { harborCode, viewPath } from '../hub/harbor';

export type ViewKey = 'desk' | 'captain' | 'drive' | 'board';

interface ViewDef { key: ViewKey; title: string; detail: string; icon: ReactNode; path: string }

export const VIEWS: ViewDef[] = [
  { key: 'desk', title: 'Harbor desk', detail: "The officer's screen", icon: <Desktop size={20} />, path: '/' },
  { key: 'captain', title: 'Captain phone', detail: 'What a boat in the harbor sees', icon: <DeviceMobile size={20} />, path: '/captain?v=launch1' },
  { key: 'drive', title: 'Drive the drone', detail: 'Steer the unknown drone yourself', icon: <Joystick size={20} />, path: '/drive' },
  { key: 'board', title: 'Public board', detail: 'The marina screen, no scores', icon: <Television size={20} />, path: '/board' },
];

export function viewUrl(key: ViewKey): string {
  return viewPath(VIEWS.find((v) => v.key === key)?.path ?? '/');
}

export function ViewsMenu(props: { current: ViewKey; label?: boolean; testId?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); };
  }, [open]);
  const code = harborCode();
  return (
    <div className="views" ref={wrap}>
      <button type="button" className={props.label ? 'btn btn-secondary views-labeled' : 'views-btn'} aria-expanded={open} aria-haspopup="menu" aria-label="Switch view" title="Switch view" onClick={() => setOpen(!open)} data-testid={props.testId ?? 'views-open'}>
        <SquaresFour size={props.label ? 16 : 20} />{props.label ? <span className="btn-label">Views</span> : null}
      </button>
      {open ? (
        <div className="views-menu" role="menu" data-testid="views-menu">
          {VIEWS.map((v) => (
            <div className={`views-row${v.key === props.current ? ' current' : ''}`} key={v.key}>
              <a className="views-main" role="menuitem" href={viewUrl(v.key)} aria-current={v.key === props.current ? 'page' : undefined} onClick={(e) => { if (v.key === props.current) { e.preventDefault(); setOpen(false); } }} data-testid={`view-${v.key}`}>
                {v.icon}
                <span className="text"><span className="t-strong">{v.title}</span><span className="t-small c-muted">{v.detail}</span></span>
              </a>
              <a className="views-new" href={viewUrl(v.key)} target="_blank" rel="noreferrer" aria-label={`Open ${v.title} in a new tab`} title="Open in a new tab" data-testid={`view-${v.key}-tab`}><ArrowSquareOut size={16} /></a>
            </div>
          ))}
          <p className="views-foot">{code ? <>Your harbor <span className="t-mono-small">{code}</span> comes with you.</> : 'Every view runs on this same harbor.'}</p>
        </div>
      ) : null}
    </div>
  );
}

export function ViewLinks(props: { exclude: ViewKey }) {
  return (
    <div className="view-links">
      {VIEWS.filter((v) => v.key !== props.exclude).map((v) => (
        <a key={v.key} className="view-link" href={viewUrl(v.key)} target="_blank" rel="noreferrer" data-testid={`presenter-view-${v.key}`}>
          {v.icon}<span>{v.title}</span><ArrowSquareOut size={16} className="out" />
        </a>
      ))}
    </div>
  );
}
