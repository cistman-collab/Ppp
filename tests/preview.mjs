// Isolated synthetic preview. Never imports production credentials or subscriptions.
import fs from 'node:fs';
import path from 'node:path';
const now=Date.now(),end=Math.floor(now/300000)*300000;
Object.assign(process.env,{PORT:'10000',WTI_DATA_DIR:path.resolve('test-data','preview'),
  WTI_MONITOR_ENABLED:'false',IG_EPIC:'EN.D.CL.FWS.TEST'});
for(const name of ['WTI_MONITOR_SECRET','WTI_ACCESS_TOKEN','IG_API_KEY','IG_USERNAME','IG_PASSWORD','OPENAI_API_KEY','VAPID_PRIVATE_KEY']) delete process.env[name];
const bars=Array.from({length:4000},(_,i)=>{
  const c=70+i*.001+i*i*.0000001;
  return {t:end-(4000-i)*300000,o:c-.002,h:c+.01,l:c-.01,c,v:100};
});
fs.mkdirSync(process.env.WTI_DATA_DIR,{recursive:true});
fs.writeFileSync(path.join(process.env.WTI_DATA_DIR,'wti-ig-candles-cache.json'),JSON.stringify({
  bars,igEpic:process.env.IG_EPIC,igConfiguredEpic:process.env.IG_EPIC,igHistoryEpic:process.env.IG_EPIC,
  lastProvider:'IG',igAttemptBucket:Math.floor((now-30000)/300000),contractExpiry:'TEST-26',
  marketStatus:'TRADEABLE',delayTime:0,priceDivisor:100,contractLastDealingAt:'2026-12-31T18:00:00Z'
}));
const realFetch=global.fetch;
global.fetch=async(url,options)=>{
  if(String(url).includes('/api/news'))return Response.json({items:[],maritime:{risk:'UNKNOWN'}});
  if(String(url).startsWith('https://news.google.com'))return new Response('<rss><channel></channel></rss>');
  return realFetch(url,options);
};
await import('../server.mjs');
