import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import type { CommandSnapshot, ContactView, DeliveryRow, DeliveryState } from '../../shared/protocol';
import { DELIVERY_STATES } from '../../shared/protocol';
import { useCommandHub } from '../hub/useHub';
import { ChartMap, type CalloutSide, type ChartCallout } from '../map/ChartMap';
import { commandChart } from '../map/toChart';
import { TopBar } from './TopBar';
import { Headline, StepStrip } from './Headline';
import { ChartCorner, DeskTools, DriveControl, Presenter, type Tool } from './ChartTools';
import { ContactBlock, DecisionSlot, HeadingBlock, WhyDrawer } from './Decision';
import { NoticeEditor, PublishedNotice } from './RightRail';
import { BottomRail } from './BottomRail';
import { JoinSheet, NightsSheet, OrdersSheet } from './Sheets';
import { StepTrack } from '../ui';
import '../../styles/command.css';

function pickContact(contacts: ContactView[], selected: string | null): ContactView | null {
  if (selected) { const c = contacts.find((x) => x.id === selected); if (c) return c; }
  return [...contacts].sort((a, b) => (b.risk?.score ?? -1) - (a.risk?.score ?? -1))[0] ?? null;
}

const STATE_WORD: Record<DeliveryState, string> = { sent: 'Sent', delivered: 'Delivered', seen: 'Seen', acknowledged: 'Acknowledged', complying: 'Complying' };

function lastState(d: DeliveryRow): DeliveryState {
  let last: DeliveryState = 'sent';
  for (const s of DELIVERY_STATES) if (d.states[s] !== undefined) last = s;
  return last;
}

function DeliveryBlock(props: { snap: CommandSnapshot }) {
  const rows = props.snap.deliveries
    .filter((d) => d.priority !== 'P4' && !d.vesselId.startsWith('ais-'))
    .sort((a, b) => Number(b.notResponding) - Number(a.notResponding) || a.priority.localeCompare(b.priority));
  if (!rows.length) return null;
  const acked = rows.filter((d) => d.states.acknowledged !== undefined).length;
  return (
    <section className="rail-block" data-testid="delivery-board">
      <div className="block-title"><span className="t-heading">Boats told</span><span className="t-small c-muted"><span className="mono">{acked}</span> of <span className="mono">{rows.length}</span> acknowledged</span></div>
      {rows.map((d) => (
        <div className="drow-r" key={`${d.noticeId}:${d.vesselId}`} data-testid={`delivery-${d.vesselId}`}>
          <i className={`edge ${d.priority}`} />
          <span className="pri mono">{d.priority}</span>
          <span className="name">{d.vesselName}</span>
          <StepTrack states={d.states} />
          {d.notResponding ? <span className="state warn"><Warning size={14} weight="bold" />No reply</span> : <span className="state">{STATE_WORD[lastState(d)]}</span>}
        </div>
      ))}
    </section>
  );
}

