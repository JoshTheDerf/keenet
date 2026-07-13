import { describe, it, expect } from 'vitest';
import { parseBackupKey, keyFor } from './backup';

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
