import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, MapPin, PaperPlaneTilt } from '@phosphor-icons/react';
import type { CaptainSnapshot, Species } from '../../shared/protocol';
import { bearingDeg, compassPoint, formatMeters, metersBetween, type LonLat } from '../../engine/geo';
import { ChartMap } from '../map/ChartMap';
import { captainChart, YOU_TAG_ID } from '../map/toChart';
import { harborBounds } from '../map/chartData';
import { Button } from '../ui';
import { ChoiceRow, Header, MapControls, Num, Pin, pinForSpecies } from './parts';
import { boatBox, formatLatLon } from './frame';

export const SPECIES: { value: Species; label: string; testId: string }[] = [
  { value: 'whale', label: 'Whale', testId: 'species-whale' },
  { value: 'dolphin', label: 'Dolphin', testId: 'species-dolphin' },
  { value: 'sea lion', label: 'Sea lion', testId: 'species-sea-lion' },
  { value: 'debris', label: 'Debris', testId: 'species-debris' },
  { value: 'hazard', label: 'Other hazard', testId: 'species-hazard' },
];

const GPS_MARGIN_DEG = 0.05;

function inHarbor(p: LonLat): boolean {
  const [w, s, e, n] = harborBounds;
  return p[0] >= w - GPS_MARGIN_DEG && p[0] <= e + GPS_MARGIN_DEG && p[1] >= s - GPS_MARGIN_DEG && p[1] <= n + GPS_MARGIN_DEG;
}

function fromBoat(boat: LonLat | null, p: LonLat): string | null {
  if (!boat) return null;
  const d = metersBetween(boat, p);
  if (d < 30) return 'At your boat';
  return `${formatMeters(d)} ${compassPoint(bearingDeg(boat, p))} of you`;
}

function speciesLabel(s: Species | null): string {
  return SPECIES.find((x) => x.value === s)?.label ?? 'Sighting';
}

interface Here { lonlat: LonLat; source: 'gps' | 'boat' }
interface Sent { at: string; species: Species; lonlat: LonLat; note: string; where: string }
type Step = 'choose' | 'pick' | 'sent';

