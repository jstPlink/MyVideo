import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface U { id: number; email: string; role: string; status: string; created_at: number }
interface Lib {
  scan: { running: boolean; startedAt: number | null; finishedAt: number | null; files: number; titles: number; error: string | null };
  metadataRunning: boolean;
  tmdbConfigured: boolean;
  counts: { movies: number; series: number; files: number; withMetadata: number; withoutMetadata: number; pending: number };
  overrides: { path: string; mode: string }[];
  folders: { folder: string; kind: string; titles: number }[];
}

interface Saga { id: number; name: string; episodes: number; maxEpisode: number | null; text: string; source: string | null; presetAvailable: boolean }

function SagaEditor() {
  const [list, setList] = useState<Saga[]>([]);
  const [id, setId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback((keep?: number | null) => {
    api<{ series: Saga[] }>('/admin/sagas').then((r) => {
      setList(r.series);
      const cur = r.series.find((s) => s.id === (keep ?? id)) || r.series[0];
      if (cur) { setId(cur.id); setText(cur.text); }
    });
  }, [id]);
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = list.find((s) => s.id === id);
  const pick = (v: number) => { setId(v); setText(list.find((s) => s.id === v)?.text || ''); setMsg(''); };
  const save = async () => {
    await api(`/admin/sagas/${id}`, { method: 'PUT', body: { text } });
    setMsg('Salvato.');
    load(id);
  };
  const reset = async () => {
    await api(`/admin/sagas/${id}`, { method: 'DELETE' });
    setMsg('Ripristinato.');
    load(id);
  };

  if (!list.length) return <p className="muted">Nessuna serie in libreria.</p>;
  return (
    <>
      <select value={id ?? ''} onChange={(e) => pick(Number(e.target.value))}>
        {list.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.episodes} ep.)</option>)}
      </select>
      <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={['1 Saga dei Saiyan', '19 Saga di Freezer', '55 Saga degli Androidi'].join(String.fromCharCode(10))} spellCheck={false} />
      <p className="muted small">
        Una riga per saga: <b>numero del primo episodio</b> e nome. Ogni saga dura fino alla successiva
        {cur?.maxEpisode ? ` (questa serie arriva all'episodio ${cur.maxEpisode})` : ''}. Campo vuoto = una sola stagione.
        {cur?.source === 'preset' && ' Regole predefinite in uso.'}
      </p>
      <div className="row-actions">
        <button className="btn primary" onClick={save}>Salva</button>
        {cur?.presetAvailable && <button className="btn" onClick={reset}>Ripristina predefinite</button>}
        {msg && <span className="muted">{msg}</span>}
      </div>
    </>
  );
}

interface Group { path: string; name: string; merged: boolean; order: string[] }

const NL = String.fromCharCode(10);

function GroupEditor() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { api<{ groups: Group[] }>('/admin/groups').then((r) => setGroups(r.groups)); }, []);
  useEffect(load, [load]);

  const save = async (g: Group, merge: boolean, text: string) => {
    const order = text.split(NL).map((x) => x.trim()).filter(Boolean);
    await api('/admin/groups', { method: 'PUT', body: { path: g.path, merge, order } });
    setMsg('Salvato: riscansione in corso, fra qualche secondo vedrai il risultato.');
    setTimeout(load, 2500);
  };

  if (!groups.length) return <p className="muted">Nessuna cartella con più serie al suo interno.</p>;
  return (
    <>
      {msg && <div className="notice ok" onClick={() => setMsg('')}>{msg}</div>}
      {groups.map((g) => <GroupRow key={g.path + g.merged} g={g} onSave={save} />)}
    </>
  );
}

function GroupRow({ g, onSave }: { g: Group; onSave: (g: Group, merge: boolean, text: string) => void }) {
  const [text, setText] = useState(g.order.join(NL));
  return (
    <div className="panel" style={{ background: '#262626' }}>
      <h2>{g.name} <span className={'badge ' + (g.merged ? 'active' : '')}>{g.merged ? 'serie unica' : 'serie separate'}</span></h2>
      <p className="muted small">Ogni sottocartella diventa una stagione. Scrivi i nomi nell'ordine in cui vuoi le stagioni (una riga ciascuna).</p>
      <textarea rows={Math.min(8, Math.max(3, g.order.length + 1))} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="row-actions">
        <button className="btn primary" onClick={() => onSave(g, true, text)}>{g.merged ? 'Salva ordine' : 'Unisci in una serie'}</button>
        {g.merged && <button className="btn" onClick={() => onSave(g, false, text)}>Separa di nuovo</button>}
      </div>
    </div>
  );
}

interface Hit { id: number; title: string; original: string; year: number | null; poster: string | null }
interface Found { id: number; kind: 'movie' | 'series'; name: string; year: number | null; poster: string | null }

