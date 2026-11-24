# Pokémon Battle Lab

Every Pokémon fights every other Pokémon in simulated 1v1 battles on the **Pokémon Showdown** battle engine. The results produce a rating-based answer to *"which Pokémon is strongest?"*

* **1,275 entrants:** every species #1–#1025, plus regional forms, Megas (including the Legends Z‑A / Mega Dimension Megas), Primals, Ultra Necrozma, Crowned Zacian and Zamazenta, Origin formes, Arceus and Silvally types, and all legendaries and mythicals.
* **812,175 matchups × 2 battles = 1,624,350 battles**, played with player slots swapped, under one ruleset: level 100, Gen 9 National Dex mechanics and Smogon 1v1 clauses.
* **Best legal build per Pokémon, chosen empirically:** about 10 validated candidate sets each, tested against a 40-Pokémon benchmark gauntlet.
* **Competitive AI for both sides:** `@smogon/calc` damage estimates plus a look-ahead model that covers setup, recovery, status, Sash/Sturdy, Counter, weather, screens, Trick Room and more.
* **Bradley–Terry (Elo-scale) ratings** with 95% intervals, a separate standard-format ranking, and per-generation, per-type and anti-legendary statistics.
* **Resumable, parallel and reproducible:** every battle can be replayed exactly from its seed.

<!-- RESULTS -->

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
