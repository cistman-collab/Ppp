import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const SESSION_MS=12*60*60*1000;
const digest=value=>createHash('sha256').update(String(value)).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
const sign=(timestamp,secret)=>createHmac('sha256',secret).update(timestamp).digest('hex');
export function sessionValue(secret,now=Date.now()) {
  const timestamp=String(now);return timestamp+'.'+sign(timestamp,secret);
}
export function validSession(value,secret,now=Date.now()) {
  const [timestamp,signature]=String(value||'').split('.');
  const age=now-Number(timestamp);
  return Number.isFinite(age)&&age>=0&&age<SESSION_MS&&equal(signature,sign(timestamp,secret));
}
// Optional single-owner access gate. Enabling it is a deployment configuration step.
export function accessGate(app) {
  const secret=process.env.WTI_ACCESS_TOKEN;
  if(!secret) return;
  const attempts=new Map();
  app.get('/login',(req,res)=>res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WTI Pro sign in</title><style>body{background:#06111f;color:#f5f8ff;font:17px system-ui;max-width:360px;margin:15vh auto;padding:20px}input,button{box-sizing:border-box;width:100%;padding:15px;margin:10px 0;border-radius:12px}button{background:#2fe0a7;border:0;font-weight:bold}</style><h1>WTI Pro</h1><p>Your private trading research workspace.</p><form method="post" action="/login"><label for="access">Access code</label><input id="access" name="access" type="password" autocomplete="current-password" required><button>Sign in</button></form></html>`));
  app.post('/login',(req,res)=>{
    const now=Date.now(),key=req.socket.remoteAddress;
    let record=attempts.get(key);
    if(!record||now-record.at>15*60000){record={at:now,count:0};attempts.set(key,record);}
    if(record.count>=10) return res.status(429).send('Too many sign-in attempts. Try again in 15 minutes.');
    record.count++;
    if(!equal(req.body?.access,secret)) return res.status(401).send('Access code incorrect. Return to sign in.');
    attempts.delete(key);
    const secure=req.headers['x-forwarded-proto']==='https'||req.secure;
    res.setHeader('Set-Cookie',`wti_session=${sessionValue(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS/1000}${secure?'; Secure':''}`);
    return res.redirect(303,'/simple.html');
  });
  app.use((req,res,next)=>{
    if(req.path==='/health'||['/sw.js','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png'].includes(req.path)) return next();
    // Only authenticated background checks bypass the cookie gate.
    if(req.path==='/api/market-monitor' && req.query.view!=='1' && process.env.WTI_MONITOR_SECRET && equal(req.headers.authorization,'Bearer '+process.env.WTI_MONITOR_SECRET)) return next();
    // Internal candle/news requests carry the same monitor secret, over loopback only.
    if(['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress) && process.env.WTI_MONITOR_SECRET && equal(req.headers['x-wti-internal'],process.env.WTI_MONITOR_SECRET)) return next();
    const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('wti_session='));
    if(validSession(cookie?.slice(12),secret))return next();
    return req.path.startsWith('/api/')?res.status(401).json({error:'Sign in to WTI Pro to continue.'}):res.redirect(303,'/login');
  });
}
