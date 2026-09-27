from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
import json, time

URL='https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=5m&range=5d'

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            req=Request(URL,headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'})
            with urlopen(req,timeout=10) as r: raw=json.load(r)
            result=raw['chart']['result'][0]
            quote=result['indicators']['quote'][0]
            now=time.time()
            bars=[]
            for i,ts in enumerate(result.get('timestamp',[])):
                try:
                    o,h,l,c=[float(quote[k][i]) for k in ('open','high','low','close')]
                    if 0<l<=min(o,c)<=max(o,c)<=h and ts+300<=now:
                        bars.append({'t':int(ts)*1000,'o':o,'h':h,'l':l,'c':c})
                except (TypeError,ValueError,IndexError,KeyError): pass
            bars=sorted({b['t']:b for b in bars}.values(),key=lambda b:b['t'])
            if len(bars)<35: raise ValueError('Insufficient completed candles')
            body={'symbol':'CL=F','provider':'Yahoo Finance public chart API','delayed':True,'verifiedRealTime':False,'fetchedAt':int(now*1000),'bars':bars}
            status=200
        except Exception:
            body={'error':'Market data unavailable; NO TRADE'}
            status=503
        data=json.dumps(body).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)
