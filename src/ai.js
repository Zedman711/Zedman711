'use strict';
// Competitive 1v1 decision-making AI.
//
// Both players are controlled by this same AI with open team sheets (each side knows the
// opponent's set — the standard assumption for 1v1 analysis). Each turn the AI:
//   1. reads the true battle state from the Pokémon Showdown engine,
//   2. estimates damage for every move of both sides with @smogon/calc (the standard
//      competitive damage calculator), under the current boosts / status / weather / terrain /
//      screens, re-calculating for any hypothetical state it explores,
//   3. for each of its legal moves, and each plausible opponent reply, plays the battle forward
//      in an expected-value model (turn order by priority and speed, accuracy, recoil, drain,
//      Life Orb, Focus Sash / Sturdy, Multiscale, status damage, Leftovers, weather chip, setup
//      boosts, recovery, protection, substitutes, Counter-family moves, Trick Room, Tailwind, ...)
//      where both sides continue with a sensible greedy policy (KO if possible, recover when
//      worthwhile, otherwise strongest attack),
//   4. picks the move with the best mix of expected and worst-case outcome.
// The model is only used for *choosing* moves; the battle itself is resolved by Showdown.
const { dex, calc, calcGen, toID } = require('./dex');
const { moveRole, SETUP, RECOVERY, PROTECT } = require('./moveinfo');

const WEATHER = { sunnyday: 'Sun', raindance: 'Rain', sandstorm: 'Sand', snowscape: 'Snow', snow: 'Snow', hail: 'Hail', desolateland: 'Harsh Sunshine', primordialsea: 'Heavy Rain', deltastream: 'Strong Winds' };
const TERRAIN = { electricterrain: 'Electric', grassyterrain: 'Grassy', psychicterrain: 'Psychic', mistyterrain: 'Misty' };
const WEATHER_MOVE = { sunnyday: 'sunnyday', raindance: 'raindance', sandstorm: 'sandstorm', snowscape: 'snowscape', hail: 'hail' };
const TERRAIN_MOVE = { electricterrain: 1, grassyterrain: 1, psychicterrain: 1, mistyterrain: 1 };
const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];
const HP_DEPENDENT = new Set(['eruption', 'waterspout', 'dragonenergy', 'reversal', 'flail', 'hardpress', 'wringout', 'crushgrip', 'brine', 'hex', 'facade', 'acrobatics', 'knockoff', 'poltergeist', 'boltbeak', 'fishiousrend']);
const COUNTER_MOVES = { counter: 'Physical', mirrorcoat: 'Special', metalburst: 'Any', comeuppance: 'Any' };
const STATUS_MOVE_STATUS = { willowisp: 'brn', thunderwave: 'par', glare: 'par', stunspore: 'par', toxic: 'tox', poisonpowder: 'psn', toxicthread: 'psn' };
const DIRECT_IMMUNE_ABIL = { brn: ['waterveil', 'waterbubble', 'thermalexchange', 'comatose', 'purifyingsalt'], par: ['limber', 'comatose', 'purifyingsalt'], psn: ['immunity', 'pastelveil', 'comatose', 'purifyingsalt'], tox: ['immunity', 'pastelveil', 'comatose', 'purifyingsalt'] };

function bk(b) { return b.atk + ',' + b.def + ',' + b.spa + ',' + b.spd + ',' + b.spe; }
function chip(s, frac) { return Math.max(1, Math.floor(s.maxhp * frac)); }
function stageMult(stage) { return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage); }
function clampBoost(v) { return Math.max(-6, Math.min(6, v)); }

class BattleAI {
  constructor(battle, sideIndex, sets, shared) {
    this.battle = battle;
    this.me = sideIndex;
    this.sets = sets;           // [setOfSide0, setOfSide1]
    shared = shared || { dmg: new Map(), mon: new Map() };
    this.dmgCache = shared.dmg;  // caches are shared by both players of one battle
    this.monCache = shared.mon;
    this.lastMoves = [null, null];
  }

  side(i) { return this.battle.sides[i]; }
  poke(i) { return this.side(i).active[0]; }

  // ------------------------------------------------------------------ snapshot of real state
  snapshot(request) {
    const b = this.battle;
    const st = { weather: b.field.weather || '', weatherTurns: b.field.weather ? (b.field.weatherState.duration || 99) : 0,
      terrain: b.field.terrain || '', terrainTurns: b.field.terrain ? (b.field.terrainState.duration || 99) : 0,
      tr: b.field.pseudoWeather.trickroom ? b.field.pseudoWeather.trickroom.duration || 5 : 0, t: 0, s: [] };
    for (let i = 0; i < 2; i++) {
      const p = this.poke(i);
      const side = this.side(i);
      const willMega = this.willMega[i];
      const v = p.volatiles;
      st.s.push({
        hp: p.hp, maxhp: p.maxhp, boosts: { ...p.boosts }, status: p.status || '',
        toxN: p.status === 'tox' ? (p.statusState.stage || 0) + 1 : 0,
        sleep: p.status === 'slp' ? Math.max(1, (p.statusState.time || 2) - 1) : 0,
        sub: v.substitute ? v.substitute.hp : 0, seeded: !!v.leechseed, saltcure: !!v.saltcure, aquaring: !!(v.aquaring || v.ingrain),
        item: p.item ? p.getItem().name : '', ability: willMega ? this.megaAbility(i) : toID(p.ability),
        lock: v.choicelock ? v.choicelock.move : (v.lockedmove ? toID(v.lockedmove.move || '') : (v.twoturnmove ? toID(v.twoturnmove.move || '') : '')),
        lockTurns: v.lockedmove ? v.lockedmove.duration || 2 : 0,
        recharge: !!v.mustrecharge, truant: !!v.truant, charging: '', protLast: !!(v.stall), taunt: v.taunt ? v.taunt.duration || 3 : 0,
        encore: v.encore ? v.encore.duration || 3 : 0, encoreMove: v.encore ? v.encore.move : '',
        reflect: side.sideConditions.reflect ? side.sideConditions.reflect.duration : 0,
        lightscreen: side.sideConditions.lightscreen ? side.sideConditions.lightscreen.duration : 0,
        auroraveil: side.sideConditions.auroraveil ? side.sideConditions.auroraveil.duration : 0,
        tailwind: side.sideConditions.tailwind ? side.sideConditions.tailwind.duration : 0,
        disguise: (toID(p.ability) === 'disguise' && p.species.name === 'Mimikyu') || (toID(p.ability) === 'iceface' && p.species.name === 'Eiscue'),
        firstTurn: p.activeMoveActions === 0, wish: 0, usedItem: false,
        lastMove: p.lastMove ? p.lastMove.id : '',
        flashfire: !!v.flashfire, transformed: !!p.transformed,
      });
    }
    return st;
  }

