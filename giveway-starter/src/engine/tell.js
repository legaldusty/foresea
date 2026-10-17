import { distanceField } from './grid.js';

export const LOST = -1;

export function createTell(grid, targets, opts = {}) {
  const o = {
    beta: 1.3,
    lostPrior: 0.25,
    forget: 0.04,
    callAt: 0.6,
    callSteps: 3,
    ...opts,
  };
  const fields = targets.map((t) => distanceField(grid, t.cell));
  const n = targets.length;
  const prior = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) prior[k] = (1 - o.lostPrior) / n;
  prior[n] = o.lostPrior;
  return {
    grid, targets, fields, o, prior,
    post: Float64Array.from(prior),
    steps: 0, streak: 0, streakGoal: -2,
    call: null,
    pathCells: 0,
  };
}

export function resetTell(T) {
  T.post = Float64Array.from(T.prior);
  T.steps = 0; T.streak = 0; T.streakGoal = -2; T.call = null; T.pathCells = 0;
}

export function observe(T, a, b) {
  const { grid, fields, o, post, prior } = T;
  const nb = grid.neighbors[a];
  const n = fields.length;
  let moveCost = 1;
  for (let k = 0; k < nb.length; k += 2) if (nb[k] === b) moveCost = nb[k + 1];
  const m = nb.length / 2 || 1;

  for (let g = 0; g < n; g++) {
    const D = fields[g], Da = D[a];
    if (!isFinite(Da)) { post[g] *= 1e-6; continue; }
    let Z = 0, num = 0;
    for (let k = 0; k < nb.length; k += 2) {
      const adv = Da - (nb[k + 1] + D[nb[k]]);
      const w = Math.exp(o.beta * adv);
      Z += w; if (nb[k] === b) num = w;
    }
    post[g] *= Z > 0 ? num / Z : 1e-6;
  }
  post[n] *= 1 / m;

  let s = 0;
  for (let g = 0; g <= n; g++) { post[g] = Math.pow(post[g] + 1e-300, 1 - o.forget) * Math.pow(prior[g], o.forget); s += post[g]; }
  for (let g = 0; g <= n; g++) post[g] /= s;

  T.steps++; T.pathCells += moveCost;
  const best = topGoal(T);
  if (best.goal !== LOST && best.p >= o.callAt) {
    T.streak = best.goal === T.streakGoal ? T.streak + 1 : 1;
    T.streakGoal = best.goal;
    if (T.streak >= o.callSteps && (!T.call || T.call.goal !== best.goal)) {
      T.call = { goal: best.goal, step: T.steps, odds: best.p, remainingCells: fields[best.goal][b] };
    }
  } else { T.streak = 0; T.streakGoal = -2; }
  return T;
}

export function odds(T) {
  const n = T.fields.length;
  const out = T.targets.map((t, g) => ({ goal: g, name: t.name, p: T.post[g] }));
  out.push({ goal: LOST, name: 'Lost / wandering', p: T.post[n] });
  return out.sort((a, b) => b.p - a.p);
}

export function topGoal(T) {
  const n = T.fields.length; let goal = LOST, p = T.post[n];
  for (let g = 0; g < n; g++) if (T.post[g] > p) { p = T.post[g]; goal = g; }
  return { goal, p };
}

export function uncertainty(T) {
  const n = T.post.length; let H = 0;
  for (const p of T.post) if (p > 0) H -= p * Math.log(p);
  return H / Math.log(n);
}

export function predictedPath(T, goal, cell, maxSteps = 2000) {
  const D = T.fields[goal], nb = T.grid.neighbors, out = [cell];
  let i = cell;
  for (let s = 0; s < maxSteps && D[i] > 0; s++) {
    let best = -1, bd = D[i];
    for (let k = 0; k < nb[i].length; k += 2) { const j = nb[i][k]; if (D[j] < bd) { bd = D[j]; best = j; } }
    if (best < 0) break; out.push(best); i = best;
  }
  return out;
}

export function evasiveness(T, startCell, cell) {
  const { goal } = topGoal(T); if (goal === LOST) return 1;
  const D = T.fields[goal];
  const progress = D[startCell] - D[cell];
  return progress > 2 ? T.pathCells / progress : 1;
}
