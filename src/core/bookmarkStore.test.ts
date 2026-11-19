import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profileDataDir, loadBookmarks, saveBookmarks } from './bookmarkStore.ts';
import { emptyTree, decodeTree } from './bookmarks.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bm-'));
}

test('profileDataDir keeps Chrome dir names, rejects unsafe ones', () => {
  assert.equal(profileDataDir('/base', 'Profile 37'), path.join('/base', 'Profiles', 'Profile 37'));
  assert.equal(profileDataDir('/base', 'Default'), path.join('/base', 'Profiles', 'Default'));
  for (const d of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a\0b']) assert.throws(() => profileDataDir('/base', d));
});

test('bookmarks round-trip through the file', () => {
  const file = path.join(tmp(), 'Profiles', 'Default', 'bookmarks.json');
  const tree = decodeTree({
    nextId: 3,
    nodes: [
      { id: 1, kind: 'url', title: 'A', url: 'https://a.example/', added: 5 },
      { id: 2, kind: 'folder', title: 'F', added: 6, children: [{ id: 3, kind: 'url', title: 'B', url: 'http://b.example/', added: 7 }] },
    ],
  });
  assert.equal(tree.nodes.length, 2);
  saveBookmarks(file, tree);
  assert.deepEqual(loadBookmarks(file), tree);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(JSON.stringify(tree)));
});

test('a missing file loads as an empty tree', () => {
  const dir = tmp();
  assert.deepEqual(loadBookmarks(path.join(dir, 'bookmarks.json')), emptyTree());
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a corrupt file is set aside and loads empty', () => {
  const dir = tmp();
  const file = path.join(dir, 'bookmarks.json');
  fs.writeFileSync(file, '{oops');
  assert.deepEqual(loadBookmarks(file), emptyTree());
  const names = fs.readdirSync(dir);
  assert.equal(names.length, 1);
  assert.ok(names[0]!.startsWith('bookmarks.json.corrupt-'));
});
