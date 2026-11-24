'use strict';
// Runs a single 1v1 battle on the Pokémon Showdown engine with both sides driven by BattleAI.
const { PS } = require('./dex');
const config = require('./config');
const { BattleAI } = require('./ai');

// Deterministic 32-bit hash -> Showdown PRNG seed (4 x 16-bit words).
function mix(h) { h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16; return h >>> 0; }
function seedFor(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) h = mix(h ^ (typeof p === 'number' ? p : hashStr(String(p))));
  const a = mix(h + 1), b = mix(h + 2);
  return [a & 0xffff, a >>> 16, b & 0xffff, b >>> 16];
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function publicLog(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|split|')) { out.push(lines[i + 2]); i += 2; continue; }
    out.push(lines[i]);
  }
  return out.filter((l) => l !== undefined && !l.startsWith('|t:|'));
}

/**
 * @param {object} setA  Showdown set for side p1
 * @param {object} setB  Showdown set for side p2
 * @param {number[]} seed Showdown PRNG seed
 * @param {object} [opts] {log: boolean}
 * @returns {{winner: 0|1|null, turns: number, hp: number[], log?: string[]}}
 */
function runBattle(setA, setB, seed, opts = {}) {
  const battle = new PS.Battle({ formatid: config.engineFormat, seed });
  const sets = [setA, setB];
  battle.setPlayer('p1', { name: 'A', team: PS.Teams.pack([clean(setA)]) });
  battle.setPlayer('p2', { name: 'B', team: PS.Teams.pack([clean(setB)]) });
  const shared = { dmg: new Map(), mon: new Map() };
  const ais = [new BattleAI(battle, 0, sets, shared), new BattleAI(battle, 1, sets, shared)];
  let guard = 0;
  while (!battle.ended && battle.turn <= config.turnLimit && guard++ < config.turnLimit * 4) {
    // collect both decisions from the same state before submitting either
    const choices = [];
    for (let i = 0; i < 2; i++) {
      const side = battle.sides[i];
      const req = side.activeRequest;
      if (!req || req.wait || side.isChoiceDone()) { choices.push(null); continue; }
      let c = 'default';
      if (req.teamPreview) c = 'default';
      else if (req.forceSwitch) c = 'default';
      else if (req.active) {
        try { c = ais[i].choose(req); } catch (e) { if (opts.debug) console.error(e); c = 'default'; }
      }
      choices.push(c);
    }
    for (let i = 0; i < 2; i++) {
      if (choices[i] === null) continue;
      const id = i === 0 ? 'p1' : 'p2';
      if (!battle.choose(id, choices[i])) battle.choose(id, 'default');
    }
  }
  const res = {
    winner: battle.winner === 'A' ? 0 : battle.winner === 'B' ? 1 : null,
    turns: battle.turn,
    hp: battle.sides.map((s) => { const p = s.pokemon[0]; return p.hp / p.maxhp; }),
  };
  if (!battle.ended) res.winner = null; // turn limit reached: draw
  if (opts.log) res.log = publicLog(battle.log);
  battle.destroy();
  return res;
}

function clean(set) {
  const { archetype, ...rest } = set;
  return rest;
}

module.exports = { runBattle, seedFor };

if (require.main === module) {
  // quick smoke test: node src/battle.js
  const a = { species: 'Garchomp', item: 'Choice Band', ability: 'Rough Skin', moves: ['Earthquake', 'Outrage', 'Stone Edge', 'Fire Fang'], nature: 'Jolly', evs: { hp: 4, atk: 252, spe: 252 }, level: 100 };
  const b = { species: 'Charizard', item: 'Charizardite X', ability: 'Blaze', moves: ['Dragon Dance', 'Flare Blitz', 'Dragon Claw', 'Roost'], nature: 'Jolly', evs: { hp: 4, atk: 252, spe: 252 }, level: 100 };
  const r = runBattle(a, b, seedFor(1, 2, 3), { log: true, debug: true });
  console.log(r.log.join('\n'));
  console.log(r.winner, r.turns);
}
