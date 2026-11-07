# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni semver.
Ogni commit incrementa la versione e viene pubblicato su GitHub con il tag `vX.Y.Z`.

## [0.1.1] - 2026-11-07
### Corretto
- Workflow Release: il job APK usa l'SDK Android gia' presente sul runner (l'action `setup-android` falliva).

## [0.1.0] - 2026-11-07
### Aggiunto
- Prima versione: backend Node.js (Express + SQLite) con login email/password, registrazione al primo avvio
  (il primo utente diventa amministratore), approvazione degli altri utenti, cambio password.
- Scansione della libreria da una condivisione Seafile, riconoscimento automatico di film, serie e stagioni dai nomi di file e cartelle.
- Locandine, trame e sfondi da TMDB (chiave configurabile da env o dal pannello Admin).
- Streaming dei video dal NAS verso il client con proxy HTTP Range (nessuna transcodifica).
- Interfaccia web in stile Netflix: hero, righe orizzontali, "Continua a guardare", "La mia lista", dettaglio con episodi, ricerca, player.
- Pannello Admin: utenti, scansione, chiave TMDB, forzatura del tipo di cartella.
- Immagine Docker (porta unica) e `docker-compose.yml`.
- App Android (Capacitor) con lettore nativo libVLC per tutti i formati (avi, rmvb, mkv, ...).
- Workflow GitHub: CI, release con immagine Docker multi-architettura e APK firmato.
