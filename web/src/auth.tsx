import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export interface User { id: number; email: string; role: 'admin' | 'user'; status: string }
interface Ctx {
  user: User | null;
  ready: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
}

const AuthCtx = createContext<Ctx>(null as never);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const onLogout = () => signOut();
    window.addEventListener('mv-logout', onLogout);
    if (!getToken()) {
      setReady(true);
    } else {
      api<{ user: User }>('/auth/me')
        .then((r) => setUser(r.user))
        .catch(() => {})
        .finally(() => setReady(true));
    }
    return () => window.removeEventListener('mv-logout', onLogout);
  }, [signOut]);

  const signIn = (token: string, u: User) => {
    setToken(token);
    setUser(u);
  };

  return <AuthCtx.Provider value={{ user, ready, signIn, signOut }}>{children}</AuthCtx.Provider>;
}
