# Download delle app dal sito

La pagina **/download** del sito (anche **senza login**, perciò si può aprire da qualsiasi computer) permette di scaricare l'app Android (APK) e gli installer per Windows, macOS e Linux. Link: menu del profilo -> *Scarica le app* e, nella schermata di login, *Scarica l'app per Android e computer*. Non compare nell'app Android.

## Cosa mostra
- L'indirizzo del server (con pulsante *Copia*) da inserire alla prima apertura delle app.
- Una scheda per sistema (Android, Windows, macOS, Linux) con versione, dimensione, data e istruzioni di installazione. Il **sistema del dispositivo in uso viene riconosciuto** e mostrato per primo con il pulsante evidenziato.
- Se per lo stesso sistema esistono più file (es. macOS arm64 e x64) compaiono entrambi.

## Come funziona
`GET /api/downloads` (pubblico, `server/src/downloads.js`) legge le ultime 12 release del repository GitHub (`GITHUB_REPO`, default `jstPlink/MyVideo`) e, per ogni sistema, sceglie il file della release **più recente che lo contiene**: se una release è ancora in compilazione e ha solo l'APK, l'installer Windows resta quello della versione precedente. Il risultato è in cache 10 minuti (se GitHub non risponde si usa l'ultimo elenco noto). I pulsanti puntano direttamente ai file della release su GitHub: il NAS non fa da proxy a file da 100 MB e il traffico non passa dal tunnel.

| Estensione | Sistema |
|---|---|
| `.apk` | Android |
| `.exe` (installer, non l'uninstaller) | Windows |
| `.dmg` | macOS |
| `.AppImage` | Linux |

Variabile opzionale: `GITHUB_REPO` (`proprietario/nome`) se il repository cambia. Il repository deve essere pubblico (o servirebbe un token). Gli installer e l'APK sono prodotti dal workflow *Release* ad ogni versione.