  megaAbility(i) {
    const p = this.poke(i);
    const it = p.getItem();
    let target = null;
    if (it.megaStone) target = typeof it.megaStone === 'string' ? it.megaStone : it.megaStone[p.baseSpecies.name] || Object.values(it.megaStone)[0];
    if (it.id === 'ultranecroziumz') target = 'Necrozma-Ultra';
    if (!target && p.baseSpecies.name === 'Rayquaza') target = 'Rayquaza-Mega';
    if (!target) return toID(p.ability);
    return toID(dex.species.get(target).abilities[0]);
  }

  speciesFor(i, willMega) {
    const p = this.poke(i);
    if (willMega) {
      const it = p.getItem();
      if (it.megaStone) return typeof it.megaStone === 'string' ? it.megaStone : (it.megaStone[p.species.name] || Object.values(it.megaStone)[0]);
      if (it.id === 'ultranecroziumz') return 'Necrozma-Ultra';
      if (p.species.name === 'Rayquaza') return 'Rayquaza-Mega';
    }
    return p.species.name;
  }

  // ------------------------------------------------------------------ damage via @smogon/calc
  calcMon(i, ss, speciesName) {
    const p = this.poke(i);
    const set = p.transformed && this.sets[1 - i] ? this.sets[1 - i] : this.sets[i];
    const boosts = {};
    for (const k of STAT_KEYS) boosts[k] = Math.round(ss.boosts[k] || 0);
    const status = ss.status === 'tox' ? 'tox' : ss.status;
    const key = i + '|' + speciesName + '|' + ss.item + '|' + ss.ability + '|' + bk(boosts) + '|' + status + '|' + Math.round(ss.hp) + '|' + ss.flashfire;
    let mon = this.monCache.get(key);
    if (mon) return mon;
    const types = p.getTypes();
    const opts = {
      level: p.level, ability: dex.abilities.get(ss.ability).name || undefined, item: ss.item || undefined,
      nature: set.nature, evs: set.evs, ivs: set.ivs, boosts, status: status || '',
      abilityOn: ss.flashfire || undefined,
    };
    try {
      mon = new calc.Pokemon(calcGen, speciesName, opts);
    } catch (e) {
      mon = new calc.Pokemon(calcGen, p.baseSpecies.name, opts);
    }
    if (p.transformed || speciesName === p.species.name) {
      try { if (JSON.stringify(mon.types) !== JSON.stringify(types)) mon.types = types; } catch (e) { /* ignore */ }
    }
    if (p.transformed) {
      // Transform copies stats except HP
      mon.rawStats = { ...mon.rawStats, hp: p.maxhp };
    }
    mon.originalCurHP = Math.max(1, Math.min(Math.round(ss.hp), mon.maxHP()));
    this.monCache.set(key, mon);
    return mon;
  }

  // expected damage (absolute HP) of attacker `a` using move id against `d` in state st
  damage(st, a, moveId, species) {
    const sa = st.s[a], sd = st.s[1 - a];
    const hpDep = HP_DEPENDENT.has(moveId);
    const aHp = hpDep ? Math.max(1, Math.round(sa.hp / sa.maxhp * 16) / 16 * sa.maxhp) : sa.maxhp;
    const fullD = sd.hp >= sd.maxhp ? 1 : 0;
    const dHp = fullD ? sd.maxhp : (hpDep ? Math.max(1, Math.round(sd.hp / sd.maxhp * 16) / 16 * sd.maxhp) : sd.maxhp - 1);
    const key = a + moveId + '|' + species[a] + '|' + species[1 - a] + '|' + bk(sa.boosts) + '|' + bk(sd.boosts) + '|' + sa.status + sd.status + '|' +
      st.weather + st.terrain + '|' + (sd.reflect > 0 ? 1 : 0) + (sd.lightscreen > 0 ? 1 : 0) + (sd.auroraveil > 0 ? 1 : 0) + '|' + sa.item + '|' + sd.item + '|' + sa.ability + '|' + sd.ability + '|' + aHp + '|' + dHp + '|' + (sa.flashfire ? 1 : 0);
    let r = this.dmgCache.get(key);
    if (r) return r;
    r = { exp: 0, min: 0, max: 0, cat: 'Status', type: '' };
    try {
      const atk = this.calcMon(a, { ...sa, hp: aHp }, species[a]);
      const def = this.calcMon(1 - a, { ...sd, hp: dHp }, species[1 - a]);
      const field = new calc.Field({
        weather: WEATHER[st.weather] || undefined, terrain: TERRAIN[st.terrain] || undefined,
        defenderSide: { isReflect: sd.reflect > 0, isLightScreen: sd.lightscreen > 0, isAuroraVeil: sd.auroraveil > 0 },
        attackerSide: { isTailwind: sa.tailwind > 0 },
      });
      const mv = new calc.Move(calcGen, dex.moves.get(moveId).name, { ability: atk.ability, item: atk.item, species: atk.name });
      const res = calc.calculate(calcGen, atk, def, mv, field);
      const [lo, hi] = res.range();
      r = { exp: (lo + hi) / 2, min: lo, max: hi, cat: mv.category, type: mv.type, contact: !!mv.flags.contact };
    } catch (e) {
      r = { exp: 0, min: 0, max: 0, cat: 'Status', type: '' };
    }
    this.dmgCache.set(key, r);
    return r;
  }

