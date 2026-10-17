import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/ui.css';
import { ChartMap } from './map/ChartMap';
import { useCaptainHub } from './hub/useHub';
import { captainChart } from './map/toChart';
import { CommandView } from './command/CommandView';
import { setManifest } from './captain/device';
import { CaptainView } from './captain/CaptainView';
import { DriveView } from './drive/DriveView';

const params = new URLSearchParams(location.search);
const isCaptain = location.pathname.startsWith('/captain');
const isDrive = location.pathname.startsWith('/drive');
document.documentElement.dataset.theme = params.get('theme') === 'day' || isCaptain || isDrive ? (params.get('theme') === 'night' ? 'night' : 'day') : 'night';
setManifest(isCaptain ? 'captain' : 'command');

function CaptainMapCheck() {
  const hub = useCaptainHub(params.get('v'));
  const v = hub.snapshot?.vessel;
  if (!hub.vessel && hub.link === 'online') void hub.join(params.get('v') ?? undefined);
  const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day';
  return <ChartMap theme={theme} compact data={captainChart(hub.snapshot, 0)} follow={v?.lonlat ?? null} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(isCaptain ? <CaptainView /> : isDrive ? <DriveView /> : params.get('view') === 'captain' ? <CaptainMapCheck /> : <CommandView />);
