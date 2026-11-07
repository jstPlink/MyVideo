import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Navbar from './components/Navbar';
import BackHandler from './components/BackHandler';
import Login from './pages/Login';
import Home from './pages/Home';
import Browse from './pages/Browse';
import TitlePage from './pages/Title';
import Watch from './pages/Watch';
import Account from './pages/Account';
import Admin from './pages/Admin';

export default function App() {
  const { user, ready } = useAuth();
  const loc = useLocation();

  if (!ready) return <div className="splash"><div className="logo">MYVIDEO</div></div>;
  if (!user) return <Login />;

  const watching = loc.pathname.startsWith('/watch');
  return (
    <>
      <BackHandler />
      {!watching && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/browse/:kind" element={<Browse />} />
        <Route path="/list" element={<Browse mode="list" />} />
        <Route path="/search" element={<Browse mode="search" />} />
        <Route path="/title/:id" element={<TitlePage />} />
        <Route path="/watch/:fileId" element={<Watch />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
