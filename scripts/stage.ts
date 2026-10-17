import { io } from 'socket.io-client';

const port = process.env.PORT || '5170';
const scene = process.argv[2] ?? 'night';
const cmd = io(`http://localhost:${port}`, { auth: { role: 'command' } });
const send = (name: string, payload: unknown) => new Promise((ok) => cmd.timeout(3000).emit(name, payload, ok));
let last: any = null;
cmd.on('snapshot', (s: any) => { last = s; });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

cmd.on('connect', async () => {
  for (let i = 0; i < 40 && !last; i++) await sleep(100);
  if (scene === 'night') {
    await send('reset', { mode: 'night' });
    await send('clock', { timeScale: 40, paused: false });
    await send('spawn', { preset: 'driven' });
    await sleep(400);
    const c = last.contacts[0];
    await send('drive', { contactId: c.id, lonlat: [-118.2190, 33.7520] });
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      const cv = last.contacts[0];
      const fuel = cv?.odds.find((o: any) => o.id === 'fuel')?.p ?? 0;
      if (fuel >= 0.7 && last.drafts.length) break;
    }
    await send('clock', { paused: true });
    console.log('staged', last.clock.label, last.contacts[0].odds.slice(0, 3).map((o: any) => `${o.name} ${Math.round(o.p * 100)}%`).join(', '), 'risk', last.contacts[0].risk?.score, 'drafts', last.drafts.length);
  }
  if (scene === 'published') {
    if (last.drafts[0]) await send('publish', { draftId: last.drafts[0].id });
    await send('clock', { paused: false, timeScale: 20 });
    await sleep(3000);
    await send('clock', { paused: true });
    console.log('published', last.notices.length, 'deliveries', last.deliveries.length);
    console.log(last.deliveries.filter((d: any) => d.priority === 'P1' || d.priority === 'P2').map((d: any) => `${d.vesselId} ${d.vesselName} ${d.priority}`).join(' | '));
  }
  if (scene === 'tuesday') {
    await send('reset', { mode: 'tuesday' });
    await send('clock', { timeScale: 20, paused: false });
    await sleep(600);
    const ferry = last.vessels.find((v: any) => v.id === 'ferry1');
    const route = ferry?.route ?? [];
    const spot = route.length > 4 ? route[Math.floor(route.length * 0.4)] : [-118.262, 33.716];
    await send('dropZone', { kind: 'whale', lonlat: spot });
    await sleep(500);
    if (last.drafts[0]) await send('publish', { draftId: last.drafts[0].id });
    await sleep(2500);
    await send('clock', { paused: true });
    console.log('tuesday', last.clock.label, 'notices', last.notices.length);
  }
  process.exit(0);
});
