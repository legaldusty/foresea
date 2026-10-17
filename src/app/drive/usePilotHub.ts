import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { adoptHarbor, harborCode } from '../hub/harbor';
import type { PilotEvents, PilotSnapshot } from '../../shared/protocol';
import type { LonLat } from '../../engine/geo';
import type { Link } from '../hub/useHub';

export interface PilotReply { ok: boolean; error?: string }

export interface PilotHub {
  snapshot: PilotSnapshot | null;
  receivedAt: number | null;
  link: Link;
  send: <K extends keyof PilotEvents>(name: K, payload: PilotEvents[K]) => Promise<PilotReply>;
  steer: (lonlat: LonLat) => void;
}

export function usePilotHub(): PilotHub {
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [link, setLink] = useState<Link>('connecting');
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    const socket = io({ auth: (cb) => cb({ role: 'pilot', harbor: harborCode() }), transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
    socket.on('harbor', (h: { code: string | null }) => adoptHarbor(h.code));
    socketRef.current = socket;
    socket.on('connect', () => setLink('online'));
    socket.on('disconnect', () => setLink('offline'));
    socket.on('connect_error', () => setLink('offline'));
    socket.on('pilot', (s: PilotSnapshot) => { setSnapshot(s); setReceivedAt(Date.now()); });
    return () => { socket.close(); };
  }, []);
  const send = useMemo(() => <K extends keyof PilotEvents>(name: K, payload: PilotEvents[K]) => new Promise<PilotReply>((resolve) => {
    const s = socketRef.current;
    if (!s || !s.connected) { resolve({ ok: false, error: 'The hub is offline. Reconnecting.' }); return; }
    s.timeout(4000).emit(name, payload, (err: unknown, r: PilotReply | undefined) => resolve(err ? { ok: false, error: 'The hub did not answer. Try again.' } : r ?? { ok: false }));
  }), []);
  const steer = useMemo(() => (lonlat: LonLat) => { socketRef.current?.emit('steer', { lonlat }); }, []);
  return { snapshot, receivedAt, link, send, steer };
}
