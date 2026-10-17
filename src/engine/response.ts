import type { GridLike } from './zones';
import { dilate, passesNear, rerouteAround, routeEntersMask, type RerouteResult } from './routing';
import { minutesUntilZone, priorityFor, type Priority } from './priority';
import type { Crossing, PricedFix } from './conflicts';

export type ResponseKind = 'watch' | 'speedAdvisory' | 'reroute' | 'hold' | 'closeChannel' | 'giveWay';

export type Instruction = 'KEEP CLEAR' | 'SLOW' | 'USE EAST CHANNEL' | 'USE MAIN CHANNEL' | 'WAIT' | 'LEAVE ZONE' | 'ALL CLEAR';

export interface Boat {
  id: string;
  name: string;
  route: number[];
  speedMps: number;
  smallCraft: boolean;
}

export interface NamedPlace {
  id: string;
  name: string;
  cell: number;
}

export interface BoatImpact {
  id: string;
  name: string;
  onRoute: boolean;
  nearPath: boolean;
  insideNow: boolean;
  minutesToZone: number | null;
  priority: Priority;
  action: 'none' | 'slow' | 'reroute' | 'leave' | 'wait' | 'hold' | 'stepAside' | 'headsUp';
  instruction: Instruction;
  addedMin: number;
  reroute: RerouteResult | null;
  text?: string;
  crossing?: Crossing | null;
  untilMin?: number | null;
  fix?: PricedFix | null;
  options?: PricedFix[];
  noGentle?: boolean;
}

export interface ResponseRules {
  maxDelayPerBoatMin: number;
  speedAdvisoryKnots: number;
  speedAdvisoryMaxDelayMin: number;
  advisoryMarginCells: number;
  p1Minutes: number;
  p2Minutes: number;
  floor: Priority | null;
  ceiling: Priority | null;
  nearbyCells: number;
  channelNearCells: number;
}

export interface ResponsePlan {
  kind: ResponseKind;
  affected: BoatImpact[];
  everyone: BoatImpact[];
  totalAddedMin: number;
  maxAddedMin: number;
  clears: boolean;
  withinOrders: boolean;
  blockedBerth: string | null;
  reasons: string[];
  nextStepUp: { kind: ResponseKind | 'closeHarbor'; text: string };
  comparison: { chosen: string; closeHarbor: string };
}

const KNOT = 0.514444;

function channelInstruction(grid: GridLike, impact: RerouteResult, oldRoute: number[], places: NamedPlace[], nearCells: number): Instruction {
  for (const place of places) {
    if (passesNear(grid, impact.cells, place.cell, nearCells) && !passesNear(grid, oldRoute, place.cell, nearCells)) {
      return place.id === 'mainChannel' ? 'USE MAIN CHANNEL' : 'USE EAST CHANNEL';
    }
  }
  return 'KEEP CLEAR';
}

