'use strict';
// Central, versioned ruleset. Every battle in the project uses exactly these settings.
module.exports = {
  // Pokémon Showdown format used for mechanics. Gen 9 engine with National Dex elements
  // (Mega Evolution, Primal Reversion, Ultra Burst, past-generation moves and items).
  engineFormat: 'gen9nationaldexag',
  // Validation format: National Dex AG legality + Smogon 1v1-style clauses.
  validatorFormat: 'gen9nationaldexag@@@OHKO Clause,Evasion Clause,Sleep Moves Clause,Accuracy Moves Clause,+Future',
  level: 100,
  turnLimit: 100,            // battles reaching this many turns are recorded as draws
  // Moves / items / abilities removed for fairness (luck-based or ruleset clauses).
  // Ruleset bans (luck-based or degenerate in 1v1). The Showdown validator additionally enforces
  // OHKO / Evasion / Sleep Moves / Accuracy Moves clauses listed in validatorFormat.
  bannedMoves: [
    'fissure', 'sheercold', 'guillotine', 'horndrill',
    'doubleteam', 'minimize',
    'spore', 'sleeppowder', 'hypnosis', 'lovelykiss', 'sing', 'grasswhistle', 'darkvoid', 'yawn',
    'perishsong',   // guarantees a draw in 1v1 rather than deciding the battle
  ],
  bannedItems: ['brightpowder', 'laxincense', 'kingsrock', 'razorfang', 'quickclaw', 'focusband'],
  bannedAbilities: ['moody', 'sandveil', 'snowcloak'],
  // Default tournament parameters (overridable on the CLI).
  seed: 20261124,
  battlesPerMatchup: 2,      // side-swapped pair; increase for lower variance
};
