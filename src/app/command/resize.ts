import { useCallback, useEffect, useState } from 'react';

function stored(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function usePersisted<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { return; }
  }, [key]);
  return [value, set];
}

export function useDragSize(key: string, fallback: number, min: number, max: () => number, axis: 'x' | 'y') {
  const [size, setSize] = useState(() => stored(key, fallback));
  useEffect(() => {
    try { localStorage.setItem(key, String(Math.round(size))); } catch { return; }
  }, [key, size]);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const from = size;
    const move = (ev: PointerEvent) => {
      const now = axis === 'x' ? ev.clientX : ev.clientY;
      setSize(Math.max(min, Math.min(max(), from + (start - now))));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('dragging'); };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [size, min, max, axis]);
  const reset = useCallback(() => setSize(fallback), [fallback]);
  return { size, onPointerDown, reset };
}
