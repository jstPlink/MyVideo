import { Capacitor } from '@capacitor/core';

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

export const isNative = Capacitor.isNativePlatform();

const TOKEN_KEY = 'mv_token';
const SERVER_KEY = 'mv_server';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/** Nell'app Android il server e' configurabile; sul web e' la stessa origine. */
export const getServer = () => (isNative ? localStorage.getItem(SERVER_KEY) || '' : '');
export function setServer(url: string) {
  localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, ''));
}

export const absolute = (path: string) => (getServer() || window.location.origin) + path;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const token = opts.token === undefined ? getToken() : opts.token;
  let res: Response;
  try {
    res = await fetch(getServer() + '/api' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('Il server non risponde', 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* corpo vuoto */ }
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('mv-logout'));
    throw new ApiError(data?.error || `Errore ${res.status}`, res.status);
  }
  return data as T;
}

const IMG = 'https://image.tmdb.org/t/p/';
export const poster = (p?: string | null, size = 'w342') => (p ? `${IMG}${size}${p}` : null);
export const backdrop = (p?: string | null, size = 'w1280') => (p ? `${IMG}${size}${p}` : null);

export interface Resume { fileId: number; position: number; duration: number; label: string }
export interface Card {
  id: number; kind: 'movie' | 'series'; name: string; year: number | null;
  poster: string | null; backdrop: string | null; overview: string | null;
  rating: number | null; genres: string | null; resume?: Resume; percent?: number;
}
export interface Row { id: string; title: string; variant?: 'wide'; items: Card[] }
export interface FileInfo {
  id: number; name: string; ext: string; size: number; season: number | null; episode: number | null;
  title: string | null; overview: string | null; still: string | null;
  position: number; duration: number; completed: boolean;
}
export interface TitleDetail extends Omit<Card, 'resume'> {
  runtime: number | null; inList: boolean; resume: { fileId: number; position: number } | null;
  files: FileInfo[]; related: Card[]; seasons: { season: number; name: string }[];
}
