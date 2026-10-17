import type { CommandSnapshot } from '../../shared/protocol';
import type { ChartHit } from '../map/ChartMap';
import { clockOf } from '../format';

const KNOTS = 1.94384;

function compass(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return '';
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function describeHit(snap: CommandSnapshot, hit: ChartHit): { title: string; lines: string[] } | null {
  if (hit.kind === 'contact') {
    const c = snap.contacts.find((x) => x.id === hit.id);
    if (!c) return null;
    const f = c.forecast;
    return {
      title: `${c.label}: ${c.classification.label}`,
      lines: [
        c.risk ? `Risk ${c.risk.score} of 25, ${c.risk.level}` : 'Not scored',
        `${c.sizeM.toFixed(1)} m, ${(c.speedMps * KNOTS).toFixed(1)} kn ${compass(c.headingDeg)}`,
        f?.topName ? `Heading to ${f.topName} (${Math.round((f.topP ?? 0) * 100)}%)${f.arrival ? `, arrives ${f.arrival.earlyLabel}` : ''}` : 'Destination not called yet',
        'Click for the full dossier',
      ],
    };
  }
  if (hit.kind === 'vessel') {
    const v = snap.vessels.find((x) => x.id === hit.id);
    if (!v) return null;
    const src = v.source === 'simulated' ? 'Simulated' : v.source === 'ais-live' ? 'AIS live' : 'AIS replay';
    const kind = v.type.charAt(0).toUpperCase() + v.type.slice(1);
    const lines = [`${kind}${v.lengthM ? `, ${Math.round(v.lengthM)} m` : ''}. ${src}`];
    if (v.detail) lines.push(`${v.detail.sogKn.toFixed(1)} kn ${compass(v.detail.cogDeg)}${v.detail.destination ? `, bound for ${v.detail.destination}` : ''}`);
    if (v.affected && v.affected.priority !== 'P4') lines.push(`${v.affected.priority}: ${v.affected.text}${v.affected.crossingLabel ? `, crosses ${v.affected.crossingLabel}` : ''}`);
    if (v.intel && v.intel.level !== 'normal') lines.push(`Traffic model: ${v.intel.reasons[0] ?? v.intel.level}`);
    if (v.phone?.joined) lines.push('Captain phone joined');
    lines.push('Click for details');
    return { title: v.name, lines };
  }
  if (hit.kind === 'zone') {
    const z = snap.zones.find((x) => x.id === hit.id);
    if (!z) return null;
    const n = snap.notices.find((x) => x.zoneId === z.id && x.status === 'active');
    const d = n ? null : snap.drafts.find((x) => x.zoneId === z.id);
    const doc = n ?? d;
    if (!doc) return null;
    return {
      title: doc.label ?? doc.publicReason,
      lines: [
        doc.instructionText,
        n ? `Until ${clockOf(n.expiresAtMin)}. Approved by ${n.approvedBy}` : 'Draft, not published',
        doc.filedBy ? `Filed by ${doc.filedBy}` : z.area ? 'Forecast area plus keep-clear circle' : `${z.radiusM} m radius`,
        'Click to inspect or change',
      ],
    };
  }
  if (hit.kind === 'forecast') {
    const c = snap.contacts.find((x) => x.id === hit.id);
    const red = hit.layer === 'likely';
    return {
      title: red ? 'Where it is going' : 'Be careful here',
      lines: [
        red ? 'Half of the simulated futures stay inside the red' : 'At least 1 in 8 simulated futures pass through the yellow',
        c ? `Forecast for ${c.label}, next 30 minutes` : 'Forecast, next 30 minutes',
      ],
    };
  }
  if (hit.kind === 'sighting') {
    const x = snap.sightings.find((s) => s.id === hit.id);
    if (!x) return null;
    const name = x.species.charAt(0).toUpperCase() + x.species.slice(1);
    return {
      title: `${name} sighting`,
      lines: [
        `${x.status === 'confirmed' ? 'Confirmed' : 'Reported, not confirmed yet'}. ${clockOf(x.atMin)}, from ${x.reporter} (${x.source})`,
        x.note ? x.note : x.species === 'whale' ? 'Large ships slow inside the whale zone' : 'Logged in Marine life',
        x.simulated ? 'Simulated' : 'Reported by a person',
      ],
    };
  }
  if (hit.kind === 'tick') {
    return { title: `Expected here at ${hit.layer ?? ''}`, lines: ['Where the contact should be at that time if it keeps its course'] };
  }
  return null;
}
