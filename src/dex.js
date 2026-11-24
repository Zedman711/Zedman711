'use strict';
// Shared access to the Pokémon Showdown data/engine and @smogon/calc.
const PS = require('pokemon-showdown');
const calc = require('@smogon/calc');
const config = require('./config');

const dex = PS.Dex.forFormat(config.engineFormat);
const calcGen = calc.Generations.get(9);

const toID = (s) => ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');

function generationOfNum(num) {
  const cut = [151, 251, 386, 493, 649, 721, 809, 905, 1025];
  for (let i = 0; i < cut.length; i++) if (num <= cut[i]) return i + 1;
  return 9;
}

module.exports = { PS, dex, calc, calcGen, toID, generationOfNum };
