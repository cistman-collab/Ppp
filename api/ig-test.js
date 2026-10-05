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

    const loginText=await login.text();

    if(!login.ok){
      return res.status(login.status).json({
        ok:false,
        stage:'login',
        error:loginText
      });
    }

    const cst=login.headers.get('cst');
    const securityToken=
      login.headers.get('x-security-token');

    if(!cst||!securityToken){
      return res.status(500).json({
        ok:false,
        stage:'login',
        error:'IG session tokens missing'
      });
    }

    const market=await fetch(
      base+'/markets/'+encodeURIComponent(epic),
      {
        headers:{
          'Accept':'application/json',
          'X-IG-API-KEY':apiKey,
          'CST':cst,
          'X-SECURITY-TOKEN':securityToken,
          'VERSION':'3'
        }
      }
    );

    const marketText=await market.text();

    let data;

    try{
      data=JSON.parse(marketText);
    }catch{
      data={raw:marketText};
    }

    if(!market.ok){
      return res.status(market.status).json({
        ok:false,
        stage:'market',
        error:data
      });
    }

    const snapshot=data.snapshot||{};

    return res.status(200).json({
      ok:true,
      source:'IG DEMO',
      epic,
      name:data.instrument?.name||null,
      expiry:data.instrument?.expiry||null,
      marketStatus:snapshot.marketStatus||null,
      delayTime:snapshot.delayTime??null,
      streamingPricesAvailable:
        data.instrument?.streamingPricesAvailable===true,

      bidRaw:snapshot.bid??null,
      askRaw:snapshot.offer??null,

      bid:snapshot.bid!=null
        ?snapshot.bid/100
        :null,

      ask:snapshot.offer!=null
        ?snapshot.offer/100
        :null,

      spread:
        snapshot.bid!=null &&
        snapshot.offer!=null
        ?(snapshot.offer-snapshot.bid)/100
        :null,

      checkedAt:new Date().toISOString()
    });

  }catch(error){
    return res.status(500).json({
      ok:false,
      error:error.message
    });
  }
};
