import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { absolute, api, getServer, getToken, isNative } from '../api';
import { VlcPlayer } from '../native';

interface Play {
  fileId: number; titleId: number; ext: string; name: string; kind: string; title: string;
  streamPath: string; position: number; nextFileId: number | null;
}

// Formati che nessun browser riproduce: si passa direttamente a VLC.
const BROWSER_UNSUPPORTED = new Set(['avi', 'rmvb', 'wmv', 'flv', 'mpg', 'mpeg', 'm2ts', 'ts']);

function saveProgress(fileId: number, position: number, duration: number) {
  if (!getToken()) return;
  fetch(getServer() + '/api/progress', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ fileId, position, duration }),
  }).catch(() => {});
}

export default function Watch() {
  const { fileId } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [play, setPlay] = useState<Play | null>(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [nearEnd, setNearEnd] = useState(false);
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const playRef = useRef<Play | null>(null);
  // Quando il <video> esce dalla pagina: salva il punto raggiunto e chiude davvero il flusso di rete
  // (altrimenti il browser lascia la connessione aperta e le richieste successive possono bloccarsi).
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    const old = videoEl.current;
    if (!el && old) {
      try {
        const p = playRef.current;
        if (p && old.duration) saveProgress(p.fileId, old.currentTime, old.duration);
        old.pause();
        old.removeAttribute('src');
        old.load();
      } catch { /* gia' rimosso */ }
    }
    videoEl.current = el;
  }, []);
  const lastSave = useRef(0);
  const hideTimer = useRef<number>();

  // Pila di navigazione: si torna alla schermata da cui si e' partiti; se la pagina e' stata aperta
  // direttamente (nessuna cronologia) si ripiega sul dettaglio del titolo.
  const back = useCallback(() => {
    if (loc.key !== 'default') nav(-1);
    else nav(play ? `/title/${play.titleId}` : '/', { replace: true });
  }, [play, nav, loc.key]);
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    setPlay(null); setError(''); setFailed(false); setNearEnd(false);
    api<Play>(`/play/${fileId}`).then(setPlay).catch((e) => setError(e.message));
  }, [fileId]);

  playRef.current = play;
  const streamUrl = play ? absolute(play.streamPath) : '';

  // App Android: lettore nativo libVLC (tutti i formati, decodifica sul telefono).
  useEffect(() => {
    if (!play || !isNative) return;
    let cancelled = false;
    VlcPlayer.play({ url: streamUrl, title: play.title, position: play.position })
      .then((r) => {
        if (cancelled) return;
        if (r.duration > 0) saveProgress(play.fileId, r.position, r.duration);
        const done = r.duration > 0 && (r.position / r.duration > 0.92 || r.duration - r.position < 90);
        if (done && play.nextFileId) nav(`/watch/${play.nextFileId}`, { replace: true });
        else backRef.current();
      })
      .catch((e) => !cancelled && setError(e?.message || 'Impossibile avviare il lettore'));
    return () => { cancelled = true; };
  }, [play, streamUrl, nav]);

  // Salvataggio al volo del progresso (web)
  useEffect(() => {
    const onHide = () => {
      const v = videoEl.current;
      if (play && v && v.duration) saveProgress(play.fileId, v.currentTime, v.duration);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [play]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);

  const poke = () => {
    setUiVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiVisible(false), 3000);
  };
  useEffect(() => { poke(); return () => window.clearTimeout(hideTimer.current); }, []);

  if (error) return <div className="player-msg"><p>{error}</p><button className="btn secondary" onClick={() => nav(-1)}>Indietro</button></div>;
  if (!play) return <div className="player-msg"><p>Caricamento…</p></div>;
  if (isNative) return <div className="player-msg"><p>Apertura del lettore…</p></div>;

  const unsupported = failed || BROWSER_UNSUPPORTED.has(play.ext);

  if (unsupported) {
    return (
      <div className="player-msg">
        <h2>{play.title}</h2>
        <p>
          Il browser non riesce a riprodurre questo file (<b>.{play.ext}</b>).
          Aprilo con VLC, che legge qualsiasi formato, oppure usa l'app Android di MyVideo.
        </p>
        <div className="hero-actions center">
          <a className="btn primary" href={`vlc://${streamUrl}`}>Apri in VLC</a>
          <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(streamUrl)}>Copia indirizzo</button>
          <a className="btn secondary" href={streamUrl} download={play.name}>Scarica</a>
          <button className="btn secondary" onClick={back}>Indietro</button>
        </div>
        <p className="muted small">In VLC: Media → Apri flusso di rete → incolla l'indirizzo.</p>
      </div>
    );
  }

  return (
    <div className="player" onMouseMove={poke} onTouchStart={poke}>
      <video
        ref={setVideo}
        src={streamUrl}
        controls
        autoPlay
        playsInline
        onLoadedMetadata={(e) => { if (play.position > 5) e.currentTarget.currentTime = play.position; }}
        onError={() => setFailed(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration && v.duration - v.currentTime < 25) setNearEnd(true); else setNearEnd(false);
          if (Date.now() - lastSave.current > 10000 && v.duration) {
            lastSave.current = Date.now();
            saveProgress(play.fileId, v.currentTime, v.duration);
          }
        }}
        onPause={(e) => { const v = e.currentTarget; if (v.duration) saveProgress(play.fileId, v.currentTime, v.duration); }}
        onEnded={(e) => {
          const v = e.currentTarget;
          saveProgress(play.fileId, v.duration, v.duration);
          if (play.nextFileId) nav(`/watch/${play.nextFileId}`, { replace: true });
          else back();
        }}
      />
      <div className={'player-top' + (uiVisible ? '' : ' hidden')}>
        <button className="icon-btn" onClick={back} aria-label="Indietro">←</button>
        <span>{play.title}</span>
      </div>
      {nearEnd && play.nextFileId && (
        <button className="btn secondary next-ep" onClick={() => nav(`/watch/${play.nextFileId}`, { replace: true })}>Prossimo episodio ▶</button>
      )}
    </div>
  );
}
