import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles/tokens.css';
import '../styles/base.css';
import { ChartMap } from './map/ChartMap';
import { useCaptainHub, useCommandHub } from './hub/useHub';
import { captainChart, commandChart } from './map/toChart';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'day' ? 'day' : 'night';
document.documentElement.dataset.theme = theme;

function CommandMapCheck() {
  const hub = useCommandHub();
  return <ChartMap theme={theme} data={commandChart(hub.snapshot, null)} />;
}

function CaptainMapCheck() {
  const hub = useCaptainHub(params.get('v'));
  const v = hub.snapshot?.vessel;
  if (!hub.vessel && hub.link === 'online') void hub.join(params.get('v') ?? undefined);
  return <ChartMap theme={theme} compact data={captainChart(hub.snapshot, 0)} follow={v?.lonlat ?? null} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(params.get('view') === 'captain' ? <CaptainMapCheck /> : <CommandMapCheck />);
