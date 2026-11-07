# MyVideo

Streaming personale in stile Netflix per la tua libreria video su Seafile.
Web app + app Android (APK), il tutto in un singolo container Docker.

- Login con email e password, registrazione al primo avvio (il primo utente e' l'amministratore), cambio password.
- Film e serie riconosciuti automaticamente dalle cartelle di Seafile; locandine e trame da TMDB.
- "Continua a guardare", "La mia lista", episodi con avanzamento.
- Il NAS fa solo da proxy (HTTP Range): nessuna transcodifica, CPU quasi a riposo.
- L'APK usa libVLC: legge qualsiasi formato (mkv, avi, rmvb, HEVC, AC3...). Sul web servono formati supportati dal browser.

## Avvio rapido (NAS / Docker)

```bash
git clone https://github.com/jstPlink/MyVideo.git && cd MyVideo
cp .env.example .env      # compila SEAFILE_URL (e TMDB_API_KEY se ce l'hai)
docker compose up -d --build
```

Apri `http://IP-NAS:8090` (porta `HOST_PORT`), crea l'amministratore e collega il tunnel Cloudflare a quella porta.
Dettagli in [docs/deployment.md](docs/deployment.md).

## Documentazione

La documentazione e' in [`docs/`](docs/README.md) e viene aggiornata ad ogni commit.
Le versioni sono nel [CHANGELOG](CHANGELOG.md) e nelle [release](https://github.com/jstPlink/MyVideo/releases) (con l'APK).
