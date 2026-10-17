import { useEffect, useRef, useState } from 'react';
import { BellRinging, CaretDoubleLeft, CaretDoubleRight, CheckSquare, Funnel, Square, X } from '@phosphor-icons/react';
import { LAYERS, type LayerKey } from './ChartTools';
import type { CommandSnapshot } from '../../shared/protocol';

export type RailSection = 'selected' | 'contact' | 'boats' | 'notices' | 'today' | 'watch' | 'incidents';

export const RAIL_SECTIONS: { key: RailSection; label: string }[] = [
  { key: 'selected', label: 'Selected boat, ship or zone' },
  { key: 'contact', label: 'Contact: where it is heading and what it is' },
  { key: 'boats', label: 'Boats told and their replies' },
  { key: 'notices', label: 'Published security notices' },
  { key: 'today', label: 'Today so far' },
  { key: 'watch', label: 'Ships to watch' },
  { key: 'incidents', label: 'Incidents and reports' },
];

export function RailBar(props: { hidden: Set<RailSection>; onToggle: (k: RailSection) => void; onCollapse: () => void; layers: Set<LayerKey>; onLayer: (k: LayerKey) => void }) {
  const [open, setOpen] = useState(false);
  const shown = RAIL_SECTIONS.length - props.hidden.size;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="rail-bar">
      <button className="rail-bar-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="rail-filter">
        <Funnel size={16} />Show<span className="c-muted mono">{shown} of {RAIL_SECTIONS.length}</span>
      </button>
      <span className="fill" />
      <button className="icon-btn" onClick={props.onCollapse} aria-label="Collapse the panel" title="Collapse the panel" data-testid="rail-collapse"><CaretDoubleRight size={16} /></button>
      {open ? (
        <div className="rail-filter" data-testid="rail-filter-menu">
          <span className="filter-group">On the map</span>
          {LAYERS.map((l) => {
            const on = !props.layers.has(l.key);
            return (
              <button key={l.key} className="check-row" role="menuitemcheckbox" aria-checked={on} onClick={() => props.onLayer(l.key)} data-testid={`map-show-${l.key}`}>
                {on ? <CheckSquare size={18} className="chk on" /> : <Square size={18} className="chk" />}<span>{l.label}</span>
              </button>
            );
          })}
          <span className="filter-group">In this panel</span>
          <span className="t-small c-muted">Decisions always show at the top.</span>
          {RAIL_SECTIONS.map((s) => {
            const on = !props.hidden.has(s.key);
            return (
              <button key={s.key} className="check-row" role="menuitemcheckbox" aria-checked={on} onClick={() => props.onToggle(s.key)} data-testid={`rail-show-${s.key}`}>
                {on ? <CheckSquare size={18} className="chk on" /> : <Square size={18} className="chk" />}<span>{s.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function RailStrip(props: { onExpand: () => void; waiting: number }) {
  return (
    <div className="rail-strip" data-testid="rail-strip">
      <button className={`icon-btn${props.waiting ? ' waiting' : ''}`} onClick={props.onExpand} aria-label="Open the panel" title={props.waiting ? 'Something new is waiting. Open the panel' : 'Open the panel'} data-testid="rail-expand"><CaretDoubleLeft size={16} /></button>
    </div>
  );
}

export interface RailAlert { key: string; text: string; kind: 'card' | 'ship' | 'incident' | 'notice'; id: string }

export function useRailAlerts(snap: CommandSnapshot | null, collapsed: boolean): { alerts: RailAlert[]; clear: () => void; dismiss: (key: string) => void } {
  const seen = useRef<Set<string> | null>(null);
  const [alerts, setAlerts] = useState<RailAlert[]>([]);
  useEffect(() => {
    if (!snap) return;
    const now: RailAlert[] = [];
    if (snap.card) now.push({ key: `card:${snap.card.id}:${snap.card.realerts}`, text: snap.card.title, kind: 'card', id: snap.card.id });
    for (const v of snap.vessels) if (v.intel && v.intel.level !== 'normal') now.push({ key: `ship:${v.id}`, text: `Ship to watch: ${v.name}. ${v.intel.reasons[0] ?? ''}`.trim(), kind: 'ship', id: v.id });
    for (const i of snap.incidents) now.push({ key: `incident:${i.contactId}`, text: `New contact: ${i.label}, seen ${i.detectedLabel}`, kind: 'incident', id: i.contactId });
    for (const n of snap.notices) if (n.status === 'active' && n.approvedBy.startsWith('Standing Orders')) now.push({ key: `notice:${n.id}`, text: `Published under your Standing Orders: ${n.label ?? n.publicReason}`, kind: 'notice', id: n.id });
    if (seen.current === null) { seen.current = new Set(now.map((a) => a.key)); return; }
    const fresh = now.filter((a) => !seen.current?.has(a.key));
    for (const a of fresh) seen.current.add(a.key);
    const rank: Record<RailAlert['kind'], number> = { card: 0, notice: 1, ship: 2, incident: 3 };
    if (collapsed && fresh.length) setAlerts((list) => [...fresh.sort((a, b) => rank[a.kind] - rank[b.kind]), ...list].sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 6));
  }, [snap, collapsed]);
  useEffect(() => { if (!collapsed) setAlerts([]); }, [collapsed]);
  return { alerts, clear: () => setAlerts([]), dismiss: (key) => setAlerts((list) => list.filter((a) => a.key !== key)) };
}

export function RailAlertBar(props: { alerts: RailAlert[]; onOpen: (a: RailAlert) => void; onDismiss: (key: string) => void }) {
  const top = props.alerts[0];
  if (!top) return null;
  const more = props.alerts.length - 1;
  return (
    <div className={`rail-alert ${top.kind}`} role="status" data-testid="rail-alert">
      <BellRinging size={16} weight="bold" />
      <button className="rail-alert-text" onClick={() => props.onOpen(top)} data-testid="rail-alert-open">
        <span>{top.text}</span>
        {more ? <span className="c-muted">{` and ${more} more`}</span> : null}
        <span className="open">Open</span>
      </button>
      <button className="icon-btn" onClick={() => props.onDismiss(top.key)} aria-label="Dismiss" data-testid="rail-alert-dismiss"><X size={16} /></button>
    </div>
  );
}
