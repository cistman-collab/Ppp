// Experimental delayed/free CL futures data adapter. Not a licensed real-time NYMEX feed.
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  try {
    const controller = new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    let response;
    try {response=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=5d',{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 WTI-Pro-Mobile-Prototype','Accept':'application/json'}});}finally{clearTimeout(timeout)}
    if(!response.ok) throw Error('Public data source returned HTTP '+response.status);
    const raw=await response.json(), result=raw.chart?.result?.[0], q=result?.indicators?.quote?.[0];
    if(!result?.timestamp||!q)throw Error('No candle data returned');
    const now=Date.now();
    const bars=result.timestamp.map((sec,i)=>({t:sec*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i]??null})).filter(b=>[b.o,b.h,b.l,b.c].every(Number.isFinite)&&b.h>=Math.max(b.o,b.c)&&b.l<=Math.min(b.o,b.c)&&b.t+300000<=now).slice(-500);
    if(bars.length<3)throw Error('Insufficient completed 5-minute candles');
    return res.status(200).json({symbol:'CL=F',source:'Yahoo Finance public chart endpoint (unofficial; availability and delay not guaranteed)',exchange:'NYMEX futures reference (verify contract month)',delayed:true,verifiedRealTime:false,contract:result.meta?.symbol??'CL=F',fetchedAt:new Date().toISOString(),lastBarAt:new Date(bars.at(-1).t).toISOString(),bars});
  }catch(err){return res.status(503).json({error:'Free public source unavailable: '+err.message,delayed:true,verifiedRealTime:false});}
};
