import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent, type RefObject } from 'react';

export interface Episode { id: number; season: number; episode: number | null; title: string | null; seasonName: string }

interface Props {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  containerRef: RefObject<HTMLDivElement>;
  title: string;
  seriesTitle: string | null;
  currentId: number;
  episodes: Episode[];
  hasNext: boolean;
  onBack: () => void;
  onNext: () => void;
  onGoto: (id: number) => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_AFTER = 3000;
/** Il pulsante "Prossimo episodio" compare quando manca meno di questa frazione della durata (8%). */
export const NEXT_BUTTON_FRACTION = 0.08;

function fmt(s: number): string {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function Svg({ d, size = 30, children }: { d?: string; size?: number; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {d && <path d={d} />}
      {children}
    </svg>
  );
}

const P = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  volHigh: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volLow: 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z',
  muted: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  full: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  exitFull: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  episodes: 'M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z',
  turn: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
};

/** Controlli del lettore in stile Netflix (web e app desktop): barra rossa, +-10 s, volume, episodi, velocita', schermo intero. */
export default function PlayerControls({ videoRef, containerRef, title, seriesTitle, currentId, episodes, hasNext, onBack, onNext, onGoto }: Props) {
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buf, setBuf] = useState(0);
  const [vol, setVol] = useState(() => { try { return Number(localStorage.getItem('mv_volume') ?? 1); } catch { return 1; } });
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('mv_muted') === '1'; } catch { return false; } });
  const [rate, setRate] = useState(1);
  const [waiting, setWaiting] = useState(true);
  const [active, setActive] = useState(true);
  const [full, setFull] = useState(false);
  const [menu, setMenu] = useState<null | 'speed' | 'episodes'>(null);
  const [hover, setHover] = useState<null | { x: number; t: number }>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [volOpen, setVolOpen] = useState(false);
  const [epSeason, setEpSeason] = useState<number>(() => episodes.find((e) => e.id === currentId)?.season ?? episodes[0]?.season ?? 1);
  const hideTimer = useRef<number>();
  const clickTimer = useRef<number>();
  const barRef = useRef<HTMLDivElement>(null);
  // schermo touch (telefono/tablet): il tocco mostra o nasconde i comandi, come l'app Netflix; la pausa si fa col pulsante
  const coarse = useMemo(() => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches, []);

  const poke = useCallback(() => {
    setActive(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setActive(false), HIDE_AFTER);
  }, []);

  // sincronizza lo stato con il <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, vol));
    v.muted = muted;
    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      setCur(v.currentTime);
      setDur(Number.isFinite(v.duration) ? v.duration : 0);
      setRate(v.playbackRate);
      if (v.buffered.length) {
        let end = 0;
        for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5) end = Math.max(end, v.buffered.end(i));
        setBuf(end);
      }
    };
    const onWait = () => setWaiting(true);
    const onOk = () => setWaiting(false);
    const evs = ['play', 'pause', 'timeupdate', 'durationchange', 'progress', 'ratechange', 'loadedmetadata', 'seeked', 'ended'];
    evs.forEach((e) => v.addEventListener(e, sync));
    ['waiting', 'seeking', 'loadstart'].forEach((e) => v.addEventListener(e, onWait));
    ['playing', 'canplay', 'seeked'].forEach((e) => v.addEventListener(e, onOk));
    sync();
    return () => {
      evs.forEach((e) => v.removeEventListener(e, sync));
      ['waiting', 'seeking', 'loadstart'].forEach((e) => v.removeEventListener(e, onWait));
      ['playing', 'canplay', 'seeked'].forEach((e) => v.removeEventListener(e, onOk));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  // volume (ricordato tra una visione e l'altra)
  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = Math.max(0, Math.min(1, vol)); v.muted = muted; }
    try { localStorage.setItem('mv_volume', String(vol)); localStorage.setItem('mv_muted', muted ? '1' : '0'); } catch { /* ignora */ }
  }, [vol, muted, videoRef]);

  // attivita' del mouse -> comandi visibili; cursore nascosto a comandi nascosti
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    poke();
    if (coarse) return () => window.clearTimeout(hideTimer.current);
    const on = () => poke();
    c.addEventListener('mousemove', on);
    return () => { c.removeEventListener('mousemove', on); window.clearTimeout(hideTimer.current); };
  }, [containerRef, poke, coarse]);

  const visible = !playing || active || !!menu || scrub !== null || volOpen;
  useEffect(() => { containerRef.current?.classList.toggle('nocursor', !visible); }, [visible, containerRef]);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, [videoRef]);

  const seekBy = useCallback((d: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + d));
  }, [videoRef]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current?.requestFullscreen?.().catch(() => {});
  }, [containerRef]);

  const changeVol = useCallback((d: number) => {
    setMuted(false);
    setVol((x) => Math.max(0, Math.min(1, Math.round((x + d) * 100) / 100)));
  }, []);

  // scorciatoie da tastiera (come Netflix)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'range') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      const k = e.key;
      if (k === ' ' || k === 'k' || k === 'K') toggle();
      else if (k === 'ArrowLeft' || k === 'j' || k === 'J') seekBy(-10);
      else if (k === 'ArrowRight' || k === 'l' || k === 'L') seekBy(10);
      else if (k === 'ArrowUp') changeVol(0.1);
      else if (k === 'ArrowDown') changeVol(-0.1);
      else if (k === 'm' || k === 'M') setMuted((x) => !x);
      else if (k === 'f' || k === 'F') toggleFull();
      else if ((k === 'N' || k === 'n') && e.shiftKey && hasNext) onNext();
      else if (/^[0-9]$/.test(k)) { const v = videoRef.current; if (v && v.duration) v.currentTime = (Number(k) / 10) * v.duration; }
      else handled = false;
      if (handled) { e.preventDefault(); poke(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seekBy, changeVol, toggleFull, poke, hasNext, onNext, videoRef]);

  // barra di avanzamento
  const frac = (e: { clientX: number }) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const onBarMove = (e: RPointerEvent<HTMLDivElement>) => {
    const f = frac(e);
    setHover({ x: f * 100, t: f * dur });
    if (scrub !== null) setScrub(f * dur);
  };
  const onBarDown = (e: RPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setScrub(frac(e) * dur);
  };
  const onBarUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (scrub === null) return;
    const v = videoRef.current;
    const t = frac(e) * dur;
    if (v) v.currentTime = t;
    setCur(t);
    setScrub(null);
  };

  const shown = scrub ?? cur;
  const pct = dur ? (shown / dur) * 100 : 0;
  const bufPct = dur ? (buf / dur) * 100 : 0;

  const seasons = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of episodes) if (!m.has(e.season)) m.set(e.season, e.seasonName);
    return [...m.entries()];
  }, [episodes]);

  const setPlaybackRate = (r: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
    setRate(r);
    setMenu(null);
  };

  const onSurfaceClick = () => {
    if (menu) { setMenu(null); return; }
    if (coarse) {
      // tocco: mostra i comandi (si nascondono da soli) oppure li nasconde; non mette in pausa
      if (visible && playing) { setActive(false); window.clearTimeout(hideTimer.current); } else poke();
      return;
    }
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(toggle, 220);
  };
  const onSurfaceDouble = () => {
    if (coarse) return;
    window.clearTimeout(clickTimer.current);
    toggleFull();
  };

  const volIcon = muted || vol === 0 ? P.muted : vol < 0.5 ? P.volLow : P.volHigh;
  const nearEnd = hasNext && dur > 0 && dur - cur > 0 && dur - cur <= dur * NEXT_BUTTON_FRACTION;

  return (
    <div className={'nf' + (visible ? ' show' : '')}>
      <div className="nf-surface" onClick={onSurfaceClick} onDoubleClick={onSurfaceDouble} />

      <div className="nf-top">
        <button className="nf-btn" onClick={onBack} aria-label="Indietro"><Svg d={P.back} size={34} /></button>
        <div className="nf-heading">
          {seriesTitle ? <><strong>{seriesTitle}</strong><span>{title.replace(seriesTitle, '').trim()}</span></> : <strong>{title}</strong>}
        </div>
      </div>

      {waiting && <div className="nf-spinner" aria-label="Caricamento" />}

      {!playing && !waiting && (
        <button className="nf-bigplay" onClick={toggle} aria-label="Riproduci"><Svg d={P.play} size={72} /></button>
      )}

      {nearEnd && (
        <button className="nf-next" onClick={onNext}><Svg d={P.next} size={26} /> Prossimo episodio</button>
      )}

      <div className="nf-bottom">
        <div className="nf-progress-row">
          <div
            className="nf-bar"
            ref={barRef}
            onPointerMove={onBarMove}
            onPointerLeave={() => setHover(null)}
            onPointerDown={onBarDown}
            onPointerUp={onBarUp}
            role="slider"
            aria-label="Avanzamento"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(shown)}
          >
            <div className="nf-track">
              <i className="nf-buf" style={{ width: `${bufPct}%` }} />
              <i className="nf-played" style={{ width: `${pct}%` }} />
            </div>
            <span className="nf-thumb" style={{ left: `${pct}%` }} />
            {hover && <span className="nf-tip" style={{ left: `${hover.x}%` }}>{fmt(hover.t)}</span>}
          </div>
          <span className="nf-remaining">{fmt(Math.max(0, dur - shown))}</span>
        </div>

        <div className="nf-row">
          <div className="nf-left">
            <button className="nf-btn" onClick={toggle} aria-label={playing ? 'Pausa' : 'Riproduci'}><Svg d={playing ? P.pause : P.play} size={38} /></button>
            <button className="nf-btn" onClick={() => seekBy(-10)} aria-label="Indietro di 10 secondi">
              <Svg size={34}><path d={P.turn} /><text x="12" y="15.2" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="#141414">10</text></Svg>
            </button>
            <button className="nf-btn" onClick={() => seekBy(10)} aria-label="Avanti di 10 secondi">
              <Svg size={34}><g transform="translate(24 0) scale(-1 1)"><path d={P.turn} /></g><text x="12" y="15.2" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="#141414">10</text></Svg>
            </button>
            <div className="nf-vol" onMouseEnter={() => setVolOpen(true)} onMouseLeave={() => setVolOpen(false)}>
              <button className="nf-btn" onClick={() => setMuted((m) => !m)} aria-label="Muto"><Svg d={volIcon} size={32} /></button>
              <input
                className="nf-range"
                type="range" min={0} max={1} step={0.02}
                value={muted ? 0 : vol}
                onChange={(e) => { setMuted(false); setVol(Number(e.target.value)); }}
                style={{ ['--v' as string]: `${(muted ? 0 : vol) * 100}%` }}
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="nf-title">
            {seriesTitle ? <><strong>{seriesTitle}</strong> <span>{title.replace(seriesTitle, '').trim()}</span></> : <strong>{title}</strong>}
          </div>

          <div className="nf-right">
            {hasNext && <button className="nf-btn" onClick={onNext} title="Prossimo episodio" aria-label="Prossimo episodio"><Svg d={P.next} size={34} /></button>}
            {episodes.length > 1 && (
              <button className={'nf-btn' + (menu === 'episodes' ? ' on' : '')} onClick={() => { setEpSeason(episodes.find((e) => e.id === currentId)?.season ?? epSeason); setMenu(menu === 'episodes' ? null : 'episodes'); }} title="Episodi" aria-label="Episodi"><Svg d={P.episodes} size={32} /></button>
            )}
            <button className={'nf-btn nf-speed' + (menu === 'speed' ? ' on' : '')} onClick={() => setMenu(menu === 'speed' ? null : 'speed')} title="Velocità" aria-label="Velocità">{rate === 1 ? '1x' : `${rate}x`}</button>
            <button className="nf-btn" onClick={toggleFull} title="Schermo intero" aria-label="Schermo intero"><Svg d={full ? P.exitFull : P.full} size={34} /></button>
          </div>
        </div>

        {menu === 'speed' && (
          <div className="nf-menu nf-menu-speed">
            <h4>Velocità di riproduzione</h4>
            {RATES.map((r) => (
              <button key={r} className={r === rate ? 'on' : ''} onClick={() => setPlaybackRate(r)}>{r === 1 ? 'Normale' : `${r}x`}</button>
            ))}
          </div>
        )}

        {menu === 'episodes' && (
          <div className="nf-menu nf-menu-eps">
            <div className="nf-eps-head">
              <h4>{seriesTitle || 'Episodi'}</h4>
              {seasons.length > 1 && (
                <select value={epSeason} onChange={(e) => setEpSeason(Number(e.target.value))} aria-label="Stagione">
                  {seasons.map(([n, name]) => <option key={n} value={n}>{name}</option>)}
                </select>
              )}
            </div>
            <ol>
              {episodes.filter((e) => e.season === epSeason).map((e) => (
                <li key={e.id}>
                  <button className={e.id === currentId ? 'on' : ''} onClick={() => { setMenu(null); if (e.id !== currentId) onGoto(e.id); }}>
                    <b>{e.episode ?? '·'}</b>
                    <span>{e.title || `Episodio ${e.episode ?? ''}`}</span>
                    {e.id === currentId && <em>In riproduzione</em>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
