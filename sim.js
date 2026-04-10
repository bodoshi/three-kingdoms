const fs=require('fs');
const html=fs.readFileSync('three-kingdoms-game.html','utf8');

// 提取数据
const charMatch=html.match(/const ALL_CHARS\s*=\s*\[([\s\S]*?)\];/);
const allChars=[];
const cre=/\['([^']+)','([^']+)',(\d+),(\d+),(\d+),(\d+),(\d+),'[^']*'\]/g;
let cm;
while(cm=cre.exec(charMatch[1])) allChars.push({name:cm[1],fac:cm[2],wu:+cm[3],zhi:+cm[4],tong:+cm[5],zheng:+cm[6],mei:+cm[7]});

const counters=[];
const m=html.match(/const COUNTERS\s*=\s*\[([\s\S]*?)\];/);
const re=/\['([^']+)','([^']+)'/g;
let rm;while(rm=re.exec(m[1]))counters.push([rm[1],rm[2]]);

const bonds=[];
const bm=html.match(/const BONDS\s*=\s*\[([\s\S]*?)\];/);
const bre=/\['([^']+)','([^']+)'/g;
let brm;while(brm=bre.exec(bm[1]))bonds.push([brm[1],brm[2]]);

const skills={};
const sm=html.match(/const UNIQUE_SKILLS\s*=\s*\{([\s\S]*?)\n\};/);
const sre=/'([^']+)':\{name:'[^']*',type:'([^']*)',phases:\[([^\]]*)\],val:(\d+)/g;
let srm;while(srm=sre.exec(sm[1]))skills[srm[1]]={type:srm[2],phases:srm[3].replace(/'/g,'').split(','),val:+srm[4]};

const posW={lord:[.05,.10,.20,.25,.40],strat:[.00,.38,.32,.15,.15],cmdC:[.20,.15,.40,.10,.15],vanC:[.40,.05,.30,.05,.20],cmdL:[.30,.10,.35,.10,.15],advL:[.15,.30,.30,.15,.10],cmdN:[.10,.25,.35,.10,.20],advN:[.05,.35,.20,.25,.15],raid:[.35,.25,.20,.05,.15],spy:[.05,.25,.10,.25,.35]};
const phases=[{id:'spy',slots:['spy'],weight:10},{id:'strat',slots:['strat'],weight:12},{id:'raid',slots:['raid'],weight:10},{id:'naval',slots:['cmdN','advN'],weight:18},{id:'land',slots:['cmdL','advL'],weight:18},{id:'center',slots:['cmdC','vanC'],weight:18},{id:'lord',slots:['lord'],weight:15}];
const ADJ={lord:['strat','cmdC'],strat:['lord','spy','raid'],spy:['strat','raid'],raid:['strat','spy','cmdL'],cmdN:['advN','cmdC'],advN:['cmdN','cmdC'],cmdL:['advL','cmdC','raid'],advL:['cmdL','cmdC'],cmdC:['vanC','cmdL','cmdN','lord','advL','advN'],vanC:['cmdC','cmdL']};

function posScore(c,pid){const w=posW[pid];return w[0]*c.wu+w[1]*c.zhi+w[2]*c.tong+w[3]*c.zheng+w[4]*c.mei;}
function shuffle(a){let b=[...a];for(let i=b.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}

// 模拟游戏内的分层抽样：每阵营至少6人，共48人
function stratifiedSample(all, total, minPer){
  minPer=minPer||6;
  const facs=['蜀','魏','吴','群'];
  const byFac={};facs.forEach(f=>byFac[f]=shuffle(all.filter(c=>c.fac===f)));
  const result=[];
  // 每阵营先取minPer
  facs.forEach(f=>{result.push(...byFac[f].splice(0,minPer));});
  // 剩余随机补满
  const rest=shuffle(facs.flatMap(f=>byFac[f]));
  while(result.length<total&&rest.length) result.push(rest.shift());
  return shuffle(result);
}

// 智能选将：贪心选综合属性最高的10个（模拟autoCompleteSelection）
function smartSelect(pool){
  const sorted=[...pool.map((c,i)=>({c,i}))].sort((a,b)=>(b.c.wu+b.c.zhi+b.c.tong+b.c.zheng+b.c.mei)-(a.c.wu+a.c.zhi+a.c.tong+a.c.zheng+a.c.mei));
  return sorted.slice(0,10).map(x=>x.c);
}

// 最优布阵
function optForm(chars){
  const used=new Set(),form={};
  ['strat','cmdC','vanC','lord','cmdN','cmdL','advN','advL','raid','spy'].forEach(pid=>{
    let best=-1,bestS=-1;
    chars.forEach((c,i)=>{if(!used.has(i)){const s=posScore(c,pid);if(s>bestS){bestS=s;best=i;}}});
    if(best>=0){form[pid]=chars[best];used.add(best);}
  });
  return form;
}

const N=500;
let wins=0,losses=0,draws=0;
const phaseWins={},phaseTot={};
phases.forEach(p=>{phaseWins[p.id]=0;phaseTot[p.id]=0;});
let counterFires=0,bondSameFires=0,bondAdjFires=0,skillFires=0,counterGames=0,bondGames=0;
let scoreDiffs=[];
let decidedByCounter=0,decidedBySkill=0,decidedByVariance=0;
let totalBaseGap=0,totalBaseCount=0;

for(let g=0;g<N;g++){
  // 分层抽样48人，前24给P1，后24给P2
  const sampled=stratifiedSample(allChars, 48, 6);
  const pool1=sampled.slice(0,24), pool2=sampled.slice(24,48);
  // 双方智能选将
  const sel1=smartSelect(pool1), sel2=smartSelect(pool2);
  // 最优布阵
  const f1=optForm(sel1), f2=optForm(sel2);

  let sP=0,sC=0,gCounter=0,gBond=0;
  let totalCounterImpact=0,totalSkillImpact=0,totalVarImpact=0;

  phases.forEach(bp=>{
    if(bp.slots.some(s=>!f1[s])||bp.slots.some(s=>!f2[s]))return;
    let pT=0,cT=0;
    bp.slots.forEach(s=>{pT+=posScore(f1[s],s);cT+=posScore(f2[s],s);});
    totalBaseGap+=Math.abs(pT-cT);totalBaseCount++;

    const v1=Math.random()*7,v2=Math.random()*7;
    pT+=v1;cT+=v2;
    totalVarImpact+=Math.abs(v1-v2);

    const pN=bp.slots.map(s=>f1[s].name),cN=bp.slots.map(s=>f2[s].name);
    counters.forEach(([a,b])=>{
      if(pN.includes(a)&&cN.includes(b)){pT+=12;counterFires++;gCounter++;totalCounterImpact+=12;}
      if(cN.includes(a)&&pN.includes(b)){cT+=12;counterFires++;gCounter++;totalCounterImpact+=12;}
    });

    bonds.forEach(([a,b])=>{
      if(pN.includes(a)&&pN.includes(b)){pT+=8;bondSameFires++;gBond++;}
      if(cN.includes(a)&&cN.includes(b)){cT+=8;bondSameFires++;gBond++;}
      const allP=Object.entries(f1),allC=Object.entries(f2);
      const pA=allP.find(([,c])=>c.name===a),pB=allP.find(([,c])=>c.name===b);
      if(pA&&pB&&!(pN.includes(a)&&pN.includes(b))&&ADJ[pA[0]]&&ADJ[pA[0]].includes(pB[0])){pT+=4;bondAdjFires++;}
      const cA=allC.find(([,c])=>c.name===a),cB=allC.find(([,c])=>c.name===b);
      if(cA&&cB&&!(cN.includes(a)&&cN.includes(b))&&ADJ[cA[0]]&&ADJ[cA[0]].includes(cB[0])){cT+=4;bondAdjFires++;}
    });

    bp.slots.forEach(s=>{
      const sk=skills[f1[s].name];
      if(sk&&sk.phases.includes(bp.id)&&Math.random()<0.45){pT+=sk.val;skillFires++;totalSkillImpact+=sk.val;}
    });
    bp.slots.forEach(s=>{
      const sk=skills[f2[s].name];
      if(sk&&sk.phases.includes(bp.id)&&Math.random()<0.45){cT+=sk.val;skillFires++;totalSkillImpact+=sk.val;}
    });

    const diff=pT-cT;
    const r=diff>1?'win':diff<-1?'lose':'draw';
    const pts=bp.weight;
    sP+=r==='win'?pts*0.7:r==='lose'?pts*0.3:pts/2;
    sC+=r==='win'?pts*0.3:r==='lose'?pts*0.7:pts/2;
    phaseTot[bp.id]++;
    if(r==='win')phaseWins[bp.id]++;
  });

  scoreDiffs.push(sP-sC);
  if(sP>sC)wins++;else if(sC>sP)losses++;else draws++;
  if(gCounter>0)counterGames++;
  if(gBond>0)bondGames++;
  if(totalCounterImpact>totalSkillImpact&&totalCounterImpact>totalVarImpact)decidedByCounter++;
  else if(totalSkillImpact>totalVarImpact)decidedBySkill++;
  else decidedByVariance++;
}

console.log('=== '+N+' 局理性人模拟（分层抽样+智能选将+最优布阵）===\n');
console.log('【胜负分布】');
console.log('P1胜/负/平:',wins,losses,draws,'  胜率:'+Math.round(wins/N*100)+'%');
const avg=scoreDiffs.reduce((a,b)=>a+b,0)/N;
const std=Math.sqrt(scoreDiffs.reduce((a,b)=>a+b*b,0)/N);
console.log('平均分差:',avg.toFixed(1),' 标准差:',std.toFixed(1));
console.log('大胜(>15):   '+scoreDiffs.filter(d=>d>15).length+'局('+Math.round(scoreDiffs.filter(d=>d>15).length/N*100)+'%)');
console.log('接近(<5):    '+scoreDiffs.filter(d=>Math.abs(d)<5).length+'局('+Math.round(scoreDiffs.filter(d=>Math.abs(d)<5).length/N*100)+'%)');
console.log('碾压(>25):   '+scoreDiffs.filter(d=>Math.abs(d)>25).length+'局('+Math.round(scoreDiffs.filter(d=>Math.abs(d)>25).length/N*100)+'%)');
console.log('平均单回合基础分差: '+(totalBaseGap/totalBaseCount).toFixed(1));

console.log('\n【各回合P1胜率】');
phases.forEach(p=>{console.log('  '+p.id.padEnd(7)+'(w'+p.weight.toString().padEnd(2)+'): '+Math.round(phaseWins[p.id]/phaseTot[p.id]*100)+'%');});

console.log('\n【机制触发频率】');
console.log('  克制:     '+(counterFires/N).toFixed(2)+'/局  有克制局:'+Math.round(counterGames/N*100)+'%');
console.log('  羁绊同阵: '+(bondSameFires/N).toFixed(2)+'/局');
console.log('  羁绊邻接: '+(bondAdjFires/N).toFixed(2)+'/局  有羁绊局:'+Math.round(bondGames/N*100)+'%');
console.log('  技能:     '+(skillFires/N).toFixed(2)+'/局');

console.log('\n【胜负决定因素】');
console.log('  克制主导: '+Math.round(decidedByCounter/N*100)+'%');
console.log('  技能主导: '+Math.round(decidedBySkill/N*100)+'%');
console.log('  方差主导: '+Math.round(decidedByVariance/N*100)+'%');
