// Official public EIA WPSR JSON. Fixed source; no API key or client-supplied URLs.
const SOURCE='https://ir.eia.gov/wpsr/psw00.json';
const DAY=86400000;
let cached=null,nextFetch=0,pending=null;
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid report date');
  const stamp=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)throw Error('Invalid report date');
  return stamp;
}
export function parseInventory(data,now=Date.now()){
  const m=data?.metadata,s=data?.data?.['U.S.'];
  if(m?.source!=='U.S. Energy Information Administration'||m.periodicity!=='Weekly'||s?.sourcekey!=='WCESTUS1'||s.units!=='thousand barrels'||!Array.isArray(s.time_series))throw Error('Unexpected EIA series');
  const release=date(m.release_date);
  const rows=s.time_series.map(row=>({...row,stamp:date(row.date)})).sort((a,b)=>b.stamp-a.stamp);
  if(rows.length<2 || new Set(rows.map(row=>row.date)).size!==rows.length)throw Error('Incomplete or duplicate weeks');
  const [last,previous]=rows;
  if(last.stamp>release || release>now || last.stamp>now || release-last.stamp>14*DAY || last.stamp-previous.stamp!==7*DAY)throw Error('Invalid inventory chronology');
  for(const row of [last,previous])if(row.suppression_flag!==null || !Number.isFinite(row.value) || row.value<=0)throw Error('Inventory value missing or suppressed');
  const change=Number(((last.value-previous.value)/1000).toFixed(3));
  return {status:now-release>10*DAY||now-last.stamp>16*DAY?'STALE':'AVAILABLE',source:'EIA',sourceUrl:SOURCE,
    scope:'US commercial crude excluding SPR',releaseDate:m.release_date,weekEnding:last.date,previousWeekEnding:previous.date,
    stocksMillionBarrels:last.value/1000,previousStocksMillionBarrels:previous.value/1000,changeMillionBarrels:change,
    movement:change>0?'BUILD':change<0?'DRAW':'UNCHANGED',consensus:null,surprise:null,
    note:'Weekly US stocks, not global inventory or a live price signal. No consensus forecast is connected.'};
}
export function resetInventoryCache(){cached=null;nextFetch=0;pending=null;}
export async function getInventories(){
  const now=Date.now();
  if(process.env.WTI_PREVIEW_MODE==='synthetic')return {status:'UNAVAILABLE',source:'EIA',sourceUrl:SOURCE,note:'Live inventories are disabled in the isolated synthetic preview.'};
  if(now<nextFetch && cached){
    if(cached.releaseDate && cached.status==='AVAILABLE' && (now-date(cached.releaseDate)>10*DAY||now-date(cached.weekEnding)>16*DAY))return {...cached,status:'STALE'};
    return cached;
  }
  if(pending)return pending;
  pending=(async()=>{
    try{
      const response=await fetch(SOURCE,{signal:AbortSignal.timeout(6000),headers:{Accept:'application/json'}});
      if(!response.ok || (response.url && new URL(response.url).hostname!=='ir.eia.gov'))throw Error('EIA unavailable');
      const text=await response.text();if(text.length>2000000)throw Error('EIA response too large');
      cached={...parseInventory(JSON.parse(text),now),fetchedAt:new Date(now).toISOString()};
      // A weekly release does not need a request on every phone refresh.
      nextFetch=now+30*60000;
    }catch{
      cached={status:'UNAVAILABLE',source:'EIA',sourceUrl:SOURCE,fetchedAt:new Date(now).toISOString(),note:'Official inventory figures could not be verified. No inventory-based confirmation is available.'};
      nextFetch=now+5*60000;
    }finally{pending=null;}
    return cached;
  })();
  return pending;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  return res.status(200).json({ok:true,...await getInventories()});
}
