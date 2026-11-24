'use strict';
// Worker thread: executes qualification / round-robin tasks.
const { parentPort, workerData } = require('worker_threads');
const { runBattle, seedFor } = require('./battle');

let sets = null;           // final sets (tournament)
let gauntlet = null;       // [{idx, set}] (qualification)

function loadSets() {
  if (!sets && workerData.setsFile) sets = require(workerData.setsFile).sets;
  return sets;
}

parentPort.on('message', (task) => {
  try {
    if (task.type === 'row') parentPort.postMessage(runRow(task));
    else if (task.type === 'qualify') parentPort.postMessage(runQualify(task));
    else throw new Error('unknown task ' + task.type);
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String(e && e.stack || e), task });
  }
});
parentPort.postMessage({ type: 'ready' });

// One row of the round robin: entrant i against every j > i.
function runRow({ i, seed, battles, n }) {
  const S = loadSets();
  const out = [];
  for (let j = i + 1; j < n; j++) {
    let wi = 0, wj = 0, d = 0, turns = 0;
    for (let k = 0; k < battles; k++) {
      const iFirst = k % 2 === 0; // alternate player slots
      const r = runBattle(iFirst ? S[i] : S[j], iFirst ? S[j] : S[i], seedFor(seed, i, j, k));
      turns += r.turns;
      if (r.winner === null) d++;
      else if ((r.winner === 0) === iFirst) wi++;
      else wj++;
    }
    out.push([j, wi, wj, d, turns]);
  }
  return { type: 'row', i, results: out };
}

// Candidate sets of one entrant against the benchmark gauntlet.
function runQualify({ entry, candidates, opponents, seed, battles }) {
  const scores = candidates.map(() => ({ points: 0, games: 0, turns: 0 }));
  for (let c = 0; c < candidates.length; c++) {
    for (const opp of opponents) {
      if (opp.id === entry) continue;
      for (let k = 0; k < battles; k++) {
        const iFirst = k % 2 === 0;
        const r = runBattle(iFirst ? candidates[c] : opp.set, iFirst ? opp.set : candidates[c], seedFor(seed, 'q', entry, opp.id, k));
        const sc = scores[c];
        sc.games++; sc.turns += r.turns;
        if (r.winner === null) sc.points += 0.5;
        else if ((r.winner === 0) === iFirst) sc.points += 1;
      }
    }
  }
  return { type: 'qualify', entry, scores };
}
