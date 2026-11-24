// Pre-records exact tournament replays for the static dashboard snapshot.
const fs=require('fs');const {runBattle,seedFor}=require('./battle');
const S=require('../data/sets.json');const sum=require('../results/summary.json');const man=require('../results/manifest.json');
const top=sum.leaderboards.overall.slice(0,30);const pairs=new Set();
for(let a=0;a<top.length;a++)for(let b=a+1;b<top.length;b++)pairs.add(Math.min(top[a],top[b])+'-'+Math.max(top[a],top[b]));
for(const u of sum.leaderboards.upsets)pairs.add(Math.min(u.winner,u.loser)+'-'+Math.max(u.winner,u.loser));
const out={};
for(const key of pairs){const [i,j]=key.split('-').map(Number);out[key]=[];
  for(let k=0;k<man.battles;k++){const iF=k%2===0;const p1=iF?i:j,p2=iF?j:i;const r=runBattle(S.sets[p1],S.sets[p2],seedFor(man.seed,i,j,k),{log:true});
    out[key].push({p1:S.ids[p1],p2:S.ids[p2],winner:r.winner===null?null:(r.winner===0?S.ids[p1]:S.ids[p2]),turns:r.turns,log:r.log,seed:[man.seed,i,j,k]});}}
fs.writeFileSync(process.argv[2],JSON.stringify(out));console.log(pairs.size,'pairs');
