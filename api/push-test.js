import { get } from './storage.js';
import webpush from 'web-push';

export default async function handler(req,res){
  if(req.method!=='POST'){
    return res.status(405).json({
      error:'POST only'
    });
  }
const host=
  String(
    req.headers['x-forwarded-host']||
    req.headers.host||
    ''
  )
  .split(',')[0]
  .trim();

const proto=
  String(
    req.headers['x-forwarded-proto']||
    'https'
  )
  .split(',')[0]
  .trim();

const origin=
  String(req.headers.origin||'');

if(
  !host ||
  origin!==proto+'://'+host
){
  return res.status(403).json({
    error:'Forbidden'
  });
}
  try{
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const result=
      await get(
        'push/subscription.json',
        {
          access:'private',
          token:process.env.BLOB_READ_WRITE_TOKEN,
          useCache:false
        }
      );

    if(
      !result ||
      result.statusCode!==200
    ){
      return res.status(404).json({
        error:'No push subscription found'
      });
    }

    const stored=
      await new Response(
        result.stream
      ).json();

    if(!stored?.subscription){
      return res.status(404).json({
        error:'Subscription missing'
      });
    }

    const synthetic=process.env.WTI_PREVIEW_MODE==='synthetic';
    const payload=JSON.stringify({
      title:synthetic?'WTI Pro · TEST notification':'WTI Pro ✅',
      body:synthetic?'Synthetic preview test. No live signal or trade. Tap to open the test app.':'Test notification from WTI Pro. Confirm receipt on your device.',
      tag:synthetic?'wti-synthetic-test':undefined,url:'/simple.html'
    });
    if(synthetic){
      setTimeout(()=>webpush.sendNotification(stored.subscription,payload,{TTL:60,timeout:10000})
        .catch(error=>console.error('Synthetic test notification failed; status:',Number(error?.statusCode)||'delivery')),10000).unref();
      return res.status(200).json({ok:true,scheduled:true,delaySeconds:10,message:'Test scheduled. Close the app to check background receipt.'});
    }
    await webpush.sendNotification(stored.subscription,payload);

    return res.status(200).json({
      ok:true,
      message:'Test notification sent'
    });

  }catch(e){
    console.error(
      'Test push failed:',
      e
    );

    return res.status(500).json({
      error:e.message
    });
  }
}