export function ReportFlow(props: {
  snap: CaptainSnapshot | null; theme: 'day' | 'night'; onTheme: () => void; stamp?: number;
  onSend: (r: { species: Species; lonlat: LonLat; note?: string }) => Promise<boolean>; onClose: () => void;
}) {
  const boat = props.snap?.vessel?.lonlat ?? null;
  const [step, setStep] = useState<Step>('choose');
  const [species, setSpecies] = useState<Species | null>(null);
  const [where, setWhere] = useState<'here' | 'map'>('here');
  const [gps, setGps] = useState<LonLat | null>(null);
  const [spot, setSpot] = useState<LonLat | null>(null);
  const [draft, setDraft] = useState<LonLat | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [centerTick, setCenterTick] = useState(0);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    let live = true;
    navigator.geolocation.getCurrentPosition((p) => {
      const ll: LonLat = [p.coords.longitude, p.coords.latitude];
      if (live && inHarbor(ll)) setGps(ll);
    }, () => undefined, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    return () => { live = false; };
  }, []);

  const here: Here | null = gps ? { lonlat: gps, source: 'gps' } : boat ? { lonlat: boat, source: 'boat' } : null;
  const target = where === 'map' ? spot : here?.lonlat ?? null;

  const pickData = useMemo(() => captainChart(props.snap, 0, { youTag: true, spot: draft }), [props.snap, draft]);
  const pickFit = useMemo(() => (boat ? boatBox(draft ?? boat, 1400) : null), [step, centerTick]);
  const pickLabels = useMemo(() => {
    const out: { id: string; text: string; lonlat: LonLat }[] = [];
    if (boat) out.push({ id: YOU_TAG_ID, text: 'You', lonlat: boat });
    if (draft) {
      out.push({ id: `spot:${draft[0]}:${draft[1]}`, text: '', lonlat: draft });
      if (boat && metersBetween(boat, draft) > 150) out.push({ id: `gap:${draft[0]}:${draft[1]}`, text: formatMeters(metersBetween(boat, draft)), lonlat: [(boat[0] + draft[0]) / 2, (boat[1] + draft[1]) / 2] });
    }
    return out;
  }, [draft, boat?.[0], boat?.[1]]);

  const send = async () => {
    if (!species || !target) return;
    setSending(true);
    setFailed(false);
    const trimmed = note.trim();
    const ok = await props.onSend({ species, lonlat: target, note: trimmed || undefined });
    setSending(false);
    if (!ok) { setFailed(true); return; }
    const rel = fromBoat(boat, target);
    setSent({ at: props.snap?.clock.label ?? '', species, lonlat: target, note: trimmed, where: where === 'here' && here?.source === 'gps' ? 'At your position' : rel ?? 'At your position' });
    setStep('sent');
  };

  if (step === 'pick') {
    const rel = draft ? fromBoat(boat, draft) : null;
    return (
      <div className="cap-screen" data-testid="report-pick">
        <Header title="Tap where you saw it" onBack={() => setStep('choose')} testId="pick-back" />
        <div className="cap-map cap-pick" data-pin={species && pinForSpecies(species) === 'hazard' ? 'hazard' : 'animal'}>
          <ChartMap key={props.theme} theme={props.theme} compact showLabels mode="drop" onDrop={setDraft} data={pickData} fitTo={pickFit} padding={{ top: 40, right: 40, bottom: 40, left: 40 }} stamp={props.stamp} motionDelayMs={600} labels={pickLabels} />
          <MapControls theme={props.theme} onCenter={() => setCenterTick(centerTick + 1)} onTheme={props.onTheme} />
          <span className="cap-attr">© OpenStreetMap contributors</span>
        </div>
        <div className="cap-spot">
          {draft ? (
            <div className="what">
              <Pin kind={pinForSpecies(species ?? 'whale')} />
              <span className="text">
                <span className="t-heading">{speciesLabel(species)}</span>
                {rel ? <span className="t-body"><Num text={rel} /></span> : null}
                <span className="coords">{formatLatLon(draft)}</span>
              </span>
            </div>
          ) : (
            <p className="t-body c-muted">Tap the chart where you saw it.</p>
          )}
          <Button variant="primary" size="l" block icon={<MapPin size={20} />} disabled={!draft} onClick={() => { if (draft) { setSpot(draft); setWhere('map'); setStep('choose'); } }} testId="use-spot">Use this spot</Button>
        </div>
      </div>
    );
  }

  if (step === 'sent' && sent) {
    const animal = pinForSpecies(sent.species) === 'whale';
    return (
      <div className="cap-screen" data-testid="sighting-sent">
        <Header title="Report a sighting" onBack={props.onClose} close testId="sent-close" />
        <div className="scroll pad">
          <div className="cap-confirm">
            <CheckCircle size={24} className="ok" />
            <span className="text">
              <span className="t-title">The harbor desk received your report.</span>
              <span className="t-body c-muted">Received <span className="num">{sent.at}</span>. Thank you.</span>
            </span>
          </div>
          <div className="cap-details">
            <div className="row"><span className="k">What</span><span className="v">{speciesLabel(sent.species)}</span></div>
            <div className="row"><span className="k">Where</span><span className="v"><Num text={sent.where} /><span className="coords">{formatLatLon(sent.lonlat)}</span></span></div>
            {sent.note ? <div className="row"><span className="k">Note</span><span className="v">{sent.note}</span></div> : null}
            <div className="row"><span className="k">Sent</span><span className="v num">{sent.at}</span></div>
          </div>
          <p className="t-body c-muted">{animal ? 'The watch officer may share it as a Whale nearby notice for boats near that spot.' : 'The watch officer may share it as a notice for boats near that spot.'}</p>
        </div>
        <div className="cap-foot"><Button variant="primary" size="l" block onClick={props.onClose} testId="sent-done">Done</Button></div>
      </div>
    );
  }

  const spotRel = spot ? fromBoat(boat, spot) : null;
  return (
    <div className="cap-screen" data-testid="report">
      <Header title="Report a sighting" onBack={props.onClose} close testId="report-close" />
      <div className="scroll">
        <p className="section">What did you see?</p>
        <div role="radiogroup" aria-label="What did you see?">
          {SPECIES.map((s) => <ChoiceRow key={s.value} label={s.label} selected={species === s.value} onSelect={() => setSpecies(s.value)} testId={s.testId} />)}
        </div>
        <p className="section">Where</p>
        <div role="radiogroup" aria-label="Where">
          <ChoiceRow
            label="At my position"
            meta={here ? <><span className="num">{formatLatLon(here.lonlat)}</span>{here.source === 'boat' ? <span className="simulated">Simulated boat position</span> : null}</> : 'Waiting for a position'}
            selected={where === 'here'} onSelect={() => setWhere('here')} testId="where-here"
          />
          <ChoiceRow
            label="Tap on the map"
            meta={spot ? <>Spot set, <Num text={spotRel ?? formatLatLon(spot)} /></> : 'Choose the spot on the chart'}
            selected={where === 'map'} onSelect={() => { setDraft(spot); setStep('pick'); }} testId="where-map"
          />
        </div>
        <label className="cap-note">
          <span className="label">Note, optional</span>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Two whales, heading south" data-testid="sighting-note" />
        </label>
        {failed ? <p className="cap-error" role="alert">Not sent. Check your connection and try again.</p> : null}
      </div>
      <div className="cap-foot">
        <Button variant="primary" size="l" block icon={<PaperPlaneTilt size={20} />} disabled={!species || !target || sending} onClick={() => void send()} testId="send-sighting">{sending ? 'Sending' : 'Send'}</Button>
      </div>
    </div>
  );
}
