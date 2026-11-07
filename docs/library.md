# Libreria: da Seafile a film e serie

La libreria viene letta da un **link di condivisione Seafile** (`SEAFILE_URL`, formato `https://host/d/<token>/`) tramite l'API pubblica dei share-link. Il server invia lo User-Agent `MyVideo/1.0` (Cloudflare blocca quelli di default di alcune librerie).

## Scansione

- All'avvio (1 s se il database e' vuoto, altrimenti 15 s), poi ogni `SCAN_INTERVAL_HOURS` ore (default 12) e su richiesta dal pannello Admin.
- Percorre ricorsivamente tutte le cartelle, tiene solo i file video (`mp4 mkv avi rmvb webm mov m4v wmv flv ts mpg mpeg m2ts`); sottotitoli e file `.part` sono ignorati.
- Aggiorna il database in una transazione: nuovi titoli aggiunti, esistenti aggiornati, spariti rimossi.

## Come si decide cosa e' un film e cosa una serie (`classify.js`)

Per ogni cartella, in ordine:

1. **Serie a stagioni**: se almeno meta' delle sottocartelle ha un nome tipo `S01`, `Stagione 2`, `Season 3`, la cartella e' una serie e ogni sottocartella e' una stagione (es. *How i met your mother*).
2. **Cartella di episodi**: con almeno 3 video e uno di questi segnali, e' una serie:
   - almeno il 60% dei nomi ha numerazione esplicita (`1x01`, `S01E02`, `Ep.03`, `Episodio 4`, `E012`);
   - almeno il 70% ha un numero isolato (`Dragon Ball GT 001`) **e** un prefisso comune non numerico;
   - almeno 5 file hanno lo stesso prefisso di 2+ parole e nessun anno (puntate con titolo, es. *Missione Cosmo Ridicola - ...*).
3. Altrimenti ogni video e' un **film** (es. raccolte `Pixar`, `Pokemon`, `Film`: numeri di serie come `01 - Mewtwo...` non fanno scattare la modalita' serie perche' non c'e' prefisso comune).

Le sottocartelle vengono poi analizzate allo stesso modo. Una cartella dentro un'altra e' solo un raggruppamento: la **cartella di primo livello** diventa una riga della home (es. *Pixar*, *Dragon Ball*).

### Titoli e episodi
- Film: titolo e anno dal nome file (`Matrix 1999.mkv` -> *Matrix*, 1999). Si rimuovono qualita'/codec/lingua (`1080p`, `x265`, `ITA`...), tag come `[Mux by ...]`, `byR02`, indici iniziali (`01 - `).
- Episodi: stagione/numero dal nome; se mancano il numero e' dato dall'ordine alfabetico, la stagione dalla cartella (o 1). Il titolo dell'episodio e' cio' che segue il marcatore.

## Saghe e stagioni personalizzate (`sagas.js`)

Le serie con numerazione continua (Dragon Ball: episodi 1-153, Kai 1-159...) non hanno stagioni nei nomi dei file e finirebbero in un'unica stagione. Le **regole di saga** le dividono: ogni regola e' "dall'episodio N inizia questa saga" e vale fino alla regola successiva.

- Le regole sono salvate per serie nella tabella `saga_rules` (chiave = `S:<cartella>`); le stagioni risultanti in `seasons` (numero + nome) e il numero di stagione di ogni file in `files.season`. Il numero dell'episodio resta quello assoluto.
- Si applicano ai soli episodi **senza** numerazione stagione esplicita (`1x01`): serie come *How I Met Your Mother* non sono toccate.
- **Predefinite**: alla prima scansione le serie riconosciute dal nome ricevono le regole (da Wikipedia, in italiano): *Dragon Ball* (9 saghe, ep. 1-153), *Dragon Ball Kai* (7, ep. 1-159), *Dragon Ball Super* (5, ep. 1-131), *Dragon Ball GT* (4, ep. 1-64). *Daima* e *Heroes* restano a stagione unica.
- **Modifica**: Amministrazione -> *Saghe / stagioni delle serie*: scegli la serie e scrivi una riga per saga (`19 Saga di Freezer`). Campo vuoto = una sola stagione. *Ripristina predefinite* torna ai valori sopra. Le regole modificate sopravvivono alle riscansioni.

