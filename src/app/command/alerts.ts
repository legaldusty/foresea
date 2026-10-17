import { useEffect, useRef } from 'react';
import type { Card } from '../../shared/protocol';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function wakeAudio(): void {
  audio();
}

export function chime(urgent: boolean): void {
  if (!ctx) return;
  const a = audio();
  if (!a) return;
  const tones = urgent ? [880, 660, 880] : [660, 880];
  tones.forEach((hz, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = hz;
    const start = a.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    o.connect(g).connect(a.destination);
    o.start(start);
    o.stop(start + 0.18);
  });
}

const URGENT = new Set(['notResponding', 'person', 'hold']);

export function useCardChime(card: Card | null, muted: boolean): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const key = card ? `${card.id}:${card.realerts}` : null;
    if (key && key !== last.current && !muted) {
      chime(URGENT.has(card?.kind ?? ''));
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Foresea', { body: card?.title ?? '', tag: card?.id }); } catch { return; }
      }
    }
    last.current = key;
  }, [card?.id, card?.realerts, muted]);
}
