import { get, put } from '@vercel/blob';
import webpush from 'web-push';

const M=60000;

function ema(a,p){
  if(!a.length)return[];

  const k=2/(p+1);
  let v=a[0];

  return a.map(
    (x,i)=>v=i?v+(x-v)*k:x
  );
}

function aggregate(input,min){
  if(min===5)return input;

  const size=min*M;
  const out=[];

  for(const b of input){
    const t=
      Math.floor(b.t/size)*size;

    let x=out.at(-1);

    if(!x||x.t!==t){
      x={
        t,
        o:b.o,
        h:b.h,
        l:b.l,
        c:b.c,
        n:0
      };

      out.push(x);

    }else{
      x.h=Math.max(x.h,b.h);
      x.l=Math.min(x.l,b.l);
      x.c=b.c;
    }

    x.n++;
  }

  return out.filter(
    x=>x.n===min/5
  );
}

function indicators(b){
  if(b.length<35)return null;

  const c=b.map(x=>x.c);

  const fast=
    ema(c,9).at(-1);

  const slow=
    ema(c,21).at(-1);

  const e12=ema(c,12);
  const e26=ema(c,26);

  const mac=
    e12.map(
      (x,i)=>x-e26[i]
    );

  const sig=
    ema(mac,9);

  let gain=0;
  let loss=0;

  for(
    let i=b.length-14;
    i<b.length;
    i++
  ){
    const d=
      b[i].c-b[i-1].c;

    gain+=Math.max(0,d);
    loss+=Math.max(0,-d);
  }

  const rsi=
    loss===0
    ?100
    :100-100/(1+gain/loss);

  return{
    trend:
      fast>slow
      ?'BULLISH'
      :fast<slow
      ?'BEARISH'
      :'NEUTRAL',

    rsi,
    hist:
      mac.at(-1)-sig.at(-1)
  };
}

function makeDirection(
  bars,
  i5,
  i15,
  i60,
  i240
){
  const completedAt=
    bars.at(-1).t+5*M;

  const ageMinutes=
    Math.max(
      0,
      (Date.now()-completedAt)/M
    );

  if(ageMinutes>15){
    return 'WAIT';
  }

  if(
    i5.trend!==i15.trend
  ){
    return 'WAIT';
  }

  if(
    i15.trend!==i60.trend
  ){
    return 'WAIT';
  }

  if(
    i240 &&
    i240.trend!=='NEUTRAL' &&
    i240.trend!==i15.trend
  ){
    return 'WAIT';
  }

  const bullishMomentum=
    i15.rsi>50 &&
    i15.hist>0 &&
    i5.hist>0;

  const bearishMomentum=
    i15.rsi<50 &&
    i15.hist<0 &&
    i5.hist<0;

  if(
    i15.trend==='BULLISH' &&
    bullishMomentum
  ){
    return 'LONG';
  }

  if(
    i15.trend==='BEARISH' &&
    bearishMomentum
  ){
    return 'SHORT';
  }

  return 'WAIT';
}

async function readBlob(path){
  const result=
    await get(
      path,
      {
        access:'private',
        token:
          process.env
            .BLOB_READ_WRITE_TOKEN,
        useCache:false
      }
    );

  if(
    !result ||
    result.statusCode!==200
  ){
    return null;
  }

  return await new Response(
    result.stream
  ).json();
}

async function saveBlob(
  path,
  data
){
  await put(
    path,
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      access:'private',
      addRandomSuffix:false,
      allowOverwrite:true,
      contentType:
        'application/json',
      token:
        process.env
          .BLOB_READ_WRITE_TOKEN
    }
  );
}

export default async function handler(
  req,
  res
){
  try{
    const response=
      await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=30d',
        {
          headers:{
            'User-Agent':'Mozilla/5.0',
            'Accept':'application/json'
          }
        }
      );

    if(!response.ok){
      throw new Error(
        'WTI data HTTP '+
        response.status
      );
    }

    const data=
      await response.json();

    const result=
      data.chart?.result?.[0];

    const quote=
      result
        ?.indicators
        ?.quote?.[0];

    if(
      !result?.timestamp ||
      !quote
    ){
      throw new Error(
        'No WTI candle data'
      );
    }

    const now=Date.now();

    const bars=
      result.timestamp
        .map(
          (t,i)=>({
            t:t*1000,
            o:quote.open[i],
            h:quote.high[i],
            l:quote.low[i],
            c:quote.close[i]
          })
        )
        .filter(
          b=>
            [
              b.o,
              b.h,
              b.l,
              b.c
            ].every(Number.isFinite)
            &&
            b.t+5*M<=now
        )
        .slice(-4000);

    const b15=
      aggregate(bars,15);

    const b60=
      aggregate(bars,60);

    const b240=
      aggregate(bars,240);

    const i5=
      indicators(bars);

    const i15=
      indicators(b15);

    const i60=
      indicators(b60);

    const i240=
      indicators(b240);

    if(
      !i5 ||
      !i15 ||
      !i60 ||
      !i240
    ){
      throw new Error(
        'Not enough candle data'
      );
    }

    const current=
      makeDirection(
        bars,
        i5,
        i15,
        i60,
        i240
      );

    const previous=
      await readBlob(
        'push/monitor-state.json'
      );

    const oldDirection=
      previous?.direction??null;

    await saveBlob(
      'push/monitor-state.json',
      {
        direction:current,
        checkedAt:
          new Date()
            .toISOString()
      }
    );

    if(
      oldDirection===null ||
      oldDirection===current
    ){
      return res
        .status(200)
        .json({
          ok:true,
          direction:current,
          changed:false
        });
    }

    const stored=
      await readBlob(
        'push/subscription.json'
      );

    if(!stored?.subscription){
      return res
        .status(200)
        .json({
          ok:true,
          direction:current,
          changed:true,
          push:false
        });
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    let body='';

    if(current==='LONG'){
      body=
        'Potential LONG research setup appeared. Open WTI Pro to review confirmation.';
    }

    else if(current==='SHORT'){
      body=
        'Potential SHORT research setup appeared. Open WTI Pro to review confirmation.';
    }

    else{
      body=
        'Previous '+
        oldDirection+
        ' setup is no longer active. Current status: WAIT.';
    }

    await webpush.sendNotification(
      stored.subscription,
      JSON.stringify({
        title:
          'WTI Pro · Setup Change',
        body,
        url:'/simple.html'
      })
    );

    return res
      .status(200)
      .json({
        ok:true,
        previous:
          oldDirection,
        direction:
          current,
        changed:true,
        push:true
      });

  }catch(e){
    console.error(
      'WTI monitor failed:',
      e
    );

    return res
      .status(500)
      .json({
        error:e.message
      });
  }
}
