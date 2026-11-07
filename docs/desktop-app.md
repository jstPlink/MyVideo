# App desktop (Windows, macOS, Linux)

L'app desktop è una finestra **Electron** (`desktop/`) che mostra l'interfaccia web del tuo server MyVideo. Non contiene il server né i video: serve solo un server MyVideo raggiungibile (rete locale o tunnel Cloudflare).

## Installazione

Scarica dall'ultima [release](https://github.com/jstPlink/MyVideo/releases) il file per il tuo sistema:

| Sistema | File | Note |
|---|---|---|
| Windows 10/11 (x64) | `MyVideo-Setup-X.Y.Z.exe` | Installer NSIS: scegli la cartella, crea collegamenti su desktop e menu Start. Installazione per l'utente corrente (non servono i privilegi di amministratore). |
| macOS | `MyVideo-X.Y.Z-mac-<arch>.dmg` | Trascina l'app in Applicazioni. |
| Linux | `MyVideo-X.Y.Z-linux-<arch>.AppImage` | `chmod +x` e avvia. |

**Gli installer non sono firmati** (nessun certificato di code signing): Windows SmartScreen mostra "Windows ha protetto il PC" -> *Ulteriori informazioni* -> *Esegui comunque*; macOS richiede clic destro -> *Apri* la prima volta. Con un certificato si possono impostare `CSC_LINK` / `CSC_KEY_PASSWORD` nel workflow.

## Primo avvio e uso

1. Compare *Collega il server*: scegli `https://` o `http://` e scrivi solo l'host (`myvideo.fplinio.it` oppure `192.168.1.10:8090`). L'app verifica `/api/status` e controlla che sia MyVideo prima di salvare.
2. Poi compare il normale login. L'accesso resta memorizzato.
3. Se il server non risponde compare una pagina con *Riprova* e *Cambia server*.

La configurazione è in `%APPDATA%\myvideo-desktop\config.json` (Windows), `~/Library/Application Support/myvideo-desktop/` (macOS), `~/.config/myvideo-desktop/` (Linux): contiene l'indirizzo del server e la posizione della finestra. Il login resta nei dati di Chromium della stessa cartella.

| Scorciatoia | Azione |
|---|---|
| Ctrl+Maiusc+S | Cambia server |
| F5 | Ricarica |
| Alt+← / Alt+→ | Indietro / Avanti |
| F11 | Schermo intero |
| Ctrl + / Ctrl - | Zoom |
| Alt | Mostra la barra dei menu (nascosta di default) |

## Formati non supportati: apri in VLC

Il motore web (Chromium) non legge `avi`, `rmvb`, ecc. Quando riproduci uno di questi file compare la schermata "Il browser non riesce a riprodurre questo file": nell'app desktop il pulsante **Apri in VLC** avvia VLC installato sul computer sull'indirizzo di streaming (`desktop/main.js`, canale IPC `open-in-vlc`). VLC viene cercato in:

- Windows: `Program Files\VideoLAN\VLC`, `Program Files (x86)\VideoLAN\VLC`, `%LOCALAPPDATA%\Programs\VideoLAN\VLC`
- macOS: `/Applications/VLC.app`
- Linux: `/usr/bin/vlc`, `/usr/local/bin/vlc`, `/snap/bin/vlc`, Flatpak

Se VLC non c'è, viene mostrato un messaggio. L'app accetta di aprire in VLC solo indirizzi del server configurato.

## Come funziona (per sviluppatori)

- `main.js`: finestra (sandbox, `contextIsolation`), configurazione, menu, IPC (`get-server`, `save-server`, `change-server`, `retry`, `open-in-vlc`), apertura dei link esterni nel browser di sistema (le navigazioni fuori dal server non avvengono nell'app), istanza singola.
- `preload.js`: espone `window.myvideoDesktop` alle pagine; la web UI lo usa in `Watch.tsx` per il pulsante VLC.
- `pages/setup.html` e `pages/offline.html`: pagine locali di configurazione ed errore.
- Nessun codice dell'interfaccia è duplicato: la UI arriva dal server, quindi si aggiorna insieme al container Docker; l'app desktop va reinstallata solo se cambia Electron o il comportamento della finestra.

### Build locale

```bash
cd desktop
npm ci
npm start            # prova in sviluppo
npm run dist         # installer per il sistema corrente in desktop/dist/
```
L'icona è `desktop/build/icon.png` (generata dall'SVG con `npm run icon`; il PNG è committato). Il workflow *Release* costruisce Windows, macOS e Linux su runner GitHub e carica i file nella release del tag.
