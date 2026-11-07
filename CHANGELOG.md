# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni semver.
Ogni commit incrementa la versione e viene pubblicato su GitHub con il tag `vX.Y.Z`.

## [0.5.0] - 2026-11-07
### Modificato
- Player Android ridisegnato sul modello di VLC per Android: barra superiore con indietro, titolo, audio, sottotitoli e velocità; in basso tempo trascorso, seekbar arancione e durata (un tocco sulla durata alterna il tempo rimanente); riga comandi con blocco, precedente, -10, play/pausa, +30, successivo e formato schermo.
### Aggiunto
- Gesti: scorrimento verticale a sinistra = luminosità, a destra = volume (con indicatore), scorrimento orizzontale = cerca nel video con anteprima del tempo, doppio tocco a sinistra/destra = -10 s / +30 s, tocco = pausa/riprendi.
- Blocco comandi (lucchetto), scelta della velocità da elenco (0.5x - 2x), formato schermo (adatta, schermo intero, riempi, 16:9, 4:3, originale), pulsante "Precedente" (il server restituisce `prevFileId`).

## [0.4.1] - 2026-11-07
### Corretto
- Player Android: a fine episodio il lettore non resta più bloccato sull'ultimo fotogramma. libVLC non sempre segnala la fine del file; ora un controllo ogni secondo riconosce lo stato terminale (Ended/Stopped/Error vicino alla fine) o il tempo fermo da 4 s negli ultimi 45 s, chiude il lettore e la web UI apre l'episodio successivo.

## [0.4.0] - 2026-11-07
### Aggiunto
- Player Android: tocco sullo schermo = pausa/riprendi; doppio tocco a sinistra = -10 s, a destra = +30 s; pulsante velocità (1x / 1.25x / 1.5x / 2x); pulsante "Prossimo" che passa all'episodio successivo.
- Cartelle unite in una serie unica con una stagione per sottocartella (Amministrazione -> Serie unica con stagioni). *A tutto reality* è già unita, con le stagioni in ordine cronologico (L'isola, Azione, Il tour, La vendetta dell'isola, All stars, Missione cosmo ridicola).
- Correzione manuale dell'abbinamento TMDB (Amministrazione -> Locandine e metadati): cerca su TMDB e scegli la scheda giusta; la scelta resta fissa nelle riscansioni.
### Corretto
- Locandine: *Dragon Ball* non viene più abbinato a *Dragon Ball Z* (i titoli identici hanno la precedenza), il refuso "Dragn Ball Kai" viene corretto e Kai cerca "Dragon Ball Z Kai". Dopo l'aggiornamento i titoli non bloccati a mano vengono ricercati di nuovo.
- Il selettore di stagione/saga è allineato a sinistra sotto "Episodi".
- Le stagioni sono sempre chiamate "stagioni" nel riepilogo del titolo.

## [0.3.0] - 2026-11-07
### Aggiunto
- Saghe/stagioni personalizzate per le serie con numerazione continua: regole "dall'episodio N inizia la saga X", editor in Amministrazione e regole predefinite per Dragon Ball (serie originale), Kai, Super e GT. Il dettaglio mostra le saghe nel selettore.
- App Android: nella schermata di collegamento un selettore rapido `https://` / `http://`; basta scrivere `myvideo.fplinio.it`. La scelta viene ricordata.
- Pulsante "Riprova" quando home o dettaglio non si caricano; le richieste API scadono dopo 20 secondi invece di restare in attesa all'infinito.
### Corretto
- Player web: all'uscita il video viene chiuso davvero (flusso di rete interrotto) e l'avanzamento viene salvato; evita connessioni rimaste aperte che potevano bloccare il caricamento delle pagine dopo il ritorno dal video.

## [0.2.0] - 2026-11-07
### Aggiunto
- Navigazione a pila con il tasto Indietro di Android: dal dettaglio di un titolo (o dal player) si torna alla schermata precedente (es. Home); dalle altre sezioni (Serie, Film, Lista, Cerca, Account, Admin) si torna alla Home; dalla Home compare "Uscire da MyVideo?" con Annulla/Esci.
### Modificato
- Il pulsante indietro del player web torna alla schermata di provenienza invece di aprire sempre il dettaglio del titolo.

## [0.1.3] - 2026-11-07
### Modificato
- La lunghezza minima della password scende da 8 a 5 caratteri (registrazione, primo avvio e cambio password).

## [0.1.2] - 2026-11-07
### Corretto
- Workflow Release: YAML non valido nel passo SDK Android (nome con `:` non tra virgolette) introdotto in 0.1.1; il tag v0.1.1 non ha prodotto alcuna release.

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
