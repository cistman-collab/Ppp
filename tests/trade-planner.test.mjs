import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../trade-planner.js',import.meta.url),'utf8');
const sandbox={};vm.runInNewContext(source,sandbox);const calculate=sandbox.WTITradePlanner.calculate;
const base={equity:1000,riskPercent:1,entry:100,stop:99,tp1:102,tp2:103,pointValue:1,fx:1,quantityStep:.1,minimumQuantity:.1,bid:99.9,ask:100.1,slippage:.1,fees:.1,financing:0,direction:'LONG',brokerContract:'Test contract',verified:true,quoteAt:1000,now:1000};
test('LONG/SHORT sizing includes spread, slippage, fees and FX within the chosen budget',()=>{
 const long=calculate(base),short=calculate({...base,direction:'SHORT',stop:101,tp1:98,tp2:97});
 assert.ok(Math.abs(long.quantity-7.1)<1e-9);assert.ok(long.loss<=10);assert.ok(Math.abs(long.loss-9.94)<1e-8);
 assert.ok(Math.abs(long.net1-11.36)<1e-8);assert.ok(Math.abs(long.rr1-long.net1/long.loss)<1e-9);
 assert.equal(long.quantity,short.quantity);assert.equal(long.net1,short.net1);
 const fx=calculate({...base,fx:2});assert.ok(fx.quantity<long.quantity);assert.ok(fx.loss<=10);
});
test('planner blocks invalid geometry, stale quotes, missing specifications and unaffordable minimums',()=>{
 for(const p of [{stop:101},{tp2:101},{ask:99},{quoteAt:NaN},{quoteAt:-120000},{quoteAt:2000},{verified:false},{pointValue:0},{fx:Infinity},{fees:-1},{minimumQuantity:100},{riskPercent:101}])assert.throws(()=>calculate({...base,...p}));
 assert.ok(calculate({...base,quoteAt:0,now:120000}));assert.throws(()=>calculate({...base,quoteAt:0,now:120001}));
});
test('costs can make an apparently positive target unprofitable and no trades are sent',()=>{
 const p=calculate({...base,fees:3});assert.ok(p.net1<0);assert.ok(p.rr1<0);
 assert.equal(source.includes('fetch('),false);assert.equal(source.includes('localStorage'),false);
});
test('mobile planner calculates locally, invalidates changed quotes and leaves research status unchanged',()=>{
 const html=fs.readFileSync(new URL('../simple.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try{
 dom.window.eval(source);const doc=dom.window.document,form=doc.getElementById('riskPlanForm');
 for(const [name,value] of Object.entries(base))if(form.elements[name]&&name!=='verified')form.elements[name].value=value;
 form.elements.verified.checked=true;doc.getElementById('quoteStamp').click();
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.match(doc.getElementById('riskPlanResult').textContent,/Quantity: 7.1 units/);
 assert.match(doc.getElementById('riskPlanResult').textContent,/match is unverified/);
 assert.equal(doc.getElementById('overall').textContent,'WAIT');
 form.elements.bid.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(form.elements.verified.checked,false);
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.match(doc.getElementById('riskPlanResult').textContent,/PLAN NOT READY/);
 }finally{dom.window.close();}
});
