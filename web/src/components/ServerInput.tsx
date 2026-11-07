import { useState } from 'react';

type Scheme = 'https' | 'http';
const KEY = 'mv_scheme';

function split(value: string): { scheme: Scheme; host: string } {
  const m = value.trim().match(/^(https?):\/\/(.*)$/i);
  if (m) return { scheme: m[1].toLowerCase() as Scheme, host: m[2] };
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage non disponibile */ }
  return { scheme: saved === 'http' ? 'http' : 'https', host: value.trim() };
}

/** Indirizzo del server con scelta rapida http/https: basta scrivere "myvideo.fplinio.it". */
export default function ServerInput({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [state, setState] = useState(() => split(value));

  const update = (scheme: Scheme, hostRaw: string) => {
    // se l'utente incolla un indirizzo completo, lo schema scritto prevale
    const typed = split(hostRaw);
    const hasScheme = /^https?:\/\//i.test(hostRaw.trim());
    const s = hasScheme ? typed.scheme : scheme;
    const host = (hasScheme ? typed.host : hostRaw).replace(/^\/+/, '').replace(/\/+$/, '');
    setState({ scheme: s, host });
    try { localStorage.setItem(KEY, s); } catch { /* ignora */ }
    onChange(host ? `${s}://${host}` : '');
  };

  return (
    <div className="server-input">
      <div className="scheme" role="group" aria-label="Protocollo">
        {(['https', 'http'] as Scheme[]).map((s) => (
          <button type="button" key={s} className={state.scheme === s ? 'on' : ''} onClick={() => update(s, state.host)}>
            {s}://
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="myvideo.fplinio.it"
        value={state.host}
        onChange={(e) => update(state.scheme, e.target.value)}
        required
      />
    </div>
  );
}
