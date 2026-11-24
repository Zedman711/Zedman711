# Methodology, assumptions and limitations

This document describes exactly how the Pokémon Battle Lab decides which Pokémon is strongest, and what that answer does and does not mean.

## 1. Question being answered

> If every Pokémon battled every other Pokémon 1v1, under one fair and standardized competitive ruleset, each using its own best legal build and played competently by both sides, which Pokémon would win the most and rate highest?

The format is **1v1 singles**: one Pokémon per side, no switching. This is the only format in which "Pokémon A vs Pokémon B" is well defined. Team formats (6v6, doubles) measure team synergy and are a different question.

## 2. Data sources and engine

| Component | Source |
|---|---|
| Pokédex, stats, types, abilities, learnsets, items, move data | Pokémon Showdown (`pokemon-showdown` npm package, version pinned in `package-lock.json`) |
| Battle mechanics | Pokémon Showdown simulator (`sim/battle.ts`), the engine used by the Smogon competitive ladder |
| Set legality | Pokémon Showdown `TeamValidator` |
| Damage estimates used by the AI | `@smogon/calc`, the standard competitive damage calculator |
| Curated sets | Showdown's Smogon-maintained 1v1 factory sets and Gen 7–9 random-battle move pools |
| Sprites (dashboard only) | play.pokemonshowdown.com sprite CDN |

No stat, ability or move effect is written by hand. The project's own code only builds candidate sets, chooses moves during battle, and does bookkeeping.

PokéAPI was considered. Showdown's data was used instead because it is the same data the battle engine executes, so the Pokédex and the mechanics cannot disagree. It also already contains the Legends Z‑A and Mega Dimension Megas.

## 3. Roster (`src/roster.js`, `data/roster.json`)

