import os from 'node:os';

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(utun|awdl|llw|bridge|vmnet|docker)/.test(name)) continue;
      out.push(a.address);
    }
  }
  return out.sort((a, b) => rankAddress(a) - rankAddress(b));
}

function rankAddress(ip: string): number {
  if (ip.startsWith('172.20.10.')) return 0;
  if (ip.startsWith('192.168.')) return 1;
  if (ip.startsWith('10.')) return 2;
  return 3;
}

export function joinUrls(port: number, httpsPort: number | null, publicUrl: string | null): string[] {
  const urls: string[] = [];
  if (publicUrl) urls.push(`${publicUrl.replace(/\/$/, '')}/captain`);
  for (const ip of lanAddresses()) {
    if (httpsPort) urls.push(`https://${ip}:${httpsPort}/captain`);
    urls.push(`http://${ip}:${port}/captain`);
  }
  if (!urls.length) urls.push(`http://localhost:${port}/captain`);
  return urls;
}