function MetaFixer() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [sel, setSel] = useState<Found | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState('');

  const search = async () => {
    const r = await api<{ items: Found[] }>(`/titles?q=${encodeURIComponent(q)}`);
    setFound(r.items.slice(0, 30));
  };
  const choose = (t: Found) => { setSel(t); setQuery(t.name); setHits(null); setMsg(''); };
  const tmdbSearch = async () => {
    if (!sel) return;
    try {
      const r = await api<{ results: Hit[] }>(`/admin/tmdb/search?kind=${sel.kind}&q=${encodeURIComponent(query)}`);
      setHits(r.results);
    } catch (e: any) { setMsg(e.message); }
  };
  const use = async (h: Hit) => {
    if (!sel) return;
    try {
      await api(`/admin/titles/${sel.id}/tmdb`, { method: 'PUT', body: { tmdbId: h.id } });
      setMsg(`"${sel.name}" ora usa "${h.title}" (TMDB ${h.id}).`);
      setHits(null);
    } catch (e: any) { setMsg(e.message); }
  };
  const auto = async () => {
    if (!sel) return;
    await api(`/admin/titles/${sel.id}/tmdb`, { method: 'DELETE' });
    setMsg('Blocco rimosso: riprovo la ricerca automatica.');
  };

  return (
    <>
      <div className="row-actions">
        <input placeholder="Titolo in libreria (es. Dragon Ball)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn" onClick={search}>Cerca</button>
      </div>
      {found.length > 0 && !sel && (
        <div className="row-actions">
          {found.map((t) => <button key={t.id} className="btn mini" onClick={() => choose(t)}>{t.name}{t.kind === 'series' ? ' (serie)' : ''}</button>)}
        </div>
      )}
      {sel && (
        <>
          <p className="muted">Titolo scelto: <b>{sel.name}</b> · <a href="#" onClick={(e) => { e.preventDefault(); setSel(null); setHits(null); }}>cambia</a></p>
          <div className="row-actions">
            <input placeholder="Cerca su TMDB" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tmdbSearch()} />
            <button className="btn primary" onClick={tmdbSearch}>Cerca su TMDB</button>
            <button className="btn" onClick={auto}>Torna all'automatico</button>
          </div>
          {hits && (hits.length ? (
            <div className="tmdb-results">
              {hits.map((h) => (
                <button key={h.id} className="tmdb-result" onClick={() => use(h)}>
                  {h.poster ? <img src={`https://image.tmdb.org/t/p/w185${h.poster}`} alt="" /> : <img alt="" />}
                  <b>{h.title}</b>
                  <span>{h.year || '—'} · TMDB {h.id}</span>
                </button>
              ))}
            </div>
          ) : <p className="muted">Nessun risultato.</p>)}
        </>
      )}
      {msg && <div className="notice ok" onClick={() => setMsg('')}>{msg}</div>}
    </>
  );
}

const statusLabel: Record<string, string> = { active: 'Attivo', pending: 'In attesa', disabled: 'Disabilitato' };

