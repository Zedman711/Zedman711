'use strict';
// Set qualification: choose each entrant's best competitive build *empirically*.
//
// 1. Build all legal candidate sets for every entrant (src/setbuilder.js).
// 2. Pick a benchmark gauntlet of 40 entrants, stratified by base-stat total (8 per quintile),
//    with a fixed seed. Gauntlet members first qualify among themselves (using provisional sets),
//    which fixes the gauntlet's own builds.
// 3. Every entrant's candidates fight the gauntlet (both player slots). Successive halving:
//    all candidates face 20 gauntlet members; the top 3 face the other 20 as well. The candidate
//    with the most points is the entrant's tournament set.
// Resumable: finished entrants are stored in results/qualify/*.jsonl.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { candidateSets, setTypeEnvironment } = require('./setbuilder');
const { runPool } = require('./pool');
const { seedFor } = require('./battle');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const seed = Number(args.seed || config.seed);
const workers = Number(args.workers || require('os').cpus().length);
const limit = args.limit ? Number(args.limit) : Infinity;
const TAG = Number.isFinite(limit) ? `-proto${limit}` : '';
const QDIR = path.join(ROOT, 'results/qualify' + TAG);

function rng(s) { let x = seedFor(s, 'gauntlet')[0] * 65536 + seedFor(s, 'gauntlet')[1] || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

function loadJsonl(f) {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  fs.mkdirSync(QDIR, { recursive: true });
  let roster = require('../data/roster.json');
  setTypeEnvironment(roster);
  if (limit < roster.length) roster = roster.slice(0, limit);

  // ---- 1. candidates
  const candFile = path.join(ROOT, `data/candidates${TAG}.json`);
  let candidates;
  if (fs.existsSync(candFile) && !args.rebuild) candidates = require(candFile);
  else {
    console.time('candidates');
    candidates = {};
    for (const e of roster) {
      try { candidates[e.id] = candidateSets(e); } catch (err) { console.error('set builder failed for', e.name, err.message); candidates[e.id] = []; }
    }
    fs.writeFileSync(candFile, JSON.stringify(candidates));
    console.timeEnd('candidates');
  }
  const missing = roster.filter((e) => !(candidates[e.id] || []).length);
  if (missing.length) console.log('entrants without a legal set:', missing.map((e) => e.name).join(', '));
  const field = roster.filter((e) => (candidates[e.id] || []).length);
  const total = field.reduce((a, e) => a + candidates[e.id].length, 0);
  console.log(`${field.length} entrants, ${total} candidate sets (avg ${(total / field.length).toFixed(1)})`);

  // ---- 2. gauntlet
  const sorted = field.slice().sort((a, b) => a.bst - b.bst || a.id.localeCompare(b.id));
  const rand = rng(seed);
  const G = [];
  const per = 8, q = 5;
  for (let k = 0; k < q; k++) {
    const slice = sorted.slice(Math.floor(k * sorted.length / q), Math.floor((k + 1) * sorted.length / q));
    const pickd = new Set();
    while (pickd.size < Math.min(per, slice.length)) pickd.add(slice[Math.floor(rand() * slice.length)].id);
    G.push(...pickd);
  }
  // interleave quintiles so both halves of the gauntlet are balanced
  const gauntletIds = [];
  for (let k = 0; k < per; k++) for (let qq = 0; qq < q; qq++) { const id = G[qq * per + k]; if (id) gauntletIds.push(id); }
  console.log('gauntlet:', gauntletIds.join(', '));

  const provisional = (id) => candidates[id][0];
  const gFile = path.join(QDIR, 'gauntlet.jsonl');
  const gDone = new Map(loadJsonl(gFile).map((r) => [r.entry, r]));
  const gTasks = gauntletIds.filter((id) => !gDone.has(id)).map((id) => ({
    type: 'qualify', entry: id, candidates: candidates[id], seed, battles: 2,
    opponents: gauntletIds.map((o) => ({ id: o, set: provisional(o) })),
  }));
  console.log(`stage A: ${gTasks.length} gauntlet members to qualify`);
  await runPool(gTasks, {
    workers,
    onResult: (r) => { fs.appendFileSync(gFile, JSON.stringify(r) + '\n'); gDone.set(r.entry, r); },
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
  });
  process.stdout.write('\n');
  const best = (id, scores, subset) => {
    let bi = 0, bv = -Infinity;
    scores.forEach((s, i) => {
      if (subset && !subset.includes(i)) return;
      const v = s.points / Math.max(1, s.games) - 1e-4 * s.turns / Math.max(1, s.games);
      if (v > bv) { bv = v; bi = i; }
    });
    return bi;
  };
  const gauntlet = gauntletIds.map((id) => ({ id, set: candidates[id][best(id, gDone.get(id).scores)] }));

  // ---- 3. everyone vs gauntlet, successive halving
  const half1 = gauntlet.filter((_, k) => k % 2 === 0), half2 = gauntlet.filter((_, k) => k % 2 === 1);
  const r1File = path.join(QDIR, 'round1.jsonl'), r2File = path.join(QDIR, 'round2.jsonl');
  const r1 = new Map(loadJsonl(r1File).map((r) => [r.entry, r]));
  const t1 = field.filter((e) => !r1.has(e.id)).map((e) => ({ type: 'qualify', entry: e.id, candidates: candidates[e.id], opponents: half1, seed, battles: 2 }));
  t1.sort((a, b) => b.candidates.length - a.candidates.length);
  console.log(`stage B round 1: ${t1.length} entrants`);
  let t0 = Date.now();
  await runPool(t1, {
    workers,
    onResult: (r) => { fs.appendFileSync(r1File, JSON.stringify(r) + '\n'); r1.set(r.entry, r); },
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}  ${((Date.now() - t0) / d / 1000 * (t - d) / 60).toFixed(1)} min left   `),
  });
  process.stdout.write('\n');
  const finalists = (id) => {
    const sc = r1.get(id).scores.map((s, i) => ({ i, v: s.points / Math.max(1, s.games) })).sort((a, b) => b.v - a.v);
    return sc.slice(0, 3).map((x) => x.i);
  };
  const r2 = new Map(loadJsonl(r2File).map((r) => [r.entry, r]));
  const t2 = field.filter((e) => !r2.has(e.id) && candidates[e.id].length > 1).map((e) => {
    const f = finalists(e.id);
    return { type: 'qualify', entry: e.id, idx: f, candidates: f.map((i) => candidates[e.id][i]), opponents: half2, seed, battles: 2 };
  });
  console.log(`stage B round 2: ${t2.length} entrants`);
  t0 = Date.now();
  const idxOf = new Map(t2.map((t) => [t.entry, t.idx]));
  await runPool(t2, {
    workers,
    onResult: (r) => { r.idx = idxOf.get(r.entry); fs.appendFileSync(r2File, JSON.stringify(r) + '\n'); r2.set(r.entry, r); },
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}  ${((Date.now() - t0) / d / 1000 * (t - d) / 60).toFixed(1)} min left   `),
  });
  process.stdout.write('\n');

  // ---- 4. final selection
  const out = [], report = [];
  for (const e of roster) {
    const cands = candidates[e.id] || [];
    if (!cands.length) { out.push(null); report.push({ id: e.id, chosen: null }); continue; }
    const s1 = r1.get(e.id).scores;
    let chosen = 0, detail = s1.map((s, i) => ({ i, archetype: cands[i].archetype, r1: s.points / s.games }));
    if (r2.has(e.id)) {
      const rr = r2.get(e.id);
      const comb = rr.idx.map((ci, k) => ({ ci, v: (s1[ci].points + rr.scores[k].points) / (s1[ci].games + rr.scores[k].games), t: s1[ci].turns + rr.scores[k].turns }));
      comb.sort((a, b) => b.v - a.v || a.t - b.t);
      chosen = comb[0].ci;
      for (const c of comb) detail[c.ci].combined = c.v;
    }
    out.push(cands[chosen]);
    report.push({ id: e.id, chosen, archetype: cands[chosen].archetype, candidates: detail });
  }
  const meta = { seed, gauntlet: gauntletIds, created: new Date().toISOString(), ruleset: config };
  fs.writeFileSync(path.join(ROOT, `data/sets${TAG}.json`), JSON.stringify({ meta, ids: roster.map((e) => e.id), sets: out }, null, 1));
  fs.writeFileSync(path.join(ROOT, `data/qualification-report${TAG}.json`), JSON.stringify(report));
  console.log('wrote data/sets.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
