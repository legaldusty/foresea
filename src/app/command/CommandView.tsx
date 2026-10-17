import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContactView } from '../../shared/protocol';
import { useCommandHub } from '../hub/useHub';
import { ChartMap } from '../map/ChartMap';
import { commandChart } from '../map/toChart';
import { DataLine, TopBar } from './TopBar';
import { ChartTools, DriveControl, Legend, type Tool } from './ChartTools';
import { CardSlot, ContactSection, NoticeEditor, OddsSection, PublishedNotice, RiskSection } from './RightRail';
import { BottomRail } from './BottomRail';
import { JoinSheet, NightsSheet, OrdersSheet } from './Sheets';
import '../../styles/command.css';

function pickContact(contacts: ContactView[], selected: string | null): ContactView | null {
  if (selected) { const c = contacts.find((x) => x.id === selected); if (c) return c; }
  return [...contacts].sort((a, b) => (b.risk?.score ?? -1) - (a.risk?.score ?? -1))[0] ?? null;
}

export function CommandView() {
  const hub = useCommandHub();
  const snap = hub.snapshot;
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [sheet, setSheet] = useState<'nights' | 'orders' | 'join' | null>(null);
  const [themeChoice, setThemeChoice] = useState<'night' | 'day' | null>(null);
  const theme: 'night' | 'day' = themeChoice ?? (snap && !snap.clock.night ? 'day' : 'night');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const railRef = useRef<HTMLElement>(null);
  const cardId = snap?.card?.id ?? null;
  useEffect(() => { if (cardId) railRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [cardId]);

  const data = useMemo(() => commandChart(snap, selected), [snap, selected]);
  if (!snap) return <div className="rail-empty">Connecting to the hub</div>;

  const contact = pickContact(snap.contacts, selected);
  const driven = snap.contacts.find((c) => c.mode === 'driven') ?? null;
  const draft = snap.drafts.find((d) => d.contactId && d.contactId === contact?.id) ?? snap.drafts.find((d) => d.routine) ?? snap.drafts[0] ?? null;
  const active = snap.notices.filter((n) => n.status === 'active');

  const onDrop = (lonlat: [number, number]) => {
    if (tool === 'whale' || tool === 'divers' || tool === 'dredge') void hub.send('dropZone', { kind: tool, lonlat });
    setTool('select');
  };

  return (
    <div className="cmd" data-theme={theme}>
      <TopBar snap={snap} send={hub.send} onOrders={() => setSheet('orders')} onJoin={() => setSheet('join')} onNights={() => setSheet('nights')} />
      <DataLine snap={snap} link={hub.link} send={hub.send} theme={theme} onTheme={() => setThemeChoice(theme === 'night' ? 'day' : 'night')} />
      <div className="cmd-chart">
        <ChartMap theme={theme} data={data}
          mode={tool === 'drive' ? 'drive' : tool === 'select' ? 'select' : 'drop'}
          onSelect={(kind, id) => { if (kind === 'contact') setSelected(id); }}
          onPointer={(lonlat) => { if (driven) void hub.send('drive', { contactId: driven.id, lonlat }); }}
          onDrop={onDrop}
          labels={snap.contacts.map((c) => ({ id: c.id, text: c.label, lonlat: c.lonlat }))} />
        <ChartTools tool={tool} setTool={setTool} send={hub.send} driven={driven} />
        {tool === 'drive' && driven ? <DriveControl c={driven} send={hub.send} onStop={() => setTool('select')} /> : null}
        <Legend />
      </div>
      <aside className="cmd-rail" data-testid="right-rail" ref={railRef}>
        {snap.contacts.length > 1 ? (
          <div className="rail-tabs" role="tablist">
            {snap.contacts.map((c) => (
              <button key={c.id} className="tab" role="tab" aria-selected={c.id === contact?.id} onClick={() => setSelected(c.id)}>
                {c.label}{c.risk ? <span className="t-data">{c.risk.score}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {snap.card ? <CardSlot card={snap.card} waiting={snap.cardsWaiting} send={hub.send} simMin={snap.clock.simMin} /> : null}
        {contact ? <ContactSection c={contact} send={hub.send} /> : null}
        {contact && contact.odds.length && contact.classification.kind !== 'animal' && contact.classification.kind !== 'person' ? <OddsSection c={contact} /> : null}
        {contact ? <RiskSection c={contact} /> : null}
        {draft ? <NoticeEditor key={draft.id} d={draft} send={hub.send} simMin={snap.clock.simMin} /> : null}
        {active.map((n) => <PublishedNotice key={n.id} n={n} snap={snap} send={hub.send} />)}
        {!contact && !draft && !active.length && !snap.card ? (
          <div className="rail-empty">
            <span className="t-heading c-text">Harbor quiet</span>
            <span>No unknown contacts. {snap.vessels.filter((v) => v.source === 'simulated').length} simulated boats on their routes and {snap.vessels.filter((v) => v.source !== 'simulated').length} real ships from AIS.</span>
            <span>Drop a zone for divers, a dredge or a whale, or add a contact to watch GIVE WAY identify it and predict where it is going.</span>
          </div>
        ) : null}
      </aside>
      <BottomRail snap={snap} send={hub.send} />
      {sheet === 'nights' ? <NightsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'orders' ? <OrdersSheet snap={snap} send={hub.send} onClose={() => setSheet(null)} /> : null}
      {sheet === 'join' ? <JoinSheet snap={snap} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
