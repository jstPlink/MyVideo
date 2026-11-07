import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'it.fplinio.myvideo',
  appName: 'MyVideo',
  webDir: 'dist',
  backgroundColor: '#141414',
  server: {
    // origine http://localhost: permette di parlare sia con server http (LAN) che https (Cloudflare)
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