  // ------------------------------------------------------------------ speed / order
  speed(st, i, species, baseSpe) {
    const s = st.s[i];
    let spe = baseSpe[i] * stageMult(s.boosts.spe || 0);
    if (s.status === 'par' && s.ability !== 'quickfeet' && !baseSpe.parApplied[i]) spe *= 0.5;
    if (s.status && s.ability === 'quickfeet') spe *= 1.5;
    if (s.tailwind > 0) spe *= 2;
    const w = st.weather;
    if ((s.ability === 'swiftswim' && (w === 'raindance' || w === 'primordialsea')) || (s.ability === 'chlorophyll' && (w === 'sunnyday' || w === 'desolateland'))
      || (s.ability === 'sandrush' && w === 'sandstorm') || (s.ability === 'slushrush' && (w === 'snowscape' || w === 'hail'))) spe *= baseSpe.weatherApplied[i] ? 1 : 2;
    if (s.ability === 'unburden' && s.usedItem) spe *= 2;
    return st.tr > 0 ? -spe : spe;
  }

  priority(st, i, moveId) {
    const m = dex.moves.get(moveId);
    let p = m.priority || 0;
    const s = st.s[i];
    if (s.ability === 'prankster' && m.category === 'Status') p += 1;
    if (s.ability === 'galewings' && m.type === 'Flying' && s.hp >= s.maxhp) p += 1;
    if (s.ability === 'triage' && m.flags.heal) p += 3;
    if (moveId === 'grassyglide' && st.terrain === 'grassyterrain') p += 1;
    return p;
  }

  // ------------------------------------------------------------------ rollout engine
  clone(st) {
    return { weather: st.weather, weatherTurns: st.weatherTurns, terrain: st.terrain, terrainTurns: st.terrainTurns, tr: st.tr, t: st.t,
      s: st.s.map((x) => ({ ...x, boosts: { ...x.boosts } })) };
  }

  movesOf(i) {
    if (!this._moves) this._moves = [];
    if (!this._moves[i]) this._moves[i] = this.poke(i).moveSlots.map((m) => m.id);
    return this._moves[i];
  }

  // greedy continuation policy for side i in state st
  greedy(st, i, ctx) {
    const s = st.s[i], o = st.s[1 - i];
    const moves = this.usable(st, i, ctx);
    if (!moves.length) return 'struggle';
    if (moves.length === 1) return moves[0];
    let best = null, bestV = -1, bestKO = null, bestKOprio = -99;
    const iAmFaster = this.speed(st, i, ctx.species, ctx.baseSpe) > this.speed(st, 1 - i, ctx.species, ctx.baseSpe);
    for (const m of moves) {
      if (ctx.roles[m] !== 'attack') continue;
      const v = this.attackValue(st, i, m, ctx);
      const d = this.damage(st, i, m, ctx.species);
      if (d.min >= o.hp && ctx.acc[i][m] >= 0.99 && !(o.sub > 0) && v > 0) {
        const pr = this.priority(st, i, m);
        if (pr > bestKOprio) { bestKO = m; bestKOprio = pr; }
      }
      if (v > bestV) { bestV = v; best = m; }
    }
    if (bestKO && (bestKOprio > 0 || iAmFaster || !best)) return bestKO;
    const incoming = this.bestDamage(st, 1 - i, ctx);
    const myHits = bestV > 0 ? Math.ceil(o.hp / bestV) : 99;
    const foeHits = incoming > 0 ? Math.ceil(s.hp / incoming) : 99;
    // recovery when it out-heals incoming damage
    const rec = moves.find((m) => ctx.roles[m] === 'recovery' && m !== 'rest' && m !== 'wish');
    if (rec && s.hp < s.maxhp * 0.55 && incoming < s.maxhp * 0.45 && (foeHits <= myHits || s.hp < s.maxhp * 0.4)) return rec;
    // set up while it is safe and it actually speeds up the KO
    if (myHits >= 2 && (foeHits >= 3 || (foeHits >= 2 && rec))) {
      for (const m of moves) {
        if (ctx.roles[m] !== 'setup' || (s.setups || 0) >= 4) continue;
        const after = this.clone(st);
        this.act(after, i, m, '', ctx, { dmgTaken: [0, 0], dmgCat: ['', ''], protect: [false, false], moved: [false, false], dbond: [false, false] });
        if (after.s[i].hp <= 0) continue;
        let bv = 0;
        for (const a of moves) if (ctx.roles[a] === 'attack') bv = Math.max(bv, this.attackValue(after, i, a, ctx));
        const fasterAfter = this.speed(after, i, ctx.species, ctx.baseSpe) > this.speed(after, 1 - i, ctx.species, ctx.baseSpe);
        const incAfter = this.bestDamage(after, 1 - i, ctx);
        if (bv > bestV * 1.25 || (fasterAfter && !iAmFaster) || incAfter < incoming * 0.75) {
          s.setups = (s.setups || 0) + 1;
          return m;
        }
      }
    }
    // cripple with status when the fight is long
    if (!o.status && myHits >= 3) {
      for (const m of moves) {
        if (ctx.roles[m] !== 'status') continue;
        const stt = STATUS_MOVE_STATUS[m];
        if (!stt || !this.canStatus(st, 1 - i, stt, dex.moves.get(m))) continue;
        if (stt === 'brn' && !this.physicalAttacker(1 - i, ctx)) continue;
        if (stt === 'par' && iAmFaster) continue;
        return m;
      }
    }
    if (!o.seeded && myHits >= 3 && moves.includes('leechseed') && !ctx.types[1 - i].includes('Grass')) return 'leechseed';
    if (best && bestV > 0) return best;
    for (const m of moves) if (ctx.roles[m] === 'status' && !o.status) return m;
    if (rec && s.hp < s.maxhp) return rec;
    return best || moves[0];
  }

