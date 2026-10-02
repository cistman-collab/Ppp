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
function atr(b,p=14){
  if(b.length<p+1)return .5;

  const vals=[];

  for(let i=1;i<b.length;i++){
    const x=b[i];
    const prev=b[i-1];

    vals.push(
      Math.max(
        x.h-x.l,
        Math.abs(x.h-prev.c),
        Math.abs(x.l-prev.c)
      )
    );
  }

  return vals
    .slice(-p)
    .reduce((a,b)=>a+b,0)/p;
}
function makeSetupPrices(direction,b15,bars){
  if(direction==='WAIT'){
    return null;
  }

  const a=atr(b15);
  const px=bars.at(-1).c;

  if(direction==='LONG'){
    return{
      entryLow:px-a*.15,
      entryHigh:px+a*.10,
      stop:px-a,
      tp1:px+a,
      tp2:px+a*2
    };
  }

  if(direction==='SHORT'){
    return{
      entryLow:px-a*.10,
      entryHigh:px+a*.15,
      stop:px+a,
      tp1:px-a,
      tp2:px-a*2
    };
  }

  return null;
}
 
function getLevels(bars){
  const recent=bars.slice(-30);

  return{
    resistance:
      Math.max(
        ...recent.map(x=>x.h)
      ),

    support:
      Math.min(
        ...recent.map(x=>x.l)
      ),

    price:
  bars.at(-1).c,

distanceToResistance:
  Math.max(
    0,
    Math.max(...recent.map(x=>x.h))-
    bars.at(-1).c
  ),

distanceToSupport:
  Math.max(
    0,
    bars.at(-1).c-
    Math.min(...recent.map(x=>x.l))
  )
    
  };
  
  }

function getLevelZones(bars,b15){
  const levels=getLevels(bars);
  const a=atr(b15);
  const zoneSize=Math.max(0.10,a*.25);

  return{
    supportZoneLow:levels.support,
    supportZoneHigh:levels.support+zoneSize,
    resistanceZoneLow:levels.resistance-zoneSize,
    resistanceZoneHigh:levels.resistance
  };
}

