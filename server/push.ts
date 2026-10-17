import fs from 'node:fs';
import webpush, { type PushSubscription } from 'web-push';

export interface PushMessage { title: string; body: string; tag: string; url: string; priority: string; requireInteraction: boolean }

export interface PushService {
  publicKey: string;
  ready: boolean;
  detail: string;
  subscribe: (vesselId: string, sub: PushSubscription) => void;
  send: (vesselId: string, msg: PushMessage) => Promise<boolean>;
  hasSubscription: (vesselId: string) => boolean;
}

function appendEnv(lines: string[]): void {
  const existing = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const sep = existing.length && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync('.env', existing + sep + lines.join('\n') + '\n', { mode: 0o600 });
}

export function createPushService(): PushService {
  let publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  let privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    appendEnv([`VAPID_PUBLIC_KEY=${publicKey}`, `VAPID_PRIVATE_KEY=${privateKey}`]);
    process.env.VAPID_PUBLIC_KEY = publicKey;
    process.env.VAPID_PRIVATE_KEY = privateKey;
  }
  webpush.setVapidDetails('mailto:watch@giveway.example', publicKey, privateKey);
  const subs = new Map<string, PushSubscription>();
  const service: PushService = {
    publicKey,
    ready: true,
    detail: 'Web Push ready (VAPID)',
    subscribe(vesselId, sub) {
      for (const [other, existing] of subs) if (other !== vesselId && existing.endpoint === sub.endpoint) subs.delete(other);
      subs.set(vesselId, sub);
    },
    hasSubscription(vesselId) { return subs.has(vesselId); },
    async send(vesselId, msg) {
      const sub = subs.get(vesselId);
      if (!sub) return false;
      try {
        await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 600, urgency: msg.priority === 'P1' ? 'high' : 'normal' });
        return true;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) subs.delete(vesselId);
        service.detail = `Last push failed (${code ?? 'network'})`;
        return false;
      }
    },
  };
  return service;
}
