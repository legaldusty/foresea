import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles/base.css';
import { ChartMap } from './map/ChartMap';
import { useCommandHub } from './hub/useHub';
import { commandChart } from './map/toChart';

function MapCheck() {
  const hub = useCommandHub();
  const theme = new URLSearchParams(location.search).get('theme') === 'day' ? 'day' : 'night';
  return <ChartMap theme={theme} data={commandChart(hub.snapshot, null)} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(<MapCheck />);
