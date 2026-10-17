import path from 'node:path';
import giveWaySettings from '../../settings/giveway.settings.json';
import {
  CACHE_FILE,
  SNAPSHOT_FILE,
  currentAt,
  currentVector,
  discoverCurrentStations,
  fetchNoaaPayload,
  writePayload,
  type FetchLike,
  type NoaaSettings,
} from './client';

const settings = giveWaySettings as NoaaSettings;
const fetchImpl = globalThis.fetch as unknown as FetchLike;
const relative = (file: string) => path.relative(process.cwd(), file);

async function main(): Promise<number> {
  const now = Date.now();
  try {
    const stations = await discoverCurrentStations(fetchImpl, settings);
    console.log(`Current stations near the harbor: ${stations.length}`);
    for (const station of stations) {
      console.log(`  ${station.id}  ${station.name}  ${station.lat.toFixed(4)}, ${station.lon.toFixed(4)}  listed as ${station.listedAs.join(', ')}`);
    }
    const missing = settings.noaa.currentStations.filter((id) => !stations.some((station) => station.id === id));
    if (missing.length) console.log(`Not found near the harbor: ${missing.join(', ')}. Check settings.noaa.currentStations.`);
  } catch (error) {
    console.log(`Station list unavailable: ${(error as Error).message}`);
  }

  const payload = await fetchNoaaPayload(fetchImpl, settings, now);
  if (!payload.current && !payload.waterLevel) {
    console.error('NOAA returned no current and no water level. The cache and snapshot were left alone.');
    return 1;
  }

  writePayload(CACHE_FILE, payload);
  writePayload(SNAPSHOT_FILE, payload);
  console.log(`Wrote ${relative(CACHE_FILE)} and ${relative(SNAPSHOT_FILE)} (fetched ${payload.fetchedAt})`);

  if (payload.current) {
    const series = payload.current;
    const sample = currentAt(series, now);
    const { u, v } = currentVector(sample.speedMps, sample.towardDeg);
    console.log(
      `Current at ${series.station} ${series.stationName} (${series.basis}, ${series.samples.length} samples): ` +
      `${sample.speedMps.toFixed(3)} m/s toward ${Math.round(sample.towardDeg)} deg, u ${u.toFixed(3)} v ${v.toFixed(3)} m/s at ${sample.at}`,
    );
  } else {
    console.log('No current data from any station in settings.noaa.currentStations.');
  }

  if (payload.waterLevel) {
    const level = payload.waterLevel;
    console.log(`Water level at ${level.station} ${level.stationName}: ${level.meters.toFixed(3)} m above ${level.datum} at ${level.observedAt}`);
  } else {
    console.log(`No water level from ${settings.noaa.waterLevelStation}.`);
  }
  return 0;
}

main().then((code) => process.exit(code), (error: Error) => {
  console.error(`NOAA fetch failed: ${error.message}`);
  process.exit(1);
});
