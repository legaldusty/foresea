import { Broadcast, Moon, Sun } from '@phosphor-icons/react';
import type { CommandEvents, CommandSnapshot, ForecastView } from '../../shared/protocol';
import type { TourStep } from '../ui/Tour';

type Send = <K extends keyof CommandEvents>(name: K, payload: CommandEvents[K]) => Promise<void>;

export interface CommandTourContext {
  snap: () => CommandSnapshot | null;
  forecasts: () => ForecastView[];
  send: Send;
  openSheet: (s: 'models' | 'orders' | 'join' | 'nights' | null) => void;
  showDesk: (tab: string) => void;
  closeOverlays: () => void;
  hosted: boolean;
}

const LIVE = 'Live harbor';
const NIGHT = 'Night incident';
const TUESDAY = 'Tuesday';
const has = (selector: string) => !!document.querySelector(selector);

export const COMMAND_TOUR_CHAPTERS = [
  { icon: <Broadcast size={20} />, title: 'The live harbor', detail: 'Real ships, tide and weather, and the models behind them' },
  { icon: <Moon size={20} />, title: 'A night incident', detail: 'An unknown drone, its forecast, one notice, the phones in its path' },
  { icon: <Sun size={20} />, title: 'An ordinary Tuesday', detail: 'Dive plans, real ETAs, a lost robot and a person overboard' },
];

