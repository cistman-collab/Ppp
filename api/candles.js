const M=60000;
const CACHE_PATH='wti-ig-candles-cache.json';

async function readCache(){
  const token=process.env.BLOB_READ_WRITE_TOKEN;
  if(!token)return{available:false,data:null};

  try{
    const {get}=await import('@vercel/blob');
    const result=await get(CACHE_PATH,{
      access:'private',
      token,
      useCache:false
    });

    if(!result)return{available:true,data:null};
    if(result.statusCode!==200)return{available:false,data:null};

    return{
      available:true,
      data:await new Response(result.stream).json()
    };
  }catch{
    return{available:false,data:null};
  }
}

async function writeCache(data){
  const token=process.env.BLOB_READ_WRITE_TOKEN;
  if(!token)return false;

  try{
    const {put}=await import('@vercel/blob');

    await put(
      CACHE_PATH,
      JSON.stringify(data),
      {
        access:'private',
        addRandomSuffix:false,
        allowOverwrite:true,
        contentType:'application/json',
        token
      }
    );

    return true;
  }catch{
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

async function fetchYahoo(){
  const controller=new AbortController();
  const timer=setTimeout(
    ()=>controller.abort(),
    9000
  );

  try{
    const response=await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=30d',
      {
        signal:controller.signal,
        headers:{
          'User-Agent':'Mozilla/5.0',
          'Accept':'application/json'
        }
      }
    );

    if(!response.ok){
      throw Error(
        'Yahoo HTTP '+response.status
      );
    }

    const data=await response.json();

    const result=
      data.chart?.result?.[0];

    const quote=
      result?.indicators?.quote?.[0];

    if(
      !result?.timestamp ||
      !quote
    ){
      throw Error(
        'No Yahoo candle data'
      );
    }

    return normalizeBars(
      result.timestamp.map(
        (t,i)=>({
          t:t*1000,
          o:quote.open[i],
          h:quote.high[i],
          l:quote.low[i],
          c:quote.close[i],
          v:quote.volume?.[i]??0
        })
      )
    );

  }finally{
    clearTimeout(timer);
  }
}

async function fetchIG(){
  const base=
    process.env.IG_BASE_URL;

  const apiKey=
    process.env.IG_API_KEY;

  const username=
    process.env.IG_USERNAME;

  const password=
    process.env.IG_PASSWORD;

  const epic=
    process.env.IG_EPIC;

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

  const login=await fetch(
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

  const response=await fetch(
    base+
    '/prices/'+
    encodeURIComponent(epic)+
    '?resolution=MINUTE_5&max=2&pageSize=2',
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
      (p.bid+p.ask)/2
    )/100;
  };

  const bars=
    normalizeBars(
      (data.prices||[])
        .map(p=>({
          t:Date.parse(
            p.snapshotTimeUTC
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

  return{
    bars,
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
      'IG primary with Yahoo historical seed/fallback',

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

module.exports=async(
  req,
  res
)=>{
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
      const bars=
        await fetchYahoo();

      return send(
        res,
        bars,
        {
          activeProvider:
            'YAHOO FALLBACK',

          fallbackUsed:true,

          igError:
            'IG cache unavailable',

          contractVerified:false
        }
      );
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

    if(
      bars.length<40 ||
      gapTooLarge
    ){
      const yahoo=
        await fetchYahoo();

      bars=
        normalizeBars([
          ...bars,
          ...yahoo
        ]);

      const seeded=
        await writeCache({
          ...cache,
          bars,
          updatedAt:
            new Date()
              .toISOString()
        });

      if(!seeded){
        return send(
          res,
          bars,
          {
            activeProvider:
              'YAHOO FALLBACK',

            fallbackUsed:true,

            igError:
              'IG cache write unavailable',

            contractVerified:false
          }
        );
      }
    }

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
        const yahoo=
          await fetchYahoo();

        bars=
          normalizeBars([
            ...bars,
            ...yahoo
          ]);

        return send(
          res,
          bars,
          {
            activeProvider:
              'YAHOO FALLBACK',

            fallbackUsed:true,

            igError:
              'IG cache write unavailable',

            contractVerified:false
          }
        );
      }

      cache.igAttemptBucket=
        igBucket;

      try{
        const ig=
          await fetchIG();

        bars=
          normalizeBars([
            ...bars,
            ...ig.bars
          ]);

        provider='IG';

        allowance=
          ig.allowance;

      }catch(e){
        igError=
          e.message;

        provider=
          'YAHOO FALLBACK';

        const yahoo=
          await fetchYahoo();

        bars=
          normalizeBars([
            ...bars,
            ...yahoo
          ]);
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

      await writeCache(
        cache
      );
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
          provider==='IG',

        epic:
          process.env
            .IG_EPIC||
          null,

        allowance
      }
    );

  }catch(e){
    return res
      .status(503)
      .json({
        error:e.message,

        source:
          'IG primary with Yahoo fallback',

        fallbackUsed:true,

        verifiedRealTime:false
      });
  }
};
