import { useState } from 'react';
import { api, APP_VERSION, getServer, isNative, setServer, setToken } from '../api';
import { useAuth } from '../auth';

export default function Account() {
  const { user, signOut } = useAuth();
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [server, setServerInput] = useState(getServer());

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (n1 !== n2) { setMsg({ ok: false, text: 'Le nuove password non coincidono' }); return; }
    try {
      const r = await api<{ token: string }>('/auth/password', { body: { currentPassword: cur, newPassword: n1 } });
      setToken(r.token);
      setMsg({ ok: true, text: 'Password aggiornata. Gli altri dispositivi dovranno rifare l\'accesso.' });
      setCur(''); setN1(''); setN2('');
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  };

  return (
    <main className="narrow">
      <h1>Account</h1>
      <p className="muted">{user?.email} · {user?.role === 'admin' ? 'Amministratore' : 'Utente'}</p>

      <form onSubmit={change} className="panel">
        <h2>Cambia password</h2>
        {msg && <div className={'notice ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
        <input type="password" placeholder="Password attuale" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <input type="password" placeholder="Nuova password (min. 5 caratteri)" autoComplete="new-password" minLength={5} value={n1} onChange={(e) => setN1(e.target.value)} required />
        <input type="password" placeholder="Ripeti la nuova password" autoComplete="new-password" minLength={5} value={n2} onChange={(e) => setN2(e.target.value)} required />
        <button className="btn primary" type="submit">Aggiorna password</button>
      </form>

      {isNative && (
        <div className="panel">
          <h2>Server</h2>
          <input value={server} onChange={(e) => setServerInput(e.target.value)} />
          <button className="btn secondary" onClick={() => { setServer(server); signOut(); }}>Salva e riaccedi</button>
        </div>
      )}

      <div className="panel">
        <button className="btn secondary" onClick={signOut}>Esci</button>
        <p className="muted small">MyVideo v{APP_VERSION}</p>
      </div>
    </main>
  );
}
