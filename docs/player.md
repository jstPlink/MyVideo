# Lettore web e desktop (stile Netflix)

Nel browser e nell'app desktop (che mostra la stessa interfaccia) il video è un `<video>` senza controlli nativi con sopra i controlli di `web/src/components/PlayerControls.tsx`, pagina `web/src/pages/Watch.tsx`. Sul telefono il lettore è quello nativo descritto in [android-app.md](android-app.md).

## Controlli

- **In alto**: freccia indietro, titolo della serie e episodio.
- **Barra di avanzamento rossa** (si ingrandisce al passaggio del mouse): parte già riprodotta in rosso, parte caricata in grigio chiaro, anteprima del tempo sotto il cursore, clic o trascinamento per spostarsi; a destra il tempo rimanente.
- **Riga dei comandi**: play/pausa, indietro 10 s, avanti 10 s, volume (il cursore compare al passaggio del mouse; volume e muto sono ricordati), titolo al centro; a destra prossimo episodio, **Episodi**, **velocità** (0.5x, 0.75x, normale, 1.25x, 1.5x, 2x) e schermo intero.
- **Episodi**: pannello con l'elenco della serie, selettore di stagione/saga, episodio in corso evidenziato; un clic apre l'episodio.
- **Prossimo episodio**: pulsante in basso a destra quando manca l'**8%** della durata (`NEXT_BUTTON_FRACTION`, circa 2 minuti su 25 minuti); a fine episodio parte comunque il successivo.
- Con il **mouse**: un clic sul video mette in pausa o riprende, il doppio clic attiva lo schermo intero. Su **schermi touch** (telefono, tablet) un tocco mostra o nasconde i comandi, senza mettere in pausa (la pausa si fa col pulsante), come l'app Netflix. I comandi e il cursore si nascondono dopo 3 s senza movimento (restano in pausa o con un menu aperto); il cerchio rosso indica il caricamento.

## Scorciatoie da tastiera

| Tasto | Azione |
|---|---|
| Spazio, K | Pausa / riprendi |
| ← / J | Indietro di 10 s |
| → / L | Avanti di 10 s |
| ↑ / ↓ | Volume +/- 10% |
| M | Muto |
| F | Schermo intero |
| 0-9 | Salta allo 0%-90% del video |
| Maiusc+N | Prossimo episodio |
| Esc | Esci dallo schermo intero / torna indietro |

## Dettagli
- Il `<video>` resta in `Watch.tsx` (avanzamento ogni 10 s, fine episodio, chiusura del flusso di rete all'uscita, statistiche); `PlayerControls` legge lo stato dal video tramite gli eventi (`timeupdate`, `progress`, `play`, `pause`, ...) e lo comanda.
- I formati che il browser non legge (avi, rmvb, ...) mostrano la schermata "Apri in VLC" (vedi [desktop-app.md](desktop-app.md)).
- `/api/play/:fileId` fornisce `seriesTitle`, `episodes` (con il nome della saga) e `nextFileId` per il pannello Episodi e il pulsante Prossimo.
