import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import express from 'express';
import { config } from './config.js';
import { db, getSetting, setSetting } from './db.js';

function secret() {
  if (config.jwtSecret) return config.jwtSecret;
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(48).toString('hex');
    setSetting('jwt_secret', s);
  }
  return s;
}
const SECRET = secret();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, status: u.status });

export function signToken(user, typ = 'access', expiresIn = '30d') {
  return jwt.sign({ sub: user.id, tv: user.token_version, typ }, SECRET, { expiresIn });
}

function userFromToken(token, typ) {
  try {
    const p = jwt.verify(token, SECRET);
    if (p.typ !== typ) return null;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
    if (!u || u.status !== 'active' || u.token_version !== p.tv) return null;
    return u;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = h.startsWith('Bearer ') ? userFromToken(h.slice(7), 'access') : null;
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  req.user = user;
  next();
}

/** Per i flussi video: accetta il token breve in query (?t=) oppure il Bearer. */
export function requireStreamAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const user =
    (req.query.t && userFromToken(String(req.query.t), 'stream')) ||
    (h.startsWith('Bearer ') ? userFromToken(h.slice(7), 'access') : null);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo amministratori' });
  next();
}

// Limitatore di tentativi di login (in memoria).
const attempts = new Map();
function tooMany(key) {
  const a = attempts.get(key);
  return a && a.count >= 8 && Date.now() - a.first < 15 * 60 * 1000;
}
function fail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60 * 1000) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip;

export const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

export const authRouter = express.Router();

authRouter.post('/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email non valida' });
  if (password.length < 5) return res.status(400).json({ error: 'La password deve avere almeno 5 caratteri' });

  const first = userCount() === 0;
  if (!first && config.registration === 'closed') return res.status(403).json({ error: 'Le registrazioni sono chiuse' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email gia\' registrata' });

  const role = first ? 'admin' : 'user';
  const status = first || config.registration === 'open' ? 'active' : 'pending';
  const hash = bcrypt.hashSync(password, 11);
  const id = Number(db.prepare('INSERT INTO users(email,password_hash,role,status,created_at) VALUES(?,?,?,?,?)').run(email, hash, role, status, Date.now()).lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (status === 'pending') return res.status(202).json({ pending: true, message: 'Registrazione ricevuta: attendi l\'approvazione dell\'amministratore.' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const key = clientIp(req) + '|' + email;
  if (tooMany(key)) return res.status(429).json({ error: 'Troppi tentativi, riprova tra qualche minuto' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    fail(key);
    return res.status(401).json({ error: 'Email o password errate' });
  }
  if (user.status === 'pending') return res.status(403).json({ error: 'Account in attesa di approvazione' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account disabilitato' });
  attempts.delete(key);
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

authRouter.post('/password', requireAuth, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (!bcrypt.compareSync(current, req.user.password_hash)) return res.status(400).json({ error: 'Password attuale errata' });
  if (next.length < 5) return res.status(400).json({ error: 'La nuova password deve avere almeno 5 caratteri' });
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(next, 11), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  // il vecchio token non e' piu' valido: ne restituiamo uno nuovo
  res.json({ ok: true, token: signToken(user) });
});
