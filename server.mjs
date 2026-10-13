
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.redirect(302, '/simple.html');
});

const publicFiles = [
  'simple.html',
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'icon.svg'
];

for (const file of publicFiles) {
  app.get(`/${file}`, (req, res) => {
    res.sendFile(path.join(root, file));
  });
}

const apiNames = new Set([
  'ai',
  'backtest',
  'candles',
  'events',
  'market-monitor',
  'market-status',
  'news',
  'push-subscribe',
  'push-test',
  'signal-journal'
]);

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
        'https://wti-pro-render-test.onrender.com/api/market-monitor',
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
