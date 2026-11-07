# Architettura

## Componenti

| Parte | Tecnologia | Ruolo |
|---|---|---|
| `server/` | Node 24, Express 4, `node:sqlite`, bcryptjs, jsonwebtoken | API, autenticazione, scansione libreria, proxy video, serve la web UI |
| `web/` | React 18, Vite, TypeScript, react-router | Interfaccia in stile Netflix (browser e app) |
| `web/android/` | Capacitor 7, Java, libVLC 3.6 | App Android: la web UI impacchettata + plugin lettore nativo |

Il server e' JavaScript ESM senza build. `node:sqlite` e' incluso in Node: nessuna dipendenza nativa, quindi l'immagine funziona identica su x86 e ARM.

## File del server (`server/src`)

| File | Responsabilita' |
|---|---|
| `index.js` | Avvio, CORS, rotte, file statici della SPA, scansione iniziale e periodica |
| `config.js` | Lettura delle variabili d'ambiente e della versione |
| `db.js` | Schema SQLite, transazioni, tabella `settings` |
| `auth.js` | Registrazione/login/cambio password, JWT, limitatore tentativi |
| `api.js` | Home, titoli, lista, avanzamento, `play`, `stream` |
| `admin.js` | Utenti, scansione, chiave TMDB, forzature cartelle |
| `seafile.js` | Elenco cartelle, risoluzione link di download, proxy Range |
| `parser.js` | Pulizia nomi (titolo, anno, episodio, stagione) |
| `classify.js` | Dall'albero di cartelle a film/serie |
| `scanner.js` | Scansione e scrittura nel database |
| `tmdb.js` | Ricerca metadati su TMDB |

## Flusso di riproduzione

1. L'utente apre un titolo; la UI chiama `GET /api/play/:fileId` e riceve un URL di streaming con **token breve (12 h)** nella query, perche' `<video>` non puo' inviare header `Authorization`.
2. Browser: `<video src=".../api/stream/:fileId?t=...">`. Il server inoltra la richiesta a Seafile, mantenendo l'header `Range`, e risponde `206 Partial Content` (seek istantaneo).
3. App Android: la web UI chiama il plugin `VlcPlayer.play(...)`, che apre un'activity libVLC sullo stesso URL.
4. Il lettore invia periodicamente `POST /api/progress`; la home usa i progressi per "Continua a guardare" e per proporre l'episodio successivo.

Il link di download di Seafile (`/seafhttp/...`) e' temporaneo: il server lo risolve e lo tiene in cache 20 minuti, rinnovandolo se Seafile risponde con errore.

## Database (SQLite, `/data/myvideo.db`)

`users`, `settings`, `saga_rules` e `seasons` (saghe delle serie, vedi [library.md](library.md)), (chiave TMDB, segreto JWT generato), `titles` (film/serie con metadati), `files` (singoli video con stagione/episodio), `progress` (per utente e file), `mylist`, `overrides` (forzature cartelle).
I titoli sono identificati da una chiave stabile (`M:<file>` o `S:<cartella>`): le riscansioni aggiornano senza perdere metadati, progressi e liste.

## Chiusura del flusso video (web)

Quando il player web esce dalla pagina, `Watch.tsx` salva l'ultimo punto, mette in pausa e svuota `src` del `<video>` (`load()`): senza questo il browser puo' lasciare aperta la connessione di streaming e, con molte richieste aperte verso lo stesso host, le pagine successive restano in caricamento. Le richieste API hanno inoltre un timeout di 20 s e le pagine mostrano "Riprova".

## Autenticazione e sicurezza

- Password con bcrypt (costo 11); minimo 5 caratteri.
- Token JWT di accesso (30 giorni) inviato come `Authorization: Bearer`, salvato in `localStorage`. Non si usano cookie, cosi' web e APK funzionano allo stesso modo.
- Cambio password o disabilitazione utente incrementano `token_version`: i vecchi token smettono di valere.
- Primo utente registrato = amministratore. Dopo: `REGISTRATION=approval` (default, l'admin approva), `open` o `closed`.
- Limite di 8 tentativi di login falliti ogni 15 minuti per coppia IP/email (IP da `CF-Connecting-IP` dietro Cloudflare).
- Il link Seafile resta solo sul server: i client vedono soltanto gli URL `/api/stream/...`.
- CORS aperto sulle sole rotte `/api` (l'APK ha origine `http://localhost`); l'autorizzazione e' sempre via token.
