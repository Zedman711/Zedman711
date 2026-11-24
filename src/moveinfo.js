'use strict';
// Move knowledge shared by the set builder and the battle AI. All numeric move data (power,
// accuracy, priority, boosts, healing, status, recoil, drain, flags) comes from the Pokémon
// Showdown dex; this file only classifies moves into roles the AI knows how to reason about.
const { dex } = require('./dex');
const config = require('./config');

const banned = new Set(config.bannedMoves);

// Status moves the AI models explicitly. Anything else non-damaging is never put in a set.
const SETUP = new Set([
  'swordsdance', 'dragondance', 'bulkup', 'quiverdance', 'nastyplot', 'calmmind', 'shellsmash',
  'shiftgear', 'coil', 'victorydance', 'tailglow', 'geomancy', 'bellydrum', 'tidyup', 'clangoroussoul',
  'filletaway', 'noretreat', 'curse', 'growth', 'workup', 'honeclaws', 'rockpolish', 'agility',
  'autotomize', 'irondefense', 'cottonguard', 'acidarmor', 'cosmicpower', 'defendorder', 'takeheart',
  'howl', 'amnesia', 'barrier', 'stockpile',
]);
const RECOVERY = new Set([
  'recover', 'roost', 'slackoff', 'softboiled', 'milkdrink', 'healorder', 'shoreup', 'moonlight',
  'morningsun', 'synthesis', 'strengthsap', 'rest', 'lunarblessing', 'junglehealing', 'lifedew',
  'painsplit', 'wish', 'floralhealing', 'healpulse',
]);
const STATUSING = new Set(['willowisp', 'thunderwave', 'glare', 'stunspore', 'toxic', 'poisonpowder', 'toxicthread']);
const PROTECT = new Set(['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'silktrap', 'burningbulwark', 'obstruct']);
const UTILITY = new Set([
  'substitute', 'leechseed', 'destinybond', 'encore', 'taunt', 'haze', 'trickroom', 'tailwind',
  'reflect', 'lightscreen', 'auroraveil', 'sunnyday', 'raindance', 'sandstorm', 'snowscape', 'hail',
  'electricterrain', 'grassyterrain', 'psychicterrain', 'mistyterrain', 'counter', 'mirrorcoat',
  'metalburst', 'comeuppance', 'endeavor', 'screech', 'charm', 'featherdance', 'faketears', 'metalsound',
  'eerieimpulse', 'nobleroar', 'tickle', 'trick', 'switcheroo', 'aquaring', 'ingrain', 'disable',
  'saltcure', 'focusenergy', 'transform',
]);
// Damaging moves that are useless or self-defeating in a 1v1 setting (or need a partner/item).
const BAD_ATTACKS = new Set([
  'selfdestruct', 'explosion', 'mistyexplosion', 'memento', 'healingwish', 'lunardance', 'finalgambit',
  'belch', 'dreameater', 'synchronoise', 'lastresort', 'snore', 'spitup', 'naturalgift', 'fling', 'steelroller',
  'beatup', 'present', 'skydrop', 'bide', 'focuspunch', 'hiddenpower', 'terablast', 'magnitude', 'shelltrap',
  'echoedvoice', 'round', 'furycutter', 'rollout', 'iceball', 'trumpcard', 'spitup', 'stompingtantrum',
  'uproar', 'fakeout', 'firstimpression', 'matblock', 'ragefist', 'lastrespects', 'pursuit', 'retaliate',
  'fusionbolt', 'fusionflare', 'risingvoltage', 'expandingforce', 'mistyexplosion', 'grassyglide',
  'electrodrift', 'boltstrike', 'blueflare', 'wringout', 'crushgrip', 'punishment', 'storedpower', 'powertrip',
  'doubleironbash', 'gmaxbefuddle', 'struggle', 'chatter', 'smellingsalts', 'wakeupslap', 'veeveevolley',
  'pikapapow', 'frustration', 'temperflare', 'hyperspacefury', 'futuresight', 'doomdesire',
]);
// re-allow attacks that are fine in 1v1 even though named above for builder reasons
for (const id of ['fusionbolt', 'fusionflare', 'boltstrike', 'blueflare', 'electrodrift', 'storedpower', 'powertrip',
  'hyperspacefury', 'doubleironbash', 'stompingtantrum', 'temperflare', 'risingvoltage', 'expandingforce',
  'grassyglide', 'smellingsalts', 'wringout', 'crushgrip', 'firstimpression', 'fakeout', 'ragefist']) BAD_ATTACKS.delete(id);

const COUNTERS = new Set(['counter', 'mirrorcoat', 'metalburst', 'comeuppance']);

function moveRole(id) {
  const m = dex.moves.get(id);
  if (!m.exists || banned.has(m.id) || m.isZ || m.isMax) return null;
  if (m.category !== 'Status') {
    if (COUNTERS.has(m.id) || m.id === 'endeavor') return 'utility';
    if (BAD_ATTACKS.has(m.id)) return null;
    if (!m.basePower && !m.damage && !m.basePowerCallback && !m.damageCallback) return null;
    return 'attack';
  }
  if (SETUP.has(m.id)) return 'setup';
  if (RECOVERY.has(m.id)) return 'recovery';
  if (STATUSING.has(m.id)) return 'status';
  if (PROTECT.has(m.id)) return 'protect';
  if (UTILITY.has(m.id)) return 'utility';
  return null;
}

module.exports = { moveRole, SETUP, RECOVERY, STATUSING, PROTECT, UTILITY, COUNTERS, BAD_ATTACKS };
