# App Android (APK)

L'APK e' la stessa web UI impacchettata con **Capacitor** (`web/android/`, `appId it.fplinio.myvideo`) piu' un plugin nativo per riprodurre i video con **libVLC**.

## Come funziona

- Al primo avvio chiede l'**indirizzo del server**: due pulsanti `https://` / `http://` (la scelta viene ricordata) e un campo dove basta scrivere l'host, es. `myvideo.fplinio.it` (https, tunnel Cloudflare) oppure `192.168.1.10:8090` (http, rete locale). Se incolli un indirizzo completo, lo schema scritto prevale. Poi compare il login. Si puo' cambiare da Account o dalla pagina di login ("cambia server").
- L'app carica l'interfaccia dai file locali e parla con il server via API con token Bearer (CORS aperto sulle rotte `/api`). L'origine e' `http://localhost` (`androidScheme: 'http'`) cosi' funzionano sia server http (LAN) che https (Cloudflare).
- Il router usa gli hash (`#/title/3`) perche' le pagine sono file locali.
- **Riproduzione**: `Watch.tsx` chiama `VlcPlayer.play({ url, title, position })` (`web/src/native.ts`). Il plugin Java `VlcPlayerPlugin` apre `VlcPlayerActivity`, a schermo intero in orizzontale, con play/pausa, -10 s / +30 s, barra di avanzamento, scelta traccia audio e sottotitoli. Alla chiusura restituisce `{ position, duration }` in secondi; la UI salva l'avanzamento e, a fine episodio, passa al successivo.
- libVLC decodifica sul telefono (HW se possibile): nessun carico sul NAS. Legge mkv, avi, rmvb, HEVC, AC3/DTS ecc.
- Gli ABI inclusi sono `arm64-v8a` e `armeabi-v7a` (APK piu' leggero; niente x86).

## Il lettore (`VlcPlayerActivity`)

Interfaccia costruita in codice (nessun layout XML) con i comandi di Netflix e i colori dell'app: sfondo nero, accento rosso `#E50914`; icone vettoriali in `res/drawable/ic_pl_*.xml`.

| Zona | Contenuto |
|---|---|
| In alto | freccia indietro, titolo della serie e, sotto, episodio (`S2:E21 - titolo`), formato schermo (cicla Adatta, Schermo intero, Riempi, 16:9, 4:3, Originale) |
| Al centro | -10 s, play/pausa grande, +10 s |
| In basso | tempo trascorso, **barra rossa**, tempo rimanente (un tocco alterna rimanente e durata); sotto, una riga di pulsanti con icona e testo: **Blocca**, **Velocità** (0.5x-2x), **Episodi** (solo serie), **Audio e sottotitoli**, **Prossimo ep.** (se esiste) |
| Pulsante flottante | "Prossimo episodio": compare quando manca il **5%** della durata (`NEXT_BUTTON_FRACTION`) |

I comandi si nascondono dopo 4 s in riproduzione e restano visibili in pausa.

- **Episodi**: finestra con l'elenco degli episodi (selettore di stagione/saga se ce n'è più di una), quello in corso è evidenziato; toccando un episodio il lettore si chiude e la web UI apre quello scelto.
- **Audio e sottotitoli**: una finestra a due colonne (tracce audio e sottotitoli, con "Disattivato") che applica la scelta subito.
- **Blocca**: nasconde i comandi e disattiva i gesti; resta solo il lucchetto per sbloccare, e il tasto indietro non esce finché è bloccato.

