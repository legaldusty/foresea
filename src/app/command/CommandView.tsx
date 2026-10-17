import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import type { CommandSnapshot, ContactView, DeliveryRow, DeliveryState } from '../../shared/protocol';
import { DELIVERY_STATES } from '../../shared/protocol';
import { useCommandHub } from '../hub/useHub';
import { defaultSettings } from '../../engine/settings';
import { ChartMap, type CalloutSide, type ChartCallout, type ChartData, type ZoneHandle } from '../map/ChartMap';
import { commandChart } from '../map/toChart';
import { TopBar } from './TopBar';
import { Headline, StepStrip } from './Headline';
import { ChartCorner, DeskTools, DriveControl, Presenter, type LayerKey, type Tool } from './ChartTools';
import { ContactDossier } from './Dossier';
import { VesselInspector } from './Inspector';
import { ModelsPanel } from './Models';
import { useDragSize, usePersisted } from './resize';
import { ContactBlock, DecisionSlot, HeadingBlock, WhyDrawer } from './Decision';
import { NoticeEditor, PublishedNotice } from './RightRail';
import { DeskRail } from './Desk';
import { JoinSheet, NightsSheet, OrdersSheet } from './Sheets';
import { StepTrack } from '../ui';
import '../../styles/command.css';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function withoutHidden(data: ChartData, hidden: Set<LayerKey>): ChartData {
  if (!hidden.size) return data;
  const out: ChartData = { ...data };
  if (hidden.has('forecast')) { out.forecast = EMPTY_FC; out.ticks = EMPTY_FC; }
  if (hidden.has('zones')) { out.zones = EMPTY_FC; out.arrows = EMPTY_FC; }
  if (hidden.has('routes')) { out.routes = EMPTY_FC; out.paths = EMPTY_FC; }
  if (hidden.has('ais') || hidden.has('boats')) {
    out.vessels = { type: 'FeatureCollection', features: data.vessels.features.filter((f) => {
      const real = String((f.properties as Record<string, unknown> | null)?.id ?? '').startsWith('ais-');
      return real ? !hidden.has('ais') : !hidden.has('boats');
    }) };
  }
  return out;
}

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
  const [sheet, setSheet] = useState<'nights' | 'orders' | 'join' | 'models' | null>(null);
  const [inspect, setInspect] = useState<{ kind: 'vessel' | 'contact'; id: string } | null>(null);
  const [hiddenList, setHiddenList] = usePersisted<LayerKey[]>('giveway.layers.hidden', []);
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList.join(',')]);
  const toggleLayer = (k: LayerKey) => setHiddenList(hidden.has(k) ? hiddenList.filter((x) => x !== k) : [...hiddenList, k]);
  const rail = useDragSize('giveway.rail.width', 384, 320, () => Math.min(720, window.innerWidth * 0.5), 'x');
  const desk = useDragSize('giveway.desk.height', 384, 200, () => Math.max(220, window.innerHeight - 280), 'y');
  const [recenter, setRecenter] = useState<{ id: string; points: [number, number][] } | null>(null);
  const [themeChoice, setThemeChoice] = useState<'night' | 'day' | null>(null);
  const [presenter, setPresenter] = useState(false);
  const [why, setWhy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [divePoint, setDivePoint] = useState<[number, number] | null>(null);
  const [framed, setFramed] = useState<{ id: string; points: [number, number][] } | null>(null);
  const theme: 'night' | 'day' = themeChoice ?? (snap && !snap.clock.night ? 'day' : 'night');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (e.key === 'p' || e.key === 'P') setPresenter((v) => !v);
      if (e.key === 'Escape') { setWhy(false); setTool('select'); setInspect(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const railRef = useRef<HTMLElement>(null);
  const cardId = snap?.card?.id ?? null;
  useEffect(() => { if (cardId) { railRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setEditing(false); } }, [cardId]);

  const data = useMemo(() => withoutHidden(commandChart(snap, selected, hub.forecasts), hidden), [snap, selected, hub.forecasts, hidden]);
  const focusId = snap?.headline.contactId ?? null;
  const focusContact = focusId ? snap?.contacts.find((x) => x.id === focusId) ?? null : null;
  const targetId = focusContact?.forecast?.topId ?? null;
  const frameKey = focusId && targetId ? `${focusId}:${targetId}` : null;
  useEffect(() => {
    if (!snap || !frameKey || !focusContact || framed?.id === frameKey) return;
    const target = defaultSettings.harbor.targets.find((t) => t.id === targetId);
    const f = hub.forecasts.find((x) => x.contactId === focusId);
    if (!target) return;
    setFramed({ id: frameKey, points: [focusContact.lonlat, [target.lon, target.lat], ...(f?.ticks.map((t) => t.lonlat) ?? [])] });
  }, [frameKey, hub.forecasts.length, framed?.id]);
  if (!snap) return <div className="rail-empty">Connecting to the hub</div>;

  const watched = snap.contacts.filter((c) => c.classification.kind !== 'friendly');
  const focus = pickContact(watched, selected) ?? pickContact(snap.contacts, selected);
  const driven = snap.contacts.find((c) => c.mode === 'driven') ?? null;
  const incident = !!snap.steps;
  const draft = snap.card?.draftId ? snap.drafts.find((d) => d.id === snap.card?.draftId) ?? null : snap.drafts.find((d) => d.contactId && d.contactId === focus?.id) ?? null;
  const active = snap.notices.filter((n) => n.status === 'active');
  const focusNotice = active.find((n) => n.contactId && n.contactId === focus?.id) ?? null;

  const SIDES: CalloutSide[] = ['ne', 'sw', 'se', 'nw'];
  const callouts: ChartCallout[] = hidden.has('callouts') ? [] : snap.vessels
    .filter((v) => incident && v.affected && !v.id.startsWith('ais-') && v.affected.priority !== 'P4')
    .sort((a, b) => a.lonlat[0] - b.lonlat[0])
    .map((v, i) => ({
      id: v.id, boat: v.name, lonlat: v.lonlat, side: SIDES[i % SIDES.length],
      when: v.affected?.crossingLabel ? `crosses at ${v.affected.crossingLabel}` : 'near its route',
      action: (v.affected?.text ?? '').startsWith('NO ACTION') ? 'HEADS-UP ONLY' : v.affected?.text ?? '',
    }));

  const handles: ZoneHandle[] = hidden.has('zones') || tool !== 'select' ? [] : snap.zones
    .filter((z) => (z.area !== null || z.movingTowardDeg === null) && z.radiusM > 0 && (z.status === 'draft' || active.some((n) => n.zoneId === z.id)))
    .map((z) => {
      const n = active.find((x) => x.zoneId === z.id) ?? snap.drafts.find((d) => d.zoneId === z.id);
      return { id: z.id, center: z.center, radiusM: z.radiusM, label: n ? `${n.label ?? n.publicReason}, ${z.status === 'draft' ? 'draft' : 'published'}` : z.reason };
    });
  const flagged = snap.vessels.filter((v) => v.intel && v.intel.level !== 'normal').sort((a, b) => (b.intel?.score ?? 0) - (a.intel?.score ?? 0)).slice(0, 6);
  const inspectedVessel = inspect?.kind === 'vessel' ? snap.vessels.find((v) => v.id === inspect.id) ?? null : null;
  const dossierContact = inspect?.kind === 'contact' ? snap.contacts.find((c) => c.id === inspect.id) ?? null : null;
  const centerOn = (points: [number, number][]) => setRecenter({ id: `${Date.now()}`, points: points.length === 1 ? [[points[0][0] - 0.006, points[0][1] - 0.004], [points[0][0] + 0.006, points[0][1] + 0.004]] : points });
  const onMode = (mode: 'live' | 'sim') => {
    if (mode === snap.mode) return;
    void hub.send('reset', { mode: mode === 'live' ? 'live' : 'tuesday' });
    if (mode === 'sim') setPresenter(true);
  };

  const onDrop = (lonlat: [number, number]) => {
    if (tool === 'whale' || tool === 'divers' || tool === 'dredge' || tool === 'closure') void hub.send('dropZone', { kind: tool, lonlat });
    if (tool.startsWith('sighting:')) void hub.send('reportSighting', { species: tool.slice('sighting:'.length) as never, lonlat });
    if (tool === 'dive') setDivePoint(lonlat);
    setTool('select');
  };

  return (
    <div className={`cmd${incident ? ' incident' : ''}`} data-theme={theme} style={{ ['--rail-w' as string]: `${rail.size}px` }}>
      <TopBar snap={snap} link={hub.link} onOrders={() => setSheet('orders')} onJoin={() => setSheet('join')} onModels={() => setSheet('models')} onMode={onMode} />
      <div className="cmd-main">
        <Headline h={snap.headline} level={focus?.risk?.level ?? null} />
        {snap.steps ? <StepStrip steps={snap.steps} /> : null}
        <div className="cmd-chart">
          <ChartMap theme={theme} data={data} stamp={snap.clock.wallMs} callouts={callouts} fitTo={recenter?.points ?? framed?.points ?? null} padding={{ top: 80, right: 120, bottom: 80, left: 120 }}
            mode={tool === 'drive' ? 'drive' : tool === 'select' ? 'select' : 'drop'}
            showLabels={!hidden.has('labels')}
            handles={handles}
            onResize={(zoneId, radiusM) => void hub.send('resizeZone', { zoneId, radiusM })}
            onSelect={(kind, id) => { if (kind === 'contact') { setSelected(id); setInspect({ kind: 'contact', id }); setWhy(false); } else setInspect({ kind: 'vessel', id }); }}
            onPointer={(lonlat) => { if (driven) void hub.send('drive', { contactId: driven.id, lonlat }); }}
            onDrop={onDrop}
            labels={hidden.has('labels') ? [] : [
              ...snap.contacts.map((c) => ({ id: c.id, text: c.label, lonlat: c.lonlat })),
              ...snap.vessels.filter((v) => v.phone?.joined && !v.affected).map((v) => ({ id: v.id, text: `${v.name}, phone`, lonlat: v.lonlat })),
            ]} />
          <DeskTools tool={tool} setTool={setTool} onDivePlans={() => setDeskOpen(!deskOpen)} />
          <ChartCorner onPresenter={() => setPresenter(!presenter)} presenterOpen={presenter} hidden={hidden} onLayer={toggleLayer} />
          {tool === 'drive' && driven ? <DriveControl c={driven} send={hub.send} onStop={() => setTool('select')} /> : null}
          {dossierContact ? <ContactDossier c={dossierContact} onClose={() => setInspect(null)} onCenter={() => centerOn([dossierContact.lonlat])} /> : null}
          {inspectedVessel && tool !== 'drive' ? <VesselInspector v={inspectedVessel} onClose={() => setInspect(null)} onCenter={() => centerOn([inspectedVessel.lonlat])} /> : null}
          <span className="chart-attr">Map data: OpenStreetMap contributors</span>
        </div>
        {!incident || deskOpen ? (
          <div className="cmd-desk" style={{ ['--desk-h' as string]: `${desk.size}px` }}>
            <div className="grip y" onPointerDown={desk.onPointerDown} onDoubleClick={desk.reset} title="Drag to resize. Double-click to reset." data-testid="desk-grip" />
            <DeskRail snap={snap} send={hub.send} divePoint={divePoint} onPickDive={() => setTool('dive')} />
          </div>
        ) : null}
        {why && !dossierContact ? <WhyDrawer snap={snap} c={focus} plan={(draft ?? focusNotice)?.plan ?? null} onClose={() => setWhy(false)} /> : null}
      </div>
      <div className="cmd-rail-wrap">
      <div className="grip x" onPointerDown={rail.onPointerDown} onDoubleClick={rail.reset} title="Drag to resize. Double-click to reset." data-testid="rail-grip" />
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
        {focus && focus.classification.kind !== 'friendly' ? <ContactBlock c={focus} onDossier={() => { setWhy(false); setInspect({ kind: 'contact', id: focus.id }); }} /> : null}
        {(incident ? active.filter((n) => n.kind === 'security') : []).map((n) => <PublishedNotice key={n.id} n={n} snap={snap} send={hub.send} />)}
        {!incident ? (
          <section className="rail-block" data-testid="today-summary">
            <div className="block-title"><span className="t-heading">Today so far</span>{snap.report.simulatedShare > 0 ? <span className="t-small c-muted">Simulated schedule</span> : null}</div>
            {snap.report.lines.map((l, i) => <p key={i} className="t-body">{l}</p>)}
            {active.length ? <button className="link t-small" data-testid="all-clear" onClick={() => void hub.send('allClear', {})}>All clear for every zone</button> : null}
          </section>
        ) : null}
        {flagged.length ? (
          <section className="rail-block" data-testid="ships-to-watch">
            <div className="block-title"><span className="t-heading">Ships to watch</span><span className="t-small c-muted">Traffic model, real AIS</span></div>
            {flagged.map((v) => (
              <button key={v.id} className={`watch-row ${v.intel?.level}`} onClick={() => setInspect({ kind: 'vessel', id: v.id })} data-testid={`watch-${v.id}`}>
                <span className="name">{v.name}</span>
                <span className="mono">{Math.round((v.intel?.score ?? 0) * 100)}</span>
                <span className="why">{v.intel?.reasons[0] ?? ''}</span>
              </button>
            ))}
          </section>
        ) : null}
        {!focus && !snap.card && !active.length ? (
          <div className="rail-empty">
            <span className="t-heading c-text">Nothing unknown in the harbor</span>
            <span>{snap.vessels.filter((v) => v.source === 'simulated').length} simulated boats on their routes and {snap.vessels.filter((v) => v.source !== 'simulated').length} real ships from AIS.</span>
          </div>
        ) : null}
        {!incident && active.length ? <div className="rail-calm"><CheckCircle size={16} />{active.some((n) => n.approvedBy.startsWith('Standing Orders')) ? 'Every notice was approved by the officer or published under the officer\'s Standing Orders.' : 'Every notice was approved by the officer.'}</div> : null}
      </aside>
      </div>
      <Presenter open={presenter} onClose={() => setPresenter(false)} send={hub.send} timeScale={snap.clock.timeScale} paused={snap.clock.paused}
        focus={focus} driven={driven} tool={tool} setTool={setTool} theme={theme} onTheme={() => setThemeChoice(theme === 'night' ? 'day' : 'night')}
        onNights={() => setSheet('nights')} />
      {sheet === 'nights' ? <NightsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'orders' ? <OrdersSheet snap={snap} send={hub.send} onClose={() => setSheet(null)} /> : null}
      {sheet === 'join' ? <JoinSheet snap={snap} onClose={() => setSheet(null)} /> : null}
      {sheet === 'models' ? <ModelsPanel models={snap.models} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
