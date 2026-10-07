import {
  aggregate,
  indicators,
  atr,
  makeSetupPrices,
  makeLevelSetup,
  makeDirection
} from './market-monitor.js';

const M=60000;
const ENTRY_EXPIRY_MINUTES=90;
const ACTIVE_TIMEOUT_MINUTES=8*60;

function upperBoundCompleted(series,now,minutes){
  let lo=0;
  let hi=series.length;
  const size=minutes*M;

  while(lo<hi){
    const mid=(lo+hi)>>1;

    if(series[mid].t+size<=now){
      lo=mid+1;
    }else{
      hi=mid;
    }
  }

  return lo;
}

function recentCompleted(series,now,minutes,limit=240){
  const end=upperBoundCompleted(
    series,
    now,
    minutes
  );

  return series.slice(
    Math.max(0,end-limit),
    end
  );
}

function priceZoneTouched(bar,low,high){
  return bar.l<=high && bar.h>=low;
}

function levelHits(bar,signal){
  if(signal.direction==='LONG'){
    return{
      stop:bar.l<=signal.stop,
      tp1:bar.h>=signal.tp1,
      tp2:bar.h>=signal.tp2
    };
  }

  return{
    stop:bar.h>=signal.stop,
    tp1:bar.l<=signal.tp1,
    tp2:bar.l<=signal.tp2
  };
}

function evaluateSignal(signal,bars,startIndex){
  const signalClosedAt=signal.candleClosedAt;
  const entryDeadline=
    signalClosedAt+
    ENTRY_EXPIRY_MINUTES*M;

  let enteredAt=null;
  let tp1HitAt=null;

  for(
    let i=startIndex+1;
    i<bars.length;
    i++
  ){
    const bar=bars[i];
    const closedAt=bar.t+5*M;

    if(enteredAt===null){
      if(closedAt>entryDeadline){
        return{
          status:'EXPIRED',
          enteredAt:null,
          tp1HitAt:null,
          closedAt
        };
      }

      if(
        !priceZoneTouched(
          bar,
          signal.entryLow,
          signal.entryHigh
        )
      ){
        continue;
      }

      enteredAt=closedAt;
      const first=levelHits(bar,signal);

      if(
        first.stop ||
        first.tp1 ||
        first.tp2
      ){
        return{
          status:'AMBIGUOUS',
          enteredAt,
          tp1HitAt:null,
          closedAt,
          note:'Entry and exit level touched inside the same 5m candle.'
        };
      }

      continue;
    }

    const hit=levelHits(bar,signal);

    if(
      hit.stop &&
      (hit.tp1||hit.tp2)
    ){
      return{
        status:'AMBIGUOUS',
        enteredAt,
        tp1HitAt,
        closedAt,
        note:'Stop and target touched inside the same 5m candle.'
      };
    }

    if(hit.tp2){
      return{
        status:'TP2',
        enteredAt,
        tp1HitAt:tp1HitAt||closedAt,
        closedAt
      };
    }

    if(hit.tp1 && tp1HitAt===null){
      tp1HitAt=closedAt;
    }

    if(hit.stop){
      return{
        status:
          tp1HitAt===null
            ?'STOP'
            :'STOP_AFTER_TP1',
        enteredAt,
        tp1HitAt,
        closedAt
      };
    }

    if(
      closedAt-enteredAt>
      ACTIVE_TIMEOUT_MINUTES*M
    ){
      return{
        status:'TIMEOUT',
        enteredAt,
        tp1HitAt,
        closedAt
      };
    }
  }

  return{
    status:'OPEN_END',
    enteredAt,
    tp1HitAt,
    closedAt:null
  };
}

function pct(n,d){
  return d
    ?Number((n/d*100).toFixed(1))
    :null;
}

function localMinutes(ts,timeZone){
  const parts=
    Object.fromEntries(
      new Intl.DateTimeFormat(
        'en-US',
        {
          timeZone,
          hour:'2-digit',
          minute:'2-digit',
          hourCycle:'h23'
        }
      )
      .formatToParts(new Date(ts))
      .map(p=>[p.type,p.value])
    );

  return(
    Number(parts.hour)*60+
    Number(parts.minute)
  );
}

