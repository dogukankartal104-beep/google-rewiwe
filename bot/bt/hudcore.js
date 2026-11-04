// GENERATED from fade-hud.html by the extraction step in bt/README (do not hand-edit the rule code).
// Copied unchanged except the two edits documented in docs/fade-hud-sinav-protokol.md ("Code notes").
// The only deliberate override below is CFG.stopMode = 0 (limit style), as the protocol requires.
const CFG={zz:1.6,searchBars:250,minPumpPct:15,candleAtr:2.5,oiPriceRatio:4,oiVeto:25,oiBleed:2,fundingHot:0.05,
  volDecay:0.5,minPullback:3,retestZone:3,btcVeto:1.5,stopAtr:1.2,huntAtr:1.5,minStopAtr:1.3,maxStopAtr:3,stopLook:6,tpBarRatio:3,volCap:3,tpMinR:1.2,maxStopPct:6,stopMode:3,tpMode:1,rrTarget:1,maxTpR:2.5,newListDays:30,srTouch:2,rr:2,acct:1000,riskPct:1,maxOpen:2,dailyStopR:-2,trackBars:32,reSignalMin:60,
  feeBps:5,extraSlipBps:5,partialOn:1,tp1Frac:0.5,beAfterTp1:1,limitWaitBars:8,minGroupN:30};
CFG.stopMode=0;
function atr(k,p=14){const tr=k.map((c,i)=>i?Math.max(c.h-c.l,Math.abs(c.h-k[i-1].c),Math.abs(c.l-k[i-1].c)):c.h-c.l);
  const o=[];let s=0;for(let i=0;i<tr.length;i++){s+=tr[i];if(i>=p)s-=tr[i-p];o.push(i>=p-1?s/p:null)}return o}