  physicalAttacker(i, ctx) {
    if (ctx.physical[i] === undefined) {
      const ms = ctx.legal[i].map((m) => dex.moves.get(m)).filter((m) => m.category !== 'Status');
      ctx.physical[i] = ms.filter((m) => m.category === 'Physical').length >= ms.length / 2 && ms.length > 0;
    }
    return ctx.physical[i];
  }

  attackValue(st, i, m, ctx) {
    const s = st.s[i], o = st.s[1 - i];
    const d = this.damage(st, i, m, ctx.species);
    let v = d.exp * ctx.acc[i][m];
    if (o.sub > 0 && !dex.moves.get(m).flags.bypasssub) v = Math.min(v, o.sub + 1) * 0.6;
    if (ctx.firstOnly[m] && !s.firstTurn) v = 0;
    if (m === 'suckerpunch' || m === 'thunderclap') v *= 0.7;
    const mv = dex.moves.get(m);
    if (mv.self && mv.self.volatileStatus === 'mustrecharge' && d.min < o.hp) v *= 0.5;
    if (mv.flags.charge && s.item !== 'Power Herb' && !(st.weather === 'sunnyday' && (m === 'solarbeam' || m === 'solarblade'))) v *= 0.5;
    return v;
  }

  bestDamage(st, i, ctx) {
    let bestV = 0;
    for (const m of this.usable(st, i, ctx)) {
      if (ctx.roles[m] !== 'attack') continue;
      const v = this.damage(st, i, m, ctx.species).exp * ctx.acc[i][m];
      if (v > bestV) bestV = v;
    }
    return bestV;
  }

  usable(st, i, ctx) {
    const s = st.s[i];
    let list = ctx.legal[i];
    if (s.lock && list.includes(s.lock)) return [s.lock];
    if (s.encore > 0 && s.encoreMove && list.includes(s.encoreMove)) return [s.encoreMove];
    if (s.taunt > 0) list = list.filter((m) => ctx.roles[m] === 'attack' || COUNTER_MOVES[m]);
    return list;
  }

  // simulate one turn with chosen actions [a0, a1]; mutates st
  turn(st, acts, ctx, order) {
    const first = order;
    const seq = [first, 1 - first];
    const tr = { dmgTaken: [0, 0], dmgCat: ['', ''], protect: [false, false], moved: [false, false], dbond: [false, false] };
    for (const i of seq) {
      if (st.s[i].hp <= 0 || st.s[1 - i].hp <= 0) break;
      this.act(st, i, acts[i], acts[1 - i], ctx, tr);
      tr.moved[i] = true;
      if (st.s[1 - i].hp <= 0 && tr.dbond[1 - i]) st.s[i].hp = 0;
    }
    for (const i of [0, 1]) st.s[i].protLast = tr.protect[i];
    if (st.s[0].hp > 0 && st.s[1].hp > 0) this.endOfTurn(st, ctx);
    st.t++;
    for (const s of st.s) s.firstTurn = false;
  }

