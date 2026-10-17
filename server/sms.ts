export interface SmsService {
  ready: boolean;
  detail: string;
  numberFor: (vesselId: string) => string | null;
  send: (vesselId: string, body: string) => Promise<boolean>;
}

export function createSmsService(numbers: Record<string, string> = {}): SmsService {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const token = process.env.TWILIO_AUTH_TOKEN ?? '';
  const from = process.env.TWILIO_FROM ?? '';
  const envNumbers = Object.fromEntries((process.env.TWILIO_VESSEL_NUMBERS ?? '').split(',').map((pair) => pair.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const book: Record<string, string> = { ...numbers, ...envNumbers };
  const ready = Boolean(sid && token && from);
  const service: SmsService = {
    ready,
    detail: ready ? `Twilio text ready for ${Object.keys(book).length} boats` : 'Text messages off (no Twilio account set)',
    numberFor: (vesselId) => book[vesselId] ?? null,
    async send(vesselId, body) {
      const to = book[vesselId];
      if (!ready || !to) return false;
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 320) }),
          signal: AbortSignal.timeout(8000),
        });
        service.detail = res.ok ? 'Last text sent' : `Last text failed (${res.status})`;
        return res.ok;
      } catch {
        service.detail = 'Last text failed (network)';
        return false;
      }
    },
  };
  return service;
}
