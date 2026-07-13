#!/usr/bin/env node
/**
 * Build a minimal offline Iconify bundle of just the Lucide icons referenced in
 * the source (as `i-lucide-*`). Registering this at startup (see src/main.ts)
 * means <UIcon> resolves every icon locally instead of fetching from the
 * Iconify API at runtime — which is both faster and required behind strict
 * CSPs / offline (PWA, mobile, the Nextcloud embed).
 *
 * Run automatically via the `prebuild`/`predev` npm hooks; safe to re-run.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const collectionPath = join(root, 'node_modules/@iconify-json/lucide/icons.json');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'generated') walk(p, out);
    } else if (/\.(vue|ts)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const collection = JSON.parse(readFileSync(collectionPath, 'utf8'));
const inCollection = (n) => !!(collection.icons[n] || collection.aliases?.[n]);

const used = new Set();
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8');
  // Direct `i-lucide-<name>` references.
  for (const m of text.matchAll(/i-lucide-([a-z0-9-]+)/g)) used.add(m[1]);
}

// Names referenced indirectly: the KeePass→Lucide map (const/icons.ts) builds
// `i-lucide-${name}` at runtime from bare names. Pull any bare quoted token
// that is a real Lucide icon so those entry/group icons are bundled too.
try {
  const mapText = readFileSync(join(srcDir, 'const', 'icons.ts'), 'utf8');
  for (const m of mapText.matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) {
    if (inCollection(m[1])) used.add(m[1]);
  }
} catch {
  /* mapping file optional */
}
const bundle = {
  prefix: collection.prefix,
  width: collection.width,
  height: collection.height,
  icons: {}
};

const missing = [];
for (const name of [...used].sort()) {
  if (collection.icons[name]) {
    bundle.icons[name] = collection.icons[name];
    continue;
  }
  // Resolve an alias chain (e.g. renamed icons) to a concrete icon body.
  let cur = name;
  let guard = 0;
  while (collection.aliases?.[cur] && guard++ < 10) cur = collection.aliases[cur].parent;
  if (collection.icons[cur]) bundle.icons[name] = collection.icons[cur];
  else missing.push(name);
}

const outDir = join(srcDir, 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'lucide-bundle.json'), JSON.stringify(bundle));

console.log(`gen-icons: bundled ${Object.keys(bundle.icons).length} lucide icons`);
if (missing.length) {
  console.warn(`gen-icons: WARNING ${missing.length} icon(s) not found in collection: ${missing.join(', ')}`);
  process.exitCode = 1;
}
