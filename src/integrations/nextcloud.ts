/**
 * KeeWeb-compatible `?config=<url>` startup bridge.
 *
 * The Nextcloud app (and any host that wants to hand KeeNet a file to open)
 * loads KeeNet in an iframe with a `?config=` query pointing at a small JSON
 * document describing which file to open and where from:
 *
 *   { "settings": {...}, "files": [ { "storage": "webdav", "name": "...",
 *                                     "path": "https://…/remote.php/webdav/…?requesttoken=…" } ] }
 *
 * We fetch that document and the file bytes using the ambient session
 * (same-origin cookies + the request token already baked into the URL), then
 * hand the file to the open screen so the user just types their master
 * password. Nothing here provides the password — the vault stays encrypted
 * until the user unlocks it, exactly like the original KeeWeb integration.
 */

export interface StartupFile {
  name: string;
  data: ArrayBuffer;
  storage: string;
  /** Absolute URL used both to load and (later) save the file back. */
  path: string;
}

interface ConfigFile {
  storage?: string;
  name?: string;
  path?: string;
}

interface StartupConfig {
  files?: ConfigFile[];
}

/** True when KeeNet is running inside another page (e.g. the Nextcloud app). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws — that only happens when framed.
    return true;
  }
}

/**
 * Read `?config=`, fetch the referenced config + file, and return the file for
 * the open screen. Returns null when there is no `?config=` param or anything
 * fails (KeeNet then just shows its normal open screen).
 */
export async function loadStartupConfig(): Promise<StartupFile | null> {
  const param = new URLSearchParams(window.location.search).get('config');
  if (!param) return null;

  const configUrl = new URL(param, window.location.href).toString();
  const res = await fetch(configUrl, { credentials: 'include' });
  if (!res.ok) throw new Error(`Config request failed (${res.status})`);
  const cfg = (await res.json()) as StartupConfig;

  const entry = cfg.files?.find((f) => f.path);
  if (!entry?.path) return null;

  const fileUrl = new URL(entry.path, window.location.href).toString();
  const dataRes = await fetch(fileUrl, { credentials: 'include' });
  if (!dataRes.ok) throw new Error(`Could not load file (${dataRes.status})`);
  const data = await dataRes.arrayBuffer();

  return {
    name: entry.name || 'database.kdbx',
    data,
    storage: entry.storage || 'webdav',
    path: fileUrl
  };
}
