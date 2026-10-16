import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import {isolatePreviewEnvironment,refreshPreviewCache} from './preview-fixture.mjs';
import {previewScenario,previewBanner} from '../api/preview.js';
import {validPrices} from '../api/safety.js';
import pushTest from '../api/push-test.js';
import {put} from '../api/storage.js';

fs.mkdirSync('test-data',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-data','preview-test-'));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('preview replaces credential variables and data location with isolated test settings',()=>{
  const env={PORT:'12345',IG_API_KEY:'production-placeholder',IG_PASSWORD:'production-placeholder',OPENAI_API_KEY:'production-placeholder',
    WTI_DATA_DIR:'/production-data-placeholder',WTI_MONITOR_SECRET:'production-placeholder',VAPID_PRIVATE_KEY:'production-placeholder'};
  isolatePreviewEnvironment(env,dir);
  assert.equal(env.PORT,'12345');assert.equal(env.WTI_DATA_DIR,dir);
  for(const key of ['IG_API_KEY','IG_PASSWORD','OPENAI_API_KEY','WTI_MONITOR_SECRET'])assert.equal(env[key],undefined);
  assert.equal(env.WTI_MONITOR_ENABLED,'false');assert.equal(env.WTI_PREVIEW_MODE,'synthetic');
  assert.notEqual(env.VAPID_PRIVATE_KEY,'production-placeholder');
  const privateKey=env.VAPID_PRIVATE_KEY;isolatePreviewEnvironment(env,dir);assert.equal(env.VAPID_PRIVATE_KEY,privateKey);
  assert.throws(()=>isolatePreviewEnvironment({RENDER_SERVICE_NAME:'wti-pro-render-test'},dir),/Refusing/);
});
test('synthetic history remains fresh across five-minute buckets without broker credentials',()=>{
  const t=Date.UTC(2026,9,15,18,0,45);
  const first=refreshPreviewCache(dir,t),second=refreshPreviewCache(dir,t+10*60000);
  assert.equal(first.bars.length,4000);assert.equal(second.bars.at(-1).t-first.bars.at(-1).t,10*60000);
  assert.equal(second.igAttemptBucket,Math.floor((t+10*60000-30000)/300000));
  assert.equal(second.contractExpiry,'SYNTHETIC');
});
test('scenario controls distinguish PREPARE/ENTER for both directions and display the warning',()=>{
  for(const direction of ['LONG','SHORT'])for(const stage of ['PREPARE','ENTER']){
    const value=previewScenario(stage,direction,75,'2026-10-15T18:00:00Z');
    assert.equal(value.synthetic,true);assert.equal(value.direction,stage==='ENTER'?direction:'WAIT');
    assert.ok(validPrices(direction,value.prices||value.confirmation.preparePrices));
  }
  assert.match(previewBanner(),/SYNTHETIC PRICES/);
});
test('test notification is labeled synthetic and sent only after the requested delay',async(t)=>{
  const old={...process.env},send=webpush.sendNotification;let calls=0,payload;
  const keys=webpush.generateVAPIDKeys();
  Object.assign(process.env,{WTI_DATA_DIR:dir,WTI_PREVIEW_MODE:'synthetic',VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'https://github.com/cistman-collab/Ppp'});
  await put('push/subscription.json',JSON.stringify({subscription:{endpoint:'https://web.push.apple.com/synthetic'}}),{allowOverwrite:true});
  webpush.sendNotification=async(_,body)=>{calls++;payload=JSON.parse(body);};
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    let response;
    await pushTest({method:'POST',headers:{host:'test.example',origin:'https://test.example'}},{status(){return this;},json(value){response=value;}});
    assert.equal(response.scheduled,true);assert.equal(calls,0);
    t.mock.timers.tick(10000);await Promise.resolve();
    assert.equal(calls,1);assert.match(payload.title,/TEST/);assert.match(payload.body,/No live signal/);
  }finally{
    webpush.sendNotification=send;t.mock.timers.reset();
    for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);
  }
});
