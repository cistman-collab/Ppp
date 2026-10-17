(function(root){
  'use strict';
  // The model explains an existing server plan; it never supplies executable prices.
  function build(result,now=Date.now(),preview=false){
    const c=result?.confirmation;
    const closed=Date.parse(c?.lastCandleClosedAt||'');
    const age=(now-closed)/60000;
    const wait=reason=>({stage:'WAIT',direction:'WAIT',reason,key:'WAIT'});
    if(!result?.ok || !c)return wait('Market check unavailable. Waiting for a successful server check.');
    if(c.dataFresh!==true || !Number.isFinite(age) || age<0 || age>15)return wait('Candle data is stale or unverified. Waiting for fresh completed candles.');
    const synthetic=preview && result.synthetic===true && c.marketStatus==='SYNTHETIC';
    if((c.marketStatus!=='TRADEABLE' && !synthetic) || c.eventBlocked || c.newsConflict)return wait(c.waitReason||'Market closed or a risk block is active.');
    const stage=c.alertStage;
    const direction=stage==='PREPARE'?c.prepareDirection:result.direction;
    const p=stage==='PREPARE'?c.preparePrices:result.prices;
    if(!['PREPARE','ENTER'].includes(stage) || !['LONG','SHORT'].includes(direction))return wait(c.waitReason||'No confirmed directional setup.');
    if(stage==='ENTER' && c.entryTriggered!==true)return wait('Completed 5m entry trigger is not confirmed.');
    if(!p || ![p.entryLow,p.entryHigh,p.stop,p.tp1,p.tp2].every(n=>Number.isFinite(n)&&n>0))return wait('Setup prices are missing or invalid.');
    const long=direction==='LONG';
    if(p.entryLow>p.entryHigh || !(long?p.stop<p.entryLow&&p.tp1>p.entryHigh&&p.tp2>p.tp1:p.stop>p.entryHigh&&p.tp1<p.entryLow&&p.tp2<p.tp1))return wait('Entry, stop and target ordering needs checking.');
    const entry=long?p.entryHigh:p.entryLow;
    const risk=Math.abs(entry-p.stop);
    const rr1=Math.abs(p.tp1-entry)/risk,rr2=Math.abs(p.tp2-entry)/risk;
    if(![risk,rr1,rr2].every(Number.isFinite))return wait('Risk/reward cannot be calculated.');
    return {stage,direction,synthetic,prices:p,rr1,rr2,risk,closedAt:c.lastCandleClosedAt,contract:c.contractEpic||'IG selected contract',
      reason:stage==='PREPARE'?(c.entryTriggerText||'Wait for a completed 5m entry trigger.'):'Completed 5m entry trigger confirmed. AI review is separate below.',
      key:JSON.stringify([c.contractEpic,c.lastCandleClosedAt,stage,direction,p,c.newsBias,c.eventStatus,c.inventory?.status,c.inventory?.releaseDate,c.inventory?.changeMillionBarrels])};
  }
  let current=null,currentKey='WAIT';
  const reviewed=new Map();
  let inventory=null;
  function renderEvidence(result){
    const doc=root.document;if(!doc)return;
    const c=result?.confirmation;
    const evidence=doc.getElementById('botEvidence');
    if(evidence)evidence.textContent=[
      'News: '+(c?.newsAvailable?c.newsBias||'UNKNOWN':'UNAVAILABLE')+' · Maritime risk: '+(c?.maritimeRisk||'UNKNOWN'),
      'Events: '+(c?.eventBlocked?'BLOCKED — '+(c.activeEvent?.name||'High-impact release'):c?.eventStatus||'UNKNOWN'),
      'Exit references: stop and targets above apply to the proposed setup; no broker position is connected.'
    ].join('\n');
    if(c?.inventory && (!inventory?.fetchedAt || Date.parse(c.inventory.fetchedAt||'')>=Date.parse(inventory.fetchedAt)))inventory=c.inventory;
    const out=doc.getElementById('botInventory');if(!out)return;
    const i=inventory;
    if(!i || !['AVAILABLE','STALE'].includes(i.status)){
      out.textContent=i?.note||'Inventory figures unavailable. No inventory confirmation is assumed.';return;
    }
    const age=Date.now()-Date.parse(i.releaseDate+'T00:00:00Z');
    const numbers=[i.stocksMillionBarrels,i.changeMillionBarrels];
    if(!numbers.every(Number.isFinite)||!Number.isFinite(age)||age<0){out.textContent='Inventory figures could not be verified.';return;}
    const stale=i.status==='STALE'||age>10*86400000;
    out.textContent=[stale?'STALE — background figures only':'Official weekly report · US only, not global',
      'Commercial crude excluding SPR: '+i.stocksMillionBarrels.toFixed(3)+' million barrels',
      'Weekly change: '+(i.changeMillionBarrels>0?'+':'')+i.changeMillionBarrels.toFixed(3)+' million barrels · '+i.movement,
      'Week ending '+i.weekEnding+' · Released '+i.releaseDate,
      'Forecast comparison unavailable. A build/draw alone is not an entry or exit signal.'
    ].join('\n');
  }
  async function refreshInventory(){
    try{
      const response=await root.fetch('/api/inventories',{cache:'no-store'});
      if(!response.ok)throw Error();
      inventory=await response.json();
    }catch{inventory={status:'UNAVAILABLE',note:'Inventory feed unavailable. No inventory confirmation is assumed.'};}
    renderEvidence(current);
  }
  function update(result){
    current=result;
    const plan=build(result,Date.now(),root.document?.documentElement.dataset.preview==='synthetic');
    currentKey=plan.key;
    root.WTISignalIndicator?.update(plan,result);
    const doc=root.document;
    if(!doc)return plan;
    renderEvidence(result);
    const stage=doc.getElementById('botPlanStage'),details=doc.getElementById('botPlanDetails');
    if(!stage||!details)return plan;
    stage.textContent=(plan.synthetic?'TEST ':'')+plan.stage+(plan.direction==='WAIT'?'':' '+plan.direction);
    stage.className=plan.stage==='WAIT'?'wait':plan.direction==='LONG'?'good':'bad';
    if(plan.stage==='WAIT'){
      details.textContent=plan.reason;
      const review=doc.getElementById('signalAIReview');
      if(review)review.textContent='AI REVIEW: WAIT — '+plan.reason;
      return plan;
    }
    const p=plan.prices,price=n=>'$'+n.toFixed(2);
    details.textContent=['Entry zone: '+price(p.entryLow)+'–'+price(p.entryHigh),'Stop: '+price(p.stop),
      'Target 1: '+price(p.tp1)+' · gross reward/risk '+plan.rr1.toFixed(2)+':1',
      'Target 2: '+price(p.tp2)+' · gross reward/risk '+plan.rr2.toFixed(2)+':1',
      'Risk per barrel at the worst entry: '+price(plan.risk),
      'Setup: '+(result.setupType||'Server technical setup'),
      'Trend 5m / 15m / 1H / 4H: '+['fiveMinTrend','fifteenMinTrend','oneHourTrend','fourHourTrend'].map(field=>result.confirmation[field]||'UNKNOWN').join(' / '),plan.reason,
      'Invalidation: price reaches the stop, a risk block appears, or the setup changes.',
      'Contract: '+plan.contract+' · Candle close: '+plan.closedAt].join('\n');
    if(plan.stage==='PREPARE'){
      doc.getElementById('signalAIReview').textContent='AI REVIEW: WAIT — provisional plan. Wait for the completed 5m trigger.';
    }else if(!reviewed.has(plan.key)){
      const button=doc.querySelector('[data-ai-control][onclick="reviewSignalAI()"]');
      if(button && !button.disabled && typeof root.reviewSignalAI==='function'){
        reviewed.set(plan.key,'Thinking…');
        if(reviewed.size>100)reviewed.delete(reviewed.keys().next().value);
        root.reviewSignalAI();
      }
    }else{
      doc.getElementById('signalAIReview').textContent=reviewed.get(plan.key);
    }
    return plan;
  }
  function reviewedAnswer(key,text){
    if(key!==currentKey)return;
    reviewed.set(key,text);
    const output=root.document?.getElementById('signalAIReview');
    if(output)output.textContent=text;
  }
  root.WTIAutomaticPlan={build,update,key:()=>currentKey,reviewedAnswer};
  if(root.document){
    root.setInterval(()=>{if(current)update(current);else renderEvidence(null);},10000);
    if(typeof root.fetch==='function'){refreshInventory();root.setInterval(refreshInventory,30*60000);}
  }
})(globalThis);
