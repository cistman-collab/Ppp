import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import candles from '../api/candles.js';
import {put,get} from '../api/storage.js';
const now=Date.UTC(2026,9,13,15,0,45);
const originalFetch=global.fetch,originalNow=Date.now;
let dir;
test.beforeEach(()=>{
  fs.mkdirSync('test-data',{recursive:true});dir=fs.mkdtempSync(path.resolve('test-data','ig-'));
  Object.assign(process.env,{WTI_DATA_DIR:dir,IG_BASE_URL:'https://demo-api.ig.com/gateway/deal',IG_API_KEY:'synthetic-key',IG_USERNAME:'synthetic',IG_PASSWORD:'synthetic',IG_EPIC:'EN.D.CL.FWS1'});
  Date.now=()=>now;
});
test.afterEach(()=>{global.fetch=originalFetch;Date.now=originalNow;fs.rmSync(dir,{recursive:true,force:true});});
const fixturePrices=()=>Array.from({length:120},(_,i)=>{
  const t=now-45000-(120-i)*300000;
  const quote=n=>({bid:n-1,ask:n+1});
  return {snapshotTimeUTC:new Date(t).toISOString().slice(0,-1),openPrice:quote(7000),highPrice:quote(7020),lowPrice:quote(6980),closePrice:quote(7010),lastTradedVolume:20};
});
const market=(epic,expiry,last)=>({instrument:{epic,expiry,expiryDetails:{lastDealingDate:last}},snapshot:{marketStatus:'TRADEABLE',delayTime:0}});
async function run(){let result,code;await candles({method:'GET'},{setHeader(){},status(n){code=n;return this;},json(x){result=x;return this;}});return {code,result};}
test('IG timezone-less UTC candles are normalized consistently and contract verified',async()=>{
  global.fetch=async url=>{
    if(url.endsWith('/session'))return new Response('{}',{headers:{cst:'mock','x-security-token':'mock'}});
    if(url.includes('/markets/'))return Response.json(market('EN.D.CL.FWS1','NOV-26','2026-10-20T18:00:00'));
    return Response.json({prices:fixturePrices()});
  };
  const {code,result}=await run();assert.equal(code,200);assert.equal(result.contractVerified,true);
  assert.equal(result.bars.at(-1).c,70.1);assert.equal(result.marketStatus,'TRADEABLE');
  assert.equal(result.bars.at(-1).t,now-45000-300000);
});
test('rollover backs up old history and never blends different contract prices',async()=>{
  const old={igEpic:'EN.D.CL.FWS1',igConfiguredEpic:'EN.D.CL.FWS1',igHistoryEpic:'EN.D.CL.FWS1',lastProvider:'IG',bars:[{t:now-45000-300000,o:99,h:100,l:98,c:99,v:1}]};
  await put('wti-ig-candles-cache.json',JSON.stringify(old));
  global.fetch=async url=>{
    if(url.endsWith('/session'))return new Response('{}',{headers:{cst:'mock','x-security-token':'mock'}});
    if(url.includes('searchTerm'))return Response.json({markets:[{epic:'EN.D.CL.FWS2',expiry:'DEC-26'}]});
    if(url.includes('/markets/'))return Response.json(url.endsWith('FWS1')?market('EN.D.CL.FWS1','NOV-26','2026-10-12T18:00:00'):market('EN.D.CL.FWS2','DEC-26','2026-11-20T18:00:00'));
    return Response.json({prices:fixturePrices()});
  };
  const {code,result}=await run();assert.equal(code,200);assert.equal(result.epic,'EN.D.CL.FWS2');
  assert.equal(result.rolloverUsed,true);assert.ok(result.bars.every(b=>b.c===70.1));
  const backups=fs.readdirSync(path.join(dir,'ig-history','backups'));assert.equal(backups.length,1);
  const backup=JSON.parse(fs.readFileSync(path.join(dir,'ig-history','backups',backups[0])));assert.equal(backup.bars[0].c,99);
});
test('failed IG updates block response and retain previous history',async()=>{
  const old={igEpic:'EN.D.CL.FWS1',igHistoryEpic:'EN.D.CL.FWS1',bars:[{t:now-45000-300000,o:70,h:71,l:69,c:70}]};
  await put('wti-ig-candles-cache.json',JSON.stringify(old));global.fetch=async()=>new Response('{}',{status:401});
  const {code,result}=await run();assert.equal(code,503);assert.equal(result.verifiedRealTime,false);
  const stored=await get('wti-ig-candles-cache.json');const data=await new Response(stored.stream).json();assert.deepEqual(data.bars[0].c,70);
});
test('expired contract without verified successor fails closed',async()=>{
  global.fetch=async url=>{
    if(url.endsWith('/session'))return new Response('{}',{headers:{cst:'mock','x-security-token':'mock'}});
    if(url.includes('searchTerm'))return Response.json({markets:[]});
    return Response.json(market('EN.D.CL.FWS1','NOV-26','2026-10-12T18:00:00'));
  };
  const {code,result}=await run();assert.equal(code,503);assert.match(result.error,/expired/);
});
test('concurrent refreshes share one IG login and response',async()=>{
  let logins=0;
  global.fetch=async url=>{
    if(url.endsWith('/session')){logins++;await new Promise(resolve=>setTimeout(resolve,10));return new Response('{}',{headers:{cst:'mock','x-security-token':'mock'}});}
    if(url.includes('/markets/'))return Response.json(market('EN.D.CL.FWS1','NOV-26','2026-10-20T18:00:00'));
    return Response.json({prices:fixturePrices()});
  };
  const [a,b]=await Promise.all([run(),run()]);assert.equal(logins,1);assert.equal(a.code,200);assert.deepEqual(a.result,b.result);
});
test('history outside the active window is archived before same-contract pruning',async()=>{
  const oldBars=Array.from({length:4100},(_,i)=>({t:now-45000-(4100-i)*300000,o:70,h:71,l:69,c:70,v:1}));
  await put('wti-ig-candles-cache.json',JSON.stringify({igEpic:'EN.D.CL.FWS1',igConfiguredEpic:'EN.D.CL.FWS1',igHistoryEpic:'EN.D.CL.FWS1',lastProvider:'IG',bars:oldBars}));
  global.fetch=async url=>{
    if(url.endsWith('/session'))return new Response('{}',{headers:{cst:'mock','x-security-token':'mock'}});
    if(url.includes('/markets/'))return Response.json(market('EN.D.CL.FWS1','NOV-26','2026-10-20T18:00:00'));
    return Response.json({prices:fixturePrices()});
  };
  const {code,result}=await run();assert.equal(code,200);assert.equal(result.bars.length,4000);
  const files=fs.readdirSync(path.join(dir,'ig-history','archives'));assert.equal(files.length,1);
  const archive=JSON.parse(fs.readFileSync(path.join(dir,'ig-history','archives',files[0])));
  assert.equal(archive.bars.length,100);assert.equal(archive.bars[0].t,oldBars[0].t);
});
