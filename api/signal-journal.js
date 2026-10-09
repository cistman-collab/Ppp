import { get, put } from '@vercel/blob';

const M=60000;
const JOURNAL_PATH='journal/signals.json';
const ENTRY_EXPIRY_MINUTES=90;
const ACTIVE_TIMEOUT_MINUTES=8*60;
const TERMINAL=new Set([
  'TP2',
  'STOP',
  'STOP_AFTER_TP1',
  'EXPIRED',
  'AMBIGUOUS',
  'TIMEOUT'
]);

async function readJournal(){
  try{
    const result=await get(
      JOURNAL_PATH,
      {
        access:'private',
        token:process.env.BLOB_READ_WRITE_TOKEN,
        useCache:false
      }
    );

    if(!result || result.statusCode!==200){
      return {signals:[]};
    }

    const data=await new Response(
      result.stream
    ).json();

    return {
      signals:Array.isArray(data?.signals)
        ?data.signals
        :[],
      updatedAt:data?.updatedAt||null
    };
  }catch{
    return {signals:[]};
  }
}

async function writeJournal(signals){
  const payload={
    version:1,
    updatedAt:new Date().toISOString(),
    signals:signals.slice(-500)
  };

  await put(
    JOURNAL_PATH,
    JSON.stringify(payload,null,2),
    {
      access:'private',
      addRandomSuffix:false,
      allowOverwrite:true,
      contentType:'application/json',
      token:process.env.BLOB_READ_WRITE_TOKEN
    }
  );

  return payload;
}

function signalId(candleClosedAt,direction,setupType){
  const clean=String(setupType||'SETUP')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'');

  return [
    Date.parse(candleClosedAt),
    direction,
    clean
  ].join('-');
}
function signalSession(candleClosedAt){
  const timestamp=Date.parse(candleClosedAt);

  if(!Number.isFinite(timestamp)){
    return 'UNKNOWN';
  }

  const hour=Number(
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:'America/New_York',
        hour:'2-digit',
        hourCycle:'h23'
      }
    ).format(new Date(timestamp))
  );

  if(hour>=8 && hour<17){
    return 'US';
  }

  if(hour>=3 && hour<8){
    return 'LONDON';
  }

  return 'OVERNIGHT';
}
function entryTouched(bar,signal){
  return(
    bar.l<=signal.entryHigh &&
    bar.h>=signal.entryLow
  );
}