function getTradingSession(ts){
  const ny=
    localMinutes(
      ts,
      'America/New_York'
    );

  const london=
    localMinutes(
      ts,
      'Europe/London'
    );

  if(
    ny>=8*60 &&
    ny<17*60
  ){
    return 'US';
  }

  if(
    london>=8*60 &&
    london<13*60
  ){
    return 'LONDON';
  }

  return 'OVERNIGHT';
}
function buildStats(signals){
  const evaluated=signals.filter(x=>
    [
      'TP2',
      'STOP',
      'STOP_AFTER_TP1'
    ].includes(x.status)
  );

  const entered=signals.filter(x=>
    x.enteredAt!==null
  );

  const tp1Hits=evaluated.filter(x=>
    x.status==='TP2' ||
    x.status==='STOP_AFTER_TP1'
  ).length;

  const tp2Hits=evaluated.filter(
    x=>x.status==='TP2'
  ).length;

  const stopsBeforeTp1=evaluated.filter(
    x=>x.status==='STOP'
  ).length;

  const bySetup={};

  for(const signal of signals){
    const key=signal.setupType||'UNKNOWN';
    const bucket=bySetup[key]||{
      signals:0,
      entered:0,
      evaluated:0,
      tp1Hits:0,
      tp2Hits:0,
      stopsBeforeTp1:0,
      expired:0,
      ambiguous:0,
      timeout:0
    };

    bucket.signals++;

    if(signal.enteredAt!==null){
      bucket.entered++;
    }

    if(
      [
        'TP2',
        'STOP',
        'STOP_AFTER_TP1'
      ].includes(signal.status)
    ){
      bucket.evaluated++;
    }

    if(
      signal.status==='TP2' ||
      signal.status==='STOP_AFTER_TP1'
    ){
      bucket.tp1Hits++;
    }

    if(signal.status==='TP2'){
      bucket.tp2Hits++;
    }

    if(signal.status==='STOP'){
      bucket.stopsBeforeTp1++;
    }

    if(signal.status==='EXPIRED'){
      bucket.expired++;
    }

    if(signal.status==='AMBIGUOUS'){
      bucket.ambiguous++;
    }

    if(signal.status==='TIMEOUT'){
      bucket.timeout++;
    }

    bySetup[key]=bucket;
  }

  for(const bucket of Object.values(bySetup)){
    bucket.entryRate=pct(
      bucket.entered,
      bucket.signals
    );

    bucket.tp1HitRate=pct(
      bucket.tp1Hits,
      bucket.evaluated
    );

    bucket.tp2HitRate=pct(
      bucket.tp2Hits,
      bucket.evaluated
    );

    bucket.stopBeforeTp1Rate=pct(
      bucket.stopsBeforeTp1,
      bucket.evaluated
    );
  }

  const bySession={};

for(const signal of signals){
  const key=
    signal.session||'UNKNOWN';

  const bucket=
    bySession[key]||{
      signals:0,
      entered:0,
      evaluated:0,
      tp1Hits:0,
      tp2Hits:0,
      stopsBeforeTp1:0
    };

  bucket.signals++;

  if(signal.enteredAt!==null){
    bucket.entered++;
  }

  if(
    [
      'TP2',
      'STOP',
      'STOP_AFTER_TP1'
    ].includes(signal.status)
  ){
    bucket.evaluated++;
  }

  if(
    signal.status==='TP2' ||
    signal.status==='STOP_AFTER_TP1'
  ){
    bucket.tp1Hits++;
  }

  if(signal.status==='TP2'){
    bucket.tp2Hits++;
  }

  if(signal.status==='STOP'){
    bucket.stopsBeforeTp1++;
  }

  bySession[key]=bucket;
}

for(
  const bucket of
  Object.values(bySession)
){
  bucket.entryRate=
    pct(
      bucket.entered,
      bucket.signals
    );

  bucket.tp1HitRate=
    pct(
      bucket.tp1Hits,
      bucket.evaluated
    );

  bucket.tp2HitRate=
    pct(
      bucket.tp2Hits,
      bucket.evaluated
    );

  bucket.stopBeforeTp1Rate=
    pct(
      bucket.stopsBeforeTp1,
      bucket.evaluated
    );
}
  const byVwapDistanceBucket={};
  for(const signal of signals){
  const key=
    signal.context?.fiveMinVwapDistanceBucket||'UNKNOWN';

  const bucket=
    byVwapDistanceBucket[key]||{
  signals:0,
  evaluated:0,
  tp1Hits:0,
  tp2Hits:0,
  stopsBeforeTp1:0
};

  bucket.signals++;
  if(
  [
    'TP2',
    'STOP',
    'STOP_AFTER_TP1'
  ].includes(signal.status)
){
  bucket.evaluated++;
}
if(
  signal.status==='TP2' ||
  signal.status==='STOP_AFTER_TP1'
){
  bucket.tp1Hits++;
}
if(signal.status==='TP2'){
  bucket.tp2Hits++;
}
if(signal.status==='STOP'){
  bucket.stopsBeforeTp1++;
}
  byVwapDistanceBucket[key]=bucket;
}
  
for(const bucket of Object.values(byVwapDistanceBucket)){
  bucket.tp1HitRate=
    pct(bucket.tp1Hits,bucket.evaluated);

  bucket.tp2HitRate=
    pct(bucket.tp2Hits,bucket.evaluated);
  bucket.stopBeforeTp1Rate=
  pct(bucket.stopsBeforeTp1,bucket.evaluated);
}
const bySetupSession={};

for(const signal of signals){
  const setup=
    signal.setupType||'UNKNOWN';

  const session=
    signal.session||'UNKNOWN';

  const key=
    setup+' · '+session;

  const bucket=
    bySetupSession[key]||{
      setupType:setup,
      session,
      signals:0,
      entered:0,
      evaluated:0,
      tp1Hits:0,
      tp2Hits:0,
      stopsBeforeTp1:0
    };

  bucket.signals++;

  if(signal.enteredAt!==null){
    bucket.entered++;
  }

  if(
    [
      'TP2',
      'STOP',
      'STOP_AFTER_TP1'
    ].includes(signal.status)
  ){
    bucket.evaluated++;
  }

  if(
    signal.status==='TP2' ||
    signal.status==='STOP_AFTER_TP1'
  ){
    bucket.tp1Hits++;
  }

  if(signal.status==='TP2'){
    bucket.tp2Hits++;
  }

  if(signal.status==='STOP'){
    bucket.stopsBeforeTp1++;
  }

  bySetupSession[key]=bucket;
}

for(
  const bucket of
  Object.values(bySetupSession)
){
  bucket.entryRate=
    pct(
      bucket.entered,
      bucket.signals
    );

  bucket.tp1HitRate=
    pct(
      bucket.tp1Hits,
      bucket.evaluated
    );

  bucket.tp2HitRate=
    pct(
      bucket.tp2Hits,
      bucket.evaluated
    );

  bucket.stopBeforeTp1Rate=
    pct(
      bucket.stopsBeforeTp1,
      bucket.evaluated
    );
}

  return{
    totalSignals:signals.length,
    entered:entered.length,
    evaluated:evaluated.length,
    expired:signals.filter(
      x=>x.status==='EXPIRED'
    ).length,
    ambiguous:signals.filter(
      x=>x.status==='AMBIGUOUS'
    ).length,
    timeout:signals.filter(
      x=>x.status==='TIMEOUT'
    ).length,
    openEnd:signals.filter(
      x=>x.status==='OPEN_END'
    ).length,
    tp1Hits,
    tp2Hits,
    stopsBeforeTp1,
    entryRate:pct(
      entered.length,
      signals.length
    ),
    tp1HitRate:pct(
      tp1Hits,
      evaluated.length
    ),
    tp2HitRate:pct(
      tp2Hits,
      evaluated.length
    ),
    stopBeforeTp1Rate:pct(
      stopsBeforeTp1,
      evaluated.length
    ),
    bySetup,
    bySession,
    byVwapDistanceBucket,
    bySetupSession
  };
}

