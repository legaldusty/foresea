import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CaptainEvents, CaptainSnapshot, CommandEvents, CommandSnapshot, ForecastView } from '../../shared/protocol';
import { adoptHarbor, harborCode } from './harbor';

export type Link = 'connecting' | 'online' | 'offline';

export interface CommandHub {
  snapshot: CommandSnapshot | null;
  forecasts: ForecastView[];
  link: Link;
  send: <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;
}

export function useCommandHub(): CommandHub {
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null);
  const [forecasts, setForecasts] = useState<ForecastView[]>([]);
  const [link, setLink] = useState<Link>('connecting');
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    const socket = io({ auth: (cb) => cb({ role: 'command', harbor: harborCode() }), transports: ['websocket', 'polling'] });
    socket.on('harbor', (h: { code: string | null }) => adoptHarbor(h.code));
    socket.on('forecasts', (f: ForecastView[]) => setForecasts(f));
    socketRef.current = socket;
    socket.on('connect', () => setLink('online'));
    socket.on('disconnect', () => setLink('offline'));
    socket.on('connect_error', () => setLink('offline'));
    socket.on('snapshot', (s: CommandSnapshot) => setSnapshot(s));
    return () => { socket.close(); };
  }, []);
  const send = useMemo(() => <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => new Promise<void>((resolve) => {
    const s = socketRef.current;
    if (!s || !s.connected) { resolve(); return; }
    s.timeout(3000).emit(name, payload, () => resolve());
  }), []);
  return { snapshot, forecasts, link, send };
}

const CAPTAIN_KEY = 'giveway.captain';

interface StoredCaptain { vesselId: string; name: string; snapshot: CaptainSnapshot | null; savedAt: number }

function readStored(): StoredCaptain | null {
  try { const raw = localStorage.getItem(CAPTAIN_KEY); return raw ? JSON.parse(raw) as StoredCaptain : null; } catch { return null; }
}

function writeStored(v: StoredCaptain): void {
  try { localStorage.setItem(CAPTAIN_KEY, JSON.stringify(v)); } catch { return; }
}

export interface CaptainHub {
  snapshot: CaptainSnapshot | null;
  receivedAt: number | null;
  link: Link;
  vessel: { vesselId: string; name: string } | null;
  pushKey: string | null;
  join: (vesselId?: string) => Promise<boolean>;
  ack: (kind: 'delivered' | 'seen' | 'gotIt', noticeId: string) => void;
  sendSubscription: (sub: PushSubscription) => void;
  reportSighting: (report: Omit<CaptainEvents['reportSighting'], 'vesselId'>) => Promise<boolean>;
  sos: (action: CaptainEvents['sos']['action']) => Promise<boolean>;
}

export function useCaptainHub(requestedVessel: string | null): CaptainHub {
  const stored = useMemo(readStored, []);
  const [snapshot, setSnapshot] = useState<CaptainSnapshot | null>(stored?.snapshot ?? null);
  const [receivedAt, setReceivedAt] = useState<number | null>(stored?.savedAt ?? null);
  const [link, setLink] = useState<Link>('connecting');
  const [vessel, setVessel] = useState<{ vesselId: string; name: string } | null>(stored && (!requestedVessel || requestedVessel === stored.vesselId) ? { vesselId: stored.vesselId, name: stored.name } : null);
  const [pushKey, setPushKey] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const vesselRef = useRef(vessel);
  vesselRef.current = vessel;
  const delivered = useRef(new Set<string>());

  const join = useMemo(() => (vesselId?: string) => new Promise<boolean>((resolve) => {
    const s = socketRef.current;
    if (!s || !s.connected) { resolve(false); return; }
    s.timeout(4000).emit('join', { vesselId }, (err: unknown, r: { ok: boolean; vesselId: string; name: string; pushKey: string }) => {
      if (err || !r?.ok) { resolve(false); return; }
      const v = { vesselId: r.vesselId, name: r.name };
      setVessel(v);
      setPushKey(r.pushKey);
      writeStored({ ...v, snapshot: null, savedAt: Date.now() });
      resolve(true);
    });
  }), []);

  useEffect(() => {
    const socket = io({ auth: (cb) => cb({ role: 'captain', harbor: harborCode() }), transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
    socket.on('harbor', (h: { code: string | null }) => adoptHarbor(h.code));
    socketRef.current = socket;
    socket.on('connect', () => {
      setLink('online');
      const v = vesselRef.current;
      if (v) socket.emit('join', { vesselId: v.vesselId }, (r: { ok: boolean; pushKey: string }) => { if (r?.ok) setPushKey(r.pushKey); });
    });
    socket.on('disconnect', () => setLink('offline'));
    socket.on('connect_error', () => setLink('offline'));
    socket.on('snapshot', (s: CaptainSnapshot) => {
      setSnapshot(s);
      const now = Date.now();
      setReceivedAt(now);
      const v = vesselRef.current;
      if (v) writeStored({ ...v, snapshot: s, savedAt: now });
      for (const n of s.notices) {
        if (delivered.current.has(n.id)) continue;
        delivered.current.add(n.id);
        socket.emit('delivered', { noticeId: n.id, vesselId: v?.vesselId });
      }
    });
    return () => { socket.close(); };
  }, []);

  const ack = useMemo(() => (kind: 'delivered' | 'seen' | 'gotIt', noticeId: string) => {
    socketRef.current?.emit(kind, { noticeId, vesselId: vesselRef.current?.vesselId });
  }, []);
  const sendSubscription = useMemo(() => (sub: PushSubscription) => {
    socketRef.current?.emit('pushSubscription', { subscription: sub.toJSON(), vesselId: vesselRef.current?.vesselId });
  }, []);
  const reportSighting = useMemo(() => (report: Omit<CaptainEvents['reportSighting'], 'vesselId'>) => new Promise<boolean>((resolve) => {
    const s = socketRef.current;
    if (!s || !s.connected) { resolve(false); return; }
    const payload: CaptainEvents['reportSighting'] = { ...report, vesselId: vesselRef.current?.vesselId };
    s.timeout(5000).emit('reportSighting', payload, (err: unknown, r: { ok: boolean } | undefined) => resolve(!err && !!r?.ok));
  }), []);
  const sos = useMemo(() => (action: CaptainEvents['sos']['action']) => new Promise<boolean>((resolve) => {
    const s = socketRef.current;
    if (!s || !s.connected) { resolve(false); return; }
    s.timeout(5000).emit('sos', { action, vesselId: vesselRef.current?.vesselId }, (err: unknown, r: { ok: boolean } | undefined) => resolve(!err && !!r?.ok));
  }), []);
  return { snapshot, receivedAt, link, vessel, pushKey, join, ack, sendSubscription, reportSighting, sos };
}
