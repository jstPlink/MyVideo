# Sviluppo

## Requisiti
Node 24+, (Docker per provare l'immagine, JDK 21 + Android SDK solo per build APK locali).

## Avvio locale

```bash
cd server && npm ci
cd ../web && npm ci && npm run build
cd ../server
SEAFILE_URL="https://seafile.example.com/d/xxxx/" DATA_DIR=../data PORT=8099 npm start
# http://localhost:8099
```

Sviluppo UI con hot reload: `cd web && npm run dev` (http://localhost:5173, proxy `/api` -> `localhost:8099`).

## Test

```bash
cd server && npm test        # parser e classificazione (node:test)
cd web && npm run build      # include il controllo dei tipi TypeScript
# prova del classificatore su una libreria reale:
TREE_JSON=percorso/tree.json node --test test/classify.test.js   # tree.json = [[percorso, dimensione], ...]
```

## Regole di versione e rilascio

Ad ogni commit:

1. `node scripts/bump-version.mjs X.Y.Z` (semver: patch per fix/docs, minor per funzioni, major per rotture).
2. Nuova sezione `## [X.Y.Z] - data` in `CHANGELOG.md`.
3. Aggiornare `docs/` (e `README.md`) in modo che riflettano il comportamento attuale.
4. `git commit` — l'hook `.githooks/pre-commit` verifica versioni coerenti, CHANGELOG e docs in commit.
5. `bash scripts/publish.sh` — crea il tag `vX.Y.Z` e fa push di commit e tag.

Il tag avvia il workflow **Release** (`.github/workflows/release.yml`):
- `release`: crea la release GitHub con le note estratte dal CHANGELOG (`scripts/release-notes.sh`);
- `docker`: pubblica `ghcr.io/jstplink/myvideo:<versione>` e `:latest` (amd64 + arm64);
- `apk`: compila e firma l'APK e lo allega alla release (usa l'SDK Android gia' installato sul runner Ubuntu, accetta le licenze con `sdkmanager`).

Il workflow **CI** (`ci.yml`) esegue test, build web e build Docker (senza push) ad ogni push su `main` e sulle PR.

Dopo un clone, attiva l'hook: `git config core.hooksPath .githooks`.

## Note sui workflow
- I valori YAML con `:` (anche nei `name:` dei passi) vanno tra virgolette, altrimenti il workflow risulta non valido e non parte. Verifica con `python -c "import yaml;yaml.safe_load(open('.github/workflows/release.yml'))"`.

## Note per Windows
- Git Bash converte i percorsi che iniziano con `/`: usare `MSYS_NO_PATHCONV=1` con `curl`.
- Per terminare un server di prova: `Get-NetTCPConnection -LocalPort 8099 | % { Stop-Process -Id $_.OwningProcess }`.