function zigzag(k,A,mult){
  const out=[]; let dir=1, hiP=k[0].h, hiI=0, loP=k[0].l, loI=0;
  for(let i=1;i<k.length;i++){
    const th=(A[i]||A[A.length-1]||k[i].c*0.02)*mult;
    if(dir>0){
      if(k[i].h>=hiP){hiP=k[i].h;hiI=i}
      else if(hiP-k[i].l>=th){out.push({i:hiI,p:hiP,t:'h'});dir=-1;loP=k[i].l;loI=i}
    } else {
      if(k[i].l<=loP){loP=k[i].l;loI=i}
      else if(k[i].h-loP>=th){out.push({i:loI,p:loP,t:'l'});dir=1;hiP=k[i].h;hiI=i}
    }
  }
  out.push(dir>0?{i:hiI,p:hiP,t:'h'}:{i:loI,p:loP,t:'l'});
  return out;
}
function findSetup(k,A,ZZ){
  const n=k.length, minBar=Math.max(0,n-CFG.searchBars);
  const hs=ZZ.filter(x=>x.t==='h'), ls=ZZ.filter(x=>x.t==='l');
  const biggest=(a,b)=>{let pi=a,best=-1;
    for(let i=Math.max(1,a);i<=b;i++){const at=A[i-1]||A[i];if(!at)continue;
      const sc=(k[i].h-k[i].l)/at*(k[i].c>=k[i].o?1:.35); if(sc>best){best=sc;pi=i}}
    return pi};
  for(let j=hs.length-1;j>=0;j--){
    const h=hs[j]; if(h.i<minBar) break;
    const pr=ls.filter(x=>x.i<h.i);
    const lo=pr.length?pr[pr.length-1]:{i:Math.max(0,h.i-24),p:Math.min(...k.slice(Math.max(0,h.i-24),h.i+1).map(x=>x.l))};
    const leg=(h.p-lo.p)/lo.p*100;
    if(leg<CFG.minPumpPct) continue;
    const aft=k.slice(h.i+1);
    if(aft.length&&Math.max(...aft.map(x=>x.h))>h.p) continue;   // tepe sonradan kırıldıysa geçersiz
    return {pi:biggest(lo.i,h.i),si:h.i,high:h.p,low:lo.p,loI:lo.i,leg,solid:true};
  }
  const st=Math.max(0,n-100); let si=st;
  for(let i=st;i<n;i++) if(k[i].h>k[si].h) si=i;
  let loI=Math.max(0,si-30); for(let i=loI;i<=si;i++) if(k[i].l<k[loI].l) loI=i;
  return {pi:biggest(loI,si),si,high:k[si].h,low:k[loI].l,loI,
          leg:(k[si].h-k[loI].l)/k[loI].l*100,solid:false};
}
function findSetupDown(k,A,ZZ){
  const n=k.length, minBar=Math.max(0,n-CFG.searchBars);
  const ls=ZZ.filter(x=>x.t==='l'), hs=ZZ.filter(x=>x.t==='h');
  const biggest=(a,b)=>{let pi=a,best=-1;
    for(let i=Math.max(1,a);i<=b;i++){const at=A[i-1]||A[i];if(!at)continue;
      const sc=(k[i].h-k[i].l)/at*(k[i].c<k[i].o?1:.35);if(sc>best){best=sc;pi=i}}
    return pi};
  for(let j=ls.length-1;j>=0;j--){
    const lo=ls[j]; if(lo.i<minBar) break;
    const pr=hs.filter(x=>x.i<lo.i);
    const hi=pr.length?pr[pr.length-1]:{i:Math.max(0,lo.i-24),p:Math.max(...k.slice(Math.max(0,lo.i-24),lo.i+1).map(x=>x.h))};
    const leg=(hi.p-lo.p)/hi.p*100;
    if(leg<CFG.minPumpPct) continue;
    const aft=k.slice(lo.i+1);
    if(aft.length&&Math.min(...aft.map(x=>x.l))<lo.p) continue;
    return {pi:biggest(hi.i,lo.i),si:lo.i,low:lo.p,high:hi.p,hiI:hi.i,leg,solid:true};
  }
  const st=Math.max(0,n-100); let si=st;
  for(let i=st;i<n;i++) if(k[i].l<k[si].l) si=i;
  let hiI=Math.max(0,si-30); for(let i=hiI;i<=si;i++) if(k[i].h>k[hiI].h) hiI=i;
  return {pi:biggest(hiI,si),si,low:k[si].l,high:k[hiI].h,hiI,
          leg:(k[hiI].h-k[si].l)/k[hiI].h*100,solid:false};
}
function seans(t){const h=new Date(t+3*3600e3).getUTCHours();return h<3?'ölü saat':h<11?'asya':h<17?'avrupa':'abd'}
async function btEval(k,A,cvd,i,oiAt,dir){
  /* i. mumun kapanışında, sadece o ana kadarki veriyle karar */
  const kk=k.slice(0,i+1), AA=A.slice(0,i+1);
  const last=kk[kk.length-1], atr=AA[AA.length-1]; if(!atr)return null;
  const ZZ=zigzag(kk,AA,CFG.zz);
  const S=dir==='S'?findSetup(kk,AA,ZZ):findSetupDown(kk,AA,ZZ);
  if(!S.solid)return null;
  const hi=dir==='S'?S.high:S.top||S.high, lo=dir==='S'?S.low:S.low;
  const leg=dir==='S'?(S.high-S.low)/S.low*100:(S.high-S.low)/S.high*100;
  if(leg<CFG.minPumpPct)return null;
  const si=S.si, pc=kk[S.pi];
  const cAtr=(pc.h-pc.l)/(AA[S.pi-1]||atr); if(cAtr<CFG.candleAtr)return null;
  /* oiAt is injected (lazy archive lookup) instead of scanning an oiArr array */
  const o0=await oiAt(kk[dir==='S'?S.loI:S.hiI].t), o1=await oiAt(kk[si].t+6e4), o2=await oiAt(last.t);
  if(!o0||!o1||!o2||!o0.v)return null;
  const oiChg=(o1.v-o0.v)/o0.v*100, oiBleed=o1.v?(o2.v-o1.v)/o1.v*100:0;
  if(oiChg>CFG.oiVeto)return null;
  const ratio=Math.abs(oiChg)>.05?leg/Math.abs(oiChg):null;
  let typeOk=1,type='karışık';
  if(oiChg<=-3){typeOk=2;type=dir==='S'?'squeeze':'likidasyon'}
  else if(ratio!==null&&ratio>=CFG.oiPriceRatio){typeOk=2;type='spot'}
  const aft=kk.slice(si+1); if(aft.length<2)return null;
  const wick=dir==='S'?(pc.h-Math.max(pc.o,pc.c))/((pc.h-pc.l)||1):(Math.min(pc.o,pc.c)-pc.l)/((pc.h-pc.l)||1);
  const volR=last.v/(pc.v||1);
  const cvdOk=dir==='S'?cvd[i]<cvd[si]:cvd[i]>cvd[si];
  const tkNow=last.v?last.tb/last.v:0.5, tkPrev=kk[i-3]&&kk[i-3].v?kk[i-3].tb/kk[i-3].v:0.5;
  const tkOk=dir==='S'?(tkNow<0.5||tkNow<tkPrev):(tkNow>0.5||tkNow>tkPrev);
  const exN=[wick>=.4,volR<=CFG.volDecay,cvdOk,oiBleed<=-CFG.oiBleed,tkOk].filter(Boolean).length;
  if(exN<3)return null;
  let sweep=null;
  for(let j=Math.max(20,i-7);j<=i;j++){
    if(dir==='S'){const pm=Math.max(...kk.slice(j-12,j).map(x=>x.h)); if(kk[j].h>pm&&kk[j].c<pm)sweep=kk[j]}
    else{const pm=Math.min(...kk.slice(j-12,j).map(x=>x.l)); if(kk[j].l<pm&&kk[j].c>pm)sweep=kk[j]}
  }
  const ext=dir==='S'?Math.max(...aft.map(x=>x.h)):Math.min(...aft.map(x=>x.l));
  const structOk=dir==='S'?(ext<S.high&&last.c<S.high):(ext>S.low&&last.c>S.low);
  const retr=dir==='S'?(S.high-last.c)/S.high*100:(last.c-S.low)/S.low*100;
  const firstX=aft.slice(0,Math.min(4,aft.length));
  const brk=dir==='S'?last.c<Math.min(...firstX.map(x=>x.l)):last.c>Math.max(...firstX.map(x=>x.h));
  const trN=[!!sweep,structOk&&retr>=CFG.minPullback,brk].filter(Boolean).length;
  if(trN<1||!structOk||retr<CFG.minPullback)return null;
  const grade=(typeOk===2&&exN>=4)?'A':(typeOk===2&&exN>=3)?'B':(exN>=3)?'C':'D';
  const As=AA.slice(-60).filter(Boolean).slice().sort((a,b)=>a-b);
  const med=As.length?As[Math.floor(As.length/2)]:atr;
  const vr=med?atr/med:1, atrPct=atr/last.c*100;
  const mult=Math.min(CFG.volCap,Math.max(CFG.stopAtr,CFG.stopAtr*vr));
  let en=last.c;  /* FIX: was const, then reassigned (en=en2) -> TypeError on every signal */
  let st, dst;
  if(dir==='S'){
    const rh=Math.max(...kk.slice(-CFG.stopLook).map(x=>x.h));
    const cc=[rh+0.35*atr, S.high+mult*atr]; if(sweep)cc.push(sweep.h+0.4*atr);
    dst=Math.min(...cc)-en;
  } else {
    const rl=Math.min(...kk.slice(-CFG.stopLook).map(x=>x.l));
    const cc=[rl-0.35*atr, S.low-mult*atr]; if(sweep)cc.push(sweep.l-0.4*atr);
    dst=en-Math.max(...cc);
  }
  dst=Math.max(CFG.minStopAtr*atr,Math.min(CFG.maxStopAtr*atr,dst));
  st=dir==='S'?en+dst:en-dst;
  let st2=st, en2=en, mode='piyasa';
  const cap=en*CFG.maxStopPct/100;
  if(Math.abs(st2-en)>cap){
    if(CFG.stopMode>=2) return null;
    else if(CFG.stopMode==1) st2=dir==='S'?en+cap:en-cap;
    else { en2=dir==='S'?st2/(1+CFG.maxStopPct/100):st2/(1-CFG.maxStopPct/100); mode='limit' }
  }
  en=en2;
  const risk=Math.abs(st2-en); if(!risk)return null;
  let t1;
  if(CFG.tpMode>=1){ t1=dir==='S'?en-risk*CFG.rrTarget:en+risk*CFG.rrTarget }
  else { const fib=(S.high+S.low)/2; t1=fib;
    if(Math.abs(t1-en)/risk<CFG.tpMinR) t1=dir==='S'?en-risk*CFG.tpMinR:en+risk*CFG.tpMinR }
  return {i,dir,grade,type,exN,trN,sweep:!!sweep,en,st:st2,t1,risk,mode,leg,oiChg,ratio,
          rr:Math.abs(t1-en)/risk, ses:seans(last.t), t:last.t};
}
export { CFG, atr, zigzag, findSetup, findSetupDown, btEval, seans };
