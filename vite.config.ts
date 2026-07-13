import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import ui from '@nuxt/ui/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Dev-only CSP relaxation. index.html ships a strict production CSP <meta>;
 * the dev server additionally needs the HMR websocket (ws:) and plain-http
 * localhost origins. Production builds keep the tag from index.html untouched.
 */
function cspDevPlugin(): Plugin {
  return {
    name: 'keenet-csp-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(http-equiv="Content-Security-Policy"[^>]*connect-src 'self' https:)/,
        // ws/http: Vite HMR. ipc/http://ipc.localhost: Tauri IPC when the desktop
        // shell runs against this dev server (tauri.conf.json CSP covers prod).
        "$1 ws: wss: http://localhost:* http://127.0.0.1:* ipc: http://ipc.localhost"
      );
    }
  };
}

/**
 * Mobile touch targets, the Nuxt UI way: on max-md screens, promote every
 * control size to the theme's `xl` metrics (px-3 py-2 text-base, size-6
 * icons, p-2 when square) — ~45px hit areas at the 18px mobile root font,
 * and text-base inputs stay ≥16px so iOS Safari doesn't zoom on focus.
 * These classes are appended per size variant; desktop metrics are untouched.
 */
const TOUCH_SIZES = ['xs', 'sm', 'md', 'lg'] as const;

const touchButton = {
  base: 'max-md:px-3 max-md:py-2 max-md:text-base max-md:gap-2',
  leadingIcon: 'max-md:size-6',
  trailingIcon: 'max-md:size-6'
};
const touchButtonSizes = Object.fromEntries(TOUCH_SIZES.map((s) => [s, touchButton]));

const touchSquareButtons = TOUCH_SIZES.map((size) => ({
  size,
  square: true,
  class: 'max-md:p-2'
}));

const touchInput = {
  base: 'max-md:px-3 max-md:py-2 max-md:text-base',
  leading: 'max-md:ps-3',
  trailing: 'max-md:pe-3',
  leadingIcon: 'max-md:size-6',
  trailingIcon: 'max-md:size-6'
};
const touchInputSizes = Object.fromEntries(TOUCH_SIZES.map((s) => [s, touchInput]));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Public base path. Defaults to a relative base so the same build works at
  // any mount point (Tauri asset protocol, Capacitor, Nextcloud embed). For the
  // Cloudflare Workers web deploy at keenet.thederf.com/app/, use:
  //   npm run build:web
  // which sets --base /app/ --outDir dist/app and copies landing.html to dist/.
  const base = env.VITE_BASE_URL || './';

  return {
  base,
  plugins: [
    cspDevPlugin(),
    vue(),
    tailwindcss(),
    ui({
      // Standalone Vue mode (no Nuxt). Auto-imports Nuxt UI components.
      ui: {
        colors: {
          primary: 'blue',
          neutral: 'slate'
        },
        // Larger default control sizes (was `md`) for comfortable touch targets
        // on mobile. Dense areas (toolbars, chips) set explicit smaller sizes
        // and are unaffected. See also the mobile root font-size bump in
        // src/assets/main.css.
        //
        // On max-md screens every size variant additionally promotes to the
        // theme's `xl` metrics (touchButtonSizes/touchInputSizes below), so
        // explicit size="xs|sm" icon buttons still meet the ~44px touch
        // target. Config variant classes APPEND to the built-in theme
        // (tailwind-variants `extend`), they don't replace it.
        button: {
          defaultVariants: { size: 'lg' },
          variants: { size: touchButtonSizes },
          compoundVariants: touchSquareButtons
        },
        input: { defaultVariants: { size: 'lg' }, variants: { size: touchInputSizes } },
        inputNumber: { defaultVariants: { size: 'lg' }, variants: { size: touchInputSizes } },
        inputMenu: { defaultVariants: { size: 'lg' }, variants: { size: touchInputSizes } },
        textarea: { defaultVariants: { size: 'lg' }, variants: { size: touchInputSizes } },
        select: { defaultVariants: { size: 'lg' }, variants: { size: touchInputSizes } },
        selectMenu: { defaultVariants: { size: 'lg' }, variants: { size: touchInputSizes } },
        checkbox: { defaultVariants: { size: 'lg' } },
        radioGroup: { defaultVariants: { size: 'lg' } },
        switch: { defaultVariants: { size: 'lg' } },
        pinInput: { defaultVariants: { size: 'lg' } },
        formField: { defaultVariants: { size: 'lg' } }
      }
    }),
    VitePWA({
      // 'prompt' (not autoUpdate): we poll for updates in the background but
      // control WHEN the new SW activates — never mid-edit (see src/pwa.ts).
      registerType: 'prompt',
      // Mirror the app base; manifest scope/start_url stay relative so a
      // subpath deploy (/keenet/) works without further configuration.
      base,
      scope: './',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'KeeNet',
        short_name: 'KeeNet',
        description: 'Free cross-platform password manager compatible with KeePass',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        categories: ['productivity', 'utilities', 'security'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2,wasm}'],
        // The app shell precaches; external APIs (HIBP, storage providers,
        // OAuth) are always network and never intercepted.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\?code=/, /\?error=/],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  optimizeDeps: {
    include: ['kdbxweb', 'zxcvbn']
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
  };
});
