import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, backdrop, poster, type TitleDetail } from '../api';
import Row from '../components/Row';
import ErrorBox from '../components/ErrorBox';

function fmtSize(b: number) {
  return b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';
}

export default function TitlePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [t, setT] = useState<TitleDetail | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setT(null);
    window.scrollTo(0, 0);
    api<TitleDetail>(`/titles/${id}`)
      .then((d) => {
        setT(d);
        const cur = d.files.find((f) => f.id === d.resume?.fileId);
        setSeason(cur?.season ?? d.files[0]?.season ?? null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const seasons = useMemo(() => [...new Set((t?.files || []).map((f) => f.season ?? 1))].sort((a, b) => a - b), [t]);

  if (error) return <ErrorBox message={error} />;
  if (!t) return <div className="page-msg">Caricamento…</div>;

  const bg = backdrop(t.backdrop) || poster(t.poster, 'w780');
  const seasonName = (n: number) => t.seasons.find((x) => x.season === n)?.name || `Stagione ${n}`;
  const eps = t.files.filter((f) => (f.season ?? 1) === (season ?? 1));
  const resumeFile = t.files.find((f) => f.id === t.resume?.fileId);
  const resumeLabel = t.resume && t.resume.position > 15 ? 'Riprendi' : 'Riproduci';

  const toggleList = async () => {
    const r = await api<{ inList: boolean }>(`/mylist/${t.id}`, { method: 'POST', body: {} });
    setT({ ...t, inList: r.inList });
  };

  return (
    <main className="title-page">
      <section className="hero small" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
        <div className="hero-fade" />
        <div className="hero-body">
          <h1>{t.name}</h1>
          <div className="meta">
            {t.rating ? <span className="match">★ {t.rating.toFixed(1)}</span> : null}
            {t.year && <span>{t.year}</span>}
            {t.kind === 'series' && <span>{seasons.length} {seasons.length === 1 ? 'stagione' : 'stagioni'}</span>}
            {t.runtime ? <span>{t.runtime} min</span> : null}
            {t.genres && <span>{t.genres}</span>}
          </div>
          {t.overview && <p className="hero-text">{t.overview}</p>}
          <div className="hero-actions">
            {t.resume?.fileId && (
              <button className="btn primary" onClick={() => nav(`/watch/${t.resume!.fileId}`)}>
                ▶ {resumeLabel}{t.kind === 'series' && resumeFile?.season != null ? ` S${resumeFile.season}:E${resumeFile.episode}` : ''}
              </button>
            )}
            <button className="btn secondary" onClick={toggleList}>{t.inList ? '✓ Nella mia lista' : '＋ La mia lista'}</button>
          </div>
        </div>
      </section>

      {t.kind === 'series' && (
        <section className="episodes">
          <div className="ep-head">
            <h2>Episodi</h2>
            {seasons.length > 1 && (
              <select value={season ?? 1} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Stagione">
                {seasons.map((s) => <option key={s} value={s}>{seasonName(s)}</option>)}
              </select>
            )}
          </div>
          <ol>
            {eps.map((f) => (
              <li key={f.id}>
                <Link to={`/watch/${f.id}`} className="ep">
                  <span className="ep-num">{f.episode}</span>
                  <span className="ep-thumb">
                    {f.still ? <img src={`https://image.tmdb.org/t/p/w300${f.still}`} alt="" loading="lazy" /> : <span className="ph-play">▶</span>}
                    {f.duration > 0 && <span className="progress"><i style={{ width: `${Math.min(100, (f.position / f.duration) * 100)}%` }} /></span>}
                  </span>
                  <span className="ep-text">
                    <strong>{f.title || `Episodio ${f.episode}`}{f.completed ? ' ✓' : ''}</strong>
                    {f.overview && <span className="ep-overview">{f.overview}</span>}
                    <span className="ep-file">{f.ext.toUpperCase()} · {fmtSize(f.size)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {t.kind === 'movie' && t.files[0] && (
        <section className="episodes"><p className="muted small">File: {t.files[0].name} · {t.files[0].ext.toUpperCase()} · {fmtSize(t.files[0].size)}</p></section>
      )}

      {t.related.length > 0 && (
        <div className="rows"><Row row={{ id: 'rel', title: 'Nella stessa raccolta', items: t.related }} /></div>
      )}
    </main>
  );
}
