import {validPrices} from './safety.js';

// Descriptive simulated outcomes, never automatic strategy changes or trade execution.
export function performanceMemory(signals, costPerBarrel=0.05) {
  const bySetup={},bySetupDirection={},seen=new Set();
  if(!Number.isFinite(costPerBarrel)||costPerBarrel<0) throw new Error("Invalid simulated cost");
  for(const signal of signals){
    if(!['STOP','STOP_AFTER_TP1','TP2'].includes(signal.status) || !validPrices(signal.direction,signal)) continue;
    if(signal.id && seen.has(signal.id)) continue;
    if(signal.id) seen.add(signal.id);
    const entry=(signal.entryLow+signal.entryHigh)/2;
    const side=signal.direction==='LONG'?1:-1;
    const risk=side*(entry-signal.stop);
    const gross=signal.status==='STOP'?-1:signal.status==='TP2'
      ? side*((signal.tp1+signal.tp2)/2-entry)/risk
      : (side*(signal.tp1-entry)/risk-1)/2;
    const key=signal.setupType||'UNKNOWN';
    for(const [collection,bucketKey] of [[bySetup,key],[bySetupDirection,key+' | '+signal.direction]]){
      const bucket=collection[bucketKey]||{evaluated:0,totalNetR:0};
      bucket.evaluated++;bucket.totalNetR+=gross-costPerBarrel/risk;
      collection[bucketKey]=bucket;
    }
  }
  for(const bucket of [...Object.values(bySetup),...Object.values(bySetupDirection)]){
    bucket.averageNetR=Number((bucket.totalNetR/bucket.evaluated).toFixed(3));
    bucket.totalNetR=Number(bucket.totalNetR.toFixed(3));
    bucket.evidence=bucket.evaluated<20?'INSUFFICIENT DATA':bucket.averageNetR<=0?'REVIEW REQUIRED':'POSITIVE SIMULATED EXPECTANCY';
  }
  return {mode:'DESCRIPTIVE_ONLY',minimumSamples:20,costPerBarrel,
    model:'Half at TP1, half at TP2 or original stop; zone midpoint fill; hypothetical total cost per barrel.',
    bySetup,bySetupDirection,automaticallyChangesStrategy:false};
}
