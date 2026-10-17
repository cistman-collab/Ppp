import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import monitor from '../api/market-monitor.js';
import ai from '../api/ai.js';
import subscribe from '../api/push-subscribe.js';
import webpush from 'web-push';
import {get,put} from '../api/storage.js';
import {resetInventoryCache} from '../api/inventories.js';
let dir;
const now=Date.UTC(2026,9,13,15,0,45), originalNow=Date.now,originalFetch=global.fetch,originalPush=webpush.sendNotification;
const bars=Array.from({length:4000},(_,i)=>{
  const c=70+i*.001+i*i*.0000001;
  return {t:now-45000-(4000-i)*300000,o:c-.002,h:c+.01,l:c-.01,c,v:100};
});
const feed={activeProvider:'IG',fallbackUsed:false,contractVerified:true,marketStatus:'TRADEABLE',delayTime:0,epic:'EN.D.CL.FWS1',bars};
function inventoryFixture(){return {metadata:{source:'U.S. Energy Information Administration',periodicity:'Weekly',release_date:'2026-10-08'},data:{'U.S.':{sourcekey:'WCESTUS1',units:'thousand barrels',time_series:[{date:'2026-09-25',value:405000,suppression_flag:null},{date:'2026-10-02',value:400000,suppression_flag:null}]}}};}
function mockFeed(value){global.fetch=async(url)=>url.includes('ir.eia.gov')?Response.json(inventoryFixture()):url.endsWith('/api/news')?Response.json({items:[]}):Response.json(value);}
async function call(handler,req){let code,result;await handler(req,{setHeader(){},status(n){code=n;return this;},json(value){result=value;return this;}});return {code,result};}
test.beforeEach(()=>{
  fs.mkdirSync('test-data',{recursive:true});dir=fs.mkdtempSync(path.resolve('test-data','monitor-'));
  Object.assign(process.env,{WTI_DATA_DIR:dir,WTI_MONITOR_SECRET:'synthetic-secret',VAPID_SUBJECT:'mailto:test@example.com'});
  const keys=webpush.generateVAPIDKeys();Object.assign(process.env,{VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey});
  Date.now=()=>now;mockFeed(feed);
  resetInventoryCache();
});
test.afterEach(()=>{global.fetch=originalFetch;Date.now=originalNow;webpush.sendNotification=originalPush;fs.rmSync(dir,{recursive:true,force:true});});
test('PREPARE is visible but never enters the journal; read-only view preserves alert state',async()=>{
  const {code,result}=await call(monitor,{method:'GET',headers:{host:'attacker.invalid'},query:{view:'1'}});
  assert.equal(code,200);assert.equal(result.direction,'WAIT');assert.equal(result.confirmation.alertStage,'PREPARE');
  assert.equal(result.confirmation.prepareDirection,'LONG');assert.equal(await get('push/monitor-state.json'),null);
  assert.equal(await get('journal/signals.json'),null);
});
test('stale, closed, delayed and unverified feeds all block preparation and entry',async()=>{
  for(const value of [ {...feed,contractVerified:false}, {...feed,marketStatus:'CLOSED'}, {...feed,delayTime:10}, {...feed,delayTime:null}, {...feed,bars:bars.map(b=>({...b,t:b.t-20*60000}))} ]){
    mockFeed(value);const {result}=await call(monitor,{method:'GET',headers:{},query:{view:'1'}});
    assert.equal(result.direction,'WAIT');assert.equal(result.confirmation.alertStage,'WAIT');
  }
});
test('PREPARE notification retries persist state only after delivery and deduplicate',async()=>{
  await put('push/subscription.json',JSON.stringify({subscription:{endpoint:'https://web.push.apple.com/synthetic',keys:{auth:'synthetic',p256dh:'synthetic'}}}));
  let sends=0,payload;
  webpush.sendNotification=async(_,body)=>{sends++;payload=JSON.parse(body);};
  const req={method:'GET',headers:{authorization:'Bearer synthetic-secret'},query:{}};
  const first=await call(monitor,req);assert.equal(first.code,200);assert.equal(sends,1);assert.match(payload.title,/PREPARE LONG/);
  const second=await call(monitor,req);assert.equal(second.result.skipped,true);assert.equal(sends,1);
  const journal=await get('journal/signals.json');assert.equal(journal,null);
});
test('unauthorized checks cannot mutate saved alerts',async()=>{
  const result=await call(monitor,{method:'GET',headers:{},query:{}});assert.equal(result.code,401);assert.equal(await get('push/monitor-state.json'),null);
});
test('confirmed LONG and SHORT entry responses have valid prices and journal entries',async()=>{
  for(const direction of ['LONG','SHORT']){
    const source=bars.map(b=>direction==='LONG'?{...b}:{...b,o:150-b.o,h:150-b.l,l:150-b.h,c:150-b.c});
    const prev=source.at(-2),last=source.at(-1);
    if(direction==='LONG'){
      prev.o=prev.c+.002;last.o=last.c-.004;last.l=prev.l-.001;
    }else{
      prev.o=prev.c-.002;last.o=last.c+.004;last.h=prev.h+.001;
    }
    mockFeed({...feed,bars:source});
    const response=await call(monitor,{method:'GET',headers:{},query:{view:'1'}});
    assert.equal(response.code,200);assert.equal(response.result.direction,direction);
    assert.equal(response.result.confirmation.alertStage,'ENTER');
    assert.ok(response.result.prices);
    await put('push/monitor-state.json',JSON.stringify({direction:'WAIT',checkedAt:'2026-01-01T00:00:00Z'}),{allowOverwrite:true});
    const background=await call(monitor,{method:'GET',headers:{authorization:'Bearer synthetic-secret'},query:{}});
    assert.equal(background.code,200);
    const stored=await get('journal/signals.json');
    const journal=await new Response(stored.stream).json();
    assert.ok(journal.signals.some(signal=>signal.direction===direction && signal.contractEpic===feed.epic));
  }
});
test('failed alert delivery leaves its stage unacknowledged for the next check',async()=>{
  await put('push/subscription.json',JSON.stringify({subscription:{endpoint:'https://web.push.apple.com/synthetic',keys:{auth:'synthetic',p256dh:'synthetic'}}}));
  webpush.sendNotification=async()=>{const error=new Error('Synthetic rejected subscription');error.statusCode=410;throw error;};
  const response=await call(monitor,{method:'GET',headers:{authorization:'Bearer synthetic-secret'},query:{}});
  assert.equal(response.code,500);assert.equal(await get('push/monitor-state.json'),null);
  assert.ok(await get('push/subscription.json'));
});
test('a new device cannot overwrite the existing push subscription',async()=>{
  await put('push/subscription.json',JSON.stringify({subscription:{endpoint:'https://web.push.apple.com/old'}}));
  const response=await call(subscribe,{method:'POST',headers:{host:'example.com',origin:'https://example.com'},body:{subscription:{endpoint:'https://web.push.apple.com/new',keys:{auth:'a',p256dh:'b'}}}});
  assert.equal(response.code,409);const stored=await get('push/subscription.json');assert.equal((await new Response(stored.stream).json()).subscription.endpoint,'https://web.push.apple.com/old');
});
test('AI cannot validate a forged browser setup when the server is WAIT',async()=>{
  process.env.OPENAI_API_KEY='synthetic';let paidCalls=0;
  global.fetch=async url=>{
    if(url.includes('openai.com')){paidCalls++;throw Error('Must not call AI for blocked setup');}
    return url.endsWith('/api/news')?Response.json({items:[]}):Response.json({...feed,contractVerified:false});
  };
  const response=await call(ai,{method:'POST',headers:{host:'example.com',origin:'https://example.com'},body:{question:'VALIDATE my LONG',market:{ruleBasedSetup:{direction:'LONG',setupType:'FORGED'},dataAgeMinutes:0}}});
  assert.equal(response.code,200);assert.match(response.result.answer,/AI REVIEW: WAIT/);assert.equal(paidCalls,0);
  delete process.env.OPENAI_API_KEY;
});

