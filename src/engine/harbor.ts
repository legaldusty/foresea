import { distanceField, loadGrid, nearestWater, type Grid, type GridJson } from './grid';
import { defaultSettings, type Settings } from './settings';

type HarborSettings = Settings['harbor'];

export type TargetSpec = HarborSettings['targets'][number] & { emptyId?: string };
export type SpawnSpec = HarborSettings['spawns'][number];
export type GateSpec = HarborSettings['gates'][number];
export type PlaceSpec = HarborSettings['places'][number];
export type CraftSpec = HarborSettings['craft'][number] & { ignoresNotices?: boolean };
export type RegistryEntry = HarborSettings['registry'][number] & { divePlan?: boolean };

export type Placed<T> = T & { cell: number };

export type HarborTarget = Placed<TargetSpec>;
export type HarborSpawn = Placed<SpawnSpec>;
export type HarborGate = Placed<GateSpec>;
export type HarborPlace = Placed<PlaceSpec>;
export type HarborCraft = CraftSpec & { fromCell: number | undefined; toCell: number | undefined };

export interface Harbor {
  grid: Grid;
  targets: HarborTarget[];
  spawns: HarborSpawn[];
  gates: HarborGate[];
  places: HarborPlace[];
  craft: HarborCraft[];
  registry: RegistryEntry[];
  fields: Float32Array[];
  meta: GridJson;
}

interface Locatable {
  name: string;
  lon: number;
  lat: number;
}

function placer(grid: Grid, searchCells: number) {
  return <T extends Locatable>(p: T): Placed<T> => {
    const [x, y] = grid.toCell(p.lon, p.lat);
    const cell = nearestWater(grid, x, y, searchCells);
    if (cell < 0) throw new Error(`No water near ${p.name}`);
    return { ...p, cell };
  };
}

function cellsByName(targets: HarborTarget[], spawns: HarborSpawn[]): Map<string, number> {
  return new Map<string, number>([
    ...targets.map((t): [string, number] => [t.id, t.cell]),
    ...spawns.map((s): [string, number] => [s.name, s.cell]),
  ]);
}

export function buildHarbor(gridJson: GridJson, settings: Settings = defaultSettings): Harbor {
  const grid = loadGrid(gridJson);
  const spec = settings.harbor;
  const place = placer(grid, spec.placeSearchCells);
  const targets: HarborTarget[] = spec.targets.map((t) => place(t as TargetSpec));
  const spawns = spec.spawns.map(place);
  const gates = (spec.gates ?? []).map(place);
  const places = (spec.places ?? []).map(place);
  const byName = cellsByName(targets, spawns);
  const craft: HarborCraft[] = (spec.craft ?? []).map((c) => ({ ...(c as CraftSpec), fromCell: byName.get(c.from), toCell: byName.get(c.to) }));
  const registry = (spec.registry ?? []) as RegistryEntry[];
  const fields = targets.map((t) => distanceField(grid, t.cell));
  return { grid, targets, spawns, gates, places, craft, registry, fields, meta: gridJson };
}

export function targetIndex(h: Pick<Harbor, 'targets'>, id: string): number {
  return h.targets.findIndex((t) => t.id === id);
}

export function checkReachability(h: Harbor): string[] {
  const problems: string[] = [];
  h.targets.forEach((t, g) => {
    const D = h.fields[g];
    for (const s of h.spawns) if (!isFinite(D[s.cell])) problems.push(`${t.name} unreachable from ${s.name}`);
  });
  return problems;
}
