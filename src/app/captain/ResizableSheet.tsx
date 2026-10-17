import { useRef, useState, type ReactNode } from 'react';

const KEY = 'giveway.captain.sheet';
const MIN_PX = 64;

function stored(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= MIN_PX ? v : null;
  } catch {
    return null;
  }
}

export function ResizableSheet(props: { children: ReactNode }) {
  const [height, setHeight] = useState<number | null>(stored);
  const ref = useRef<HTMLDivElement>(null);
  const save = (v: number | null) => {
    setHeight(v);
    try { if (v === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(Math.round(v))); } catch { return; }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const startY = e.clientY;
    const from = el.getBoundingClientRect().height;
    const max = window.innerHeight * 0.8;
    let last = from;
    let moved = false;
    const move = (ev: PointerEvent) => {
      last = Math.max(MIN_PX, Math.min(max, from + (startY - ev.clientY)));
      if (Math.abs(ev.clientY - startY) > 4) moved = true;
      el.style.height = `${last}px`;
      el.style.maxHeight = 'none';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) save(last);
      else save(from > MIN_PX + 8 ? MIN_PX : null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="cap-sheet" data-testid="captain-sheet" ref={ref} style={height ? { height, maxHeight: 'none' } : undefined}>
      <div className="cap-grab" onPointerDown={onPointerDown} role="separator" aria-label="Drag to resize the map. Tap to fold the panel." data-testid="sheet-grab"><i /></div>
      {props.children}
    </div>
  );
}
