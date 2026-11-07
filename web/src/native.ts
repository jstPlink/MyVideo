import { registerPlugin } from '@capacitor/core';

export interface VlcResult { position: number; duration: number; next?: boolean }

/** Plugin nativo Android (libVLC): legge qualsiasi formato, decodifica sul telefono. */
interface VlcPlayerPlugin {
  play(opts: { url: string; title: string; position: number; hasNext: boolean }): Promise<VlcResult>;
}

export const VlcPlayer = registerPlugin<VlcPlayerPlugin>('VlcPlayer');
