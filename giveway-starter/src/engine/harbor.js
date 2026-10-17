import { loadGrid, nearestWater, distanceField } from './grid.js';

export function buildHarbor(gridJson, harborJson) {
  const grid = loadGrid(gridJson);
  const place = (p) => {
    const [x, y] = grid.toCell(p.lon, p.lat);
    const cell = nearestWater(grid, x, y, 30);
    if (cell < 0) throw new Error(`No water near ${p.name}`);
    return { ...p, cell };
  };
  const targets = harborJson.targets.map(place);
  const spawns = harborJson.spawns.map(place);
  const gates = (harborJson.gates || []).map(place);
  const byName = new Map([...targets.map((t) => [t.id, t]), ...spawns.map((s) => [s.name, s])]);
  const craft = (harborJson.craft || []).map((c) => ({ ...c, fromCell: byName.get(c.from)?.cell, toCell: byName.get(c.to)?.cell }));
  return { grid, targets, spawns, gates, craft, orders: harborJson.orders || {}, meta: gridJson };
}

export function checkReachability(h) {
  const problems = [];
  for (const t of h.targets) {
    const D = distanceField(h.grid, t.cell);
    for (const s of h.spawns) if (!isFinite(D[s.cell])) problems.push(`${t.name} unreachable from ${s.name}`);
  }
  return problems;
}
