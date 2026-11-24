'use strict';
// Round-robin tournament: every entrant battles every other entrant.
//
//   node src/tournament.js [--battles=2] [--seed=N] [--workers=N] [--sets=data/sets.json]
//
// Work is split into rows (entrant i vs all j > i) processed in parallel by worker threads.
// Each finished row is written to results/rows/<i>.json, so an interrupted run resumes where
// it stopped. A manifest pins the seed / battles-per-matchup / set file hash; a mismatching
// manifest aborts instead of silently mixing incompatible results. Live progress is written to
// results/progress.json (read by the dashboard).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { runPool } = require('./pool');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const setsFile = path.resolve(ROOT, args.sets || 'data/sets.json');
const outDir = path.resolve(ROOT, args.out || 'results');
const rowDir = path.join(outDir, 'rows');
const seed = Number(args.seed || config.seed);
const battles = Number(args.battles || config.battlesPerMatchup);
const workers = Number(args.workers || require('os').cpus().length);

async function main() {
  fs.mkdirSync(rowDir, { recursive: true });
  const setsData = require(setsFile);
  const n = setsData.sets.length;
  if (setsData.sets.some((s) => !s)) throw new Error('some entrants have no set; re-run qualify');
  const setsHash = crypto.createHash('sha256').update(JSON.stringify(setsData.sets)).digest('hex').slice(0, 16);
  const manifest = { seed, battles, setsFile: path.relative(ROOT, setsFile), setsHash, entrants: n, engine: require('pokemon-showdown/package.json').version, calc: require('@smogon/calc/package.json').version };
  const mf = path.join(outDir, 'manifest.json');
  if (fs.existsSync(mf)) {
    const old = JSON.parse(fs.readFileSync(mf, 'utf8'));
    for (const k of ['seed', 'battles', 'setsHash', 'entrants']) {
      if (old[k] !== manifest[k] && !args.force) throw new Error(`results/ belongs to a different run (${k}: ${old[k]} vs ${manifest[k]}); use --out=<dir> or --force`);
    }
  }
  fs.writeFileSync(mf, JSON.stringify({ ...manifest, started: new Date().toISOString() }, null, 1));

  const totalPairs = n * (n - 1) / 2;
  let donePairs = 0;
  const tasks = [];
  for (let i = 0; i < n - 1; i++) {
    if (fs.existsSync(path.join(rowDir, `${i}.json`))) donePairs += n - 1 - i;
    else tasks.push({ type: 'row', i, n, seed, battles });
  }
  // longest rows first for load balance, but interleave so early leaderboards are meaningful
  tasks.sort((a, b) => a.i - b.i);
  console.log(`${n} entrants, ${totalPairs} matchups x ${battles} battles = ${totalPairs * battles} battles; ${donePairs} matchups already done; ${tasks.length} rows to run on ${workers} workers`);
  const startPairs = donePairs;
  const t0 = Date.now();
  let lastWrite = 0;
  const writeProgress = (final) => {
    const el = (Date.now() - t0) / 1000;
    const rate = (donePairs - startPairs) / Math.max(1, el);
    const p = {
      entrants: n, totalMatchups: totalPairs, doneMatchups: donePairs, battlesPerMatchup: battles,
      totalBattles: totalPairs * battles, doneBattles: donePairs * battles,
      battlesPerSecond: +(rate * battles).toFixed(1), etaSeconds: rate > 0 ? Math.round((totalPairs - donePairs) / rate) : null,
      running: !final, updated: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outDir, 'progress.json'), JSON.stringify(p));
    return p;
  };
  writeProgress(false);
  await runPool(tasks, {
    workers,
    workerData: { setsFile },
    onResult: (r) => {
      fs.writeFileSync(path.join(rowDir, `${r.i}.json`), JSON.stringify(r.results));
      donePairs += r.results.length;
      if (Date.now() - lastWrite > 3000) {
        lastWrite = Date.now();
        const p = writeProgress(false);
        process.stdout.write(`\r${(100 * donePairs / totalPairs).toFixed(2)}%  ${p.doneBattles}/${p.totalBattles} battles  ${p.battlesPerSecond}/s  ETA ${p.etaSeconds ? (p.etaSeconds / 60).toFixed(1) + ' min' : '?'}     `);
      }
    },
  });
  writeProgress(true);
  console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
