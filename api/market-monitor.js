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
    stop,tp1,tp2
  )=>({
    type,
    direction,
    entryLow,
    entryHigh,
    stop,
    tp1,
    tp2
  });

  const nearSupport=
    last.l<=base.support+zone &&
    last.c>=base.support-zone*.35;

  const nearResistance=
    last.h>=base.resistance-zone &&
    last.c<=base.resistance+zone*.35;

  const prevBody=Math.abs(prev.c-prev.o);
  const body=Math.abs(last.c-last.o);
  const range=Math.max(.0001,last.h-last.l);

  const upper=
    last.h-Math.max(last.o,last.c);

  const lower=
    Math.min(last.o,last.c)-last.l;

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
        price:recent[i].h
      });
    }

    if(
      recent[i].l<=recent[i-1].l &&
      recent[i].l<=recent[i+1].l
    ){
      lows.push({
        i,
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
          px-a*2
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
          px+a*2
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
          px-a*2
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
          px+a*2
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

  const make=(type,direction,entryLow,entryHigh,stop,tp1,tp2)=>({
    type,direction,entryLow,entryHigh,stop,tp1,tp2
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
      px+a*2
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
      px-a*2
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
        px+a*2
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
        px-a*2
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
      px-a*2
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
      px+a*2
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
      px+a*2
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
      px-a*2
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
        'WAIT FOR BREAKOUT ABOVE '+sH.toFixed(2)
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
        'WAIT FOR BREAKDOWN BELOW '+sL.toFixed(2)
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
        sL.toFixed(2)
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
        'WAIT FOR BREAKDOWN BELOW '+sL.toFixed(2)
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
        'WAIT FOR BREAKOUT ABOVE '+sH.toFixed(2)
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
        ' + POSITIVE 5m MOMENTUM'
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
        ' + NEGATIVE 5m MOMENTUM'
    };
  }

  return null;
}

  function makeLevelSetup(bars,b15,i5,i15){
 const reversalPattern=
  detectReversalPattern(
    bars,
    b15,
    i5
  );

  if(reversalPattern){
    return reversalPattern;
  }
  const continuationPattern=
  detectContinuationPattern(
    bars,
    b15,
    i5,
    i15
  );

if(continuationPattern){
  return continuationPattern;
}
  
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

    const formingPattern=
  dataAgeMinutes<=15 &&
  !levelSetup
    ?detectFormingPattern(
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
        confirmation
      });
    }

    const previous=
      await readBlob(
        'push/monitor-state.json'
      );

    const oldDirection=
      previous?.direction??null;

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
