import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, type Card } from '../api';
import { CardView } from '../components/Row';

export default function Browse({ mode }: { mode?: 'list' | 'search' }) {
  const { kind } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [items, setItems] = useState<Card[] | null>(null);

  useEffect(() => {
    setItems(null);
    if (mode === 'list') api<{ items: Card[] }>('/mylist').then((r) => setItems(r.items));
    else if (mode === 'search') {
      if (!q) { setItems([]); return; }
      api<{ items: Card[] }>(`/titles?q=${encodeURIComponent(q)}`).then((r) => setItems(r.items));
    } else api<{ items: Card[] }>(`/titles?kind=${kind}`).then((r) => setItems(r.items));
  }, [mode, kind, q]);

  const title = mode === 'list' ? 'La mia lista' : mode === 'search' ? (q ? `Risultati per "${q}"` : 'Cerca') : kind === 'series' ? 'Serie TV' : 'Film';

  return (
    <main className="browse">
      <h1>{title}</h1>
      {mode === 'search' && !q && <p className="muted">Usa la casella di ricerca in alto.</p>}
      {items === null ? <p className="muted">Caricamento…</p> : items.length === 0 && (mode !== 'search' || q) ? (
        <p className="muted">{mode === 'list' ? 'Non hai ancora aggiunto nulla alla tua lista.' : 'Nessun risultato.'}</p>
      ) : (
        <div className="grid">{items.map((c) => <CardView key={c.id} c={c} />)}</div>
      )}
    </main>
  );
}
