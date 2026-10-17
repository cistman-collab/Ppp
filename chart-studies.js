(function(root){
 'use strict';
 const finite=Number.isFinite;
 function sma(values,period){return values.map((_,i)=>{const window=values.slice(i-period+1,i+1);return i>=period-1&&window.length===period&&window.every(finite)?window.reduce((a,b)=>a+b,0)/period:null;});}
 function ema(values,period){
  const out=values.map(()=>null);if(values.length<period)return out;
  out[period-1]=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<values.length;i++)out[i]=values[i]*2/(period+1)+out[i-1]*(1-2/(period+1));
  return out;
 }
 function rsi(values,period=14){
  const out=values.map(()=>null);if(values.length<=period)return out;
  let gain=0,loss=0;
  const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
  for(let i=1;i<=period;i++){const change=values[i]-values[i-1];gain+=Math.max(change,0)/period;loss+=Math.max(-change,0)/period;}
  out[period]=value();
  for(let i=period+1;i<values.length;i++){const change=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(change,0))/period;loss=(loss*(period-1)+Math.max(-change,0))/period;out[i]=value();}
  return out;
 }
 function calculate(bars){
  if(!Array.isArray(bars)||bars.some(b=>![b.o,b.h,b.l,b.c].every(finite)||b.l>b.h||b.c<b.l||b.c>b.h||b.o<b.l||b.o>b.h))throw Error('Invalid chart candles');
  const closes=bars.map(b=>b.c),middle=sma(closes,20),rsi14=rsi(closes);
  const deviation=middle.map((mean,i)=>mean===null?null:Math.sqrt(closes.slice(i-19,i+1).reduce((sum,v)=>sum+(v-mean)**2,0)/20));
  const raw=bars.map((b,i)=>{if(i<13)return null;const w=bars.slice(i-13,i+1),high=Math.max(...w.map(b=>b.h)),low=Math.min(...w.map(b=>b.l));return high===low?50:100*(b.c-low)/(high-low);});
  const k=sma(raw,3);
  return {ema9:ema(closes,9),ema21:ema(closes,21),sma50:sma(closes,50),sma200:sma(closes,200),
    bollinger:{middle,upper:middle.map((m,i)=>m===null?null:m+2*deviation[i]),lower:middle.map((m,i)=>m===null?null:m-2*deviation[i])},
    rsi:rsi14,rsiMA:sma(rsi14,14),stochastic:{k,d:sma(k,3)}};
 }
 root.WTIChartStudies={calculate};
})(globalThis);
