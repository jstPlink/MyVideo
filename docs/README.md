# Documentazione MyVideo

Versione descritta: vedi `VERSION` / [CHANGELOG](../CHANGELOG.md). Questa documentazione viene aggiornata ad ogni commit.

| Documento | Contenuto |
|---|---|
| [architecture.md](architecture.md) | Componenti, flusso dei dati, database, sicurezza |
| [library.md](library.md) | Come la libreria Seafile diventa film e serie, metadati TMDB, forzature |
| [deployment.md](deployment.md) | Docker sul NAS, variabili d'ambiente, Cloudflare Tunnel, aggiornamenti, backup |
| [player.md](player.md) | Lettore web e desktop in stile Netflix: controlli e scorciatoie |
| [downloads.md](downloads.md) | Pagina per scaricare APK e installer dal sito |
| [android-app.md](android-app.md) | App Android: Capacitor, lettore libVLC, build e firma dell'APK |
| [desktop-app.md](desktop-app.md) | App desktop Electron: installazione, uso, VLC, build |
| [statistics.md](statistics.md) | Statistiche di visione: cosa si vede, come si registra, esportazione |
| [api.md](api.md) | Endpoint REST |
| [development.md](development.md) | Sviluppo locale, test, regole di versione e rilascio |

## In breve

```
 Browser / APK ──HTTPS──▶ Cloudflare Tunnel ──▶ NAS: container MyVideo (porta unica)
                                                    │  API + web UI + proxy video
                                                    ▼
                                              Seafile (link condiviso)
```

- Un solo container: serve l'interfaccia web, le API e fa da proxy dei video.
- I dati (utenti, libreria, progressi) sono in SQLite nel volume `/data`.
- I file video restano su Seafile; il NAS inoltra i byte richiesti (Range) senza elaborarli.