  act(st, i, moveId, foeMove, ctx, tr) {
    const s = st.s[i], o = st.s[1 - i];
    if (s.recharge) { s.recharge = false; return; }
    if (s.ability === 'truant') { if (s.truant) { s.truant = false; return; } s.truant = true; }
    if (s.status === 'slp') {
      if (s.sleep > 0) { s.sleep--; return; }
      s.status = '';
    }
    if (s.status === 'frz') { s.status = ''; return; }
    const m = dex.moves.get(moveId);
    if (!m.exists) return;
    const role = ctx.roles[moveId] || (m.category === 'Status' ? 'other' : 'attack');
    const para = s.status === 'par' ? 0.75 : 1;
    const acc = ctx.acc[i][moveId] ?? 1;
    const p = para * acc;
    if (s.charging !== moveId && m.flags.charge && !(s.item === 'Power Herb') && !((moveId === 'solarbeam' || moveId === 'solarblade') && (st.weather === 'sunnyday' || st.weather === 'desolateland')) && !(moveId === 'electroshot' && (st.weather === 'raindance' || st.weather === 'primordialsea'))) {
      s.charging = moveId; s.lock = moveId;
      if (moveId === 'meteorbeam' || moveId === 'electroshot') s.boosts.spa = clampBoost(s.boosts.spa + 1);
      if (moveId === 'geomancy') return;
      return;
    }
    if (s.charging === moveId) { s.charging = ''; s.lock = ''; if (moveId === 'geomancy') { s.boosts.spa = clampBoost(s.boosts.spa + 2); s.boosts.spd = clampBoost(s.boosts.spd + 2); s.boosts.spe = clampBoost(s.boosts.spe + 2); return; } }
    else if (m.flags.charge && s.item === 'Power Herb') { s.item = ''; s.usedItem = true; if (moveId === 'geomancy') { s.boosts.spa += 2; s.boosts.spd += 2; s.boosts.spe += 2; return; } }
    if (tr.protect[1 - i] && m.target !== 'self' && m.flags.protect) return;

    if (role === 'attack') {
      if (ctx.firstOnly[moveId] && !s.firstTurn) return;
      if ((moveId === 'suckerpunch' || moveId === 'thunderclap') && (tr.moved[1 - i] || (ctx.roles[foeMove] !== 'attack'))) return;
      const d = this.damage(st, i, moveId, ctx.species);
      if (!d.exp) return;
      let dmg = d.exp * p;
      if (o.disguise && (d.cat === 'Physical' || (o.ability === 'disguise'))) {
        dmg = o.ability === 'disguise' ? o.maxhp / 8 * p : 0; o.disguise = false;
      }
      if (o.sub > 0 && !m.flags.bypasssub && s.ability !== 'infiltrator') {
        o.sub = Math.max(0, o.sub - dmg);
      } else {
        const multi = !!m.multihit;
        if (dmg >= o.hp && o.hp >= o.maxhp && !multi && (o.item === 'Focus Sash' || o.ability === 'sturdy') && s.ability !== 'moldbreaker') {
          dmg = o.hp - 1; if (o.item === 'Focus Sash') { o.item = ''; o.usedItem = true; }
        }
        dmg = Math.min(dmg, o.hp);
        o.hp -= dmg;
        tr.dmgTaken[1 - i] += dmg; tr.dmgCat[1 - i] = d.cat;
        if (o.item === 'Weakness Policy' && ctx.eff(d.type, 1 - i) > 1) { o.boosts.atk = clampBoost(o.boosts.atk + 2); o.boosts.spa = clampBoost(o.boosts.spa + 2); o.item = ''; }
        if (o.item === 'Sitrus Berry' && o.hp > 0 && o.hp <= o.maxhp / 2) { o.hp += o.maxhp / 4; o.item = ''; o.usedItem = true; }
        if (moveId === 'knockoff' && o.item && !/ite$|ite [XYZ]$|Orb$|Plate$|Memory$|Mask$|Crystal$|Core$|Rusted/.test(o.item)) { o.item = ''; }
        if (m.drain) s.hp = Math.min(s.maxhp, s.hp + dmg * m.drain[0] / m.drain[1]);
        if (m.recoil && s.ability !== 'rockhead' && s.ability !== 'magicguard') s.hp -= dmg * m.recoil[0] / m.recoil[1];
        if ((m.mindBlownRecoil || moveId === 'steelbeam' || moveId === 'chloroblast') && s.ability !== 'magicguard') s.hp -= chip(s, 1 / 2);
        if (d.contact && s.ability !== 'magicguard' && s.item !== 'Protective Pads') {
          if (o.ability === 'roughskin' || o.ability === 'ironbarbs') s.hp -= chip(s, 1 / 8);
          if (o.item === 'Rocky Helmet') s.hp -= chip(s, 1 / 6);
        }
        if (s.item === 'Life Orb' && s.ability !== 'magicguard' && !(s.ability === 'sheerforce' && m.secondaries)) s.hp -= chip(s, 1 / 10);
        if (m.secondaries && s.ability !== 'sheerforce') {
          for (const sec of m.secondaries) {
            if (sec.status && (sec.chance || 100) >= 100 && !o.status && o.hp > 0 && this.canStatus(st, 1 - i, sec.status, m)) o.status = sec.status;
            if (sec.boosts && (sec.chance || 100) >= 100 && o.hp > 0) for (const k in sec.boosts) o.boosts[k] = clampBoost(o.boosts[k] + sec.boosts[k]);
          }
        }
        if (moveId === 'saltcure') o.saltcure = true;
      }
      if (m.self && m.self.boosts) {
        for (const k in m.self.boosts) {
          const delta = m.self.boosts[k] * (s.ability === 'contrary' ? -1 : 1) * (s.ability === 'simple' ? 2 : 1);
          s.boosts[k] = clampBoost(s.boosts[k] + delta);
        }
      }
      if (m.self && m.self.volatileStatus === 'mustrecharge') s.recharge = true;
      if (/^Choice/.test(s.item) || s.ability === 'gorillatactics') s.lock = moveId;
      if (m.self && m.self.volatileStatus === 'lockedmove' && !s.lock) { s.lock = moveId; s.lockTurns = 2; }
      s.lastMove = moveId;
      return;
    }
    s.lastMove = moveId;
    if (/^Choice/.test(s.item)) s.lock = moveId;
    if (COUNTER_MOVES[moveId]) {
      const cat = COUNTER_MOVES[moveId];
      const taken = tr.dmgTaken[i];
      if (taken > 0 && (cat === 'Any' || tr.dmgCat[i] === cat)) {
        const type = m.type;
        if (ctx.eff(type, 1 - i) > 0 || moveId === 'metalburst') {
          const mult = cat === 'Any' ? 1.5 : 2;
          o.hp -= Math.min(o.hp, taken * mult);
        }
      }
      return;
    }
    if (moveId === 'endeavor') {
      if (ctx.eff('Normal', 1 - i) > 0 && s.hp < o.hp) o.hp = s.hp;
      return;
    }
    const k = moveId;
    if (role === 'setup') {
      const mult = s.ability === 'simple' ? 2 : 1;
      const sign = s.ability === 'contrary' ? -1 : 1;
      if (k === 'bellydrum') { if (s.hp > s.maxhp / 2) { s.hp -= chip(s, 1 / 2); s.boosts.atk = 6; if (s.item === 'Sitrus Berry') { s.hp += s.maxhp / 4; s.item = ''; } } return; }
      if (k === 'filletaway') { if (s.hp > s.maxhp / 2) { s.hp -= chip(s, 1 / 2); s.boosts.atk = clampBoost(s.boosts.atk + 2); s.boosts.spa = clampBoost(s.boosts.spa + 2); s.boosts.spe = clampBoost(s.boosts.spe + 2); } return; }
      if (k === 'clangoroussoul') { if (s.hp > s.maxhp / 3) { s.hp -= chip(s, 1 / 3); for (const x of STAT_KEYS) s.boosts[x] = clampBoost(s.boosts[x] + 1); } return; }
      if (k === 'curse') {
        if (ctx.types[i].includes('Ghost')) { if (!o.cursed) { s.hp -= chip(s, 1 / 2); o.cursed = true; } return; }
        s.boosts.atk = clampBoost(s.boosts.atk + sign * mult); s.boosts.def = clampBoost(s.boosts.def + sign * mult); s.boosts.spe = clampBoost(s.boosts.spe - sign * mult); return;
      }
      const boosts = m.boosts || (m.self && m.self.boosts) || {};
      let growth = k === 'growth' && (st.weather === 'sunnyday' || st.weather === 'desolateland') ? 2 : 1;
      for (const x in boosts) s.boosts[x] = clampBoost(s.boosts[x] + boosts[x] * mult * sign * growth * para);
      if (k === 'shellsmash' && s.item === 'White Herb') { s.boosts.def = Math.max(0, s.boosts.def); s.boosts.spd = Math.max(0, s.boosts.spd); s.item = ''; s.usedItem = true; }
      if (k === 'takeheart' && s.status) s.status = '';
      return;
    }
    if (role === 'recovery') {
      const heal = (f) => { s.hp = Math.min(s.maxhp, s.hp + s.maxhp * f * para); };
      if (k === 'rest') { if (s.hp < s.maxhp && s.ability !== 'insomnia' && s.ability !== 'vitalspirit' && !(st.terrain === 'electricterrain')) { s.hp = s.maxhp; s.status = 'slp'; s.sleep = s.ability === 'earlybird' ? 1 : 2; s.toxN = 0; } return; }
      if (k === 'painsplit') { const avg = (s.hp + o.hp) / 2; s.hp = Math.min(s.maxhp, avg); o.hp = Math.min(o.maxhp, avg); return; }
      if (k === 'wish') { s.wish = 2; return; }
      if (k === 'strengthsap') { const foeAtk = ctx.foeAtkStat[1 - i] * stageMult(o.boosts.atk); if (o.boosts.atk > -6) { s.hp = Math.min(s.maxhp, s.hp + foeAtk * para); o.boosts.atk = clampBoost(o.boosts.atk - 1); } return; }
      if (['moonlight', 'morningsun', 'synthesis'].includes(k)) {
        const w = st.weather; heal(w === 'sunnyday' || w === 'desolateland' ? 2 / 3 : w ? 0.25 : 0.5); return;
      }
      if (k === 'shoreup') { heal(st.weather === 'sandstorm' ? 2 / 3 : 0.5); return; }
      if (k === 'lifedew' || k === 'junglehealing' || k === 'lunarblessing') { heal(0.25); if (k !== 'lifedew') s.status = ''; return; }
      if (k === 'roost' || m.heal) { heal(m.heal ? m.heal[0] / m.heal[1] : 0.5); return; }
      return;
    }
    if (role === 'status') {
      const status = STATUS_MOVE_STATUS[k];
      if (!status || o.status || o.sub > 0 || !this.canStatus(st, 1 - i, status, m)) return;
      if (o.ability === 'magicbounce' || o.ability === 'goodasgold') return;
      if (s.ability === 'prankster' && ctx.types[1 - i].includes('Dark')) return;
      if (k === 'toxic' && ctx.types[i].includes('Poison')) { o.status = 'tox'; o.toxN = 1; return; }
      // expected value: treat as success with probability p (deterministic model — apply if p >= .5)
      if (p >= 0.5) { o.status = status; if (status === 'tox') o.toxN = 1; o.statusProb = p; }
      return;
    }
    if (role === 'protect') {
      if (!s.protLast) tr.protect[i] = true;
      return;
    }
    // utility
    switch (k) {
      case 'substitute': if (s.hp > s.maxhp / 4 && !s.sub) { s.hp -= chip(s, 1 / 4); s.sub = s.maxhp / 4; } return;
      case 'leechseed': if (!ctx.types[1 - i].includes('Grass') && !o.seeded && !(o.sub > 0) && p >= 0.5) o.seeded = true; return;
      case 'destinybond': if (s.lastMove !== 'destinybond') tr.dbond[i] = true; return;
      case 'haze': for (const x of STAT_KEYS) { s.boosts[x] = 0; o.boosts[x] = 0; } return;
      case 'trickroom': st.tr = st.tr > 0 ? 0 : 5; return;
      case 'tailwind': s.tailwind = 4; return;
      case 'reflect': if (!s.reflect) s.reflect = s.item === 'Light Clay' ? 8 : 5; return;
      case 'lightscreen': if (!s.lightscreen) s.lightscreen = s.item === 'Light Clay' ? 8 : 5; return;
      case 'auroraveil': if (!s.auroraveil && (st.weather === 'snowscape' || st.weather === 'hail')) s.auroraveil = s.item === 'Light Clay' ? 8 : 5; return;
      case 'encore': if (o.lastMove && !o.encore) { o.encore = 3; o.encoreMove = o.lastMove; } return;
      case 'taunt': if (!o.taunt && o.ability !== 'oblivious' && o.ability !== 'aromaveil') o.taunt = 3; return;
      case 'trick': case 'switcheroo': { const t = s.item; s.item = o.item; o.item = t; if (/^Choice/.test(o.item)) o.lock = o.lastMove || ''; return; }
      case 'aquaring': case 'ingrain': s.aquaring = true; return;
      case 'focusenergy': case 'transform': return;
      default:
        if (WEATHER_MOVE[k]) { const map = { sunnyday: 'sunnyday', raindance: 'raindance', sandstorm: 'sandstorm', snowscape: 'snowscape', hail: 'hail' }; if (!['desolateland', 'primordialsea', 'deltastream'].includes(st.weather)) { st.weather = map[k]; st.weatherTurns = 5; } return; }
        if (TERRAIN_MOVE[k]) { st.terrain = k; st.terrainTurns = 5; return; }
        if (m.boosts && m.target !== 'self') {
          if (o.sub > 0 || ['clearbody', 'whitesmoke', 'fullmetalbody'].includes(o.ability)) return;
          for (const x in m.boosts) o.boosts[x] = clampBoost(o.boosts[x] + m.boosts[x] * p);
          if (o.ability === 'defiant') o.boosts.atk = clampBoost(o.boosts.atk + 2);
          if (o.ability === 'competitive') o.boosts.spa = clampBoost(o.boosts.spa + 2);
        }
    }
  }

