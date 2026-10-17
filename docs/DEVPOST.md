# Devpost answers for Foresea

Copy each part into the matching Devpost box. Every number here comes from our own tests and the live site, so it is all true.

## Project name

Foresea

## Elevator pitch

Foresea predicts where an unknown underwater drone is going and moves only the boats in its way, so the port never shuts down. On normal days it protects divers, whales and crews too.

## About the project

Paste everything below this line into the "About the project" box. It is already in Markdown.

```markdown
## Inspiration

Picture the Port of Los Angeles at 2 AM. A sensor picks up something small moving underwater near the harbor entrance. It does not answer when you ping it. Nobody knows what it is or where it is going.

Right now the safe move is to close the port. That costs somewhere between $65 million and $150 million a day, and it happens because nobody can tell what the thing is about to do.

At kickoff, NULL Systems asked the Marine track one question: how do you respond without shutting the harbor down? We thought about it for a while and realized the real answer is time. If you know early where something is heading, you only have to move the few boats in its way. If you find out late, closing everything is the only option left. So we built Foresea to buy that time.

The name is "foresee" plus "sea". You cannot stop what you cannot see coming.

## What it does

Foresea is a harbor watch system with two sides. The harbor officer gets a desk on a laptop. Boat captains get an app on their phone.

When something unknown shows up in the water, Foresea first works out what it probably is. It looks at size, heat, speed and whether it answers an ID ping, and sorts it into a powered drone, a lost research robot, a marine animal or a person in the water.

Then it predicts where it is going. Our model, TELL, watches every single move the contact makes and updates the odds for every dock in the harbor. On the map it looks like a hurricane forecast for drones. Yellow is everywhere it could be in the next half hour. Red is where it is most likely headed, with time marks so you know when it gets there. As the drone commits to a target, the red narrows down in front of you.

Next it scores the risk on a 5 by 5 grid, the same idea the Coast Guard uses to rate port threats: how likely is harm, and how bad would it be at the place it is heading.

Then comes the part we care about most. Instead of closing the port, Foresea drafts the gentlest response that still keeps everyone safe. It only moves the boats whose routes actually cross the forecast, gives each one a reroute, and tells you exactly how many minutes of delay that costs. A typical night costs a couple of boat minutes and zero closed gates.

A person always publishes. The officer reads the draft, taps Publish, and every captain in the path gets one clear instruction on their phone, like ALTER COURSE NORTHWEST 800 m, with a countdown and their new route drawn on the map. Captains never see risk scores or the word drone. Boats that are nowhere near it do not get spammed. If a captain ignores the alert, the desk gets a card after 4 minutes with a radio script ready to read over VHF.

Every decision explains itself. One tap on "Why?" shows the evidence, the risk grid, the odds over time and the exact rules that fired. Afterwards there is an after action report with how many minutes of warning the port got and who acknowledged.

## The dual use part

This is what we are proudest of. The same engine that tracks a hostile drone runs the harbor on a regular Tuesday.

Dive teams file a dive plan and boats near them get told to slow down. A dredge working the main channel gets a moving keep clear zone. When a captain reports a whale from their phone, the officer confirms it and big ships slow to 10 knots around it.

When a research robot loses contact, Foresea sees that it is drifting with the real NOAA ocean current instead of aiming anywhere, calls it "lost, not hostile", messages the owner and turns the drift forecast into a search area.

We also added a person overboard button. A captain holds SOS for two seconds and the desk instantly gets their exact position plus a search area that drifts with the current, along with a Coast Guard brief ready to send. That is the same math that tracks drones, used to find a person in the water.

The phone also shows live tide curves, wind, waves and the National Weather Service marine forecast. When the weather service issues a small craft advisory, the officer relays it to every captain in one tap. There is an on time board that compares real ship arrival times against our own estimates, and a public board for marina screens that never shows scores.

So the defense side and the everyday side are not two products. They are one system, and the everyday use is what keeps the officer practiced and the captains trusting it for the night it really matters.

## What is real and what is simulated

We wanted judges to trust what they see, so everything that can be real is real. Ship positions are live from AIS. Tides, currents, wind, waves and water temperature are live from NOAA stations and buoys. Forecasts and advisories come straight from the National Weather Service. The chart is built from OpenStreetMap. The wording and translations come from IBM Granite running on our own server.

The underwater contacts, their sensor readings and the small boats with phones are simulated, because we obviously cannot launch a drone into the Port of LA. Every simulated number says "Simulated" right next to it on screen.

## How we built it

Foresea is written in TypeScript from top to bottom. One shared engine runs in the browser, in a background worker and on the server, so the desk, the phones and our tests all use the exact same math.

TELL is based on Bayesian inverse planning. For every possible target, it asks how well each move fits a vessel heading there. A move that gets closer to a target over water makes that target more likely:

$$P(g \mid x_{0:t}) \propto P(g)\prod_{k=1}^{t} e^{\beta\,(d_g(x_{k-1}) - d_g(x_k))}$$

Here $d_g$ is the distance through water to target $g$, and $\beta$ controls how purposeful we expect a pilot to be. TELL also keeps two extra hypotheses: "lost" and "drifting with the current". That is how a dead robot never gets mistaken for an attack.

Risk is likelihood times severity on a 5 by 5 grid, with five hard rules on top, like "people are never scored as targets" and "high risk always waits for a person".

The desk and phone app are built with React and Vite. The nautical chart is MapLibre drawing an offline PMTiles map of San Pedro Bay, styled for day and night. A Node server with Socket.IO keeps the desk and every phone in sync within a second and writes an audit log to SQLite. Phones get real push notifications through Web Push and keep working offline with the last known zones.

We trained a traffic model on 2,620 real AIS reports so the desk can flag real ships acting strange, like a ship that suddenly goes dark. IBM Granite 4 runs locally through Ollama and writes the notice, the radio call, the Coast Guard brief and translations into Spanish, Chinese, Korean, Tagalog and Vietnamese. It never makes a decision, and every sentence it writes is checked against the facts. If it gets anything wrong, a template takes over.

We designed every screen in Figma first and built from the design. The site runs on a VPS behind HTTPS, and every visitor gets their own private harbor, so two judges can try it at the same time without stepping on each other. Each private harbor has a guided tour that runs the real scenes and points at each feature as it happens.

## Proof that it works

We did not want to just say it works, so we tested it.

In 1,000 simulated nights with the drone detected at the harbor gates, Foresea gave about 74 minutes of warning. Just guessing the nearest dock gave about 47 minutes. That is about 1.56 times more warning, and it picked the right target before arrival every single time.

When we checked the forecast against the drone's real path, the drone stayed inside the yellow area 97% of the time.

Our traffic model flags only about 0.5% of normal real traffic, but catches 94% of ships that go dark while moving.

Five incident scenarios, including a fake out, a lost glider and a late detection, pass every rule we wrote down before we ran them. 353 automated tests and two full end to end walkthroughs with a laptop and two phones pass on every change.

We are also honest about the weak spot. If the drone is only spotted when it is already very close, guessing the nearest dock is about as good as TELL, because there is no time left to learn anything.

## Challenges we ran into

A drone drifting with the current looks a lot like a drone aiming somewhere. Our first version kept accusing a dead research robot of attacking a dock. We fixed it by pulling live NOAA current data and adding a "just drifting" hypothesis.

The free map data marks big parts of the port as "industrial land" even where there is water, so our first harbor map let drones drive through piers. We rebuilt the whole grid from the chart tiles so nothing can cross a breakwater.

A small AI model running on a cheap server sometimes writes bad radio calls. We made a rule that every sentence has to contain the real instruction, place and numbers, or we use the template instead.

Our first design looked like an airplane cockpit and nobody could follow it. We threw it out and rebuilt the interface around one plain sentence at the top that says what is happening, plus a guided tour.

## Accomplishments that we're proud of

You can grab a joystick on your phone, drive the drone yourself, and watch the desk call your target before you get there.

Only the boats in the path move, each one priced in minutes, and nothing closes.

A captain's phone lights up within seconds of the officer tapping Publish, and it still works if the signal drops.

Every number on screen can be traced back to a source or a calculation.

## What we learned

The earlier you know, the gentler you can be. Most of the value is not in the alarm. It is in moving three boats instead of closing a port.

We also learned that people only trust a system they can question. The "Why?" button ended up being one of the most important features we built.

## What's next

We want to sit down with the Port of LA operations team and test it with real officers. Foresea already has a sensor API that accepts detections from real underwater sensors, and it publishes alerts in CAP, the standard format emergency systems already use, so plugging in real hardware is the next step. We would also love to run TELL inside NULL's autonomy simulator and against real drone tracks.

## Responsible use

A system like this could be misused to track people or push certain boats out of an area unfairly. Foresea never touches any vehicle. A person approves every public notice, any action can be undone with one tap, and everything is logged with who did it and when.

## Try it

Go to https://foresea.imdusty.com on a laptop and press Start the tour. When it gets to the phone part, scan the QR code with your phone camera. You get your own private harbor, so feel free to break things.
```

