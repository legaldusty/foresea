export function setManifest(view: 'command' | 'captain'): void {
  const href = view === 'captain' ? '/manifest-captain.webmanifest' : '/manifest-command.webmanifest';
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
  link.href = href;
  let icon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!icon) { icon = document.createElement('link'); icon.rel = 'apple-touch-icon'; document.head.appendChild(icon); }
  icon.href = '/icons/app-192.png';
  let fav = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); }
  fav.href = '/icons/mark.svg';
}

export function secureEnough(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!secureEnough()) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    reg.active?.postMessage('cache-tiles');
    navigator.serviceWorker.ready.then((r) => r.active?.postMessage('cache-tiles')).catch(() => undefined);
    return reg;
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on';

export function pushState(): PushState {
  if (!window.isSecureContext) return 'insecure';
  if (!('Notification' in window) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(publicKey: string): Promise<PushSubscription | null> {
  if (pushState() === 'insecure' || pushState() === 'unsupported') return null;
  const reg = await registerWorker();
  if (!reg) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) });
}

let audio: AudioContext | null = null;

export function primeSound(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

export function alertTone(urgent: boolean): void {
  if (!audio) return;
  const now = audio.currentTime;
  const tones = urgent ? [880, 660, 880, 660] : [660];
  tones.forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.22 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.18);
    osc.connect(gain).connect(audio!.destination);
    osc.start(now + i * 0.22);
    osc.stop(now + i * 0.22 + 0.2);
  });
}

export function buzz(urgent: boolean): void {
  if ('vibrate' in navigator) navigator.vibrate(urgent ? [400, 120, 400, 120, 400] : [200]);
}

let wakeLock: { release: () => Promise<void> } | null = null;

export async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}
