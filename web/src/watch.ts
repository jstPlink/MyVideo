import { getServer, getToken } from './api';

export function newSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export interface WatchPayload {
  sessionId: string;
  fileId: number;
  startedAt: number;
  endedAt: number;
  seconds: number;
}

/** Invia al server i secondi realmente guardati (fuso orario incluso, per le statistiche per giorno e ora). */
export function sendWatch(p: WatchPayload) {
  if (!getToken() || p.seconds < 1) return;
  fetch(getServer() + '/api/watch', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ ...p, seconds: Math.round(p.seconds * 10) / 10, tz: new Date().getTimezoneOffset() }),
  }).catch(() => {});
}

/**
 * Conta i secondi di riproduzione (un tick al secondo, solo se il video e' in play)
 * e li invia al server ogni 30 s, in pausa e alla chiusura.
 */
export class WatchTracker {
  private sessionId = newSessionId();
  private pending = 0;
  private segStart = 0;

  constructor(private fileId: number) {}

  tick(playing: boolean) {
    if (!playing) return;
    if (this.pending === 0) this.segStart = Date.now() - 1000;
    this.pending += 1;
    if (this.pending >= 30) this.flush();
  }

  flush() {
    if (this.pending >= 1) {
      sendWatch({ sessionId: this.sessionId, fileId: this.fileId, startedAt: this.segStart, endedAt: Date.now(), seconds: this.pending });
    }
    this.pending = 0;
  }
}
