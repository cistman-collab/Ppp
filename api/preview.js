// Synthetic scenario controls are enabled exclusively by the isolated launcher.
export function previewScenario(stage,direction,price,closedAt) {
  const long=direction==='LONG',side=long?1:-1;
  const prices={entryLow:price-.1,entryHigh:price+.1,stop:price-side,tp1:price+side*1.5,tp2:price+side*2.5};
  const active=stage==='ENTER';
  return {ok:true,synthetic:true,direction:active?direction:'WAIT',prices:active?prices:null,
    setupType:'SYNTHETIC '+direction,levels:{support:price-2,resistance:price+2,price},
    confirmation:{alertStage:stage,prepareDirection:stage==='PREPARE'?direction:'WAIT',preparePrices:stage==='PREPARE'?prices:null,
      dataFresh:true,dataAgeMinutes:0,lastCandleClosedAt:closedAt,entryTriggered:active,
      entryTriggerText:'Synthetic scenario only; no market signal or order.',waitReason:'Synthetic scenario only.',
      fiveMinTrend:long?'BULLISH':'BEARISH',fifteenMinTrend:long?'BULLISH':'BEARISH',
      thirtyMinTrend:long?'BULLISH':'BEARISH',oneHourTrend:long?'BULLISH':'BEARISH',fourHourTrend:long?'BULLISH':'BEARISH',
      fiveMinRsi:long?55:45,fifteenMinRsi:long?55:45,fiveMinHist:side*.1,fifteenMinHist:side*.1,
      latestCandle:long?'BULLISH':'BEARISH',signalStage:stage==='ENTER'?'ENTRY CONFIRMED':'WAIT FOR 5m TRIGGER',
      technicalDirection:direction,eventBlocked:false,newsConflict:false,marketStatus:'SYNTHETIC',contractEpic:'EN.D.CL.FWS.TEST'}};
}

export function previewBanner(){
  return `<div style="position:sticky;top:0;z-index:1000;background:#ffd15f;color:#06111f;text-align:center;padding:10px;font:bold 12px system-ui">
    TEST PREVIEW · SYNTHETIC PRICES · NO TRADES
    <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin-top:6px">
      <button onclick="choosePreview('PREPARE','LONG')">Prepare LONG</button><button onclick="choosePreview('ENTER','LONG')">Enter LONG</button>
      <button onclick="choosePreview('PREPARE','SHORT')">Prepare SHORT</button><button onclick="choosePreview('ENTER','SHORT')">Enter SHORT</button>
    </div><small>Scenario buttons test the screen only. Test Alert sends a clearly labeled test notification after 10 seconds.</small>
  </div><script>async function choosePreview(stage,direction){
    await fetch('/api/preview-scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage,direction})});
    await loadCandles();
  }</script>`;
}
