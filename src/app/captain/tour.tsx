import type { TourStep } from '../ui/Tour';

const CHAPTER = 'Captain';

export function captainTour(): TourStep[] {
  return [
    {
      id: 'boat', chapter: CHAPTER, target: '.cap-top',
      title: 'Your boat',
      body: <p>This phone captains one simulated boat in the harbor. Tap its name to switch boats. Live means you are connected to the harbor desk.</p>,
    },
    {
      id: 'map', chapter: CHAPTER, target: '.cap-map',
      title: 'Your chart',
      body: <p>You are the blue boat. When the desk publishes a notice, its zone appears here, and a blue line shows your new route if you need one.</p>,
    },
    {
      id: 'today', chapter: CHAPTER, target: ['[data-testid="today"]', '[data-testid="captain-sheet"]'],
      title: 'What affects you today',
      body: <p>Every active zone with a plain instruction and whether it is on your route. Captains never see risk scores, only what to do.</p>,
    },
    {
      id: 'conditions', chapter: CHAPTER, target: '[data-testid="captain-conditions"]',
      title: 'Live conditions',
      body: <p>Tap for the tide curve, wind, waves and the marine forecast, live from NOAA and the National Weather Service. Drag across a chart to read any time.</p>,
    },
    {
      id: 'sos', chapter: CHAPTER, target: '[data-testid="sos-open"]',
      title: 'Person overboard',
      body: <p>Hold SOS for 2 seconds and the desk gets your position and a search area that drifts with the current. You still call MAYDAY on VHF channel 16.</p>,
    },
    {
      id: 'report', chapter: CHAPTER, target: '[data-testid="report-sighting"]',
      title: 'Report a sighting',
      body: <p>Seen a whale or something floating? Drop a pin. The desk confirms it and can publish a slow zone for everyone nearby.</p>,
    },
    {
      id: 'alerts', chapter: CHAPTER, target: '[data-testid="open-notices"]',
      title: 'How alerts arrive',
      body: <p>P1 takes over the screen with sound and a buzz. P2 is a banner, P3 is quiet, and P4 is silent and only in this list. Only boats in the path get the loud ones.</p>,
    },
    {
      id: 'language', chapter: CHAPTER, target: '[data-testid="open-language"]',
      title: 'In your language',
      body: <p>Notices arrive in English, Spanish, Chinese, Korean, Tagalog or Vietnamese. Radio calls stay in English.</p>,
    },
    {
      id: 'try', chapter: CHAPTER,
      title: 'Now try it',
      body: <p>On the harbor desk, start the night scene from Tour or the Presenter panel. When the officer publishes, this phone gets the alert in seconds. Tap Got it to acknowledge.</p>,
    },
  ];
}
