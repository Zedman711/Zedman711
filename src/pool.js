'use strict';
// Minimal worker-thread pool: runs tasks from a queue on N workers (src/worker.js).
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

function runPool(tasks, { workers = os.cpus().length, workerData = {}, onResult, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const queue = tasks.slice();
    let active = 0, done = 0;
    const total = tasks.length;
    if (!total) return resolve();
    const n = Math.max(1, Math.min(workers, total));
    const pool = [];
    const next = (w) => {
      const t = queue.shift();
      if (!t) {
        w.terminate();
        if (--active === 0) resolve();
        return;
      }
      w.postMessage(t);
    };
    for (let k = 0; k < n; k++) {
      const w = new Worker(path.join(__dirname, 'worker.js'), { workerData });
      active++;
      w.on('message', (msg) => {
        if (msg.type === 'ready') return next(w);
        if (msg.type === 'error') { console.error('worker error:', msg.error); }
        else Promise.resolve(onResult && onResult(msg)).catch(reject);
        done++;
        if (onProgress) onProgress(done, total);
        next(w);
      });
      w.on('error', reject);
      pool.push(w);
    }
  });
}

module.exports = { runPool };
