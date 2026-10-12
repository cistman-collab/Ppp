
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

app.listen(port, '0.0.0.0', () => {
  console.log(`WTI Pro running on port ${port}`);
});