function touched(bar,signal){
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

function processSignal(signal,bars){
  if(TERMINAL.has(signal.status)){
    return false;
  }

  let changed=false;
  const signalClosedAt=Date.parse(
    signal.signalCandleClosedAt
  );
  const lastProcessed=Date.parse(
    signal.lastProcessedCandleClosedAt||
    signal.signalCandleClosedAt
  );

  const candidates=bars.filter(bar=>{
    const closedAt=bar.t+5*M;
    return(
      closedAt>signalClosedAt &&
      closedAt>lastProcessed
    );
  });

  for(const bar of candidates){
    const closedAt=bar.t+5*M;
    const closedIso=new Date(closedAt).toISOString();

    signal.lastProcessedCandleClosedAt=closedIso;
    changed=true;

    if(signal.status==='PENDING'){
      const ageMinutes=
        (closedAt-signalClosedAt)/M;

      if(ageMinutes>ENTRY_EXPIRY_MINUTES){
        signal.status='EXPIRED';
        signal.closedAt=closedIso;
        break;
      }

      if(!entryTouched(bar,signal)){
        continue;
      }

      signal.status='ACTIVE';
      signal.enteredAt=closedIso;
      signal.entryPrice=Number(
        (
          (signal.entryLow+signal.entryHigh)/2
        ).toFixed(4)
      );

      const firstBar=touched(bar,signal);

      if(
        firstBar.stop ||
        firstBar.tp1 ||
        firstBar.tp2
      ){
        signal.status='AMBIGUOUS';
        signal.closedAt=closedIso;
        signal.note=
          'Entry and exit level touched inside the same 5m candle; order is unknown.';
        break;
      }

      continue;
    }

    if(signal.status!=='ACTIVE'){
      continue;
    }

    const hit=touched(bar,signal);

    if(
      hit.stop &&
      (hit.tp1||hit.tp2)
    ){
      signal.status='AMBIGUOUS';
      signal.closedAt=closedIso;
      signal.note=
        'Stop and target touched inside the same 5m candle; order is unknown.';
      break;
    }

    if(hit.tp2){
      if(!signal.tp1HitAt){
        signal.tp1HitAt=closedIso;
      }
      signal.tp2HitAt=closedIso;
      signal.status='TP2';
      signal.closedAt=closedIso;
      break;
    }

    if(hit.tp1 && !signal.tp1HitAt){
      signal.tp1HitAt=closedIso;
    }

    if(hit.stop){
      signal.status=
        signal.tp1HitAt
          ?'STOP_AFTER_TP1'
          :'STOP';
      signal.closedAt=closedIso;
      break;
    }

    const enteredAt=Date.parse(
      signal.enteredAt||''
    );

    if(
      Number.isFinite(enteredAt) &&
      closedAt-enteredAt>
        ACTIVE_TIMEOUT_MINUTES*M
    ){
      signal.status='TIMEOUT';
      signal.closedAt=closedIso;
      signal.note=
        'No TP2 or stop within 8 hours after entry.';
      break;
    }
  }

  return changed;
}

function makeSignal({
  direction,
  setupType,
  prices,
  confirmation
}){
  const candleClosedAt=
    confirmation.lastCandleClosedAt;

  return{
    id:signalId(
      candleClosedAt,
      direction,
      setupType
    ),
    createdAt:new Date().toISOString(),
    signalCandleClosedAt:candleClosedAt,
    session:signalSession(candleClosedAt),
    lastProcessedCandleClosedAt:candleClosedAt,
    expiresAt:new Date(
      Date.parse(candleClosedAt)+
      ENTRY_EXPIRY_MINUTES*M
    ).toISOString(),
    status:'PENDING',
    direction,
    setupType,
    entryLow:prices.entryLow,
    entryHigh:prices.entryHigh,
    stop:prices.stop,
    tp1:prices.tp1,
    tp2:prices.tp2,
    context:{
      fiveMinTrend:confirmation.fiveMinTrend,
      fifteenMinTrend:confirmation.fifteenMinTrend,
      oneHourTrend:confirmation.oneHourTrend,
      fourHourTrend:confirmation.fourHourTrend,
      fiveMinRsi:Number(
        confirmation.fiveMinRsi.toFixed(2)
      ),
      fifteenMinRsi:Number(
        confirmation.fifteenMinRsi.toFixed(2)
      ),
      candlestickPattern:confirmation.candlestickPattern||null,
      newsBias:confirmation.newsBias,
      maritimeRisk:confirmation.maritimeRisk,
      newsConflict:Boolean(
        confirmation.newsConflict
      )
    }
  };
}

function rate(num,den){
  return den
    ?Number((num/den*100).toFixed(1))
    :null;
}

export function buildSignalStats(signals){
  const list=Array.isArray(signals)
    ?signals
    :[];

  const evaluated=list.filter(x=>
    [
      'TP2',
      'STOP',
      'STOP_AFTER_TP1'
    ].includes(x.status)
  );

  const tp1Wins=evaluated.filter(x=>
    x.status==='TP2' ||
    x.status==='STOP_AFTER_TP1'
  ).length;

  const tp2Wins=evaluated.filter(
    x=>x.status==='TP2'
  ).length;

  const stops=evaluated.filter(
    x=>x.status==='STOP'
  ).length;

  const bySetup={};
  const bySession={};
  const byPattern={};
  for(const signal of list){
    const sessionKey=signal.session||signalSession(signal.signalCandleClosedAt);
    const patternKey=signal.context?.candlestickPattern||'NONE';
    const key=signal.setupType||'UNKNOWN';
  
    const bucket=bySetup[key]||{
      signals:0,
      evaluated:0,
      tp1Hits:0,
      tp2Hits:0,
      stopsBeforeTp1:0
    };

    const patternBucket=byPattern[patternKey]||{
  signals:0,
  evaluated:0,
  tp1Hits:0,
  tp2Hits:0,
  stopsBeforeTp1:0
};

    const sessionBucket=bySession[sessionKey]||{
  signals:0,
  evaluated:0,
  tp1Hits:0,
  tp2Hits:0,
  stopsBeforeTp1:0
};

    bucket.signals++;
    sessionBucket.signals++;
    patternBucket.signals++;

    if(
      [
        'TP2',
        'STOP',
        'STOP_AFTER_TP1'
      ].includes(signal.status)
    ){
      bucket.evaluated++;
      sessionBucket.evaluated++;
      patternBucket.evaluated++;

      if(
        signal.status==='TP2' ||
        signal.status==='STOP_AFTER_TP1'
      ){
        bucket.tp1Hits++;
        sessionBucket.tp1Hits++;
        patternBucket.tp1Hits++;
      }

      if(signal.status==='TP2'){
        bucket.tp2Hits++;
        sessionBucket.tp2Hits++;
      }

      if(signal.status==='STOP'){
        bucket.stopsBeforeTp1++;
        sessionBucket.stopsBeforeTp1++;
      }
    }

    bySetup[key]=bucket;
    bySession[sessionKey]=sessionBucket;
  }

  for(const bucket of Object.values(bySetup)){
    bucket.tp1HitRate=rate(
      bucket.tp1Hits,
      bucket.evaluated
    );
    bucket.tp2HitRate=rate(
      bucket.tp2Hits,
      bucket.evaluated
    );
  }
for(const bucket of Object.values(bySession)){
  bucket.tp1HitRate=rate(
    bucket.tp1Hits,
    bucket.evaluated
  );
 bucket.tp2HitRate=rate(
  bucket.tp2Hits,
  bucket.evaluated
);
  bucket.stopBeforeTp1Rate=rate(
  bucket.stopsBeforeTp1,
  bucket.evaluated
);
}
  return{
    totalSignals:list.length,
    pending:list.filter(
      x=>x.status==='PENDING'
    ).length,
    active:list.filter(
      x=>x.status==='ACTIVE'
    ).length,
    evaluated:evaluated.length,
    expired:list.filter(
      x=>x.status==='EXPIRED'
    ).length,
    ambiguous:list.filter(
      x=>x.status==='AMBIGUOUS'
    ).length,
    timeout:list.filter(
      x=>x.status==='TIMEOUT'
    ).length,
    tp1Hits:tp1Wins,
    tp2Hits:tp2Wins,
    stopsBeforeTp1:stops,
    tp1HitRate:rate(tp1Wins,evaluated.length),
    tp2HitRate:rate(tp2Wins,evaluated.length),
    stopBeforeTp1Rate:rate(stops,evaluated.length),
    bySetup,
    bySession
  };
}

export async function updateSignalJournal({
  bars,
  direction,
  setupType,
  prices,
  confirmation,
  isNewSignal
}){
  const journal=await readJournal();
  const signals=journal.signals;
  let changed=false;
  const events=[];
  for(const signal of signals){
    const previousStatus=signal.status;
const previousTp1HitAt=signal.tp1HitAt||null;
    if(processSignal(signal,bars)){
      changed=true;
    }
   if(
  !previousTp1HitAt &&
  signal.tp1HitAt
){
  events.push({
    type:'TP1',
    signalId:signal.id,
    direction:signal.direction,
    setupType:signal.setupType,
    price:signal.tp1,
    at:signal.tp1HitAt
  });
} 
if(
  previousStatus!=='TP2' &&
  signal.status==='TP2'
){
  events.push({
    type:'TP2',
    signalId:signal.id,
    direction:signal.direction,
    setupType:signal.setupType,
    price:signal.tp2,
    at:signal.tp2HitAt
  });
}
   if(
  !['STOP','STOP_AFTER_TP1'].includes(previousStatus) &&
  ['STOP','STOP_AFTER_TP1'].includes(signal.status)
){
  events.push({
    type:signal.status,
    signalId:signal.id,
    direction:signal.direction,
    setupType:signal.setupType,
    price:signal.stop,
    at:signal.closedAt
  });
} 
  }

  if(
    isNewSignal &&
    (direction==='LONG'||direction==='SHORT') &&
    prices &&
    confirmation?.dataFresh &&
    confirmation?.lastCandleClosedAt
  ){
    const next=makeSignal({
      direction,
      setupType,
      prices,
      confirmation
    });

    if(!signals.some(x=>x.id===next.id)){
      signals.push(next);
      changed=true;
    }
  }

  if(changed){
    await writeJournal(signals);
  }

  return{
  stats:buildSignalStats(signals),
  events
};
}
export async function getSignalLearningSnapshot(){
  const journal=await readJournal();

  return{
    updatedAt:journal.updatedAt,
    stats:buildSignalStats(journal.signals),
    recent:journal.signals.slice(-30)
  };
}
export default async function handler(req,res){
  if(req.method!=='GET'){
    return res.status(405).json({
      error:'GET only'
    });
  }

  try{
    const journal=await readJournal();
    const signals=journal.signals;

    return res.status(200).json({
      ok:true,
      updatedAt:journal.updatedAt,
      stats:buildSignalStats(signals),
      recent:signals
        .slice(-20)
        .reverse()
    });
  }catch(e){
    console.error(
      'Signal journal failed:',
      e
    );

    return res.status(500).json({
      error:e.message
    });
  }
}