function buildSetupValidation(
  development,
  validation
){
  const names=
    new Set([
      ...Object.keys(
        development.bySetup||{}
      ),
      ...Object.keys(
        validation.bySetup||{}
      )
    ]);

  const result={};

  for(const name of names){
    const dev=
      development.bySetup?.[name]||{};

    const val=
      validation.bySetup?.[name]||{};

    const devEvaluated=
      dev.evaluated??0;

    const valEvaluated=
      val.evaluated??0;

    const devTP1=
      dev.tp1HitRate??null;

    const valTP1=
      val.tp1HitRate??null;

    let rating=
      'INSUFFICIENT DATA';

    if(
      devEvaluated>=20 &&
      valEvaluated>=20 &&
      devTP1!==null &&
      valTP1!==null
    ){
      if(
        devTP1>=55 &&
        valTP1>=55
      ){
        rating='VALIDATED';
      }else if(
        devTP1<45 &&
        valTP1<45
      ){
        rating='WEAK';
      }else{
        rating='MIXED';
      }
    }

    result[name]={
      rating,
      totalEvaluated:
        devEvaluated+
        valEvaluated,

      development:{
        evaluated:devEvaluated,
        tp1HitRate:devTP1,
        tp2HitRate:
          dev.tp2HitRate??null
      },

      validation:{
        evaluated:valEvaluated,
        tp1HitRate:valTP1,
        tp2HitRate:
          val.tp2HitRate??null
      }
    };
  }

  return result;
}

