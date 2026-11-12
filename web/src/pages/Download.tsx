import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, APP_VERSION } from '../api';
import { useAuth } from '../auth';

interface Asset { kind: 'android' | 'windows' | 'mac' | 'linux'; arch: string | null; name: string; size: number; url: string; version: string; publishedAt: string }
interface Data { latest: string | null; assets: Asset[]; releasesUrl: string }

const INFO: Record<Asset['kind'], { title: string; sub: string; steps: string[] }> = {
  android: {
    title: 'Android',
    sub: 'App per telefono e tablet (APK)',
    steps: [
      'Scarica il file dal telefono.',
      'Aprilo e, se richiesto, consenti l\'installazione da questa origine (impostazioni di Android).',
      'All\'apertura scegli http o https, scrivi l\'indirizzo del server in cima a questa pagina e accedi.',
    ],
  },
  windows: {
    title: 'Windows',
    sub: 'Installer per Windows 10/11 (64 bit)',
    steps: [
      'Scarica ed esegui l\'installer.',
      'Se compare "Windows ha protetto il PC": Ulteriori informazioni → Esegui comunque (l\'app non è firmata).',
      'Al primo avvio inserisci l\'indirizzo del server in cima a questa pagina.',
    ],
  },
  mac: {
    title: 'macOS',
    sub: 'Immagine disco (.dmg)',
    steps: [
      'Apri il .dmg e trascina MyVideo in Applicazioni.',
      'La prima volta: clic destro → Apri (l\'app non è firmata).',
      'Al primo avvio inserisci l\'indirizzo del server in cima a questa pagina.',
    ],
  },
  linux: {
    title: 'Linux',
    sub: 'AppImage',
    steps: ['Scarica il file, rendilo eseguibile (chmod +x) e avvialo.', 'Al primo avvio inserisci l\'indirizzo del server in cima a questa pagina.'],
  },
};

function detect(): Asset['kind'] | null {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os|macintosh/i.test(ua) && !/mobile/i.test(ua)) return 'mac';
  if (/linux|x11/i.test(ua)) return 'linux';
  return null;
}

const mb = (n: number) => (n / 1e6 >= 10 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)) + ' MB';
const dateFmt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

export default function Download() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const mine = detect();
  const origin = window.location.origin;

  useEffect(() => {
    api<Data>('/downloads', { token: null }).then(setData).catch((e) => setError(e.message));
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(origin); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignora */ }
  };

  // dello stesso sistema puo' esserci piu' di un file (es. macOS arm64 e x64)
  const kinds = (['android', 'windows', 'mac', 'linux'] as const).filter((k) => data?.assets.some((a) => a.kind === k));
  const ordered = mine && kinds.includes(mine) ? [mine, ...kinds.filter((k) => k !== mine)] : [...kinds];

  return (
    <main className="download">
      <div className="dl-head">
        <Link to={user ? '/' : '/'} className="logo">MYVIDEO</Link>
        <h1>Scarica le app</h1>
        <p className="muted">Scarica l'app per il tuo dispositivo. Dopo l'installazione usa lo stesso indirizzo e lo stesso account del sito.</p>
        <div className="dl-server">
          <span>Indirizzo del server</span>
          <code>{origin}</code>
          <button className="btn mini" onClick={copy}>{copied ? 'Copiato' : 'Copia'}</button>
        </div>
      </div>

      {error && (
        <div className="notice err">
          {error}. <a href="https://github.com/jstPlink/MyVideo/releases" target="_blank" rel="noreferrer">Apri le release su GitHub</a>.
        </div>
      )}
      {!data && !error && <p className="muted">Caricamento…</p>}
      {data && ordered.length === 0 && <p className="muted">Nessun file ancora pubblicato. <a href={data.releasesUrl} target="_blank" rel="noreferrer">Vedi le release</a>.</p>}

      <div className="dl-grid">
        {ordered.map((k) => {
          const list = data!.assets.filter((a) => a.kind === k);
          const info = INFO[k];
          return (
            <section key={k} className={'panel dl-card' + (k === mine ? ' mine' : '')}>
              {k === mine && <span className="dl-badge">Consigliato per il tuo dispositivo</span>}
              <h2>{info.title}</h2>
              <p className="muted">{info.sub}</p>
              {list.map((a) => (
                <a key={a.url} className={'btn ' + (k === mine ? 'primary' : 'secondary') + ' dl-btn'} href={a.url} rel="noreferrer">
                  ⬇ Scarica{a.arch && list.length > 1 ? ` (${a.arch})` : ''} <small>v{a.version} · {mb(a.size)}</small>
                </a>
              ))}
              <p className="muted small">Aggiornato il {dateFmt.format(new Date(list[0].publishedAt))}</p>
              <ol className="dl-steps">{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
          );
        })}
      </div>

      <p className="muted small dl-foot">
        Sito v{APP_VERSION}{data?.latest ? ` · ultima versione delle app: v${data.latest}` : ''} ·{' '}
        <a href={data?.releasesUrl || 'https://github.com/jstPlink/MyVideo/releases'} target="_blank" rel="noreferrer">tutte le versioni</a>
        {!user && <> · <Link to="/">Torna al login</Link></>}
      </p>
    </main>
  );
}
