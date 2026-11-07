# Statistiche di visione

La pagina **Statistiche** (pulsante accanto all'icona del profilo, rotta `/stats`) mostra quanto e quando guardi. Non esiste su Netflix: i dati restano sul tuo server, nel database SQLite.

## Cosa si vede

- **Riepilogo**: tempo guardato, sessioni (e titoli diversi), giorni attivi, media al giorno e media nei giorni attivi.
- **Tempo guardato per giorno** (oltre 100 giorni: per settimana). Passando sopra una barra compare il giorno.
- **Ore del giorno**: in che ore guardi di più.
- **Giorno della settimana e ora**: mappa di calore 7 x 24.
- **Titoli più guardati** (con locandina e barra proporzionale), **Per video** (un tocco su una riga mostra il tempo giorno per giorno di quell'episodio/film) e **Cronologia** (ultime 100 sessioni con data e ora di inizio, titolo e durata).
- **Periodo**: 7 giorni, 30 giorni, 90 giorni, anno, sempre (la scelta viene ricordata).
- **Esporta i dati**: vedi sotto.

Il tempo conta solo la **riproduzione effettiva**: le pause non si sommano e un video lasciato in pausa non allunga la sessione. Giorni e ore sono quelli del dispositivo che ha guardato (fuso orario del client).

## Come vengono registrati i dati

Una **sessione** è una visione continua di un file. Il client invia i secondi guardati a `POST /api/watch` con `{ sessionId, fileId, startedAt, endedAt, seconds, tz }`:

| Client | Quando invia |
|---|---|
| Web e app desktop (`web/src/watch.ts`, `WatchTracker`) | Un tick al secondo solo se il `<video>` è in play; invio ogni 30 s, alla pausa, alla chiusura della pagina e quando si esce dal player |
| App Android (`VlcPlayerActivity`) | Il lettore somma i secondi in cui `isPlaying()` è vero e, alla chiusura, restituisce `watched`, `startedAt`, `endedAt`; la web UI li invia una volta sola |

Il server valida i dati (secondi limitati alla durata dell'intervallo, massimo 6 ore per invio, inizio non oltre 7 giorni indietro) e li salva in due tabelle:

- `watch_sessions`: una riga per sessione (id, utente, file, titolo, tipo, etichetta episodio, nome file, inizio, fine, secondi, fuso). I **nomi sono copiati nella sessione**, così lo storico resta leggibile anche se la libreria cambia o un file sparisce (nessuna chiave esterna su file/titoli).
- `watch_buckets`: secondi per utente, file, **giorno** e **ora** locali (`day`, `hour`). I secondi di una sessione a cavallo di più ore o della mezzanotte vengono ripartiti in proporzione al tempo trascorso in ciascuna fascia (`distribute()` in `server/src/watch.js`). Da qui derivano grafici per giorno, ora e mappa di calore.

Eliminando un utente si eliminano anche le sue sessioni.

## Esportazione e accesso ai dati

Dalla pagina, sezione *Esporta i dati* (nel periodo selezionato):

| Dataset | Contenuto | Formati |
|---|---|---|
| Sessioni | una riga per visione: id, inizio, fine, secondi, minuti, titolo, tipo, episodio, file | CSV, JSON |
| Per giorno | giorno, secondi, minuti | CSV, JSON |
| Per giorno e ora | giorno, ora, secondi, minuti | CSV, JSON |
| Per video | totale, sessioni, prima e ultima visione per file | CSV, JSON |

I CSV usano la virgola, date locali `AAAA-MM-GG hh:mm:ss`, UTF-8 con BOM (si aprono bene in Excel). Gli **amministratori** hanno in più l'esportazione di *tutti gli utenti* (`all=1`, colonna `utente`). Gli stessi dati sono nell'API (`GET /api/stats`, `GET /api/stats/export`) e, volendo, direttamente in `/data/myvideo.db`:

```sql
-- ore guardate per giorno
SELECT day, ROUND(SUM(seconds)/3600.0, 2) AS ore FROM watch_buckets GROUP BY day ORDER BY day;
-- sessioni con titolo e orario
SELECT datetime(started_at/1000, 'unixepoch') AS inizio, title_name, ep_label, ROUND(seconds/60.0) AS minuti FROM watch_sessions ORDER BY started_at DESC;
```

## Limiti
- Lo storico parte dall'aggiornamento 0.7.0: le visioni precedenti non si possono ricostruire.
- Se il browser viene chiuso di colpo, si può perdere l'ultimo mezzo minuto non ancora inviato.
- Sull'app Android i secondi vengono inviati alla chiusura del lettore: se l'app viene terminata dal sistema durante la riproduzione quella sessione non viene registrata.
