import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionValue,validSession} from '../access.mjs';
import {performanceMemory} from '../api/learning.js';
import {validAIReview} from '../api/safety.js';
test('private sessions expire and cannot be forged with another secret',()=>{
  const now=100000000,secret='synthetic-access-code';
  const session=sessionValue(secret,now);
  assert.ok(validSession(session,secret,now+1000));
  assert.equal(validSession(session,'other-code',now+1000),false);
  assert.equal(validSession(session,secret,now+12*60*60*1000),false);
  assert.equal(validSession(session,secret,now-1),false);
});
test('AI validation preserves the exact server direction and displayed prices',()=>{
  const setup={direction:'LONG',entryLow:70,entryHigh:71,stop:69,tp1:73,tp2:75};
  const answer='AI REVIEW: VALIDATE\nDIRECTION: LONG\nENTRY: 70.00-71.00\nSTOP: 69.00\nTP1: 73.00\nTP2: 75.00';
  assert.ok(validAIReview(answer,setup));
  assert.equal(validAIReview(answer.replace('73.00','99.00'),setup),false);
  assert.equal(validAIReview(answer.replace('LONG','SHORT'),setup),false);
  assert.equal(validAIReview(answer.toLowerCase().replace('73.00','99.00'),setup),false);
  assert.equal(validAIReview('AI REVIEW: GUARANTEED',setup),false);
});
test('learning is cost adjusted, requires samples, and excludes ambiguous outcomes',()=>{
  const signal={direction:'LONG',entryLow:70,entryHigh:71,stop:69,tp1:73,tp2:75,setupType:'TEST',status:'STOP'};
  const memory=performanceMemory(Array.from({length:20},()=>signal));
  assert.equal(memory.bySetup.TEST.evidence,'REVIEW REQUIRED');assert.ok(memory.bySetup.TEST.averageNetR< -1);
  assert.equal(performanceMemory([signal]).bySetup.TEST.evidence,'INSUFFICIENT DATA');
  assert.deepEqual(performanceMemory([{...signal,status:'AMBIGUOUS'}]).bySetup,{});
  assert.equal(memory.automaticallyChangesStrategy,false);
});
