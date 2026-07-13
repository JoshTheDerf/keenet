/**
 * Local-file access. Uses the File System Access API when available (so the
 * database can be saved back in place), falling back to <input>/download.
 */

export interface PickedFile {
  name: string;
  data: ArrayBuffer;
  handle?: FileSystemFileHandle;
}

interface FsWindow {
  showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
}

export function supportsFileSystemAccess(): boolean {
  return typeof (window as unknown as FsWindow).showOpenFilePicker === 'function';
}

const KDBX_TYPES = [
  {
    description: 'KeePass database',
    accept: { 'application/octet-stream': ['.kdbx'] }
  }
];

/** Pick a .kdbx file. Returns null if the user cancels. */
export async function pickDatabaseFile(): Promise<PickedFile | null> {
  const w = window as unknown as FsWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: KDBX_TYPES, multiple: false });
      const file = await handle.getFile();
      return { name: file.name, data: await file.arrayBuffer(), handle };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
  }
  return pickFileViaInput('.kdbx');
}

/** Generic file picker via a hidden <input>. */
export function pickFileViaInput(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve(null);
      resolve({ name: file.name, data: await file.arrayBuffer() });
    };
    // If the dialog is cancelled there is no reliable event; rely on GC.
    document.body.appendChild(input);
    input.click();
  });
}

/** Save data back to a previously opened handle (FS Access API). */
export async function saveToHandle(handle: FileSystemFileHandle, data: ArrayBuffer): Promise<void> {
  const writable = await (handle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
  await writable.write(data);
  await writable.close();
}

/** Trigger a browser download of the given data. */
export function downloadData(name: string, data: ArrayBuffer | Uint8Array, mime = 'application/octet-stream'): void {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save via FS Access "Save As" dialog, or download fallback. Returns handle if any. */
export async function saveDatabaseAs(
  name: string,
  data: ArrayBuffer
): Promise<FileSystemFileHandle | undefined> {
  const w = window as unknown as FsWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: KDBX_TYPES });
      await saveToHandle(handle, data);
      return handle;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return undefined;
      throw e;
    }
  }
  downloadData(name, data);
  return undefined;
}
