import { useEffect, useState } from 'react';
import { api, APP_VERSION, getServer, isNative, setServer } from '../api';
import { useAuth, type User } from '../auth';

interface Status { version: string; needsSetup: boolean; registration: 'approval' | 'open' | 'closed' }

export default function Login() {
  const { signIn } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [server, setServerInput] = useState(getServer());
  const [needServer, setNeedServer] = useState(isNative && !getServer());
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = () => {
    api<Status>('/status', { token: null })
      .then((s) => { setStatus(s); setError(''); if (s.needsSetup) setMode('register'); })
      .catch((e) => setError(e.message));
  };
  useEffect(() => { if (!needServer) loadStatus(); }, [needServer]);

  const saveServer = (e: React.FormEvent) => {
    e.preventDefault();
    let url = server.trim();
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    setServer(url);
    setServerInput(url);
    setNeedServer(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'register' && password !== password2) { setError('Le password non coincidono'); return; }
    setBusy(true);
    try {
      const r = await api<{ token?: string; user?: User; pending?: boolean; message?: string }>(
        mode === 'login' ? '/auth/login' : '/auth/register',
        { body: { email, password }, token: null },
      );
      if (r.pending) { setInfo(r.message || 'Registrazione ricevuta'); setMode('login'); setPassword(''); setPassword2(''); }
      else if (r.token && r.user) signIn(r.token, r.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (needServer) {
    return (
      <div className="auth-wrap">
        <form className="auth-box" onSubmit={saveServer}>
          <div className="logo big">MYVIDEO</div>
          <h1>Collega il server</h1>
          <p className="muted">Inserisci l'indirizzo della tua istanza MyVideo (es. https://video.tuodominio.it oppure http://192.168.1.10:8090).</p>
          <input type="text" inputMode="url" autoCapitalize="none" placeholder="Indirizzo del server" value={server} onChange={(e) => setServerInput(e.target.value)} required />
          <button className="btn primary full" type="submit">Continua</button>
        </form>
      </div>
    );
  }

  const setup = status?.needsSetup;
  const canRegister = setup || status?.registration !== 'closed';

  return (
    <div className="auth-wrap">
      <form className="auth-box" onSubmit={submit}>
        <div className="logo big">MYVIDEO</div>
        <h1>{setup ? 'Configurazione iniziale' : mode === 'login' ? 'Accedi' : 'Registrati'}</h1>
        {setup && <p className="muted">Crea l'account amministratore: sara' il primo utente e potra' approvare gli altri.</p>}
        {info && <div className="notice ok">{info}</div>}
        {error && <div className="notice err">{error}</div>}
        <input type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === 'register' ? 8 : undefined} required />
        {mode === 'register' && (
          <input type="password" placeholder="Ripeti la password (min. 8 caratteri)" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} minLength={8} required />
        )}
        <button className="btn primary full" disabled={busy} type="submit">
          {busy ? '…' : setup ? 'Crea amministratore' : mode === 'login' ? 'Accedi' : 'Registrati'}
        </button>
        {!setup && canRegister && (
          <p className="switch">
            {mode === 'login' ? 'Nuovo qui? ' : 'Hai gia\' un account? '}
            <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); setError(''); setInfo(''); }}>
              {mode === 'login' ? 'Registrati' : 'Accedi'}
            </a>
          </p>
        )}
        {status && status.registration === 'approval' && mode === 'register' && !setup && (
          <p className="muted small">Dopo la registrazione un amministratore dovra' approvare il tuo account.</p>
        )}
        <p className="muted small foot">
          v{APP_VERSION}
          {isNative && <> · {getServer()} · <a href="#" onClick={(e) => { e.preventDefault(); setNeedServer(true); }}>cambia server</a></>}
        </p>
      </form>
    </div>
  );
}
