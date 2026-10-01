import { put } from '@vercel/blob';

export default async function handler(req,res){
  if(req.method!=='POST'){
    return res.status(405).json({
      error:'POST only'
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
