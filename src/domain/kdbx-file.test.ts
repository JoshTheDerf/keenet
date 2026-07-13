// @vitest-environment node
// kdbxweb's AES/ChaCha crypto relies on a complete WebCrypto SubtleCrypto,
// which happy-dom does not fully implement — run this suite under Node.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKdbxweb } from './kdbx-init';
import { KdbxFile } from './kdbx-file';

beforeAll(() => {
  initKdbxweb();
});

describe('KdbxFile lifecycle', () => {
  it('creates a database with a default group and a sample entry', async () => {
    const file = await KdbxFile.create({ name: 'Test', password: 'secret' });
    const tree = file.getGroupTree();
    expect(tree.isRoot).toBe(true);
    const entries = file.getAllEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.title === 'Sample Entry')).toBe(true);
  });

  it('round-trips through save + open (Argon2 KDBX4)', async () => {
    const file = await KdbxFile.create({ name: 'RT', password: 'hunter2' });
    const rootId = file.getGroupTree().id;
    const entry = file.createEntry(rootId);
    const id = entry.uuid.id;
    file.setEntryField(id, 'Title', 'My Login');
    file.setEntryField(id, 'UserName', 'admin');
    file.setEntryField(id, 'Password', 's3cr3t!', true);
    file.setEntryField(id, 'URL', 'https://example.com');
    file.setEntryTags(id, ['work', 'important']);

    const data = await file.save();
    expect(data.byteLength).toBeGreaterThan(0);

    const reopened = await KdbxFile.open({ name: 'RT', password: 'hunter2', fileData: data });
    const found = reopened.getAllEntries().find((e) => e.title === 'My Login');
    expect(found).toBeDefined();
    expect(found!.username).toBe('admin');
    expect(found!.password).toBe('s3cr3t!');
    expect(found!.passwordProtected).toBe(true);
    expect(found!.url).toBe('https://example.com');
    expect(found!.tags.sort()).toEqual(['important', 'work']);
  });

  it('fails to open with the wrong password', async () => {
    const file = await KdbxFile.create({ name: 'Locked', password: 'right' });
    const data = await file.save();
    await expect(KdbxFile.open({ name: 'Locked', password: 'wrong', fileData: data })).rejects.toThrow();
  });

  it('moves entries to trash and reports inTrash', async () => {
    const file = await KdbxFile.create({ name: 'Trash', password: 'p' });
    const rootId = file.getGroupTree().id;
    const entry = file.createEntry(rootId);
    const id = entry.uuid.id;
    file.setEntryField(id, 'Title', 'Doomed');
    file.deleteEntry(id); // moves to recycle bin (KDBX4 has one by default)

    const all = file.getAllEntries(true);
    const doomed = all.find((e) => e.title === 'Doomed');
    expect(doomed?.inTrash).toBe(true);
    // Not visible when trash excluded.
    expect(file.getAllEntries(false).some((e) => e.title === 'Doomed')).toBe(false);
  });

  it('creates nested groups and counts entries', async () => {
    const file = await KdbxFile.create({ name: 'Groups', password: 'p' });
    const rootId = file.getGroupTree().id;
    const group = file.createGroup(rootId, 'Social');
    const gid = group.uuid.id;
    const e = file.createEntry(gid);
    file.setEntryField(e.uuid.id, 'Title', 'Twitter');

    const tree = file.getGroupTree();
    const social = tree.children.find((g) => g.name === 'Social');
    expect(social).toBeDefined();
    expect(social!.entryCount).toBe(1);
  });

  it('manages custom fields and history', async () => {
    const file = await KdbxFile.create({ name: 'Fields', password: 'p' });
    const rootId = file.getGroupTree().id;
    const entry = file.createEntry(rootId);
    const id = entry.uuid.id;
    file.setEntryField(id, 'Title', 'Server');
    file.setEntryField(id, 'API Key', 'abc123', true);

    let vm = file.entryToVm(entry);
    expect(vm.fields.find((f) => f.name === 'API Key')?.value).toBe('abc123');
    expect(vm.fields.find((f) => f.name === 'API Key')?.protected).toBe(true);

    // editing pushes history
    file.setEntryField(id, 'API Key', 'xyz789', true);
    vm = file.entryToVm(entry);
    expect(vm.historyLength).toBeGreaterThan(0);
    expect(vm.fields.find((f) => f.name === 'API Key')?.value).toBe('xyz789');

    file.removeField(id, 'API Key');
    expect(file.entryToVm(entry).fields.find((f) => f.name === 'API Key')).toBeUndefined();
  });

  it('applies file meta settings and round-trips them', async () => {
    const file = await KdbxFile.create({ name: 'Meta', password: 'p' });
    file.setDefaultUser('alice');
    file.setHistoryMaxItems(20);
    file.setKdf('AES');
    file.setFormatVersion(3);
    expect(file.defaultUser).toBe('alice');
    expect(file.historyMaxItems).toBe(20);

    const data = await file.save();
    const reopened = await KdbxFile.open({ name: 'Meta', password: 'p', fileData: data });
    expect(reopened.defaultUser).toBe('alice');
    expect(reopened.db.versionMajor).toBe(3);
    expect(reopened.readKdfName()).toBe('AES');
  });

  it('merges a remote copy (CRDT union of both sides)', async () => {
    const local = await KdbxFile.create({ name: 'Sync', password: 'p' });
    const rootId = local.getGroupTree().id;
    const base = await local.save();

    // A second replica opened from the same bytes/credentials.
    const remote = await KdbxFile.open({ name: 'Sync', password: 'p', fileData: base });
    const remoteRoot = remote.getGroupTree().id;
    const rEntry = remote.createEntry(remoteRoot);
    remote.setEntryField(rEntry.uuid.id, 'Title', 'FromRemote');
    const remoteData = await remote.save();

    // Local adds its own entry, then merges the remote in.
    const lEntry = local.createEntry(rootId);
    local.setEntryField(lEntry.uuid.id, 'Title', 'FromLocal');
    await local.mergeRemote(remoteData);

    const titles = local.getAllEntries(true).map((e) => e.title);
    expect(titles).toContain('FromLocal');
    expect(titles).toContain('FromRemote');
  });
});

describe('KdbxFile entry-VM caching', () => {
  it('keeps VM identity stable across an unrelated entry edit, rebuilds after own edit', async () => {
    const file = await KdbxFile.create({ name: 'Cache', password: 'p' });
    const rootId = file.getGroupTree().id;
    const a = file.createEntry(rootId);
    const b = file.createEntry(rootId);
    file.setEntryField(a.uuid.id, 'Title', 'A');
    file.setEntryField(b.uuid.id, 'Title', 'B');

    const before = file.getAllEntries(true);
    const vmA = before.find((e) => e.id === a.uuid.id)!;
    const vmB = before.find((e) => e.id === b.uuid.id)!;

    // Editing B must not rebuild A's VM (cache hit → same object identity).
    file.setEntryField(b.uuid.id, 'Title', 'B2');
    const after = file.getAllEntries(true);
    expect(after.find((e) => e.id === a.uuid.id)).toBe(vmA);
    const vmB2 = after.find((e) => e.id === b.uuid.id)!;
    expect(vmB2).not.toBe(vmB);
    expect(vmB2.title).toBe('B2');

    // Editing A itself invalidates its cached VM.
    file.setEntryField(a.uuid.id, 'UserName', 'admin');
    const vmA2 = file.getAllEntries(true).find((e) => e.id === a.uuid.id)!;
    expect(vmA2).not.toBe(vmA);
    expect(vmA2.username).toBe('admin');
  });

  it('invalidates cached VMs on structural changes (group rename, move, delete-to-trash)', async () => {
    const file = await KdbxFile.create({ name: 'Cache2', password: 'p' });
    const rootId = file.getGroupTree().id;
    const group = file.createGroup(rootId, 'Work');
    const entry = file.createEntry(group.uuid.id);
    const id = entry.uuid.id;
    file.setEntryField(id, 'Title', 'E');

    const vm1 = file.getAllEntries(true).find((e) => e.id === id)!;
    expect(vm1.groupPath).toEqual(['Work']);

    // Group rename changes groupPath without touching the entry's own times.
    file.renameGroup(group.uuid.id, 'Play');
    const vm2 = file.getAllEntries(true).find((e) => e.id === id)!;
    expect(vm2).not.toBe(vm1);
    expect(vm2.groupPath).toEqual(['Play']);

    // Move changes groupId/groupPath (kdbxweb updates locationChanged only).
    const other = file.createGroup(rootId, 'Other');
    file.moveEntry(id, other.uuid.id);
    const vm3 = file.getAllEntries(true).find((e) => e.id === id)!;
    expect(vm3).not.toBe(vm2);
    expect(vm3.groupId).toBe(other.uuid.id);
    expect(vm3.groupPath).toEqual(['Other']);

    // Delete moves to the recycle bin — inTrash must flip in a fresh VM.
    file.deleteEntry(id);
    const vm4 = file.getAllEntries(true).find((e) => e.id === id)!;
    expect(vm4).not.toBe(vm3);
    expect(vm4.inTrash).toBe(true);
  });

  it('reflects history deletions that do not touch entry times', async () => {
    const file = await KdbxFile.create({ name: 'Cache3', password: 'p' });
    const rootId = file.getGroupTree().id;
    const entry = file.createEntry(rootId);
    const id = entry.uuid.id;
    file.setEntryField(id, 'Title', 'v1');
    file.setEntryField(id, 'Title', 'v2');

    const vm1 = file.getAllEntries(true).find((e) => e.id === id)!;
    const historyBefore = vm1.historyLength;
    expect(historyBefore).toBeGreaterThan(0);

    file.deleteHistory(id, 0);
    const vm2 = file.getAllEntries(true).find((e) => e.id === id)!;
    expect(vm2).not.toBe(vm1);
    expect(vm2.historyLength).toBe(historyBefore - 1);
  });
});
