import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const automatic=fs.readFileSync(new URL('../automatic-plan.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../signal-indicator.js',import.meta.url),'utf8');
const now=Date.parse('2026-10-16T12:05:00Z');
const base={ok:true,direction:'LONG',prices:{entryLow:99.9,entryHigh:100,stop:99,tp1:102,tp2:103},confirmation:{dataFresh:true,contractEpic:'TEST',marketStatus:'TRADEABLE',lastCandleClosedAt:'2026-10-16T12:00:00Z',alertStage:'ENTER',entryTriggered:true}};
function engine(){let clock=now;const sandbox={Date:class extends Date{static now(){return clock;}}};vm.runInNewContext(automatic,sandbox);vm.runInNewContext(source,sandbox);return {sandbox,indicator:sandbox.WTISignalIndicator,setClock(value){clock=value;}};}
test('indicator shares the bot gates, distinguishes provisional levels and expires on the clock',()=>{
 const {sandbox,indicator,setClock}=engine();
 const prepare={...base,direction:'WAIT',prices:null,confirmation:{...base.confirmation,alertStage:'PREPARE',entryTriggered:false,prepareDirection:'LONG',preparePrices:base.prices}};
 sandbox.WTIAutomaticPlan.update(prepare);
 const p=indicator.overlay([{t:Date.parse('2026-10-16T11:55:00Z')}],5);
 assert.equal(p.plan.stage,'PREPARE');assert.equal(p.markers.length,0);assert.ok(p.lines.some(line=>line.title==='PREP SL'));
 setClock(now+16*60000);assert.equal(indicator.snapshot().stage,'WAIT');assert.equal(indicator.overlay([],5).lines.length,0);
});
test('ENTER arrows preserve direction and only mark the bar containing the actual 5m confirmation',()=>{
 for(const direction of ['LONG','SHORT']){
  const {sandbox,indicator}=engine();
  const prices=direction==='LONG'?base.prices:{entryLow:99.9,entryHigh:100,stop:101,tp1:98,tp2:97};
  sandbox.WTIAutomaticPlan.update({...base,direction,prices});
  assert.equal(indicator.overlay([{t:Date.parse('2026-10-16T08:00:00Z')}],240).markers[0].text,'ENTER '+direction+' · 5m');
  assert.equal(indicator.overlay([{t:Date.parse('2026-10-16T04:00:00Z')}],240).markers.length,0);
  assert.equal(indicator.overlay([{t:Date.parse('2026-10-16T11:55:00Z')}],5).markers[0].shape,direction==='LONG'?'arrowUp':'arrowDown');
 }
});
test('contract mismatch, closed feed and risk blocks suppress all indicator levels',()=>{
 const {sandbox,indicator}=engine();sandbox.WTIAutomaticPlan.update(base);indicator.setContract('OTHER');
 assert.equal(indicator.overlay([],5).lines.length,0);assert.match(indicator.snapshot().reason,/contracts differ/);
 indicator.setContract('TEST');
 for(const c of [{marketStatus:'EDITS_ONLY'},{eventBlocked:true},{newsConflict:true},{dataFresh:false}]){
  sandbox.WTIAutomaticPlan.update({...base,confirmation:{...base.confirmation,...c}});assert.equal(indicator.snapshot().stage,'WAIT');
 }
});
test('indicator updates prices and gross R/R, clears WAIT fields and creates no alert subscription',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../simple.html',import.meta.url),'utf8'),{runScripts:'outside-only'});
 try{const w=dom.window;w.Date.now=()=>now;w.eval(automatic);w.eval(source);w.WTIAutomaticPlan.update(base);
  const d=w.document;assert.equal(d.getElementById('chartSetupTitle').textContent,'ENTER LONG');assert.equal(d.getElementById('chartStop').textContent,'$99.00');
  assert.match(d.getElementById('chartRR').textContent,/TP1 2.00:1/);w.WTIAutomaticPlan.update(null);
  assert.equal(d.getElementById('chartEntry').textContent,'—');assert.equal(d.getElementById('chartRR').textContent,'—');
  assert.equal(source.includes('fetch('),false);assert.equal(source.includes('subscribe('),false);
 }finally{dom.window.close();}
});
