import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, backdrop, poster, type Card, type Row as RowT } from '../api';
import Row from '../components/Row';
import ErrorBox from '../components/ErrorBox';

interface HomeData { hero: Card | null; rows: RowT[]; empty: boolean }

export default function Home() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    api<HomeData>('/home').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <div className="page-msg">Caricamento…</div>;
  if (data.empty) {
    return (
      <div className="page-msg">
        <h2>La libreria e' vuota</h2>
        <p>La scansione di Seafile potrebbe essere ancora in corso. Un amministratore puo' controllarla da Amministrazione.</p>
      </div>
    );
  }

  const h = data.hero;
  const bg = h && (backdrop(h.backdrop) || poster(h.poster, 'w780'));
  return (
    <main>
      {h && (
        <section className="hero" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
          <div className="hero-fade" />
          <div className="hero-body">
            <h1>{h.name}</h1>
            {h.overview && <p className="hero-text">{h.overview}</p>}
            <div className="hero-actions">
              {h.resume && (
                <button className="btn primary" onClick={() => nav(`/watch/${h.resume!.fileId}`)}>
                  ▶ {h.resume.position > 15 ? 'Riprendi' : 'Riproduci'}
                </button>
              )}
              <Link className="btn secondary" to={`/title/${h.id}`}>ⓘ Altre info</Link>
            </div>
          </div>
        </section>
      )}
      <div className={'rows' + (h ? ' over-hero' : '')}>
        {data.rows.map((r) => <Row key={r.id} row={r} />)}
      </div>
    </main>
  );
}
