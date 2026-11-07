# Deploy su NAS con Docker

L'app ascolta su **una sola porta** (8080 nel container, `HOST_PORT` sul NAS, default 8090). Il tunnel Cloudflare va puntato a `http://IP-NAS:HOST_PORT`.

## Variabili d'ambiente (`.env`)

| Variabile | Default | Descrizione |
|---|---|---|
| `HOST_PORT` | `8090` | Porta esposta sul NAS (solo `docker-compose.yml`) |
| `SEAFILE_URL` | - | **Obbligatoria.** Link di condivisione Seafile, es. `https://seafile.example.com/d/xxxx/` |
| `TMDB_API_KEY` | vuota | Chiave TMDB (modificabile anche da Admin, che ha la precedenza) |
| `REGISTRATION` | `approval` | Dopo il primo utente: `approval` (approva l'admin), `open`, `closed` |
| `JWT_SECRET` | generato | Segreto dei token; se vuoto e' creato e salvato nel database |
| `SCAN_INTERVAL_HOURS` | `12` | Rescansione automatica (0 = disattivata) |

Il link Seafile e' una credenziale: non committarlo (il repository e' pubblico), tienilo solo in `.env` o nelle variabili del NAS.

## Opzione A - immagine pronta da GitHub (consigliata)

Ad ogni versione il workflow *Release* pubblica `ghcr.io/jstplink/myvideo:<versione>` e `:latest` (amd64 e arm64).

```bash
mkdir myvideo && cd myvideo
# scarica docker-compose.yml e .env.example dal repository, poi:
cp .env.example .env   # compila SEAFILE_URL
docker compose pull && docker compose up -d
```

Se il pacchetto GHCR risulta privato: GitHub -> profilo -> Packages -> myvideo -> Package settings -> *Change visibility* -> Public (oppure `docker login ghcr.io` con un token `read:packages`).

## Opzione B - build sul NAS

```bash
git clone https://github.com/jstPlink/MyVideo.git && cd MyVideo
cp .env.example .env
docker compose up -d --build
```

## Primo avvio

1. Apri `http://IP-NAS:8090`: compare *Configurazione iniziale*. L'account creato e' l'**amministratore**.
2. L'app scansiona Seafile (decine di secondi); poi recupera i metadati se c'e' la chiave TMDB. Controlla da Amministrazione.
3. Gli altri utenti si registrano dalla pagina di login e restano *In attesa* finche' l'admin non li approva (Amministrazione -> Utenti).

## Cloudflare Tunnel

Public hostname -> servizio `http://IP-NAS:8090` (o `http://myvideo:8080` se `cloudflared` e' nella stessa rete Docker). Nessuna configurazione aggiuntiva: WebSocket non servono; il video usa richieste HTTP Range normali.
Se Cloudflare Access protegge l'hostname, l'app Android non potra' autenticarsi: escludi l'hostname da Access, l'app ha gia' il suo login.

## Aggiornamenti

```bash
docker compose pull && docker compose up -d        # opzione A
git pull && docker compose up -d --build            # opzione B
```
Il database nel volume `myvideo-data` viene mantenuto; lo schema e' creato/esteso all'avvio.

## Backup e ripristino

Tutto lo stato e' nel volume `/data` (`myvideo.db`). Backup: `docker run --rm -v myvideo_myvideo-data:/d -v "$PWD":/b alpine tar czf /b/myvideo-data.tgz -C /d .` (il nome del volume dipende dal nome della cartella del progetto: verifica con `docker volume ls`). I video non sono nel container.

## Risoluzione problemi

- *Libreria vuota*: controlla `docker logs myvideo` (`SEAFILE_URL` mancante o link errato) e usa Amministrazione -> Riscansiona.
- *Niente locandine*: manca la chiave TMDB oppure il titolo non ha corrispondenza (Admin -> Riprova metadati).
- *Il video non parte nel browser*: formato non supportato dal browser (avi, rmvb): usa l'app Android o VLC.
- *Password dimenticata*: un admin puo' generare una password temporanea (Amministrazione -> Reset password). Se hai perso l'unico admin, elimina `/data/myvideo.db` (si perdono utenti e progressi) e ricrea l'amministratore.
