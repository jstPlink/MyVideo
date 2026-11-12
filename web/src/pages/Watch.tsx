import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { absolute, api, getServer, getToken, isNative } from '../api';
import { VlcPlayer } from '../native';
import { WatchTracker, newSessionId, sendWatch } from '../watch';
import PlayerControls, { type Episode } from '../components/PlayerControls';

interface Desktop { isDesktop: boolean; openInVlc: (url: string) => Promise<{ ok: boolean; error?: string }> }
const desktop: Desktop | undefined = (window as unknown as { myvideoDesktop?: Desktop }).myvideoDesktop;

interface Play {
  fileId: number; titleId: number; ext: string; name: string; kind: string; title: string;
  streamPath: string; position: number; nextFileId: number | null; prevFileId: number | null;
  seriesTitle: string | null; episodes: Episode[];
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
  const [vlcMsg, setVlcMsg] = useState('');
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const trackerRef = useRef<WatchTracker | null>(null);
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
  const playerRef = useRef<HTMLDivElement>(null);

  // Pila di navigazione: si torna alla schermata da cui si e' partiti; se la pagina e' stata aperta
  // direttamente (nessuna cronologia) si ripiega sul dettaglio del titolo.
  const back = useCallback(() => {
    if (loc.key !== 'default') nav(-1);
    else nav(play ? `/title/${play.titleId}` : '/', { replace: true });
  }, [play, nav, loc.key]);
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    setPlay(null); setError(''); setFailed(false);
    api<Play>(`/play/${fileId}`).then(setPlay).catch((e) => setError(e.message));
  }, [fileId]);

  playRef.current = play;
  const streamUrl = play ? absolute(play.streamPath) : '';

  // App Android: lettore nativo libVLC (tutti i formati, decodifica sul telefono).
  // IMPORTANTE: l'effetto dipende solo da `play`. Se dipendesse da `nav` (che cambia a ogni navigazione)
  // il lettore verrebbe riaperto per l'episodio precedente a ogni passaggio, impilando piu' player.
  const navRef = useRef(nav);
  navRef.current = nav;
  const launched = useRef<number | null>(null);
  useEffect(() => {
    if (!play || !isNative) return;
    if (launched.current === play.fileId) return;
    launched.current = play.fileId;
    const episodesJson = JSON.stringify((play.episodes || []).map((e) => ({ id: e.id, season: e.season, episode: e.episode, title: e.title, seasonName: e.seasonName })));
    VlcPlayer.play({
      url: streamUrl, title: play.title, position: play.position,
      hasNext: !!play.nextFileId, hasPrev: !!play.prevFileId,
      currentId: play.fileId, seriesTitle: play.seriesTitle || '', episodes: episodesJson,
    })
      .then((r) => {
        // statistiche: tempo realmente guardato nel lettore nativo
        if (r.watched && r.watched >= 3) {
          sendWatch({
            sessionId: newSessionId(), fileId: play.fileId,
            startedAt: r.startedAt || Date.now() - r.watched * 1000, endedAt: r.endedAt || Date.now(), seconds: r.watched,
          });
        }
        if (r.duration > 0) saveProgress(play.fileId, r.position, r.duration);
        const done = r.duration > 0 && (r.position / r.duration > 0.92 || r.duration - r.position < 90);
        const go = (id: number) => navRef.current(`/watch/${id}`, { replace: true });
        if (r.goto) go(r.goto);
        else if (r.prev && play.prevFileId) go(play.prevFileId);
        else if ((done || r.next) && play.nextFileId) go(play.nextFileId);
        else backRef.current();
      })
      .catch((e) => setError(e?.message || 'Impossibile avviare il lettore'));
  }, [play, streamUrl]);

  // Salvataggio al volo del progresso (web)
  useEffect(() => {
    const onHide = () => {
      const v = videoEl.current;
      if (play && v && v.duration) saveProgress(play.fileId, v.currentTime, v.duration);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [play]);

  // Statistiche (web/desktop): conta i secondi di riproduzione e li invia al server
  useEffect(() => {
    if (!play || isNative) return;
    const tracker = new WatchTracker(play.fileId);
    trackerRef.current = tracker;
    const id = window.setInterval(() => {
      const v = videoEl.current;
      tracker.tick(!!v && !v.paused && !v.ended && v.readyState > 2);
    }, 1000);
    const onHide = () => tracker.flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', onHide);
      tracker.flush();
      trackerRef.current = null;
    };
  }, [play]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);

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
          {desktop ? (
            <button className="btn primary" onClick={async () => { const r = await desktop.openInVlc(streamUrl); setVlcMsg(r.ok ? 'Aperto in VLC.' : r.error || 'Impossibile aprire VLC'); }}>Apri in VLC</button>
          ) : (
            <a className="btn primary" href={`vlc://${streamUrl}`}>Apri in VLC</a>
          )}
          <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(streamUrl)}>Copia indirizzo</button>
          <a className="btn secondary" href={streamUrl} download={play.name}>Scarica</a>
          <button className="btn secondary" onClick={back}>Indietro</button>
        </div>
        {vlcMsg && <p className="muted">{vlcMsg}</p>}
        <p className="muted small">In VLC: Media → Apri flusso di rete → incolla l'indirizzo.</p>
      </div>
    );
  }

  const gotoFile = (id: number) => nav(`/watch/${id}`, { replace: true });

  return (
    <div className="player" ref={playerRef}>
      <video
        ref={setVideo}
        src={streamUrl}
        autoPlay
        playsInline
        onLoadedMetadata={(e) => { if (play.position > 5) e.currentTarget.currentTime = play.position; }}
        onError={() => setFailed(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (Date.now() - lastSave.current > 10000 && v.duration) {
            lastSave.current = Date.now();
            saveProgress(play.fileId, v.currentTime, v.duration);
          }
        }}
        onPause={(e) => { const v = e.currentTarget; trackerRef.current?.flush(); if (v.duration) saveProgress(play.fileId, v.currentTime, v.duration); }}
        onEnded={(e) => {
          const v = e.currentTarget;
          saveProgress(play.fileId, v.duration, v.duration);
          if (play.nextFileId) gotoFile(play.nextFileId);
          else back();
        }}
      />
      <PlayerControls
        videoRef={videoEl}
        containerRef={playerRef}
        title={play.title}
        seriesTitle={play.seriesTitle}
        currentId={play.fileId}
        episodes={play.episodes || []}
        hasNext={!!play.nextFileId}
        onBack={back}
        onNext={() => play.nextFileId && gotoFile(play.nextFileId)}
        onGoto={gotoFile}
      />
    </div>
  );
}
