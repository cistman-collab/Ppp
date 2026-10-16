const M=60000;
const CACHE_PATH='wti-ig-candles-cache.json';


async function readCache() {
  try {
    const { get } = await import('./storage.js');
    const result = await get(CACHE_PATH);

    if (!result) {
      return { available: true, data: null };
    }

    if (result.statusCode !== 200) {
      return { available: false, data: null };
    }

    return {
      available: true,
      data: await new Response(result.stream).json()
    };
  } catch {
    return { available: false, data: null };
  }
}


async function writeCache(data) {
  try {
    const { put } = await import('./storage.js');
    const previous=await readCache();
    if(!previous.available) return false;

    const old=previous.data;
    if(old?.igHistoryEpic && old.igHistoryEpic!==data?.igHistoryEpic){
      if(
        !data?.igHistoryEpic ||
        !Array.isArray(old.bars) ||
        old.bars.length===0
      ) return false;

      await put(
        'ig-history/backups/'+old.igHistoryEpic+'.json',
        JSON.stringify(old),
        {addRandomSuffix:true}
      );
    }

    if(old?.igHistoryEpic===data?.igHistoryEpic && Array.isArray(old?.bars) && data?.bars?.length){
      const firstKept=data.bars[0].t;
      const pruned=old.bars.filter(b=>b.t<firstKept);
      if(pruned.length){
        await put('ig-history/archives/'+old.igHistoryEpic+'.json',JSON.stringify({epic:old.igHistoryEpic,archivedAt:new Date().toISOString(),bars:pruned}),{addRandomSuffix:true});
      }
    }
    await put(CACHE_PATH, JSON.stringify(data), {
      allowOverwrite: true
    });

    return true;
  } catch {
    return false;
  }
}



function normalizeBars(input){
  const now=Date.now();
  const map=new Map();

  for(const b of input||[]){
  if(
    b?.t==null ||
    b?.o==null ||
    b?.h==null ||
    b?.l==null ||
    b?.c==null
  ){
    continue;
  }

  const x={
    t:Number(b.t),
    o:Number(b.o),
    h:Number(b.h),
    l:Number(b.l),
    c:Number(b.c),
    v:Number.isFinite(Number(b.v))
      ?Number(b.v)
      :0
  };

  if(
  [x.t,x.o,x.h,x.l,x.c].every(Number.isFinite) &&
  x.o>0 &&
  x.h>0 &&
  x.l>0 &&
  x.c>0 &&
  x.h>=Math.max(x.o,x.c) && x.l<=Math.min(x.o,x.c) && x.h>=x.l &&
  x.t%(5*M)===0 &&
  x.t+5*M<=now
){
      map.set(x.t,x);
    }
  }

  return [...map.values()]
    .sort((a,b)=>a.t-b.t)
    .slice(-4000);
}

function expiryRank(expiry){
  const months=[
    'JAN','FEB','MAR','APR','MAY','JUN',
    'JUL','AUG','SEP','OCT','NOV','DEC'
  ];

  const match=
    String(expiry||'')
      .toUpperCase()
      .match(/^([A-Z]{3})-(\d{2})$/);

  if(!match)return NaN;

  const month=
    months.indexOf(match[1]);

  if(month<0)return NaN;

  return(
    (2000+Number(match[2]))*12+
    month
  );
}
async function fetchIG(preferredEpic, historyPoints=2){
  const igFetch=(url,options={})=>fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  const priceDivisor=Number(process.env.IG_PRICE_DIVISOR||100);
  if(!Number.isFinite(priceDivisor)||priceDivisor<=0) throw Error('Invalid IG price divisor');
  let marketStatus=null;
  let delayTime=null;
  const base=
    process.env.IG_BASE_URL;

  const apiKey=
    process.env.IG_API_KEY;

  const username=
    process.env.IG_USERNAME;

  const password=
    process.env.IG_PASSWORD;

  let epic=
  preferredEpic||
  process.env.IG_EPIC;

  let rolloverUsed=false;
  let contractExpiry=null;
  let contractLastDealingAt=null;

  if(
    !base ||
    !apiKey ||
    !username ||
    !password ||
    !epic
  ){
    throw Error(
      'IG environment variables missing'
    );
  }

  const login=await igFetch(
    base+'/session',
    {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'X-IG-API-KEY':apiKey,
        'VERSION':'2'
      },
      body:JSON.stringify({
        identifier:username,
        password,
        encryptedPassword:false
      })
    }
  );

  if(!login.ok){
    throw Error(
      'IG login HTTP '+login.status
    );
  }

  const cst=
    login.headers.get('cst');

  const securityToken=
    login.headers.get(
      'x-security-token'
    );

  if(!cst||!securityToken){
    throw Error(
      'IG session tokens missing'
    );
  }

  try{
  const marketResponse=await igFetch(
    base+'/markets/'+encodeURIComponent(epic),
    {
      headers:{
        'Accept':'application/json',
        'X-IG-API-KEY':apiKey,
        'CST':cst,
        'X-SECURITY-TOKEN':securityToken,
        'VERSION':'3'
      }
    }
  );

  if(marketResponse.ok){
    const marketData=
      await marketResponse.json();

    marketStatus=marketData.snapshot?.marketStatus||null;
    delayTime=marketData.snapshot?.delayTime??null;
    contractExpiry=
      marketData.instrument?.expiry||
      null;

    contractLastDealingAt=
  marketData.instrument?.expiryDetails?.lastDealingDate||
  null;
  }
}catch{
  contractExpiry=null;
  contractLastDealingAt=null;
}

