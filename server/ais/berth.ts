import type { AisVessel } from '../../src/shared/ais-types';
import { distanceMeters } from './geo';
import { NAV_AT_ANCHOR, NAV_MOORED } from './normalize';
import type { HarborPoint } from './settings';

export interface BerthSettings {
  ais: { berthRadiusMeters: number; berthedMaxKnots: number; berthMinLengthM: number };
}

export type VesselSource = AisVessel[] | { vessels(now?: number): AisVessel[] };

export function vesselList(source: VesselSource, now?: number): AisVessel[] {
  return Array.isArray(source) ? source : source.vessels(now);
}

export function isPassengerType(shipType: number): boolean {
  return shipType >= 60 && shipType <= 69;
}

export function isBerthSizedVessel(vessel: AisVessel, settings: BerthSettings): boolean {
  return isPassengerType(vessel.shipType) || (vessel.lengthM !== null && vessel.lengthM > settings.ais.berthMinLengthM);
}

export function isStopped(vessel: AisVessel, settings: BerthSettings): boolean {
  if (vessel.navStatus.code === NAV_MOORED || vessel.navStatus.code === NAV_AT_ANCHOR) return true;
  return vessel.sogKn !== null && vessel.sogKn <= settings.ais.berthedMaxKnots;
}

export function berthedAt(source: VesselSource, target: HarborPoint, settings: BerthSettings, now?: number): AisVessel | null {
  let best: AisVessel | null = null;
  let bestDistance = Infinity;
  for (const vessel of vesselList(source, now)) {
    if (!isBerthSizedVessel(vessel, settings) || !isStopped(vessel, settings)) continue;
    const distance = distanceMeters([vessel.lon, vessel.lat], [target.lon, target.lat]);
    if (distance > settings.ais.berthRadiusMeters || distance >= bestDistance) continue;
    best = vessel;
    bestDistance = distance;
  }
  return best;
}

export function consequenceIdFor(source: VesselSource, target: HarborPoint, settings: BerthSettings, now?: number): string {
  const id = target.id ?? target.name;
  if (!target.emptyId) return id;
  return berthedAt(source, target, settings, now) ? id : target.emptyId;
}
