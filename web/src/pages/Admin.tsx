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