export function CommandView() {
  const hub = useCommandHub();
  const snap = hub.snapshot;
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [sheet, setSheet] = useState<'nights' | 'orders' | 'join' | null>(null);
  const [themeChoice, setThemeChoice] = useState<'night' | 'day' | null>(null);
  const [presenter, setPresenter] = useState(false);
  const [why, setWhy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const theme: 'night' | 'day' = themeChoice ?? (snap && !snap.clock.night ? 'day' : 'night');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (e.key === 'p' || e.key === 'P') setPresenter((v) => !v);
      if (e.key === 'Escape') { setWhy(false); setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const railRef = useRef<HTMLElement>(null);
  const cardId = snap?.card?.id ?? null;
  useEffect(() => { if (cardId) { railRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setEditing(false); } }, [cardId]);

  const data = useMemo(() => commandChart(snap, selected, hub.forecasts), [snap, selected, hub.forecasts]);
  if (!snap) return <div className="rail-empty">Connecting to the hub</div>;

  const watched = snap.contacts.filter((c) => c.classification.kind !== 'friendly');
  const focus = pickContact(watched, selected) ?? pickContact(snap.contacts, selected);
  const driven = snap.contacts.find((c) => c.mode === 'driven') ?? null;
  const incident = !!snap.steps;
  const draft = snap.card?.draftId ? snap.drafts.find((d) => d.id === snap.card?.draftId) ?? null : snap.drafts.find((d) => d.contactId && d.contactId === focus?.id) ?? null;
  const active = snap.notices.filter((n) => n.status === 'active');
  const focusNotice = active.find((n) => n.contactId && n.contactId === focus?.id) ?? null;

  const SIDES: CalloutSide[] = ['ne', 'sw', 'se', 'nw'];
  const callouts: ChartCallout[] = snap.vessels
    .filter((v) => v.affected && !v.id.startsWith('ais-') && v.affected.priority !== 'P4')
    .sort((a, b) => a.lonlat[0] - b.lonlat[0])
    .map((v, i) => ({
      id: v.id, boat: v.name, lonlat: v.lonlat, side: SIDES[i % SIDES.length],
      when: v.affected?.crossingLabel ? `crosses at ${v.affected.crossingLabel}` : 'near its route',
      action: (v.affected?.text ?? '').startsWith('NO ACTION') ? 'HEADS-UP ONLY' : v.affected?.text ?? '',
    }));

  const onDrop = (lonlat: [number, number]) => {
    if (tool === 'whale' || tool === 'divers' || tool === 'dredge' || tool === 'closure') void hub.send('dropZone', { kind: tool, lonlat });
    if (tool.startsWith('sighting:')) void hub.send('reportSighting', { species: tool.slice('sighting:'.length) as never, lonlat });
    setTool('select');
  };

  return (
    <div className={`cmd${incident ? ' incident' : ''}`} data-theme={theme}>
      <TopBar snap={snap} link={hub.link} onOrders={() => setSheet('orders')} onJoin={() => setSheet('join')} />
      <div className="cmd-main">
        <Headline h={snap.headline} level={focus?.risk?.level ?? null} />
        {snap.steps ? <StepStrip steps={snap.steps} /> : null}
        <div className="cmd-chart">
          <ChartMap theme={theme} data={data} stamp={snap.clock.wallMs} callouts={callouts}
            mode={tool === 'drive' ? 'drive' : tool === 'select' ? 'select' : 'drop'}
            onSelect={(kind, id) => { if (kind === 'contact') setSelected(id); }}
            onPointer={(lonlat) => { if (driven) void hub.send('drive', { contactId: driven.id, lonlat }); }}
            onDrop={onDrop}
            labels={[
              ...snap.contacts.map((c) => ({ id: c.id, text: c.label, lonlat: c.lonlat })),
              ...snap.vessels.filter((v) => v.phone?.joined && !v.affected).map((v) => ({ id: v.id, text: `${v.name}, phone`, lonlat: v.lonlat })),
            ]} />
          <DeskTools tool={tool} setTool={setTool} onDivePlans={() => setDeskOpen(!deskOpen)} />
          <ChartCorner onPresenter={() => setPresenter(!presenter)} presenterOpen={presenter} />
          {tool === 'drive' && driven ? <DriveControl c={driven} send={hub.send} onStop={() => setTool('select')} /> : null}
          <span className="chart-attr">Map data: OpenStreetMap contributors</span>
        </div>
        {!incident || deskOpen ? <div className="cmd-desk"><BottomRail snap={snap} send={hub.send} /></div> : null}
        {why ? <WhyDrawer snap={snap} c={focus} plan={(draft ?? focusNotice)?.plan ?? null} onClose={() => setWhy(false)} /> : null}
      </div>
      <aside className="cmd-rail" data-testid="right-rail" ref={railRef}>
        {watched.length > 1 ? (
          <div className="rail-tabs" role="tablist">
            {watched.map((c) => (
              <button key={c.id} className="tab" role="tab" aria-selected={c.id === focus?.id} onClick={() => setSelected(c.id)}>
                {c.label}{c.risk ? <span className="t-data">{c.risk.score}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <DecisionSlot snap={snap} send={hub.send} onWhy={() => setWhy(!why)} editing={editing} onEdit={() => setEditing(!editing)}
          editor={draft ? <NoticeEditor key={draft.id} d={draft} send={hub.send} simMin={snap.clock.simMin} /> : null} />
        {focusNotice ? <DeliveryBlock snap={snap} /> : null}
        {focus && focus.classification.kind !== 'friendly' ? <HeadingBlock c={focus} /> : null}
        {focus ? <ContactBlock c={focus} /> : null}
        {active.map((n) => <PublishedNotice key={n.id} n={n} snap={snap} send={hub.send} />)}
        {!focus && !snap.card && !active.length ? (
          <div className="rail-empty">
            <span className="t-heading c-text">Nothing unknown in the harbor</span>
            <span>{snap.vessels.filter((v) => v.source === 'simulated').length} simulated boats on their routes and {snap.vessels.filter((v) => v.source !== 'simulated').length} real ships from AIS.</span>
          </div>
        ) : null}
        {!incident && active.length ? <div className="rail-calm"><CheckCircle size={16} />{active.length} zone{active.length === 1 ? '' : 's'} active. Every notice was approved by the officer.</div> : null}
      </aside>
      <Presenter open={presenter} onClose={() => setPresenter(false)} send={hub.send} timeScale={snap.clock.timeScale} paused={snap.clock.paused}
        focus={focus} driven={driven} tool={tool} setTool={setTool} theme={theme} onTheme={() => setThemeChoice(theme === 'night' ? 'day' : 'night')}
        onNights={() => setSheet('nights')} />
      {sheet === 'nights' ? <NightsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'orders' ? <OrdersSheet snap={snap} send={hub.send} onClose={() => setSheet(null)} /> : null}
      {sheet === 'join' ? <JoinSheet snap={snap} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
