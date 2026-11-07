#!/usr/bin/env bash
# Dopo il commit: crea il tag della versione corrente e pubblica commit + tag su GitHub.
# Il tag avvia il workflow "Release" (release GitHub, immagine Docker, APK).
set -euo pipefail
v="$(tr -d '[:space:]' < VERSION)"
git diff --quiet HEAD || { echo "Ci sono modifiche non committate."; exit 1; }
git tag -a "v$v" -m "MyVideo $v"
git push origin HEAD "v$v"
echo "Pubblicata la versione v$v"
