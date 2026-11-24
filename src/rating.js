'use strict';
// Ratings and leaderboards from the round-robin results.
//
// Rating model: Bradley–Terry (the maximum-likelihood, order-independent form of Elo), fitted
// with Hunter's MM algorithm on every battle (draw = half a win to each side) and a weak prior
// (one virtual drawn game against an average opponent) so undefeated entrants stay finite.
// Ratings are reported on the Elo scale (400·log10, mean 1500) with a standard error from the
// Fisher information. Because every pair meets, Elo ≈ ordering by strength of schedule-adjusted
// results; a separate fit restricted to the "standard" pool (no restricted legendaries or
// mythicals) gives the restricted-format ranking.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const outDir = path.resolve(ROOT, args.out || 'results');
const setsFile = path.resolve(ROOT, args.sets || 'data/sets.json');

function load() {
  const roster = require('../data/roster.json');
  const setsData = require(setsFile);
  const ids = setsData.ids;
  const byId = new Map(roster.map((r) => [r.id, r]));
  const entrants = ids.map((id) => byId.get(id));
  const n = ids.length;
  const W = new Float64Array(n * n);   // points of i against j
  const G = new Float64Array(n * n);   // games between i and j
  const WIN = new Uint16Array(n * n), DRAW = new Uint16Array(n * n);
  const T = new Float64Array(n * n);
  let rows = 0;
  for (let i = 0; i < n; i++) {
    const f = path.join(outDir, 'rows', `${i}.json`);
    if (!fs.existsSync(f)) continue;
    rows++;
    for (const [j, wi, wj, d, turns] of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      const g = wi + wj + d;
      W[i * n + j] = wi + d / 2; W[j * n + i] = wj + d / 2;
      G[i * n + j] = G[j * n + i] = g;
      WIN[i * n + j] = wi; WIN[j * n + i] = wj;
      DRAW[i * n + j] = DRAW[j * n + i] = d;
      T[i * n + j] = T[j * n + i] = turns;
    }
  }
  return { roster, entrants, ids, n, W, G, WIN, DRAW, T, sets: setsData.sets, rows };
}

function bradleyTerry(n, W, G, members) {
  const idx = members || [...Array(n).keys()];
  const m = idx.length;
  const gamma = new Float64Array(n).fill(1);
  const wins = new Float64Array(n);
  for (const i of idx) { let w = 0.5; for (const j of idx) w += W[i * n + j]; wins[i] = w; }
  for (let it = 0; it < 2000; it++) {
    let maxDelta = 0;
    const next = new Float64Array(n);
    for (const i of idx) {
      let den = 1 / (gamma[i] + 1); // prior game vs gamma=1
      const gi = gamma[i];
      for (const j of idx) { const g = G[i * n + j]; if (g) den += g / (gi + gamma[j]); }
      next[i] = wins[i] / den;
    }
    let logmean = 0;
    for (const i of idx) logmean += Math.log(next[i]);
    logmean /= m;
    const norm = Math.exp(logmean);
    for (const i of idx) { const v = next[i] / norm; maxDelta = Math.max(maxDelta, Math.abs(Math.log(v / gamma[i]))); gamma[i] = v; }
    if (maxDelta < 1e-9) break;
  }
  const elo = new Float64Array(n), se = new Float64Array(n);
  for (const i of idx) {
    elo[i] = 1500 + 400 * Math.log10(gamma[i]);
    let info = gamma[i] / (gamma[i] + 1) ** 2;
    for (const j of idx) { const g = G[i * n + j]; if (g) { const p = gamma[i] / (gamma[i] + gamma[j]); info += g * p * (1 - p); } }
    se[i] = 400 / Math.LN10 / Math.sqrt(info);
  }
  return { gamma, elo, se };
}

const TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];

