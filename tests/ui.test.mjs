import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
const source=fs.readFileSync(new URL('../simple.html',import.meta.url),'utf8');
const now=Date.now(),end=Math.floor(now/300000)*300000;
const bars=Array.from({length:4000},(_,i)=>{
  const c=70+i*.001+i*i*.0000001;
  return {t:end-(4000-i)*300000,o:c-.002,h:c+.01,l:c-.01,c,v:100};
});
const fresh={dataFresh:true,lastCandleClosedAt:new Date(end).toISOString(),alertStage:'PREPARE',prepareDirection:'LONG',entryTriggerText:'Wait for completed 5m trigger.',waitReason:'Preparation only.'};
function page(stage='PREPARE'){
  const errors=[];
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message);});
  const dom=new JSDOM(source,{url:'https://test.example/simple.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(window){
    window.scrollTo=()=>{};
    window.fetch=async url=>{
      if(url.includes('market-status'))return Response.json({scheduledOpen:true,status:'SCHEDULED OPEN',checkedAt:new Date().toISOString()});
      if(url.includes('candles'))return Response.json({bars,activeProvider:'IG',fallbackUsed:false,contractVerified:true,contractExpiry:'TEST-26',epic:'EN.D.CL.FWS.TEST',marketStatus:'TRADEABLE'});
      if(url.includes('market-monitor'))return Response.json({ok:true,direction:stage==='ENTER'?'LONG':'WAIT',prices:stage==='ENTER'?{entryLow:70,entryHigh:71,stop:69,tp1:73,tp2:75}:null,confirmation:{...fresh,alertStage:stage},levels:{support:69,resistance:76},setupType:'TREND LONG'});
      if(url.includes('signal-journal'))return Response.json({stats:{totalSignals:0,evaluated:0,performance:{bySetup:{}}},recent:[]});
      if(url.includes('backtest'))return Response.json({ok:true,stats:{},walkForward:{development:{},validation:{}},recent:[]});
      return Response.json({items:[],maritime:{risk:'UNKNOWN'}});
    };
  }});
  return {dom,errors};
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
    assert.equal(document.getElementById('nextTarget').textContent,'—');
    assert.match(document.getElementById('contractStatus').textContent,/TEST-26/);
    assert.equal(document.querySelector('link[rel="manifest"]').getAttribute('href'),'/manifest.webmanifest');
    assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});
test('ENTER shows confirmed targets; all five navigation pages switch correctly',async()=>{
  const {dom,errors}=page('ENTER');try{
    await settled(dom);const document=dom.window.document;
    assert.equal(document.getElementById('overall').textContent,'ENTER LONG');assert.equal(document.getElementById('nextTarget').textContent,'73.00');
    for(const name of ['chart','signals','news','more','home']){
      document.querySelector(`.nav[data-page="${name}"]`).click();
      assert.ok(document.getElementById(name+'Page').classList.contains('active'));
      assert.equal(document.querySelectorAll('.page.active').length,1);
    }
    await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});
