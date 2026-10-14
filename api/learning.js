import {validPrices} from './safety.js';

// Descriptive simulated outcomes, never automatic strategy changes or trade execution.
export function performanceMemory(signals, costPerBarrel=0.05) {
  const bySetup={};
  for(const signal of signals){
    if(!['STOP','STOP_AFTER_TP1','TP2'].includes(signal.status) || !validPrices(signal.direction,signal)) continue;
    const entry=(signal.entryLow+signal.entryHigh)/2;
    const side=signal.direction==='LONG'?1:-1;
    const risk=side*(entry-signal.stop);
    const gross=signal.status==='STOP'?-1:signal.status==='TP2'
      ? side*((signal.tp1+signal.tp2)/2-entry)/risk
      : (side*(signal.tp1-entry)/risk-1)/2;
    const key=signal.setupType||'UNKNOWN';
    const bucket=bySetup[key]||{evaluated:0,totalNetR:0};
    bucket.evaluated++;bucket.totalNetR+=gross-costPerBarrel/risk;
    bySetup[key]=bucket;
  }
  for(const bucket of Object.values(bySetup)){
    bucket.averageNetR=Number((bucket.totalNetR/bucket.evaluated).toFixed(3));
    bucket.totalNetR=Number(bucket.totalNetR.toFixed(3));
    bucket.evidence=bucket.evaluated<20?'INSUFFICIENT DATA':bucket.averageNetR<=0?'REVIEW REQUIRED':'POSITIVE SIMULATED EXPECTANCY';
  }
  return {mode:'DESCRIPTIVE_ONLY',minimumSamples:20,costPerBarrel,
    model:'Half at TP1, half at TP2 or original stop; zone midpoint fill; hypothetical total cost per barrel.',
    bySetup,automaticallyChangesStrategy:false};
}
