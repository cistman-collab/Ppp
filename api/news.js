// Headlines for context, not a verified real-time or licensed news terminal.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  let r;
  try{r=await fetch('https://www.google.com/search?q=WTI+crude+oil+OPEC+EIA&tbm=nws&output=rss',
   {signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0'}})}
  finally{clearTimeout(timer)}
  if(!r.ok)throw Error('News provider HTTP '+r.status);
  const xml=await r.text();
  const decode=s=>s.replace(/<!\\[CDATA\\[|\\]\\]>/g,'').replace(/&amp;/g,'&')
   .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  const items=[...xml.matchAll(/<item>([\\s\\S]*?)<\\/item>/g)].slice(0,8).map(x=>{
   const tag=t=>decode((x[1].match(new RegExp('<'+t+'>([\\s\\S]*?)<\\/'+t+'>'))||[])[1]||'').trim();
   return {title:tag('title'),link:tag('link'),published:tag('pubDate')};
  }).filter(x=>x.title&&/^https?:\\/\\//.test(x.link));
  if(!items.length)throw Error('No parseable RSS headlines');
  res.status(200).json({source:'Google News RSS search (best effort)',verifiedRealTime:false,items,
   disclaimer:'Headlines may be delayed, incomplete or inaccurate. Read original reporting before acting.'});
 }catch(e){res.status(503).json({error:e.message,items:[]})}
};
