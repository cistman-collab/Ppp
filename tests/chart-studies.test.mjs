import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const sandbox={};vm.runInNewContext(fs.readFileSync(new URL('../chart-studies.js',import.meta.url),'utf8'),sandbox);
const calculate=sandbox.WTIChartStudies.calculate;
const candles=values=>values.map(c=>({o:c,h:c+1,l:c-1,c}));
test('Bollinger uses 20 closes and population deviation; averages require a real warmup',()=>{
 const result=calculate(candles(Array.from({length:210},(_,i)=>i+1)));
 assert.equal(result.bollinger.middle[18],null);assert.equal(result.bollinger.middle[19],10.5);
 assert.ok(Math.abs(result.bollinger.upper[19]-(10.5+2*Math.sqrt(33.25)))<1e-10);
 assert.equal(result.sma200[198],null);assert.equal(result.sma200[199],100.5);
 assert.equal(result.ema9[7],null);assert.equal(result.ema9[8],5);assert.equal(result.ema9[9],6);
});
test('Wilder RSI matches its reference seed and flat candles remain neutral',()=>{
 const values=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
 assert.ok(Math.abs(calculate(candles(values)).rsi[14]-70.464135)<.00001);
 const flat=calculate(Array.from({length:40},()=>({o:100,h:100,l:100,c:100})));
 assert.equal(flat.rsi.at(-1),50);assert.equal(flat.rsiMA.at(-1),50);assert.equal(flat.stochastic.k.at(-1),50);assert.equal(flat.stochastic.d.at(-1),50);
});
test('stochastic smoothing stays bounded, missing history is not invented and malformed bars fail',()=>{
 const s=calculate(candles(Array.from({length:60},(_,i)=>100+Math.sin(i)*5)));
 for(const values of [s.rsi,s.stochastic.k,s.stochastic.d])for(const value of values)if(value!==null)assert.ok(value>=0&&value<=100);
 assert.equal(s.stochastic.k[14],null);assert.equal(s.stochastic.d[16],null);
 assert.ok(s.sma200.every(value=>value===null));
 assert.throws(()=>calculate([{o:2,h:1,l:0,c:2}]));assert.throws(()=>calculate([{o:NaN,h:1,l:0,c:1}]));
});