const lastDealingText=String(contractLastDealingAt||'').trim();
const validTimestamp=
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/i
    .test(lastDealingText);
const hasTimeZone=/(?:Z|[+-]\d{2}:\d{2})$/i.test(lastDealingText);
const lastDealingMs=validTimestamp
  ?Date.parse(hasTimeZone?lastDealingText:lastDealingText+'Z')
  :NaN;

if(
  !Number.isFinite(expiryRank(contractExpiry)) ||
  !Number.isFinite(lastDealingMs)
){
  throw Error('IG contract expiry metadata unavailable');
}

contractLastDealingAt=new Date(lastDealingMs).toISOString();

const rolloverNeeded=Date.now()>=lastDealingMs;


  if(rolloverNeeded){
  try{
    const searchResponse=await igFetch(
      base+
      '/markets?searchTerm='+
      encodeURIComponent('Oil - US Crude'),
      {
        headers:{
          'Accept':'application/json',
          'X-IG-API-KEY':apiKey,
          'CST':cst,
          'X-SECURITY-TOKEN':securityToken,
          'VERSION':'1'
        }
      }
    );

    if(searchResponse.ok){
      const searchData=
        await searchResponse.json();

      const currentRank=
        expiryRank(contractExpiry);

      const nextContract=
        (searchData.markets||[])
          .filter(m=>
           String(m.epic||'')
          .startsWith('EN.D.CL.FWS') &&
              Number.isFinite(
              expiryRank(m.expiry)
            ) &&
            expiryRank(m.expiry)>
              currentRank
          )
          .sort(
            (a,b)=>
              expiryRank(a.expiry)-
              expiryRank(b.expiry)
          )[0];

      
      if(nextContract?.epic){
        const nextResponse=await igFetch(
          base+'/markets/'+encodeURIComponent(nextContract.epic),
          {
            headers:{
              'Accept':'application/json',
              'X-IG-API-KEY':apiKey,
              'CST':cst,
              'X-SECURITY-TOKEN':securityToken,
              'VERSION':'3'
            }
          }
        );
        if(!nextResponse.ok){
          throw Error('New IG contract details unavailable');
        }

        const nextData=await nextResponse.json();
        marketStatus=nextData.snapshot?.marketStatus||null;
        delayTime=nextData.snapshot?.delayTime??null;
        const nextExpiry=nextData.instrument?.expiry;
        const nextText=String(
          nextData.instrument?.expiryDetails?.lastDealingDate||''
        ).trim();
        const nextValid=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/i
          .test(nextText);
        const nextZoned=/(?:Z|[+-]\d{2}:\d{2})$/i.test(nextText);
        const nextMs=nextValid
          ?Date.parse(nextZoned?nextText:nextText+'Z')
          :NaN;
        if(
          nextExpiry!==nextContract.expiry ||
          !Number.isFinite(nextMs) ||
          nextMs<=Date.now()
        ){
          throw Error('New IG contract expiry not verified');
        }

        epic=nextContract.epic;
        contractExpiry=nextExpiry;
        contractLastDealingAt=new Date(nextMs).toISOString();
        rolloverUsed=true;
      }

    }
  }catch{}
}
  
 
  if(rolloverNeeded && !rolloverUsed){
    throw Error('IG contract expired; no verified rollover contract');
  }

  const priceHistoryPoints=rolloverUsed
    ?4000
    :historyPoints;

  const response=await igFetch(
    base+
    '/prices/'+
    encodeURIComponent(epic)+
       '?resolution=MINUTE_5&max='+priceHistoryPoints+
    '&pageSize='+priceHistoryPoints,

    {
      headers:{
        'Accept':'application/json',
        'X-IG-API-KEY':apiKey,
        'CST':cst,
        'X-SECURITY-TOKEN':
          securityToken,
        'VERSION':'3'
      }
    }
  );

  const data=
    await response.json();

  if(!response.ok){
    throw Error(
      data?.errorCode ||
      'IG prices HTTP '+
      response.status
    );
  }

  const midpoint=p=>{
    if(
      p?.bid==null ||
      p?.ask==null
    ){
      return null;
    }

    return(
      (Number(p.bid)+Number(p.ask))/2
    )/priceDivisor;
  };

  const bars=
    normalizeBars(
      (data.prices||[])
        .map(p=>({
          t:Date.parse(
            /(?:Z|[+-]\d{2}:\d{2})$/i.test(p.snapshotTimeUTC||'')
              ?p.snapshotTimeUTC:String(p.snapshotTimeUTC||'').replace(/\//g,'-').replace(' ','T')+'Z'
          ),
          o:midpoint(
            p.openPrice
          ),
          h:midpoint(
            p.highPrice
          ),
          l:midpoint(
            p.lowPrice
          ),
          c:midpoint(
            p.closePrice
          ),
          v:
            p.lastTradedVolume
            ??0
        }))
    );

  
  if(!bars.length){
    throw Error(
      'No completed IG candles'
    );
  }

  if(rolloverUsed && bars.length<100){
    throw Error('Insufficient new IG contract history for rollover');
  }

  return{
    bars,
    epic,
    rolloverUsed,
    marketStatus,delayTime,priceDivisor,
    contractExpiry,
    contractLastDealingAt,
    allowance:
      data.metadata?.allowance ||
      data.allowance ||
      null
  };
}

