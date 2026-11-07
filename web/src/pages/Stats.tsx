import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getServer, getToken, poster } from '../api';
import { useAuth } from '../auth';

type Range = '7d' | '30d' | '90d' | '365d' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: '7 giorni' },
  { id: '30d', label: '30 giorni' },
  { id: '90d', label: '90 giorni' },
  { id: '365d', label: 'Anno' },
  { id: 'all', label: 'Sempre' },
];

interface Summary { totalSeconds: number; sessions: number; titles: number; activeDays: number; avgPerDay: number; avgPerActiveDay: number }
interface TitleRow { name: string; kind: 'movie' | 'series'; titleId: number | null; seconds: number; sessions: number; last: number; poster: string | null }
interface VideoRow { fileId: number | null; titleId: number | null; name: string; kind: string; epLabel: string | null; fileName: string | null; seconds: number; sessions: number; first: number; last: number }
interface SessionRow { id: string; fileId: number | null; titleId: number | null; name: string; kind: string; epLabel: string | null; startedAt: number; endedAt: number; seconds: number }
interface StatsData {
  range: Range; from: string; summary: Summary;
  daily: { day: string; seconds: number }[]; hourly: number[]; heat: number[][];
  topTitles: TitleRow[]; videos: VideoRow[]; recent: SessionRow[];
}

