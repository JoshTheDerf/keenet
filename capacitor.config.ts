import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the native mobile (Android/iOS) webview build.
 * `webDir: 'dist'` bundles the same Vite build shipped to the web/PWA; the
 * relative `base: './'` makes those assets resolve correctly inside the
 * app's file:// / capacitor:// scheme.
 */
const config: CapacitorConfig = {
  appId: 'com.keenet.app',
  appName: 'KeeNet',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  android: {
    allowMixedContent: false
  },
  ios: {
    contentInset: 'always'
  },
  plugins: {
    StatusBar: { overlaysWebView: false, style: 'DARK', backgroundColor: '#0f172a' }
  }
};

export default config;
