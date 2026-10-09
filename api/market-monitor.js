import { get, put } from '@vercel/blob';
import webpush from 'web-push';
import { updateSignalJournal } from './signal-journal.js';
import { getEventRisk } from './events.js';

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
    v:Number.isFinite(b.v)?b.v:0,
    n:0
  };

  out.push(x);

}else{
  x.h=Math.max(x.h,b.h);
  x.l=Math.min(x.l,b.l);
  x.c=b.c;
  x.v+=Number.isFinite(b.v)?b.v:0;
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

  const volumes=b
  .map(x=>Number.isFinite(x.v)?x.v:0);

const currentVolume=volumes.at(-1);

const previousVolumes=
  volumes
    .slice(-21,-1)
    .filter(v=>v>0);

const averageVolume=
  previousVolumes.length
    ?previousVolumes.reduce((a,v)=>a+v,0)/
      previousVolumes.length
    :null;

const rvol=
  Number.isFinite(currentVolume) &&
  currentVolume>0 &&
  Number.isFinite(averageVolume) &&
  averageVolume>0
    ?currentVolume/averageVolume
    :null;

  const vwapBars=
  b
    .slice(-20)
    .filter(x=>
      Number.isFinite(x.h) &&
      Number.isFinite(x.l) &&
      Number.isFinite(x.c) &&
      Number.isFinite(x.v) &&
      x.v>0
    );

const vwapVolume=
  vwapBars.reduce(
    (sum,x)=>sum+x.v,
    0
  );

const vwapWeightedPrice=
  vwapBars.reduce(
    (sum,x)=>
      sum+
      (
        (x.h+x.l+x.c)/3
      )*x.v,
    0
  );

const vwap20=
  vwapVolume>0
    ?vwapWeightedPrice/vwapVolume
    :null;

const vwapPosition=
  Number.isFinite(vwap20)
    ?b.at(-1).c>vwap20
      ?'ABOVE'
      :b.at(-1).c<vwap20
      ?'BELOW'
      :'AT'
    :'UNKNOWN';
  return{
    trend:
      fast>slow
      ?'BULLISH'
      :fast<slow
      ?'BEARISH'
      :'NEUTRAL',

    rsi,
    
    volume:{
  current:currentVolume,
  average20:averageVolume,
  rvol,
  vwap20,
  vwapPosition
},
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
function candleMetrics(bar){
  const range=Math.max(0,bar.h-bar.l);
  const body=Math.abs(bar.c-bar.o);

  return{
    range,
    body,
    upperWick:Math.max(
      0,
      bar.h-Math.max(bar.o,bar.c)
    ),
    lowerWick:Math.max(
      0,
      Math.min(bar.o,bar.c)-bar.l
    ),
    bodyRatio:
      range>0
        ?body/range
        :0,
    bullish:bar.c>bar.o,
    bearish:bar.c<bar.o
  };
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

function getLevelZones(bars,b15,b30){
  const levels15=getLevels(b15);
  const levels30=getLevels(b30);
  const a=atr(b15);
  const a30=atr(b30);
  const zoneSize=Math.max(0.10,a*.25,a30*.15);
  const supportLevel=Math.max(levels15.support,levels30.support);
  const resistanceLevel=Math.min(levels15.resistance,levels30.resistance);
  
  return{
    supportZoneLow:supportLevel,
    supportZoneHigh:supportLevel+zoneSize,
    resistanceZoneLow:resistanceLevel-zoneSize,
    resistanceZoneHigh:resistanceLevel
  };
}

function detectReversalPattern(bars,b15,i5){
  if(bars.length<10 || b15.length<12)return null;

  const a=atr(b15);
  const px=bars.at(-1).c;
  const last=bars.at(-1);
  const prev=bars.at(-2);
  const base=getLevels(bars.slice(0,-1));

  const zone=Math.max(0.10,a*.25);
  const tol=Math.max(0.12,a*.35);
  const buffer=Math.max(0.03,a*.05);

  const make=(
  type,direction,
  entryLow,entryHigh,
  stop,tp1,tp2,
  geometry=null
)=>({
  type,
  direction,
  entryLow,
  entryHigh,
  stop,
  tp1,
  tp2,
  geometry
});

  const nearSupport=
    last.l<=base.support+zone &&
    last.c>=base.support-zone*.35;

  const nearResistance=
    last.h>=base.resistance-zone &&
    last.c<=base.resistance+zone*.35;

  const prevMetrics=candleMetrics(prev);
const lastMetrics=candleMetrics(last);

const prevBody=prevMetrics.body;
const body=lastMetrics.body;
const range=Math.max(.0001,lastMetrics.range);
const upper=lastMetrics.upperWick;
const lower=lastMetrics.lowerWick;

  const doji=
    lastMetrics.range>0 &&
    lastMetrics.bodyRatio<=0.10;

  const dragonflyDoji=
    doji &&
    lower>=range*.60 &&
    upper<=range*.15;

 const gravestoneDoji=
    doji &&
    upper>=range*.60 &&
    lower<=range*.15; 

  const longLeggedDoji=
    doji &&
    upper>=range*.30 &&
    lower>=range*.30;

  const spinningTop=
    lastMetrics.bodyRatio>0.10 &&
    lastMetrics.bodyRatio<=0.35 &&
    upper>=range*.20 &&
    lower>=range*.20;

  const bullishMarubozu=
    lastMetrics.bullish &&
    body>=range*.80 &&
    upper<=range*.10 &&
    lower<=range*.10;

  const bearishMarubozu=
    lastMetrics.bearish &&
    body>=range*.80 &&
    upper<=range*.10 &&
    lower<=range*.10; 
  
  const bullEngulf=
    prev.c<prev.o &&
    last.c>last.o &&
    last.o<=prev.c &&
    last.c>=prev.o &&
    body>=prevBody*.9;

  const bearEngulf=
    prev.c>prev.o &&
    last.c<last.o &&
    last.o>=prev.c &&
    last.c<=prev.o &&
    body>=prevBody*.9;

  const hammer=
    last.c>last.o &&
    body<=range*.40 &&
    lower>=Math.max(body*2,range*.45) &&
    upper<=range*.25;

  const invertedHammer=
  lastMetrics.bullish &&
  body<=range*.40 &&
  upper>=Math.max(body*2,range*.45) &&
  lower<=range*.25;

  const shootingStar=
    last.c<last.o &&
    body<=range*.40 &&
    upper>=Math.max(body*2,range*.45) &&
    lower<=range*.25;

  const recent=b15.slice(-30);

  const highs=[];
  const lows=[];

  for(let i=1;i<recent.length-1;i++){

    if(
      recent[i].h>=recent[i-1].h &&
      recent[i].h>=recent[i+1].h
    ){
      highs.push({
       i,
       time:recent[i].t,
       price:recent[i].h
     });
    }

    if(
      recent[i].l<=recent[i-1].l &&
      recent[i].l<=recent[i+1].l
    ){
      lows.push({
      i,
      time:recent[i].t,
      price:recent[i].l
    });
    }
  }

  if(highs.length>=3){

    const [lft,head,rgt]=
      highs.slice(-3);

    const spaced=
      head.i-lft.i>=2 &&
      rgt.i-head.i>=2;

    const shoulders=
      Math.abs(
        lft.price-rgt.price
      )<=tol*1.25;

    const headHigher=
      head.price>lft.price+tol*.5 &&
      head.price>rgt.price+tol*.5;

    if(
      spaced &&
      shoulders &&
      headHigher
    ){

      const n1=Math.min(
        ...recent
          .slice(lft.i,head.i+1)
          .map(x=>x.l)
      );

      const n2=Math.min(
        ...recent
          .slice(head.i,rgt.i+1)
          .map(x=>x.l)
      );

      const neckline=(n1+n2)/2;

      if(
        px<Math.min(n1,n2)-buffer &&
        i5.hist<0
      ){
        return make(
  'HEAD AND SHOULDERS BREAKDOWN',
  'SHORT',
  neckline-zone,
  neckline,
  rgt.price+a*.25,
  px-a,
  px-a*2,
  {
    kind:'HEAD_AND_SHOULDERS',
    timeframe:'15m',

    leftShoulder:{
      time:lft.time,
      price:lft.price
    },

    head:{
      time:head.time,
      price:head.price
    },

    rightShoulder:{
      time:rgt.time,
      price:rgt.price
    },

    neckline:{
      fromTime:lft.time,
      toTime:rgt.time,
      price:neckline
    },

    confirmTime:
      bars.at(-1).t
  }
);
      }
    }
  }

  if(lows.length>=3){

    const [lft,head,rgt]=
      lows.slice(-3);

    const spaced=
      head.i-lft.i>=2 &&
      rgt.i-head.i>=2;

    const shoulders=
      Math.abs(
        lft.price-rgt.price
      )<=tol*1.25;

    const headLower=
      head.price<lft.price-tol*.5 &&
      head.price<rgt.price-tol*.5;

    if(
      spaced &&
      shoulders &&
      headLower
    ){

      const n1=Math.max(
        ...recent
          .slice(lft.i,head.i+1)
          .map(x=>x.h)
      );

      const n2=Math.max(
        ...recent
          .slice(head.i,rgt.i+1)
          .map(x=>x.h)
      );

      const neckline=(n1+n2)/2;

      if(
        px>Math.max(n1,n2)+buffer &&
        i5.hist>0
      ){
        return make(
  'INVERSE HEAD AND SHOULDERS BREAKOUT',
  'LONG',
  neckline,
  neckline+zone,
  rgt.price-a*.25,
  px+a,
  px+a*2,
  {
    kind:'INVERSE_HEAD_AND_SHOULDERS',
    timeframe:'15m',

    leftShoulder:{
      time:lft.time,
      price:lft.price
    },

    head:{
      time:head.time,
      price:head.price
    },

    rightShoulder:{
      time:rgt.time,
      price:rgt.price
    },

    neckline:{
      fromTime:lft.time,
      toTime:rgt.time,
      price:neckline
    },

    confirmTime:
      bars.at(-1).t
  }
);
      }
    }
  }

  if(highs.length>=2){

    const p1=highs.at(-2);
    const p2=highs.at(-1);

    if(
      p2.i-p1.i>=3 &&
      Math.abs(
        p1.price-p2.price
      )<=tol
    ){

      const neckline=Math.min(
        ...recent
          .slice(p1.i,p2.i+1)
          .map(x=>x.l)
      );

      if(
        px<neckline-buffer &&
        i5.hist<0
      ){
        return make(
  'DOUBLE TOP BREAKDOWN',
  'SHORT',
  neckline-zone,
  neckline,
  Math.max(
    p1.price,
    p2.price
  )+a*.25,
  px-a,
  px-a*2,
  {
    kind:'DOUBLE_TOP',
    timeframe:'15m',

    firstTop:{
      time:p1.time,
      price:p1.price
    },

    secondTop:{
      time:p2.time,
      price:p2.price
    },

    neckline:{
      fromTime:p1.time,
      toTime:p2.time,
      price:neckline
    },

    confirmTime:
      bars.at(-1).t
  }
);
      }
    }
  }

  if(lows.length>=2){

    const p1=lows.at(-2);
    const p2=lows.at(-1);

    if(
      p2.i-p1.i>=3 &&
      Math.abs(
        p1.price-p2.price
      )<=tol
    ){

      const neckline=Math.max(
        ...recent
          .slice(p1.i,p2.i+1)
          .map(x=>x.h)
      );

      if(
        px>neckline+buffer &&
        i5.hist>0
      ){
        return make(
  'DOUBLE BOTTOM BREAKOUT',
  'LONG',
  neckline,
  neckline+zone,
  Math.min(
    p1.price,
    p2.price
  )-a*.25,
  px+a,
  px+a*2,
  {
    kind:'DOUBLE_BOTTOM',
    timeframe:'15m',

    firstBottom:{
      time:p1.time,
      price:p1.price
    },

    secondBottom:{
      time:p2.time,
      price:p2.price
    },

    neckline:{
      fromTime:p1.time,
      toTime:p2.time,
      price:neckline
    },

    confirmTime:
      bars.at(-1).t
  }
);
      }
    }
  }

  if(
    nearSupport &&
    bullEngulf &&
    i5.hist>0
  ){
    return make(
      'BULLISH ENGULFING SCALP',
      'LONG',
      base.support,
      base.support+zone,
      Math.min(
        last.l,
        base.support
      )-a*.35,
      px+a*.75,
      px+a*1.5
    );
  }

  if(
    nearResistance &&
    bearEngulf &&
    i5.hist<0
  ){
    return make(
      'BEARISH ENGULFING SCALP',
      'SHORT',
      base.resistance-zone,
      base.resistance,
      Math.max(
        last.h,
        base.resistance
      )+a*.35,
      px-a*.75,
      px-a*1.5
    );
  }

  if(
    nearSupport &&
    hammer &&
    i5.hist>0
  ){
    return make(
      'HAMMER / PIN BAR SCALP',
      'LONG',
      base.support,
      base.support+zone,
      last.l-a*.25,
      px+a*.75,
      px+a*1.5
    );
  }

  if(
    nearResistance &&
    shootingStar &&
    i5.hist<0
  ){
    return make(
      'SHOOTING STAR / PIN BAR SCALP',
      'SHORT',
      base.resistance-zone,
      base.resistance,
      last.h+a*.25,
      px-a*.75,
      px-a*1.5
    );
  }

  return null;
}

function detectContinuationPattern(bars,b15,i5,i15){
  if(bars.length<40 || b15.length<24)return null;

  const a=atr(b15);
  const px=bars.at(-1).c;
  const last=bars.at(-1);
  const prev=bars.at(-2);
  const zone=Math.max(0.10,a*.25);
  const buffer=Math.max(0.03,a*.05);

  const make=(
  type,direction,
  entryLow,entryHigh,
  stop,tp1,tp2,
  geometry=null
)=>({
  type,
  direction,
  entryLow,
  entryHigh,
  stop,
  tp1,
  tp2,
  geometry
});

  const prior5=bars.slice(-22,-2);
  const priorHigh=Math.max(...prior5.map(x=>x.h));
  const priorLow=Math.min(...prior5.map(x=>x.l));

  if(
    prev.h>priorHigh+buffer &&
    prev.c<priorHigh &&
    last.c<prev.c &&
    i5.hist<0
  ){
    return make(
      'FAILED BULL BREAKOUT',
      'SHORT',
      priorHigh-zone,
      priorHigh,
      prev.h+a*.25,
      px-a*.75,
      px-a*1.5
    );
  }

  if(
    prev.l<priorLow-buffer &&
    prev.c>priorLow &&
    last.c>prev.c &&
    i5.hist>0
  ){
    return make(
      'FAILED BEAR BREAKDOWN',
      'LONG',
      priorLow,
      priorLow+zone,
      prev.l-a*.25,
      px+a*.75,
      px+a*1.5
    );
  }

  const shape=b15.slice(-19,-1);
  const half=Math.floor(shape.length/2);
  const first=shape.slice(0,half);
  const second=shape.slice(half);

  const fH=Math.max(...first.map(x=>x.h));
  const fL=Math.min(...first.map(x=>x.l));
  const sH=Math.max(...second.map(x=>x.h));
  const sL=Math.min(...second.map(x=>x.l));

  const compressing=
    (sH-sL)<(fH-fL)*.90;

  const highDelta=sH-fH;
  const lowDelta=sL-fL;

  const breakUp=
    px>sH+buffer &&
    prev.c<=sH &&
    i5.hist>0;

  const breakDown=
    px<sL-buffer &&
    prev.c>=sL &&
    i5.hist<0;

  const flatHigh=
    Math.abs(highDelta)<=a*.25;

  const flatLow=
    Math.abs(lowDelta)<=a*.25;

  if(
    compressing &&
    flatHigh &&
    lowDelta>a*.10 &&
    breakUp
  ){
    return make(
  'ASCENDING TRIANGLE BREAKOUT',
  'LONG',
  sH,
  sH+zone,
  sL-a*.25,
  px+a,
  px+a*2,
  {
    kind:'ASCENDING_TRIANGLE',
    timeframe:'15m',

    upperLine:{
      fromTime:first[0].t,
      fromPrice:fH,
      toTime:second.at(-1).t,
      toPrice:sH
    },

    lowerLine:{
      fromTime:first[0].t,
      fromPrice:fL,
      toTime:second.at(-1).t,
      toPrice:sL
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
  }

  if(
    compressing &&
    flatLow &&
    highDelta<-a*.10 &&
    breakDown
  ){
    return make(
  'DESCENDING TRIANGLE BREAKDOWN',
  'SHORT',
  sL-zone,
  sL,
  sH+a*.25,
  px-a,
  px-a*2,
  {
    kind:'DESCENDING_TRIANGLE',
    timeframe:'15m',

    upperLine:{
      fromTime:first[0].t,
      fromPrice:fH,
      toTime:second.at(-1).t,
      toPrice:sH
    },

    lowerLine:{
      fromTime:first[0].t,
      fromPrice:fL,
      toTime:second.at(-1).t,
      toPrice:sL
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
  }

  if(
    compressing &&
    highDelta<-a*.10 &&
    lowDelta>a*.10
  ){
    if(breakUp){
      return make(
  'SYMMETRICAL TRIANGLE BREAKOUT',
  'LONG',
  sH,
  sH+zone,
  sL-a*.25,
  px+a,
  px+a*2,
  {
    kind:'SYMMETRICAL_TRIANGLE',
    timeframe:'15m',

    upperLine:{
      fromTime:first[0].t,
      fromPrice:fH,
      toTime:second.at(-1).t,
      toPrice:sH
    },

    lowerLine:{
      fromTime:first[0].t,
      fromPrice:fL,
      toTime:second.at(-1).t,
      toPrice:sL
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
    }

    if(breakDown){
      return make(
  'SYMMETRICAL TRIANGLE BREAKDOWN',
  'SHORT',
  sL-zone,
  sL,
  sH+a*.25,
  px-a,
  px-a*2,
  {
    kind:'SYMMETRICAL_TRIANGLE',
    timeframe:'15m',

    upperLine:{
      fromTime:first[0].t,
      fromPrice:fH,
      toTime:second.at(-1).t,
      toPrice:sH
    },

    lowerLine:{
      fromTime:first[0].t,
      fromPrice:fL,
      toTime:second.at(-1).t,
      toPrice:sL
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
    }
  }

  if(
    compressing &&
    highDelta>a*.10 &&
    lowDelta>a*.10 &&
    breakDown
  ){
    return make(
  'RISING WEDGE BREAKDOWN',
  'SHORT',
  sL-zone,
  sL,
  sH+a*.25,
  px-a,
  px-a*2,
  {
    kind:'RISING_WEDGE',
    timeframe:'15m',

    upperLine:{
      fromTime:first[0].t,
      fromPrice:fH,
      toTime:second.at(-1).t,
      toPrice:sH
    },

    lowerLine:{
      fromTime:first[0].t,
      fromPrice:fL,
      toTime:second.at(-1).t,
      toPrice:sL
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
  }

  if(
    compressing &&
    highDelta<-a*.10 &&
    lowDelta<-a*.10 &&
    breakUp
  ){
    return make(
  'FALLING WEDGE BREAKOUT',
  'LONG',
  sH,
  sH+zone,
  sL-a*.25,
  px+a,
  px+a*2,
  {
    kind:'FALLING_WEDGE',
    timeframe:'15m',

    upperLine:{
      fromTime:first[0].t,
      fromPrice:fH,
      toTime:second.at(-1).t,
      toPrice:sH
    },

    lowerLine:{
      fromTime:first[0].t,
      fromPrice:fL,
      toTime:second.at(-1).t,
      toPrice:sL
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
  }

  const pole=b15.slice(-14,-7);
  const flag=b15.slice(-7,-1);

  const poleMove=
    pole.at(-1).c-pole[0].o;

  const flagHigh=
    Math.max(...flag.map(x=>x.h));

  const flagLow=
    Math.min(...flag.map(x=>x.l));

  const tightFlag=
    flagHigh-flagLow<=
    Math.max(a*1.5,Math.abs(poleMove)*.55);

  if(
    Math.abs(poleMove)>=a*2.2 &&
    tightFlag &&
    poleMove>0 &&
    i15.trend==='BULLISH' &&
    px>flagHigh+buffer &&
    i5.hist>0
  ){
    return make(
  'BULL FLAG / PENNANT BREAKOUT',
  'LONG',
  flagHigh,
  flagHigh+zone,
  flagLow-a*.25,
  px+a,
  px+a*2,
  {
    kind:'BULL_FLAG_PENNANT',
    timeframe:'15m',

    poleLine:{
      fromTime:pole[0].t,
      fromPrice:pole[0].o,
      toTime:pole.at(-1).t,
      toPrice:pole.at(-1).c
    },

    upperLine:{
      fromTime:flag[0].t,
      fromPrice:flagHigh,
      toTime:flag.at(-1).t,
      toPrice:flagHigh
    },

    lowerLine:{
      fromTime:flag[0].t,
      fromPrice:flagLow,
      toTime:flag.at(-1).t,
      toPrice:flagLow
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
  }

  if(
    Math.abs(poleMove)>=a*2.2 &&
    tightFlag &&
    poleMove<0 &&
    i15.trend==='BEARISH' &&
    px<flagLow-buffer &&
    i5.hist<0
  ){
    return make(
  'BEAR FLAG / PENNANT BREAKDOWN',
  'SHORT',
  flagLow-zone,
  flagLow,
  flagHigh+a*.25,
  px-a,
  px-a*2,
  {
    kind:'BEAR_FLAG_PENNANT',
    timeframe:'15m',

    poleLine:{
      fromTime:pole[0].t,
      fromPrice:pole[0].o,
      toTime:pole.at(-1).t,
      toPrice:pole.at(-1).c
    },

    upperLine:{
      fromTime:flag[0].t,
      fromPrice:flagHigh,
      toTime:flag.at(-1).t,
      toPrice:flagHigh
    },

    lowerLine:{
      fromTime:flag[0].t,
      fromPrice:flagLow,
      toTime:flag.at(-1).t,
      toPrice:flagLow
    },

    confirmTime:
      bars.at(-1).t,

    confirmPrice:px
  }
);
  }

  return null;
}

 function detectFormingPattern(bars,b15,i5,i15){
  if(bars.length<40 || b15.length<24)return null;

  const a=atr(b15);
  const px=bars.at(-1).c;
  const buffer=Math.max(0.03,a*.05);

  const shape=b15.slice(-19,-1);
  const half=Math.floor(shape.length/2);
  const first=shape.slice(0,half);
  const second=shape.slice(half);

  const fH=Math.max(...first.map(x=>x.h));
  const fL=Math.min(...first.map(x=>x.l));
  const sH=Math.max(...second.map(x=>x.h));
  const sL=Math.min(...second.map(x=>x.l));

  const compressing=
    (sH-sL)<(fH-fL)*.90;

  const highDelta=sH-fH;
  const lowDelta=sL-fL;

  const flatHigh=
    Math.abs(highDelta)<=a*.25;

  const flatLow=
    Math.abs(lowDelta)<=a*.25;

   const shapeGeometry=kind=>({
  kind,
  timeframe:'15m',

  upperLine:{
    fromTime:first[0].t,
    fromPrice:fH,
    toTime:second.at(-1).t,
    toPrice:sH
  },

  lowerLine:{
    fromTime:first[0].t,
    fromPrice:fL,
    toTime:second.at(-1).t,
    toPrice:sL
  }
});

  if(
    compressing &&
    flatHigh &&
    lowDelta>a*.10 &&
    px<=sH+buffer
  ){
    return{
  type:'ASCENDING TRIANGLE',
  bias:'LONG',
  waitingFor:
    'WAIT FOR BREAKOUT ABOVE '+sH.toFixed(2),

  geometry:
    shapeGeometry('ASCENDING_TRIANGLE')
};
  }

  if(
    compressing &&
    flatLow &&
    highDelta<-a*.10 &&
    px>=sL-buffer
  ){
    return{
  type:'DESCENDING TRIANGLE',
  bias:'SHORT',
  waitingFor:
    'WAIT FOR BREAKDOWN BELOW '+sL.toFixed(2),

  geometry:
    shapeGeometry('DESCENDING_TRIANGLE')
};
  }

  if(
    compressing &&
    highDelta<-a*.10 &&
    lowDelta>a*.10 &&
    px>=sL-buffer &&
    px<=sH+buffer
  ){
    return{
  type:'SYMMETRICAL TRIANGLE',
  bias:'WAIT',
  waitingFor:
    'WAIT FOR BREAKOUT ABOVE '+
    sH.toFixed(2)+
    ' OR BELOW '+
    sL.toFixed(2),

  geometry:
    shapeGeometry('SYMMETRICAL_TRIANGLE')
};
  }

  if(
    compressing &&
    highDelta>a*.10 &&
    lowDelta>a*.10 &&
    px>=sL-buffer
  ){
    return{
  type:'RISING WEDGE',
  bias:'SHORT',
  waitingFor:
    'WAIT FOR BREAKDOWN BELOW '+sL.toFixed(2),

  geometry:
    shapeGeometry('RISING_WEDGE')
};
  }

  if(
    compressing &&
    highDelta<-a*.10 &&
    lowDelta<-a*.10 &&
    px<=sH+buffer
  ){
    return{
  type:'FALLING WEDGE',
  bias:'LONG',
  waitingFor:
    'WAIT FOR BREAKOUT ABOVE '+sH.toFixed(2),

  geometry:
    shapeGeometry('FALLING_WEDGE')
};
  }

  const pole=b15.slice(-14,-7);
  const flag=b15.slice(-7,-1);

  const poleMove=
    pole.at(-1).c-pole[0].o;

  const flagHigh=
    Math.max(...flag.map(x=>x.h));

  const flagLow=
    Math.min(...flag.map(x=>x.l));

  const tightFlag=
    flagHigh-flagLow<=
    Math.max(
      a*1.5,
      Math.abs(poleMove)*.55
    );

  if(
    Math.abs(poleMove)>=a*2.2 &&
    tightFlag &&
    poleMove>0 &&
    i15.trend==='BULLISH' &&
    px<=flagHigh+buffer
  ){
    return{
  type:'BULL FLAG / PENNANT',
  bias:'LONG',
  waitingFor:
    'WAIT FOR BREAKOUT ABOVE '+
    flagHigh.toFixed(2)+
    ' + POSITIVE 5m MOMENTUM',

  geometry:{
    kind:'BULL_FLAG_PENNANT',
    timeframe:'15m',

    poleLine:{
      fromTime:pole[0].t,
      fromPrice:pole[0].o,
      toTime:pole.at(-1).t,
      toPrice:pole.at(-1).c
    },

    upperLine:{
      fromTime:flag[0].t,
      fromPrice:flagHigh,
      toTime:flag.at(-1).t,
      toPrice:flagHigh
    },

    lowerLine:{
      fromTime:flag[0].t,
      fromPrice:flagLow,
      toTime:flag.at(-1).t,
      toPrice:flagLow
    }
  }
};
  }

  if(
    Math.abs(poleMove)>=a*2.2 &&
    tightFlag &&
    poleMove<0 &&
    i15.trend==='BEARISH' &&
    px>=flagLow-buffer
  ){
    return{
  type:'BEAR FLAG / PENNANT',
  bias:'SHORT',
  waitingFor:
    'WAIT FOR BREAKDOWN BELOW '+
    flagLow.toFixed(2)+
    ' + NEGATIVE 5m MOMENTUM',

  geometry:{
    kind:'BEAR_FLAG_PENNANT',
    timeframe:'15m',

    poleLine:{
      fromTime:pole[0].t,
      fromPrice:pole[0].o,
      toTime:pole.at(-1).t,
      toPrice:pole.at(-1).c
    },

    upperLine:{
      fromTime:flag[0].t,
      fromPrice:flagHigh,
      toTime:flag.at(-1).t,
      toPrice:flagHigh
    },

    lowerLine:{
      fromTime:flag[0].t,
      fromPrice:flagLow,
      toTime:flag.at(-1).t,
      toPrice:flagLow
    }
  }
};
  }

  return null;
}

  function makeLevelSetup(bars,b15,b30,i5,i15,i30,i240){
  const structureLevels15=getLevels(b15);
  const structureLevels30=getLevels(b30);
  const structureAtr15=atr(b15);
  const structureAtr30=atr(b30);
  const structureZone=Math.max(0.10,structureAtr15*.25,structureAtr30*.15);
  const structureSupport=Math.max(structureLevels15.support,structureLevels30.support);
  const structureResistance=Math.min(structureLevels15.resistance,structureLevels30.resistance);  
  
  const structureSupportConfluence=
    Math.abs(
    structureLevels15.support-
    structureLevels30.support
  )<=structureZone*2;
    
  const structureResistanceConfluence=
    Math.abs(
    structureLevels15.resistance-
    structureLevels30.resistance
  )<=structureZone*2;
 
  const reversalPattern=
  detectReversalPattern(
    bars,
    b15,
    i5
  );

 if(
  reversalPattern &&
  (
    (
      reversalPattern.direction==='LONG' &&
      i15.trend==='BULLISH' &&
      i30.trend==='BULLISH' &&
      i240.trend==='BULLISH'
    ) ||
    (
      reversalPattern.direction==='SHORT' &&
      i15.trend==='BEARISH' &&
      i30.trend==='BEARISH' &&
      i240.trend==='BEARISH'
    )
  )
){
  
  const patternEntryMid=
  (reversalPattern.entryLow+reversalPattern.entryHigh)/2;

const isScalpReversal=
  reversalPattern.type.includes('SCALP');

const structureNear=
  reversalPattern.direction==='LONG'
    ?Math.abs(patternEntryMid-structureSupport)<=structureZone*2
    :Math.abs(patternEntryMid-structureResistance)<=structureZone*2;

const structureOk=
  !isScalpReversal ||
  (
    reversalPattern.direction==='LONG'
      ?structureSupportConfluence && structureNear
      :structureResistanceConfluence && structureNear
  );

  if(structureOk){
  
if(
  isScalpReversal &&
  reversalPattern.direction==='LONG'
){
  reversalPattern.entryLow=
    structureSupport;

  reversalPattern.entryHigh=
    structureSupport+structureZone;

  reversalPattern.stop=
    Math.min(
      structureLevels15.support,
      structureLevels30.support
    )-
    Math.max(
      structureAtr15*.4,
      structureAtr30*.20
    );

  reversalPattern.tp1=
    structureResistance;

  reversalPattern.tp2=
    structureResistance+
    Math.max(
      structureAtr15*.5,
      structureAtr30*.25
    );
}
  
if(
  isScalpReversal &&
  reversalPattern.direction==='SHORT'
){
  reversalPattern.entryLow=
    structureResistance-structureZone;

  reversalPattern.entryHigh=
    structureResistance;

  reversalPattern.stop=
    Math.max(
      structureLevels15.resistance,
      structureLevels30.resistance
    )+
    Math.max(
      structureAtr15*.4,
      structureAtr30*.20
    );

  reversalPattern.tp1=
    structureSupport;

  reversalPattern.tp2=
    structureSupport-
    Math.max(
      structureAtr15*.5,
      structureAtr30*.25
    );
}
  return reversalPattern;
}
}
  const continuationPattern=
  detectContinuationPattern(
    bars,
    b15,
    i5,
    i15
  );

if(continuationPattern){
  const trendOk=
  (
    continuationPattern.direction==='LONG' &&
i15.trend==='BULLISH' &&
i30.trend==='BULLISH' &&
i240.trend==='BULLISH'
  ) ||
  (
    continuationPattern.direction==='SHORT' &&
    i15.trend==='BEARISH' &&
    i30.trend==='BEARISH' &&
    i240.trend==='BEARISH'
  );

  if(trendOk){
    return continuationPattern;
  }
}
  
  const levels=getLevels(bars);
  const levels15=getLevels(b15);
  const levels30=getLevels(b30);
  const a=atr(b15);
  const a30=atr(b30);
  const zoneSize=Math.max(0.10,a*.25,a30*.15);
  const supportLevel=Math.max(levels15.support,levels30.support);
  const resistanceLevel=Math.min(levels15.resistance,levels30.resistance);
  
  const supportConfluence=
  Math.abs(levels15.support-levels30.support)<=zoneSize*2;

  const resistanceConfluence=
  Math.abs(levels15.resistance-levels30.resistance)<=zoneSize*2;
  
  const px=levels.price;
  const prev=bars.at(-2).c;
  const last=bars.at(-1);

  const breakoutLevels=
  getLevels(bars.slice(0,-1));

  const nearSupport=
  supportConfluence &&
  px<=supportLevel+zoneSize &&
  px>=supportLevel-zoneSize*.35;

  const nearResistance=
  resistanceConfluence &&
  px>=resistanceLevel-zoneSize &&
  px<=resistanceLevel+zoneSize*.35;
    
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
      entryLow:supportLevel,
      entryHigh:supportLevel+zoneSize,
      stop:Math.min(levels15.support,levels30.support)-Math.max(a*.5,a30*.25),
      tp1:resistanceLevel,
      tp2:resistanceLevel+Math.max(a*.75,a30*.35)
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
      entryLow:resistanceLevel-zoneSize,
      entryHigh:resistanceLevel,
      stop:Math.max(levels15.resistance,levels30.resistance)+Math.max(a*.5,a30*.25),
      tp1:supportLevel,
      tp2:supportLevel-Math.max(a*.75,a30*.35)
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
    entryLow:resistanceLevel-zoneSize,
    entryHigh:resistanceLevel,
    stop:Math.max(levels15.resistance,levels30.resistance)+Math.max(a*.4,a30*.20),
    tp1:supportLevel,
    tp2:supportLevel-Math.max(a*.5,a30*.25)
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
    entryLow:supportLevel,
    entryHigh:supportLevel+zoneSize,
    stop:Math.min(levels15.support,levels30.support)-Math.max(a*.4,a30*.20),
    tp1:resistanceLevel,
    tp2:resistanceLevel+Math.max(a*.5,a30*.25)
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
  i240,
  i30=null,
  now=Date.now()
){
  const completedAt=
    bars.at(-1).t+5*M;

  const ageMinutes=
    Math.max(
      0,
      (now-completedAt)/M
    );

  if(ageMinutes>15){
    return 'WAIT';
  }

if(
  !i30 ||
  i30.trend==='NEUTRAL' ||
  i30.trend!==i15.trend
){
  return 'WAIT';
}
  if(
    i5.trend!==i15.trend
  ){
    return 'WAIT';
  }

  if(
  !i240 ||
  i240.trend==='NEUTRAL' ||
  i240.trend!==i30.trend
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
function makeConfidence(
  direction,
  setupType,
  confirmation
){
  if(
    !['LONG','SHORT'].includes(direction) ||
    !confirmation?.dataFresh ||
    confirmation?.eventBlocked
  ){
    return null;
  }

  const bullish=
    direction==='LONG';

  const wanted=
    bullish
      ?'BULLISH'
      :'BEARISH';

  let score=45;
  const reasons=[];

  const trends=[
    ['5m',confirmation.fiveMinTrend],
    ['15m',confirmation.fifteenMinTrend],
    ['1H',confirmation.oneHourTrend],
    ['4H',confirmation.fourHourTrend]
  ];

  let aligned=0;

  for(const [name,trend] of trends){
    if(trend===wanted){
      score+=5;
      aligned++;
    }
  }

  reasons.push(
    aligned+'/4 timeframes aligned'
  );

  const rsi=
    confirmation.fifteenMinRsi;

  if(
    bullish &&
    rsi>=55
  ){
    score+=6;
    reasons.push('15m RSI supports LONG');
  }

  if(
    !bullish &&
    rsi<=45
  ){
    score+=6;
    reasons.push('15m RSI supports SHORT');
  }

  if(
    bullish &&
    confirmation.fiveMinHist>0
  ){
    score+=4;
  }

  if(
    !bullish &&
    confirmation.fiveMinHist<0
  ){
    score+=4;
  }

  if(
    bullish &&
    confirmation.fifteenMinHist>0
  ){
    score+=4;
  }

  if(
    !bullish &&
    confirmation.fifteenMinHist<0
  ){
    score+=4;
  }

  if(
    setupType &&
    setupType!=='TREND LONG' &&
    setupType!=='TREND SHORT' &&
    setupType!=='NONE'
  ){
    score+=5;
    reasons.push('Confirmed pattern setup');
  }

  if(confirmation.newsAvailable){
    if(
      confirmation.newsBias===wanted
    ){
      score+=7;
      reasons.push('News supports direction');
    }else if(
      confirmation.newsBias==='MIXED' ||
      confirmation.newsBias==='NEUTRAL'
    ){
      reasons.push('News is neutral/mixed');
    }
  }

  if(
    confirmation.maritimeRisk==='HIGH'
  ){
    score-=6;
    reasons.push('High maritime risk');
  }else if(
    confirmation.maritimeRisk==='ELEVATED'
  ){
    score-=3;
    reasons.push('Elevated maritime risk');
  }

  score=Math.max(
    0,
    Math.min(100,score)
  );

  const label=
    score>=75
      ?'HIGH'
      :score>=60
      ?'MEDIUM'
      :'LOW';

  return{
    score,
    label,
    reasons
  };
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

async function getNewsContext(req){
  const fallback={
    available:false,
    bias:'UNKNOWN',
    maritimeRisk:'UNKNOWN',
    bullish:0,
    bearish:0,
    recent:0
  };

  const host=
    req.headers['x-forwarded-host']||
    req.headers.host;

  if(!host)return fallback;

  const controller=
    new AbortController();

  const timer=
    setTimeout(
      ()=>controller.abort(),
      5000
    );

  try{
    const proto=
      String(
        req.headers['x-forwarded-proto']||
        'https'
      )
      .split(',')[0]
      .trim();

    const response=
      await fetch(
        proto+'://'+host+'/api/news',
        {
          signal:controller.signal,
          headers:{
            Accept:'application/json'
          }
        }
      );

    if(!response.ok){
      return fallback;
    }

    const data=
      await response.json();

    const now=Date.now();

    const items=
      (Array.isArray(data.items)
        ?data.items
        :[]
      ).filter(item=>{
        const published=
          Date.parse(
            item.published||''
          );

        return(
          Number.isFinite(published) &&
          published<=now &&
          now-published<=12*60*M
        );
      });

    const bullishWords=[
      'attack',
      'tanker strike',
      'war',
      'sanction',
      'supply cut',
      'production cut',
      'output cut',
      'export disruption',
      'supply disruption',
      'hormuz closure',
      'oil prices rise',
      'oil prices jump',
      'crude rises',
      'crude jumps'
    ];

    const bearishWords=[
      'inventory build',
      'output increase',
      'production increase',
      'demand concern',
      'demand weak',
      'reserve release',
      'release diesel reserves',
      'release oil reserves',
      'oil prices fall',
      'oil prices drop',
      'crude falls',
      'crude drops'
    ];

    let bullish=0;
    let bearish=0;

    for(const item of items){
      const title=
        String(
          item.title||''
        ).toLowerCase();

      if(
        bullishWords.some(
          x=>title.includes(x)
        )
      ){
        bullish++;
      }else if(
        bearishWords.some(
          x=>title.includes(x)
        )
      ){
        bearish++;
      }
    }

    const bias=
      bullish>=bearish+2
      ?'BULLISH'
      :bearish>=bullish+2
      ?'BEARISH'
      :'MIXED';

    return{
      available:true,
      bias,
      maritimeRisk:
        String(
          data.maritime?.risk||
          'UNKNOWN'
        ),
      bullish,
      bearish,
      recent:items.length,
      fetchedAt:
        data.fetchedAt||null
    };

  }catch{
    return fallback;

  }finally{
    clearTimeout(timer);
  }
}

export default async function handler(
  req,
  res
){
  try{
    if(req.query?.view!=='1'){
  const recentState=
    await readBlob('push/monitor-state.json');

  const recentCheckedAt=
    Date.parse(recentState?.checkedAt||'');

  if(
    Number.isFinite(recentCheckedAt) &&
    Date.now()-recentCheckedAt<4*M
  ){
    return res.status(200).json({
      ok:true,
      skipped:true,
      reason:'Recent background monitor check already completed.',
      checkedAt:recentState.checkedAt
    });
  }
}
    const host=
  req.headers['x-forwarded-host']||
  req.headers.host;

if(!host){
  throw new Error(
    'No request host'
  );
}

const proto=
  String(
    req.headers['x-forwarded-proto']||
    'https'
  )
    .split(',')[0]
    .trim();

const response=
  await fetch(
    proto+
    '://'+
    host+
    '/api/candles',
    {
      cache:'no-store',
      headers:{
        'Accept':'application/json'
      }
    }
  );

if(!response.ok){
  throw new Error(
    'WTI candle API HTTP '+
    response.status
  );
}

const data=
  await response.json();

const now=
  Date.now();

const bars=
  (
    Array.isArray(data.bars)
      ?data.bars
      :[]
  )
    .map(b=>({
      t:Number(b.t),
      o:Number(b.o),
      h:Number(b.h),
      l:Number(b.l),
      c:Number(b.c),
      v:Number.isFinite(
        Number(b.v)
      )
        ?Number(b.v)
        :0
    }))
    .filter(
      b=>
        [
          b.t,
          b.o,
          b.h,
          b.l,
          b.c
        ].every(Number.isFinite)
        &&
        b.o>0
        &&
        b.h>0
        &&
        b.l>0
        &&
        b.c>0
        &&
        b.t%(5*M)===0
        &&
        b.t+5*M<=now
    )
    .slice(-4000);

if(bars.length<40){
  throw new Error(
    'Not enough WTI candle data'
  );
}

    const b15=
      aggregate(bars,15);
    
    const b30=
  aggregate(bars,30);

    const b60=
      aggregate(bars,60);

    const b240=
      aggregate(bars,240);

    const i5=
      indicators(bars);

    const i15=
      indicators(b15);

    const i30=
  indicators(b30);

    const i60=
      indicators(b60);

    const i240=
      indicators(b240);

    if(
      !i5 ||
      !i15 ||
      !i30 ||
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
  thirtyMinTrend:i30.trend,
  thirtyMinHist:i30.hist,
  fiveMinRsi:i5.rsi,
  fiveMinRvol:i5.volume.rvol, 
  fiveMinVwapPosition:i5.volume.vwapPosition,    
  fiveMinVwap20:i5.volume.vwap20,
  fiveMinVwapDistance:Number.isFinite(i5.volume.vwap20)
  ?bars.at(-1).c-i5.volume.vwap20
  :null,
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
      i240,
      i30
   );
     
    const lastCandleClosedAt=
  bars.at(-1).t+5*M;

const dataAgeMinutes=
  Math.max(
    0,
    (now-lastCandleClosedAt)/M
  );

let levelSetup=
  dataAgeMinutes<=15
    ?makeLevelSetup(
      bars,
      b15,
      b30,
      i5,
      i15,
      i30,
      i240
    )
    :null;

    if(levelSetup){
  const entryMid=
    (levelSetup.entryLow+levelSetup.entryHigh)/2;

  const risk=
    levelSetup.direction==='LONG'
      ?entryMid-levelSetup.stop
      :levelSetup.stop-entryMid;

  const reward1=
    levelSetup.direction==='LONG'
      ?levelSetup.tp1-entryMid
      :entryMid-levelSetup.tp1;

  if(
    risk<=0 ||
    reward1/risk<1.3
  ){
    levelSetup=null;
  }
}
    const formingPatternCandidate=
  dataAgeMinutes<=15 &&
  !levelSetup &&
  i30.trend!=='NEUTRAL' &&
  i240.trend===i30.trend &&
  i15.trend===i30.trend
    ?detectFormingPattern(
      bars,
      b15,
      i5,
      i15
    )
    :null;

const formingPattern=
  formingPatternCandidate &&
  (
    formingPatternCandidate.bias==='WAIT' ||
    (
      formingPatternCandidate.bias==='LONG' &&
      i30.trend==='BULLISH'
    ) ||
    (
      formingPatternCandidate.bias==='SHORT' &&
      i30.trend==='BEARISH'
    )
  )
    ?formingPatternCandidate
    :null;

    confirmation.lastCandleClosedAt=
  new Date(lastCandleClosedAt).toISOString();

confirmation.dataAgeMinutes=
  Number(dataAgeMinutes.toFixed(2));

confirmation.dataFresh=
  dataAgeMinutes<=15;
   
    const rawLevels=
  getLevels(bars);

    const levelZones=
  getLevelZones(
    bars,
    b15,
    b30
  );

    const levels={
  resistance:levelZones.resistanceZoneHigh,
  support:levelZones.supportZoneLow,
  price:rawLevels.price,
  distanceToResistance:
    Math.abs(
      levelZones.resistanceZoneHigh-
      rawLevels.price
    ),
  distanceToSupport:
    Math.abs(
      rawLevels.price-
      levelZones.supportZoneLow
    )
};

    const nearestZone=
  Math.abs(
    levels.price-levelZones.resistanceZoneHigh
  )<
  Math.abs(
    levels.price-levelZones.supportZoneLow
  )
  ?'RESISTANCE'
  :'SUPPORT';

  const zoneStatus=
  levels.price>levelZones.resistanceZoneHigh
  ?'ABOVE RESISTANCE'
  :levels.price>=levelZones.resistanceZoneLow
  ?'IN RESISTANCE ZONE'
  :levels.price<levelZones.supportZoneLow
  ?'BELOW SUPPORT'
  :levels.price<=levelZones.supportZoneHigh
  ?'IN SUPPORT ZONE'
  :nearestZone==='RESISTANCE'
  ?'APPROACHING RESISTANCE'
  :'APPROACHING SUPPORT';
   
    let technicalDirection=
  dataAgeMinutes<=15
    ?(levelSetup?.direction||current)
    :'WAIT';

if(
  (
    technicalDirection==='LONG' &&
    i15.trend!=='BULLISH'
  ) ||
  (
    technicalDirection==='SHORT' &&
    i15.trend!=='BEARISH'
  )
){
  technicalDirection='WAIT';
}

if(
  (
    technicalDirection==='LONG' &&
    i30.trend!=='BULLISH'
  ) ||
  (
    technicalDirection==='SHORT' &&
    i30.trend!=='BEARISH'
  )
){
  technicalDirection='WAIT';
}

if(
  technicalDirection==='LONG' &&
  i240.trend!=='BULLISH'
){
  technicalDirection='WAIT';
}

if(
  technicalDirection==='SHORT' &&
  i240.trend!=='BEARISH'
){
  technicalDirection='WAIT';
}
const eventRisk=
  getEventRisk(now);
    
const newsContext=
  await getNewsContext(req);

const newsConflict=
  technicalDirection!=='WAIT' &&
  newsContext.available &&
  newsContext.recent>=2 &&
  (
    (
      technicalDirection==='LONG' &&
      newsContext.bias==='BEARISH'
    ) ||
    (
      technicalDirection==='SHORT' &&
      newsContext.bias==='BULLISH'
    )
  );

let activeDirection=
  eventRisk.blocked ||
  newsConflict
    ?'WAIT'
    :technicalDirection;

  const latest5=
  bars.at(-1);

const previous5=
  bars.at(-2);

const previousMid=
  previous5
    ?(previous5.o+previous5.c)/2
    :null;

const entryTriggered=
  !!latest5 &&
  !!previous5 &&
  (
    (
      activeDirection==='LONG' &&
      previous5.c<previous5.o &&
      latest5.c>latest5.o &&
      latest5.l<=previous5.l &&
      latest5.c>previousMid
    ) ||
    (
      activeDirection==='SHORT' &&
      previous5.c>previous5.o &&
      latest5.c<latest5.o &&
      latest5.h>=previous5.h &&
      latest5.c<previousMid
    )
  );

confirmation.entryTriggered=
  entryTriggered;

confirmation.signalStage=
  activeDirection==='WAIT'
    ?'WAIT'
    :entryTriggered
    ?'ENTRY CONFIRMED'
    :'WAIT FOR 5m TRIGGER';

confirmation.entryTriggerText=
  activeDirection==='LONG'
    ?'Wait for a completed 5m bullish rejection after sweeping the previous 5m low and reclaiming its midpoint.'
    :activeDirection==='SHORT'
    ?'Wait for a completed 5m bearish rejection after sweeping the previous 5m high and falling back below its midpoint.'
    :'No active directional setup.';

    if(
  activeDirection!=='WAIT' &&
  !entryTriggered
){
  activeDirection='WAIT';
}

    confirmation.newsAvailable=
  newsContext.available;

confirmation.newsBias=
  newsContext.bias;

confirmation.maritimeRisk=
  newsContext.maritimeRisk;

confirmation.newsBullish=
  newsContext.bullish;

confirmation.newsBearish=
  newsContext.bearish;

confirmation.newsRecent=
  newsContext.recent;

confirmation.newsConflict=
  newsConflict;

confirmation.eventBlocked=
  eventRisk.blocked;

confirmation.eventStatus=
  eventRisk.status;

confirmation.activeEvent=
  eventRisk.activeEvent;

confirmation.nextEvent=
  eventRisk.nextEvent;
    
confirmation.technicalDirection=
  technicalDirection;

confirmation.waitReason=
  activeDirection!=='WAIT'
  ?null
  :eventRisk.blocked
  ?'High-impact event block is active.'
  :newsConflict
  ?'Technical signal blocked by conflicting news risk.'
  :dataAgeMinutes>15
  ?'Market data is not fresh enough.'
  :i240.trend!=='NEUTRAL' &&
 i240.trend!==i30.trend
?'4H is '+i240.trend+' while 30m is '+i30.trend+'.'
:i30.trend!==i15.trend
?'30m is '+i30.trend+' while 15m is '+i15.trend+'.'
:i5.trend!==i15.trend
?'5m is '+i5.trend+' while 15m is '+i15.trend+'.'
  :i15.trend==='BEARISH' &&
   i5.hist>=0
  ?'Bearish 15m structure, but 5m momentum has not confirmed SHORT.'
  :i15.trend==='BULLISH' &&
   i5.hist<=0
  ?'Bullish 15m structure, but 5m momentum has not confirmed LONG.'
  :i15.trend==='BEARISH' &&
   i15.hist>=0
  ?'Bearish structure, but 15m momentum has not confirmed SHORT.'
  :i15.trend==='BULLISH' &&
   i15.hist<=0
  ?'Bullish structure, but 15m momentum has not confirmed LONG.'
  :'No fully confirmed setup yet.';
const prices=
  activeDirection==='WAIT'
    ?null
    :(levelSetup||
      makeSetupPrices(
        activeDirection,
        b15,
        bars
      ));

const setupType=
  activeDirection==='WAIT'
    ?'NONE'
    :(levelSetup?.type||
      (activeDirection==='LONG'
        ?'TREND LONG'
        :'TREND SHORT'));
    
const confidence=
  makeConfidence(
    activeDirection,
    setupType,
    confirmation
  );

        // Let the app read the setup without changing alert state.
    if(req.query?.view==='1'){
      return res.status(200).json({
        ok:true,
        direction:activeDirection,
        prices,
        levels,
        levelZones,
        nearestZone,
        zoneStatus,
        setupType,
        formingPattern,
        confidence,
        confirmation
      });
    }

    const previous=
      await readBlob(
        'push/monitor-state.json'
      );

    const oldDirection=
      previous?.direction??null;
     
    const oldSetupType=
  previous?.setupType??null;

const isNewSignal=
  (
    activeDirection==='LONG' ||
    activeDirection==='SHORT'
  ) &&
  (
    oldDirection!==activeDirection ||
    oldSetupType!==setupType
  );

const journalUpdate=
  await updateSignalJournal({
  bars,
  direction:activeDirection,
  setupType,
  prices,
  confirmation,
  isNewSignal
});
   const journalEvents=
  journalUpdate?.events||[]; 
    if(journalEvents.length){
  const eventStored=
    await readBlob('push/subscription.json');

  if(eventStored?.subscription){
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    for(const event of journalEvents){
      const label=
        event.type==='STOP_AFTER_TP1'
          ?'STOP AFTER TP1'
          :event.type;

      await webpush.sendNotification(
        eventStored.subscription,
        JSON.stringify({
          title:'WTI Pro · '+label,
          body:
            event.direction+' · '+
            event.setupType+' · '+
            label+' '+Number(event.price).toFixed(2),
          url:'/simple.html'
        })
      );
    }
  }
}
    if(
      oldDirection===null ||
      (
        oldDirection===activeDirection &&
        (
          previous?.setupType==null ||
          previous.setupType===setupType
        )
      )
    ){
      await saveBlob(
        'push/monitor-state.json',
        {
          direction:activeDirection,
          setupType,
          checkedAt:new Date().toISOString()
        }
      );
    }

    if(
      oldDirection===null ||
      (
  oldDirection===activeDirection &&
  (
    previous?.setupType==null ||
    previous.setupType===setupType
  )
)
    ){
      return res.status(200).json({
          ok:true,
          direction:activeDirection,
          prices,
          levels,
          levelZones,
          nearestZone,
          zoneStatus,
          setupType,
          formingPattern,
          confirmation,
          changed:false
        });
    }

    const stored=
      await readBlob(
        'push/subscription.json'
      );

    if(!stored?.subscription){
        await saveBlob(
    'push/monitor-state.json',
    {
      direction:activeDirection,
      setupType,
      checkedAt:new Date().toISOString()
    }
  );
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
          formingPattern,
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

        await saveBlob(
      'push/monitor-state.json',
      {
        direction:activeDirection,
        setupType,
        checkedAt:new Date().toISOString()
      }
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
        formingPattern,
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

export {
  aggregate,
  indicators,
  atr,
  makeSetupPrices,
  makeLevelSetup,
  makeDirection
};
