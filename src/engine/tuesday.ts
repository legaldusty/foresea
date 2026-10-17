import { rng } from './bench';
import { bearingDeg, metersBetween, type LonLat } from './geo';
import type { Settings } from './settings';
import type { Sighting, Species } from '../shared/protocol';

export interface WorkLine {
  points: LonLat[];
  cumulative: number[];
  lengthM: number;
}

export function workLine(points: LonLat[]): WorkLine {
  const cumulative = [0];
  for (let k = 1; k < points.length; k++) cumulative.push(cumulative[k - 1] + metersBetween(points[k - 1], points[k]));
  return { points, cumulative, lengthM: cumulative[cumulative.length - 1] };
}

export function pointAlong(line: WorkLine, meters: number): { lonlat: LonLat; bearing: number } {
  const m = Math.max(0, Math.min(line.lengthM, meters));
  for (let k = 1; k < line.points.length; k++) {
    if (m <= line.cumulative[k] || k === line.points.length - 1) {
      const a = line.points[k - 1];
      const b = line.points[k];
      const span = line.cumulative[k] - line.cumulative[k - 1] || 1;
      const f = (m - line.cumulative[k - 1]) / span;
      return { lonlat: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearingDeg(a, b) };
    }
  }
  return { lonlat: line.points[0], bearing: 0 };
}

export function stepAlong(line: WorkLine, meters: number, direction: 1 | -1, distance: number): { meters: number; direction: 1 | -1 } {
  let next = meters + direction * distance;
  let dir = direction;
  if (next > line.lengthM) { next = 2 * line.lengthM - next; dir = -1; }
  if (next < 0) { next = -next; dir = 1; }
  return { meters: Math.max(0, Math.min(line.lengthM, next)), direction: dir };
}

interface SightingRegion {
  species: Species;
  weight: number;
  west: number;
  east: number;
  south: number;
  north: number;
}

const REGIONS: SightingRegion[] = [
  { species: 'sea lion', weight: 0.34, west: -118.262, east: -118.200, south: 33.7065, north: 33.7095 },
  { species: 'dolphin', weight: 0.24, west: -118.268, east: -118.215, south: 33.711, north: 33.724 },
  { species: 'whale', weight: 0.16, west: -118.255, east: -118.170, south: 33.690, north: 33.701 },
  { species: 'debris', weight: 0.16, west: -118.272, east: -118.200, south: 33.712, north: 33.748 },
  { species: 'hazard', weight: 0.10, west: -118.265, east: -118.205, south: 33.715, north: 33.742 },
];

const REPORTERS: { name: string; source: Sighting['source'] }[] = [
  { name: 'Catalina Ferry', source: 'phone' },
  { name: 'Harbor Launch 7', source: 'phone' },
  { name: 'Pilot Boat 2', source: 'phone' },
  { name: 'Harbor desk', source: 'desk' },
  { name: 'AltaSea Research', source: 'researcher' },
  { name: 'Ship crew', source: 'ship crew' },
];

const NOTES: Record<Species, string[]> = {
  'sea lion': ['Hauled out on the breakwater', 'Group of four in the water', 'One adult near the light'],
  dolphin: ['Pod of about ten heading east', 'Two adults with a calf', 'Bow riding a tug'],
  whale: ['Blow seen, heading southeast', 'Surfaced twice near the lane', 'Fluke up, deep dive'],
  debris: ['Floating timber about 3 m', 'Lost mooring buoy', 'Pallet in the fairway'],
  hazard: ['Oil sheen about 50 m across', 'Drifting line near the channel', 'Swamped dinghy'],
};

function pickRegion(u: number): SightingRegion {
  let acc = 0;
  for (const r of REGIONS) { acc += r.weight; if (u <= acc) return r; }
  return REGIONS[REGIONS.length - 1];
}

export function seedSightings(settings: Settings, todayStartMin: number): Sighting[] {
  const h = settings.tuesday.history;
  const rand = rng(h.seed);
  const out: Sighting[] = [];
  for (let k = 0; k < h.count; k++) {
    const region = pickRegion(rand());
    const day = -1 - Math.floor(rand() * h.days);
    const minute = 6 * 60 + Math.floor(rand() * 12 * 60);
    const reporter = REPORTERS[Math.floor(rand() * REPORTERS.length)];
    const notes = NOTES[region.species];
    out.push({
      id: `s-seed-${k + 1}`,
      species: region.species,
      lonlat: [region.west + (region.east - region.west) * rand(), region.south + (region.north - region.south) * rand()],
      atMin: todayStartMin + day * 1440 + minute,
      dayOffset: day,
      whenLabel: '',
      source: reporter.source,
      reporter: reporter.name,
      status: 'confirmed',
      simulated: true,
      note: notes[Math.floor(rand() * notes.length)],
    });
  }
  return out.sort((a, b) => b.atMin - a.atMin);
}

export function sightingsCsv(rows: Sighting[]): string {
  const head = 'id,species,latitude,longitude,time_minutes,day_offset,source,reporter,status,simulated,note';
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [head, ...rows.map((r) => [r.id, r.species, r.lonlat[1].toFixed(5), r.lonlat[0].toFixed(5), Math.round(r.atMin), r.dayOffset, r.source, esc(r.reporter), r.status, r.simulated ? 'yes' : 'no', esc(r.note)].join(','))].join('\n');
}

export function sightingsGeoJson(rows: Sighting[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      properties: { id: r.id, species: r.species, timeMinutes: Math.round(r.atMin), dayOffset: r.dayOffset, source: r.source, reporter: r.reporter, status: r.status, simulated: r.simulated, note: r.note },
      geometry: { type: 'Point', coordinates: r.lonlat },
    })),
  };
}