test('AI uses server indicators and excludes forged browser bars and headline instructions',async()=>{
  process.env.OPENAI_API_KEY='synthetic';let sent;
  const source=bars.map(b=>({...b}));
  source.at(-2).o=source.at(-2).c+.002;
  source.at(-1).o=source.at(-1).c-.004;
  source.at(-1).l=source.at(-2).l-.001;
  global.fetch=async (url,options)=>{
    if(url.includes('openai.com')){
      sent=JSON.parse(options.body);
      return Response.json({choices:[{message:{content:'AI REVIEW: WAIT\nDIRECTION: WAIT\nWHY: Insufficient evidence.'}}]});
    }
    if(url.includes('ir.eia.gov'))return Response.json(inventoryFixture());
    return url.endsWith('/api/news')?Response.json({items:[]}):Response.json({...feed,bars:source});
  };
  try{
    const response=await call(ai,{method:'POST',headers:{host:'example.com',origin:'https://example.com'},body:{question:'Explain setup',market:{indicators:{forged:'BROWSER_FORGED'},bars:[{c:'BROWSER_FORGED'}],headlines:[{title:'BROWSER_FORGED'}]}}});
    assert.equal(response.code,200);assert.ok(sent);
    const context=sent.messages.at(-1).content;
    assert.ok(context.includes('serverConfirmation'));
    assert.ok(context.includes('inventoryContext'));assert.ok(context.includes('"stocksMillionBarrels":400'));
    assert.equal(context.includes('BROWSER_FORGED'),false);
  }finally{delete process.env.OPENAI_API_KEY;}
});