export function commandTour(ctx: CommandTourContext): TourStep[] {
  const snap = ctx.snap;
  return [
    {
      id: 'headline', chapter: LIVE, target: '[data-testid="headline"]',
      title: 'One sentence says what is happening',
      body: <p>The headline is the whole harbor in a sentence: how many real ships are moving, any weather advisory in force, and during an incident, what is coming, where it is going and when it arrives.</p>,
      enter: () => {
        ctx.closeOverlays();
        if (snap()?.mode !== 'live') void ctx.send('reset', { mode: 'live' });
      },
    },
    {
      id: 'sources', chapter: LIVE, target: '.top-sources',
      title: 'Real data, and it says so',
      body: <p>Ships arrive live from AIS, the tidal current from NOAA, wind and waves from NOAA stations and buoys, and the wording from IBM Granite running on this server. Anything simulated carries the word Simulated next to it.</p>,
    },
    {
      id: 'ships', chapter: LIVE, target: '.cmd-chart',
      title: 'A real harbor, right now',
      body: <p>Every ship on this chart is a real vessel in the ports of Los Angeles and Long Beach. Click one to see its AIS record and what the traffic model thinks of how it is moving.</p>,
      waitFor: { done: () => has('[data-testid="vessel-inspector"]'), waiting: 'Click any ship on the chart', ready: 'That is its live AIS record and traffic score' },
    },
    {
      id: 'models', chapter: LIVE, target: ['[data-testid="models-panel"]', '[data-testid="open-models"]'],
      title: 'The models behind it',
      body: <p>TELL infers where an unknown contact is going from every move it makes. A traffic model scores every real ship for odd behavior. Granite writes the notices in six languages. Each card says what the model does, what it never does, and how accurate it is.</p>,
      action: { label: 'Open Models', run: () => ctx.openSheet('models') },
      waitFor: { done: () => has('[data-testid="models-panel"]'), waiting: 'Opening the models', ready: 'Scroll the cards, then press Next' },
    },
    {
      id: 'orders', chapter: LIVE, target: '[data-testid="open-orders"]',
      title: 'Rules written in plain English',
      body: <p>The officer signs Standing Orders, typed like "Publish whale zones automatically at night". Foresea shows exactly what it understood and obeys it. High and Critical risk, people in the water and closures always wait for a person.</p>,
      enter: () => ctx.closeOverlays(),
    },
    {
      id: 'night', chapter: NIGHT,
      title: 'Start a night incident',
      body: <p>This switches to Simulation. It is 2 AM, and an unknown underwater drone enters at Angels Gate. Time runs 10 times faster, so a few minutes of reading covers the whole approach.</p>,
      action: {
        label: 'Start the night scene',
        run: async () => {
          ctx.closeOverlays();
          await ctx.send('reset', { mode: 'night' });
          await ctx.send('clock', { timeScale: 10, paused: false });
          await ctx.send('spawn', { preset: 'scenario', scenarioKey: 'A' });
        },
      },
      waitFor: { done: () => snap()?.mode === 'sim' && !!snap()?.contacts.length, waiting: 'Starting the scene', ready: 'A contact is in the harbor', advance: true },
    },
    {
      id: 'contact', chapter: NIGHT, target: '.cmd-chart',
      title: 'Unknown contact at Angels Gate',
      body: <p>Foresea identifies it from its size, heat, speed and an ID ping that gets no reply. Its risk sits on a 5 by 5 grid: how likely harm is, against how bad it would be at the place it is heading.</p>,
      waitFor: { done: () => ctx.forecasts().length > 0, waiting: 'Building its forecast', ready: 'Its forecast is on the chart' },
    },
    {
      id: 'forecast', chapter: NIGHT, target: '.cmd-chart',
      title: 'A hurricane forecast for drones',
      body: <p>Yellow is everywhere it could be in the next half hour. Red is where it is most likely going, with time marks. TELL updates the odds after every move, so the red narrows as the drone commits.</p>,
      waitFor: { done: () => snap()?.card?.kind === 'publish' || !!snap()?.notices.some((n) => n.status === 'active' && n.kind === 'security'), waiting: 'Watching it commit to a target', ready: 'It has locked on and drafted a notice' },
    },
    {
      id: 'card', chapter: NIGHT, target: ['[data-testid="card"]', '[data-testid="right-rail"]'],
      title: 'The gentlest notice that works',
      body: <p>The draft moves only the boats in its path: one row per boat with its instruction and the minutes it costs. Nothing closes the harbor. Under signed orders, Serious risk may publish itself after a countdown the officer can stop.</p>,
    },
    {
      id: 'why', chapter: NIGHT, target: '[data-testid="why"]',
      title: 'Every decision explains itself',
      body: <p>Why? opens the evidence table, the risk grid with its axes, the odds over time and the rules that fired. Full dossier under the contact has the sensor readout and the risk math step by step.</p>,
    },
    {
      id: 'publish', chapter: NIGHT, target: ['[data-testid="card-publish"]', '[data-testid="delivery-board"]', '[data-testid="card"]'],
      title: 'A person publishes',
      body: <p>The machine drafts, the officer publishes with one tap. Press Publish on the card, or let the tour do it.</p>,
      action: {
        label: 'Publish for me',
        run: async () => {
          const s = snap();
          const draftId = s?.card?.draftId ?? s?.drafts[0]?.id;
          if (draftId) await ctx.send('publish', { draftId });
        },
      },
      waitFor: { done: () => !!snap()?.notices.some((n) => n.status === 'active' && n.kind === 'security'), waiting: 'Press Publish on the card', ready: 'Published. Phones in its path are alerted now' },
    },
    {
      id: 'delivery', chapter: NIGHT, target: '[data-testid="delivery-board"]',
      title: 'Who got it, and who did not',
      body: <p>Each boat in the path moves from delivered to seen to acknowledged. If a captain ignores it, a card with a VHF radio script appears after 4 minutes. Captains see one instruction and P1 to P4, never a risk score.</p>,
    },
    {
      id: 'phones', chapter: NIGHT, target: ['[data-testid="join-sheet"]', '[data-testid="open-join"]'],
      title: 'Be the captain',
      body: <p>Open Join phones and scan Harbor Launch 7 with your phone camera, or open its link in another tab. That phone gets the takeover with a countdown and a new route. The captain view has its own short tour.</p>,
      action: { label: 'Open Join phones', run: () => ctx.openSheet('join') },
    },
    {
      id: 'report', chapter: NIGHT, target: '[data-testid="open-report"]',
      title: 'After-action report',
      body: <p>Minutes of warning before arrival, detection to notice, who acknowledged, how many gates closed (none), and what the machine did on its own against what people decided. It prints.</p>,
      enter: () => ctx.closeOverlays(),
    },
    {
      id: 'tuesday', chapter: TUESDAY,
      title: 'The same screen on an ordinary day',
      body: <p>Most days have no drones. They have divers, dredges, whales and ships running late. This starts a simulated Tuesday morning on top of the real ships.</p>,
      action: {
        label: 'Start Tuesday',
        run: async () => {
          ctx.closeOverlays();
          await ctx.send('reset', { mode: 'tuesday' });
          ctx.showDesk('today');
        },
      },
      waitFor: { done: () => snap()?.mode === 'sim' && !snap()?.clock.night && (snap()?.today.length ?? 0) > 0, waiting: 'Opening Tuesday', ready: 'Tuesday morning is running', advance: true },
    },
    {
      id: 'today', chapter: TUESDAY, target: '[data-testid="desk"]',
      title: 'Every zone in one list',
      body: <p>Dive plans, the dredge moving along the Main Channel and a whale slow zone for big ships, each with who filed it. Click a row to see it on the chart. Extend or end it right here.</p>,
      enter: () => ctx.showDesk('today'),
    },
    {
      id: 'ontime', chapter: TUESDAY, target: '[data-testid="desk-ontime"]',
      title: 'On time, from real AIS',
      body: <p>Real ships with their reported arrival time against ours, and what any zone costs each of them. Click On time.</p>,
      waitFor: { done: () => has('[data-testid="ontime-board"]'), waiting: 'Click On time', ready: 'Real ships, live arrival times' },
    },
    {
      id: 'conditions', chapter: TUESDAY, target: '[data-testid="desk-conditions"]',
      title: 'Tide, wind and advisories',
      body: <p>Live NOAA readings, each with its source and age. When the National Weather Service issues a marine advisory, one tap relays it to every captain's phone.</p>,
    },
    {
      id: 'zones', chapter: TUESDAY, target: '[data-testid="new-zone"]',
      title: 'Draw a zone in two clicks',
      body: <p>New zone drops a whale, dive, dredge, closure or plain slow zone. It opens on the right with its radius, the boats it moves, and Publish.</p>,
    },
    {
      id: 'glider', chapter: TUESDAY, target: '.cmd-chart',
      title: 'Lost, not hostile',
      body: <p>A research glider stops reporting. Foresea matches it to its registered owner, sees it drifting with the NOAA current instead of aiming, and turns the drift forecast into a search area.</p>,
      action: { label: 'Lose a robot', run: async () => { await ctx.send('spawn', { preset: 'glider' }); } },
      waitFor: { done: () => !!snap()?.zones.some((z) => z.reason === 'Search area'), waiting: 'The glider is going silent', ready: 'Owner message and search area are ready' },
    },
    {
      id: 'sos', chapter: TUESDAY, target: ['[data-testid="card"]', '[data-testid="right-rail"]'],
      title: 'Person overboard',
      body: <p>Captains have a red SOS button. Holding it for 2 seconds sends the boat's position. The desk gets the top card and a search area that drifts with the current. This drill sends one from Harbor Launch 7.</p>,
      action: { label: 'Run the drill', run: async () => { ctx.closeOverlays(); await ctx.send('sosDrill', { vesselId: 'launch1' }); } },
      waitFor: { done: () => snap()?.card?.kind === 'person', waiting: 'Sending from Harbor Launch 7', ready: 'Publish the search area, send the Coast Guard brief, then Person recovered' },
    },
    {
      id: 'proof', chapter: TUESDAY, target: '[data-testid="nights-sheet"]',
      title: 'Proof, not promises',
      body: <p>Run 1,000 nights replays simulated incidents and measures warning time against the nearest-dock guess, how honest the odds are, and how often the drone stayed inside the yellow.</p>,
      action: { label: 'Run 1,000 nights', run: () => ctx.openSheet('nights') },
    },
    {
      id: 'end', chapter: TUESDAY,
      title: 'That is Foresea',
      body: (
        <>
          <p>Press P for the Presenter panel with every demo control: scenes, time, contacts and driving a drone yourself. Tour in the top bar runs this again.</p>
          {ctx.hosted ? <p>This harbor is private to you. Its code is in the address bar, so your phones join the same one.</p> : null}
        </>
      ),
      enter: () => ctx.closeOverlays(),
    },
  ];
}