export default function Admin() {
  const [users, setUsers] = useState<U[]>([]);
  const [lib, setLib] = useState<Lib | null>(null);
  const [tmdb, setTmdb] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api<{ users: U[] }>('/admin/users').then((r) => setUsers(r.users));
    api<Lib>('/admin/library').then(setLib);
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!lib?.scan.running && !lib?.metadataRunning) return;
    const t = setInterval(() => api<Lib>('/admin/library').then(setLib), 2500);
    return () => clearInterval(t);
  }, [lib?.scan.running, lib?.metadataRunning]);

  const patch = async (id: number, body: object) => { await api(`/admin/users/${id}`, { method: 'PATCH', body }); load(); };
  const reset = async (u: U) => {
    if (!confirm(`Generare una password temporanea per ${u.email}?`)) return;
    const r = await api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} });
    setNote(`Password temporanea per ${u.email}: ${r.temporaryPassword}`);
  };
  const del = async (u: U) => {
    if (!confirm(`Eliminare ${u.email}? L'operazione non si puo' annullare.`)) return;
    await api(`/admin/users/${u.id}`, { method: 'DELETE' });
    load();
  };
  const scan = async () => { await api('/admin/scan', { method: 'POST', body: {} }); setTimeout(load, 500); };
  const saveTmdb = async () => { await api('/admin/settings', { method: 'PUT', body: { tmdbKey: tmdb } }); setTmdb(''); setNote('Chiave TMDB salvata, recupero i metadati…'); setTimeout(load, 800); };
  const retry = async () => { await api('/admin/metadata/retry', { method: 'POST', body: {} }); setTimeout(load, 800); };
  const setOverride = async (path: string, mode: string | null) => {
    await api('/admin/overrides', { method: 'PUT', body: { path, mode } });
    setNote('Regola salvata, riscansione in corso…');
    setTimeout(load, 800);
  };

  const overrideOf = (folder: string) => lib?.overrides.find((o) => o.path === folder)?.mode || '';

  return (
    <main className="narrow wide">
      <h1>Amministrazione</h1>
      {note && <div className="notice ok" onClick={() => setNote('')}>{note}</div>}

      <section className="panel">
        <h2>Utenti</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Email</th><th>Ruolo</th><th>Stato</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.role === 'admin' ? 'Admin' : 'Utente'}</td>
                  <td><span className={'badge ' + u.status}>{statusLabel[u.status] || u.status}</span></td>
                  <td className="actions">
                    {u.status !== 'active' && <button className="btn mini primary" onClick={() => patch(u.id, { status: 'active' })}>Approva</button>}
                    {u.status === 'active' && <button className="btn mini" onClick={() => patch(u.id, { status: 'disabled' })}>Disabilita</button>}
                    <button className="btn mini" onClick={() => patch(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? 'Rendi utente' : 'Rendi admin'}</button>
                    <button className="btn mini" onClick={() => reset(u)}>Reset password</button>
                    <button className="btn mini danger" onClick={() => del(u)}>Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Libreria</h2>
        {lib && (
          <>
            <p className="muted">
              {lib.counts.movies} film · {lib.counts.series} serie · {lib.counts.files} file video ·
              metadati: {lib.counts.withMetadata} trovati, {lib.counts.withoutMetadata} senza corrispondenza, {lib.counts.pending} in attesa
            </p>
            {lib.scan.error && <div className="notice err">{lib.scan.error}</div>}
            <div className="row-actions">
              <button className="btn primary" disabled={lib.scan.running} onClick={scan}>
                {lib.scan.running ? `Scansione… (${lib.scan.files} file)` : 'Riscansiona Seafile'}
              </button>
              {lib.metadataRunning && <span className="muted">Recupero metadati in corso…</span>}
              {lib.counts.withoutMetadata > 0 && lib.tmdbConfigured && <button className="btn" onClick={retry}>Riprova metadati mancanti</button>}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>TMDB (locandine e trame)</h2>
        <p className="muted">{lib?.tmdbConfigured ? 'Chiave configurata.' : 'Nessuna chiave: le locandine non sono disponibili.'} Crea una chiave gratuita su themoviedb.org (Impostazioni → API).</p>
        <div className="row-actions">
          <input type="password" placeholder="API key o Read Access Token" value={tmdb} onChange={(e) => setTmdb(e.target.value)} />
          <button className="btn primary" disabled={!tmdb} onClick={saveTmdb}>Salva</button>
        </div>
      </section>

      <section className="panel">
        <h2>Saghe / stagioni delle serie</h2>
        <p className="muted">Per le serie con numerazione continua (es. Dragon Ball, episodi 1-159) puoi dividere gli episodi in saghe o stagioni. Per Dragon Ball, Kai, Super e GT sono gia' impostate.</p>
        <SagaEditor />
      </section>

      <section className="panel">
        <h2>Serie unica con stagioni</h2>
        <p className="muted">Per cartelle che contengono più serie o stagioni separate (es. <i>A tutto reality</i>): le unisce in una sola serie, con ogni sottocartella come stagione.</p>
        <GroupEditor />
      </section>

      <section className="panel">
        <h2>Locandine e metadati: correggi l'abbinamento</h2>
        <p className="muted">Se un titolo ha la locandina sbagliata o manca, cercalo qui e scegli la scheda giusta su TMDB. La scelta resta fissa anche dopo le riscansioni.</p>
        <MetaFixer />
      </section>

      <section className="panel">
        <h2>Cartelle: forza il tipo</h2>
        <p className="muted">Se una cartella e' stata riconosciuta male (episodi mostrati come film o viceversa) forza qui il tipo. La libreria viene riscansionata.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cartella</th><th>Rilevato</th><th>Forza</th></tr></thead>
            <tbody>
              {lib?.folders.map((f) => (
                <tr key={f.folder + f.kind}>
                  <td>{f.folder}</td>
                  <td>{f.titles} {f.kind === 'series' ? (f.titles === 1 ? 'serie' : 'serie') : 'film'}</td>
                  <td>
                    <select value={overrideOf(f.folder)} onChange={(e) => setOverride(f.folder, e.target.value || null)}>
                      <option value="">Automatico</option>
                      <option value="series">Serie (episodi)</option>
                      <option value="movies">Film singoli</option>
                      <option value="ignore">Ignora</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
