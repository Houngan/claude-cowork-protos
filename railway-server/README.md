# SmartDoc — Serveur Railway

Serveur Express minimaliste qui sert `documentation.html` à une URL stable. Le fichier source est stocké dans Google Drive et rechargé à la demande via un endpoint sécurisé.

## Fonctionnement

1. Au démarrage, le serveur télécharge `documentation.html` depuis l'URL Drive publique.
2. `GET /` — sert le HTML en cache.
3. `GET /status` — retourne la date du dernier chargement et la taille du cache.
4. `POST /reload` — recharge le HTML depuis Drive (protégé par token Bearer).

## Déploiement sur Railway

### Prérequis

- Un compte Railway (https://railway.app)
- Le fichier `documentation.html` partagé en lecture via lien dans Google Drive

### Étapes

1. Créer un nouveau projet Railway.
2. Connecter ce repo ou déployer le dossier `railway-server/` :
   - Si mono-repo : configurer le Root Directory dans les settings Railway sur `railway-server`.
3. Configurer les variables d'environnement dans Railway :

| Variable | Description |
|----------|-------------|
| `DRIVE_HTML_URL` | URL de téléchargement direct : `https://drive.google.com/uc?export=download&id=<FILE_ID>` |
| `RELOAD_TOKEN` | Token secret pour le endpoint `/reload` |

4. Railway attribue automatiquement un domaine (ex: `smartdoc-xxx.up.railway.app`).
5. Optionnel : configurer un domaine personnalisé dans les settings Railway.

### Obtenir l'URL Drive

1. Dans Google Drive, clic droit sur `documentation.html` → Partager → "Tous ceux qui ont le lien" (lecteur).
2. Copier l'ID du fichier depuis l'URL : `https://drive.google.com/file/d/<FILE_ID>/view`
3. Construire l'URL de téléchargement : `https://drive.google.com/uc?export=download&id=<FILE_ID>`

### Tester localement

```bash
cp .env.example .env
# Remplir les variables dans .env
npm install
npm start
```

Puis ouvrir http://localhost:3000

### Recharger le HTML

```bash
curl -X POST https://votre-app.up.railway.app/reload \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -H "Content-Type: application/json"
```

## Sécurité

- Aucun secret dans le code source.
- Le token de reload est stocké en variable d'environnement Railway.
- L'URL Drive ne confère aucun droit d'écriture sur le fichier.