## Built with

Paste these as tags, one at a time (24 total):

TypeScript, React, Vite, Node.js, Express, Socket.IO, MapLibre GL, PMTiles, OpenStreetMap, aisstream.io, NOAA CO-OPS, NOAA NDBC, National Weather Service API, Ollama, IBM Granite, SQLite, Web Push, Playwright, Vitest, Figma, Caddy, Hostinger, Phosphor Icons, IBM Plex

## "Try it out" links

1. https://foresea.imdusty.com
2. Your GitHub repo link, once the code is pushed (add it with ADD ANOTHER LINK)

## Image gallery

Upload these from `docs/devpost/gallery/` in this order. They are all 1800 by 1200 (3:2) and well under 5 MB. Use the line after each one as its caption.

1. `01-night-forecast.png`: An unknown drone enters at night. Foresea predicts where it is going and drafts a notice that moves only the boats in its path.
2. `02-phone-alert.png`: One tap from the officer, and the captain in the path gets one clear instruction, a countdown and a new route.
3. `03-why-it-decided.png`: Every decision explains itself: the evidence, the risk grid, the odds and the rules.
4. `04-dossier.png`: The full dossier with the sensor readings and the risk math step by step.
5. `05-ordinary-tuesday.png`: The same system on a normal day: dive teams, a dredge and a whale slow zone.
6. `06-live-conditions.png`: Live tide, wind, waves and the marine forecast on the captain's phone, all from NOAA and the National Weather Service.
7. `07-person-overboard.png`: Person overboard. Hold SOS for two seconds and the desk gets a search area that drifts with the real current.
8. `08-drive-the-drone.png`: Drive the drone yourself with a joystick and watch the desk call your target before you arrive.
9. `09-thousand-nights.png`: Proof from 1,000 simulated nights: about 74 minutes of warning, 1.56 times the nearest dock guess.
10. `10-models.png`: The models behind it, what each one does, what it never does, and how accurate it is.
11. `11-views.png`: Switch between the harbor desk, the captain phone, the drive page and the public board in one click.

## Upload a file

Upload `docs/devpost/foresea-submission.zip`. It has a two page judge's guide (`Foresea Judges Guide.pdf`) and our full source code.

## Video demo link

Paste your YouTube or Vimeo link here after recording. The shot list is in `docs/VIDEO.md`.
