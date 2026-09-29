// Unofficial public historical/delayed feed. NEVER label as verified live.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'GET only'});
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  let response;
  try{response=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=30d',
   {signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}})}
  finally{clearTimeout(timer)}
  if(!response.ok)throw Error('Provider HTTP '+response.status);
  const data=await response.json(),result=data.chart?.result?.[0],quote=result?.indicators?.quote?.[0];
  if(!result?.timestamp||!quote)throw Error('No candle data');
  const now=Date.now();
  const bars=result.timestamp.map((t,i)=>({t:t*1000,o:quote.open[i],h:quote.high[i],l:quote.low[i],c:quote.close[i],v:quote.volume?.[i]??0}))
   .filter(b=>[b.o,b.h,b.l,b.c].every(Number.isFinite)&&b.t+300000<=now).slice(-4000);
  if(bars.length<40)throw Error('Insufficient historical candles');
  res.status(200).json({symbol:'CL=F',source:'Yahoo Finance unofficial public chart endpoint',
   delayed:true,verifiedRealTime:false,contractVerified:false,fetchedAt:new Date().toISOString(),
   lastBarAt:new Date(bars.at(-1).t).toISOString(),bars});
 }catch(e){res.status(503).json({error:e.message,delayed:true,verifiedRealTime:false})}
};