  canStatus(st, i, status, move) {
    const s = st.s[i], types = this.ctx.types[i];
    if (s.status) return false;
    if ((DIRECT_IMMUNE_ABIL[status] || []).includes(s.ability)) return false;
    if (status === 'brn' && types.includes('Fire')) return false;
    if (status === 'par' && types.includes('Electric')) return false;
    if (status === 'par' && move && move.type === 'Electric' && move.category === 'Status' && types.includes('Ground')) return false;
    if ((status === 'psn' || status === 'tox') && (types.includes('Poison') || types.includes('Steel')) && this.ctx.abilities[1 - i] !== 'corrosion') return false;
    if (move && move.flags && move.flags.powder && (types.includes('Grass') || s.item === 'Safety Goggles' || s.ability === 'overcoat')) return false;
    if (st.terrain === 'mistyterrain' && !types.includes('Flying') && s.ability !== 'levitate') return false;
    return true;
  }

  endOfTurn(st, ctx) {
    const w = st.weather;
    for (let i = 0; i < 2; i++) {
      const s = st.s[i], o = st.s[1 - i];
      if (s.hp <= 0) continue;
      const mg = s.ability === 'magicguard';
      const types = ctx.types[i];
      if (w === 'sandstorm' && !mg && !types.some((t) => ['Rock', 'Ground', 'Steel'].includes(t)) && !['overcoat', 'sandforce', 'sandrush', 'sandveil'].includes(s.ability) && s.item !== 'Safety Goggles') s.hp -= chip(s, 1 / 16);
      if (s.wish > 0 && --s.wish === 0) s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 2);
      if (s.item === 'Leftovers') s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 16);
      if (s.item === 'Black Sludge') s.hp = types.includes('Poison') ? Math.min(s.maxhp, s.hp + s.maxhp / 16) : s.hp - (mg ? 0 : chip(s, 1 / 8));
      if (s.aquaring) s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 16);
      if (st.terrain === 'grassyterrain' && !types.includes('Flying') && s.ability !== 'levitate') s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 16);
      if ((s.ability === 'raindish' && w === 'raindance') || (s.ability === 'icebody' && (w === 'snowscape' || w === 'hail'))) s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 16);
      if (s.ability === 'dryskin' && w === 'raindance') s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 8);
      if (s.ability === 'solarpower' && w === 'sunnyday' && !mg) s.hp -= chip(s, 1 / 8);
      if (s.seeded && !mg) { const d = Math.min(s.hp, chip(s, 1 / 8)); s.hp -= d; o.hp = Math.min(o.maxhp, o.hp + d); }
      if (s.status === 'psn' || s.status === 'tox') {
        if (s.ability === 'poisonheal') s.hp = Math.min(s.maxhp, s.hp + s.maxhp / 8);
        else if (!mg) { const f = s.status === 'tox' ? Math.min(15, s.toxN || 1) / 16 : 1 / 8; s.hp -= chip(s, f) * (s.statusProb || 1); if (s.status === 'tox') s.toxN = (s.toxN || 1) + 1; }
      }
      if (s.status === 'brn' && !mg) s.hp -= chip(s, s.ability === 'heatproof' ? 1 / 32 : 1 / 16) * (s.statusProb || 1);
      if (s.saltcure && !mg) s.hp -= chip(s, types.includes('Water') || types.includes('Steel') ? 1 / 4 : 1 / 8);
      if (s.cursed && !mg) s.hp -= chip(s, 1 / 4);
      if (s.ability === 'speedboost') s.boosts.spe = clampBoost(s.boosts.spe + 1);
      if (!s.status && s.item === 'Flame Orb' && this.canStatus(st, i, 'brn')) s.status = 'brn';
      if (!s.status && s.item === 'Toxic Orb' && this.canStatus(st, i, 'tox')) { s.status = 'tox'; s.toxN = 1; }
      for (const c of ['reflect', 'lightscreen', 'auroraveil', 'tailwind', 'taunt', 'encore']) if (s[c] > 0) s[c]--;
      if (s.lockTurns > 0 && --s.lockTurns === 0 && !/^Choice/.test(s.item)) s.lock = '';
    }
    if (st.weatherTurns > 0 && st.weatherTurns < 90 && --st.weatherTurns === 0) st.weather = '';
    if (st.terrainTurns > 0 && st.terrainTurns < 90 && --st.terrainTurns === 0) st.terrain = '';
    if (st.tr > 0) st.tr--;
  }

  order(st, a0, a1, ctx) {
    const p0 = this.priority(st, 0, a0), p1 = this.priority(st, 1, a1);
    if (p0 !== p1) return p0 > p1 ? 0 : 1;
    const s0 = this.speed(st, 0, ctx.species, ctx.baseSpe), s1 = this.speed(st, 1, ctx.species, ctx.baseSpe);
    if (s0 !== s1) return s0 > s1 ? 0 : 1;
    return 1 - this.me; // pessimistic tie: opponent first
  }

  rollout(st0, a, b, ctx, horizon = 24) {
    const st = this.clone(st0);
    const me = this.me;
    const acts = me === 0 ? [a, b] : [b, a];
    this.turn(st, acts, ctx, this.order(st, acts[0], acts[1], ctx));
    while (st.s[0].hp > 0 && st.s[1].hp > 0 && st.t < horizon) {
      const g0 = this.greedy(st, 0, ctx), g1 = this.greedy(st, 1, ctx);
      this.turn(st, [g0, g1], ctx, this.order(st, g0, g1, ctx));
    }
    const mine = st.s[me], foe = st.s[1 - me];
    const mf = Math.max(0, mine.hp) / mine.maxhp, ff = Math.max(0, foe.hp) / foe.maxhp;
    if (mine.hp <= 0 && foe.hp <= 0) return 0;
    if (foe.hp <= 0) return 1 + 0.3 * mf - 0.004 * st.t;
    if (mine.hp <= 0) return -1 - 0.3 * ff + 0.004 * st.t;
    return 0.6 * (mf - ff);
  }

  // ------------------------------------------------------------------ public entry
  choose(request) {
    const act = request.active && request.active[0];
    if (!act) return 'default';
    const legalSlots = act.moves.map((m, idx) => ({ id: m.id, idx: idx + 1, disabled: m.disabled || (m.pp === 0 && m.maxpp) })).filter((m) => !m.disabled);
    if (!legalSlots.length) return 'default';
    if (act.trapped && legalSlots.length === 1) return `move ${legalSlots[0].idx}`;
    if (legalSlots.length === 1) return `move ${legalSlots[0].idx}${this.transformFlag(act)}`;
    this.willMega = [0, 1].map((i) => {
      const r = i === this.me ? request : this.side(i).activeRequest;
      const a = r && r.active && r.active[0];
      return !!(a && (a.canMegaEvo || a.canUltraBurst));
    });
    const st = this.snapshot(request);
    const species = [0, 1].map((i) => this.speciesFor(i, this.willMega[i]));
    const ctx = this.buildCtx(st, species, legalSlots.map((m) => m.id), this.willMega);
    this.ctx = ctx;
    const foeOptions = ctx.legal[1 - this.me];
    // fast path: a guaranteed KO that is certain to land before the opponent can act
    {
      const foe = st.s[1 - this.me];
      const foeMaxPrio = Math.max(...foeOptions.map((m) => this.priority(st, 1 - this.me, m)));
      const iFaster = this.speed(st, this.me, species, ctx.baseSpe) > this.speed(st, 1 - this.me, species, ctx.baseSpe);
      const shielded = (foe.hp >= foe.maxhp && (foe.item === 'Focus Sash' || foe.ability === 'sturdy')) || foe.disguise || foe.sub > 0;
      if (!shielded && st.s[this.me].status !== 'par' && !st.s[this.me].status.startsWith('slp') && st.s[this.me].status !== 'frz') {
        let pick = null;
        for (const slot of legalSlots) {
          const m = slot.id;
          if (ctx.roles[m] !== 'attack' || ctx.acc[this.me][m] < 1 || ctx.firstOnly[m] && !st.s[this.me].firstTurn) continue;
          if (m === 'suckerpunch' || m === 'thunderclap' || dex.moves.get(m).flags.charge) continue;
          const pr = this.priority(st, this.me, m);
          if (!(pr > foeMaxPrio || (pr === foeMaxPrio && iFaster))) continue;
          if (this.damage(st, this.me, m, species).min >= foe.hp) { pick = slot; break; }
        }
        if (pick) return `move ${pick.idx}${this.transformFlag(act)}`;
      }
    }
    const foeGreedy = this.greedy(st, 1 - this.me, ctx);
    let best = null, bestScore = -Infinity;
    for (const slot of legalSlots) {
      const m = slot.id;
      if (ctx.roles[m] === undefined) ctx.roles[m] = moveRole(m) || 'other';
      let worst = Infinity, vsGreedy = 0;
      for (const r of foeOptions) {
        const v = this.rollout(st, m, r, ctx);
        if (r === foeGreedy) vsGreedy = v;
        if (v < worst) worst = v;
      }
      let score = 0.65 * vsGreedy + 0.35 * worst;
      if (ctx.roles[m] === 'attack') score += 1e-4 * this.damage(st, this.me, m, species).exp / st.s[1 - this.me].maxhp;
      if (process.env.AI_DEBUG) console.log(`  [AI p${this.me + 1} t${this.battle.turn}] ${m}: greedyReply=${foeGreedy} vsGreedy=${vsGreedy.toFixed(3)} worst=${worst.toFixed(3)}`);
      if (score > bestScore) { bestScore = score; best = slot; }
    }
    return `move ${best.idx}${this.transformFlag(act)}`;
  }

  transformFlag(act) {
    if (act.canMegaEvo) return ' mega';
    if (act.canUltraBurst) return ' ultra';
    return '';
  }

  buildCtx(st, species, myLegal, willMega) {
    const me = this.me;
    const ctx = { species, physical: [], roles: {}, acc: [{}, {}], legal: [[], []], firstOnly: {}, types: [], abilities: [], baseSpe: [0, 0], foeAtkStat: [0, 0] };
    ctx.baseSpe.parApplied = [false, false];
    ctx.baseSpe.weatherApplied = [false, false];
    for (let i = 0; i < 2; i++) {
      const p = this.poke(i);
      const willM = willMega[i];
      const sp = dex.species.get(species[i]);
      ctx.types[i] = willM ? sp.types : p.getTypes();
      ctx.abilities[i] = st.s[i].ability;
      if (willM) {
        const mon = this.calcMon(i, st.s[i], species[i]);
        ctx.baseSpe[i] = mon.rawStats.spe;
      } else {
        // modified (item/ability/paralysis) but unboosted speed from the engine
        ctx.baseSpe[i] = p.getStat('spe', true, false);
        ctx.baseSpe.parApplied[i] = st.s[i].status === 'par';
        ctx.baseSpe.weatherApplied[i] = true;
      }
      ctx.foeAtkStat[i] = p.getStat('atk', true, true);
      const legal = i === me ? myLegal : p.moveSlots.filter((m) => m.pp > 0 && !m.disabled).map((m) => m.id);
      ctx.legal[i] = legal.length ? legal : ['struggle'];
      for (const id of ctx.legal[i]) {
        const mv = dex.moves.get(id);
        ctx.roles[id] = moveRole(id) || (mv.category !== 'Status' ? 'attack' : 'other');
        let acc = mv.accuracy === true ? 1 : mv.accuracy / 100;
        const ab = st.s[i].ability, oab = st.s[1 - i].ability;
        if (ab === 'noguard' || oab === 'noguard') acc = 1;
        else {
          if (ab === 'compoundeyes') acc = Math.min(1, acc * 1.3);
          if (ab === 'hustle' && mv.category === 'Physical') acc *= 0.8;
          if ((id === 'thunder' || id === 'hurricane') && (st.weather === 'raindance' || st.weather === 'primordialsea')) acc = 1;
          if (id === 'blizzard' && (st.weather === 'snowscape' || st.weather === 'hail')) acc = 1;
          if (id === 'toxic' && ctx.types[i] && ctx.types[i].includes('Poison')) acc = 1;
          const ev = (st.s[1 - i].boosts.evasion || 0), ac = (st.s[i].boosts.accuracy || 0);
          if (mv.accuracy !== true && (ev || ac)) acc *= stageMult(clampBoost(ac - ev)) ;
          acc = Math.min(1, acc);
        }
        ctx.acc[i][id] = acc;
        if (id === 'fakeout' || id === 'firstimpression' || id === 'matblock') ctx.firstOnly[id] = true;
      }
    }
    ctx.eff = (type, defender) => {
      if (!type) return 1;
      const types = ctx.types[defender];
      if (!dex.getImmunity(type, types)) return 0;
      return Math.pow(2, dex.getEffectiveness(type, types));
    };
    return ctx;
  }
}

module.exports = { BattleAI };
