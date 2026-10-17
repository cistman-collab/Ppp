(function(root){
 'use strict';
 let result=null,chartContract=null,previousKey=null;
 function snapshot(){
  const p=root.WTIAutomaticPlan.build(result,Date.now(),root.document?.documentElement.dataset.preview==='synthetic');
  if(p.stage!=='WAIT' && chartContract && p.contract!==chartContract)return {stage:'WAIT',direction:'WAIT',key:'CONTRACT_MISMATCH',reason:'Chart and signal contracts differ. Waiting for a matching server check.'};
  return p;
 }
 function render(){
  const p=snapshot(),doc=root.document;if(!doc)return p;
  const title=doc.getElementById('chartSetupTitle');if(!title)return p;
  const active=p.stage!=='WAIT';
  title.textContent=(p.synthetic?'TEST ':'')+p.stage+(active?' '+p.direction:'');
  title.className='setupTitle '+(p.stage==='ENTER'?(p.direction==='LONG'?'good':'bad'):'wait');
  const price=n=>'$'+n.toFixed(2),fields={chartEntry:active?price(p.prices.entryLow)+'–'+price(p.prices.entryHigh):'—',
   chartStop:active?price(p.prices.stop):'—',chartTP1:active?price(p.prices.tp1):'—',chartTP2:active?price(p.prices.tp2):'—',
   chartRR:active?'TP1 '+p.rr1.toFixed(2)+':1 · TP2 '+p.rr2.toFixed(2)+':1':'—'};
  for(const [id,value] of Object.entries(fields))doc.getElementById(id).textContent=value;
  doc.getElementById('indicatorReason').textContent=p.stage==='PREPARE'?'Provisional levels. '+p.reason:p.reason;
  const c=result?.confirmation;
  doc.getElementById('indicatorChecks').textContent=[
   'Trend: '+['fiveMinTrend','fifteenMinTrend','oneHourTrend','fourHourTrend'].map((key,i)=>['5m','15m','1H','4H'][i]+' '+(c?.[key]||'UNKNOWN')).join(' · '),
   'News: '+(c?.newsAvailable?c.newsBias||'UNKNOWN':'UNKNOWN')+' · Events: '+(c?.eventBlocked?'BLOCKED':c?.eventStatus||'UNKNOWN')+' · Inventories: '+(c?.inventory?.status||'UNKNOWN')
  ].join('\n');
  doc.getElementById('indicatorSource').textContent=(p.synthetic?'Synthetic test only. ':'IG contract research. ')+
   'Signal uses completed 5m candles; changing the chart interval does not change the trigger. '+
   (c?.lastCandleClosedAt?'Signal candle close: '+c.lastCandleClosedAt:'Waiting for a server timestamp.');
  return p;
 }
 function update(_plan,data){
  result=data;
  const p=render();
  if(previousKey!==p.key){
   previousKey=p.key;
   if(typeof root.requestAnimationFrame==='function')root.requestAnimationFrame(()=>root.drawChart?.());
  }
  return p;
 }
 function overlay(data,timeframe){
  const p=snapshot();
  if(p.stage==='WAIT')return {plan:p,lines:[],markers:[]};
  const v=p.prices,prefix=p.stage==='PREPARE'?'PREP ':'';
  const lines=[
   {price:v.entryLow,title:'Entry low',color:'#ffd15f',label:false},
   {price:v.entryHigh,title:'Entry high',color:'#ffd15f',label:false},
   {price:(v.entryLow+v.entryHigh)/2,title:prefix+'ENTRY',color:'#ffd15f',label:true},
   {price:v.stop,title:prefix+'SL',color:'#ff5964',label:true},
   {price:v.tp1,title:prefix+'TP1',color:'#2fe0a7',label:true},
   {price:v.tp2,title:prefix+'TP2',color:'#4e9fff',label:true}
  ];
  const markers=[];
  // Never move a 5m confirmation arrow onto the nearest, unrelated higher-timeframe bar.
  const signalTime=Date.parse(p.closedAt)-300000;
  const bar=data.find(b=>b.t<=signalTime && signalTime<b.t+timeframe*60000);
  if(p.stage==='ENTER' && bar){const long=p.direction==='LONG';markers.push({time:Math.floor(bar.t/1000),position:long?'belowBar':'aboveBar',shape:long?'arrowUp':'arrowDown',color:long?'#2fe0a7':'#ff5964',text:(p.synthetic?'TEST ':'')+'ENTER '+p.direction+' · 5m'});}
  return {plan:p,lines,markers};
 }
 root.WTISignalIndicator={update,snapshot,overlay,setContract(epic){chartContract=epic||null;render();}};
})(globalThis);
