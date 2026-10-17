import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILDS_URL = 'https://build.protomaps.com';
const TILE_BBOX = '-118.32,33.67,-118.12,33.80';
const MAX_ZOOM = 15;
const DAYS_TO_SEARCH = 10;
const OUT_FILE = fileURLToPath(new URL('../public/tiles/harbor.pmtiles', import.meta.url));
const PMTILES_BIN = process.env.PMTILES_BIN ?? 'pmtiles';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function buildDate(daysAgo: number): string {
  const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return `${day.slice(0, 4)}${day.slice(5, 7)}${day.slice(8, 10)}`;
}

async function buildExists(date: string): Promise<boolean> {
  try {
    const response = await fetch(`${BUILDS_URL}/${date}.pmtiles`, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function latestBuild(): Promise<string | null> {
  for (let daysAgo = -1; daysAgo < DAYS_TO_SEARCH; daysAgo++) {
    const date = buildDate(daysAgo);
    if (await buildExists(date)) return date;
  }
  return null;
}

function hasPmtiles(): boolean {
  return spawnSync(PMTILES_BIN, ['version'], { stdio: 'ignore' }).status === 0;
}

async function main(): Promise<number> {
  if (!hasPmtiles()) {
    console.error('The pmtiles CLI was not found. Install it with "brew install pmtiles", or set PMTILES_BIN to a go-pmtiles binary.');
    return 1;
  }
  const date = argValue('date') ?? (await latestBuild());
  if (!date) {
    console.error(`No Protomaps daily build found in the last ${DAYS_TO_SEARCH} days at ${BUILDS_URL}.`);
    return 1;
  }
  const source = `${BUILDS_URL}/${date}.pmtiles`;
  const partial = `${OUT_FILE}.partial`;
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.rmSync(partial, { force: true });
  console.log(`Extracting ${TILE_BBOX} up to z${MAX_ZOOM} from ${source}`);
  const extract = spawnSync(PMTILES_BIN, ['extract', source, partial, `--bbox=${TILE_BBOX}`, `--maxzoom=${MAX_ZOOM}`], { stdio: 'inherit' });
  if (extract.status !== 0) {
    fs.rmSync(partial, { force: true });
    console.error('pmtiles extract failed.');
    return 1;
  }
  fs.renameSync(partial, OUT_FILE);
  const megabytes = (fs.statSync(OUT_FILE).size / 1_048_576).toFixed(1);
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)} (${megabytes} MB, Protomaps build ${date})`);
  spawnSync(PMTILES_BIN, ['show', OUT_FILE], { stdio: 'inherit' });
  return 0;
}

main().then((code) => process.exit(code));
