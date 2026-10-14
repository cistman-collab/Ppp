import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Windows desktop sandbox cannot route localhost traffic. Run these real HTTP
// checks in Linux CI; API and DOM regressions still run locally on Windows.
const skip=process.platform==='win32'?'Desktop sandbox blocks localhost; covered on Linux CI':false;
async function start(file,port,env={}){
  const child=spawn(process.execPath,[file],{env:{PATH:process.env.PATH,PORT:String(port),WTI_MONITOR_ENABLED:'false',...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',x=>{logs+=x;});child.stderr.on('data',x=>{logs+=x;});
  for(let i=0;i<50;i++){
    if(child.exitCode!==null)throw Error('Server exited: '+logs);
    try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(200)});if(response.ok)return child;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  child.kill();throw Error('Server did not become healthy: '+logs);
}
test('real HTTP serves the mobile shell, verified setup, journal, icons and backtest',{skip,timeout:30000},async()=>{
  const child=await start('tests/preview.mjs',10000);
  try{
    const root='http://127.0.0.1:10000';
    for(const route of ['/simple.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/sw.js'])assert.equal((await fetch(root+route)).status,200,route);
    const monitor=await (await fetch(root+'/api/market-monitor?view=1')).json();
    assert.equal(monitor.ok,true);assert.equal(monitor.confirmation.alertStage,'PREPARE');
    const journal=await (await fetch(root+'/api/signal-journal')).json();assert.equal(journal.stats.totalSignals,0);
    const backtest=await (await fetch(root+'/api/backtest')).json();assert.equal(backtest.ok,true);assert.equal(backtest.mode,'TECHNICAL_ONLY_REPLAY');
    assert.equal((await fetch(root+'/api/storage')).status,404);
    assert.equal((await fetch(root+'/api/market-monitor')).status,503);
  }finally{child.kill();}
});
test('real HTTP private access protects APIs, signs in and retains health access',{skip,timeout:20000},async()=>{
  fs.mkdirSync('test-data',{recursive:true});const dir=fs.mkdtempSync(path.resolve('test-data','http-'));
  const child=await start('server.mjs',10001,{WTI_ACCESS_TOKEN:'synthetic-access-code',WTI_DATA_DIR:dir});
  try{
    const root='http://127.0.0.1:10001';
    assert.equal((await fetch(root+'/api/signal-journal')).status,401);
    const wrong=await fetch(root+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'access=wrong',redirect:'manual'});assert.equal(wrong.status,401);
    const login=await fetch(root+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'access=synthetic-access-code',redirect:'manual'});assert.equal(login.status,303);
    const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    const response=await fetch(root+'/api/signal-journal',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(response.status,200);
  }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
