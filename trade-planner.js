(function(root){
  'use strict';
  function calculate(p){
    const positive=['equity','riskPercent','entry','stop','tp1','tp2','pointValue','fx','quantityStep','minimumQuantity','bid','ask'];
    if(positive.some(k=>!Number.isFinite(p[k])||p[k]<=0))throw Error('Complete every price, account and broker specification with a positive number.');
    if(['slippage','fees','financing'].some(k=>!Number.isFinite(p[k])||p[k]<0))throw Error('Costs must be zero or positive numbers.');
    if(p.riskPercent>100)throw Error('Risk cannot exceed account equity.');
    if(!['LONG','SHORT'].includes(p.direction))throw Error('Select LONG or SHORT.');
    if(p.ask<p.bid)throw Error('Buy quote must be at least the sell quote.');
    if(!p.verified||!String(p.brokerContract||'').trim())throw Error('Check the Trading 212 contract, expiry and unit specifications.');
    const age=p.now-p.quoteAt;
    if(!Number.isFinite(age)||!Number.isFinite(p.quoteAt)||age<0||age>120000)throw Error('Recheck your Trading 212 quotes and record their time.');
    const side=p.direction==='LONG'?1:-1;
    const distance=side*(p.entry-p.stop),reward1=side*(p.tp1-p.entry),reward2=side*(p.tp2-p.entry);
    if(distance<=0||reward1<=0||reward2<=reward1)throw Error('Stop and ordered targets must be on the correct sides of the entry for this direction.');
    const conversion=p.pointValue*p.fx;
    const costPerUnit=(p.ask-p.bid+p.slippage)*conversion+p.fees+p.financing;
    const riskPerUnit=distance*conversion+costPerUnit;
    const budget=p.equity*p.riskPercent/100;
    const steps=Math.floor(budget/(riskPerUnit*p.quantityStep));
    const quantity=steps*p.quantityStep;
    if(![conversion,costPerUnit,riskPerUnit,budget,quantity].every(Number.isFinite)||steps>Number.MAX_SAFE_INTEGER)throw Error('Values exceed calculator precision; check your units.');
    if(quantity<p.minimumQuantity||quantity<=0)throw Error('The broker minimum quantity exceeds your chosen risk budget. No suitable size.');
    const loss=quantity*riskPerUnit;
    if(loss>budget+Math.max(1e-9,budget*1e-12))throw Error('Quantity exceeds the risk budget; check broker units.');
    const net1=quantity*(reward1*conversion-costPerUnit),net2=quantity*(reward2*conversion-costPerUnit);
    const outputs=[loss,net1,net2,net1/loss,net2/loss];
    if(!outputs.every(Number.isFinite))throw Error('Values exceed calculator precision.');
    return {quantity,budget,loss,net1,net2,rr1:net1/loss,rr2:net2/loss,costs:quantity*costPerUnit,spread:p.ask-p.bid,midpoint:(p.ask+p.bid)/2,entryDifference:p.entry-(p.ask+p.bid)/2};
  }
  root.WTITradePlanner={calculate};
  const form=root.document?.getElementById('riskPlanForm');if(!form)return;
  const result=root.document.getElementById('riskPlanResult'),ageLabel=root.document.getElementById('quoteAge');
  let quoteAt=null,calculated=false;
  const numberFields=['equity','riskPercent','entry','stop','tp1','tp2','pointValue','fx','quantityStep','minimumQuantity','bid','ask','slippage','fees','financing'];
  function invalidate(){calculated=false;result.textContent='Inputs changed. Calculate again after checking the broker details.';}
  form.addEventListener('input',e=>{invalidate();if(['bid','ask','brokerContract'].includes(e.target.name)){quoteAt=null;ageLabel.textContent='Quotes or contract changed. Recheck and record their time.';form.elements.verified.checked=false;}});
  root.document.getElementById('quoteStamp').addEventListener('click',()=>{quoteAt=Date.now();invalidate();ageLabel.textContent='Manually checked at '+new Date(quoteAt).toLocaleTimeString()+'. Valid for 2 minutes; not an automatic broker feed.';});
  form.addEventListener('submit',e=>{
    e.preventDefault();
    try{
      const p={};for(const k of numberFields)p[k]=form.elements[k].value.trim()===''?NaN:Number(form.elements[k].value);
      Object.assign(p,{direction:form.elements.direction.value,brokerContract:form.elements.brokerContract.value,verified:form.elements.verified.checked,quoteAt:quoteAt===null?NaN:quoteAt,now:Date.now()});
      const plan=calculate(p),currency=form.elements.currency.value;
      const igText=root.document.getElementById('homePrice')?.textContent||'';
      const igClose=Number(igText.replace(/,/g,''));
      const comparison=Number.isFinite(igClose)&&igClose>0?'IG last candle minus Trading 212 quoted midpoint: '+(igClose-plan.midpoint).toFixed(3)+' USD (different feed/time/contract; not an arbitrage signal).':'IG price comparison unavailable.';
      const money=n=>new Intl.NumberFormat(undefined,{style:'currency',currency}).format(n);
      result.textContent='CALCULATION ONLY · '+p.direction+' · '+p.brokerContract+'\nQuantity: '+Number(plan.quantity.toPrecision(12))+' units\nChosen budget: '+money(plan.budget)+'\nEstimated loss at stop including costs: '+money(plan.loss)+'\nEstimated costs: '+money(plan.costs)+'\nNet result if all units exit at TP1: '+money(plan.net1)+' · net R '+plan.rr1.toFixed(2)+'\nNet result if all units exit at TP2: '+money(plan.net2)+' · net R '+plan.rr2.toFixed(2)+'\nTrading 212 spread: '+plan.spread.toFixed(3)+' USD\nPlanned entry minus quoted midpoint: '+plan.entryDifference.toFixed(3)+' USD\n'+(plan.net1<=0||plan.net2<=0?'COST WARNING: a target has no positive net reward.\n':'')+'IG reference: '+(root.document.getElementById('contractStatus')?.textContent||'Unavailable')+'\n'+comparison+'\nBroker/contract match is unverified. Do not copy IG levels into Trading 212 without checking them.\n'+(root.document.getElementById('overall')?.textContent||'WAIT')+' is the separate IG research status. This calculation cannot change it. No trade placed. Financing, fees and slippage are estimates; gap losses may exceed the chosen budget.';
      calculated=true;
    }catch(error){calculated=false;result.textContent='PLAN NOT READY: '+error.message;}
  });
  root.setInterval(()=>{if(calculated&&Date.now()-quoteAt>120000){calculated=false;result.textContent='PLAN EXPIRED: quotes are older than 2 minutes. Recheck the broker and calculate again.';}},10000);
})(globalThis);
