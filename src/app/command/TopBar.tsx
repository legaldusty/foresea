import { Broadcast, Cpu, FileText, QrCode, Scroll, UserCircle, Waves, Wind, WifiSlash } from '@phosphor-icons/react';
import type { CommandSnapshot } from '../../shared/protocol';
import { Button, Segmented } from '../ui';
import type { Link } from '../hub/useHub';
import { compassAbbr } from '../format';
import { ageText, compass16, feet, knotsWhole } from '../conditionsFormat';

export function Lockup() {
  return <span className="lockup"><span className="mark" /><span className="word">GIVE WAY</span></span>;
}

export function TopBar(props: { snap: CommandSnapshot; link: Link; onOrders: () => void; onJoin: () => void; onModels: () => void; onMode: (mode: 'live' | 'sim') => void }) {
  const { snap } = props;
  const ais = snap.sources.ais;
  const noaa = snap.sources.noaa;
  const lang = snap.sources.language;
  const wx = snap.conditions;
  const wxTitle = [wx.windMps ? `Wind: ${wx.windMps.source}, ${ageText(wx.windMps.ageMin)}` : `Wind: ${wx.missing.wind ?? 'no data'}`, wx.waveHeightM ? `Waves: ${wx.waveHeightM.source}, ${ageText(wx.waveHeightM.ageMin)}` : `Waves: ${wx.missing.waveHeight ?? 'no data'}`].join('. ');
  return (
    <header className="cmd-top">
      <Lockup />
      <span className="vdiv" />
      <Segmented value={snap.mode} onChange={props.onMode} testId="mode" options={[{ value: 'live', label: 'Live' }, { value: 'sim', label: 'Simulation' }]} />
      <div className="top-clock" data-testid="clock">
        <span className="t-data">{snap.clock.label}</span>
        <span className="t-small c-muted">{snap.mode === 'live' ? 'Pacific time' : snap.clock.night ? 'Night watch, simulated' : 'Tuesday, simulated'}</span>
      </div>
      <span className="vdiv" />
      <div className="top-sources">
        {props.link !== 'online' ? <span className="src warn"><WifiSlash size={16} />Hub offline. Showing the last picture.</span> : null}
        <span className="src" title={ais.detail}><Broadcast size={16} />{ais.mode === 'live' ? 'AIS live, ' : ais.mode === 'replay' ? 'AIS replay, ' : 'AIS offline'}{ais.mode !== 'offline' ? <><span className="t-mono-small">{ais.vessels}</span>&nbsp;vessels</> : null}</span>
        <span className="src" title={noaa.detail}><Waves size={16} />{noaa.currentKn !== null ? <>NOAA current&nbsp;<span className="t-mono-small">{noaa.currentKn.toFixed(1)}</span>&nbsp;kn {compassAbbr(noaa.towardDeg)}</> : 'NOAA current: no data'}</span>
        <span className="src wx" title={wxTitle} data-testid="top-conditions"><Wind size={16} />{wx.windMps ? <>Wind&nbsp;<span className="t-mono-small">{knotsWhole(wx.windMps.value)}</span>&nbsp;kn {compass16(wx.windFromDeg?.value)}</> : 'Wind: no data'}{wx.waveHeightM ? <>, waves&nbsp;<span className="t-mono-small">{feet(wx.waveHeightM.value)}</span>&nbsp;ft</> : null}</span>
        <span className="src lang" title={lang.detail}><FileText size={16} />{lang.source === 'granite' ? 'Granite, on device' : 'Template wording'}</span>
      </div>
      <span style={{ flex: 1 }} />
      <span className="top-officer" title={snap.officer}><UserCircle size={20} /><span className="who">{snap.officer}</span></span>
      <span className="vdiv" />
      <div className="top-actions">
        <Button variant="secondary" icon={<Cpu size={16} />} onClick={props.onModels} testId="open-models">Models</Button>
        <Button variant="secondary" icon={<Scroll size={16} />} onClick={props.onOrders} testId="open-orders">Standing Orders</Button>
        <Button variant="secondary" icon={<QrCode size={16} />} onClick={props.onJoin} testId="open-join">Join phones</Button>
      </div>
    </header>
  );
}