## Unire cartelle in una serie con stagioni

Una cartella che contiene più serie o stagioni separate (es. `A tutto reality/` con una sottocartella per stagione) può diventare **una sola serie**: ogni sottocartella con video è una stagione, il nome della stagione è il nome della sottocartella senza il nome della serie ("A tutto reality - Azione" -> "Azione"). Le sottocartelle sono ordinate secondo l'elenco impostato, poi in ordine alfabetico.

- Si configura da Amministrazione -> *Serie unica con stagioni* (elenco delle cartelle con almeno due serie al loro interno): *Unisci in una serie*, ordine delle stagioni (una riga ciascuna), *Separa di nuovo*. Salvando parte una riscansione.
- Salvataggio: tabella `overrides` con modo `seasons` (unita) o `noseasons` (esplicitamente separata) e l'ordine in `data`; i nomi delle stagioni sono in `seasons`.
- **Predefinito**: `A tutto reality` è unita con l'ordine L'isola, Azione, Il tour, La vendetta dell'isola, All stars, Missione cosmo ridicola (ordine cronologico di Total Drama). Se la separi, il preset non torna.
- La numerazione stagione scritta nei file (es. `5x01`) viene ignorata per queste serie: conta la posizione della sottocartella. L'avanzamento già salvato dagli episodi segue i file nella nuova serie; le voci "La mia lista" delle vecchie serie separate vanno riaggiunte.

## Righe della home

*Continua a guardare*, *La mia lista*, *Aggiunti di recente*, *Serie TV*, poi una riga per ogni cartella di primo livello con almeno 3 titoli; il resto confluisce in *Altri titoli*.

## Metadati TMDB (`tmdb.js`)

- Serve una chiave: `TMDB_API_KEY` oppure Admin -> TMDB (API key v3 o Read Access Token v4). Senza chiave l'app funziona con segnaposto testuali al posto delle locandine.
- **Abbinamento**: tra i risultati vince quello con titolo identico (normalizzato, senza accenti/punteggiatura), altrimenti il più simile (>= 60% delle parole in comune rispetto alla più lunga: "Dragon Ball" non diventa "Dragon Ball Z"). Alla ricerca si applicano correzioni note: il refuso `Dragn` -> `Dragon` e l'alias `Dragon Ball Kai` -> `Dragon Ball Z Kai` (`searchQuery` in `tmdb.js`).
- **Correzione manuale**: Amministrazione -> *Locandine e metadati*: cerca il titolo in libreria, poi su TMDB, e scegli la scheda giusta (si salva l'ID, `meta_locked = 1`). *Torna all'automatico* toglie il blocco e rifà la ricerca. I titoli bloccati non vengono toccati dalle riscansioni né dai cambi di algoritmo (`meta_algo` nei `settings`: quando cambia, i titoli non bloccati tornano `pending`).
- Ricerca in italiano (`it-IT`) per titolo (+ anno per i film). Un risultato e' accettato solo se il titolo e' abbastanza simile (>= 60% delle parole), per evitare abbinamenti sbagliati; altrimenti il titolo resta `none` e si puo' riprovare dall'Admin.
- Si salvano trama, locandina, sfondo, voto, generi, durata. Per le serie con numerazione esplicita (`1x01`) si recuperano anche titolo, trama e immagine degli episodi.
- Immagini caricate direttamente da `image.tmdb.org` dal client.

## Forzare il tipo di una cartella

Admin -> *Cartelle: forza il tipo*: **Automatico**, **Serie (episodi)**, **Film singoli** o **Ignora**. La scelta e' salvata nella tabella `overrides` e la libreria viene riscansionata subito.

## Formati e riproduzione

| Estensione | Browser | App Android (libVLC) |
|---|---|---|
| mp4, m4v, webm, mov | si' (se codec supportato) | si' |
| mkv | dipende dal codec (H.264 di solito si') | si' |
| avi, rmvb, wmv, flv, mpg, ts | no: mostra "Apri in VLC" / copia link / scarica | si' |

Nella libreria attuale i file `rmvb` (Dragon Ball) e `avi` (How I Met Your Mother) richiedono l'app o VLC.
