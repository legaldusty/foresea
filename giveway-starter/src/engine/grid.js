const SQRT2 = Math.SQRT2;

export function loadGrid(json) {
  const { nx, ny, dlon, dlat, bbox, cellMeters } = json;
  const water = new Uint8Array(nx * ny);
  json.rle.forEach((runs, y) => {
    let x = 0, isLand = false;
    for (const n of runs) {
      if (!isLand) for (let k = 0; k < n; k++) water[y * nx + x + k] = 1;
      x += n; isLand = !isLand;
    }
  });
  const grid = {
    nx, ny, dlon, dlat, bbox, cellMeters, water,
    idx: (x, y) => y * nx + x,
    xy: (i) => [i % nx, (i / nx) | 0],
    inBounds: (x, y) => x >= 0 && y >= 0 && x < nx && y < ny,
    isWater: (i) => water[i] === 1,
    toCell: (lon, lat) => [Math.floor((lon - bbox.west) / dlon), Math.floor((bbox.north - lat) / dlat)],
    toLonLat: (x, y) => [bbox.west + (x + 0.5) * dlon, bbox.north - (y + 0.5) * dlat],
  };
  grid.neighbors = buildNeighbors(grid);
  return grid;
}

function buildNeighbors(g) {
  const { nx, ny, water } = g;
  const nb = new Array(nx * ny);
  const dirs = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,SQRT2],[1,-1,SQRT2],[-1,1,SQRT2],[-1,-1,SQRT2]];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x;
    if (!water[i]) { nb[i] = []; continue; }
    const list = [];
    for (const [dx, dy, c] of dirs) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
      const j = Y * nx + X;
      if (!water[j]) continue;
      if (dx && dy && (!water[y * nx + X] || !water[Y * nx + x])) continue;
      list.push(j, c);
    }
    nb[i] = list;
  }
  return nb;
}

export function nearestWater(g, x, y, maxR = 20) {
  x = Math.max(0, Math.min(g.nx - 1, x)); y = Math.max(0, Math.min(g.ny - 1, y));
  for (let r = 0; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const X = x + dx, Y = y + dy;
      if (g.inBounds(X, Y) && g.water[g.idx(X, Y)]) return g.idx(X, Y);
    }
  return -1;
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lastK = k.pop(), lastV = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
}

export function distanceField(g, target, blocked = null) {
  const D = new Float32Array(g.nx * g.ny).fill(Infinity);
  const h = new Heap(); D[target] = 0; h.push(0, target);
  while (h.size) {
    const i = h.pop(), di = D[i], nb = g.neighbors[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k]; if (blocked && blocked[j]) continue;
      const nd = di + nb[k + 1];
      if (nd < D[j]) { D[j] = nd; h.push(nd, j); }
    }
  }
  return D;
}

export function findPath(g, start, goal, blocked = null) {
  if (start === goal) return [start];
  const [gx, gy] = g.xy(goal);
  const H = (i) => { const x = i % g.nx, y = (i / g.nx) | 0, dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy); };
  const G = new Map([[start, 0]]), from = new Map(), h = new Heap();
  h.push(H(start), start);
  const closed = new Set();
  while (h.size) {
    const i = h.pop();
    if (i === goal) { const p = [i]; let c = i; while (from.has(c)) { c = from.get(c); p.push(c); } return p.reverse(); }
    if (closed.has(i)) continue; closed.add(i);
    const gi = G.get(i), nb = g.neighbors[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k]; if (blocked && blocked[j] && j !== goal) continue;
      const ng = gi + nb[k + 1];
      if (ng < (G.get(j) ?? Infinity)) { G.set(j, ng); from.set(j, i); h.push(ng + H(j), j); }
    }
  }
  return null;
}

export function pathLength(g, path) {
  let L = 0;
  for (let k = 1; k < path.length; k++) {
    const [x0, y0] = g.xy(path[k - 1]), [x1, y1] = g.xy(path[k]);
    L += (x0 !== x1 && y0 !== y1) ? SQRT2 : 1;
  }
  return L;
}

export function walkLine(g, a, b) {
  const [x0, y0] = g.xy(a), [x1, y1] = g.xy(b);
  const out = []; let cx = x0, cy = y0;
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 1; s <= steps; s++) {
    const tx = Math.round(x0 + (x1 - x0) * s / steps), ty = Math.round(y0 + (y1 - y0) * s / steps);
    const j = g.idx(tx, ty), i = g.idx(cx, cy);
    if (j === i) continue;
    const nb = g.neighbors[i]; let ok = false;
    for (let k = 0; k < nb.length; k += 2) if (nb[k] === j) { ok = true; break; }
    if (!ok) break;
    out.push(j); cx = tx; cy = ty;
  }
  return out;
}

export function disk(g, i, r) {
  const [x, y] = g.xy(i), out = [], R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const X = x + dx, Y = y + dy; if (g.inBounds(X, Y)) out.push(g.idx(X, Y));
  }
  return out;
}
