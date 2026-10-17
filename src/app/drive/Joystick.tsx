import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CaretDown, CaretLeft, CaretRight, CaretUp } from '@phosphor-icons/react';
import { offsetPoint, type LonLat } from '../../engine/geo';

const REACH_PX = 44;
const DEAD_PX = 8;
const AHEAD_M = 300;
const EVERY_MS = 250;

const KEYS: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export function bearingFromStick(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

export function Joystick(props: { from: LonLat | null; onSteer: (to: LonLat) => void; disabled?: boolean }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(false);
  const stick = useRef<{ dx: number; dy: number } | null>(null);
  const fromRef = useRef(props.from);
  fromRef.current = props.from;
  const steerRef = useRef(props.onSteer);
  steerRef.current = props.onSteer;
  const base = useRef<HTMLDivElement>(null);

  const push = () => {
    const v = stick.current;
    const from = fromRef.current;
    if (!v || !from || Math.hypot(v.dx, v.dy) < DEAD_PX) return;
    steerRef.current(offsetPoint(from, AHEAD_M, bearingFromStick(v.dx, v.dy)));
  };

  useEffect(() => {
    const t = window.setInterval(push, EVERY_MS);
    return () => window.clearInterval(t);
  }, []);

  const aim = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    const k = len > REACH_PX ? REACH_PX / len : 1;
    stick.current = { dx: dx * k, dy: dy * k };
    setKnob({ x: dx * k, y: dy * k });
  };
  const fromPointer = (e: PointerEvent) => {
    const r = base.current?.getBoundingClientRect();
    if (r) aim(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };
  const release = () => {
    stick.current = null;
    setHeld(false);
    setKnob({ x: 0, y: 0 });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (props.disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setHeld(true);
    fromPointer(e);
    push();
  };
  const onPointerMove = (e: PointerEvent) => { if (held) fromPointer(e); };
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = KEYS[e.key];
    if (!dir || props.disabled) return;
    e.preventDefault();
    setHeld(true);
    aim(dir[0] * REACH_PX, dir[1] * REACH_PX);
    push();
  };
  const onKeyUp = (e: KeyboardEvent) => { if (KEYS[e.key]) release(); };

  return (
    <div className="drive-joy">
      <div
        ref={base}
        className={`joy${held ? ' held' : ''}`}
        role="application"
        aria-label="Joystick. Drag, or use the arrow keys, to steer the drone."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="joystick"
      >
        <CaretUp size={16} className="arrow up" aria-hidden="true" />
        <CaretRight size={16} className="arrow right" aria-hidden="true" />
        <CaretDown size={16} className="arrow down" aria-hidden="true" />
        <CaretLeft size={16} className="arrow left" aria-hidden="true" />
        <span className="thumb" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} aria-hidden="true" />
      </div>
      <span className="label">Drag to steer</span>
    </div>
  );
}
