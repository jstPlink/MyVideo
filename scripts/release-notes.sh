#!/usr/bin/env bash
# Stampa la sezione del CHANGELOG relativa alla versione indicata ($1).
set -euo pipefail
v="${1:?versione mancante}"
awk -v v="$v" '
  $0 ~ "^## \[" v "\]" { on = 1; next }
  on && /^## \[/ { exit }
  on { print }
' CHANGELOG.md | sed '/./,$!d'