The roster has **1,275 entrants**: every species with a National Dex number (#1–#1025), plus:

* regional forms (Alolan, Galarian, Hisuian, Paldean): 57
* Mega Evolutions, including the Legends Z‑A / Mega Dimension Megas: 97
* Primal Kyogre and Primal Groudon, Ultra Necrozma, Crowned Zacian and Zamazenta
* Origin Giratina, Dialga and Palkia, Therian formes, all 18 Arceus and Silvally types, Ogerpon masks, Rotom appliances, Urshifu styles, Calyrex riders and every other form with different battle data
* every legendary (121) and mythical (55) Pokémon
* every unevolved, NFE and "weak" Pokémon (Magikarp, Unown, Cosmog, Sunkern and so on)

Excluded, with the reason recorded in `data/roster-excluded.json`:

* fan-made CAP Pokémon and the Let's Go-only Partner starters
* Totem Pokémon, which duplicate their normal forms
* Gigantamax and Eternamax forms (no Dynamax), and Tera-only forms of Ogerpon and Terapagos (no Terastallization)
* forms that only exist mid-battle (Aegislash-Blade, Mimikyu-Busted, Darmanitan-Zen, Minior-Meteor, Wishiwashi-School and similar). The base entrant reaches them naturally during its battles.

Forms with identical types and base stats whose abilities are a subset of an earlier form are merged into it, because they would be the same fighter. Examples are the Pikachu caps, Vivillon patterns, Alcremie flavors and Minior cores. The merged names are listed in each entrant's `mergedFormes`.

A Mega, Primal or Ultra Burst entrant starts as its base form holding its stone, orb or crystal, and transforms on turn 1. That is how they exist in a real battle.

## 4. Ruleset (`src/config.js`)

* Gen 9 mechanics with National Dex elements (Showdown format `gen9nationaldexag`): Mega Evolution, Primal Reversion and Ultra Burst are allowed, and so are past-generation moves and items.
* Level 100, 31 IVs (0 Attack IV on purely special sets), legal natures, 252/252/4-style EVs.
* No Terastallization, Dynamax or Z-Moves. The one exception is the Ultranecrozium Z, which Ultra Burst requires. Its Z-Move is never selected.
* Smogon 1v1 clauses: OHKO Clause, Evasion Clause, Sleep Moves Clause, Accuracy Moves Clause. Perish Song is also banned because in 1v1 it only produces draws. The luck items Bright Powder, Lax Incense, King's Rock, Razor Fang, Quick Claw and Focus Band are banned, and so are the abilities Moody, Sand Veil and Snow Cloak.
* 100-turn limit. A battle still undecided after 100 turns is a draw.

## 5. Builds: "best legitimate competitive set" (`src/setbuilder.js`, `src/qualify.js`)

There is no single objectively optimal set, so sets are **chosen empirically**:

1. **Candidate generation.** Each entrant gets a set of legal builds (10.4 on average) covering the standard 1v1 archetypes:
   * Choice Band or Specs attacker
   * Choice Scarf attacker
   * Life Orb attacker
   * Focus Sash attacker
   * setup sweeper, with Leftovers, Life Orb, Weakness Policy or Focus Sash variants
   * bulky attacker with recovery and status
   * Counter / Mirror Coat / Endeavor with Sash or Sturdy
   * Smogon-curated 1v1 sets and random-battle move pools, where they exist

   Moves are picked by coverage optimization against the type distribution of the whole roster. The scoring accounts for STAB, ability multipliers, accuracy, multi-hit moves and drawbacks. Signature items are respected (Light Ball, Thick Club, Eviolite on NFEs, orbs for Guts or Poison Heal, Booster Energy). The top one or two abilities are each tried. Every candidate passes Showdown's validator. The exceptions are a few official forms the validator does not support (Floette-Eternal, Floette-Mega, Gimmighoul-Roaming, Magearna-Original-Mega), which use their own move pools and are marked `unvalidated`.
2. **Benchmark gauntlet.** 40 entrants are drawn with a fixed seed, 8 from each base-stat-total quintile, so the gauntlet represents the whole field. Gauntlet members first qualify against each other to fix their own builds.
3. **Qualification.** Each entrant's candidates fight 20 gauntlet members, twice each with player slots swapped. The top 3 candidates then fight the other 20. The candidate with the highest combined score becomes the tournament set. `data/qualification-report.json` lists every candidate's score.

## 6. Battle AI (`src/ai.js`)

Both sides use the same AI and know each other's set (open team sheets). Each turn it:

1. reads the true state from the Showdown engine: HP, boosts, status, item, ability, weather, terrain, screens, choice lock and other volatile effects
2. computes expected, minimum and maximum damage for every move of both Pokémon with `@smogon/calc` under that state, and recalculates for every hypothetical state it explores (cached)
3. for each of its legal moves, and each opponent reply, plays the next turns forward in an expected-value model. The model covers:
   * turn order from priority (including Prankster, Gale Wings, Triage and Grassy Glide), speed, Trick Room, Tailwind, paralysis and weather speed abilities
   * accuracy, recoil, drain, Life Orb, Rocky Helmet, Rough Skin and Iron Barbs
   * Focus Sash, Sturdy, Disguise, Multiscale, Substitute and Weakness Policy
   * burn, poison, Toxic, Leech Seed, Salt Cure, sandstorm, Leftovers, Black Sludge, Grassy Terrain, Poison Heal and Speed Boost
   * setup moves, recovery (with weather-dependent amounts), Protect, Counter-family moves, Encore, Taunt, Trick, Haze, screens, weather, terrain and Trick Room
   * Sucker Punch conditions and Fake Out on the first turn only

   During the look-ahead both sides follow a competent policy: take a guaranteed KO, recover when it out-heals the incoming damage, set up when it is safe and actually speeds up the KO, inflict status in long fights, and otherwise use the strongest attack.
4. picks the move with the best blend of expected outcome against the opponent's likely reply (65%) and worst case over all replies (35%). A guaranteed, uncontestable KO is taken immediately.

The model is only used to choose moves. Every battle is resolved by the Showdown engine with its real damage rolls, critical hits, secondary effects and accuracy checks.

## 7. Tournament (`src/tournament.js`)

* All 812,175 unordered pairs are played. Each pair plays `battlesPerMatchup` battles (default 2) with the player slots swapped, so neither Pokémon benefits from engine slot order. Each battle has an independent seed: `seedFor(masterSeed, i, j, k)`.
* The work is split into rows (entrant *i* against all *j* > *i*) and run on all CPU cores with worker threads. Each finished row is written to `results/rows/<i>.json`. Rerunning the command resumes where it stopped.
* `results/manifest.json` pins the seed, battle count, set-file hash and engine versions. A mismatching rerun refuses to mix results.
* **Reproducibility.** Any battle can be replayed exactly (`/api/replay`, or `runBattle(set_i, set_j, seedFor(seed, i, j, k))`). The same seed and versions give identical results.

## 8. Ratings and statistics (`src/rating.js`)

* **Rating: Bradley–Terry**, the maximum-likelihood, order-independent version of Elo. It is fitted by the MM algorithm on every battle. A draw counts as half a win, and one virtual draw against an average opponent acts as a weak prior. Ratings are on the Elo scale (mean 1500, 400 points = 10:1 odds). The 95% interval comes from the Fisher information. Unlike sequential Elo, the result does not depend on the order battles were played. Because every pair meets, opponent strength is fully accounted for.
* **Separation of #1.** For the top entrant against #2 to #6, the summary reports the Elo gap, a z-score and their head-to-head record. A z-score below about 2 means the gap is within statistical noise.
* **Standard (restricted) ranking.** The Bradley–Terry model is refitted using only battles among entrants that are neither restricted legendaries nor mythicals, including their Megas and Primals. This answers "strongest in a standard format" without the restricted Pokémon distorting it.
* **Per-entrant statistics:**
  * wins, losses, draws, battles and win %
  * matchups won, lost or split
  * clean-sweep rate
  * average battle length
  * win % against each generation and each type
  * win % against legendaries, restricted legendaries, mythicals, Megas and the top 100
  * best wins and worst losses
* **Leaderboards:**
  * overall
  * standard format
  * non-legendary (excludes legendaries and mythicals; Ultra Beasts and Paradox Pokémon count as non-legendary, as they do officially)
  * legendary
  * mythical
  * Mega
  * regional form
  * each generation (by National Dex number, so Mega Charizard is Gen 1)
  * **most consistent:** the highest *worst* win % across the 18 opponent types, meaning no exploitable type weakness
  * highest win %
  * **biggest upsets:** matchups won by the entrant rated at least 150 Elo lower, ranked by rating gap

## 9. Assumptions and limitations

* **1v1 only.** The ranking measures how strong a Pokémon is on its own. Support Pokémon built for teams (hazard setters, pivots, Intimidate, Regenerator, redirection) are undervalued.
* **The AI is strong but not perfect.** It does not hide information or predict mind games (every set is visible to both sides), and its look-ahead is a heuristic expected-value model rather than a full game-tree search. Strategies that rely on reacting to the opponent (Counter, Destiny Bond, Protect stalling) may be over- or under-rated relative to expert human play.
* **One build per Pokémon in the tournament.** It is the best of about 10 candidates against a 40-Pokémon gauntlet, not a proven optimum. A rare matchup-specific set could beat it.
* **Randomness.** With 2 battles per matchup, single head-to-head records are noisy, for example when a 30% critical-hit or miss chance decides a battle. Aggregate ratings are very stable, because each entrant plays about 2,550 battles. Use `--battles=6` or more for tighter head-to-heads.
* **Mechanics coverage** is whatever Pokémon Showdown implements, which is the most complete public implementation. Some Legends Z‑A Megas are flagged "Future" in Showdown's data. They battle with Showdown's implementation of their official stats and abilities, but their sets could not be checked by the validator.
* **Excluded mechanics:** Terastallization, Dynamax and Z-Moves, chosen so that "the Pokémon" is what is being measured rather than a battle gimmick. Mega Evolution, Primal Reversion and Ultra Burst are included because they produce distinct official battle forms.

* **Post-run correction (Truant).** Checking the upsets list showed that the AI did not model Truant, the ability that makes Slakoth and Slaking skip every other turn. Opponents facing Sash + Counter Slakoth stalled instead of attacking on its loafing turns. After the fix (`src/ai.js`), Slakoth and Slaking were re-qualified and all 5,096 tournament battles involving them were replayed. No gauntlet member has Truant and the AI change is inert in every other battle, so all other results stand unchanged. A replay of a random sample of 297 other matchups matched the stored results exactly. `results/manifest.json` records the patch.
* **No draws occurred.** Under the clauses above, every battle ended within the 100-turn limit, and stalemates were settled by PP exhaustion and Struggle, as in the real games.

## 10. Reproducing

```bash
npm install
./run-all.sh                       # roster → qualification → tournament → ratings (resumable)
node src/server.js                 # dashboard at http://localhost:8080
# options: --seed=N  --battles=N  --workers=N
```
