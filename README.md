# Pokémon Battle Lab

Every Pokémon fights every other Pokémon in simulated 1v1 battles on the **Pokémon Showdown** battle engine. The results produce a rating-based answer to *"which Pokémon is strongest?"*

* **1,275 entrants:** every species #1–#1025, plus regional forms, Megas (including the Legends Z‑A / Mega Dimension Megas), Primals, Ultra Necrozma, Crowned Zacian and Zamazenta, Origin formes, Arceus and Silvally types, and all legendaries and mythicals.
* **812,175 matchups × 2 battles = 1,624,350 battles**, played with player slots swapped, under one ruleset: level 100, Gen 9 National Dex mechanics and Smogon 1v1 clauses.
* **Best legal build per Pokémon, chosen empirically:** about 10 validated candidate sets each, tested against a 40-Pokémon benchmark gauntlet.
* **Competitive AI for both sides:** `@smogon/calc` damage estimates plus a look-ahead model that covers setup, recovery, status, Sash/Sturdy, Counter, weather, screens, Trick Room and more.
* **Bradley–Terry (Elo-scale) ratings** with 95% intervals, a separate standard-format ranking, and per-generation, per-type and anti-legendary statistics.
* **Resumable, parallel and reproducible:** every battle can be replayed exactly from its seed.

## Results (seed 20261124, 1,624,350 battles, 0 draws)

**Champion: Primal Groudon.** Elo 2028 ±27, and it won 92.8% of its 2,548 battles. Its tournament build is Red Orb, Careful nature, 252 HP / 252 SpD, with Rock Polish, Precipice Blades and Heat Crash.

It is **statistically tied with Primal Kyogre**: Groudon leads by 18 Elo, z = 0.93, and Kyogre won their head-to-head 2–0. Together the two Primals are clearly ahead of everything else:

* Crowned Zamazenta, the next entrant, is 53 Elo behind Groudon (z = 2.8).
* Lugia, Water Arceus and Rayquaza are 64–67 Elo behind (z ≈ 3.5).

The simulation's answer is therefore **"the Primals, with Groudon nominally first."**

### Overall top 20

| # | Pokémon | Elo (95%) | Win % | W-L-D | Build |
|---|---|---|---|---|---|
| 1 | Groudon-Primal | 2028 ±27 | 92.78% | 2364-184-0 | Random-battle pool: Bulky Setup |
| 2 | Kyogre-Primal | 2010 ±26 | 92.11% | 2347-201-0 | Random-battle pool: Bulky Attacker |
| 3 | Zamazenta-Crowned | 1975 ±24 | 90.66% | 2310-238-0 | Random-battle pool: Bulky Setup |
| 4 | Lugia | 1964 ±24 | 90.15% | 2297-251-0 | Setup sweeper |
| 5 | Arceus-Water | 1963 ±24 | 90.11% | 2296-252-0 | Random-battle pool: Bulky Support |
| 6 | Rayquaza | 1961 ±24 | 89.99% | 2293-255-0 | Sash attacker |
| 7 | Kyogre | 1948 ±23 | 89.4% | 2278-270-0 | Random-battle pool: Bulky Attacker |
| 8 | Miraidon | 1941 ±23 | 89.05% | 2269-279-0 | Random-battle pool: Fast Attacker |
| 9 | Rayquaza-Mega | 1939 ±23 | 88.93% | 2266-282-0 | Sash attacker |
| 10 | Eternatus | 1935 ±22 | 88.7% | 2260-288-0 | Random-battle pool: Bulky Attacker |
| 11 | Arceus-Ghost | 1930 ±22 | 88.46% | 2254-294-0 | Bulky attacker |
| 12 | Arceus-Fairy | 1928 ±22 | 88.34% | 2251-297-0 | Life Orb attacker |
| 13 | Arceus-Poison | 1927 ±22 | 88.3% | 2250-298-0 | Bulky attacker |
| 14 | Kangaskhan-Mega | 1926 ±22 | 88.23% | 2248-300-0 | Random-battle pool: Fast Support |
| 15 | Necrozma-Dusk-Mane | 1926 ±22 | 88.23% | 2248-300-0 | Bulky attacker |
| 16 | Koraidon | 1919 ±22 | 87.87% | 2239-309-0 | Sash attacker |
| 17 | Dialga-Origin | 1916 ±22 | 87.68% | 2234-314-0 | Random-battle pool: Bulky Attacker |
| 18 | Palkia | 1915 ±22 | 87.64% | 2233-315-0 | Bulky attacker |
| 19 | Mewtwo-Mega-Y | 1914 ±22 | 87.56% | 2231-317-0 | Bulky attacker |
| 20 | Lunala | 1910 ±22 | 87.36% | 2226-322-0 | Random-battle pool: Bulky Attacker |

### Standard format: no restricted legendaries or mythicals

Mega Kangaskhan is the standard-format champion, 67 Elo clear of Archaludon. Parental Bond doubles every hit and breaks Focus Sash and Sturdy, which are central to 1v1.

| # | Pokémon | Standard Elo | Win % (all battles) |
|---|---|---|---|
| 1 | Kangaskhan-Mega | 1959 | 88.23% |
| 2 | Archaludon | 1892 | 84.5% |
| 3 | Gardevoir-Mega | 1875 | 83.52% |
| 4 | Suicune | 1865 | 83.71% |
| 5 | Porygon2 | 1859 | 83.24% |
| 6 | Delphox-Mega | 1857 | 82.42% |
| 7 | Froslass-Mega | 1855 | 81.44% |
| 8 | Blastoise-Mega | 1842 | 81.12% |
| 9 | Metagross-Mega | 1842 | 80.22% |
| 10 | Latios-Mega | 1837 | 80.73% |

