import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {get,put} from '../api/storage.js';
import {entryTrigger,validPrices,signalStage} from '../api/safety.js';
import {aggregate,indicators} from '../api/market-monitor.js';
import {updateSignalJournal,getSignalLearningSnapshot} from '../api/signal-journal.js';
import {evaluateSignal,getTradingSession,netRStats} from '../api/backtest.js';

fs.mkdirSync('test-data',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-data','core-'));
process.env.WTI_DATA_DIR=dir;
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const long={entryLow:70,entryHigh:71,stop:69,tp1:73,tp2:75};
const short={entryLow:70,entryHigh:71,stop:72,tp1:68,tp2:66};
const t=Date.UTC(2026,9,13,12);
const bar=(i,o=70.5,h=70.8,l=70.2,c=70.5)=>({t:t+i*300000,o,h,l,c,v:10});
const closed=new Date(t+300000).toISOString();
const confirmation={dataFresh:true,lastCandleClosedAt:closed,fiveMinRsi:55,fifteenMinRsi:55};

test('LONG/SHORT geometry and PREPARE/ENTER gates are symmetric',()=>{
  assert.ok(validPrices('LONG',long));assert.ok(validPrices('SHORT',short));
  assert.equal(validPrices('LONG',short),false);
  assert.equal(validPrices('LONG',{...long,tp2:NaN}),false);
  assert.equal(signalStage('LONG',false,long),'PREPARE');
  assert.equal(signalStage('SHORT',true,short),'ENTER');
  assert.equal(signalStage('LONG',true,short),'WAIT');
  const bull=[bar(0,71,72,70,70.5),bar(1,70.4,72,69.8,71.5)];
  const bear=[bar(0,70.5,72,70,71),bar(1,71,72.2,70,70.4)];
  assert.ok(entryTrigger('LONG',bull));assert.ok(entryTrigger('SHORT',bear));
  assert.equal(entryTrigger('LONG',[bull[0],{...bull[1],t:t+600000}]),false);
});
test('aggregate requires unique consecutive candles; flat RSI is neutral',()=>{
  assert.equal(aggregate([bar(0),bar(1),bar(2)],15).length,1);
  assert.equal(aggregate([bar(0),bar(0),bar(2)],15).length,0);
  assert.equal(indicators(Array.from({length:40},(_,i)=>bar(i))).rsi,50);
});
test('storage rejects traversal, stale writes and racing first creation',async()=>{
  await assert.rejects(get('../outside.json'),/Invalid storage/);
  const first=await put('versions.json','one',{ifMatch:null});
  await assert.rejects(put('versions.json','two',{ifMatch:null}),/conflict/);
  await put('versions.json','two',{ifMatch:first.etag});
  await assert.rejects(put('versions.json','three',{ifMatch:first.etag}),/conflict/);
});
test('fresh journal initializes, deduplicates, keeps rollover outcomes unknown',async()=>{
  const args={bars:[bar(0)],direction:'LONG',setupType:'TEST',prices:long,confirmation,isNewSignal:true,contractEpic:'OLD'};
  await updateSignalJournal(args);await updateSignalJournal(args);
  let snapshot=await getSignalLearningSnapshot();assert.equal(snapshot.stats.totalSignals,1);
  await updateSignalJournal({...args,bars:[bar(1)],direction:'WAIT',prices:null,isNewSignal:false,contractEpic:'NEW'});
  snapshot=await getSignalLearningSnapshot();assert.equal(snapshot.recent[0].status,'ROLLED_OVER');assert.equal(snapshot.stats.evaluated,0);
  assert.ok(fs.readdirSync(path.join(dir,'journal','backups')).length>0);
});
test('journal and replay mark entry/exit conflicts ambiguous, without learning wins',async()=>{
  const args={bars:[bar(0)],direction:'SHORT',setupType:'TEST',prices:short,confirmation,isNewSignal:true,contractEpic:'NEW'};
  await updateSignalJournal(args);
  await updateSignalJournal({...args,bars:[bar(1,70.5,72.5,67,70)],isNewSignal:false});
  const snapshot=await getSignalLearningSnapshot();assert.equal(snapshot.stats.ambiguous,1);assert.equal(snapshot.stats.evaluated,0);
  const result=evaluateSignal({...short,direction:'SHORT',candleClosedAt:t+300000},[bar(0),bar(1,70.5,72.5,67,70)],0);
  assert.equal(result.status,'AMBIGUOUS');
});
test('replay outcomes cannot see validation bars when history is bounded',()=>{
  const history=[bar(0),bar(1),bar(2,71,76,70,75)];
  const signal={...long,direction:'LONG',candleClosedAt:t+300000};
  assert.equal(evaluateSignal(signal,history.slice(0,2),0).status,'OPEN_END');
  assert.equal(evaluateSignal(signal,history,0).status,'TP2');
  assert.equal(getTradingSession(Date.UTC(2026,9,13,13)),'US');
  assert.ok(netRStats([{...signal,status:'TP2'}],0.05).averageNetR<netRStats([{...signal,status:'TP2'}],0).averageNetR);
});
test('a target after the eight-hour deadline cannot turn a timeout into a win',()=>{
  const signal={...long,direction:'LONG',candleClosedAt:t+300000};
  assert.equal(evaluateSignal(signal,[bar(0),bar(1),bar(110,71,76,70,75)],0).status,'TIMEOUT');
});
