import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { isNative } from '../api';

/**
 * Tasto indietro di Android a pila:
 *  - dettaglio titolo / player -> torna alla schermata precedente (pila di navigazione);
 *  - altre schermate (Serie, Film, Lista, Cerca, Account, Admin) -> Home;
 *  - Home -> chiede conferma e poi esce dall'app.
 */
export default function BackHandler() {
  const loc = useLocation();
  const nav = useNavigate();
  const [askExit, setAskExit] = useState(false);
  const state = useRef({ path: loc.pathname, key: loc.key, askExit });
  state.current = { path: loc.pathname, key: loc.key, askExit };

  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener('backButton', () => {
      const { path, key, askExit: open } = state.current;
      if (open) setAskExit(false);
      else if (path === '/') setAskExit(true);
      else if (path.startsWith('/title/') || path.startsWith('/watch/')) {
        if (key !== 'default') nav(-1);
        else nav('/', { replace: true });
      } else nav('/', { replace: true });
    });
    return () => { sub.then((s) => s.remove()); };
  }, [nav]);

  // chiude il dialogo se si cambia schermata
  useEffect(() => { setAskExit(false); }, [loc.pathname]);

  if (!askExit) return null;
  return (
    <div className="modal-back" onClick={() => setAskExit(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Uscire da MyVideo?</h2>
        <div className="hero-actions center">
          <button className="btn secondary" onClick={() => setAskExit(false)}>Annulla</button>
          <button className="btn primary" onClick={() => CapApp.exitApp()}>Esci</button>
        </div>
      </div>
    </div>
  );
}