### Non-legendary (Ultra Beasts and Paradox Pokémon count as non-legendary)

| # | Pokémon | Elo | Win % |
|---|---|---|---|
| 1 | Kangaskhan-Mega | 1926 | 88.23% |
| 2 | Archaludon | 1864 | 84.5% |
| 3 | Gardevoir-Mega | 1849 | 83.52% |
| 4 | Porygon2 | 1845 | 83.24% |
| 5 | Delphox-Mega | 1834 | 82.42% |
| 6 | Froslass-Mega | 1820 | 81.44% |
| 7 | Blastoise-Mega | 1816 | 81.12% |
| 8 | Staraptor-Mega | 1813 | 80.89% |
| 9 | Charizard-Mega-X | 1810 | 80.65% |
| 10 | Gouging Fire | 1806 | 80.3% |

### Other leaderboards

| Board | Top 3 |
|---|---|
| Legendary | Groudon-Primal, Kyogre-Primal, Zamazenta-Crowned |
| Mythical | Arceus-Water, Arceus-Ghost, Arceus-Fairy |
| Mega | Rayquaza-Mega, Kangaskhan-Mega, Mewtwo-Mega-Y |
| Regional form | Muk-Alola, Articuno-Galar, Qwilfish-Hisui |
| Most consistent (best worst-type win %) | Rayquaza, Necrozma-Dusk-Mane (75.2%), Kyogre-Primal (74.8%) |
| Lowest rated | Cosmog (0.4% wins), Metapod, Cosmoem |

| Generation | Best three |
|---|---|
| 1 | Kangaskhan-Mega, Mewtwo-Mega-Y, Mewtwo |
| 2 | Lugia, Suicune, Porygon2 |
| 3 | Groudon-Primal, Kyogre-Primal, Rayquaza |
| 4 | Arceus-Water, Arceus-Ghost, Arceus-Fairy |
| 5 | Reshiram, Kyurem-White, Kyurem-Black |
| 6 | Delphox-Mega, Xerneas, Yveltal |
| 7 | Necrozma-Dusk-Mane, Lunala, Melmetal |
| 8 | Zamazenta-Crowned, Eternatus, Zacian-Crowned |
| 9 | Miraidon, Koraidon, Terapagos |

The biggest upsets are almost all real 1v1 mechanics:

* **PP stalling:** Cosmoem's Cosmic Power plus Leftovers outlasts a Choice-locked Celesteela, which runs out of PP and dies to Struggle recoil.
* **Focus Sash + Counter:** Poochyena and Nymble beat Crowned Zacian this way.
* **4× Bug Bite** knocks out Hoopa-Unbound and Exeggutor.

Everything is browsable in the dashboard, and `results/summary.json` holds every statistic. To rebuild the leaderboards from the raw rows, run `tar xzf results/rows.tgz -C results && node src/rating.js`.


## Quick start

```bash
npm install
./run-all.sh            # roster → set qualification → round robin → ratings (resumes if interrupted)
node src/server.js      # dashboard on http://localhost:8080
```

Options for `src/qualify.js` and `src/tournament.js`:

* `--seed=N` sets the master seed (default 20261124).
* `--battles=N` sets battles per matchup (default 2, always played with slots swapped).
* `--workers=N` sets the number of threads.

`node src/rating.js` recomputes leaderboards from whatever rows exist, so it works mid-run.

## Dashboard

* **Leaderboards:**
  * overall
  * standard format (no restricted legendaries or mythicals)
  * non-legendary, legendary, mythical, Mega and regional
  * by generation
  * most consistent
  * highest win %
  * biggest upsets

  Each board can be filtered by type, generation, name and fully-evolved status.
* **Pokémon pages:**
  * rating, record and tournament build
  * win % by opponent generation and type
  * results against legendaries, mythicals and the top 100
  * best wins and worst losses
  * full match history
* **Head-to-head:**
  * tournament record and the rating model's predicted odds
  * exact replay of any tournament battle
  * fresh battles between any two Pokémon on the real engine, with an animated HP and battle-log viewer
* **Live run:** progress, speed and ETA while the tournament runs. Leaderboards refresh about once a minute.

## Architecture

| Stage | File | Output |
|---|---|---|
| Roster from Showdown's Pokédex | `src/roster.js` | `data/roster.json`, `data/roster-excluded.json` |
| Candidate sets (legal, validated) | `src/setbuilder.js`, `src/moveinfo.js` | `data/candidates.json` |
| Set qualification vs gauntlet | `src/qualify.js` | `data/sets.json`, `data/qualification-report.json` |
| Battle runner (Showdown engine) | `src/battle.js` | one battle → winner, turns, log |
| Decision AI (`@smogon/calc` + look-ahead) | `src/ai.js` | a move choice per turn |
| Parallel round robin, resumable | `src/tournament.js`, `src/pool.js`, `src/worker.js` | `results/rows/*.json`, `results/progress.json` |
| Ratings and leaderboards | `src/rating.js` | `results/summary.json`, `results/h2h.bin` |
| Dashboard and battle API | `src/server.js`, `dashboard/` | http://localhost:8080 |

Rules, assumptions and limitations are in **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)**.
