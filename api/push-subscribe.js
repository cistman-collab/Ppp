import { get, put } from './storage.js';

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
    const subscription=req.body?.subscription;

    if(
      !subscription ||
      !subscription.endpoint
    ){
      return res.status(400).json({
        error:'Missing push subscription'
      });
    }

    const previous=await get('push/subscription.json');
    const existing=previous?await new Response(previous.stream).json():null;
    if(existing?.subscription?.endpoint && existing.subscription.endpoint!==subscription.endpoint){
      return res.status(409).json({error:'Another device is already subscribed. Existing alerts preserved.'});
    }
    const endpoint=new URL(subscription.endpoint);
    const providerAllowed=['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(endpoint.hostname) || endpoint.hostname.endsWith('.notify.windows.com');
    if(!providerAllowed || endpoint.protocol!=='https:' || !subscription.keys?.p256dh || !subscription.keys?.auth){
      return res.status(400).json({error:'Invalid push subscription'});
    }
    const savedAt=new Date().toISOString();

    await put(
      'push/subscription.json',
      JSON.stringify({
        subscription,
        savedAt
      },null,2),
      {
        access:'private',
        addRandomSuffix:false,
        allowOverwrite:true,
        ifMatch:previous?.blob.etag??null,
        contentType:'application/json',
        token:process.env.BLOB_READ_WRITE_TOKEN
      }
    );

    return res.status(200).json({
      ok:true,
      savedAt
    });

  }catch(e){
    console.error(
      'Push subscription save failed:',
      e
    );

    return res.status(500).json({
      error:'Could not save push subscription'
    });
  }
}
