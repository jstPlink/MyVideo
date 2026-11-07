import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 10);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => { if (searchOpen) input.current?.focus(); }, [searchOpen]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <>
      <header className={'nav' + (scrolled ? ' scrolled' : '')}>
        <Link to="/" className="logo">MYVIDEO</Link>
        <nav className="nav-links">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/browse/series">Serie TV</NavLink>
          <NavLink to="/browse/movie">Film</NavLink>
          <NavLink to="/list">La mia lista</NavLink>
        </nav>
        <div className="nav-right">
          <form onSubmit={submit} className={'search' + (searchOpen ? ' open' : '')}>
            <button type="button" className="icon-btn" aria-label="Cerca" onClick={() => setSearchOpen((o) => !o)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </button>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titoli, generi" />
          </form>
          <div className="profile">
            <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Profilo">{user?.email[0].toUpperCase()}</button>
            {menuOpen && (
              <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
                <div className="menu-email">{user?.email}</div>
                <Link to="/account">Account e password</Link>
                {user?.role === 'admin' && <Link to="/admin">Amministrazione</Link>}
                <button onClick={signOut}>Esci</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <nav className="bottom-nav">
        <NavLink to="/" end><span>⌂</span>Home</NavLink>
        <NavLink to="/browse/series"><span>▤</span>Serie</NavLink>
        <NavLink to="/browse/movie"><span>▶</span>Film</NavLink>
        <NavLink to="/list"><span>＋</span>Lista</NavLink>
        <NavLink to="/search"><span>⌕</span>Cerca</NavLink>
      </nav>
    </>
  );
}
