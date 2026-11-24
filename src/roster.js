'use strict';
// Builds the complete entrant list (data/roster.json) from Pokémon Showdown's Pokédex.
//
// Inclusion rules (documented in docs/METHODOLOGY.md):
//  * every species/forme with a National Dex number, from all 9 generations
//  * regional forms, Megas (incl. Legends Z-A / Mega Dimension Megas), Primals, Ultra Necrozma,
//    Crowned Zacian/Zamazenta, Origin formes, Arceus/Silvally types, Ogerpon masks, etc.
//  * excluded: CAP/fan-made, Let's Go-only starters, Totem duplicates, Gigantamax/Eternamax
//    (no Dynamax), Ogerpon/Terapagos Tera-only formes (no Terastallization), and formes that
//    only exist mid-battle (Aegislash-Blade, Mimikyu-Busted, ... — those are reached naturally
//    by the base entrant during battle).
//  * a forme whose types and base stats equal an earlier entrant's and whose abilities are a
//    subset of it (e.g. Pikachu-Original vs Pikachu) is a strict duplicate and is merged.
const fs = require('fs');
const path = require('path');
const { dex, toID, generationOfNum } = require('./dex');

const REGIONS = ['Alola', 'Galar', 'Hisui', 'Paldea'];

function buildRoster() {
  const all = dex.species.all().filter((s) => s.exists && s.num > 0);
  const out = [];
  const excluded = [];
  const seenKey = new Map();
  // base formes first so duplicates collapse onto the canonical forme
  all.sort((a, b) => a.num - b.num || (a.forme ? 1 : 0) - (b.forme ? 1 : 0));
  for (const s of all) {
    const why = exclusionReason(s);
    if (why) { excluded.push({ name: s.name, reason: why }); continue; }

    let setSpecies = [s.name];
    let transform = null;
    if (s.battleOnly) {
      setSpecies = Array.isArray(s.battleOnly) ? s.battleOnly.slice() : [s.battleOnly];
      if (s.isMega) transform = 'mega';
      else if (s.name === 'Necrozma-Ultra') transform = 'ultra';
      // Primal Reversion, Crowned formes: automatic on entry with the required item.
    }
    if (s.name === 'Zygarde-Mega') setSpecies = ['Zygarde'];
    let forcedItem = null;
    if (s.requiredItem) forcedItem = s.requiredItem;
    else if (s.requiredItems) forcedItem = s.requiredItems.find((i) => !dex.items.get(i).zMove) || s.requiredItems[0];
    if (s.name === 'Greninja-Bond' || s.name === 'Zygarde-Complete') forcedItem = null;

    const abilities = [...new Set(Object.values(s.abilities))];
    const key = JSON.stringify([s.types, s.baseStats]);
    const prev = seenKey.get(key);
    if (prev && !forcedItem && !s.requiredMove && abilities.every((a) => prev.abilities.includes(a)) && prev.baseSpecies === s.baseSpecies) {
      prev.mergedFormes.push(s.name);
      continue;
    }

    const tags = s.tags || [];
    const entry = {
      id: toID(s.name),
      name: s.name,
      baseSpecies: s.baseSpecies,
      forme: s.forme || '',
      setSpecies,
      transform,
      forcedItem,
      requiredMove: s.requiredMove || null,
      num: s.num,
      generation: generationOfNum(s.num),
      formeGeneration: s.gen,
      types: s.types,
      baseStats: s.baseStats,
      bst: s.bst,
      abilities,
      legendary: tags.includes('Restricted Legendary') || tags.includes('Sub-Legendary'),
      restricted: tags.includes('Restricted Legendary'),
      mythical: tags.includes('Mythical'),
      ultraBeast: tags.includes('Ultra Beast'),
      paradox: tags.includes('Paradox'),
      mega: !!s.isMega,
      primal: !!s.isPrimal,
      regional: REGIONS.some((r) => (s.forme || '').includes(r)),
      fullyEvolved: !s.nfe,
      natDexTier: s.natDexTier || s.tier || '',
      spriteid: s.spriteid,
      mergedFormes: [],
    };
    seenKey.set(key, entry);
    out.push(entry);
  }
  return { roster: out, excluded };
}

function exclusionReason(s) {
  if (['CAP', 'Custom', 'LGPE'].includes(s.isNonstandard)) return `non-official (${s.isNonstandard})`;
  if (/Totem/.test(s.forme)) return 'Totem duplicate';
  if (/Gmax|Eternamax/.test(s.forme)) return 'Dynamax/Gigantamax not used';
  if (/-Tera$|Terastal|Stellar/.test(s.name)) return 'Terastallization not used';
  if (s.battleOnly && !s.isMega && !s.isPrimal && !['Necrozma-Ultra', 'Zacian-Crowned', 'Zamazenta-Crowned'].includes(s.name)) {
    return 'mid-battle forme (reached by its base entrant)';
  }
  return null;
}

if (require.main === module) {
  const { roster, excluded } = buildRoster();
  fs.writeFileSync(path.join(__dirname, '../data/roster.json'), JSON.stringify(roster, null, 1));
  fs.writeFileSync(path.join(__dirname, '../data/roster-excluded.json'), JSON.stringify(excluded, null, 1));
  const c = (f) => roster.filter(f).length;
  console.log(`entrants: ${roster.length} (excluded ${excluded.length})`);
  console.log(`megas ${c((r) => r.mega)}, primals ${c((r) => r.primal)}, regional ${c((r) => r.regional)}, legendary ${c((r) => r.legendary)}, mythical ${c((r) => r.mythical)}`);
}
module.exports = { buildRoster };
