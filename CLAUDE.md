# MyVideo - istruzioni per lo sviluppo

Applicazione in stile Netflix (web + APK Android) che riproduce i video di una condivisione Seafile.
Gira in Docker su NAS, su una sola porta; Cloudflare Tunnel e' configurato dall'utente.

## Regole obbligatorie ad ogni commit
1. **Incrementa la versione** (semver): `node scripts/bump-version.mjs X.Y.Z`
   (aggiorna `VERSION`, `server/package.json`, `web/package.json`).
2. **Aggiungi la sezione `## [X.Y.Z] - AAAA-MM-GG` in `CHANGELOG.md`.**
3. **Aggiorna la documentazione in `docs/`** (e `README.md` se serve) in modo che descriva come funziona l'app *dopo* la modifica.
4. Committa, poi pubblica con `bash scripts/publish.sh`: crea il tag `vX.Y.Z` e fa push su GitHub.
   Il tag avvia il workflow Release (release GitHub, immagine Docker su ghcr.io, APK).
5. Il hook `.githooks/pre-commit` verifica i punti 1-3 (si attiva con `git config core.hooksPath .githooks`).

## Sicurezza
- Il link Seafile, le chiavi TMDB e i segreti non vanno mai committati (repo pubblico). Solo `.env` locale / variabili del NAS.
- Keystore Android e password sono nei secrets GitHub (`ANDROID_*`), mai nel repo.

## Struttura
- `server/` Node 24 + Express + `node:sqlite`, JavaScript ESM (test: `cd server && npm test`)
- `web/` React + Vite + TypeScript (build: `cd web && npm run build`), `web/android/` progetto Capacitor
- `docs/` documentazione, `scripts/` utilita', `.github/workflows/` CI e release

## Comandi utili
- Server: `cd server && SEAFILE_URL=... DATA_DIR=../data PORT=8099 npm start`
- Web in sviluppo: `cd web && npm run dev` (proxy su :8099)
- Windows/Git Bash: usare `MSYS_NO_PATHCONV=1` quando si passano percorsi che iniziano con `/` a curl.
