'use strict';
// Candidate competitive set generation.
//
// For every entrant we generate several *legal* candidate builds covering the standard 1v1
// archetypes (choice attacker, Life Orb / Sash attacker, setup sweeper, bulky attacker), plus
// curated sets from Pokémon Showdown's 1v1 factory data and move pools from Showdown's random-
// battle data (which are maintained by Smogon contributors). The qualifier (src/qualify.js)
// then picks, empirically, the candidate that performs best against a benchmark gauntlet.
// Every candidate is validated with Showdown's TeamValidator before use.
const { dex, PS, toID } = require('./dex');
const config = require('./config');
const { moveRole, SETUP } = require('./moveinfo');

const validator = PS.TeamValidator.get(config.validatorFormat);
const bannedItems = new Set(config.bannedItems);
const bannedAbilities = new Set(config.bannedAbilities);

// ---------------------------------------------------------------- type environment
let TYPE_ENV = null; // [{types, w}] distribution of defending typings across the roster
function setTypeEnvironment(roster) {
  const m = new Map();
  for (const r of roster) { const k = r.types.join('/'); m.set(k, (m.get(k) || 0) + 1); }
  TYPE_ENV = [...m.entries()].map(([k, n]) => ({ types: k.split('/'), w: n / roster.length, eff: {} }));
  for (const env of TYPE_ENV) for (const t of dex.types.names()) for (const ab of ['', 'tintedlens', 'scrappy']) env.eff[t + ab] = effectiveness(t, env.types, ab);
}
const effCache = new Map();
function effectiveness(type, types, ability) {
  const k = type + '|' + types.join('/') + '|' + (ability || '');
  let v = effCache.get(k);
  if (v !== undefined) return v;
  if (!dex.getImmunity(type, types) && !(ability === 'scrappy' && (type === 'Normal' || type === 'Fighting'))
    && !(ability === 'mindseye' && (type === 'Normal' || type === 'Fighting'))) v = 0;
  else {
    v = Math.pow(2, dex.getEffectiveness(type, types));
    if (ability === 'tintedlens' && v < 1) v *= 2;
  }
  effCache.set(k, v);
  return v;
}

// ---------------------------------------------------------------- stats
function statAt100(base, ev, natureMult) { return Math.floor((Math.floor((2 * base + 31 + Math.floor(ev / 4)) * 100 / 100) + 5) * natureMult); }
function hpAt100(base, ev) { return base === 1 ? 1 : Math.floor((2 * base + 31 + Math.floor(ev / 4)) * 100 / 100) + 110; }

const ATK_MULT_ABILITIES = { hugepower: 2, purepower: 2, gorillatactics: 1.5, hustle: 1.5 };

