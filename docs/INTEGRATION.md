# Integration

How GIVE WAY would run on a real harbor: detections come in from sensors, published notices go out in formats other agencies already read, and a judge can drive the unknown drone from a phone.

Everything below runs on the hub (`npm run dev` or `npm run demo`, port 5170).

## Detections in

`POST /api/sensor/detections` takes one detection object or an array of up to 200.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sensorId` | string | yes | The sensor or simulator that saw it, such as `NULL-SIM-1` or `SONAR-PIER400` |
| `trackId` | string or number | yes | The sensor's own track number. One track becomes one contact. |
| `time` | ISO 8601 string | yes | When the fix was taken |
| `lat`, `lon` | numbers | yes | Position, inside the harbor chart |
| `depthM` | number | no | Depth below the surface |
| `speedMps` | number | no | Speed through the water. Left out, the hub works it out from the last two fixes. |
| `headingDeg` | number | no | 0 to 360, true |
| `sizeM` | number | no | Length of the return |
| `heat` | `hot`, `warm` or `cold` | no | Thermal camera reading. Hot means a running motor. |
| `acousticDb` | number | no | Received level |
| `pingReply` | `none`, `correct` or `wrong` | no | The reply to an ID ping |
| `confidence` | 0 to 1 | no | The sensor's own track confidence |

Example:

```sh
curl -X POST http://localhost:5170/api/sensor/detections \
  -H 'Content-Type: application/json' \
  -H "x-giveway-key: $GIVEWAY_SENSOR_KEY" \
  -d '{"sensorId":"NULL-SIM-1","trackId":"A1","time":"2026-10-17T09:14:05Z","lat":33.7080,"lon":-118.2490,"speedMps":2.0,"headingDeg":20,"sizeM":2.5,"heat":"hot","pingReply":"none"}'
```

The answer lists what happened to each fix:

```json
{ "ok": true, "accepted": 1, "results": [{ "sensorId": "NULL-SIM-1", "trackId": "A1", "contactId": "C-14", "status": "new" }] }
```

`status` is `new` for the first fix of a track, `updated` after that, `stale` for a fix older than the last one on that track, `land` when no water is near the fix, and `full` when the hub already follows its limit of sensor tracks.

**Who may post.** Set `GIVEWAY_SENSOR_KEY` in the hub's `.env` and send the same value in the `x-giveway-key` header. With no key set, the hub takes detections only from the computer it runs on, and never through the tunnel. A wrong or missing key gets 401, a remote request without a key set gets 403, and bad input gets 400 with a sentence that names the field, for example `detection 2: heat must be one of hot, warm, cold`.

**What the hub does with each fix.**

- The first fix of a `sensorId` and `trackId` pair makes a new contact. Later fixes move it.
- Each move between chart cells updates that contact's TELL odds, the same way a simulated contact's do. Only the contact's own track counts.
- Size, heat, speed and the ping reply feed the classifier on every fix, so a contact can turn from unknown into a whale or a friendly robot as the readings change.
- When fixes stop for 15 seconds (`sensorFeed.silentAfterSeconds` in the settings), the contact goes silent through the normal sensor-loss path: the score freezes and the keep-out area grows with time since the last fix. The next fix brings it back.
- The dossier shows the source as `Sensor feed NULL-SIM-1` instead of Simulated, with the reported depth, acoustic level, confidence and seconds since the last fix.
- From there it is the ordinary desk: risk, draft, an officer publishes, captains' phones update.

## How a NULL simulator connects

A simulator plugs in where a sonar would. On each simulation step, post the vehicle's position as the sensor model would report it, with one `trackId` per vehicle and one `sensorId` per simulated sensor. Post arrays to send many vehicles at once.

`scripts/sensor-feed.ts` is a working example. It walks incident A from outside Angels Gate to the Fuel Pier along the water and posts one detection a second, with a few meters of sensor noise:

```sh
npx tsx scripts/sensor-feed.ts http://localhost:5170
npx tsx scripts/sensor-feed.ts http://localhost:5170 --speedup 20 --loop
npx tsx scripts/sensor-feed.ts https://giveway.example --key "$GIVEWAY_SENSOR_KEY" --sensor SONAR-2 --track 7
```

`--speedup` moves the track faster than real time while still reporting the true speed, which matches the desk clock in Simulation. `--every` sets the seconds between fixes and `--max` stops after that many fixes.

Because every fix is scored the same way a desk contact is, a test rig can run many simulated vehicles with known goals and read back what GIVE WAY called and how early. `npm run bench` does the same check offline.

## Feeds out

These are read only, need no key and allow any origin.

**`GET /api/cap.xml`** is an Atom feed with one CAP 1.2 alert for each active published notice. Drafts never appear. **`GET /api/cap/<noticeId>.xml`** returns one alert on its own.

- `status` is `Actual` in Live mode and `Exercise` in Simulation mode, with a note that it is an exercise. `scope` is `Public` and `msgType` is `Alert`.
- `category` is `Safety` and `event` is the public reason, such as `Security zone` or `Whale nearby`.
- `instruction` is the notice itself, such as `KEEP 500 m CLEAR` or `SLOW TO 10 KNOTS`.
- `expires` is when the notice ends.
- The area is the published zone as CAP polygons: `lat,lon` pairs, closed.
- Urgency, severity and certainty come from the most urgent priority given to any boat:

| Priority | Urgency | Severity | Certainty |
| --- | --- | --- | --- |
| P1 | Immediate | Severe | Observed |
| P2 | Expected | Moderate | Likely |
| P3 | Future | Minor | Likely |
| P4 | Future | Minor | Possible |

The table lives in `feeds.byPriority` in the settings. The priority also goes out as the parameter `GIVEWAY_PRIORITY`.

**`GET /api/zones.geojson`** is a GeoJSON FeatureCollection of the same active zones as MultiPolygons, with only public properties: `noticeId`, `status`, `kind`, `reason`, `instruction`, `priority`, `place`, `sent`, `expires`, `radiusM` and `slowKnots`.

Neither feed ever carries the risk score, the predicted target, the odds or the word drone. They say what a captain's phone says.

## Let a judge drive

Open **Join phones** on the desk. The first row, **Let a judge drive**, is a QR code for `/drive`.

The drive page is the unknown drone's own view. The judge taps **Launch at Angels Gate**, then touches and drags on the chart to steer. The big screen watches the track and calls the target before the drone gets there. **Surface** takes the drone off the chart.

The page connects with the socket role `pilot`, and the hub accepts only three things from it, checked on the server in `src/engine/pilot.ts`:

- launch the driven drone, only in Simulation mode and only if none is being driven (otherwise the page takes over the one that is),
- steer that drone to a point on the chart,
- surface that drone.

In Live mode the page says to ask the desk to switch to Simulation and allows nothing. The page never sees the risk score, the odds or the forecast.
