const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ENV =====
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const DRIVE_SERVICE_ACCOUNT_EMAIL = process.env.DRIVE_SERVICE_ACCOUNT_EMAIL;
const DRIVE_PRIVATE_KEY = (process.env.DRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const RELOAD_TOKEN = process.env.RELOAD_TOKEN;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

// ===== CACHE =====
let cachedPublicHTML = '<html><body><p>Chargement en cours…</p></body></html>';
let cachedRegistreData = null;
let lastFetchedAt = null;

// ===== GOOGLE DRIVE CLIENT =====
function getDriveClient() {
  if (!DRIVE_SERVICE_ACCOUNT_EMAIL || !DRIVE_PRIVATE_KEY || !DRIVE_FOLDER_ID) {
    console.error('[ERROR] Variables Drive manquantes (DRIVE_FOLDER_ID, DRIVE_SERVICE_ACCOUNT_EMAIL, DRIVE_PRIVATE_KEY)');
    return null;
  }

  const auth = new google.auth.JWT({
    email: DRIVE_SERVICE_ACCOUNT_EMAIL,
    key: DRIVE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return google.drive({ version: 'v3', auth });
}

// ===== FETCH FILE BY NAME FROM DRIVE =====
async function fetchFileByName(driveClient, fileName) {
  try {
    const listRes = await driveClient.files.list({
      q: `name = '${fileName}' and '${DRIVE_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, modifiedTime)',
      pageSize: 1,
    });

    if (!listRes.data.files || listRes.data.files.length === 0) {
      console.error(`[ERROR] ${fileName} non trouvé dans le dossier Drive`);
      return null;
    }

    const file = listRes.data.files[0];
    const downloadRes = await driveClient.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    return {
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime,
      data: Buffer.from(downloadRes.data),
    };
  } catch (err) {
    console.error(`[ERROR] Fetch ${fileName} échoué: ${err.message}`);
    return null;
  }
}

// ===== RELOAD FROM DRIVE =====
async function reloadFromDrive() {
  const driveClient = getDriveClient();
  if (!driveClient) return false;

  // Fetch documentation.html (public artifact)
  const htmlFile = await fetchFileByName(driveClient, 'documentation.html');
  if (htmlFile) {
    cachedPublicHTML = htmlFile.data.toString('utf-8');
    console.log(`[OK] documentation.html rechargé — file ID: ${htmlFile.id}`);
  } else {
    console.error('[WARN] documentation.html non trouvé — cache inchangé');
  }

  // Fetch registre_documentation.xlsx (private data)
  const xlsxFile = await fetchFileByName(driveClient, 'registre_documentation.xlsx');
  if (xlsxFile) {
    try {
      const workbook = XLSX.read(xlsxFile.data, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      cachedRegistreData = XLSX.utils.sheet_to_json(sheet);
      console.log(`[OK] registre_documentation.xlsx rechargé — ${cachedRegistreData.length} lignes`);
    } catch (err) {
      console.error(`[ERROR] Lecture xlsx échouée: ${err.message}`);
    }
  } else {
    console.error('[WARN] registre_documentation.xlsx non trouvé');
  }

  lastFetchedAt = new Date().toISOString();
  return true;
}

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (!token) {
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }

  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
}

// ===== HEADER FRAGMENT =====
function renderHeader(activePage) {
  return `
  <header class="sd-header">
    <a href="/" class="sd-logo">SmartDoc</a>
    <nav class="sd-nav">
      <a href="/" class="${activePage === 'carto' ? 'active' : ''}">Cartographie</a>
      <a href="/dashboard" class="${activePage === 'dashboard' ? 'active' : ''} sd-private-link" style="display:none">Dashboard</a>
      <a href="/registre" class="${activePage === 'registre' ? 'active' : ''} sd-private-link" style="display:none">Registre</a>
    </nav>
    <div id="sd-auth-zone" class="sd-auth-zone"></div>
  </header>
  <script>
    (function() {
      const authZone = document.getElementById('sd-auth-zone');
      const privateLinks = document.querySelectorAll('.sd-private-link');

      function renderLoggedIn(email) {
        privateLinks.forEach(l => l.style.display = '');
        authZone.innerHTML = '<button id="sd-logout-btn" class="sd-auth-btn" title="Déconnexion"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>';
        document.getElementById('sd-logout-btn').addEventListener('click', async () => {
          await fetch('/api/logout', { method: 'POST', credentials: 'include' });
          window.location.href = '/';
        });
      }

      function renderLoggedOut() {
        privateLinks.forEach(l => l.style.display = 'none');
        authZone.innerHTML = '<button id="sd-login-btn" class="sd-auth-btn" title="Connexion"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></button>';
        document.getElementById('sd-login-btn').addEventListener('click', () => {
          window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        });
      }

      fetch('/api/me', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => data && data.user ? renderLoggedIn(data.user) : renderLoggedOut())
        .catch(() => renderLoggedOut());
    })();
  </script>
  `;
}

// ===== SHARED CSS =====
const SHARED_CSS = `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #0d0d0d; color: #e0e0e0; line-height: 1.6; }
    .sd-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.5rem; background: #111; border-bottom: 1px solid #333; position: sticky; top: 0; z-index: 100; }
    .sd-logo { font-family: 'Crimson Pro', Georgia, serif; font-size: 1.3rem; font-weight: 700; color: #CFAFE7; text-decoration: none; }
    .sd-nav { display: flex; gap: 1.5rem; }
    .sd-nav a { color: #888; text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
    .sd-nav a:hover, .sd-nav a.active { color: #e0e0e0; }
    .sd-auth-zone { display: flex; align-items: center; }
    .sd-auth-btn { background: none; border: none; color: #888; cursor: pointer; padding: 0.4rem; border-radius: 6px; transition: color 0.2s, background 0.2s; }
    .sd-auth-btn:hover { color: #e0e0e0; background: rgba(255,255,255,0.08); }
    .sd-container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
    .sd-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .sd-stat-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1.2rem; }
    .sd-stat-card .label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
    .sd-stat-card .value { font-size: 1.8rem; font-weight: 700; color: #CFAFE7; }
    .sd-section { margin-bottom: 2.5rem; }
    .sd-section h2 { font-family: 'Crimson Pro', Georgia, serif; font-size: 1.4rem; color: #e0e0e0; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid #333; }
    .sd-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .sd-table th { text-align: left; padding: 0.6rem 0.8rem; background: #1a1a1a; color: #888; font-weight: 600; border-bottom: 2px solid #333; white-space: nowrap; }
    .sd-table td { padding: 0.5rem 0.8rem; border-bottom: 1px solid #222; color: #ccc; }
    .sd-table tr:hover td { background: rgba(207, 175, 231, 0.05); }
    .sd-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
    .sd-badge.classified { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .sd-badge.to_analyze { background: rgba(251, 146, 60, 0.2); color: #fb923c; }
    .sd-badge.to_validate { background: rgba(250, 204, 21, 0.2); color: #facc15; }
    .sd-badge.proposed { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
    .sd-badge.duplicate { background: rgba(248, 113, 113, 0.2); color: #f87171; }
    .sd-badge.out_of_scope { background: rgba(120, 120, 120, 0.2); color: #999; }
    .sd-drive-link { color: #CFAFE7; text-decoration: none; }
    .sd-drive-link:hover { text-decoration: underline; }
    .sd-filter-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .sd-filter-btn { padding: 0.3rem 0.8rem; border: 1px solid #333; background: #1a1a1a; color: #888; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.2s; }
    .sd-filter-btn.active, .sd-filter-btn:hover { border-color: #CFAFE7; color: #e0e0e0; }
    .sd-empty { color: #555; font-style: italic; padding: 1rem 0; }
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
`;

// ===== MIDDLEWARES =====
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ===== PUBLIC ROUTES =====

// GET / — cartographie publique
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(cachedPublicHTML);
});

// GET /login — page de login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// POST /api/login — authentification
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Auth non configurée' });
  }

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ user: email }, SESSION_SECRET, { expiresIn: '7d' });
    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ status: 'ok', user: email });
  }

  return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
});

// POST /api/logout — déconnexion
app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  return res.json({ status: 'ok' });
});

// GET /api/me — utilisateur courant
app.get('/api/me', (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    return res.json({ user: decoded.user });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid session' });
  }
});

// GET /status — health check
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    lastFetchedAt,
    publicCacheSize: cachedPublicHTML.length,
    registreRows: cachedRegistreData ? cachedRegistreData.length : 0,
  });
});

// POST /reload — recharge depuis Drive (protégé par token Bearer)
app.post('/reload', async (req, res) => {
  const auth = req.headers.authorization;
  if (!RELOAD_TOKEN || auth !== `Bearer ${RELOAD_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const success = await reloadFromDrive();
  if (success) {
    return res.json({ status: 'reloaded', lastFetchedAt });
  }
  return res.status(502).json({ error: 'Failed to fetch from Drive' });
});

// ===== PRIVATE ROUTES =====

// GET /dashboard — dashboard privé
app.get('/dashboard', authMiddleware, (req, res) => {
  if (!cachedRegistreData) {
    return res.send(renderShell('dashboard', '<div class="sd-container"><p class="sd-empty">Registre non chargé. Exécutez /reload.</p></div>'));
  }

  const rows = cachedRegistreData;
  const total = rows.length;
  const classified = rows.filter(r => r.classification_status === 'classified');
  const toAnalyze = rows.filter(r => r.classification_status === 'to_analyze' || r.date_status === 'unknown');
  const toValidate = rows.filter(r => r.classification_status === 'to_validate' || r.classification_status === 'proposed');
  const duplicates = rows.filter(r => r.duplicate_status && r.duplicate_status !== 'none' && r.duplicate_status !== '');
  const outOfScope = rows.filter(r => r.classification_status === 'out_of_scope');
  const noDate = rows.filter(r => !r.detected_date || r.date_status === 'unknown' || r.date_status === 'to_investigate');

  // Group by document_type
  const byType = {};
  rows.forEach(r => {
    const t = r.document_type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  });

  // Group by year
  const byYear = {};
  classified.forEach(r => {
    const d = r.detected_date || '';
    const y = d.toString().slice(0, 4);
    if (y && y.length === 4) byYear[y] = (byYear[y] || 0) + 1;
  });

  // To validate list
  const toValidateRows = toValidate.map(r => `
    <tr>
      <td>${r.doc_id || ''}</td>
      <td>${r.title || r.original_filename || ''}</td>
      <td>${r.document_type || ''}</td>
      <td><span class="sd-badge ${r.classification_status || ''}">${r.classification_status || ''}</span></td>
      <td>${r.confidence || ''}</td>
      <td>${r.drive_web_url ? `<a href="${r.drive_web_url}" target="_blank" class="sd-drive-link">Ouvrir</a>` : ''}</td>
    </tr>
  `).join('');

  // Duplicates list
  const duplicateRows = duplicates.map(r => `
    <tr>
      <td>${r.doc_id || ''}</td>
      <td>${r.title || r.original_filename || ''}</td>
      <td><span class="sd-badge duplicate">${r.duplicate_status || ''}</span></td>
      <td>${r.duplicate_of || ''}</td>
      <td>${r.drive_web_url ? `<a href="${r.drive_web_url}" target="_blank" class="sd-drive-link">Ouvrir</a>` : ''}</td>
    </tr>
  `).join('');

  const html = `
  <div class="sd-container">
    <div class="sd-stats">
      <div class="sd-stat-card"><div class="label">Total documents</div><div class="value">${total}</div></div>
      <div class="sd-stat-card"><div class="label">Classés</div><div class="value">${classified.length}</div></div>
      <div class="sd-stat-card"><div class="label">À valider</div><div class="value">${toValidate.length}</div></div>
      <div class="sd-stat-card"><div class="label">À analyser</div><div class="value">${toAnalyze.length}</div></div>
      <div class="sd-stat-card"><div class="label">Doublons</div><div class="value">${duplicates.length}</div></div>
      <div class="sd-stat-card"><div class="label">Sans date</div><div class="value">${noDate.length}</div></div>
      <div class="sd-stat-card"><div class="label">Hors périmètre</div><div class="value">${outOfScope.length}</div></div>
    </div>

    <div class="sd-section">
      <h2>Répartition par type documentaire</h2>
      <table class="sd-table">
        <thead><tr><th>Type</th><th>Nombre</th></tr></thead>
        <tbody>
          ${Object.entries(byType).sort((a,b) => b[1]-a[1]).map(([t,n]) => `<tr><td>${t}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2" class="sd-empty">Aucune donnée</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="sd-section">
      <h2>Répartition par année (documents classés)</h2>
      <table class="sd-table">
        <thead><tr><th>Année</th><th>Nombre</th></tr></thead>
        <tbody>
          ${Object.entries(byYear).sort().map(([y,n]) => `<tr><td>${y}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2" class="sd-empty">Aucune donnée</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="sd-section">
      <h2>Documents à valider (${toValidate.length})</h2>
      ${toValidate.length > 0 ? `<table class="sd-table"><thead><tr><th>ID</th><th>Titre</th><th>Type</th><th>Statut</th><th>Confiance</th><th>Drive</th></tr></thead><tbody>${toValidateRows}</tbody></table>` : '<p class="sd-empty">Aucun document à valider.</p>'}
    </div>

    <div class="sd-section">
      <h2>Doublons détectés (${duplicates.length})</h2>
      ${duplicates.length > 0 ? `<table class="sd-table"><thead><tr><th>ID</th><th>Titre</th><th>Type</th><th>Doublon de</th><th>Drive</th></tr></thead><tbody>${duplicateRows}</tbody></table>` : '<p class="sd-empty">Aucun doublon détecté.</p>'}
    </div>
  </div>
  `;

  res.send(renderShell('dashboard', html));
});

// GET /registre — registre détaillé privé
app.get('/registre', authMiddleware, (req, res) => {
  if (!cachedRegistreData) {
    return res.send(renderShell('registre', '<div class="sd-container"><p class="sd-empty">Registre non chargé. Exécutez /reload.</p></div>'));
  }

  const rows = cachedRegistreData;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const filter = req.query.status || '';
  const filteredRows = filter ? rows.filter(r => r.classification_status === filter) : rows;

  const tableRows = filteredRows.map(r => `
    <tr>
      ${columns.map(c => {
        let val = r[c] || '';
        if (c === 'classification_status' && val) {
          return `<td><span class="sd-badge ${val}">${val}</span></td>`;
        }
        if (c === 'drive_web_url' && val) {
          return `<td><a href="${val}" target="_blank" class="sd-drive-link">Ouvrir</a></td>`;
        }
        return `<td>${val}</td>`;
      }).join('')}
    </tr>
  `).join('');

  const statuses = ['', 'classified', 'to_analyze', 'to_validate', 'proposed', 'duplicate', 'out_of_scope'];

  const filterBar = `
    <div class="sd-filter-bar">
      ${statuses.map(s => `<button class="sd-filter-btn ${filter === s ? 'active' : ''}" onclick="window.location.href='/registre${s ? '?status=' + s : ''}'">${s || 'Tous'}</button>`).join('')}
    </div>
  `;

  const html = `
  <div class="sd-container">
    <div class="sd-section">
      <h2>Registre documentaire (${filteredRows.length} / ${rows.length} lignes)</h2>
      ${filterBar}
      <div style="overflow-x: auto;">
        <table class="sd-table">
          <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${tableRows || '<tr><td colspan="' + columns.length + '" class="sd-empty">Aucune ligne</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>
  `;

  res.send(renderShell('registre', html));
});

// ===== SHELL RENDERER =====
function renderShell(activePage, content) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmartDoc — ${activePage === 'dashboard' ? 'Dashboard' : 'Registre'}</title>
  ${SHARED_CSS}
</head>
<body>
  ${renderHeader(activePage)}
  ${content}
</body>
</html>`;
}

// ===== 404 =====
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ===== START =====
async function start() {
  console.log('[INIT] Chargement initial depuis Google Drive…');
  await reloadFromDrive();
  app.listen(PORT, () => {
    console.log(`[READY] Serveur démarré sur le port ${PORT}`);
  });
}

start();
