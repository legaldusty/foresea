import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHarbor, type Harbor } from '../src/engine/harbor';
import type { GridJson } from '../src/engine/grid';
import { defaultSettings } from '../src/engine/settings';

export function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

export const gridJson = JSON.parse(fs.readFileSync(repoPath('src/data/harbor_grid.json'), 'utf8')) as GridJson;

let cachedHarbor: Harbor | null = null;

export function harbor(): Harbor {
  cachedHarbor ??= buildHarbor(gridJson, defaultSettings);
  return cachedHarbor;
}

export interface StarterModules {
  grid: any;
  tell: any;
  harbor: any;
  bench: any;
}

function starterModule(name: string): Promise<any> {
  const url = new URL(`../giveway-starter/src/engine/${name}.js`, import.meta.url).href;
  return import(url);
}

export async function loadStarter(): Promise<StarterModules> {
  const [grid, tell, harborModule, bench] = await Promise.all(['grid', 'tell', 'harbor', 'bench'].map(starterModule));
  return { grid, tell, harbor: harborModule, bench };
}

let cachedStarterHarbor: any = null;

export async function starterHarbor(): Promise<any> {
  if (!cachedStarterHarbor) {
    const starter = await loadStarter();
    cachedStarterHarbor = starter.harbor.buildHarbor(gridJson, defaultSettings.harbor);
  }
  return cachedStarterHarbor;
}

export function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(repoPath(rel), 'utf8')) as T;
}
