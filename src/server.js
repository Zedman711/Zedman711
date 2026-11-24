'use strict';
// Dashboard server: static files + battle API on the real Showdown engine.
//
//   node src/server.js [--port=8080]
//
// GET /api/simulate?a=<id>&b=<id>&n=<1-50>&seed=<int>   fresh battles between two entrants
// GET /api/replay?a=<id>&b=<id>&k=<battle#>              exact replay of a tournament battle
// GET /api/progress                                      tournament progress (+ refreshes ratings)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runBattle, seedFor } = require('./battle');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const PORT = Number(args.port || process.env.PORT || 8080);
const RESULTS = path.resolve(ROOT, args.out || 'results');

let setsCache = null, setsMtime = 0;
function sets() {
  const f = path.resolve(ROOT, args.sets || 'data/sets.json');
  const m = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
  if (!setsCache || m !== setsMtime) { setsCache = m ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; setsMtime = m; }
  return setsCache;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

let ratingRunning = false, lastRating = 0;
function refreshRatings() {
  if (ratingRunning || Date.now() - lastRating < 60000) return;
  ratingRunning = true; lastRating = Date.now();
  const p = spawn(process.execPath, [path.join(__dirname, 'rating.js'), `--out=${RESULTS}`], { stdio: 'ignore' });
  p.on('exit', () => { ratingRunning = false; });
}

function battleApi(q, res, replay) {
  const S = sets();
  if (!S) return send(res, 503, { error: 'sets not built yet (run src/qualify.js)' });
  const ia = S.ids.indexOf(q.get('a')), ib = S.ids.indexOf(q.get('b'));
  if (ia < 0 || ib < 0) return send(res, 400, { error: 'unknown entrant id' });
  if (ia === ib) return send(res, 400, { error: 'pick two different entrants' });
  const A = S.sets[ia], B = S.sets[ib];
  if (!A || !B) return send(res, 400, { error: 'entrant has no legal set' });
  const out = [];
  if (replay) {
    // tournament battle: row i < j, battle index k, i on p1 when k is even
    const manifest = JSON.parse(fs.readFileSync(path.join(RESULTS, 'manifest.json'), 'utf8'));
    const i = Math.min(ia, ib), j = Math.max(ia, ib);
    const k = Math.max(0, Math.min(manifest.battles - 1, Number(q.get('k') || 0)));
    const iFirst = k % 2 === 0;
    const p1 = iFirst ? i : j, p2 = iFirst ? j : i;
    const r = runBattle(S.sets[p1], S.sets[p2], seedFor(manifest.seed, i, j, k), { log: true });
    out.push({ p1: S.ids[p1], p2: S.ids[p2], winner: r.winner === null ? null : (r.winner === 0 ? S.ids[p1] : S.ids[p2]), turns: r.turns, log: r.log, seed: [manifest.seed, i, j, k] });
  } else {
    const n = Math.max(1, Math.min(50, Number(q.get('n') || 1)));
    const seed = Number(q.get('seed') || Math.floor(Math.random() * 1e9));
    for (let k = 0; k < n; k++) {
      const aFirst = k % 2 === 0;
      const r = runBattle(aFirst ? A : B, aFirst ? B : A, seedFor(seed, 'live', ia, ib, k), { log: k < 10 });
      const p1 = aFirst ? S.ids[ia] : S.ids[ib], p2 = aFirst ? S.ids[ib] : S.ids[ia];
      out.push({ p1, p2, winner: r.winner === null ? null : (r.winner === 0 ? p1 : p2), turns: r.turns, log: r.log, seed: [seed, 'live', ia, ib, k] });
    }
  }
  const tally = { [S.ids[ia]]: 0, [S.ids[ib]]: 0, draws: 0 };
  for (const r of out) { if (r.winner === null) tally.draws++; else tally[r.winner]++; }
  send(res, 200, { a: S.ids[ia], b: S.ids[ib], sets: { [S.ids[ia]]: A, [S.ids[ib]]: B }, tally, battles: out });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/simulate') return battleApi(url.searchParams, res, false);
    if (url.pathname === '/api/replay') return battleApi(url.searchParams, res, true);
    if (url.pathname === '/api/progress') {
      const f = path.join(RESULTS, 'progress.json');
      const p = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { running: false, doneBattles: 0, totalBattles: 0 };
      if (p.running) refreshRatings();
      return send(res, 200, p);
    }
    let rel = url.pathname === '/' ? '/dashboard/index.html' : decodeURIComponent(url.pathname);
    if (!/^\/(results|data|docs|dashboard)\//.test(rel)) rel = '/dashboard' + rel;
    if (rel.startsWith('/results/')) rel = path.join(path.relative(ROOT, RESULTS), rel.slice('/results/'.length));
    const file = path.resolve(ROOT, '.' + path.sep + rel);
    const allowed = [path.join(ROOT, 'dashboard'), RESULTS, path.join(ROOT, 'data'), path.join(ROOT, 'docs')];
    if (!allowed.some((d) => file.startsWith(d + path.sep)) || file.includes(`${path.sep}rows${path.sep}`)) return send(res, 404, { error: 'not found' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}  (ruleset: ${config.engineFormat}, level ${config.level})`));
