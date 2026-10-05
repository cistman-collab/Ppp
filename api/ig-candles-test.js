module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');

  try{
    const base=process.env.IG_BASE_URL;
    const apiKey=process.env.IG_API_KEY;
    const username=process.env.IG_USERNAME;
    const password=process.env.IG_PASSWORD;
    const epic=process.env.IG_EPIC;

    if(!base||!apiKey||!username||!password||!epic){
      return res.status(500).json({
        ok:false,
        error:'IG environment variables missing'
      });
    }

    const login=await fetch(base+'/session',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'X-IG-API-KEY':apiKey,
        'VERSION':'2'
      },
      body:JSON.stringify({
        identifier:username,
        password:password,
        encryptedPassword:false
      })
    });

    if(!login.ok){
      return res.status(login.status).json({
        ok:false,
        stage:'login',
        error:await login.text()
      });
    }

    const cst=login.headers.get('cst');
    const securityToken=login.headers.get('x-security-token');

    const url=
      base+
      '/prices/'+encodeURIComponent(epic)+
      '?resolution=MINUTE_5&max=20&pageSize=20';

    const pricesResponse=await fetch(url,{
      headers:{
        'Accept':'application/json',
        'X-IG-API-KEY':apiKey,
        'CST':cst,
        'X-SECURITY-TOKEN':securityToken,
        'VERSION':'3'
      }
    });

    const data=await pricesResponse.json();

    if(!pricesResponse.ok){
      return res.status(pricesResponse.status).json({
        ok:false,
        stage:'prices',
        error:data
      });
    }

    const midpoint=(price)=>{
      if(
        price?.bid==null ||
        price?.ask==null
      ) return null;

      return ((price.bid+price.ask)/2)/100;
    };

    const candles=(data.prices||[]).map(p=>({
      timeUTC:p.snapshotTimeUTC||null,
      time:p.snapshotTime||null,
      open:midpoint(p.openPrice),
      high:midpoint(p.highPrice),
      low:midpoint(p.lowPrice),
      close:midpoint(p.closePrice),
      igVolume:p.lastTradedVolume??null
    }));

    return res.status(200).json({
      ok:true,
      source:'IG DEMO',
      epic,
      resolution:'MINUTE_5',
      count:candles.length,
      candles,
      allowance:data.allowance||null,
      metadata:data.metadata||null,
      checkedAt:new Date().toISOString()
    });

  }catch(error){
    return res.status(500).json({
      ok:false,
      error:error.message
    });
  }
};
