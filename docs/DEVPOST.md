# Devpost submission text

Paste each section into the matching Devpost field. Numbers come from `npm run bench`, `npm run scenarios` and `npm test`; rerun them if anything changes.

## Name

GIVE WAY

## Track

Marine / Crisis Mitigation, with NULL Systems

## One line

It works out where an unknown underwater drone is heading and moves only the boats in its path before it gets there, so the harbor never has to shut down.

## Inspiration

The Marine kickoff slide asked one question: how do we respond without shutting the harbor down? Closing the Port of Los Angeles costs $65M to $150M a day. Most of the time the honest answer to "is it worth stopping it?" is no, but someone still has to decide in minutes, at night, with partial information. We wanted the gentlest response that still works, decided early enough that it can stay gentle.

The name comes from the boating rules: the give-way vessel is the one that steers out of another's path.

## What it does

GIVE WAY runs five steps on every contact and stops at the line where a person must decide.

1. **See.** A port sensor reports position, speed, size and heat (simulated; the prompt says detection is the easy part).
2. **Identify.** Every unknown starts as a risk until it is proven friendly. It checks the registry and dive plans, sends an ID ping, and classifies the contact from speed, heat and size as a powered vehicle, debris or a dead robot, a marine animal, or a person.
3. **Predict.** TELL reads which target the contact is heading for from how it moves and updates the odds after every move. It also tests whether the contact is just drifting with the NOAA current, so a lost research robot reads as lost.
4. **Give way.** It scores risk on a 5 by 5 matrix modeled on the Coast Guard's MSRAM, draws a safety zone along the predicted path, reroutes only the boats whose routes cross it, prices each reroute in minutes of delay, and drafts the cheapest response that clears the zone.
5. **Hand off.** Holding a berth or calling the Coast Guard is one card and one tap, with the brief already written.

The officer publishes every public notice. Captains get an instruction and a personal priority from P1 (act now) to P4 (info) on their phone, never the risk score and never the word drone. The dashboard tracks every boat from sent to delivered, seen, acknowledged and complying. A boat that does not answer is re-sent after 2 minutes and gets a VHF call card with the script at 4 minutes. Nothing closes the harbor.

On an ordinary Tuesday the same screen drops keep-clear zones for divers, dredges and whales, finds lost research robots, and runs an on-time board from real ship tracking data.

## How we built it

- **One shared engine in TypeScript** that runs in the browser, in a Web Worker and in Node: the OpenStreetMap harbor grid, TELL (Bayesian inverse planning), identify, risk, zones, routing, response and priority.
- **Command** (laptop) and **Captain** (phone) are one React app. The chart is MapLibre over a local PMTiles extract of San Pedro Bay, styled as a nautical chart in day and night.
- **A small hub** on the laptop syncs Command and every phone over Socket.IO in milliseconds over the team's own hotspot, and keeps an audit log in SQLite.
- **Real data:** live ship positions, destinations and reported arrival times from aisstream.io (with a recording for offline replay), NOAA tides and currents, and OpenStreetMap land and water.
- **Language:** IBM Granite 4 running locally through Ollama writes notice wording, the radio script, the Coast Guard brief and translations into Spanish, Chinese, Korean, Tagalog and Vietnamese. It never decides anything, every field is checked against the facts, and templates take over when it is wrong or offline.
- **Design** first in Figma: a brand mark, day and night tokens, components and every screen, then built from the file.

## Proof

- In 1,000 simulated nights with detection at the harbor gates, TELL gave about 75 minutes of warning against about 48 for a nearest-dock guess (1.5 times, against our bar of 1.4) and called the right target by arrival every time. Decoys fool it once, then it corrects. Close-in detection is the honest gap: there the nearest dock is often already right.
- Five incident scenarios (straight shot, fake-out, lost glider, tiny drone, late detection) meet every "must stay true" rule we wrote before running them.
- Fitting TELL to real AIS tracks from Friday night showed real vessels steer more purposefully than our setting assumes, so the setting is conservative.
- An end-to-end Playwright test runs the whole demo with a laptop and two phones.

## Challenges we ran into

- A drone drifting with the current looks like it is aiming somewhere. We added a "drifting with the current" hypothesis using NOAA data, so a lost glider never gets called toward a target.
- Port "industrial" land-use polygons cover the water in the map data, and the engine grid's breakwaters are hand placed. We drew the chart so the harbor reads correctly and labeled what is approximate.
- NOAA publishes no observed currents inside the LA and Long Beach harbors; we use the predicted current at Queens Gate and say so on screen.
- A small local model writes thin radio scripts and awkward translations. Every field must now carry the real instruction, place and numbers, or the template is used.

## Accomplishments we're proud of

- A judge can drive the drone with a mouse and watch the screen call the target before they get there.
- The boats visibly move: only the ones in the path, priced in minutes, approved by a person.
- It works with the network down: the phones keep the last zones, and the radio script is on the card.

## What we learned

The earlier you know, the gentler you can be. Most of the value is not in the alarm but in moving three boats instead of closing a port.

## What's next

Validate who pays with the Port of LA operations desk, connect a real underwater sensor feed, and run TELL inside NULL's autonomy simulator.

## Responsible use

GIVE WAY could be misused to track legitimate boats or to unfairly push certain vessels out of an area. It never acts on any vehicle, every public notice is approved by a person and can be undone with one tap, and every action is logged.

## Built with

Figma, OpenStreetMap (ODbL) via Protomaps and roaring-landmask, aisstream.io, NOAA CO-OPS Tides and Currents, Ollama, IBM Granite 4 (granite4:micro), MapLibre GL, PMTiles, React, Vite, TypeScript, Node.js, Socket.IO, SQLite, Web Push, Playwright, Vitest, Phosphor Icons, IBM Plex.

IBM Bob was not used.

## What is real and what is simulated

Real: harbor land and water, ship positions and reported arrival times (AIS), NOAA tide level and predicted current, TELL's odds, risk scores, reroutes and delays computed live.
Simulated, and labeled on screen: the underwater contacts and their sensor readings, the small boats and their crews' replies, and messages to the Coast Guard and port police (drafted, never sent).
