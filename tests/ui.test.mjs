import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
const source=fs.readFileSync(new URL('../simple.html',import.meta.url),'utf8')
 .replace('<script src="/automatic-plan.js"></script>',()=>'<script>'+fs.readFileSync(new URL('../automatic-plan.js',import.meta.url),'utf8')+'</script>')
 .replace('<script src="/chart-studies.js"></script>',()=>'<script>'+fs.readFileSync(new URL('../chart-studies.js',import.meta.url),'utf8')+'</script>')
 .replace('<script src="/signal-indicator.js"></script>',()=>'<script>'+fs.readFileSync(new URL('../signal-indicator.js',import.meta.url),'utf8')+'</script>');
const now=Date.now(),end=Math.floor(now/300000)*300000;
const bars=Array.from({length:4000},(_,i)=>{
  const c=70+i*.001+i*i*.0000001;
  return {t:end-(4000-i)*300000,o:c-.002,h:c+.01,l:c-.01,c,v:100};
});
const fresh={dataFresh:true,contractEpic:'EN.D.CL.FWS.TEST',marketStatus:'TRADEABLE',entryTriggered:true,preparePrices:{entryLow:70,entryHigh:71,stop:69,tp1:73,tp2:75},lastCandleClosedAt:new Date(end).toISOString(),alertStage:'PREPARE',prepareDirection:'LONG',entryTriggerText:'Wait for completed 5m trigger.',waitReason:'Preparation only.'};
function page(stage='PREPARE',withChart=false){
  const errors=[];
  const plots=[];
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message);});
  const dom=new JSDOM(source,{url:'https://test.example/simple.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(window){
    window.scrollTo=()=>{};
    if(withChart){
      Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return 375;}});
      window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({width:375,height:120});
      window.HTMLCanvasElement.prototype.getContext=()=>({scale(){},clearRect(){},fillRect(){},setLineDash(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
      window.LightweightCharts={ColorType:{Solid:0},CrosshairMode:{Normal:0},LineStyle:{Solid:0,Dashed:2},createChart(){
        const series=(kind,options)=>{const plot={kind,options,priceLines:[]};plots.push(plot);return {setData(data){plot.data=data;},createPriceLine(line){plot.priceLines.push(line);},setMarkers(markers){plot.markers=markers;},priceToCoordinate(){return null;}};};
        return {remove(){},addCandlestickSeries(options){return series('candles',options);},addLineSeries(options){return series('line',options);},subscribeCrosshairMove(){},timeScale(){return {fitContent(){},subscribeVisibleLogicalRangeChange(){},timeToCoordinate(){return 0;}};}};
      }};
    }
    window.fetch=async url=>{
      if(url.includes('market-status'))return Response.json({scheduledOpen:true,status:'SCHEDULED OPEN',checkedAt:new Date().toISOString()});
      if(url.includes('candles'))return Response.json({bars,activeProvider:'IG',fallbackUsed:false,contractVerified:true,contractExpiry:'TEST-26',epic:'EN.D.CL.FWS.TEST',marketStatus:'TRADEABLE'});
      if(url.includes('market-monitor'))return Response.json({ok:true,direction:stage==='ENTER'?'LONG':'WAIT',prices:stage==='ENTER'?{entryLow:70,entryHigh:71,stop:69,tp1:73,tp2:75}:null,confirmation:{...fresh,alertStage:stage},levels:{support:69,resistance:76},setupType:'TREND LONG'});
      if(url.includes('signal-journal'))return Response.json({stats:{totalSignals:0,evaluated:0,performance:{bySetup:{}}},recent:[]});
      if(url.includes('backtest'))return Response.json({ok:true,stats:{},walkForward:{development:{},validation:{}},recent:[]});
      return Response.json({items:[],maritime:{risk:'UNKNOWN'}});
    };
  }});
  return {dom,errors,plots};
}
async function settled(dom){
  for(let i=0;i<50;i++){
    if(dom.window.document.getElementById('overall').textContent.includes('PREPARE')||dom.window.document.getElementById('overall').textContent.includes('ENTER'))return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Screen did not receive the monitor response');
}
test('iPhone shell has install metadata and PREPARE is distinct from entry',async()=>{
  const {dom,errors}=page();try{
    await settled(dom);
    const document=dom.window.document;
    assert.equal(document.getElementById('overall').textContent,'PREPARE LONG');
    assert.equal(document.getElementById('botPlanStage').textContent,'PREPARE LONG');
    assert.equal(document.getElementById('chartSetupTitle').textContent,'PREPARE LONG');
    assert.match(document.getElementById('chartEntry').textContent,/70.00/);
    assert.equal(document.getElementById('nextTarget').textContent,'—');
    assert.match(document.getElementById('contractStatus').textContent,/TEST-26/);
    assert.equal(document.querySelector('link[rel="manifest"]').getAttribute('href'),'/manifest.webmanifest');
    assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});

test('indicator levels and bot agree; a failed market refresh removes actionable chart levels',async()=>{
 const {dom,plots}=page('ENTER',true);try{
  await settled(dom);const w=dom.window,d=w.document;
  assert.equal(d.getElementById('chartSetupTitle').textContent,d.getElementById('botPlanStage').textContent);
  assert.ok(plots.filter(p=>p.kind==='candles').at(-1).priceLines.some(line=>line.title==='SL'));
  const original=w.fetch;w.fetch=async url=>url.includes('/api/candles')?new Response('{}',{status:503}):original(url);
  await w.loadCandles();
  assert.equal(d.getElementById('chartSetupTitle').textContent,'WAIT');assert.equal(d.getElementById('chartStop').textContent,'—');
  assert.ok(!plots.filter(p=>p.kind==='candles').at(-1).priceLines.some(line=>line.title==='SL'));
 }finally{dom.window.close();}
});

test('4H chart shows labelled IG candle prices, real study warmup and working timeframe changes',async()=>{
 const {dom,errors,plots}=page('ENTER',true);try{
  await settled(dom);const d=dom.window.document;
  assert.equal(d.querySelector('.chartTabs .active').dataset.tf,'240');
  assert.match(d.getElementById('chartFeedInfo').textContent,/IG TEST-26/);
  assert.match(d.getElementById('chartPriceBasis').textContent,/4H completed candle midpoint/);
  assert.match(d.getElementById('chartHistoryNote').textContent,/SMA 200 needs 200 candles/);
  assert.equal(d.getElementById('chartScenarioGuide').style.display,'none');
  assert.ok(plots.some(p=>p.options.color==='#309cfa'&&p.data.length));
  assert.ok(!plots.some(p=>p.options.color==='#ffffff'));
  assert.doesNotMatch(d.getElementById('stochValue').textContent,/Unavailable/);
  assert.doesNotMatch(d.getElementById('rsiValue').textContent,/Unavailable/);
  d.querySelector('.chartTabs [data-tf="15"]').click();
  assert.match(d.getElementById('chartPriceBasis').textContent,/15m completed candle midpoint/);
  assert.equal(d.getElementById('chartScenarioGuide').style.display,'grid');
  assert.ok(plots.some(p=>p.options.color==='#ffffff'&&p.data.length));
  assert.equal(d.getElementById('overall').textContent,'ENTER LONG');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('ENTER shows confirmed targets; all five navigation pages switch correctly',async()=>{
  const {dom,errors}=page('ENTER');try{
    await settled(dom);const document=dom.window.document;
    assert.equal(document.getElementById('overall').textContent,'ENTER LONG');assert.equal(document.getElementById('nextTarget').textContent,'73.00');
    assert.equal(document.getElementById('botPlanStage').textContent,'ENTER LONG');
    for(const name of ['chart','signals','news','more','home']){
      document.querySelector(`.nav[data-page="${name}"]`).click();
      assert.ok(document.getElementById(name+'Page').classList.contains('active'));
      assert.equal(document.querySelectorAll('.page.active').length,1);
    }
    await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});
