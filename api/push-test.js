import { get } from '@vercel/blob';
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

    await webpush.sendNotification(
      stored.subscription,
      JSON.stringify({
        title:'WTI Pro ✅',
        body:'Background alerts are working on your iPhone.',
        url:'/simple.html'
      })
    );

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