/** 3725 -> "1h 02m"; 90 -> "1m 30s"; 0 -> "0m" */
export function fmtDur(s: number): string {
  s = Math.round(s);
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return s % 60 && m < 5 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${s}s`;
}

const dtFmt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const fmtDay = (d: string) => dayFmt.format(new Date(d + 'T12:00:00'));

function BarChart({ data, labelEvery = 1, height = 150, unit = (n: number) => fmtDur(n) }: {
  data: { label: string; value: number; tip: string }[]; labelEvery?: number; height?: number; unit?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 1000;
  const gap = data.length > 60 ? 1 : 3;
  const bw = Math.max(1, (W - gap * (data.length - 1)) / data.length);
  return (
    <svg viewBox={`0 0 ${W} ${height + 34}`} className="chart" role="img">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1="0" x2={W} y1={height - height * f} y2={height - height * f} stroke="#2a2a2a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {data.map((d, i) => {
        const h = (d.value / max) * height;
        const x = i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={height - h} width={bw} height={Math.max(h, d.value > 0 ? 1.5 : 0)} rx={bw > 6 ? 2 : 0} fill="#e50914" opacity={d.value > 0 ? 0.95 : 0.2}>
              <title>{d.tip}: {unit(d.value)}</title>
            </rect>
            {i % labelEvery === 0 && <text x={x + bw / 2} y={height + 27} textAnchor="middle" fontSize="22" fill="#9a9a9a">{d.label}</text>}
          </g>
        );
      })}
      <text x="4" y="20" fontSize="20" fill="#8a8a8a">{unit(max)}</text>
    </svg>
  );
}

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

function Heatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(1, ...heat.flat());
  return (
    <div className="heat">
      <div className="heat-hours"><span />{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? h : ''}</span>)}</div>
      {WD_ORDER.map((wd) => (
        <div className="heat-row" key={wd}>
          <span className="heat-label">{WEEKDAYS[wd]}</span>
          {heat[wd].map((v, h) => (
            <i key={h} title={`${WEEKDAYS[wd]} ${String(h).padStart(2, '0')}:00 - ${fmtDur(v)}`} style={{ background: v > 0 ? `rgba(229,9,20,${0.15 + 0.85 * (v / max)})` : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function VideoDetail({ fileId, range }: { fileId: number; range: Range }) {
  const [days, setDays] = useState<{ day: string; seconds: number }[] | null>(null);
  useEffect(() => {
    api<{ days: { day: string; seconds: number }[] }>(`/stats/video/${fileId}?range=${range}&tz=${new Date().getTimezoneOffset()}`).then((r) => setDays(r.days));
  }, [fileId, range]);
  if (!days) return <p className="muted small">Caricamento…</p>;
  if (!days.length) return <p className="muted small">Nessun dato nel periodo.</p>;
  return <ul className="vdays">{days.map((d) => <li key={d.day}><span>{fmtDay(d.day)}</span><b>{fmtDur(d.seconds)}</b></li>)}</ul>;
}

async function download(path: string, fallbackName: string) {
  const r = await fetch(getServer() + '/api' + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error('Esportazione non riuscita');
  const cd = r.headers.get('Content-Disposition') || '';
  const name = cd.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function Stats() {
  const { user } = useAuth();
  const [range, setRange] = useState<Range>(() => (localStorage.getItem('mv_stats_range') as Range) || '30d');
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'titles' | 'videos' | 'history'>('titles');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    setError('');
    api<StatsData>(`/stats?range=${range}&tz=${new Date().getTimezoneOffset()}`).then(setData).catch((e) => setError(e.message));
  }, [range]);
  useEffect(load, [load]);

  const pick = (r: Range) => { setRange(r); try { localStorage.setItem('mv_stats_range', r); } catch { /* ignora */ } };

  // Con tanti giorni il grafico raggruppa per settimana
  const bars = useMemo(() => {
    if (!data) return [];
    const d = data.daily;
    if (d.length <= 100) {
      const every = d.length <= 14 ? 1 : d.length <= 40 ? 3 : 7;
      return { every, items: d.map((x) => ({ label: x.day.slice(8) + '/' + x.day.slice(5, 7), value: x.seconds, tip: fmtDay(x.day) })) };
    }
    const weeks: { label: string; value: number; tip: string }[] = [];
    for (let i = 0; i < d.length; i += 7) {
      const chunk = d.slice(i, i + 7);
      weeks.push({ label: chunk[0].day.slice(8) + '/' + chunk[0].day.slice(5, 7), value: chunk.reduce((a, c) => a + c.seconds, 0), tip: `Settimana dal ${fmtDay(chunk[0].day)}` });
    }
    return { every: Math.ceil(weeks.length / 12), items: weeks };
  }, [data]);

  const exportFile = async (type: string, format: 'csv' | 'json', all = false) => {
    try {
      await download(`/stats/export?type=${type}&format=${format}&range=${range}&tz=${new Date().getTimezoneOffset()}${all ? '&all=1' : ''}`, `myvideo-${type}.${format}`);
      setMsg('');
    } catch (e: any) { setMsg(e.message); }
  };

  if (error) return <div className="page-msg"><p>{error}</p><button className="btn secondary" onClick={load}>Riprova</button></div>;

  const s = data?.summary;
  const barsObj = bars as { every: number; items: { label: string; value: number; tip: string }[] };

  return (
    <main className="stats">
      <div className="stats-head">
        <div>
          <h1>Statistiche</h1>
          <p className="muted">Quanto e quando guardi. Conta solo il tempo di riproduzione effettiva (non le pause).</p>
        </div>
        <div className="chips">
          {RANGES.map((r) => <button key={r.id} className={range === r.id ? 'on' : ''} onClick={() => pick(r.id)}>{r.label}</button>)}
        </div>
      </div>

      {!data ? <p className="muted">Caricamento…</p> : s && s.sessions === 0 ? (
        <div className="panel">
          <h2>Ancora nessun dato</h2>
          <p className="muted">Le statistiche iniziano a registrarsi dalla prossima volta che guardi un video, dal web, dall'app Android o dall'app desktop.</p>
        </div>
      ) : s && (
        <>
          <div className="kpis">
            <Kpi label="Tempo guardato" value={fmtDur(s.totalSeconds)} sub={`${(s.totalSeconds / 3600).toFixed(1)} ore`} />
            <Kpi label="Sessioni" value={String(s.sessions)} sub={`${s.titles} titoli diversi`} />
            <Kpi label="Giorni attivi" value={String(s.activeDays)} sub={`media ${fmtDur(s.avgPerActiveDay)} nei giorni attivi`} />
            <Kpi label="Media al giorno" value={fmtDur(s.avgPerDay)} sub="sul periodo scelto" />
          </div>

          <section className="panel">
            <h2>{data.daily.length > 100 ? 'Tempo guardato per settimana' : 'Tempo guardato per giorno'}</h2>
            <BarChart data={barsObj.items} labelEvery={barsObj.every} />
          </section>

          <div className="two">
            <section className="panel">
              <h2>Ore del giorno</h2>
              <BarChart data={data.hourly.map((v, h) => ({ label: String(h), value: v, tip: `${String(h).padStart(2, '0')}:00` }))} labelEvery={3} height={120} />
            </section>
            <section className="panel">
              <h2>Giorno della settimana e ora</h2>
              <Heatmap heat={data.heat} />
            </section>
          </div>

          <section className="panel">
            <div className="tabs">
              <button className={tab === 'titles' ? 'on' : ''} onClick={() => setTab('titles')}>Titoli più guardati</button>
              <button className={tab === 'videos' ? 'on' : ''} onClick={() => setTab('videos')}>Per video</button>
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Cronologia</button>
            </div>

            {tab === 'titles' && (
              <ol className="toplist">
                {data.topTitles.map((t) => {
                  const pct = (t.seconds / Math.max(1, data.topTitles[0].seconds)) * 100;
                  const img = poster(t.poster, 'w92');
                  const body = (
                    <>
                      {img ? <img src={img} alt="" /> : <span className="ph-mini" />}
                      <span className="tl-text">
                        <strong>{t.name}</strong>
                        <span className="tl-bar"><i style={{ width: `${pct}%` }} /></span>
                        <small>{t.sessions} {t.sessions === 1 ? 'sessione' : 'sessioni'} · ultima {dtFmt.format(new Date(t.last))}</small>
                      </span>
                      <b>{fmtDur(t.seconds)}</b>
                    </>
                  );
                  return <li key={t.name + t.kind}>{t.titleId ? <Link to={`/title/${t.titleId}`} className="tl">{body}</Link> : <div className="tl">{body}</div>}</li>;
                })}
              </ol>
            )}

            {tab === 'videos' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Video</th><th>Tempo</th><th>Sessioni</th><th>Ultima visione</th></tr></thead>
                  <tbody>
                    {data.videos.map((v) => {
                      const key = `${v.fileId}-${v.name}`;
                      return (
                        <Fragment key={key}>
                          <tr className={v.fileId ? 'click' : ''} onClick={() => v.fileId && setOpen(open === key ? null : key)}>
                            <td>{v.name}{v.epLabel ? ` · ${v.epLabel}` : ''}{v.fileId ? <span className="caret">{open === key ? '▾' : '▸'}</span> : null}</td>
                            <td><b>{fmtDur(v.seconds)}</b></td>
                            <td>{v.sessions}</td>
                            <td>{dtFmt.format(new Date(v.last))}</td>
                          </tr>
                          {open === key && v.fileId && <tr><td colSpan={4}><VideoDetail fileId={v.fileId} range={range} /></td></tr>}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'history' && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Quando</th><th>Titolo</th><th>Durata</th></tr></thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td>{dtFmt.format(new Date(r.startedAt))}</td>
                        <td>{r.titleId ? <Link to={`/title/${r.titleId}`}>{r.name}</Link> : r.name}{r.epLabel ? ` · ${r.epLabel}` : ''}</td>
                        <td><b>{fmtDur(r.seconds)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.recent.length >= 100 && <p className="muted small">Ultime 100 sessioni: per tutto lo storico usa l'esportazione.</p>}
              </div>
            )}
          </section>
        </>
      )}

      <section className="panel">
        <h2>Esporta i dati</h2>
        <p className="muted">I dati sono salvati nel database del server (SQLite) e si possono scaricare nel periodo selezionato.</p>
        {msg && <div className="notice err">{msg}</div>}
        <div className="export">
          <div><b>Sessioni</b> (inizio, fine, durata, titolo)<span><button className="btn mini" onClick={() => exportFile('sessions', 'csv')}>CSV</button><button className="btn mini" onClick={() => exportFile('sessions', 'json')}>JSON</button></span></div>
          <div><b>Per giorno</b><span><button className="btn mini" onClick={() => exportFile('daily', 'csv')}>CSV</button><button className="btn mini" onClick={() => exportFile('daily', 'json')}>JSON</button></span></div>
          <div><b>Per giorno e ora</b><span><button className="btn mini" onClick={() => exportFile('hourly', 'csv')}>CSV</button><button className="btn mini" onClick={() => exportFile('hourly', 'json')}>JSON</button></span></div>
          <div><b>Per video</b><span><button className="btn mini" onClick={() => exportFile('videos', 'csv')}>CSV</button><button className="btn mini" onClick={() => exportFile('videos', 'json')}>JSON</button></span></div>
          {user?.role === 'admin' && (
            <div><b>Tutti gli utenti</b> (solo amministratore)<span><button className="btn mini" onClick={() => exportFile('sessions', 'csv', true)}>Sessioni CSV</button><button className="btn mini" onClick={() => exportFile('daily', 'csv', true)}>Giorni CSV</button><button className="btn mini" onClick={() => exportFile('sessions', 'json', true)}>JSON</button></span></div>
          )}
        </div>
      </section>
    </main>
  );
}