// ---------------------------------------------------------------- move scoring
function moveType(move, sp, ability, item) {
  let t = move.type;
  if (['judgment', 'multiattack', 'technoblast', 'revelationdance', 'ivycudgel', 'ragingbull', 'aurawheel'].includes(move.id)) t = sp.types[0];
  if (move.id === 'ivycudgel' && sp.types[1]) t = sp.types[1];
  if (move.id === 'weatherball') t = { drought: 'Fire', drizzle: 'Water', sandstream: 'Rock', snowwarning: 'Ice', orichalcumpulse: 'Fire' }[ability] || 'Normal';
  if (t === 'Normal' && move.category !== 'Status') {
    const ate = { aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric' }[ability];
    if (ate) t = ate;
  }
  if (ability === 'liquidvoice' && move.flags.sound) t = 'Water';
  if (ability === 'normalize') t = 'Normal';
  return t;
}

// Expected power (accuracy, multi-hit, ability/item modifiers, drawbacks) of a damaging move
// for this species. Only used to rank moves when building sets — battles use real mechanics.
function effectivePower(move, sp, ability, item, opts = {}) {
  if (move.category === 'Status') return 0;
  const id = move.id;
  let bp = move.basePower;
  if (move.multihit) {
    const hits = Array.isArray(move.multihit) ? (ability === 'skilllink' ? move.multihit[1] : (item === 'Loaded Dice' ? 4.5 : 3.1)) : move.multihit;
    let per = bp;
    if (ability === 'technician' && per <= 60) per *= 1.5;
    bp = per * hits;
    if (id === 'populationbomb') bp = per * (ability === 'skilllink' ? 10 : 6);
  } else if (ability === 'technician' && bp && bp <= 60) bp *= 1.5;
  if (id === 'tripleaxel') bp = ability === 'skilllink' ? 120 : 94;
  if (id === 'triplekick') bp = ability === 'skilllink' ? 60 : 47;
  const special = {
    seismictoss: 80, nightshade: 80, superfang: 60, ruination: 70, naturesmadness: 60, lowkick: 80, grassknot: 80,
    heavyslam: 80, heatcrash: 80, gyroball: 60, electroball: 60, eruption: 130, waterspout: 130, dragonenergy: 130,
    reversal: 70, flail: 70, facade: ['guts', 'quickfeet', 'marvelscale'].includes(ability) && /Orb/.test(item || '') ? 140 : 70,
    acrobatics: 55, hex: 75, knockoff: 97, boltbeak: 130, fishiousrend: 130, payback: 60, avalanche: 60, revenge: 60,
    storedpower: opts.setup ? 90 : 20, powertrip: opts.setup ? 90 : 20, crushgrip: 110, wringout: 110,
    weatherball: ['drought', 'drizzle', 'sandstream', 'snowwarning', 'orichalcumpulse'].includes(ability) ? 100 : 50,
    ragefist: 75, temperflare: 75, stompingtantrum: 75, smellingsalts: 70, endeavor: 0, terrainpulse: 50,
    risingvoltage: ability === 'electricsurge' || ability === 'hadronengine' ? 140 : 70,
    expandingforce: ability === 'psychicsurge' ? 120 : 80, grassyglide: 70, pursuit: 40, return: 102,
    solarbeam: ['drought', 'orichalcumpulse'].includes(ability) ? 120 : 60, solarblade: ['drought', 'orichalcumpulse'].includes(ability) ? 125 : 62,
    electroshot: ability === 'drizzle' ? 130 : 100, meteorbeam: item === 'Power Herb' ? 140 : 100,
  };
  if (special[id] !== undefined) bp = special[id];
  if (!bp) return 0;
  let acc = move.accuracy === true ? 100 : move.accuracy;
  if (ability === 'noguard') acc = 100;
  else if (ability === 'compoundeyes') acc = Math.min(100, acc * 1.3);
  else if (ability === 'hustle' && move.category === 'Physical') acc *= 0.8;
  if ((id === 'thunder' || id === 'hurricane') && ability === 'drizzle') acc = 100;
  if (id === 'blizzard' && ability === 'snowwarning') acc = 100;
  let p = bp * acc / 100;
  // drawbacks
  if (move.self && move.self.volatileStatus === 'mustrecharge') p *= ability === 'truant' ? 1 : 0.55;
  if (move.flags.charge && !['solarbeam', 'solarblade', 'electroshot', 'meteorbeam'].includes(id) && item !== 'Power Herb') p *= 0.5;
  if (['solarbeam', 'solarblade'].includes(id) && !['drought', 'orichalcumpulse'].includes(ability)) p *= 1; // already halved above
  if (['meteorbeam'].includes(id) && item !== 'Power Herb') p *= 0.6;
  if (['phantomforce', 'shadowforce', 'dig', 'dive', 'fly', 'bounce'].includes(id)) p *= 0.6;
  if (['outrage', 'thrash', 'petaldance', 'ragingfury'].includes(id)) p *= 0.95;
  if (['mindblown', 'steelbeam', 'chloroblast'].includes(id)) p *= ability === 'magicguard' ? 1 : 0.6;
  const selfDrop = move.self && move.self.boosts ? Object.values(move.self.boosts).reduce((a, b) => a + Math.min(0, b), 0) : 0;
  if (selfDrop) p *= ability === 'contrary' ? 1.3 : (selfDrop <= -2 ? (opts.setup ? 0.45 : 0.82) : (opts.setup ? 0.8 : 0.94));
  if (move.recoil || move.hasCrashDamage) {
    if (ability === 'reckless') p *= 1.2;
    if (ability !== 'rockhead' && ability !== 'magicguard') p *= move.hasCrashDamage ? 0.85 : 0.93;
  }
  if (move.drain) p *= 1 + move.drain[0] / move.drain[1] * 0.25;
  if (move.willCrit) p *= ability === 'sniper' ? 2.25 : 1.5;
  else if (move.critRatio >= 2) p *= ability === 'superluck' ? 1.4 : 1.12;
  if (move.priority > 0) p *= 1.0; // valued separately
  if (move.priority < 0) p *= 0.85;
  // ability power modifiers
  const f = move.flags;
  const mods = {
    ironfist: f.punch ? 1.2 : 1, strongjaw: f.bite ? 1.5 : 1, megalauncher: f.pulse ? 1.5 : 1, toughclaws: f.contact ? 1.3 : 1,
    sharpness: f.slicing ? 1.5 : 1, punkrock: f.sound ? 1.3 : 1, sheerforce: move.secondaries ? 1.3 : 1,
    parentalbond: 1.25, analytic: 1.15, sandforce: 1, waterbubble: move.type === 'Water' ? 2 : 1,
  };
  if (mods[ability]) p *= mods[ability];
  if (['aerilate', 'pixilate', 'refrigerate', 'galvanize', 'normalize'].includes(ability) && move.type === 'Normal') p *= 1.2;
  if (ability === 'serenegrace' && move.secondaries && move.secondaries.some((s) => s.volatileStatus === 'flinch')) p *= 1.2;
  if (move.secondaries && ability !== 'sheerforce') {
    for (const s of move.secondaries) {
      if (s.status === 'brn' || s.status === 'par') p *= 1 + (s.chance || 0) / 100 * 0.25;
      if (s.self && s.self.boosts) p *= 1 + (s.chance || 0) / 100 * 0.15;
    }
  }
  if (move.self && move.self.boosts && Object.values(move.self.boosts).some((b) => b > 0) && !move.secondaries) p *= 1.15;
  return p;
}

// type-dependent multipliers
function typeMult(type, sp, ability, item) {
  let m = 1;
  if (sp.types.includes(type) || ['protean', 'libero'].includes(ability)) m *= ability === 'adaptability' ? 2 : 1.5;
  if (['protean', 'libero'].includes(ability) && !sp.types.includes(type)) m = 1.25; // gen 9: once per entry
  const typed = { steelworker: 'Steel', steelyspirit: 'Steel', transistor: 'Electric', dragonsmaw: 'Dragon', rockypayload: 'Rock' };
  if (typed[ability] === type) m *= type === 'Electric' ? 1.3 : 1.5;
  if (ability === 'drought' && type === 'Fire') m *= 1.5;
  if (ability === 'drought' && type === 'Water') m *= 0.5;
  if (ability === 'drizzle' && type === 'Water') m *= 1.5;
  if (ability === 'drizzle' && type === 'Fire') m *= 0.5;
  if (ability === 'orichalcumpulse' && type === 'Fire') m *= 1.5;
  if ((ability === 'electricsurge' || ability === 'hadronengine') && type === 'Electric') m *= 1.3;
  if (ability === 'psychicsurge' && type === 'Psychic') m *= 1.3;
  if (ability === 'grassysurge' && type === 'Grass') m *= 1.3;
  if (ability === 'blaze' || ability === 'torrent' || ability === 'overgrow' || ability === 'swarm') m *= 1.03;
  const it = dex.items.get(item || '');
  if (it.exists && it.onPlate === type) m *= 1.2;
  return m;
}

function offensiveStat(sp, cat, ability, ev = 252, nat = 1.1) {
  const base = cat === 'Physical' ? sp.baseStats.atk : sp.baseStats.spa;
  let s = statAt100(base, ev, nat);
  if (cat === 'Physical' && ATK_MULT_ABILITIES[ability]) s *= ATK_MULT_ABILITIES[ability];
  if (cat === 'Special' && ability === 'solarpower') s *= 1.2;
  return s;
}

// value of a move against one defending typing (unnormalised damage proxy)
function moveValue(mv, env) {
  const ab = mv.ability === 'tintedlens' || mv.ability === 'scrappy' || mv.ability === 'mindseye' ? (mv.ability === 'mindseye' ? 'scrappy' : mv.ability) : '';
  return mv.power * env.eff[mv.type + ab];
}

function coverageScore(moves) {
  let total = 0;
  for (const env of TYPE_ENV) {
    let best = 0;
    for (const mv of moves) { const v = moveValue(mv, env); if (v > best) best = v; }
    total += env.w * Math.pow(best, 0.75);
  }
  return total;
}

function pickAttacks(pool, k, fixed = []) {
  const chosen = fixed.slice();
  const avail = pool.filter((m) => !chosen.some((c) => c.id === m.id));
  while (chosen.length < k && avail.length) {
    let best = null, bestS = -1;
    for (const m of avail) {
      if (chosen.some((c) => c.type === m.type && c.cat === m.cat && c.id !== m.id && m.power <= c.power)) continue;
      const s = coverageScore([...chosen, m]);
      if (s > bestS) { bestS = s; best = m; }
    }
    if (!best) break;
    chosen.push(best);
    avail.splice(avail.indexOf(best), 1);
  }
  return chosen;
}

// ---------------------------------------------------------------- abilities
const ABILITY_VALUE = {
  wonderguard: 0.6, speedboost: 0.25, sturdy: 0.22, multiscale: 0.2, shadowshield: 0.2, disguise: 0.25, iceface: 0.12,
  furcoat: 0.25, icescales: 0.18, fluffy: 0.12, intimidate: 0.12, levitate: 0.1, unaware: 0.12, magicguard: 0.1,
  thickfat: 0.07, filter: 0.08, solidrock: 0.08, prismarmor: 0.1, purifyingsalt: 0.15, goodasgold: 0.05,
  flashfire: 0.05, waterabsorb: 0.05, voltabsorb: 0.05, sapsipper: 0.05, stormdrain: 0.05, lightningrod: 0.05,
  motordrive: 0.05, eartheater: 0.05, wellbakedbody: 0.05, dryskin: 0.03, marvelscale: 0.08, poisonheal: 0.2,
  comatose: 0.08, prankster: 0.05, magicbounce: 0.06, regenerator: 0, naturalcure: 0, schooling: 0.3,
  powerconstruct: 0.25, zenmode: -0.05, truant: -0.5, slowstart: -0.45, defeatist: -0.2, klutz: -0.1, stall: -0.05,
  stakeout: 0, beastboost: 0, moxie: 0, competitive: 0.02, defiant: 0.02, quarkdrive: 0.06, protosynthesis: 0.06,
  unburden: 0.05, simple: 0.05, contrary: 0.04, stancechange: 0.2, berserk: 0.03, angershell: 0.05, toxicdebris: 0.03,
  roughskin: 0.04, ironbarbs: 0.04, flamebody: 0.05, static: 0.05, poisonpoint: 0.03, effectspore: 0.04, cursedbody: 0.03,
  innardsout: 0.05, aftermath: 0.03, intrepidsword: 0.25, dauntlessshield: 0.15, zerotohero: 0, embodyaspectteal: 0.1,
  embodyaspecthearthflame: 0.15, embodyaspectwellspring: 0.1, embodyaspectcornerstone: 0.1, teraformzero: 0.05,
  download: 0.08, drought: 0.02, drizzle: 0.02, sandstream: 0.03, snowwarning: 0.02, chlorophyll: 0, swiftswim: 0,
  sandrush: 0, slushrush: 0, sharpness: 0, technician: 0, hugepower: 0, purepower: 0, armortail: 0.03, queenlymajesty: 0.03,
  dazzling: 0.03, sweetveil: 0, cudchew: 0.03, opportunist: 0.02, supersweetsyrup: 0.03, pressure: 0.01, shedskin: 0.05,
  hydration: 0.02, guts: 0.02, quickfeet: 0.02, toxicboost: 0, flareboost: 0, waterveil: 0.03, owntempo: 0, oblivious: 0,
  heavymetal: 0, lightmetal: 0, battlearmor: 0.03, shellarmor: 0.03, bulletproof: 0.04, soundproof: 0.03, overcoat: 0.02,
  heatproof: 0.04, waterbubble: 0.1, tangledfeet: 0, rattled: 0, justified: 0.01, steamengine: 0.03, thermalexchange: 0.04,
  mirrorarmor: 0.04, clearbody: 0.03, whitesmoke: 0.03, fullmetalbody: 0.03, wanderingspirit: 0, perishbody: -0.05,
  gorillatactics: 0, imposter: 0.4, protean: 0, libero: 0, mimicry: 0, mummy: 0.02, lingeringaroma: 0.02,
  tabletsofruin: 0.06, swordofruin: 0.06, vesselofruin: 0.06, beadsofruin: 0.06, orichalcumpulse: 0.05, hadronengine: 0.05,
  emergencyexit: 0, wimpout: 0, harvest: 0.05, cheekpouch: 0.02, gluttony: 0.02, ripen: 0.02, pickup: 0, frisk: 0,
};

function legalAbilities(speciesName) {
  const sp = dex.species.get(speciesName);
  return [...new Set(Object.values(sp.abilities))].map(toID).filter((a) => !bannedAbilities.has(a));
}

// ---------------------------------------------------------------- set assembly helpers
const NATURES = {
  atk: { spe: 'Jolly', atk: 'Adamant' }, spa: { spe: 'Timid', spa: 'Modest' },
};

function buildEVs(kind, sp, cat) {
  // kind: 'offense' | 'offense-slow' | 'bulky'
  const atkStat = cat === 'Special' ? 'spa' : 'atk';
  const dump = cat === 'Special' ? 'atk' : 'spa';
  if (kind === 'offense') {
    const nature = cat === 'Mixed' ? 'Hasty' : (cat === 'Special' ? 'Timid' : 'Jolly');
    if (cat === 'Mixed') return { evs: { atk: 252, spa: 4, spe: 252 }, nature: 'Hasty' };
    return { evs: { hp: 4, [atkStat]: 252, spe: 252 }, nature };
  }
  if (kind === 'offense-slow') {
    if (cat === 'Mixed') return { evs: { hp: 252, atk: 128, spa: 128 }, nature: 'Lonely' };
    return { evs: { hp: 252, [atkStat]: 252, spd: 4 }, nature: cat === 'Special' ? 'Modest' : 'Adamant' };
  }
  // bulky: invest the weaker defensive stat
  const weakDef = sp.baseStats.def <= sp.baseStats.spd ? 'def' : 'spd';
  const natures = {
    Physical: { def: 'Impish', spd: 'Careful' }, Special: { def: 'Bold', spd: 'Calm' }, Mixed: { def: 'Relaxed', spd: 'Sassy' },
  };
  return { evs: { hp: 252, [weakDef]: 252, [atkStat === 'atk' ? 'atk' : 'spa']: 4 }, nature: natures[cat === 'Mixed' ? 'Mixed' : cat][weakDef] };
}

function nameOf(id, table) { const x = table.get(id); return x.exists ? x.name : id; }

// ---------------------------------------------------------------- main generator
function candidateSets(entry) {
  const out = [];
  for (const setSpecies of entry.setSpecies) out.push(...candidatesFor(entry, setSpecies));
  // de-duplicate identical candidates
  const seen = new Set();
  return out.filter((c) => {
    const k = JSON.stringify([c.species, c.item, c.ability, [...c.moves].sort(), c.nature, c.evs]);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function candidatesFor(entry, setSpecies) {
  const battleSp = dex.species.get(entry.name);     // form used in battle (mega etc.)
  const baseSp = dex.species.get(setSpecies);       // form written in the set
  const rawPool = [...dex.species.getMovePool(baseSp.id, true)].filter((id) => !config.bannedMoves.includes(id));
  let pool = rawPool.filter((id) => moveRole(id));
  const fallback = !pool.some((id) => moveRole(id) === 'attack');
  if (fallback) pool = [...new Set([...pool, ...rawPool.filter((id) => dex.moves.get(id).category !== 'Status' || !pool.length)])];
  if (entry.requiredMove) pool.push(toID(entry.requiredMove));
  const abilitiesBase = legalAbilities(baseSp.name);
  // the ability that matters in battle (megas get a fixed ability)
  const battleAbilities = entry.transform === 'mega' || entry.primal || battleSp.name === 'Necrozma-Ultra' ? [toID(battleSp.abilities[0])] : abilitiesBase;
  const cands = [];
  const forced = entry.forcedItem;

  for (const ability of rankAbilities(battleAbilities, battleSp, pool).slice(0, 2)) {
    const setAbility = battleAbilities === abilitiesBase ? ability : bestBaseAbility(abilitiesBase, baseSp);
    const ctx = { entry, battleSp, baseSp, ability, setAbility, pool, forced, fallback };
    for (const c of archetypes(ctx)) cands.push(c);
  }
  // curated / community-maintained sources
  for (const c of curatedCandidates(entry, baseSp, pool, battleAbilities)) cands.push(c);
  if (battleSp.baseStats.hp === 1) {
    // 1-HP Pokémon (Shedinja): no Life Orb / recoil / HP-cost moves
    for (const c of cands) {
      if (c.item === 'Life Orb' || c.item === 'Leftovers' || c.item === 'Choice Band') c.item = 'Focus Sash';
      c.moves = c.moves.filter((m) => { const mv = dex.moves.get(m); return !mv.recoil && !mv.hasCrashDamage && !['substitute', 'bellydrum', 'curse'].includes(mv.id); });
    }
  }
  const valid = [];
  for (const c of cands) {
    const v = validateAndRepair(c, entry, pool);
    if (v) valid.push(v);
  }
  if (!valid.length && cands.length) {
    // Official Pokémon the validator cannot place (e.g. Floette-Eternal, Gimmighoul-Roaming, some
    // Legends Z-A Megas): keep the builds, restricted to the species' own move pool, marked unvalidated.
    for (const c of cands) {
      const set = JSON.parse(JSON.stringify(c));
      set.moves = [...new Set(set.moves)].filter((m) => pool.includes(toID(m))).slice(0, 4).map((m) => dex.moves.get(m).name);
      if (!set.moves.length) continue;
      set.ability = dex.abilities.get(set.ability || legalAbilities(set.species)[0]).name;
      set.item = dex.items.get(set.item).exists ? dex.items.get(set.item).name : 'Leftovers';
      set.unvalidated = true;
      valid.push(set);
    }
  }
  return valid;
}

function rankAbilities(abilities, sp, pool) {
  const physical = sp.baseStats.atk >= sp.baseStats.spa;
  const scored = abilities.map((a) => {
    let v = ABILITY_VALUE[a] ?? 0.01;
    // offensive abilities are valued through the move scores; give them a base so they compete
    if (['hugepower', 'purepower'].includes(a)) v = physical || true ? 0.9 : 0;
    if (['adaptability', 'technician', 'sheerforce', 'toughclaws', 'sharpness', 'strongjaw', 'ironfist', 'megalauncher',
      'aerilate', 'pixilate', 'refrigerate', 'galvanize', 'skilllink', 'reckless', 'punkrock', 'gorillatactics',
      'protean', 'libero', 'waterbubble', 'transistor', 'dragonsmaw', 'steelworker', 'rockypayload', 'parentalbond',
      'tintedlens', 'scrappy', 'noguard', 'compoundeyes', 'hustle', 'sniper', 'solarpower', 'drought', 'drizzle'].includes(a)) v += 0.12;
    if ((a === 'guts' || a === 'poisonheal' || a === 'toxicboost' || a === 'flareboost' || a === 'quickfeet') ) v += 0.1;
    if (a === 'simple' && pool.some((m) => SETUP.has(m))) v += 0.2;
    if (a === 'contrary' && pool.some((m) => ['leafstorm', 'overheat', 'dracometeor', 'superpower', 'vcreate'].includes(m))) v += 0.3;
    if (a === 'prankster' && pool.some((m) => moveRole(m) === 'status')) v += 0.05;
    return { a, v };
  }).sort((x, y) => y.v - x.v);
  const best = scored[0];
  return scored.filter((s, i) => i === 0 || s.v >= best.v - 0.1).map((s) => s.a);
}

function bestBaseAbility(abilities, sp) {
  return rankAbilities(abilities, sp, [])[0];
}

function attackPool(ctx, item, opts = {}) {
  const { battleSp, ability, pool } = ctx;
  const res = [];
  for (const id of pool) {
    const mv = dex.moves.get(id);
    if (moveRole(id) !== 'attack' && !(ctx.fallback && mv.category !== 'Status')) continue;
    if (mv.id === 'dragonascent' || !ctx.entry.requiredMove || true) {
      // noop: Rayquaza-Mega requirement handled in archetypes
    }
    let cat = mv.category;
    if (['bodypress'].includes(mv.id)) cat = 'Defensive';
    const type = moveType(mv, battleSp, ability, item);
    let power = effectivePower(mv, battleSp, ability, item, opts) * typeMult(type, battleSp, ability, item);
    let stat;
    if (cat === 'Defensive') stat = statAt100(battleSp.baseStats.def, opts.bulky ? 252 : 0, 1);
    else if (mv.id === 'foulplay') stat = 250;
    else if (mv.damage || ['seismictoss', 'nightshade', 'superfang', 'ruination', 'naturesmadness'].includes(mv.id)) stat = 250;
    else stat = offensiveStat(battleSp, cat, ability);
    if (cat === 'Physical' && (item === 'Choice Band')) stat *= 1.5;
    if (cat === 'Special' && (item === 'Choice Specs')) stat *= 1.5;
    if (cat === 'Physical' && ability === 'guts' && /Orb/.test(item || '')) stat *= 1.5;
    power *= stat / 250;
    if (!power) continue;
    res.push({ id: mv.id, name: mv.name, type, cat: cat === 'Defensive' ? 'Physical' : cat, power, priority: mv.priority, ability });
  }
  res.sort((a, b) => b.power - a.power);
  return res.slice(0, 40);
}

function preferredCategory(ctx) {
  const { battleSp, ability } = ctx;
  const p = offensiveStat(battleSp, 'Physical', ability), s = offensiveStat(battleSp, 'Special', ability);
  if (p > s * 1.12) return 'Physical';
  if (s > p * 1.12) return 'Special';
  return 'Mixed';
}

function bestPriority(atks, cat) {
  return atks.filter((m) => m.priority > 0 && (cat === 'Mixed' || m.cat === cat) && m.power > 0)
    .sort((a, b) => b.power - a.power)[0];
}

function archetypes(ctx) {
  const { battleSp, ability, pool, forced, entry } = ctx;
  const sp = battleSp;
  const cat = preferredCategory(ctx);
  const has = (id) => pool.includes(id);
  const out = [];
  const species = ctx.baseSp.name;
  const isMegaLike = !!forced;
  const bulkScore = (sp.baseStats.hp * (sp.baseStats.def + sp.baseStats.spd)) / 2;
  const frail = bulkScore < 6500;
  const fast = sp.baseStats.spe >= 75;
  const nfe = !!ctx.baseSp.nfe;
  const catFilter = (m) => cat === 'Mixed' || m.cat === cat;
  const mk = (kind, moves, item, evsKind, label) => {
    const usedCat = categoryOfMoves(moves, cat);
    const { evs, nature } = buildEVs(evsKind, sp, usedCat);
    const set = {
      species, ability: ctx.setAbility, item: forced || item, moves: moves.map((m) => (typeof m === 'string' ? m : m.id)),
      nature, evs, level: config.level, archetype: label,
    };
    if (!set.moves.some((m) => dex.moves.get(m).category === 'Physical' || m === 'foulplay')) set.ivs = { atk: 0 };
    if (entry.requiredMove && !set.moves.includes(toID(entry.requiredMove))) set.moves[set.moves.length - 1] = toID(entry.requiredMove);
    if (entry.requiredMove) set.moves = [...new Set(set.moves)];
    return set;
  };
  const specialItem = speciesItem(ctx);
  const abilityItem = abilityItemFor(ability, sp);

  // 1) Choice attacker (Band/Specs) and 2) Choice Scarf attacker
  {
    const choice = cat === 'Special' ? 'Choice Specs' : 'Choice Band';
    const atks = pickAttacks(attackPool(ctx, choice).filter(catFilter), 4);
    if (atks.length) {
      out.push(mk('choice', atks, specialItem || abilityItem || (cat === 'Mixed' ? 'Life Orb' : choice), fast || frail ? 'offense' : 'offense-slow', 'Choice attacker'));
      if (!forced && sp.baseStats.spe >= 60 && sp.baseStats.spe <= 115 && !specialItem) {
        out.push(mk('scarf', pickAttacks(attackPool(ctx, 'Choice Scarf').filter(catFilter), 4), 'Choice Scarf', 'offense', 'Choice Scarf attacker'));
      }
    }
  }
  // 3) Life Orb / Focus Sash attacker with priority if available
  {
    const item = specialItem || abilityItem || (frail ? 'Focus Sash' : 'Life Orb');
    const atkp = attackPool(ctx, item).filter(catFilter);
    const prio = bestPriority(atkp, cat);
    const fixed = prio && prio.power > 40 ? [prio] : [];
    const atks = pickAttacks(atkp, 4, fixed);
    if (atks.length) out.push(mk('lo', atks, item, 'offense', frail ? 'Sash attacker' : 'Life Orb attacker'));
    if (!forced && !frail && !specialItem) {
      // Sash variant for everyone: Focus Sash is the defining 1v1 item
      out.push(mk('sash', pickAttacks(attackPool(ctx, 'Focus Sash').filter(catFilter), 4, fixed), 'Focus Sash', 'offense', 'Sash attacker'));
    }
  }
  // 4) Setup sweeper
  {
    const setups = pool.filter((id) => SETUP.has(id)).map((id) => ({ id, v: setupValue(id, cat, ability, ctx) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (setups.length) {
      const sm = setups[0].id;
      const setupCat = setupCategory(sm, cat);
      const rec = bestRecovery(pool);
      const item = specialItem || abilityItem || (sm === 'shellsmash' ? 'White Herb' : sm === 'bellydrum' ? 'Sitrus Berry' : sm === 'geomancy' ? 'Power Herb'
        : nfe ? 'Eviolite' : rec || !frail ? 'Leftovers' : 'Life Orb');
      const atkp = attackPool(ctx, item, { setup: true, bulky: ['irondefense', 'cottonguard', 'acidarmor', 'cosmicpower', 'defendorder', 'curse', 'bulkup', 'calmmind'].includes(sm) })
        .filter((m) => setupCat === 'Mixed' || m.cat === setupCat || (m.id === 'bodypress' && ['irondefense', 'cottonguard', 'acidarmor', 'cosmicpower', 'defendorder'].includes(sm)));
      const nAtk = rec ? 2 : 3;
      const atks = pickAttacks(atkp, nAtk);
      if (atks.length) {
        const moves = [sm, ...atks.map((m) => m.id)];
        if (rec) moves.push(rec);
        const evsKind = ['calmmind', 'bulkup', 'curse', 'irondefense', 'cottonguard', 'acidarmor', 'cosmicpower', 'defendorder', 'amnesia', 'stockpile'].includes(sm) && !fast ? 'bulky' : 'offense';
        const s = mk('setup', moves, item, evsKind, 'Setup sweeper');
        if (evsKind === 'bulky') { s.evs = buildEVs('bulky', sp, setupCat).evs; s.nature = buildEVs('bulky', sp, setupCat).nature; }
        out.push(s);
        if (!forced && !specialItem && frail) out.push({ ...mk('setup-sash', moves.filter((m) => m !== rec).concat(pickAttacks(atkp, 3).map((m) => m.id)).slice(0, 4), 'Focus Sash', 'offense', 'Sash setup sweeper') });
        if (!forced && !specialItem && !nfe && !frail) out.push(mk('setup-wp', moves, 'Weakness Policy', evsKind, 'Weakness Policy setup'));
      }
    }
  }
  // 5) Bulky attacker / status
  {
    const rec = bestRecovery(pool);
    const st = bestStatusMove(pool, ability, sp);
    const item = specialItem || abilityItem || (nfe ? 'Eviolite' : sp.types.includes('Poison') ? 'Black Sludge' : 'Leftovers');
    const atkp = attackPool(ctx, item, { bulky: true }).filter(catFilter);
    const extra = [rec, st].filter(Boolean);
    const atks = pickAttacks(atkp, 4 - extra.length);
    if (atks.length && (extra.length || bulkScore > 8000)) {
      out.push(mk('bulky', [...atks, ...extra.map((id) => ({ id }))], item, 'bulky', 'Bulky attacker'));
    }
    // Sturdy / Sash counter-style (Counter / Mirror Coat / Endeavor) — classic 1v1 strategies
    const ctr = ['counter', 'mirrorcoat', 'endeavor', 'metalburst', 'comeuppance'].filter(has);
    if (ctr.length && !forced) {
      const it = ability === 'sturdy' ? 'Leftovers' : 'Focus Sash';
      const moves = [...ctr.slice(0, 2), ...pickAttacks(attackPool(ctx, it), 4 - Math.min(2, ctr.length)).map((m) => m.id)];
      out.push(mk('counter', moves.map((id) => ({ id })), it, 'bulky', 'Sash/Sturdy counter'));
    }
  }
  if (!out.length) {
    // Pokémon with no damaging attacks (e.g. Ditto, Wobbuffet-like movepools)
    const any = pool.slice(0, 4);
    if (any.length) out.push(mk('misc', any.map((id) => ({ id })), specialItem || abilityItem || (ability === 'imposter' ? 'Choice Scarf' : 'Leftovers'), 'bulky', 'Utility'));
  }
  return out;
}

function categoryOfMoves(moves, fallback) {
  let p = 0, s = 0;
  for (const m of moves) {
    const mv = dex.moves.get(typeof m === 'string' ? m : m.id);
    if (mv.category === 'Physical') p++; else if (mv.category === 'Special') s++;
  }
  if (p && s) return 'Mixed';
  if (p) return 'Physical';
  if (s) return 'Special';
  return fallback === 'Mixed' ? 'Physical' : fallback;
}

function setupCategory(id, cat) {
  const phys = ['swordsdance', 'dragondance', 'bulkup', 'shiftgear', 'coil', 'victorydance', 'bellydrum', 'tidyup', 'curse', 'honeclaws', 'howl', 'filletaway'];
  const spec = ['quiverdance', 'nastyplot', 'calmmind', 'tailglow', 'geomancy', 'takeheart', 'amnesia'];
  if (phys.includes(id)) return 'Physical';
  if (spec.includes(id)) return 'Special';
  if (['irondefense', 'cottonguard', 'acidarmor', 'cosmicpower', 'defendorder', 'stockpile', 'barrier'].includes(id)) return 'Physical';
  return cat;
}

function setupValue(id, cat, ability, ctx) {
  const c = setupCategory(id, cat);
  const sp = ctx.battleSp;
  const atkV = { Physical: sp.baseStats.atk, Special: sp.baseStats.spa };
  const v = {
    swordsdance: 2, dragondance: 2.2, bulkup: 1.6, quiverdance: 2.6, nastyplot: 2, calmmind: 1.8, shellsmash: 3,
    shiftgear: 2.2, coil: 1.7, victorydance: 2.4, tailglow: 2.4, geomancy: 3, bellydrum: 2.2, tidyup: 2.1,
    clangoroussoul: 2.6, filletaway: 2.4, noretreat: 2.4, curse: 1.3, growth: 1, workup: 1, honeclaws: 1.2,
    rockpolish: 0.6, agility: 0.6, autotomize: 0.6, irondefense: sp.baseStats.def > 90 ? 1.2 : 0, cottonguard: 1.4,
    acidarmor: sp.baseStats.def > 90 ? 1.2 : 0, cosmicpower: 0.8, defendorder: 0.8, takeheart: 1.8, howl: 0.8, amnesia: 0.5, barrier: 0.4, stockpile: 0.4,
  }[id] || 0;
  if (['irondefense', 'cottonguard', 'acidarmor', 'cosmicpower', 'defendorder'].includes(id)) {
    return ctx.pool.includes('bodypress') || ctx.pool.includes('storedpower') ? v : 0;
  }
  const base = c === 'Mixed' ? Math.max(atkV.Physical, atkV.Special) : atkV[c] || 0;
  if (base < 50) return 0;
  return v * (ability === 'simple' ? 1.5 : 1) * base / 100;
}

function bestRecovery(pool) {
  const order = ['recover', 'roost', 'slackoff', 'softboiled', 'milkdrink', 'shoreup', 'healorder', 'strengthsap', 'moonlight', 'morningsun', 'synthesis', 'lunarblessing', 'junglehealing', 'painsplit', 'lifedew'];
  return order.find((m) => pool.includes(m)) || null;
}

function bestStatusMove(pool, ability, sp) {
  const order = ['willowisp', 'toxic', 'glare', 'thunderwave', 'stunspore', 'leechseed', 'saltcure'];
  for (const m of order) if (pool.includes(m)) {
    if (m === 'thunderwave' && sp.baseStats.spe > 110) continue;
    return m;
  }
  return null;
}

function speciesItem(ctx) {
  const n = ctx.baseSp.baseSpecies;
  const nm = ctx.baseSp.name;
  if (ctx.forced) return null;
  if (n === 'Pikachu') return 'Light Ball';
  if (['Cubone', 'Marowak'].includes(n)) return 'Thick Club';
  if (["Farfetch’d", "Sirfetch’d", "Farfetch'd", "Sirfetch'd"].includes(n)) return 'Leek';
  if (n === 'Clamperl') return 'Deep Sea Tooth';
  if (n === 'Ditto') return 'Choice Scarf';
  if (nm === 'Zacian' || nm === 'Zamazenta') return null;
  return null;
}

function abilityItemFor(ability, sp) {
  if (ability === 'poisonheal' || ability === 'toxicboost') return 'Toxic Orb';
  if (ability === 'guts' || ability === 'marvelscale' || ability === 'quickfeet') return sp.types.includes('Fire') ? 'Toxic Orb' : 'Flame Orb';
  if (ability === 'flareboost') return 'Flame Orb';
  if (ability === 'magicguard') return 'Life Orb';
  if (ability === 'harvest') return 'Sitrus Berry';
  if (ability === 'quarkdrive' || ability === 'protosynthesis') return 'Booster Energy';
  if (ability === 'unburden') return 'Sitrus Berry';
  return null;
}

// Pokémon Showdown 1v1 factory sets (Smogon-curated) and random-battle move pools.
let FACTORY = null, RANDBATS = null;
function curatedCandidates(entry, baseSp, pool, battleAbilities) {
  const out = [];
  if (!FACTORY) {
    try { FACTORY = require('pokemon-showdown/data/random-battles/gen9/1v1-factory-sets.json'); } catch { FACTORY = {}; }
    RANDBATS = [];
    for (const g of ['gen9', 'gen8', 'gen7']) {
      try { RANDBATS.push(require(`pokemon-showdown/data/random-battles/${g}/sets.json`)); } catch { /* optional */ }
    }
  }
  const nm = baseSp.name;
  for (const tier of Object.values(FACTORY)) {
    const e = tier[nm];
    if (!e) continue;
    for (const s of e.sets) {
      if (s.species !== nm && toID(s.species) !== toID(entry.name)) continue;
      const set = {
        species: nm, item: entry.forcedItem || s.item, ability: s.ability, nature: s.nature, evs: s.evs || {},
        ivs: s.ivs, moves: s.moves.map((opts) => toID(opts[0])), level: config.level, archetype: 'Curated 1v1 set (Smogon)',
      };
      out.push(set);
    }
  }
  // random-battle move pools: choose moves from the curated pool with our scorer
  const keyName = toID(entry.transform === 'mega' || entry.primal ? entry.name : nm);
  for (const data of RANDBATS) {
    const e = data[keyName] || data[toID(nm)];
    if (!e || !e.sets) continue;
    for (const s of e.sets.slice(0, 2)) {
      const mp = (s.movepool || []).map(toID).filter((m) => pool.includes(m) && moveRole(m));
      if (mp.length < 2) continue;
      const ability = toID((s.abilities || [])[0] || battleAbilities[0]);
      const ctx = { entry, battleSp: dex.species.get(entry.name), baseSp, ability: battleAbilities.includes(ability) ? ability : battleAbilities[0], pool: mp, forced: entry.forcedItem };
      ctx.setAbility = entry.transform || entry.primal ? bestBaseAbility(legalAbilities(nm), baseSp) : ctx.ability;
      const setups = mp.filter((m) => SETUP.has(m));
      const others = mp.filter((m) => moveRole(m) !== 'attack' && !SETUP.has(m)).slice(0, 1);
      const atks = pickAttacks(attackPool(ctx, 'Life Orb'), 4 - setups.slice(0, 1).length - others.length);
      const moves = [...setups.slice(0, 1), ...atks.map((m) => m.id), ...others].slice(0, 4);
      if (!moves.length) continue;
      const cat = categoryOfMoves(moves, preferredCategory(ctx));
      const frail = (ctx.battleSp.baseStats.hp * (ctx.battleSp.baseStats.def + ctx.battleSp.baseStats.spd)) / 2 < 6500;
      const { evs, nature } = buildEVs(s.role && /Bulky|Wall|Support/.test(s.role) ? 'bulky' : 'offense', ctx.battleSp, cat);
      const item = entry.forcedItem || speciesItem(ctx) || abilityItemFor(ctx.ability, ctx.battleSp)
        || (setups.length ? (others.length ? 'Leftovers' : 'Life Orb') : (frail ? 'Focus Sash' : 'Leftovers'));
      out.push({ species: nm, ability: ctx.setAbility, item, moves, nature, evs, level: config.level, archetype: `Random-battle pool: ${s.role}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- validation
function validateAndRepair(set, entry, pool) {
  set = JSON.parse(JSON.stringify(set));
  set.moves = [...new Set(set.moves.filter(Boolean))].slice(0, 4);
  if (bannedItems.has(toID(set.item))) set.item = 'Leftovers';
  const item = dex.items.get(set.item);
  if (!item.exists) set.item = 'Leftovers';
  if (!set.ability || !legalAbilities(set.species).includes(toID(set.ability))) set.ability = legalAbilities(set.species)[0];
  set.ability = dex.abilities.get(set.ability).name;
  set.item = dex.items.get(set.item).name;
  const backups = pool.filter((m) => moveRole(m) === 'attack' && !set.moves.includes(m))
    .sort((a, b) => dex.moves.get(b).basePower - dex.moves.get(a).basePower);
  for (let tries = 0; tries < 8; tries++) {
    const probe = { ...set, moves: set.moves.map((m) => dex.moves.get(m).name) };
    const itm = dex.items.get(set.item);
    if (itm.isNonstandard === 'Future') probe.item = 'Leftovers'; // validator lacks some Z-A items
    const problems = validator.validateSet(probe, {});
    if (!problems) {
      set.moves = probe.moves;
      return set;
    }
    let fixed = false;
    for (const p of problems) {
      const bad = set.moves.find((m) => p.includes(dex.moves.get(m).name));
      if (bad && toID(entry.requiredMove || '') !== bad) {
        set.moves = set.moves.filter((m) => m !== bad);
        const rep = backups.shift();
        if (rep) set.moves.push(rep);
        fixed = true; break;
      }
      if (/ability|Ability/.test(p)) {
        const alts = legalAbilities(set.species).filter((a) => toID(set.ability) !== a);
        if (alts.length) { set.ability = dex.abilities.get(alts[0]).name; fixed = true; break; }
      }
      if (/item/i.test(p) && !entry.forcedItem) { set.item = 'Leftovers'; fixed = true; break; }
      if (/EV|nature/i.test(p)) { set.evs = { hp: 252, atk: 4, def: 252 }; fixed = true; break; }
    }
    if (!fixed || !set.moves.length) return null;
  }
  return null;
}

module.exports = { candidateSets, setTypeEnvironment, validateAndRepair };

if (require.main === module) {
  const roster = require('../data/roster.json');
  setTypeEnvironment(roster);
  const names = process.argv.slice(2);
  for (const n of names) {
    const e = roster.find((r) => r.id === toID(n));
    if (!e) { console.log('no entry', n); continue; }
    console.time(n);
    const c = candidateSets(e);
    console.timeEnd(n);
    for (const s of c) console.log(`  [${s.archetype}] ${s.species} @ ${s.item} | ${s.ability} | ${s.nature} ${JSON.stringify(s.evs)} | ${s.moves.join(', ')}`);
  }
}
