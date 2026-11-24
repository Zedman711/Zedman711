'use strict';
/* Pokémon Battle Lab dashboard. Reads results/summary.json + results/h2h.bin; uses /api/* when served by src/server.js. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPE_COLORS = { Normal: '#9a9a78', Fire: '#e0702c', Water: '#4f7fe0', Electric: '#d6b11c', Grass: '#5ea83e', Ice: '#5fbcbc', Fighting: '#b52f28',
  Poison: '#94409a', Ground: '#c9a24f', Flying: '#8c7ad8', Psychic: '#e34f7c', Bug: '#93a51d', Rock: '#a8913a', Ghost: '#6a5594', Dragon: '#5e3be6',
  Dark: '#6a5446', Steel: '#9a9ab8', Fairy: '#d97fa0', Stellar: '#40b5a5' };
const TYPES = Object.keys(TYPE_COLORS).filter((t) => t !== 'Stellar');
const state = { S: null, H: null, n: 0, byId: new Map(), api: true, sort: null };

function spriteUrls(s) {
  const base = s.baseSpecies.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [`https://play.pokemonshowdown.com/sprites/gen5/${s.spriteid}.png`, `https://play.pokemonshowdown.com/sprites/dex/${s.spriteid}.png`,
    `https://play.pokemonshowdown.com/sprites/gen5/${base}.png`];
}
function sprite(s, cls = '') {
  const u = spriteUrls(s);
  return `<img class="${cls}" alt="${esc(s.name)}" loading="lazy" src="${u[0]}" data-alt="${u.slice(1).join('|')}" onerror="nextSprite(this)">`;
}
window.nextSprite = (img) => { const alts = (img.dataset.alt || '').split('|').filter(Boolean); if (!alts.length) { img.onerror = null; img.style.visibility = 'hidden'; return; } img.src = alts.shift(); img.dataset.alt = alts.join('|'); };
const typeChips = (types) => types.map((t) => `<span class="type" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('');
const tags = (s) => [s.restricted ? 'Restricted' : s.legendary ? 'Legendary' : '', s.mythical ? 'Mythical' : '', s.mega ? 'Mega' : '', s.primal ? 'Primal' : '',
  s.regional ? 'Regional' : '', s.ultraBeast ? 'UB' : '', s.paradox ? 'Paradox' : '', !s.fullyEvolved ? 'NFE' : ''].filter(Boolean).map((t) => `<span class="tag">${t}</span>`).join('');
const fmtPct = (v) => (v === null || v === undefined ? '–' : v.toFixed(1) + '%');

// ------------------------------------------------------------------ data
async function load() {
  try {
    const r = await fetch('results/summary.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('no summary');
    state.S = await r.json();
    state.n = state.S.stats.length;
    const hb = await fetch('results/h2h.bin', { cache: 'no-store' });
    if (hb.ok) state.H = new Uint8Array(await hb.arrayBuffer());
    state.byId = new Map(state.S.stats.map((s) => [s.id, s]));
    state.byName = new Map(state.S.stats.map((s) => [s.name.toLowerCase(), s]));
  } catch (e) { state.S = null; }
}
function h2h(i, j) {
  if (!state.H) return null;
  const v = state.H[i * state.n + j];
  if (v === 255) return null;
  const w = v >> 4, d = v & 15, l = (state.H[j * state.n + i] >> 4);
  return { w, l, d };
}
const find = (txt) => { if (!txt) return null; const t = txt.trim().toLowerCase(); return state.byName.get(t) || state.byId.get(t.replace(/[^a-z0-9]/g, '')) || null; };

// ------------------------------------------------------------------ hero
function renderHero() {
  const S = state.S;
  if (!S) { $('#hero').innerHTML = `<div class="empty" style="grid-column:1/-1">No results yet. Run <code>./run-all.sh</code>; this page fills in as the tournament progresses.</div>`; return; }
  const c = S.stats[S.champion];
  const runners = S.separation.map((x) => { const o = S.stats[x.vs]; return `<div><span>#${o.rank} ${esc(o.name)}</span><span class="num">−${x.eloDiff} Elo · z ${x.z} · h2h ${x.headToHead}</span></div>`; }).join('');
  $('#hero').innerHTML = `
    <div class="art">${sprite(c)}</div>
    <div>
      <div class="eyebrow">${S.complete ? 'Strongest Pokémon overall' : 'Current leader (tournament still running)'}</div>
      <h1>${esc(c.name)}</h1>
      <div>${typeChips(c.types)}${tags(c)}</div>
      <div class="facts"><span>Elo <b>${c.elo.toFixed(0)} ± ${(1.96 * c.eloSE).toFixed(0)}</b></span><span>Win rate <b>${fmtPct(c.winPct)}</b></span>
        <span>Record <b>${c.wins}-${c.losses}-${c.draws}</b></span><span>Matchups won <b>${c.matchups.won}/${c.matchups.total}</b></span>
        <span>Set <b>${esc(c.set.item)}</b> · ${esc(c.set.moves.join(', '))}</span></div>
    </div>
    <div class="runners"><div class="eyebrow">Margin over the next five</div>${runners}</div>`;
  $('#hero .art img').parentElement.onclick = () => openMon(c.id);
}

// ------------------------------------------------------------------ leaderboards
function boardRows() {
  const S = state.S, b = $('#board').value;
  const q = $('#search').value.trim().toLowerCase(), tf = $('#typeFilter').value, fe = $('#feOnly').checked;
  let idx;
  if (b === 'all') idx = S.stats.slice().sort((a, c) => a.rank - c.rank).map((s) => s.i);
  else if (b === 'generation') idx = S.leaderboards.byGeneration[$('#gen').value] || [];
  else if (['overall', 'nonLegendary', 'legendary', 'mythical', 'mega', 'regional', 'consistent', 'winPct', 'standard'].includes(b)) {
    // full lists (not only the precomputed top N) when filtering
    const filt = { overall: () => true, nonLegendary: (s) => !s.legendary && !s.mythical, legendary: (s) => s.legendary, mythical: (s) => s.mythical, mega: (s) => s.mega,
      regional: (s) => s.regional, consistent: (s) => s.worstTypePct !== null, winPct: () => true, standard: (s) => s.standardRank }[b];
    const key = { consistent: 'worstTypePct', winPct: 'winPct', standard: 'standardElo' }[b] || 'elo';
    idx = S.stats.filter(filt).sort((a, c) => c[key] - a[key] || c.elo - a.elo).map((s) => s.i);
  }
  let rows = idx.map((i) => S.stats[i]);
  if (q) rows = rows.filter((s) => s.name.toLowerCase().includes(q));
  if (tf) rows = rows.filter((s) => s.types.includes(tf));
  if (fe) rows = rows.filter((s) => s.fullyEvolved);
  return rows;
}
function renderBoard() {
  const S = state.S, t = $('#boardTable');
  if (!S) { t.innerHTML = ''; return; }
  const b = $('#board').value;
  $('#genwrap').hidden = b !== 'generation';
  if (b === 'upsets') {
    t.innerHTML = `<thead><tr><th>#</th><th>Winner</th><th class="n">Winner Elo</th><th>Beat</th><th class="n">Loser Elo</th><th class="n">Elo gap</th><th class="n">Expected win %</th><th class="n">Score</th></tr></thead><tbody>` +
      S.leaderboards.upsets.map((u, k) => { const w = S.stats[u.winner], l = S.stats[u.loser];
        return `<tr data-a="${w.id}" data-b="${l.id}"><td class="n">${k + 1}</td><td><div class="monCell">${sprite(w)}${esc(w.name)}</div></td><td class="n">${w.elo.toFixed(0)}</td><td><div class="monCell">${sprite(l)}${esc(l.name)}</div></td><td class="n">${l.elo.toFixed(0)}</td><td class="n">${u.eloGap.toFixed(0)}</td><td class="n">${u.expected.toFixed(1)}%</td><td class="n">${u.score}</td></tr>`; }).join('') + '</tbody>';
    t.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => openH2H(tr.dataset.a, tr.dataset.b));
    return;
  }
  const rows = boardRows().slice(0, 400);
  const std = b === 'standard';
  t.innerHTML = `<thead><tr><th class="n">${std ? 'Std #' : 'Rank'}</th><th>Pokémon</th><th>Type</th><th class="n">Elo ±95%</th><th class="n">Win %</th><th class="n">W-L-D</th><th class="n">Matchups</th><th class="n">vs Legend.</th><th class="n">Worst type</th><th>Build</th></tr></thead><tbody>` +
    rows.map((s) => `<tr data-id="${s.id}"><td class="n ${s.rank === 1 ? 'rank1' : ''}">${std ? s.standardRank : s.rank}</td>
      <td><div class="monCell">${sprite(s)}<span>${esc(s.name)}${tags(s)}</span></div></td><td>${typeChips(s.types)}</td>
      <td class="n">${(std ? s.standardElo : s.elo).toFixed(0)} <span class="muted">±${(1.96 * s.eloSE).toFixed(0)}</span></td><td class="n">${fmtPct(s.winPct)}</td>
      <td class="n">${s.wins}-${s.losses}-${s.draws}</td><td class="n">${s.matchups.won}/${s.matchups.total}</td><td class="n">${fmtPct(s.vsLegendary)}</td>
      <td class="n">${fmtPct(s.worstTypePct)}</td><td class="muted">${esc(s.set.archetype)} · ${esc(s.set.item)}</td></tr>`).join('') + '</tbody>';
  t.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => openMon(tr.dataset.id));
}

// ------------------------------------------------------------------ Pokémon detail
function openMon(id) { switchTab('mon'); const s = state.byId.get(id); if (s) { $('#monPick').value = s.name; renderMon(s); } }
function bars(obj, labelFn) {
  return `<div class="bars">${Object.entries(obj).map(([k, v]) => `<div class="bar"><span>${labelFn ? labelFn(k) : k}</span><div class="track"><div class="fill" style="width:${v ?? 0}%"></div><div class="mid"></div></div><span class="num">${fmtPct(v)}</span></div>`).join('')}</div>`;
}
function renderMon(s) {
  const S = state.S;
  const set = s.set;
  const evs = Object.entries(set.evs || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(' / ');
  const statBars = Object.fromEntries(Object.entries(s.baseStats).map(([k, v]) => [k, Math.min(100, v / 2)]));
  const opp = S.stats.map((o) => ({ o, r: h2h(s.i, o.i) })).filter((x) => x.r);
  $('#monView').innerHTML = `
    <div class="card monHead">${sprite(s)}<div><div class="eyebrow">#${s.num} · Generation ${s.generation}</div><h2>${esc(s.name)}</h2><div>${typeChips(s.types)}${tags(s)}</div></div>
      <dl class="kv" style="margin-left:auto"><dt>Overall rank</dt><dd>#${s.rank} of ${S.entrants}</dd><dt>Elo</dt><dd>${s.elo.toFixed(0)} ± ${(1.96 * s.eloSE).toFixed(0)}</dd>
      <dt>Standard rank</dt><dd>${s.standardRank ? '#' + s.standardRank : 'n/a (restricted)'}</dd><dt>Record</dt><dd>${s.wins}-${s.losses}-${s.draws} (${fmtPct(s.winPct)})</dd>
      <dt>Matchups</dt><dd>${s.matchups.won} won · ${s.matchups.lost} lost · ${s.matchups.drawn} split</dd><dt>Clean sweeps</dt><dd>${fmtPct(s.sweepRate)} of matchups</dd><dt>Avg. length</dt><dd>${s.avgTurns} turns</dd></dl></div>
    <div class="cards">
      <div class="card"><h3>Tournament build</h3><div class="muted">${esc(set.archetype)}</div>
        <dl class="kv" style="margin-top:8px"><dt>Item</dt><dd>${esc(set.item)}</dd><dt>Ability</dt><dd>${esc(set.ability)}</dd><dt>Nature</dt><dd>${esc(set.nature)}</dd><dt>EVs</dt><dd>${esc(evs)}</dd></dl>
        <div class="moves">${set.moves.map((m) => `<span>${esc(m)}</span>`).join('')}</div></div>
      <div class="card"><h3>Base stats (BST ${s.bst})</h3>${bars(Object.fromEntries(Object.entries(s.baseStats).map(([k, v]) => [k + ' ' + v, Math.min(100, v / 2.55)])))}</div>
      <div class="card"><h3>Win % by opponent generation</h3>${bars(s.vsGeneration, (g) => 'Gen ' + g)}</div>
      <div class="card"><h3>Win % by opponent type</h3>${bars(s.vsType)}</div>
      <div class="card"><h3>Against the elite</h3>${bars({ 'Legendary': s.vsLegendary, 'Restricted': s.vsRestricted, 'Mythical': s.vsMythical, 'Mega': s.vsMega, 'Top 100': s.vsTop100 })}</div>
      <div class="card"><h3>Best wins</h3>${s.bestWins.map((j) => monLink(S.stats[j])).join('') || '<span class="muted">none</span>'}<h3 style="margin-top:12px">Worst losses</h3>${s.worstLosses.map((j) => monLink(S.stats[j])).join('') || '<span class="muted">none</span>'}</div>
    </div>
    <div class="card"><h3>Match history (${opp.length} opponents)</h3>
      <div class="controls" style="border:0;padding:0 0 10px"><label>Show <select id="mhFilter"><option value="all">All</option><option value="w">Wins</option><option value="l">Losses</option><option value="d">Split / draws</option></select></label><label class="grow">Opponent <input id="mhSearch" type="search" placeholder="Filter"></label></div>
      <div class="tablewrap" style="max-height:480px;overflow:auto"><table class="grid" id="mhTable"></table></div></div>`;
  $('#monView').querySelectorAll('[data-mon]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openMon(a.dataset.mon); });
  const drawHist = () => {
    const f = $('#mhFilter').value, q = $('#mhSearch').value.toLowerCase();
    const rows = opp.filter(({ o, r }) => (f === 'all' || (f === 'w' && r.w > r.l) || (f === 'l' && r.l > r.w) || (f === 'd' && r.w === r.l)) && o.name.toLowerCase().includes(q))
      .sort((a, b) => a.o.rank - b.o.rank);
    $('#mhTable').innerHTML = `<thead><tr><th class="n">Opp. rank</th><th>Opponent</th><th class="n">Score</th><th>Result</th><th></th></tr></thead><tbody>` + rows.map(({ o, r }) => {
      const cls = r.w > r.l ? 'res-w' : r.l > r.w ? 'res-l' : 'res-d';
      return `<tr><td class="n">${o.rank}</td><td><div class="monCell">${sprite(o)}${esc(o.name)}</div></td><td class="n">${r.w}-${r.l}${r.d ? '-' + r.d : ''}</td><td class="${cls}">${r.w > r.l ? 'Won' : r.l > r.w ? 'Lost' : 'Split'}</td>
        <td><button class="ghost" data-b="${o.id}">Head-to-head</button></td></tr>`; }).join('') + '</tbody>';
    $('#mhTable').querySelectorAll('button').forEach((bt) => bt.onclick = (e) => { e.stopPropagation(); openH2H(s.id, bt.dataset.b); });
  };
  $('#mhFilter').onchange = drawHist; $('#mhSearch').oninput = drawHist; drawHist();
}
const monLink = (o) => `<div class="monCell"><img src="${spriteUrls(o)[0]}" data-alt="${spriteUrls(o).slice(1).join('|')}" onerror="nextSprite(this)" alt=""><a href="#" data-mon="${o.id}">${esc(o.name)}</a><span class="muted num">#${o.rank}</span></div>`;

// ------------------------------------------------------------------ head to head + live simulation
function openH2H(a, b) { switchTab('h2h'); $('#hA').value = state.byId.get(a).name; $('#hB').value = state.byId.get(b).name; renderH2H(); }
function renderH2H() {
  const A = find($('#hA').value), B = find($('#hB').value);
  if (!A || !B || A === B) { $('#h2hView').innerHTML = `<div class="empty">Pick two different Pokémon to compare their tournament record and run new battles.</div>`; return null; }
  const r = h2h(A.i, B.i);
  const pA = 100 / (1 + 10 ** ((B.elo - A.elo) / 400));
  const setCard = (s) => `<div class="card"><div class="monHead">${sprite(s)}<div><h3>${esc(s.name)}</h3>${typeChips(s.types)}<div class="muted">#${s.rank} · Elo ${s.elo.toFixed(0)}</div></div></div>
    <div class="muted" style="margin-top:6px">${esc(s.set.item)} · ${esc(s.set.ability)} · ${esc(s.set.nature)}</div><div class="moves">${s.set.moves.map((m) => `<span>${esc(m)}</span>`).join('')}</div></div>`;
  const reps = state.S.manifest.battles || 2;
  $('#h2hView').innerHTML = `<div class="cards">${setCard(A)}
    <div class="card"><h3>Tournament result</h3>${r ? `<div class="big">${r.w} – ${r.l}${r.d ? ' – ' + r.d : ''}</div><div class="muted">${esc(A.name)} wins – ${esc(B.name)} wins${r.d ? ' – draws' : ''}</div>` : '<div class="muted">Not played yet.</div>'}
      <p class="muted">Rating model predicts ${esc(A.name)} wins ${pA.toFixed(1)}% of battles.</p>
      ${r ? `<div class="battleList">${Array.from({ length: reps }, (_, k) => `<button class="ghost" data-k="${k}">Replay tournament battle ${k + 1}</button>`).join('')}</div>` : ''}</div>
    ${setCard(B)}</div>`;
  $('#h2hView').querySelectorAll('[data-k]').forEach((bt) => bt.onclick = () => replay(A, B, bt.dataset.k));
  return [A, B];
}
async function replay(A, B, k) {
  if (!state.api) return noApi();
  $('#viewer').innerHTML = '<div class="empty">Replaying on the Showdown engine…</div>';
  const res = await fetch(`api/replay?a=${A.id}&b=${B.id}&k=${k}`).then((r) => r.json());
  if (res.error) { $('#viewer').innerHTML = `<div class="empty">${esc(res.error)}</div>`; return; }
  showBattles(res, `Tournament battle ${+k + 1} (seed ${res.battles[0].seed.join('·')})`);
}
async function simulate() {
  const pair = renderH2H(); if (!pair) return;
  if (!state.api) return noApi();
  const [A, B] = pair;
  $('#viewer').innerHTML = '<div class="empty">Simulating on the Showdown engine…</div>';
  const n = $('#hN').value || 10, seed = $('#hSeed').value;
  const res = await fetch(`api/simulate?a=${A.id}&b=${B.id}&n=${n}${seed ? '&seed=' + seed : ''}`).then((r) => r.json()).catch(() => ({ error: 'Server not reachable. Start it with: node src/server.js' }));
  if (res.error) { $('#viewer').innerHTML = `<div class="empty">${esc(res.error)}</div>`; return; }
  showBattles(res, `${res.battles.length} new battles · ${esc(A.name)} ${res.tally[A.id]} – ${res.tally[B.id]} ${esc(B.name)}${res.tally.draws ? ' · ' + res.tally.draws + ' draws' : ''}`);
}
function noApi() { $('#viewer').innerHTML = `<div class="empty">Live battles need the local server: <code>node src/server.js</code>, then open http://localhost:8080.</div>`; }

function showBattles(res, title) {
  const withLog = res.battles.map((b, k) => ({ ...b, k })).filter((b) => b.log);
  $('#viewer').innerHTML = `<div class="card"><h3>${title}</h3><div class="battleList">${res.battles.map((b, k) => {
    const w = b.winner ? state.byId.get(b.winner).name : 'Draw';
    return `<button class="ghost" data-k="${k}" ${b.log ? '' : 'disabled'}>#${k + 1}: ${esc(w)} (${b.turns}t)</button>`; }).join('')}</div><div id="arena" style="margin-top:12px"></div></div>`;
  const pick = (k) => { $('#viewer').querySelectorAll('.battleList button').forEach((x) => x.classList.toggle('sel', +x.dataset.k === k)); play(res.battles[k]); };
  $('#viewer').querySelectorAll('.battleList button').forEach((bt) => bt.onclick = () => pick(+bt.dataset.k));
  if (withLog.length) pick(withLog[0].k);
}

let playTimer = null;
function play(b) {
  clearTimeout(playTimer);
  const P = { p1: state.byId.get(b.p1), p2: state.byId.get(b.p2) };
  $('#arena').innerHTML = `<div class="arena">${['p1', 'p2'].map((p) => `<div class="fighter" id="f-${p}">${sprite(P[p])}<div class="name">${esc(P[p].name)}</div><div class="hpbar"><div class="hpfill" style="width:100%"></div></div><div class="status num">100%</div></div>`).join('')}</div>
    <div style="margin:8px 0;display:flex;gap:8px"><button class="ghost" id="skip">Show whole log</button></div><div class="log" id="blog"></div>`;
  const events = parseLog(b.log, P);
  let k = 0;
  const step = () => {
    if (k >= events.length) return;
    const e = events[k++];
    if (e.hp) for (const [p, v, st] of e.hp) { const f = $(`#f-${p}`); if (!f) continue; const fill = $('.hpfill', f); fill.style.width = v + '%'; fill.style.background = v > 50 ? 'var(--hp-hi)' : v > 20 ? 'var(--hp-mid)' : 'var(--hp-lo)'; $('.status', f).textContent = `${v}%${st ? ' · ' + st.toUpperCase() : ''}`; }
    if (e.text) { const d = document.createElement('div'); d.className = e.cls || ''; d.textContent = e.text; $('#blog').appendChild(d); $('#blog').scrollTop = 1e6; }
    playTimer = setTimeout(step, e.text ? (e.cls === 'turn' ? 500 : 320) : 0);
  };
  $('#skip').onclick = () => { clearTimeout(playTimer); while (k < events.length) { step(); clearTimeout(playTimer); } };
  step();
}
function parseLog(lines, P) {
  const ev = [], hp = { p1: 100, p2: 100 }, st = { p1: '', p2: '' };
  const who = (s) => { const p = s.slice(0, 2); const nm = s.split(': ')[1] || ''; return { p, name: nm }; };
  const hpOf = (x) => { if (/fnt/.test(x)) return 0; const [a, b] = x.split(' ')[0].split('/'); return Math.round(100 * +a / +(b || 100)); };
  const push = (text, cls, upd) => ev.push({ text, cls, hp: upd ? [[upd, hp[upd], st[upd]]] : null });
  for (const l of lines) {
    const p = l.split('|').slice(1);
    const tag = p[0];
    switch (tag) {
      case 'turn': push(`Turn ${p[1]}`, 'turn'); break;
      case 'move': push(`${who(p[1]).name} used ${p[2]}!`); break;
      case '-damage': case '-heal': case '-sethp': { const w = who(p[1]); hp[w.p] = hpOf(p[2]); const m = /\s(\w+)$/.exec(p[2].split(' ').slice(1).join(' ')); const from = p[3] ? ` (${p[3].replace('[from] ', '').replace('item: ', '').replace('ability: ', '')})` : ''; push(`${w.name} ${tag === '-heal' ? 'restored HP' : 'took damage'}${from} → ${hp[w.p]}%`, 'sys', w.p); void m; break; }
      case '-supereffective': push("It's super effective!", 'sys'); break;
      case '-resisted': push("It's not very effective…", 'sys'); break;
      case '-crit': push('A critical hit!', 'sys'); break;
      case '-miss': push(`${who(p[1]).name}'s attack missed!`, 'sys'); break;
      case '-immune': push(`It doesn't affect ${who(p[1]).name}…`, 'sys'); break;
      case '-fail': push('But it failed!', 'sys'); break;
      case '-status': { const w = who(p[1]); st[w.p] = p[2]; push(`${w.name} is now ${{ brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen' }[p[2]] || p[2]}.`, 'sys', w.p); break; }
      case '-curestatus': { const w = who(p[1]); st[w.p] = ''; push(`${w.name} was cured of ${p[2]}.`, 'sys', w.p); break; }
      case '-boost': case '-unboost': push(`${who(p[1]).name}'s ${p[2].toUpperCase()} ${tag === '-boost' ? 'rose' : 'fell'} ${p[3]} stage${p[3] > 1 ? 's' : ''}.`, 'sys'); break;
      case '-mega': push(`${who(p[1]).name} Mega Evolved!`, 'turn'); break;
      case '-primal': push(`${who(p[1]).name} underwent Primal Reversion!`, 'turn'); break;
      case '-burst': push(`${who(p[1]).name} used Ultra Burst!`, 'turn'); break;
      case 'detailschange': { const w = who(p[1]); const f = document.getElementById('f-' + w.p); const name = p[2].split(',')[0]; if (f && !/\[silent\]/.test(l)) $('.name', f).textContent = name; break; }
      case '-weather': if (p[1] !== 'none' && !/upkeep/.test(l)) push(`Weather: ${p[1]}`, 'sys'); break;
      case '-fieldstart': push(`${p[1].replace('move: ', '')} took effect.`, 'sys'); break;
      case '-sidestart': push(`${p[2].replace('move: ', '')} protects ${p[1].slice(4) || p[1]}.`, 'sys'); break;
      case '-activate': push(`${who(p[1]).name}: ${p[2].replace(/^(move|ability|item): /, '')} activated.`, 'sys'); break;
      case '-enditem': push(`${who(p[1]).name}'s ${p[2]} was used up.`, 'sys'); break;
      case '-ability': push(`${who(p[1]).name}'s ${p[2]}.`, 'sys'); break;
      case 'cant': push(`${who(p[1]).name} can't move (${p[2]}).`, 'sys'); break;
      case 'faint': push(`${who(p[1]).name} fainted!`, 'win'); break;
      case 'win': push(`${p[1] === 'A' ? P.p1.name : P.p2.name} wins!`, 'win'); break;
      case 'tie': push('The battle ended in a draw.', 'win'); break;
    }
  }
  return ev;
}

// ------------------------------------------------------------------ live progress
async function renderLive() {
  let p = null;
  try { p = await fetch(state.api ? 'api/progress' : 'results/progress.json', { cache: 'no-store' }).then((r) => r.json()); } catch (e) { p = null; }
  const pill = $('#runpill');
  if (!p || !p.totalBattles) { pill.textContent = 'No run yet'; $('#liveView').innerHTML = '<div class="empty">No tournament progress recorded yet.</div>'; return p; }
  const pct = 100 * p.doneBattles / p.totalBattles;
  pill.textContent = p.running ? `Running · ${pct.toFixed(1)}%` : (pct >= 100 ? 'Complete' : `Paused · ${pct.toFixed(1)}%`);
  pill.classList.toggle('on', !!p.running);
  const eta = p.etaSeconds ? (p.etaSeconds > 3600 ? (p.etaSeconds / 3600).toFixed(1) + ' h' : Math.round(p.etaSeconds / 60) + ' min') : '–';
  $('#liveView').innerHTML = `<div class="card"><div class="eyebrow">Round robin</div><div class="big">${p.doneBattles.toLocaleString()} / ${p.totalBattles.toLocaleString()} battles</div>
    <div class="progress" style="margin:12px 0"><div style="width:${pct}%"></div></div>
    <dl class="kv"><dt>Entrants</dt><dd>${p.entrants.toLocaleString()}</dd><dt>Matchups</dt><dd>${p.doneMatchups.toLocaleString()} / ${p.totalMatchups.toLocaleString()}</dd>
    <dt>Battles per matchup</dt><dd>${p.battlesPerMatchup} (player slots swapped)</dd><dt>Speed</dt><dd>${p.battlesPerSecond} battles/s</dd><dt>Time left</dt><dd>${p.running ? eta : '–'}</dd><dt>Updated</dt><dd>${new Date(p.updated).toLocaleTimeString()}</dd></dl>
    <p class="muted">Leaderboards refresh about once a minute while the run is going. Rows finish in order, so early rankings cover a subset of matchups.</p></div>`;
  return p;
}

// ------------------------------------------------------------------ method
function renderMethod() {
  const S = state.S, m = S ? S.manifest : {};
  $('#methodView').innerHTML = `<h2>How the ranking is produced</h2>
  <p>Every entrant fights every other entrant 1v1 on the <b>Pokémon Showdown</b> battle engine (v${esc(m.engine || '?')}) under one ruleset: Gen 9 mechanics with National Dex additions (Mega Evolution, Primal Reversion, Ultra Burst, past moves and items), level 100, 31 IVs, 252/252 EV spreads, Smogon 1v1 clauses (no OHKO, evasion, sleep-inducing or accuracy-lowering moves) and a 100-turn limit counted as a draw. No Terastallization, Dynamax or Z-Moves.</p>
  <p>Builds are chosen empirically. Each Pokémon gets several legal candidate sets (choice attacker, Focus Sash, Life Orb, setup sweeper, bulky, Counter-style and Smogon-curated sets), validated by Showdown's team validator, and the one scoring best against a 40-Pokémon benchmark gauntlet is used in the tournament.</p>
  <p>Both players use the same AI with open team sheets. It reads the battle state, estimates damage with <b>@smogon/calc</b> and looks ahead through an expected-value model of the next turns before choosing a move.</p>
  <p>Each matchup is played ${esc(m.battles || 2)} times with player slots swapped and independent seeds (master seed ${esc(m.seed ?? '?')}); every battle can be replayed exactly. Ratings are a Bradley–Terry fit on the Elo scale with 95% intervals; the standard board refits without restricted legendaries and mythicals.</p>
  <p class="muted">Full details and limitations are in docs/METHODOLOGY.md.</p>`;
}

// ------------------------------------------------------------------ wiring
function switchTab(t) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t; });
  try { localStorage.setItem('tab', t); } catch (e) { /* ignore */ }
}
async function init() {
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
  $('#typeFilter').innerHTML += TYPES.map((t) => `<option>${t}</option>`).join('');
  $('#gen').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => `<option value="${g}">Generation ${g}</option>`).join('');
  ['#board', '#gen', '#typeFilter', '#feOnly'].forEach((s) => $(s).onchange = renderBoard);
  $('#search').oninput = renderBoard;
  $('#monPick').onchange = () => { const s = find($('#monPick').value); if (s) renderMon(s); };
  $('#hA').onchange = renderH2H; $('#hB').onchange = renderH2H; $('#hGo').onclick = simulate;
  try { const r = await fetch('api/progress'); state.api = r.ok && (r.headers.get('content-type') || '').includes('json'); } catch (e) { state.api = false; }
  await load();
  const refresh = () => {
    renderHero(); renderBoard(); renderMethod();
    if (state.S) $('#monList').innerHTML = state.S.stats.map((s) => `<option value="${esc(s.name)}">`).join('');
  };
  refresh();
  if (state.S && !$('#monView').innerHTML) { const c = state.S.stats[state.S.champion]; $('#monPick').value = c.name; renderMon(c); }
  if (state.S && !$('#hA').value) { const L = state.S.leaderboards.overall; $('#hA').value = state.S.stats[L[0]].name; $('#hB').value = state.S.stats[L[1]].name; renderH2H(); }
  let tab = 'boards'; try { tab = localStorage.getItem('tab') || 'boards'; } catch (e) { /* ignore */ }
  switchTab(tab);
  let p = await renderLive();
  setInterval(async () => {
    const before = p && p.doneBattles;
    p = await renderLive();
    if (p && p.running && p.doneBattles !== before) { await load(); refresh(); }
  }, 15000);
}
init();