function advisoryDelay(grid: GridLike, route: number[], nearMask: Uint8Array, speedMps: number, advisoryMps: number): number {
  if (speedMps <= advisoryMps) return 0;
  let cellsNear = 0;
  for (const c of route) if (nearMask[c]) cellsNear++;
  const meters = cellsNear * grid.cellMeters;
  return (meters / advisoryMps - meters / speedMps) / 60;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function chooseResponse(grid: GridLike, mask: Uint8Array, boats: Boat[], places: NamedPlace[], rules: ResponseRules, berthName: string | null): ResponsePlan {
  const nearMask = dilate(grid, mask, rules.advisoryMarginCells);
  const nearbyMask = dilate(grid, mask, rules.nearbyCells);
  const advisoryMps = rules.speedAdvisoryKnots * KNOT;
  const reasons: string[] = [];
  const everyone: BoatImpact[] = boats.map((b) => {
    const onRoute = routeEntersMask(b.route, mask);
    const insideNow = b.route.length > 0 && mask[b.route[0]] === 1;
    const nearPath = !onRoute && routeEntersMask(b.route, nearMask);
    const nearby = onRoute || routeEntersMask(b.route, nearbyMask);
    const minutesToZone = onRoute ? minutesUntilZone(grid, b.route, mask, b.speedMps) : null;
    const priority = priorityFor(minutesToZone, { p1Minutes: rules.p1Minutes, p2Minutes: rules.p2Minutes, floor: rules.floor, ceiling: rules.ceiling, nearby });
    return { id: b.id, name: b.name, onRoute, nearPath, insideNow, minutesToZone, priority, action: 'none', instruction: 'KEEP CLEAR', addedMin: 0, reroute: null };
  });
  const onRoute = everyone.filter((e) => e.onRoute);
  const near = everyone.filter((e) => e.nearPath);
  const closeHarbor = 'Closing the harbor: every ship delayed';

  if (!onRoute.length && !near.length) {
    reasons.push('No boat route crosses the zone or passes near it.');
    return {
      kind: 'watch', affected: [], everyone, totalAddedMin: 0, maxAddedMin: 0, clears: true, withinOrders: true, blockedBerth: null, reasons,
      nextStepUp: { kind: 'speedAdvisory', text: 'Speed advisory: a minute or two per boat' },
      comparison: { chosen: 'Watching: no boats in the path', closeHarbor },
    };
  }

  for (const e of near) {
    const boat = boats.find((b) => b.id === e.id) as Boat;
    e.action = 'slow';
    e.instruction = 'SLOW';
    e.addedMin = Math.min(rules.speedAdvisoryMaxDelayMin, advisoryDelay(grid, boat.route, nearMask, boat.speedMps, advisoryMps));
  }

  if (!onRoute.length) {
    const total = near.reduce((s, e) => s + e.addedMin, 0);
    reasons.push(`${plural(near.length, 'boat passes', 'boats pass')} near the predicted path; none enters the zone.`);
    return {
      kind: 'speedAdvisory', affected: near, everyone, totalAddedMin: total, maxAddedMin: Math.max(0, ...near.map((e) => e.addedMin)),
      clears: true, withinOrders: true, blockedBerth: null, reasons,
      nextStepUp: { kind: 'reroute', text: 'Reroute boats out of the zone' },
      comparison: { chosen: `Slowing: ${plural(near.length, 'boat', 'boats')}, +${Math.round(total)} min total`, closeHarbor },
    };
  }

  let blocked = false;
  for (const e of onRoute) {
    const boat = boats.find((b) => b.id === e.id) as Boat;
    const r = rerouteAround(grid, boat.route, mask, boat.speedMps);
    e.reroute = r;
    if (r.status === 'destinationInZone' || r.status === 'noPath') {
      blocked = true;
      e.action = 'wait';
      e.instruction = 'WAIT';
      e.addedMin = 0;
    } else {
      e.action = r.status === 'leaveZone' ? 'leave' : 'reroute';
      e.instruction = r.status === 'leaveZone' ? 'LEAVE ZONE' : channelInstruction(grid, r, boat.route, places, rules.channelNearCells);
      e.addedMin = r.addedMin;
    }
  }

  const affected = [...onRoute, ...near];
  const total = affected.reduce((s, e) => s + e.addedMin, 0);
  const maxAdded = Math.max(0, ...affected.map((e) => e.addedMin));

  if (blocked) {
    const waiting = onRoute.filter((e) => e.action === 'wait');
    const moving = affected.filter((e) => e.action !== 'wait');
    reasons.push(`The zone covers the way in for ${plural(waiting.length, 'boat', 'boats')}; no reroute can clear it, so holding the berth is recommended.`);
    const rerouted = moving.length ? `Rerouting ${plural(moving.length, 'boat', 'boats')}, +${Math.round(total)} min; ` : '';
    return {
      kind: 'hold', affected, everyone, totalAddedMin: total, maxAddedMin: maxAdded, clears: false, withinOrders: maxAdded <= rules.maxDelayPerBoatMin, blockedBerth: berthName, reasons,
      nextStepUp: { kind: 'closeChannel', text: 'Close one channel: delay for every ship using it' },
      comparison: { chosen: `${rerouted}${plural(waiting.length, 'boat waits', 'boats wait')} for ${berthName ?? 'the berth'}`, closeHarbor },
    };
  }

  const withinOrders = maxAdded <= rules.maxDelayPerBoatMin;
  if (!withinOrders) reasons.push(`One reroute adds ${Math.round(maxAdded)} min, over the signed limit of ${rules.maxDelayPerBoatMin} min per boat.`);
  reasons.push(`${plural(onRoute.length, 'boat route crosses', 'boat routes cross')} the zone; each can be rerouted around it.`);
  return {
    kind: 'reroute', affected, everyone, totalAddedMin: total, maxAddedMin: maxAdded, clears: true, withinOrders, blockedBerth: null, reasons,
    nextStepUp: { kind: 'hold', text: `Hold ${berthName ?? 'the berth'}: delay for ships due there` },
    comparison: { chosen: `Rerouting: ${plural(affected.length, 'boat', 'boats')}, +${Math.round(total)} min total`, closeHarbor },
  };
}

export function instructionText(instruction: Instruction, radiusM: number, slowKnots: number): string {
  switch (instruction) {
    case 'KEEP CLEAR': return `KEEP ${Math.round(radiusM / 50) * 50} m CLEAR`;
    case 'SLOW': return `SLOW TO ${slowKnots} KNOTS`;
    case 'USE EAST CHANNEL': return 'USE EAST CHANNEL';
    case 'USE MAIN CHANNEL': return 'USE MAIN CHANNEL';
    case 'WAIT': return 'WAIT';
    case 'LEAVE ZONE': return 'LEAVE THE ZONE NOW';
    case 'ALL CLEAR': return 'ALL CLEAR';
  }
}
