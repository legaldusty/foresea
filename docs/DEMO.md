# Demo run sheet

The demo, click by click. Rehearse it twice before Sunday. `npm run e2e` checks the same path.

Pitch line for the forecast: "It's a hurricane forecast for underwater drones."

## Before the judges arrive

1. Turn on the team hotspot. Join the laptop and both team phones to it. Venue wifi off.
2. `npm run demo`. Command opens on the laptop and the terminal prints a QR code.
3. In Command, open **Standing Orders**, type your name in **Sign as**, press **Sign**. Notices now say "Approved by" your name.
4. Open **Join phones**. Phone A (the judge's phone) scans **Harbor Launch 7**. Phone B (a teammate) scans **Water Taxi**. Both tap **Join** and turn on alerts.
5. Press **P** (or the small presenter button bottom left of the chart). The Presenter panel holds every demo-only control: scene, time speed, add contact, drive, sensor lost, Run 1,000 nights. Set time to **20x**. Press **P** again to hide it.
6. Check the top bar: AIS live or AIS replay with a vessel count, the NOAA current, and the wording source. If AIS says replay, say so out loud: it is our real Friday night recording.
7. Put the public board on a second screen if there is one: `/board` (Join phones has the link; it never shows scores or the word drone). Open **Join phones** and keep the **Let a judge drive** QR ready.
8. Command opens in **Live**: the real Pacific clock, real ships from AIS, NOAA, and the traffic model scoring every ship every 5 seconds (flagged ships get a ring and a row under **Ships to watch**). Start the pitch here for ten seconds: click a real ship to show its AIS detail and model score, then open **Models**. Then switch to **Simulation** for the scenes. `npm run demo -- --sim` starts in Simulation if the venue has no internet.

## Live (20 seconds, before the scenes)

- The headline counts real ships on AIS and names any NWS advisory in force. The **Conditions** tab shows the real tide, wind, waves and water temperature with each source and its age.
- If NWS has an advisory up, the card asks to relay it: click **Relay**. The captain phones show the bulletin. Say: "That is a real Small Craft Advisory from the National Weather Service, relayed to every captain in one tap."
- Hover a ship for its tooltip, click it for AIS detail and the traffic model score. Open **Models**.
- Optional: open **Standing Orders**, type "Publish whale zones automatically at night", press **Read it**, **Add to orders**, **Sign**. Say: "The officer writes the rule in plain English; the machine shows exactly what it understood and obeys it."

## Tuesday (30 seconds)

Presenter, **Tuesday**. The headline reads like "Tuesday 09:12. 3 zones active, 5 boats notified, all ships on time."

- The hull dive at Pier 400 (Pacific Dive Services) with its hull robot at Log, the dredge zone moving along the Main Channel, and the blue whale slow zone in the approach lanes for ships over 300 tons. All three come from the simulated schedule and say so.
- On a phone: **Report a sighting**, **Whale**, tap the map, **Send**. Command gets a card; click **Confirm**, then **Publish**. Say: "The same screen runs the port's ordinary day."

## Night (60 seconds)

1. Presenter, **Night**. Then either **Incident A**, or hand the judge a phone with the **Let a judge drive** QR: they tap **Launch at Angels Gate** and steer with a finger. Their screen never shows the prediction. Hide the presenter.
2. Watch the forecast. At first the yellow covers two branches and the red is short: "Not sure where it is going yet. Watching." Within about 20 seconds the red locks onto the Fuel Pier and the time marks appear. Say: "It learns where it is going from how it moves."
3. The headline says the drone is heading to the Fuel Pier, when it arrives, and how many boats cross its path. The card reads **Publish this notice** with one row per boat: the action, the minutes it costs, and when it crosses. Total is a few boat-minutes, no gate closed.
   - While the risk is Serious, the card shows **Publishing on your behalf in 20 s** under the signed Standing Orders. Say: "Routine risk publishes itself, and I can stop it." Click **Stop** so you publish it yourself. High and Critical always wait for the officer.
   - Click **Full dossier** under the contact: the sensor readout (depth, speed, size, heat, sound), why it is classed this way, the hostility evidence, the risk math step by step, the forecast and the timeline. Close it.
   - Click **Publish** while the red is narrow (7 to 11 minutes after detection on the clock).
4. **Phones.** Phone A (Harbor Launch 7, head on) gets the P1 takeover: one instruction like ALTER COURSE NORTHWEST 150 m, a countdown to when it is safe, and the forecast on its map. The judge taps **Got it**; Command shows Acknowledged. Phone B (Water Taxi) gets nothing or a calm heads-up. Say: "Targeted, not a flood."
5. **Ignored.** Pilot Boat 2 never answers. After 4 minutes on the clock the card says **Pilot Boat 2 not responding** with the VHF script. Read it out loud. Click **Called on VHF**.
6. **All clear** in the published notice. Every phone shows ALL CLEAR.
7. **After-action report.** Click **After-action report** under the contact (or press R): minutes of warning before arrival, detection to notice, boats that acknowledged, zero gates closed, what GIVE WAY did alone and what people decided. **Print** works.
8. **Proof.** Presenter, **Run 1,000 nights**: about 1.5 times the warning of the nearest-dock guess, the reliability chart, and the share of the drone's real path inside the yellow. Say: "In simulated nights the drone stayed inside the yellow 95% of the time. Decoys fool it at first, and we show that."

## If something goes wrong

- **No live AIS:** the hub switches to the recording and says so. Keep going.
- **No Granite:** templates write every message. The top bar says "Wording: templates".
- **A phone drops off the hotspot:** it keeps the last zones and shows "Updated N min ago". Rejoin from Join phones.
- **Published too late:** if Harbor Launch 7 has already passed the drone it only gets a heads-up. Presenter, **Night**, then **Incident A** again and publish sooner.
- **The judge steers somewhere else:** fine. The forecast follows. If no boat meets it in place and time there is no draft: say so, because watching is the gentlest response. Then run **Incident A**.
- **Anything looks stuck:** Presenter, **Night** resets the harbor in one click. Phones stay joined.
- **Laptop dies:** play the backup video.

## Q&A

- **Why?** on the decision card opens the reasoning: the evidence table, the risk grid with its axes spelled out, the odds over time, the rules that fired, why each boat got wait, slow, step aside or a short reroute, and the log.
- **Lost glider** (Presenter): "Lost, not hostile." Its drift forecast is the search area; the owner message is ready and **Found** closes it.
- **Incident B** (fake-out): the odds swing from the Oil Islands to the Cruise Terminal; risk never drops below Serious after its first High.
- **Coordinated pair:** two unknowns, two forecasts, a hand-off card.
- **Sensor lost** (Presenter): the forecast stops learning and the area stretches along the last forecast.
- **Standing Orders:** change a blank, sign, and the next draft follows it.
