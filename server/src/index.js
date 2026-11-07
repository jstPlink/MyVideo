import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { authRouter, userCount } from './auth.js';
import { apiRouter } from './api.js';
import { adminRouter } from './admin.js';
import { runScan } from './scanner.js';
import { seafileConfigured } from './seafile.js';
import { fetchPendingMetadata } from './tmdb.js';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// CORS: l'app Android (origine http://localhost) parla con questo server via Bearer token.
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/status', (req, res) => {
  res.json({
    name: 'MyVideo',
    version: config.version,
    needsSetup: userCount() === 0,
    registration: config.registration,
    seafileConfigured: seafileConfigured(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', apiRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato' }));

// Interfaccia web (SPA)
if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
  app.use(express.static(config.webDir, { maxAge: '1h', index: false, setHeaders: (res, p) => {
    if (/\/assets\//.test(p.replace(/\\/g, '/'))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.webDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.type('text').send('MyVideo API attiva. Interfaccia web non compilata (cartella web/dist mancante).'));
}

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Errore interno' });
});

const server = app.listen(config.port, () => {
  console.log(`MyVideo ${config.version} in ascolto sulla porta ${config.port}`);
  if (!seafileConfigured()) console.warn('ATTENZIONE: SEAFILE_URL non configurato, la libreria sara\' vuota.');
});
server.requestTimeout = 0; // lo streaming di film lunghi non deve scadere

// Scansione iniziale e periodica
const titles = db.prepare('SELECT COUNT(*) AS n FROM titles').get().n;
setTimeout(() => { if (seafileConfigured()) runScan(); else fetchPendingMetadata(); }, titles ? 15000 : 1000);
if (config.scanIntervalHours > 0) {
  setInterval(() => { if (seafileConfigured()) runScan(); }, config.scanIntervalHours * 3600 * 1000).unref();
}

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });
