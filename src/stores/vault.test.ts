// @vitest-environment node
// kdbxweb's crypto needs a complete WebCrypto, so this suite runs under Node
// (like kdbx-file.test.ts). Origin writes go to a stubbed FS Access handle.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { initKdbxweb } from '@/domain/kdbx-init';
import { useVaultStore } from '@/stores/vault';

interface HandleLog {
  writes: number;
  /** Highest number of concurrently open writables (must stay ≤ 1). */
  maxConcurrent: number;
  failNext: boolean;
  /** Invoked during the (post-serialization) write — e.g. to simulate an edit. */
  onWrite?: () => void;
}

function makeHandle(log: HandleLog): FileSystemFileHandle {
  let active = 0;
  return {
    createWritable: async () => {
      if (log.failNext) {
        log.failNext = false;
        throw new Error('disk on fire');
      }
      active++;
      log.maxConcurrent = Math.max(log.maxConcurrent, active);
      // Keep the writable open across a couple of macrotasks so overlapping
      // saves would be observable as maxConcurrent > 1.
      await new Promise((r) => setTimeout(r, 5));
      return {
        write: async () => {
          log.onWrite?.();
          await new Promise((r) => setTimeout(r, 5));
          log.writes++;
        },
        close: async () => {
          active--;
        }
      };
    }
  } as unknown as FileSystemFileHandle;
}

beforeAll(() => {
  initKdbxweb();
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('vault store save/persist', () => {
  it('saveFile serializes without clearing the modified flag', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'T', password: 'p' });
    expect(file.modified).toBe(true);

    const data = await vault.saveFile(file.id);

    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(data!.byteLength).toBeGreaterThan(0);
    // Export-style serialization must not trick auto-save into skipping the file.
    expect(file.modified).toBe(true);
  });

  it('persistFile clears modified only after a successful write to origin', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'T', password: 'p' });
    const log: HandleLog = { writes: 0, maxConcurrent: 0, failNext: false };
    file.fsHandle = makeHandle(log);

    await expect(vault.persistFile(file.id)).resolves.toBe(true);
    expect(log.writes).toBe(1);
    expect(file.modified).toBe(false);
  });

  it('persistFile keeps the modified flag when the origin write fails', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'T', password: 'p' });
    const log: HandleLog = { writes: 0, maxConcurrent: 0, failNext: true };
    file.fsHandle = makeHandle(log);

    await expect(vault.persistFile(file.id)).resolves.toBe(false);
    expect(file.modified).toBe(true);

    // A later successful persist clears it.
    await expect(vault.persistFile(file.id)).resolves.toBe(true);
    expect(file.modified).toBe(false);
  });

  it('keeps modified when an edit lands while the write is in flight', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'T', password: 'p' });
    const entryId = file.getAllEntries(true)[0].id;
    const log: HandleLog = { writes: 0, maxConcurrent: 0, failNext: false };
    // The edit fires during the origin write — after serialization — so the
    // change is NOT in the written bytes and the file must stay dirty.
    log.onWrite = () => vault.updateField(file.id, entryId, 'Title', 'edited mid-save');
    file.fsHandle = makeHandle(log);

    await expect(vault.persistFile(file.id)).resolves.toBe(true);
    expect(file.modified).toBe(true);
  });

  it('serializes concurrent save operations for the same file', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'T', password: 'p' });
    const log: HandleLog = { writes: 0, maxConcurrent: 0, failNext: false };
    file.fsHandle = makeHandle(log);

    const results = await Promise.all([
      vault.persistFile(file.id),
      vault.persistFile(file.id),
      // No provider/path → syncFile falls back to the persist path in-line.
      vault.syncFile(file.id)
    ]);

    expect(results).toEqual([true, true, true]);
    expect(log.writes).toBe(3);
    expect(log.maxConcurrent).toBe(1);
  });

  it('a second syncFile while one is in flight awaits it instead of queuing', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'T', password: 'p' });
    const log: HandleLog = { writes: 0, maxConcurrent: 0, failNext: false };
    file.fsHandle = makeHandle(log);

    const first = vault.syncFile(file.id);
    const second = vault.syncFile(file.id);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    // Coalesced: only one actual write happened.
    expect(log.writes).toBe(1);

    // After settling, a fresh sync runs again.
    await expect(vault.syncFile(file.id)).resolves.toBe(true);
    expect(log.writes).toBe(2);
  });
});

describe('vault store entry VM caching', () => {
  it('keeps unrelated entry VMs identical across a mutation, replaces the edited one', async () => {
    const vault = useVaultStore();
    const file = await vault.createFile({ name: 'C', password: 'p' });
    const rootId = file.getGroupTree().id;
    const a = file.createEntry(rootId);
    const b = file.createEntry(rootId);
    vault.updateField(file.id, a.uuid.id, 'Title', 'A');
    vault.updateField(file.id, b.uuid.id, 'Title', 'B');

    const before = vault.allEntries;
    const vmA = before.find((e) => e.id === a.uuid.id)!;
    const vmB = before.find((e) => e.id === b.uuid.id)!;

    vault.updateField(file.id, b.uuid.id, 'Title', 'B2');

    const after = vault.allEntries;
    expect(after).not.toBe(before); // the list itself is re-derived per bump
    expect(after.find((e) => e.id === a.uuid.id)).toBe(vmA); // cache hit
    const vmB2 = after.find((e) => e.id === b.uuid.id)!;
    expect(vmB2).not.toBe(vmB);
    expect(vmB2.title).toBe('B2');
  });
});

describe('vault store pwned results', () => {
  it('prunes pwnedResults entries belonging to a closed file', async () => {
    const vault = useVaultStore();
    const f1 = await vault.createFile({ name: 'A', password: 'p' });
    const f2 = await vault.createFile({ name: 'B', password: 'p' });
    const e1 = f1.getAllEntries(true)[0].id;
    const e2 = f2.getAllEntries(true)[0].id;
    vault.pwnedResults.set(e1, 3);
    vault.pwnedResults.set(e2, 5);

    vault.closeFile(f1.id);

    expect(vault.pwnedResults.has(e1)).toBe(false);
    expect(vault.pwnedResults.get(e2)).toBe(5);
  });
});
