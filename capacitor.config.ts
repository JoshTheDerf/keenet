import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the native mobile (Android/iOS) webview build.
 * `webDir: 'dist'` bundles the same Vite build shipped to the web/PWA; the
 * relative `base: './'` makes those assets resolve correctly inside the
 * app's file:// / capacitor:// scheme.
 */
const config: CapacitorConfig = {
  appId: 'com.thederf.keenet.app',
  appName: 'KeeNet',
  webDir: 'dist',
  backgroundColor: '#e9efec',
  android: {
    allowMixedContent: false
  },
  ios: {
    contentInset: 'always'
  },
  plugins: {
    StatusBar: { overlaysWebView: false, style: 'LIGHT', backgroundColor: '#e9efec' }
  }
};

export default config;
