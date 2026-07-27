const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const DRIVE_HTML_URL = process.env.DRIVE_HTML_URL;
const RELOAD_TOKEN = process.env.RELOAD_TOKEN;

let cachedHTML = '<html><body><p>Chargement en cours…</p></body></html>';
let lastFetchedAt = null;

async function fetchHTMLFromDrive() {
  if (!DRIVE_HTML_URL) {
    console.error('[ERROR] DRIVE_HTML_URL non définie');
    return false;
  }

  try {
    const res = await fetch(DRIVE_HTML_URL, { redirect: 'follow' });
    if (!res.ok) {
      console.error(`[ERROR] Fetch Drive échoué: ${res.status} ${res.statusText}`);
      return false;
    }
    cachedHTML = await res.text();
    lastFetchedAt = new Date().toISOString();
    console.log(`[OK] HTML rechargé depuis Drive — ${lastFetchedAt}`);
    return true;
  } catch (err) {
    console.error(`[ERROR] Fetch Drive exception: ${err.message}`);
    return false;
  }
}

// Middleware JSON pour le endpoint reload
app.use(express.json());

// GET / — Sert le HTML en cache
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(cachedHTML);
});

// GET /status — Infos de santé (sans secret)
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    lastFetchedAt,
    cacheSize: cachedHTML.length,
  });
});

// POST /reload — Recharge le HTML depuis Drive (protégé par token)
app.post('/reload', async (req, res) => {
  const auth = req.headers.authorization;
  if (!RELOAD_TOKEN || auth !== `Bearer ${RELOAD_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const success = await fetchHTMLFromDrive();
  if (success) {
    return res.json({ status: 'reloaded', lastFetchedAt });
  }
  return res.status(502).json({ error: 'Failed to fetch from Drive' });
});

// 404 pour toute autre route
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Démarrage
async function start() {
  console.log('[INIT] Chargement initial du HTML depuis Drive…');
  await fetchHTMLFromDrive();
  app.listen(PORT, () => {
    console.log(`[READY] Serveur démarré sur le port ${PORT}`);
  });
}

start();
