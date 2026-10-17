import { io } from 'socket.io-client';
const cmd = io('http://localhost:5170', { auth: { role: 'command' } });
const cap = io('http://localhost:5170', { auth: { role: 'captain' } });
let snaps = 0, capSnaps = 0, lastCmd: any = null, lastCap: any = null;
cmd.on('snapshot', (s: any) => { snaps++; lastCmd = s; });
cap.on('snapshot', (s: any) => { capSnaps++; lastCap = s; });
cap.emit('join', { vesselId: 'ferry1' }, (r: any) => console.log('join', JSON.stringify(r).slice(0, 120)));
setTimeout(() => cmd.emit('reset', { mode: 'night' }), 500);
setTimeout(() => cmd.emit('spawn', { preset: 'scenario', scenarioKey: 'A' }), 800);
setTimeout(() => cmd.emit('clock', { timeScale: 60 }), 900);
const t0 = Date.now();
let publishedAt = 0;
const iv = setInterval(() => {
  if (!lastCmd) return;
  const c = lastCmd.contacts[0];
  if (lastCmd.drafts[0] && !publishedAt) {
    const sent = Date.now();
    publishedAt = sent;
    cmd.emit('publish', { draftId: lastCmd.drafts[0].id }, () => {});
    const check = setInterval(() => { if (lastCap?.notices?.length) { console.log('captain saw notice after', Date.now() - sent, 'ms:', lastCap.notices[0].priority, lastCap.notices[0].instructionText); clearInterval(check); } }, 10);
  }
  if (Date.now() - t0 > 14000) {
    clearInterval(iv);
    console.log('command snaps', snaps, 'captain snaps', capSnaps, 'snapshot bytes', JSON.stringify(lastCmd).length);
    console.log('clock', lastCmd.clock.label, 'ais', JSON.stringify(lastCmd.sources.ais), 'noaa', lastCmd.sources.noaa.detail, 'lang', lastCmd.sources.language.detail);
    console.log('vessels', lastCmd.vessels.length, 'ais vessels', lastCmd.vessels.filter((v: any) => v.source !== 'simulated').length, 'onTime rows', lastCmd.onTime.length);
    console.log('contact', c?.label, c?.risk?.score, c?.risk?.level, c?.odds?.[0]?.name, 'card', lastCmd.card?.title, 'notices', lastCmd.notices.length, 'deliveries', lastCmd.deliveries.length);
    console.log('wording source', lastCmd.notices[0]?.wording?.source, '|', lastCmd.notices[0]?.wording?.notice);
    console.log('vhf |', lastCmd.notices[0]?.wording?.vhf);
    console.log('es |', lastCmd.notices[0]?.wording?.translations?.es);
    process.exit(0);
  }
}, 100);
