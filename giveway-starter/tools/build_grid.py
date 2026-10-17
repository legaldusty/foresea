import json, math, numpy as np
from roaring_landmask import RoaringLandmask, LandmaskProvider

W, E, S, N = -118.300, -118.140, 33.690, 33.785
CELL_M = 50.0
lat0 = (S + N) / 2
m_per_deg_lat = 111_320.0
m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat0))
dlat = CELL_M / m_per_deg_lat
dlon = CELL_M / m_per_deg_lon
nx = int(round((E - W) / dlon))
ny = int(round((N - S) / dlat))

lm = RoaringLandmask.new_with_provider(LandmaskProvider.Osm)
lons = W + (np.arange(nx) + 0.5) * dlon
lats = N - (np.arange(ny) + 0.5) * dlat
X, Y = np.meshgrid(lons, lats)
land = lm.contains_many(X.ravel(), Y.ravel()).reshape(ny, nx)

BREAKWATERS = {
    "San Pedro Breakwater": [(-118.2830, 33.7105), (-118.2515, 33.7078)],
    "Middle Breakwater":    [(-118.2465, 33.7080), (-118.2150, 33.7135), (-118.1890, 33.7215)],
    "Long Beach Breakwater":[(-118.1825, 33.7235), (-118.1400, 33.7330)],
}
def to_cell(lon, lat):
    return (lon - W) / dlon, (N - lat) / dlat
for pts in BREAKWATERS.values():
    for (a, b) in zip(pts, pts[1:]):
        x0, y0 = to_cell(*a); x1, y1 = to_cell(*b)
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 3) + 1
        for i in range(steps + 1):
            t = i / steps
            x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t
            for dx in (0, 1):
                for dy in (0, 1):
                    cx, cy = int(x) + dx, int(y) + dy
                    if 0 <= cx < nx and 0 <= cy < ny:
                        land[cy, cx] = True

rows = []
for r in land:
    runs, cur, cnt = [], False, 0
    for v in r:
        v = bool(v)
        if v == cur: cnt += 1
        else: runs.append(cnt); cur = v; cnt = 1
    runs.append(cnt)
    rows.append(runs)

out = {
    "name": "San Pedro Bay (Ports of Los Angeles & Long Beach)",
    "source": "Land/water: OpenStreetMap land polygons (ODbL) via roaring-landmask. Breakwaters: approximate, hand-placed.",
    "bbox": {"west": W, "east": E, "south": S, "north": N},
    "cellMeters": CELL_M, "nx": nx, "ny": ny, "dlon": dlon, "dlat": dlat,
    "rle": rows,
    "breakwaters": BREAKWATERS,
}
json.dump(out, open("src/data/harbor_grid.json", "w"), separators=(",", ":"))
print(nx, ny, "cells; land fraction", round(land.mean(), 3))
