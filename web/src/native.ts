import { registerPlugin } from '@capacitor/core';

export interface VlcResult { position: number; duration: number; next?: boolean; prev?: boolean; goto?: number; watched?: number; startedAt?: number; endedAt?: number }

/** Plugin nativo Android (libVLC): legge qualsiasi formato, decodifica sul telefono. */
interface VlcPlayerPlugin {
  play(opts: { url: string; title: string; position: number; hasNext: boolean; hasPrev: boolean; currentId: number; seriesTitle: string; episodes: string }): Promise<VlcResult>;
}

export const VlcPlayer = registerPlugin<VlcPlayerPlugin>('VlcPlayer');