function send(
  res,
  bars,
  meta={}
){
  return res.status(200).json({
    symbol:'WTI',

    source:
      'IG selected-contract completed 5m candles',

    verifiedRealTime:false,

    fetchedAt:
      new Date().toISOString(),

    lastBarAt:
      new Date(
        bars.at(-1).t
      ).toISOString(),

    bars,

    ...meta
  });
}

async function handler(
  req,
  res
){
  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  if(req.method!=='GET'){
    return res.status(405).json({
      error:'GET only'
    });
  }

  try{
    const state=
      await readCache();

        if(!state.available){
      throw Error('IG candle cache unavailable');
    }

    let cache=
      state.data||{};

    let bars=
      normalizeBars(
        cache.bars||[]
      );

    let provider=
      cache.lastProvider||
      'CACHE';

    let allowance=
      cache.allowance||
      null;

    let igError=null;

    const now=
      Date.now();

    const lastBarTime=
      bars.at(-1)?.t||
      0;

    const gapTooLarge=
      !lastBarTime ||
      now-lastBarTime>
      15*M;

        // History is rebuilt from the selected IG contract below.

    const igBucket=
      Math.floor(
        (now-30000)/
        (5*M)
      );

    if(
      cache.igAttemptBucket
      !==
      igBucket
    ){
      const marked=
        await writeCache({
          ...cache,
          bars,
          igAttemptBucket:
            igBucket,
          lastProvider:
            provider,
          allowance,
          updatedAt:
            new Date()
              .toISOString()
        });

            if(!marked){
        throw Error('IG candle cache write unavailable');
      }

      cache.igAttemptBucket=
        igBucket;

      try{
                       
        const configuredEpic=process.env.IG_EPIC||null;
        const requestedEpic=
          configuredEpic &&
          cache.igConfiguredEpic &&
          configuredEpic!==cache.igConfiguredEpic
            ? configuredEpic
            : (cache.igEpic||configuredEpic);

        const rebuildHistory=
          cache.igHistoryEpic!==requestedEpic;

                const lastHistoryUpdate=
          Date.parse(cache.igHistoryUpdatedAt||'')||lastBarTime;

        const historyPoints=rebuildHistory
          ?4000
          :Math.min(
            4000,
            Math.max(
              2,
              Math.ceil((now-lastHistoryUpdate)/(5*M))+1
            )
          );

        
        const ig=
          await fetchIG(requestedEpic,historyPoints);
        const contractChanged=
          ig.epic!==cache.igHistoryEpic;

        if(contractChanged){
          if(rebuildHistory && ig.epic!==requestedEpic && !ig.rolloverUsed){
            throw Error('Unexpected IG contract during rebuild');
          }
          if(!rebuildHistory && ig.rolloverUsed!==true){
            throw Error('Unexpected IG contract change');
          }
          if(ig.bars.length<100){
            throw Error('Insufficient IG history for rebuild');
          }
          bars=normalizeBars(ig.bars);
        }else if(rebuildHistory){
          throw Error('Requested IG contract was not selected');
        }else{
          bars=normalizeBars([
            ...bars,
            ...ig.bars
          ]);
        }


        cache.igHistoryEpic=ig.epic;
        cache.igHistoryUpdatedAt=new Date(now).toISOString();

        provider='IG';

        allowance=
          ig.allowance;
       
        cache.igEpic=ig.epic;
        if(configuredEpic){
          cache.igConfiguredEpic=configuredEpic;
        }

cache.marketStatus=ig.marketStatus;
cache.delayTime=ig.delayTime;
cache.priceDivisor=ig.priceDivisor;
cache.contractExpiry=
  ig.contractExpiry;

cache.contractLastDealingAt=
  ig.contractLastDealingAt;

cache.rolloverUsed=
  ig.rolloverUsed;

           }catch(e){
        throw Error(
          'IG candle update failed: '+e.message
        );
      }

      cache={
        ...cache,
        bars,
        lastProvider:
          provider,
        allowance,
        updatedAt:
          new Date()
            .toISOString()
      };

           const historySaved=await writeCache(cache);

      if(!historySaved){
        throw Error('Could not save IG candle history');
      }
    }
    
     const configuredEpic=process.env.IG_EPIC||null;
    const selectedEpic=
      configuredEpic &&
      cache.igConfiguredEpic &&
      configuredEpic!==cache.igConfiguredEpic
        ? configuredEpic
        : (cache.igEpic||configuredEpic);

    if(
      !selectedEpic ||
      cache.igHistoryEpic!==selectedEpic ||
      cache.igEpic!==selectedEpic
    ){
      throw Error('Selected IG contract history is not ready');
    }

    
    if(bars.length<40){
      throw Error(
        'Insufficient historical candles'
      );
    }

    return send(
      res,
      bars,
      {
        activeProvider:
          provider,

        fallbackUsed:
          provider===
          'YAHOO FALLBACK',

        igError,

        contractVerified:
          provider==='IG' && Date.parse(cache.contractLastDealingAt)>now &&
          now-(bars.at(-1).t+5*M)<=15*M && cache.priceDivisor===Number(process.env.IG_PRICE_DIVISOR||100),
        marketStatus:cache.marketStatus||'UNKNOWN',
        delayTime:cache.delayTime??null,

        epic:
  cache.igEpic||
  process.env.IG_EPIC||
  null,

contractExpiry:
  cache.contractExpiry||
  null,

contractLastDealingAt:
  cache.contractLastDealingAt||
  null,

rolloverUsed:
  cache.rolloverUsed===true,

allowance
      }
    );

  }catch(e){
    return res
      .status(503)
      .json({
        error:e.message,

        source:
          'IG selected-contract completed 5m candles',

        fallbackUsed:true,

        verifiedRealTime:false
      });
  }
};

// Browser refreshes and the monitor share one IG request and one cache write.
let inFlight;
export default async function candles(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  if(!inFlight){
    const work=(async()=>{
      let code=200,payload;
      await handler(req,{setHeader(){},status(value){code=value;return this;},json(value){payload=value;return this;}});
      return {code,payload};
    })();
    inFlight=work;
    work.finally(()=>{if(inFlight===work)inFlight=null;}).catch(()=>{});
  }
  const {code,payload}=await inFlight;
  return res.status(code).json(payload);
}
