# API REST

Base: `/api`. Formato JSON. Autenticazione: header `Authorization: Bearer <token>` (tranne dove indicato). Errori: `{ "error": "messaggio" }`.

## Pubbliche

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/status` | `{ version, needsSetup, registration, seafileConfigured }` |
| POST | `/auth/register` | `{ email, password }`. Primo utente = admin (risponde con token). Poi: `active` (open), `pending` (202, `{pending:true}`) o 403 (closed) |
| POST | `/auth/login` | `{ email, password }` -> `{ token, user }`. 403 se in attesa/disabilitato, 429 dopo troppi tentativi |

## Utente autenticato

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/auth/me` | Utente corrente |
| POST | `/auth/password` | `{ currentPassword, newPassword }` -> nuovo token (i vecchi decadono) |
| GET | `/home` | `{ hero, rows[], empty }` (righe: continua a guardare, lista, recenti, serie, cartelle) |
| GET | `/titles?kind=movie\|series&q=testo` | Elenco/ricerca (max 500) |
| GET | `/titles/:id` | Dettaglio, file/episodi con avanzamento, `resume`, `seasons` (nomi delle saghe, se definiti), titoli correlati |
| GET | `/mylist` | La mia lista |
| POST | `/mylist/:titleId` | Aggiunge/rimuove -> `{ inList }` |
| GET | `/play/:fileId` | `{ streamPath, title, position, nextFileId, ext, ... }` con token di streaming di 12 h |
| GET | `/stream/:fileId?t=<token>` | Video con supporto `Range` (anche con Bearer) |
| POST | `/progress` | `{ fileId, position, duration }` (secondi); completato oltre il 92% |
| DELETE | `/progress/title/:titleId` | Azzera l'avanzamento di un titolo |

## Amministratore (`/admin`)

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/admin/users` | Elenco utenti |
| PATCH | `/admin/users/:id` | `{ status: active\|pending\|disabled, role: admin\|user }` |
| POST | `/admin/users/:id/reset-password` | -> `{ temporaryPassword }` |
| DELETE | `/admin/users/:id` | Elimina utente |
| GET | `/admin/library` | Stato scansione, conteggi, forzature, cartelle |
| POST | `/admin/scan` | Avvia la scansione |
| POST | `/admin/metadata/retry` | Riprova i titoli senza metadati |
| PUT | `/admin/settings` | `{ tmdbKey }` |
| GET | `/admin/sagas` | Serie con le regole di saga (`text`, `source`, `presetAvailable`) |
| PUT | `/admin/sagas/:titleId` | `{ text }` righe `<episodio> <nome>`; vuoto = stagione unica |
| DELETE | `/admin/sagas/:titleId` | Ripristina le regole predefinite (o nessuna) |
| GET | `/admin/groups` | Cartelle unibili in una serie unica (`merged`, `order`) |
| PUT | `/admin/groups` | `{ path, merge, order[] }`: unisce (`seasons`) o separa (`noseasons`) e riscansiona |
| GET | `/admin/tmdb/search?kind=movie\|series&q=` | Ricerca su TMDB per la correzione manuale |
| PUT | `/admin/titles/:id/tmdb` | `{ tmdbId }`: imposta (e blocca) l'abbinamento TMDB |
| DELETE | `/admin/titles/:id/tmdb` | Toglie il blocco e rifà la ricerca automatica |
| PUT | `/admin/overrides` | `{ path, mode: series\|movies\|ignore\|null }` e riscansione |
