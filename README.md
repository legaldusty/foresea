# GIVE WAY

GIVE WAY works out where an unknown underwater drone is heading and moves only the boats in its path before it gets there, so the harbor never has to shut down. On an ordinary Tuesday the same screen routes boats around divers, dredges and whales, finds lost research robots, and keeps ships on time with real ship-tracking data.

Our entry to the InnovateLA Dual-Use Hackathon at USC, Marine track, with NULL Systems.

The name comes from the boating rules: the give-way vessel is the one that steers out of another's path.

## What it does

Five steps run on every contact. The machine stops at the line where a person must decide.

1. **See.** A port sensor reports a contact: position, speed, size and heat. (Simulated; the prompt says detection is the easy part.)
2. **Identify.** It assumes the contact is a risk until it is proven friendly. It checks the registry and dive plans, sends an ID ping, and classifies the contact from speed, heat and size: powered vehicle, debris or dead robot, marine animal, or person.
3. **Predict.** TELL reads which target the contact is heading for from how it moves and updates the odds after every move. It also asks whether the contact is just drifting with the current, using NOAA current data, so a lost robot reads as lost.
4. **Give way.** It scores the risk on a 5 by 5 matrix (the same structure as the Coast Guard's MSRAM), draws a safety zone along the predicted path, reroutes only the boats whose routes cross it, prices every reroute in minutes of delay, and drafts the cheapest response that clears the zone.
5. **Hand off.** Holding a berth or calling the Coast Guard is one card and one tap, with the message already drafted.

The officer publishes every public notice. Captains see an instruction and a personal priority from P1 (act now) to P4 (info), never the risk score.

## Two views, one app

- **Command** (laptop): the chart fills the screen. The right rail holds the contact, TELL's odds, the risk card and the notice editor. The bottom rail holds the delivery board and the on-time board.
- **Captain** (phone, at `/captain`): a full-screen chart with your boat, the zones, your new route, a P1 takeover, a P2 banner and a "Got it" button. It can be saved to the home screen, caches the chart for offline use, and keeps the last zones moving along their predicted path when the signal drops.

A small hub on the laptop keeps Command and every phone in sync over the team's own hotspot.

## Run it

You need Node 22 or newer.

```
npm install
npm run demo
```

`npm run demo` builds the app, starts the hub, opens Command and prints a QR code. Phones on the same network scan it to join as a captain; each phone is given a virtual vessel.

Options:

- `npm run demo -- --replay` uses the recorded AIS instead of the live feed.
- `npm run demo -- --tunnel` adds a public HTTPS link through Cloudflare so judges' phones on cellular can join and get push notifications.
- `npm run dev` runs the hub with live reloading on port 5170.

Optional setup:

- `.env` with `AISSTREAM_API_KEY` for live ship tracking. Without it the hub replays the recording.
- Ollama with `granite4:micro` for notice wording and translations. Without it, templates write every message.
- `npm run certs` makes a local HTTPS certificate for the hotspot.

## Proof

- `npm test` runs 198 unit, scenario and world tests.
- `npm run e2e` runs the 90-second demo end to end in Playwright with a laptop and two phones: Tuesday whale zone, night contact, P1 on the judge's phone and a silent P4 on a teammate's, Got it, a boat that ignores the notice, All clear, and Run 1,000 nights. Screenshots land in `e2e/screenshots/`.
- `npm run scenarios` prints the five incidents from the spec. Every "must stay true" rule holds.
- `npm run bench` runs the benchmark: with detection at the harbor gates, TELL gives about 73 minutes of warning against 47.5 for a nearest-dock guess (1.54 times, against a bar of 1.4), and calls the right target by arrival in every run.
- "Run 1,000 nights" in Command runs the same benchmark in a Web Worker in the browser.
- `npm run tune:tell` fits TELL's purposefulness setting to real AIS tracks. On Friday night traffic real vessels fit best at 2.7, more purposeful than our setting of 1.3, so the setting is conservative.

## What is real and what is simulated

| Real | Simulated, and labeled on screen |
| --- | --- |
| Harbor land and water from OpenStreetMap, on a 50 m grid | The intruder: driven by a judge or a bot |
| Ship positions, destinations and reported arrival times from aisstream.io, live or replayed from our recording | Sensor readings: speed, heat and size |
| NOAA tide level at Los Angeles and the predicted current at Queens Gate | Small boats and their crews' replies |
| TELL's odds, the risk scores, reroutes and delays, computed live | Messages to the Coast Guard and port police (drafted, never sent) |
| The chart, from a local OpenStreetMap extract | Breakwater positions in the engine grid (hand placed, approximate) |

Underwater drone detections cannot be real: nobody publishes them, and the prompt assumes detection has already happened. NOAA publishes no observed currents inside the LA and Long Beach harbors, so we use the predicted current at Queens Gate and say so.

## Responsible use

GIVE WAY could be misused to track legitimate boats or to unfairly push certain vessels out of an area. It never acts on any vehicle, every public notice is approved by a person and can be undone with one tap, and every action is logged.

## Tools we used

- Figma for the interface, brand and vessel art
- OpenStreetMap data (ODbL) through Protomaps tiles and the roaring-landmask package
- aisstream.io for live AIS ship tracking
- NOAA CO-OPS Tides and Currents
- Ollama running IBM Granite 4 (granite4:micro) on the laptop for notice wording and translations
- MapLibre GL, React, Vite, Socket.IO, Phosphor Icons, IBM Plex

## Repo map

- `src/engine/`: the shared engine (grid, TELL, identify, risk, zones, routing, response, priority, world)
- `src/app/`: Command and Captain
- `server/`: the hub, AIS relay, NOAA client, language model, push, audit log
- `settings/giveway.settings.json`: every setting the team can tune
- `TWISTS.md`: how each twist changed the build
