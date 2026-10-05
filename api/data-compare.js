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

    // ---------- IG LOGIN ----------
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
        stage:'ig-login',
        error:await login.text()
      });
    }

    const cst=login.headers.get('cst');
    const securityToken=login.headers.get('x-security-token');

    // ---------- IG 5m CANDLES ----------
    const igResponse=await fetch(
      base+
      '/prices/'+encodeURIComponent(epic)+
      '?resolution=MINUTE_5&max=40&pageSize=40',
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

    const igData=await igResponse.json();

    if(!igResponse.ok){
      return res.status(igResponse.status).json({
        ok:false,
        stage:'ig-prices',
        error:igData
      });
    }

    const midpoint=(p)=>{
      if(p?.bid==null||p?.ask==null)return null;
      return ((p.bid+p.ask)/2)/100;
    };

    const now=Date.now();

    const igBars=(igData.prices||[])
      .map(p=>{
        const t=Date.parse(p.snapshotTimeUTC);

        return {
          t,
          timeUTC:p.snapshotTimeUTC,
          o:midpoint(p.openPrice),
          h:midpoint(p.highPrice),
          l:midpoint(p.lowPrice),
          c:midpoint(p.closePrice),
          v:p.lastTradedVolume??null
        };
      })
      .filter(b=>
        Number.isFinite(b.t) &&
        [b.o,b.h,b.l,b.c].every(Number.isFinite) &&
        b.t+300000<=now
      );

    // ---------- YAHOO CL=F 5m ----------
    const yahooResponse=await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=1d',
      {
        headers:{
          'User-Agent':'Mozilla/5.0',
          'Accept':'application/json'
        }
      }
    );

    if(!yahooResponse.ok){
      return res.status(yahooResponse.status).json({
        ok:false,
        stage:'yahoo',
        error:'Yahoo HTTP '+yahooResponse.status
      });
    }

    const yahooData=await yahooResponse.json();

    const result=yahooData.chart?.result?.[0];
    const quote=result?.indicators?.quote?.[0];

    if(!result?.timestamp||!quote){
      return res.status(500).json({
        ok:false,
        stage:'yahoo',
        error:'No Yahoo candle data'
      });
    }
