import settingsJson from '../../settings/giveway.settings.json';

export type Settings = typeof settingsJson;

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export const defaultSettings: Settings = settingsJson;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return cloneValue(base);
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(base)) merged[key] = mergeValue(base[key], override[key]);
    for (const key of Object.keys(override)) if (!(key in base)) merged[key] = cloneValue(override[key]);
    return merged;
  }
  return cloneValue(override);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) copy[key] = cloneValue(value[key]);
    return copy;
  }
  return value;
}

export function withOverrides(base: Settings, partial: DeepPartial<Settings> = {}): Settings {
  return mergeValue(base, partial) as Settings;
}
