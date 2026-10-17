import type { Map as MLMap } from 'maplibre-gl';
import { withAlpha, type ChartColors } from './chartTheme';

const RATIO = 2;

export const SILHOUETTES = ['container', 'tanker', 'cruise', 'ferry', 'tug', 'pilot', 'dive', 'taxi', 'robot', 'other'] as const;

const SILHOUETTE_FILES: Record<(typeof SILHOUETTES)[number], string> = {
  container: 'container-ship', tanker: 'tanker', cruise: 'cruise-ship', ferry: 'ferry', tug: 'tug',
  pilot: 'pilot-boat', dive: 'dive-tender', taxi: 'water-taxi', robot: 'research-glider', other: 'water-taxi',
};
export type Silhouette = (typeof SILHOUETTES)[number];

export function silhouetteFor(type: string, lengthM: number | null): Silhouette {
  switch (type) {
    case 'cargo': return 'container';
    case 'tanker': return 'tanker';
    case 'passenger': return lengthM !== null && lengthM > 150 ? 'cruise' : 'ferry';
    case 'ferry': return 'ferry';
    case 'tug': return 'tug';
    case 'pilot': case 'law': case 'sar': return 'pilot';
    case 'dive': return 'dive';
    case 'taxi': case 'fishing': case 'pleasure': case 'sailing': case 'sail': return 'taxi';
    case 'robot': case 'glider': return 'robot';
    default: return 'other';
  }
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size * RATIO;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(RATIO, RATIO);
  return [c, ctx];
}

function add(map: MLMap, id: string, c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, { width: c.width, height: c.height, data: new Uint8Array(data.data.buffer) }, { pixelRatio: RATIO });
}

function hatch(map: MLMap, id: string, color: string, fillAlpha: number, lineAlpha: number): void {
  const size = 12;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = withAlpha(color, fillAlpha);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = withAlpha(color, lineAlpha);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const o of [-size, 0, size]) { ctx.moveTo(o, size); ctx.lineTo(o + size, 0); }
  ctx.stroke();
  add(map, id, c);
}

function arrow(map: MLMap, id: string, color: string): void {
  const size = 24;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(12, 3);
  ctx.lineTo(19, 19);
  ctx.lineTo(12, 15);
  ctx.lineTo(5, 19);
  ctx.closePath();
  ctx.fill();
  add(map, id, c);
}

function diamond(map: MLMap, id: string, stroke: string, fill: string | null, half: boolean, bg: string): void {
  const size = 32;
  const [c, ctx] = canvas(size);
  const path = () => { ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(28, 16); ctx.lineTo(16, 28); ctx.lineTo(4, 16); ctx.closePath(); };
  path();
  ctx.fillStyle = bg;
  ctx.fill();
  if (fill) {
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = fill;
    if (half) ctx.fillRect(0, 16, size, 16); else ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }
  path();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  add(map, id, c);
}

