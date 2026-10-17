import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../automatic-plan.js',import.meta.url),'utf8');
const sandbox={};vm.runInNewContext(source,sandbox);
const build=sandbox.WTIAutomaticPlan.build;
const now=Date.parse('2026-10-16T12:05:00Z');
const base={ok:true,direction:'LONG',prices:{entryLow:99.9,entryHigh:100,stop:99,tp1:102,tp2:103},confirmation:{dataFresh:true,lastCandleClosedAt:'2026-10-16T12:00:00Z',marketStatus:'TRADEABLE',alertStage:'ENTER',entryTriggered:true,contractEpic:'TEST'}};
test('automatic plan chooses server levels and conservative reward/risk for LONG and SHORT',()=>{
 const long=build(base,now);assert.equal(long.stage,'ENTER');assert.equal(long.rr1,2);assert.equal(long.rr2,3);
 const short=build({...base,direction:'SHORT',prices:{entryLow:100,entryHigh:100.1,stop:101,tp1:98,tp2:97}},now);
 assert.equal(short.rr1,2);assert.equal(short.risk,1);
});
test('PREPARE exposes provisional levels without inventing an entry confirmation',()=>{
 const plan=build({...base,direction:'WAIT',prices:null,confirmation:{...base.confirmation,alertStage:'PREPARE',entryTriggered:false,prepareDirection:'LONG',preparePrices:base.prices,entryTriggerText:'Wait for bullish rejection.'}},now);
 assert.equal(plan.stage,'PREPARE');assert.equal(plan.reason,'Wait for bullish rejection.');assert.equal(plan.prices.tp1,102);
});
test('stale, closed, missing, blocked, future and invalid plans hide all actionable prices',()=>{
 for(const c of [{dataFresh:false},{lastCandleClosedAt:'bad'},{lastCandleClosedAt:'2026-10-16T12:06:00Z'},{lastCandleClosedAt:'2026-10-16T11:40:00Z'},{marketStatus:'EDITS_ONLY'},{eventBlocked:true},{newsConflict:true},{entryTriggered:false},{alertStage:'WAIT'}]){
  const p=build({...base,confirmation:{...base.confirmation,...c}},now);assert.equal(p.stage,'WAIT');assert.equal(p.prices,undefined);
 }
 assert.equal(build({...base,prices:{...base.prices,stop:103}},now).stage,'WAIT');assert.equal(build(null,now).stage,'WAIT');
});
test('automatic UI reviews once per confirmed candle, clears stale replies and has no manual form',()=>{
 const html=fs.readFileSync(new URL('../simple.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try{
  const w=dom.window;w.Date.now=()=>now;let count=0;
  w.reviewSignalAI=()=>{count++;};w.document.querySelector('[onclick="reviewSignalAI()"]').disabled=false;
  w.eval(source);w.WTIAutomaticPlan.update(base);w.WTIAutomaticPlan.update(base);
  assert.equal(count,1);assert.match(w.document.getElementById('botPlanDetails').textContent,/gross reward\/risk 2.00:1/);
  const old=w.WTIAutomaticPlan.key();w.WTIAutomaticPlan.reviewedAnswer(old,'AI REVIEW: VALIDATE');w.WTIAutomaticPlan.update(null);
  assert.notEqual(w.WTIAutomaticPlan.key(),old);assert.equal(w.document.getElementById('botPlanStage').textContent,'WAIT');
  assert.doesNotMatch(w.document.getElementById('botPlanDetails').textContent,/Target 1/);
  assert.match(w.document.getElementById('signalAIReview').textContent,/WAIT/);
  assert.equal(w.document.getElementById('riskPlanForm'),null);
  w.WTIAutomaticPlan.reviewedAnswer(old,'late stale reply');assert.doesNotMatch(w.document.getElementById('signalAIReview').textContent,/late stale reply/);
  w.WTIAutomaticPlan.update(base);assert.equal(count,1);assert.equal(w.document.getElementById('signalAIReview').textContent,'AI REVIEW: VALIDATE');
  const inventory={status:'AVAILABLE',releaseDate:'2026-10-15',weekEnding:'2026-10-09',stocksMillionBarrels:400,changeMillionBarrels:-5,movement:'DRAW'};
  w.WTIAutomaticPlan.update({...base,confirmation:{...base.confirmation,inventory,newsAvailable:true,newsBias:'MIXED',eventStatus:'CLEAR'}});
  assert.match(w.document.getElementById('botInventory').textContent,/400.000 million barrels/);
  assert.match(w.document.getElementById('botEvidence').textContent,/News: MIXED/);
  assert.equal(w.document.querySelector('#automaticPlan #signalAIReview')!==null,true);
  assert.equal(w.document.querySelector('#signalsPage details.setupCard').open,false);
  assert.equal(w.document.querySelector('#chartPage details.setupCard'),null);
  assert.equal(count,2); // New verified inventory/news context deserves a new review.
 }finally{dom.window.close();}
});
test('synthetic plans require both an isolated preview and synthetic server metadata',()=>{
 const sample={...base,synthetic:true,confirmation:{...base.confirmation,marketStatus:'SYNTHETIC'}};
 assert.equal(build(sample,now).stage,'WAIT');assert.equal(build(sample,now,true).stage,'ENTER');
 assert.equal(build({...sample,synthetic:false},now,true).stage,'WAIT');
});
