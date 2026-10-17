# Harbor basemap tiles

`public/tiles/harbor.pmtiles`, 8.5 MB, extracted from the Protomaps daily build `20261016.pmtiles`
(OSM replication 2026-10-16 04:00 UTC, Protomaps basemap 4.15.2, planetiler 0.10.2).

- Bounds -118.32, 33.67 to -118.12, 33.80. Zoom 0 to 15. 400 tile entries, MVT, gzip.
- Attribution required on the map: OpenStreetMap contributors (from the archive metadata).
- Rebuild with `npx tsx scripts/tiles.ts` (newest build in the last 10 days) or pin a build with `--date 20261016`.
  Needs the go-pmtiles CLI on PATH (`brew install pmtiles`) or `PMTILES_BIN`.

## Source layers

`earth`, `water`, `landuse`, `roads`, `buildings`, `pois`, `places`, `boundaries`.
Every feature carries `kind`; most carry `sort_rank` or `min_zoom`. Counts below are from z14 and z15.

## kind and kind_detail present

| Layer | kind (kind_detail) |
| --- | --- |
| earth | earth, island (named: Terminal Island, Naples Islands), cliff (lines) |
| water | ocean, water (basin, lake, river, stream), dock, bay, river, stream, canal, reef (rock), swimming_pool, fountain, drain, ditch |
| landuse | industrial, pier, residential, park, pitch, school, pedestrian, grass, commercial, playground, military, sand, beach, wetland, scrub, wood, garden, meadow, platform, railway, recreation_ground, hospital, golf_course, cemetery, nature_reserve, other |
| roads | highway (motorway, motorway_link), major_road (trunk, primary, secondary, tertiary and links), minor_road (residential, service, unclassified, alley, driveway), path (footway, cycleway, pier, sidewalk, crossing, steps, track, path), rail (rail, light_rail, tram, yard, crane, disused), ferry, other (living_street, platform) |
| buildings | building, building_part (yes, hotel); z15 adds address points |
| pois | marina, industrial, park, ferry_terminal, coastline, fort, fuel, helipad, aquarium, museum, plus shops and services; z15 adds stops, crossings, trees, signals |
| places | locality (city, hamlet, locality), neighbourhood (suburb), macrohood (quarter) |
| boundaries | locality (8), county (6) |

## Piers, breakwaters, docks

- Breakwaters are land: `earth` polygons with kind `earth`. San Pedro Breakwater sits near lat 33.706,
  Middle Breakwater runs from -118.236, 33.714 to -118.190, 33.723, Long Beach Breakwater near lat 33.723.
- Breakwater names come only as label points: `pois` kind `coastline` ("Middle Breakwater",
  "Long Beach Breakwater"), same kind as the oil islands (Chaffee, Freeman, Grissom, White, Treasure).
- Pier decks are `landuse` kind `pier` polygons, no names. The Angels Gate light is a small pier polygon
  at -118.252, 33.708.
- Pier walkways and wharf edges are `roads` kind `path`, kind_detail `pier`; some are named ("Berth 29 A").
- Container terminals are `pois` kind `industrial` with names (Pier 400, TraPac, Yusen, Evergreen,
  Yang Ming, China Shipping). The cruise terminal is `pois` kind `ferry_terminal`
  ("Los Angeles World Cruise Center"), as is the Catalina Express San Pedro Terminal.
- Harbor water names arrive at z15 as `water` label points: kind `bay` (San Pedro Bay, Outer Harbor,
  Inner Harbor, Los Angeles Harbor, Long Beach Middle Harbor, Queensway Bay) and kind `dock`
  (West Basin, East Basin, Turning Basin, Fish Harbor, Channel Two, Channel Three, Slip 1, Slip 5,
  Berth 206 to 211, Berth 301 to 305). At z14 only a few rivers and canals are named.

## Which fields carry names

- `name` on earth (islands), water, roads, pois and places. Landuse and buildings have no names.
- Localized names as `name:xx` (en, es, zh-Hans, ko, vi and others) and `pgf:name:xx` on places and a few pois.
- Roads also carry `ref`, `network`, `shield_text` (and `_1`, `_2` variants), `oneway`, `is_bridge`, `is_tunnel`, `is_link`.
- Buildings carry `height` and `min_height`; pois carry `elevation` on some features.

## Chart styling hints

- Fill water from `water` kinds ocean, water, dock, bay; keep river lines thin.
- Draw `earth` and `landuse` pier in the land color so breakwaters and wharves read as solid edges.
- Label harbor water from `water` points at z15 and the breakwaters from `pois` coastline points.