function you(map: MLMap, color: string, edge: string): void {
  const size = 40;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = withAlpha(color, 0.18);
  ctx.beginPath(); ctx.arc(20, 20, 18, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(20, 2); ctx.lineTo(20, 10); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(20, 20, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  add(map, 'you', c);
}

const YOU_ICON_SIZE = 0.6;
const OWN_BOAT_FRAME = { width: 60, height: 76.25, hullCenterX: 30, hullCenterY: 46.25 };

async function ownBoat(map: MLMap, colors: ChartColors, el: Element): Promise<void> {
  add(map, 'diamond-you', canvas(2)[0]);
  const img = await svgImage('/icons/your-boat.svg', {}, el);
  if (!img) { you(map, colors.you, colors.bg); return; }
  const k = 1 / YOU_ICON_SIZE;
  const size = Math.ceil(2 * OWN_BOAT_FRAME.hullCenterY * k) + 2;
  const [c, ctx] = canvas(size);
  const dx = size / 2 - OWN_BOAT_FRAME.hullCenterX * k;
  const dy = size / 2 - OWN_BOAT_FRAME.hullCenterY * k;
  ctx.drawImage(img, dx, dy, OWN_BOAT_FRAME.width * k, OWN_BOAT_FRAME.height * k);
  add(map, 'you', c);
}

function ring(map: MLMap, id: string, color: string): void {
  const size = 40;
  const [c, ctx] = canvas(size);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(20, 20, 16, 0, Math.PI * 2); ctx.stroke();
  add(map, id, c);
}

function resolveCssVars(text: string, el: Element): string {
  const style = getComputedStyle(el);
  return text.replace(/var\((--[a-z0-9-]+)\s*,\s*([^)]+)\)/gi, (_, name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback.trim());
}

async function svgImage(url: string, recolor: Record<string, string>, el: Element = document.documentElement): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let text = resolveCssVars(await res.text(), el);
    for (const [from, to] of Object.entries(recolor)) text = text.split(from).join(to);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

async function vessel(map: MLMap, kind: Silhouette, colors: ChartColors, el: Element): Promise<void> {
  const img = await svgImage(`/icons/vessels/${SILHOUETTE_FILES[kind]}.svg`, { currentColor: colors.text }, el);
  const w = 48, h = 48;
  const [c, ctx] = canvas(w);
  if (img) {
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = colors.muted;
    ctx.beginPath(); ctx.moveTo(24, 6); ctx.lineTo(31, 18); ctx.lineTo(31, 42); ctx.lineTo(17, 42); ctx.lineTo(17, 18); ctx.closePath(); ctx.fill();
  }
  add(map, `v-${kind}`, c);
}

export async function loadChartImages(map: MLMap, colors: ChartColors, el: Element = document.documentElement): Promise<void> {
  hatch(map, 'hatch-keepout', colors.riskHigh, 0.1, 0.6);
  hatch(map, 'hatch-slow', colors.riskMedium, 0.1, 0.65);
  arrow(map, 'arrow-keepout', colors.riskHigh);
  arrow(map, 'arrow-slow', colors.riskMedium);
  arrow(map, 'arrow-path', colors.text);
  const bg = colors.water;
  diamond(map, 'diamond-unknown', colors.text, null, false, bg);
  diamond(map, 'diamond-low', colors.riskLow, colors.riskLow, true, bg);
  diamond(map, 'diamond-medium', colors.riskMedium, colors.riskMedium, true, bg);
  diamond(map, 'diamond-serious', colors.riskSerious, colors.riskSerious, true, bg);
  diamond(map, 'diamond-high', colors.riskHigh, colors.riskHigh, true, bg);
  diamond(map, 'diamond-critical', colors.riskCritical, colors.riskCritical, true, bg);
  diamond(map, 'diamond-friendly', colors.muted, colors.muted, false, bg);
  diamond(map, 'diamond-debris', colors.muted, null, false, bg);
  diamond(map, 'diamond-animal', colors.riskMedium, null, false, bg);
  diamond(map, 'diamond-person', colors.riskHigh, null, false, bg);
  you(map, colors.you, colors.bg);
  ring(map, 'ring-alert', colors.riskHigh);
  await Promise.all([...SILHOUETTES.map((k) => vessel(map, k, colors, el)), ownBoat(map, colors, el)]);
}

async function symbol(map: MLMap, id: string, file: string, size: number, recolor: Record<string, string>, el: Element): Promise<void> {
  const img = await svgImage(`/icons/symbols/${file}.svg`, recolor, el);
  if (!img) return;
  const [c, ctx] = canvas(size);
  const scale = Math.min(size / img.width, size / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
  add(map, id, c);
}

export const DRONE_LEVELS = ['unknown', 'low', 'medium', 'serious', 'high', 'critical'] as const;

export async function loadSymbolImages(map: MLMap, colors: ChartColors, el: Element = document.documentElement): Promise<void> {
  const tone: Record<(typeof DRONE_LEVELS)[number], string> = {
    unknown: colors.muted, low: colors.riskLow, medium: colors.riskMedium, serious: colors.riskSerious, high: colors.riskHigh, critical: colors.riskCritical,
  };
  await Promise.all([
    ...DRONE_LEVELS.map((level) => symbol(map, `drone-${level}`, 'drone', 32, { '#D83A34': tone[level], '#d83a34': tone[level] }, el)),
    symbol(map, 'symbol-robot', 'robot', 24, {}, el),
    symbol(map, 'symbol-animal', 'animal', 24, {}, el),
    symbol(map, 'symbol-ring', 'ring', 44, {}, el),
  ]);
}