function main() {
  const D = load();
  const { n, entrants, W, G, WIN, DRAW, T } = D;
  console.log(`${D.rows}/${n - 1} rows loaded`);
  const all = bradleyTerry(n, W, G);
  const standardIdx = entrants.map((e, i) => (!e.restricted && !e.mythical ? i : -1)).filter((i) => i >= 0);
  const std = bradleyTerry(n, W, G, standardIdx);
  const stdRank = new Map(standardIdx.slice().sort((a, b) => std.elo[b] - std.elo[a]).map((i, r) => [i, r + 1]));
  const order = [...Array(n).keys()].sort((a, b) => all.elo[b] - all.elo[a]);
  const rank = new Map(order.map((i, r) => [i, r + 1]));

  const stats = [];
  for (let i = 0; i < n; i++) {
    const e = entrants[i];
    let wins = 0, losses = 0, draws = 0, games = 0, turns = 0, mW = 0, mL = 0, mD = 0, sweeps = 0, played = 0;
    const byGen = Array.from({ length: 10 }, () => [0, 0]);
    const byType = Object.fromEntries(TYPES.map((t) => [t, [0, 0]]));
    const vs = { legendary: [0, 0], mythical: [0, 0], restricted: [0, 0], mega: [0, 0], top100: [0, 0] };
    const beaten = [], lostTo = [];
    for (let j = 0; j < n; j++) {
      const g = G[i * n + j];
      if (!g || i === j) continue;
      played++;
      const w = WIN[i * n + j], d = DRAW[i * n + j], l = g - w - d, pts = W[i * n + j];
      wins += w; draws += d; losses += l; games += g; turns += T[i * n + j];
      if (pts > g / 2) mW++; else if (pts < g / 2) mL++; else mD++;
      if (w === g) sweeps++;
      const o = entrants[j];
      byGen[o.generation][0] += pts; byGen[o.generation][1] += g;
      for (const t of o.types) { byType[t][0] += pts / o.types.length; byType[t][1] += g / o.types.length; }
      if (o.legendary) { vs.legendary[0] += pts; vs.legendary[1] += g; }
      if (o.mythical) { vs.mythical[0] += pts; vs.mythical[1] += g; }
      if (o.restricted) { vs.restricted[0] += pts; vs.restricted[1] += g; }
      if (o.mega) { vs.mega[0] += pts; vs.mega[1] += g; }
      if (rank.get(j) <= 100) { vs.top100[0] += pts; vs.top100[1] += g; }
      if (pts > g / 2) beaten.push(j); else if (pts < g / 2) lostTo.push(j);
    }
    const pct = (x) => (x[1] ? +(100 * x[0] / x[1]).toFixed(2) : null);
    const typePct = Object.fromEntries(TYPES.map((t) => [t, pct(byType[t])]));
    const typeVals = Object.values(typePct).filter((v) => v !== null);
    beaten.sort((a, b) => all.elo[b] - all.elo[a]);
    lostTo.sort((a, b) => all.elo[a] - all.elo[b]);
    stats.push({
      i, id: e.id, name: e.name, num: e.num, generation: e.generation, types: e.types, bst: e.bst, baseStats: e.baseStats,
      legendary: e.legendary, restricted: e.restricted, mythical: e.mythical, mega: e.mega, primal: e.primal, regional: e.regional,
      ultraBeast: e.ultraBeast, paradox: e.paradox, fullyEvolved: e.fullyEvolved, spriteid: e.spriteid, baseSpecies: e.baseSpecies,
      elo: +all.elo[i].toFixed(1), eloSE: +all.se[i].toFixed(1), rank: rank.get(i),
      standardElo: stdRank.has(i) ? +std.elo[i].toFixed(1) : null, standardRank: stdRank.get(i) || null,
      wins, losses, draws, battles: games, winPct: games ? +(100 * (wins + draws / 2) / games).toFixed(2) : 0,
      matchups: { won: mW, lost: mL, drawn: mD, total: played }, sweepRate: played ? +(100 * sweeps / played).toFixed(2) : 0,
      avgTurns: games ? +(turns / games).toFixed(2) : 0,
      vsGeneration: Object.fromEntries(byGen.map((x, g) => [g, pct(x)]).filter(([g]) => g > 0)),
      vsType: typePct, worstTypePct: typeVals.length ? Math.min(...typeVals) : null,
      vsLegendary: pct(vs.legendary), vsMythical: pct(vs.mythical), vsRestricted: pct(vs.restricted), vsMega: pct(vs.mega), vsTop100: pct(vs.top100),
      bestWins: beaten.slice(0, 8), worstLosses: lostTo.slice(0, 8),
      set: D.sets[i],
    });
  }

  // upsets: matchup won (majority) by the lower-rated entrant
  const upsets = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const g = G[i * n + j];
    if (!g || W[i * n + j] <= g / 2) continue;
    const diff = all.elo[j] - all.elo[i];
    if (diff > 150) upsets.push({ winner: i, loser: j, eloGap: +diff.toFixed(1), score: `${WIN[i * n + j]}-${WIN[j * n + i]}${DRAW[i * n + j] ? '-' + DRAW[i * n + j] : ''}`, expected: +(100 / (1 + 10 ** (diff / 400))).toFixed(2) });
  }
  upsets.sort((a, b) => b.eloGap - a.eloGap);

  const top = (filter, key = 'elo', k = 50) => stats.filter(filter).sort((a, b) => b[key] - a[key] || b.elo - a.elo).slice(0, k).map((s) => s.i);
  const leaderboards = {
    overall: top(() => true, 'elo', 100),
    nonLegendary: top((s) => !s.legendary && !s.mythical),
    legendary: top((s) => s.legendary),
    mythical: top((s) => s.mythical),
    mega: top((s) => s.mega),
    regional: top((s) => s.regional),
    standard: stats.filter((s) => s.standardRank).sort((a, b) => a.standardRank - b.standardRank).slice(0, 100).map((s) => s.i),
    consistent: top((s) => s.worstTypePct !== null, 'worstTypePct'),
    winPct: top(() => true, 'winPct'),
    byGeneration: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => [g, top((s) => s.generation === g, 'elo', 15)])),
    upsets: upsets.slice(0, 100),
  };
  // statistical separation of #1 from the next entrants
  const champ = order[0];
  const separation = order.slice(1, 6).map((j) => {
    const diff = all.elo[champ] - all.elo[j];
    const z = diff / Math.sqrt(all.se[champ] ** 2 + all.se[j] ** 2);
    return { vs: j, eloDiff: +diff.toFixed(1), z: +z.toFixed(2), headToHead: `${WIN[champ * n + j]}-${WIN[j * n + champ]}${DRAW[champ * n + j] ? '-' + DRAW[champ * n + j] : ''}` };
  });

  const manifest = fs.existsSync(path.join(outDir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')) : {};
  let totalBattles = 0, totalDraws = 0;
  for (const s of stats) { totalBattles += s.battles; totalDraws += s.draws; }
  const summary = {
    generated: new Date().toISOString(), manifest, entrants: n, rowsComplete: D.rows, complete: D.rows >= n - 1,
    totalBattles: totalBattles / 2, drawRate: +(100 * totalDraws / Math.max(1, totalBattles)).toFixed(2),
    champion: champ, separation, leaderboards, stats,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary));
  // compact head-to-head matrix: byte = wins*16 + draws (row i vs column j)
  const h2h = Buffer.alloc(n * n);
  for (let k = 0; k < n * n; k++) h2h[k] = G[k] ? Math.min(15, WIN[k]) * 16 + Math.min(15, DRAW[k]) : 255;
  fs.writeFileSync(path.join(outDir, 'h2h.bin'), h2h);
  const show = (list, label) => {
    console.log(`\n${label}`);
    list.slice(0, 10).forEach((i, r) => { const s = stats[i]; console.log(`${String(r + 1).padStart(3)}. ${s.name.padEnd(26)} Elo ${s.elo.toFixed(0)} ±${(1.96 * s.eloSE).toFixed(0)}  win ${s.winPct}%  (${s.wins}-${s.losses}-${s.draws})  ${s.set ? s.set.archetype : ''}`); });
  };
  show(leaderboards.overall, 'OVERALL');
  show(leaderboards.nonLegendary, 'NON-LEGENDARY');
  show(leaderboards.standard, 'STANDARD (no restricted legendaries / mythicals)');
  console.log('\n#1 separation:', separation.map((s) => `${stats[s.vs].name}: +${s.eloDiff} (z=${s.z}, h2h ${s.headToHead})`).join('; '));
}

if (require.main === module) main();
module.exports = { bradleyTerry };