export default async function handler(req,res){
  if(req.method!=='GET'){
    return res.status(405).json({
      error:'GET only'
    });
  }

  try{
    const response=await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=60d',
      {
        headers:{
          'User-Agent':'Mozilla/5.0',
          'Accept':'application/json'
        }
      }
    );

    if(!response.ok){
      throw new Error(
        'WTI history HTTP '+
        response.status
      );
    }

    const data=await response.json();
    const result=data.chart?.result?.[0];
    const quote=result
      ?.indicators
      ?.quote?.[0];

    if(!result?.timestamp || !quote){
      throw new Error(
        'No WTI historical candle data'
      );
    }

    const now=Date.now();

    const bars=result.timestamp
      .map((t,i)=>({
        t:t*1000,
        o:quote.open[i],
        h:quote.high[i],
        l:quote.low[i],
        c:quote.close[i],
        v:quote.volume?.[i]??0
      }))
      .filter(b=>
        [
          b.o,
          b.h,
          b.l,
          b.c
        ].every(Number.isFinite) &&
        b.t%(5*M)===0 &&
        b.t+5*M<=now
      );

    if(bars.length<1800){
      throw new Error(
        'Not enough 5m history for backtest'
      );
    }

    const all15=aggregate(bars,15);
    const all30=aggregate(bars,30);
    const all60=aggregate(bars,60);
    const all240=aggregate(bars,240);

    const signals=[];
    let previousDirection='WAIT';
    let previousSetupType='NONE';

    for(
      let i=400;
      i<bars.length;
      i++
    ){
      const candleClosedAt=
        bars[i].t+5*M;

      const hist5=bars.slice(
        Math.max(0,i-599),
        i+1
      );

      const b15=recentCompleted(
        all15,
        candleClosedAt,
        15,
        240
      );
     
    const b30=recentCompleted(
       all30,
       candleClosedAt,
       30,
       240
      );

      const b60=recentCompleted(
        all60,
        candleClosedAt,
        60,
        160
      );

      const b240=recentCompleted(
        all240,
        candleClosedAt,
        240,
        100
      );

      const i5=indicators(hist5);
      const i15=indicators(b15);
      const i30=indicators(b30);
      const i60=indicators(b60);
      const i240=indicators(b240);

      if(
        !i5 ||
        !i15 ||
        !i30 ||
        !i60 ||
        !i240
      ){
        continue;
      }

      const levelSetup=makeLevelSetup(
  hist5,
  b15,
  b30,
  i5,
  i15,
  i30,
  i240
);

      const trendDirection=makeDirection(
  hist5,
  i5,
  i15,
  i60,
  i240,
  i30,
  candleClosedAt
);

      let direction=
  levelSetup?.direction||
  trendDirection;

if(
  direction==='LONG' &&
  (
    i15.trend!=='BULLISH' ||
    i30.trend!=='BULLISH' ||
    i240.trend!=='BULLISH'
  )
){
  direction='WAIT';
}

if(
  direction==='SHORT' &&
  (
    i15.trend!=='BEARISH' ||
    i30.trend!=='BEARISH' ||
    i240.trend!=='BEARISH'
  )
){
  direction='WAIT';
}
const latest5=
  hist5.at(-1);

const previous5=
  hist5.at(-2);

const previousMid=
  (previous5.o+previous5.c)/2;

const entryTriggered=
  !!latest5 &&
  !!previous5 &&
  (
    (
      direction==='LONG' &&
      previous5.c<previous5.o &&
      latest5.c>latest5.o &&
      latest5.l<=previous5.l &&
      latest5.c>previousMid
    ) ||
    (
      direction==='SHORT' &&
      previous5.c>previous5.o &&
      latest5.c<latest5.o &&
      latest5.h>=previous5.h &&
      latest5.c<previousMid
    )
  );

if(
  direction!=='WAIT' &&
  !entryTriggered
){
  direction='WAIT';
}
      const prices=
        direction==='WAIT'
          ?null
          :(levelSetup||
            makeSetupPrices(
              direction,
              b15,
              hist5
            ));

      const setupType=
        direction==='WAIT'
          ?'NONE'
          :(levelSetup?.type||
            (direction==='LONG'
              ?'TREND LONG'
              :'TREND SHORT'));

      const isNewSignal=
        (
          direction==='LONG' ||
          direction==='SHORT'
        ) &&
        (
          direction!==previousDirection ||
          setupType!==previousSetupType
        );

      if(isNewSignal && prices){
        const baseSignal={
          direction,
          setupType,
          session:getTradingSession(candleClosedAt),
          signalAt:new Date(
            candleClosedAt
          ).toISOString(),
          candleClosedAt,
          entryLow:prices.entryLow,
          entryHigh:prices.entryHigh,
          stop:prices.stop,
          tp1:prices.tp1,
          tp2:prices.tp2,
          context:{
            fiveMinTrend:i5.trend,
            fifteenMinTrend:i15.trend,
            thirtyMinTrend:i30.trend,
            oneHourTrend:i60.trend,
            fourHourTrend:i240.trend,
            fiveMinRsi:Number(
            i5.rsi.toFixed(2)
          ),
  fiveMinRvol:Number.isFinite(i5.volume.rvol)
  ?Number(i5.volume.rvol.toFixed(2))
  :null,
 fiveMinVwapPosition:i5.volume.vwapPosition,
 fiveMinVwap20:Number.isFinite(i5.volume.vwap20)
  ?Number(i5.volume.vwap20.toFixed(3))
  :null,   
  fiveMinVwapDistance:Number.isFinite(i5.volume.vwap20)
  ?Number((hist5.at(-1).c-i5.volume.vwap20).toFixed(3))
  :null,
  fiveMinAtr:Number(atr(hist5).toFixed(3)),
  fiveMinVwapDistanceAtr:
  Number((Math.abs(hist5.at(-1).c-i5.volume.vwap20)/atr(hist5)).toFixed(2)),
  fiveMinVwapDistanceAtrBucket:
  Math.abs(hist5.at(-1).c-i5.volume.vwap20)/atr(hist5)<1
    ?'UNDER_1_ATR'
    :Math.abs(hist5.at(-1).c-i5.volume.vwap20)/atr(hist5)<2
      ?'ONE_TO_TWO_ATR'
      :'OVER_2_ATR',
  fiveMinVwapDistanceBucket:
  Math.abs(hist5.at(-1).c-i5.volume.vwap20)<0.25
    ?'NEAR'
    :Math.abs(hist5.at(-1).c-i5.volume.vwap20)<0.5
      ?'MID'
      :'FAR',
fifteenMinRsi:Number(
  i15.rsi.toFixed(2)
)
          }
        };

        const outcome=evaluateSignal(
          baseSignal,
          bars,
          i
        );

        signals.push({
          ...baseSignal,
          ...outcome,
          enteredAt:
            outcome.enteredAt
              ?new Date(
                outcome.enteredAt
              ).toISOString()
              :null,
          tp1HitAt:
            outcome.tp1HitAt
              ?new Date(
                outcome.tp1HitAt
              ).toISOString()
              :null,
          closedAt:
            outcome.closedAt
              ?new Date(
                outcome.closedAt
              ).toISOString()
              :null
        });
      }

      previousDirection=direction;
      previousSetupType=setupType;
    }

    const splitAt=
  bars[
    Math.floor(
      bars.length/2
    )
  ].t+5*M;

const developmentSignals=
  signals.filter(
    s=>s.candleClosedAt<splitAt
  );

const validationSignals=
  signals.filter(
    s=>s.candleClosedAt>=splitAt
  );

const walkForward={
  splitAt:
    new Date(splitAt)
      .toISOString(),

  development:
    buildStats(
      developmentSignals
    ),

  validation:
    buildStats(
      validationSignals
    )
};

    walkForward.setupValidation=
  buildSetupValidation(
    walkForward.development,
    walkForward.validation
  );
   
    return res.status(200).json({
      ok:true,
      mode:'TECHNICAL_ONLY_REPLAY',
      source:
        'Yahoo CL=F 5m historical data (unofficial/unverified)',
      range:{
        first:new Date(
          bars[0].t
        ).toISOString(),
        last:new Date(
          bars.at(-1).t+5*M
        ).toISOString(),
        candles:bars.length
      },
      
      walkForward,
      
      assumptions:{
        entryExpiryMinutes:
          ENTRY_EXPIRY_MINUTES,
        activeTimeoutMinutes:
          ACTIVE_TIMEOUT_MINUTES,
        historicalNewsIncluded:false,
        maritimeHistoryIncluded:false,
        feesIncluded:false,
        slippageIncluded:false,
        note:
          'Replay uses the current technical rules. Same-candle entry/exit or stop/target conflicts are marked AMBIGUOUS.'
      },
      stats:buildStats(signals),
      recent:signals
        .slice(-30)
        .reverse()
    });

  }catch(e){
    console.error(
      'WTI backtest failed:',
      e
    );

    return res.status(500).json({
      error:e.message
    });
  }
}
