# SmartDoc — Serveur Railway

Serveur Express qui sert deux vues distinctes depuis Google Drive :
- **Cartographie publique** (`/`) — `documentation.html` accessible à tous
- **Dashboard privé** (`/dashboard`) — statistiques et documents à valider (après login)
- **Registre détaillé** (`/registre`) — toutes les colonnes du registre Excel (après login)

## Architecture

```
GET  /            → cartographie publique (documentation.html)
GET  /login       → page de connexion
POST /api/login   → authentification (cookie JWT)
POST /api/logout  → déconnexion
GET  /api/me      → utilisateur courant
GET  /dashboard   → dashboard privé (protégé)
GET  /registre    → registre détaillé (protégé)
GET  /status      → health check
POST /reload      → recharger les fichiers depuis Drive (token Bearer)
```

## Authentification

- Session cookie JWT (httpOnly, secure en production)
- Bouton login en haut à droite (popover)
- Une fois connecté : liens Dashboard et Registre apparaissent dans la nav

## Récupération des fichiers depuis Drive

Le serveur utilise un **Service Account Google** pour chercher les fichiers par nom dans le dossier `099_SYSTEME/`. Plus besoin de file ID fixe — si Claude crée un nouveau fichier, le serveur le retrouve automatiquement.

## Déploiement sur Railway

### Prérequis

- Un compte Railway (https://railway.app)
- Un projet Google Cloud avec Service Account et accès Drive

### Étapes

1. Créer un nouveau projet Railway.
2. Connecter ce repo ou déployer le dossier `railway-server/` :
   - Si mono-repo : configurer le Root Directory dans les settings Railway sur `railway-server`.
3. Configurer les variables d'environnement dans Railway :

| Variable | Description |
|----------|-------------|
| `DRIVE_FOLDER_ID` | ID du dossier `099_SYSTEME/` dans Google Drive |
| `DRIVE_SERVICE_ACCOUNT_EMAIL` | Email du compte de service Google |
| `DRIVE_PRIVATE_KEY` | Clé privée du compte de service (avec `\n` pour les retours à la ligne) |
| `RELOAD_TOKEN` | Token secret pour le endpoint `/reload` |
| `ADMIN_EMAIL` | Email de l'archiviste pour le login |
| `ADMIN_PASSWORD` | Mot de passe de l'archiviste |
| `SESSION_SECRET` | Secret pour signer les JWT de session |

4. Railway attribue automatiquement un domaine (ex: `smartdoc-xxx.up.railway.app`).

### Créer le Service Account Google

1. Aller sur https://console.cloud.google.com/
2. Créer un projet (ou utiliser un projet existant)
3. APIs & Services → Enable Google Drive API
4. IAM & Admin → Service Accounts → Create Service Account
5. Créer une clé JSON → télécharger le fichier
6. Noter l'email du compte de service et la clé privée
7. Dans Google Drive, partager le dossier `099_SYSTEME/` avec l'email du compte de service (lecteur)

### Obtenir le DRIVE_FOLDER_ID

1. Dans Google Drive, ouvrir le dossier `099_SYSTEME/`
2. Copier l'ID depuis l'URL : `https://drive.google.com/drive/folders/<FOLDER_ID>`

### Tester localement

```bash
cd railway-server
npm install
# Définir les variables d'environnement
export DRIVE_FOLDER_ID=xxx
export DRIVE_SERVICE_ACCOUNT_EMAIL=xxx
export DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nxxx\n-----END PRIVATE KEY-----\n"
export RELOAD_TOKEN=xxx
export ADMIN_EMAIL=archiviste@example.com
export ADMIN_PASSWORD=xxx
export SESSION_SECRET=xxx
npm start
```

Puis ouvrir http://localhost:3000

### Recharger les fichiers depuis Drive

```bash
curl -X POST https://votre-app.up.railway.app/reload \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -H "Content-Type: application/json"
```

## Sécurité

- Aucun secret dans le code source.
- Le Service Account n'accède qu'au dossier `099_SYSTEME/` en lecture.
- Les cookies de session sont httpOnly + secure (en production).
- Les routes privées redirigent vers `/login` si non authentifié.
- L'artefact public ne contient aucune donnée de traitement (source_path, statuts, notes).
