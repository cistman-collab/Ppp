import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

export function refreshPreviewCache(directory, now=Date.now()) {
  const end=Math.floor(now/300000)*300000;
  const bars=Array.from({length:4000},(_,i)=>{
    const c=70+i*.001+i*i*.0000001;
    return {t:end-(4000-i)*300000,o:c-.002,h:c+.01,l:c-.01,c,v:100};
  });
  const payload={bars,igEpic:'EN.D.CL.FWS.TEST',igConfiguredEpic:'EN.D.CL.FWS.TEST',igHistoryEpic:'EN.D.CL.FWS.TEST',
    lastProvider:'IG',igAttemptBucket:Math.floor((now-30000)/300000),contractExpiry:'SYNTHETIC',
    marketStatus:'TRADEABLE',delayTime:0,priceDivisor:100,contractLastDealingAt:'2099-12-31T18:00:00Z'};
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'wti-ig-candles-cache.json'),JSON.stringify(payload));
  return payload;
}

export function isolatePreviewEnvironment(env=process.env, directory=path.resolve('test-data','preview')) {
  if(env.RENDER_SERVICE_NAME==='wti-pro-render-test')throw Error('Refusing to run synthetic preview on the existing Render service');
  for(const name of ['WTI_MONITOR_SECRET','WTI_ACCESS_TOKEN','IG_API_KEY','IG_USERNAME','IG_PASSWORD','IG_BASE_URL',
    'OPENAI_API_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','BLOB_READ_WRITE_TOKEN'])delete env[name];
  Object.assign(env,{PORT:env.PORT||'10000',WTI_DATA_DIR:directory,WTI_PREVIEW_MODE:'synthetic',WTI_MONITOR_ENABLED:'false',IG_EPIC:'EN.D.CL.FWS.TEST'});
  fs.mkdirSync(directory,{recursive:true});
  const keyFile=path.join(directory,'preview-vapid.json');
  const keys=fs.existsSync(keyFile)?JSON.parse(fs.readFileSync(keyFile,'utf8')):webpush.generateVAPIDKeys();
  if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,JSON.stringify(keys),{mode:0o600,flag:'wx'});
  Object.assign(env,{VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'https://github.com/cistman-collab/Ppp'});
  return env;
}
