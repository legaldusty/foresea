# Demo run sheet

The 90-second demo from the spec, click by click. Rehearse it twice before Sunday. Everything here is checked by `npm run e2e`.

## Before the judges arrive

1. Turn on the team hotspot. Join the laptop and both team phones to it. Venue wifi off.
2. `npm run demo`. Command opens on the laptop and the terminal prints a QR code.
3. In Command, open **Standing Orders**, type your name in **Sign as**, press **Sign**. Notices now say "Approved by" your name.
4. Open **Join phones**. Phone A (the judge's phone) scans **Catalina Ferry**. Phone B (a teammate) scans **Water Taxi**. Both tap **Join** and turn on alerts.
5. **Scene**, then **Tuesday, 09:00**. Time speed **20x**.
6. Check the data line: AIS live or AIS replay with a vessel count, the NOAA current, and the wording source. If AIS says replay, say so out loud: it is our real Friday night recording.

If a judge wants to use their own phone, give them the Catalina Ferry QR for step 1 and the Harbor Launch 7 QR for step 3.

## The 90 seconds

1. **Tuesday.** Click **Whale zone**, then click on the dotted route of the boat labeled "Catalina Ferry, phone" in the Outer Harbor. The notice editor opens with SLOW TO 10 KNOTS. Click **Publish notice**. Phone A shows P2, Whale nearby, the amber zone and a teal route bending around it. The delivery board fills: Sent, Delivered, Seen, Acknowledged.
   Say: "The ops desk does this every Tuesday. That is why it is already open at 2 AM."
2. **Night.** Click **All clear**. **Scene**, then **Night watch, 02:00**. On phone A, tap the boat name at the top and pick **Harbor Launch 7**. Click **Add contact**, then **Unknown contact to drive**. The judge drags on the chart toward the Fuel Pier.
   The contact card reads: powered unknown, hot motor, 1.9 m, no registry match, no reply. "Where it is heading" moves to the Fuel Pier. A card says **Give-way notice drafted**. Change the radius to 400 or 500 m and click **Publish**.
   Say: "It guessed where the drone was going. Now watch the boats."
3. **Phones.** Phone A (Harbor Launch 7, head on into the drone's path) gets P1: the full-screen takeover with LEAVE THE ZONE NOW or USE EAST CHANNEL. The judge taps **Got it**; Command shows Acknowledged. Phone B (Water Taxi, across the harbor) only gets a silent P4.
   Say: "Targeted, not a flood."
4. **Ignored.** About 30 seconds later at 20x, the card says **Pilot Boat 2 not responding** with the VHF script. Read it out loud. Click **Called on VHF**.
5. **All clear.** In the published notice, click **All clear**. Every phone shows ALL CLEAR and the zones vanish.
6. **Proof.** Click **Run 1,000 nights**. About 75 minutes of warning against 48 for the nearest-dock guess, right target every time, labeled simulated.

## If something goes wrong

- **No live AIS:** the hub switches to the recording and says so. Keep going.
- **No Granite:** templates write every message. The data line says "Wording: templates".
- **A phone drops off the hotspot:** it keeps the last zones and shows "Updated N min ago". Rejoin from Join phones.
- **The judge steers somewhere else:** fine. TELL follows them. If no boat is in the path, publish anyway and show the P4 on the phones, then use **Add contact**, **Incident A**, which always runs Angels Gate to the Fuel Pier.
- **Anything looks stuck:** **Scene**, **Night watch, 02:00** resets the harbor in one click. Phones stay joined.
- **Laptop dies:** play the backup video.

## Other things to show in Q&A

- **Lost glider** (Add contact): "Lost, not hostile. It was heading back to its dock." TELL reads it as drifting with the NOAA current.
- **Incident B** (fake-out): watch the odds swing from the Oil Islands to the Cruise Terminal; risk never drops below Serious after its first High.
- **Coordinated pair:** two unknowns from both gates, two TELLs, a hand-off card.
- **Sensor lost** (drive panel): the score freezes and the zone grows.
- **Standing Orders:** change a blank, sign, and the next draft follows it.
- **Log tab:** every automatic and human action, with Undo.
