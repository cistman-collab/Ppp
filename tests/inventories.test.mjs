import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInventory,getInventories,resetInventoryCache} from '../api/inventories.js';
const now=Date.parse('2026-10-17T12:00:00Z');
function fixture(){return {metadata:{source:'U.S. Energy Information Administration',periodicity:'Weekly',release_date:'2026-10-15'},data:{'U.S.':{sourcekey:'WCESTUS1',units:'thousand barrels',time_series:[{date:'2026-10-02',value:405000,suppression_flag:null},{date:'2026-10-09',value:400000,suppression_flag:null}]}}};}
test('official weekly inventory units, changes, dates and scope are normalized without invented consensus',()=>{
 const p=parseInventory(fixture(),now);assert.equal(p.stocksMillionBarrels,400);assert.equal(p.changeMillionBarrels,-5);assert.equal(p.movement,'DRAW');assert.equal(p.consensus,null);assert.equal(p.surprise,null);assert.match(p.scope,/US/);
 const b=fixture();b.data['U.S.'].time_series[1].value=410000;assert.equal(parseInventory(b,now).movement,'BUILD');
 assert.equal(parseInventory(fixture(),now+20*86400000).status,'STALE');
});
test('inventory parser rejects wrong series, units, missing latest values, duplicate/gapped/future dates',()=>{
 const mutations=[p=>p.data['U.S.'].sourcekey='SPR',p=>p.data['U.S.'].units='barrels',p=>p.data['U.S.'].time_series[1].value=null,p=>p.data['U.S.'].time_series[1].suppression_flag='-',p=>p.data['U.S.'].time_series[0].date='2026-10-09',p=>p.data['U.S.'].time_series[0].date='2026-09-25',p=>p.metadata.release_date='2026-10-19',p=>p.metadata.release_date='2026-02-30'];
 for(const mutate of mutations){const p=fixture();mutate(p);assert.throws(()=>parseInventory(p,now));}
});
test('inventory requests coalesce, cache, retry after failures and remain isolated in preview',async()=>{
 const originalFetch=global.fetch,originalNow=Date.now,originalPreview=process.env.WTI_PREVIEW_MODE;
 let clock=now,calls=0;Date.now=()=>clock;delete process.env.WTI_PREVIEW_MODE;resetInventoryCache();
 try{
  global.fetch=async url=>{assert.equal(url,'https://ir.eia.gov/wpsr/psw00.json');calls++;return Response.json(fixture());};
  const [a,b]=await Promise.all([getInventories(),getInventories()]);assert.equal(a.status,'AVAILABLE');assert.equal(b.status,'AVAILABLE');assert.equal(calls,1);
  await getInventories();assert.equal(calls,1);
  clock+=31*60000;global.fetch=async()=>{calls++;throw Error('offline');};
  assert.equal((await getInventories()).status,'UNAVAILABLE');await getInventories();assert.equal(calls,2);
  clock+=6*60000;await getInventories();assert.equal(calls,3);
  process.env.WTI_PREVIEW_MODE='synthetic';assert.match((await getInventories()).note,/disabled/);assert.equal(calls,3);
 }finally{global.fetch=originalFetch;Date.now=originalNow;resetInventoryCache();if(originalPreview===undefined)delete process.env.WTI_PREVIEW_MODE;else process.env.WTI_PREVIEW_MODE=originalPreview;}
});
