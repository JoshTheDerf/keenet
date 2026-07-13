// Flat ESLint config: Vue 3 + TypeScript recommended presets.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-nc/**',
      'dev-dist/**',
      '_legacy/**',
      'android/**',
      'ios/**',
      'node_modules/**',
      '**/*.d.ts',
      'src/generated/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    // Parse <script setup lang="ts"> blocks with the TS parser.
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      // Type/global resolution is TypeScript's job (vue-tsc); the core rule
      // false-positives on TS lib types (e.g. CanvasImageSource) in SFCs.
      'no-undef': 'off'
    }
  },
  {
    // Layout/formatting is not enforced by lint (would mass-edit templates);
    // turn off eslint-plugin-vue's layout rules and keep the semantic ones.
    files: ['**/*.vue'],
    rules: pluginVue.configs['no-layout-rules'].rules
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  {
    // Electron main/preload are plain CommonJS scripts.
    files: ['electron/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    rules: {
      // Nuxt UI components are auto-imported; single-word view names are fine here.
      'vue/multi-word-component-names': 'off'
    }
  }
);