| Gesto | Effetto |
|---|---|
| Tocco | Pausa / riprendi |
| Doppio tocco a sinistra / destra | -10 s / +30 s (messaggio in alto) |
| Scorrimento verticale a sinistra | Luminosità (indicatore; ripristinata all'uscita) |
| Scorrimento verticale a destra | Volume di sistema (indicatore) |
| Scorrimento orizzontale | Cerca nel video (tutta la larghezza = 90 s), si applica al rilascio |

### Scambio con la web UI
`Watch.tsx` chiama `VlcPlayer.play({ url, title, position, hasNext, currentId, seriesTitle, episodes })` (`episodes` = JSON con `id, season, episode, title, seasonName`). Alla chiusura il plugin restituisce `{ position, duration, next, goto, watched, startedAt, endedAt }`: la UI salva l'avanzamento, invia i secondi guardati a `POST /api/watch` ([statistiche](statistics.md)) e apre `goto` (episodio scelto dal pannello), il successivo (`next` o fine episodio) oppure torna indietro.

**Un solo avvio per episodio** — l'effetto che chiama `VlcPlayer.play` in `Watch.tsx` deve dipendere solo da `play` (e usa `navRef` per navigare). Se dipendesse da `nav`, che cambia a ogni navigazione, il lettore verrebbe riaperto per l'episodio precedente a ogni passaggio, impilando più player (bug corretto in 0.8.0). Un `launched` ref impedisce comunque il doppio avvio per lo stesso file.

### Fine episodio
La fine viene rilevata in tre modi: evento libVLC `EndReached`; evento `Stopped` entro 3 s dalla fine; controllo di sicurezza ogni secondo (`endWatch`) che chiude il lettore se lo stato è Ended/Stopped/Error vicino alla fine oppure se, negli ultimi 45 s di video, il tempo non avanza da 4 s (in pausa non scatta). Serve perché libVLC non sempre invia `EndReached`. Il lettore somma anche i secondi realmente guardati (`watchTick`, solo in primo piano) per le statistiche.

## Tasto Indietro (navigazione a pila)

`web/src/components/BackHandler.tsx` intercetta il tasto indietro di Android (`@capacitor/app`, evento `backButton`) e applica queste regole in base alla schermata corrente:

| Schermata | Indietro |
|---|---|
| Dettaglio titolo `/title/:id`, player `/watch/:id` | schermata precedente nella pila (`navigate(-1)`); se la pagina e' stata aperta senza cronologia, Home |
| Serie, Film, Lista, Cerca, Account, Admin | Home |
| Home | dialogo "Uscire da MyVideo?" -> *Esci* chiude l'app, *Annulla* (o un altro Indietro) chiude il dialogo |

Il cambio episodio automatico nel player usa `replace`, quindi non riempie la pila: dal player, Indietro porta sempre alla schermata da cui si e' partiti. Sul web il tasto indietro del browser resta quello normale.

## Ottenere l'APK

Ogni versione pubblica su GitHub Releases un file `MyVideo-<versione>.apk` (workflow *Release*, job `apk`). Scaricalo dal telefono e installalo (serve consentire le "app da origini sconosciute").
Gli aggiornamenti si installano sopra la versione precedente perche' l'APK e' firmato sempre con la stessa chiave.

## Firma

Il job usa un keystore salvato nei secrets del repository: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Senza questi segreti firma con la chiave di debug (l'APK si installa ma ogni build ha una firma diversa: per aggiornare bisogna disinstallare).
Per crearli una volta sola: `.\scripts\setup-android-signing.ps1` (PowerShell; genera il keystore in `../MyVideo-keystore/` e imposta i secrets con `gh`). Se la release e' gia' stata pubblicata prima di averli impostati, rilancia il workflow *Release* di quel tag: l'APK verra' ricostruito e sostituito.
**Conserva una copia del keystore**: se lo perdi, gli utenti dovranno disinstallare e reinstallare l'app.

## Build locale (opzionale)

Servono JDK 21 e Android SDK.

```bash
cd web
npm ci && npm run build
npx cap sync android
cd android && APP_VERSION=$(cat ../../VERSION) ./gradlew assembleRelease
# APK: app/build/outputs/apk/release/app-release.apk (firmato con la chiave di debug se KEYSTORE_FILE non e' impostato)
```

La versione dell'app (`versionName`) viene dalla variabile `APP_VERSION`; `versionCode = major*10000 + minor*100 + patch`.

## Icone

Sorgenti SVG in `web/assets/`; rigenerazione: `cd web && npx capacitor-assets generate --android --iconBackgroundColor '#141414'`.
