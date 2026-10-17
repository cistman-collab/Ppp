import {renderAIControls} from './api/ai-controls.js';
import fs from 'node:fs';
import {previewBanner,previewScenario} from './api/preview.js';
import {accessGate} from './access.mjs';

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/sw.js') res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({extended:false,limit:'4kb'}));
accessGate(app);

app.get('/health', (req, res) => {
  res.json({ ok: true, preview:process.env.WTI_PREVIEW_MODE==='synthetic' });
});

app.get('/', (req, res) => {
  res.redirect(302, '/simple.html');
});

const publicFiles = [
  'simple.html',
  'automatic-plan.js',
  'chart-studies.js',
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

for (const file of publicFiles) {
  app.get(`/${file}`, (req, res) => {
    if(process.env.WTI_PREVIEW_MODE==='synthetic' && file==='manifest.webmanifest'){
      const manifest=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
      return res.json({...manifest,name:'WTI Pro Test Preview',short_name:'WTI Test'});
    }
    if(process.env.WTI_PREVIEW_MODE==='synthetic' && file==='simple.html'){
      const html=fs.readFileSync(path.join(root,file),'utf8')
        .replace('<body>','<body>'+previewBanner())
        .replace('<html lang="en">','<html lang="en" data-preview="synthetic">')
        .replace('<title>WTI Pro</title>','<title>WTI Pro Test Preview</title>')
        .replace('IG selected contract · No fallback','Synthetic test prices · No live feed')
        .replace('IG completed 5m candle close','Synthetic test candle close')
        .replace('Market data uses the selected IG crude oil contract without Yahoo fallback.','This preview uses synthetic prices and does not connect to IG.')
        .replace('WTI Crude Oil · ', 'Synthetic WTI · ');
      return res.type('html').send(renderAIControls(html,false));
    }
    if(file==='simple.html')return res.type('html').send(renderAIControls(fs.readFileSync(path.join(root,file),'utf8'),Boolean(process.env.OPENAI_API_KEY)));
    res.sendFile(path.join(root, file));
  });
}

const apiNames = new Set([
  'inventories',
  'ai',
  'backtest',
  'candles',
  'events',
  'market-monitor',
  'market-status',
  'news',
  'push-subscribe',
  'push-test',
  'push-config',
  'signal-journal'
]);

let selectedPreviewScenario=null;
app.post('/api/preview-scenario',(req,res)=>{
  if(process.env.WTI_PREVIEW_MODE!=='synthetic')return res.sendStatus(404);
  const {stage,direction}=req.body||{};
  if(!['PREPARE','ENTER'].includes(stage)||!['LONG','SHORT'].includes(direction))return res.status(400).json({error:'Invalid preview scenario'});
  selectedPreviewScenario={stage,direction};return res.json({ok:true,synthetic:true});
});
app.get('/api/market-monitor',(req,res,next)=>{
  if(process.env.WTI_PREVIEW_MODE!=='synthetic'||req.query.view!=='1'||!selectedPreviewScenario)return next();
  const data=JSON.parse(fs.readFileSync(path.join(process.env.WTI_DATA_DIR,'wti-ig-candles-cache.json'),'utf8'));
  return res.json(previewScenario(selectedPreviewScenario.stage,selectedPreviewScenario.direction,data.bars.at(-1).c,new Date(data.bars.at(-1).t+300000).toISOString()));
});
let monitorRunning=false;
app.use('/api/market-monitor',(req,res,next)=>{
  if(req.query.view==='1') return next();
  if(monitorRunning) return res.status(409).json({error:'Monitor check already running'});
  monitorRunning=true;
  const release=()=>{monitorRunning=false;};
  res.once('finish',release);res.once('close',release);
  next();
});
app.all('/api/:name', async (req, res) => {
  const name = req.params.name;

  if (!apiNames.has(name)) {
    return res.sendStatus(404);
  }

  try {
    const module = await import(`./api/${name}.js`);
    const handler = module.default;

    if (typeof handler !== 'function') {
      return res.sendStatus(500);
    }

    await handler(req, res);
  } catch (error) {
    console.error('API failed:', name, error.message);

    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        error: 'Internal server error'
      });
    }
  }
});

app.use((req, res) => {
  res.sendStatus(404);
});

const port = Number(process.env.PORT || 10000);

function startRenderMonitor() {
  const secret = process.env.WTI_MONITOR_SECRET;

  if (process.env.WTI_MONITOR_ENABLED === 'false') return;
  if (!secret) {
    console.error('Render monitor disabled: secret missing');
    return;
  }

  const interval = 5 * 60 * 1000;
  const offset = 45 * 1000;

  function scheduleNext() {
    const now = Date.now();
    const next =
      Math.floor((now - offset) / interval) * interval +
      interval + offset;

    setTimeout(runCheck, next - now);
  }

  async function runCheck() {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/market-monitor`,
        {
          headers: {
            Authorization: 'Bearer ' + secret
          },
          redirect: 'error',
          signal: AbortSignal.timeout(120000)
        }
      );

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const result = await response.json();

      if (result.ok !== true) {
        throw new Error('Monitor returned an unsuccessful result');
      }

      console.log(
        'Render monitor:',
        result.skipped ? 'SKIPPED' : result.direction,
        new Date().toISOString()
      );
    } catch (error) {
      console.error('Render monitor failed:', error.message);
    } finally {
      scheduleNext();
    }
  }

  console.log('Render monitor enabled: every five minutes');
  scheduleNext();
}

app.listen(port, '0.0.0.0', () => {
  console.log(`WTI Pro running on port ${port}`);
  startRenderMonitor();
});
