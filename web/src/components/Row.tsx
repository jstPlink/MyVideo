import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { backdrop, poster, type Card, type Row as RowT } from '../api';

export function CardView({ c, wide }: { c: Card; wide?: boolean }) {
  const img = wide ? backdrop(c.backdrop, 'w500') || poster(c.poster, 'w342') : poster(c.poster);
  const to = wide && c.resume ? `/watch/${c.resume.fileId}` : `/title/${c.id}`;
  return (
    <Link to={to} className={'card' + (wide ? ' wide' : '')} title={c.name}>
      {img ? (
        <img src={img} alt={c.name} loading="lazy" />
      ) : (
        <div className="ph"><span>{c.name}</span></div>
      )}
      {wide && (
        <div className="card-info">
          <div className="card-name">{c.name}</div>
          {c.resume?.label && <div className="card-sub">{c.resume.label}</div>}
          <div className="progress"><i style={{ width: `${c.percent || 0}%` }} /></div>
        </div>
      )}
    </Link>
  );
}

export default function Row({ row }: { row: RowT }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  return (
    <section className="row">
      <h2>{row.title}</h2>
      <div className="row-wrap">
        <button className="arrow left" onClick={() => scroll(-1)} aria-label="Indietro">‹</button>
        <div className="row-scroll" ref={scroller}>
          {row.items.map((c) => <CardView key={c.id} c={c} wide={row.variant === 'wide'} />)}
        </div>
        <button className="arrow right" onClick={() => scroll(1)} aria-label="Avanti">›</button>
      </div>
    </section>
  );
}
