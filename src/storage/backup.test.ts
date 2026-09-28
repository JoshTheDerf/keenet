import { describe, it, expect } from 'vitest';
import { parseBackupKey, keyFor, backupTargetPath } from './backup';

describe('parseBackupKey', () => {
  it('parses a well-formed backup key', () => {
    const b = parseBackupKey('bak:f3:1720000000000');
    expect(b).toEqual({ key: 'bak:f3:1720000000000', fileId: 'f3', time: 1720000000000 });
  });

  it('parses keys with a uniqueness suffix', () => {
    const b = parseBackupKey('bak:f2:1720000000000-17');
    expect(b).toEqual({ key: 'bak:f2:1720000000000-17', fileId: 'f2', time: 1720000000000 });
  });

  it('handles file ids containing colons', () => {
    const b = parseBackupKey('bak:a:b:c:42');
    expect(b?.fileId).toBe('a:b:c');
    expect(b?.time).toBe(42);
  });

  it('rejects non-backup keys', () => {
    expect(parseBackupKey('files:f1')).toBeNull();
    expect(parseBackupKey('bak:noTime')).toBeNull();
    expect(parseBackupKey('bak:f1:notanumber')).toBeNull();
  });
});

describe('keyFor', () => {
  it('generates distinct keys for the same file and millisecond', () => {
    const a = keyFor('f1', 1720000000000);
    const b = keyFor('f1', 1720000000000);
    expect(a).not.toBe(b);
    expect(parseBackupKey(a)).toMatchObject({ fileId: 'f1', time: 1720000000000 });
    expect(parseBackupKey(b)).toMatchObject({ fileId: 'f1', time: 1720000000000 });
  });
});

describe('backupTargetPath', () => {
  const rel = 'Backups/vault.2026-01-02-03-04-05.bak.kdbx';

  it('places WebDAV backups next to the file, keeping the query', () => {
    expect(backupTargetPath('webdav', 'https://dav.example.com/dav/vault.kdbx?requesttoken=abc', rel)).toBe(
      'https://dav.example.com/dav/Backups/vault.2026-01-02-03-04-05.bak.kdbx?requesttoken=abc'
    );
  });

  it('keeps Dropbox paths absolute and relative to the file folder', () => {
    expect(backupTargetPath('dropbox', '/Keys/vault.kdbx', rel)).toBe(`/Keys/${rel}`);
    expect(backupTargetPath('dropbox', undefined, rel)).toBe(`/${rel}`);
  });

  it('uses a root path for OneDrive item ids', () => {
    expect(backupTargetPath('onedrive', 'D4648F06C91D9D3D!54927', rel)).toBe(`/${rel}`);
  });

  it('resolves local folder and native paths against their directory', () => {
    expect(backupTargetPath('fsaccess', 'vault.kdbx', rel)).toBe(rel);
    expect(backupTargetPath('file', 'C:\\Users\\me\\vault.kdbx', rel)).toBe(`C:\\Users\\me\\${rel}`);
  });

  it('returns null for id-addressed Google Drive', () => {
    expect(backupTargetPath('gdrive', 'fileid123', rel)).toBeNull();
  });
});