function makeLevelSetup(bars,b15,i5,i15){
  const levels=getLevels(bars);
  const a=atr(b15);
  const zoneSize=Math.max(0.10,a*.25);
  const px=levels.price;
  const prev=bars.at(-2).c;
  const last=bars.at(-1);

  const breakoutLevels=
  getLevels(bars.slice(0,-1));

  const nearSupport=
    px<=levels.support+zoneSize;

  const nearResistance=
    px>=levels.resistance-zoneSize;
    
  const bullishBreakout=
  prev<=breakoutLevels.resistance &&
  last.c>breakoutLevels.resistance &&
  i5.hist>0;

const bearishBreakout=
  prev>=breakoutLevels.support &&
  last.c<breakoutLevels.support &&
  i5.hist<0;

   if(bullishBreakout){
  return{
    type:'BULLISH BREAKOUT',
    direction:'LONG',
    entryLow:breakoutLevels.resistance,
    entryHigh:breakoutLevels.resistance+zoneSize,
    stop:breakoutLevels.resistance-a*.5,
    tp1:px+a,
    tp2:px+a*2
  };
}

if(bearishBreakout){
  return{
    type:'BEARISH BREAKOUT',
    direction:'SHORT',
    entryLow:breakoutLevels.support-zoneSize,
    entryHigh:breakoutLevels.support,
    stop:breakoutLevels.support+a*.5,
    tp1:px-a,
    tp2:px-a*2
  };
}

    if(
    nearSupport &&
    i15.trend==='BULLISH' &&
    i5.hist>0
  ){
    return{
      type:'SUPPORT RETEST',
      direction:'LONG',
      entryLow:levels.support,
      entryHigh:levels.support+zoneSize,
      stop:levels.support-a*.5,
      tp1:px+a,
      tp2:px+a*2
    };
  }

  if(
    nearResistance &&
    i15.trend==='BEARISH' &&
    i5.hist<0
  ){
    return{
      type:'RESISTANCE REJECTION',
      direction:'SHORT',
      entryLow:levels.resistance-zoneSize,
      entryHigh:levels.resistance,
      stop:levels.resistance+a*.5,
      tp1:px-a,
      tp2:px-a*2
    };
  }

  if(
  nearResistance &&
  last.c<last.o &&
  i5.hist<0
){
  return{
    type:'RESISTANCE REJECTION SCALP',
    direction:'SHORT',
    entryLow:levels.resistance-zoneSize,
    entryHigh:levels.resistance,
    stop:levels.resistance+a*.4,
    tp1:px-a*.75,
    tp2:px-a*1.5
  };
}

if(
  nearSupport &&
  last.c>last.o &&
  i5.hist>0
){
  return{
    type:'SUPPORT BOUNCE SCALP',
    direction:'LONG',
    entryLow:levels.support,
    entryHigh:levels.support+zoneSize,
    stop:levels.support-a*.4,
    tp1:px+a*.75,
    tp2:px+a*1.5
  };
}
  if(
  i15.trend==='BULLISH' &&
  i15.hist>0 &&
  i5.hist>0 &&
  last.c>prev &&
  !nearResistance && levels.distanceToResistance>a
){
  return{
    type:'BULLISH PULLBACK CONTINUATION',
    direction:'LONG',
    entryLow:px-a*.15,
    entryHigh:px+a*.10,
    stop:px-a,
    tp1:px+a,
    tp2:px+a*2
  };
}

if(
  i15.trend==='BEARISH' &&
  i15.hist<0 &&
  i5.hist<0 &&
  last.c<prev &&
  !nearSupport && levels.distanceToSupport>a
){
  return{
    type:'BEARISH PULLBACK CONTINUATION',
    direction:'SHORT',
    entryLow:px-a*.10,
    entryHigh:px+a*.15,
    stop:px+a,
    tp1:px-a,
    tp2:px-a*2
  };
}
  return null;
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
           b.t%(5*M)===0
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
   
    const confirmation={
  fiveMinTrend:i5.trend,
  fiveMinHist:i5.hist,
  fifteenMinTrend:i15.trend,
  fifteenMinHist:i15.hist,
  fiveMinRsi:i5.rsi,
  fifteenMinRsi:i15.rsi,
  oneHourTrend:i60.trend,
  fourHourTrend:i240.trend,
  latestCandle:
    bars.at(-1).c>bars.at(-1).o
    ?'BULLISH'
    :bars.at(-1).c<bars.at(-1).o
    ?'BEARISH'
    :'FLAT'
};
    const current=
      makeDirection(
        bars,
        i5,
        i15,
        i60,
        i240
      );
   
    const lastCandleClosedAt=
  bars.at(-1).t+5*M;

const dataAgeMinutes=
  Math.max(
    0,
    (now-lastCandleClosedAt)/M
  );

const levelSetup=
  dataAgeMinutes<=15
    ?makeLevelSetup(
      bars,
      b15,
      i5,
      i15
    )
    :null;

    confirmation.lastCandleClosedAt=
  new Date(lastCandleClosedAt).toISOString();

confirmation.dataAgeMinutes=
  Number(dataAgeMinutes.toFixed(2));

confirmation.dataFresh=
  dataAgeMinutes<=15;
   
    const levels=
  getLevels(bars);

    const levelZones=
  getLevelZones(
    bars,
    b15
  );

    const nearestZone=
  levels.distanceToResistance<
  levels.distanceToSupport
  ?'RESISTANCE'
  :'SUPPORT';

  const zoneStatus=
  levels.price>=levelZones.resistanceZoneLow
  ?'IN RESISTANCE ZONE'
  :levels.price<=levelZones.supportZoneHigh
  ?'IN SUPPORT ZONE'
  :nearestZone==='RESISTANCE'
  ?'APPROACHING RESISTANCE'
  :'APPROACHING SUPPORT';
   
    const activeDirection=
  levelSetup?.direction||current;
    
    const prices=
  levelSetup||
  makeSetupPrices(
    activeDirection,
    b15,
    bars
  );

    const setupType=
  levelSetup?.type||
  (activeDirection==='LONG'
    ?'TREND LONG'
    :activeDirection==='SHORT'
    ?'TREND SHORT'
    :'NONE');

    const previous=
      await readBlob(
        'push/monitor-state.json'
      );

    const oldDirection=
      previous?.direction??null;

    await saveBlob(
      'push/monitor-state.json',
      {
        direction:activeDirection,
        checkedAt:
          new Date()
            .toISOString()
      }
    );

    if(
      oldDirection===null ||
      oldDirection===activeDirection
    ){
      return res
        .status(200)
        .json({
          ok:true,
          direction:activeDirection,
          prices,
          levels,
          levelZones,
          nearestZone,
          zoneStatus,
          setupType,
          confirmation,
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
          direction:activeDirection,
          levels,
          levelZones,
          nearestZone,
          zoneStatus,
          setupType,
          confirmation,
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

    if(activeDirection==='LONG'){
  body=
   'LONG · '+setupType+' · '+zoneStatus+' · Entry '+
    prices.entryLow.toFixed(2)+'–'+
    prices.entryHigh.toFixed(2)+
    ' · Stop '+prices.stop.toFixed(2)+
    ' · TP1 '+prices.tp1.toFixed(2)+
    ' · TP2 '+prices.tp2.toFixed(2);
}

else if(activeDirection==='SHORT'){
  body=
    'SHORT · '+setupType+' · '+zoneStatus+' · Entry '+
    prices.entryLow.toFixed(2)+'–'+
    prices.entryHigh.toFixed(2)+
    ' · Stop '+prices.stop.toFixed(2)+
    ' · TP1 '+prices.tp1.toFixed(2)+
    ' · TP2 '+prices.tp2.toFixed(2);
}

    else{
  body=
    'WAIT · '+
    zoneStatus+
    ' · 5m '+confirmation.fiveMinTrend+
    ' · 15m '+confirmation.fifteenMinTrend+
    ' · 5m RSI '+confirmation.fiveMinRsi.toFixed(0)+
    ' · 15m RSI '+confirmation.fifteenMinRsi.toFixed(0)+
    ' · Candle '+confirmation.latestCandle;
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
          activeDirection,
          prices,
          levels,
        levelZones,
        nearestZone,
        zoneStatus,
        setupType,
        confirmation,
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
