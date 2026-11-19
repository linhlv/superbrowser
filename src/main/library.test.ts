import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addBookmark, flattenBookmarks } from '../core/bookmarks.ts';
import { HistoryDb } from '../core/history.ts';
import { DAY_MS } from '../core/searchText.ts';
import { Library } from './library.ts';

const NOW = 1_800_000_000_000;
let base: string;
let logs: string[];
let library: Library;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sb-library-'));
  logs = [];
  library = new Library(base, (m) => logs.push(m), () => NOW);
});
afterEach(() => {
  library.closeAll();
  rmSync(base, { recursive: true, force: true });
});
const urls = (db: HistoryDb, word: string) => db.candidates([word], 50).map((e) => e.url);

test('files live under <base>/Profiles/<dir>', () => {
  library.history('Profile 3');
  library.updateBookmarks('Profile 3', (t) => addBookmark(t, { title: 'A', url: 'https://a.test/' }, NOW).tree);
  assert.ok(existsSync(join(base, 'Profiles', 'Profile 3', 'history.db')));
  assert.ok(existsSync(join(base, 'Profiles', 'Profile 3', 'bookmarks.json')));
});

test('each profile has its own history and bookmarks', () => {
  library.history('Default').recordVisit('https://only-default.test/', NOW, false);
  library.updateBookmarks('Default', (t) => addBookmark(t, { title: 'A', url: 'https://a.test/' }, NOW).tree);
  assert.deepEqual(urls(library.history('Default'), 'only-default'), ['https://only-default.test/']);
  assert.deepEqual(urls(library.history('Profile 1'), 'only-default'), []);
  assert.equal(flattenBookmarks(library.bookmarks('Default').nodes).length, 1);
  assert.equal(flattenBookmarks(library.bookmarks('Profile 1').nodes).length, 0);
});

test('history is opened lazily, once per profile', () => {
  assert.ok(!existsSync(join(base, 'Profiles', 'Default', 'history.db')));
  const db = library.history('Default');
  assert.equal(library.history('Default'), db);
  assert.notEqual(library.history('Profile 1'), db);
});

test('opening prunes visits older than 90 days', () => {
  const file = join(base, 'Profiles', 'Default', 'history.db');
  const seed = HistoryDb.open(file, () => {});
  seed.recordVisit('https://old.test/', NOW - 91 * DAY_MS, false);
  seed.recordVisit('https://recent.test/', NOW - 89 * DAY_MS, false);
  seed.close();
  const db = library.history('Default');
  assert.deepEqual(urls(db, 'old'), []);
  assert.deepEqual(urls(db, 'recent'), ['https://recent.test/']);
  assert.ok(logs.some((m) => /pruned 1 /.test(m)), logs.join('\n'));
});

test('bookmarks are cached, and updateBookmarks saves at once', () => {
  const empty = library.bookmarks('Default');
  assert.equal(library.bookmarks('Default'), empty);
  const next = library.updateBookmarks('Default', (t) => addBookmark(t, { title: 'A', url: 'https://a.test/' }, NOW).tree);
  assert.equal(library.bookmarks('Default'), next);
  const fresh = new Library(base, () => {}, () => NOW);
  assert.deepEqual(flattenBookmarks(fresh.bookmarks('Default').nodes).map((b) => b.url), ['https://a.test/']);
});

test('updateBookmarks that changes nothing writes nothing', () => {
  const same = library.updateBookmarks('Default', (t) => t);
  assert.equal(same, library.bookmarks('Default'));
  assert.ok(!existsSync(join(base, 'Profiles', 'Default', 'bookmarks.json')));
});

test('an unsafe profile dir throws', () => {
  assert.throws(() => library.history('..'));
  assert.throws(() => library.bookmarks('a/b'));
  assert.throws(() => library.updateBookmarks('', (t) => t));
});

test('pruneAll prunes every open database', () => {
  let now = NOW;
  const lib = new Library(base, () => {}, () => now);
  lib.history('Default').recordVisit('https://a.test/', NOW, false);
  now = NOW + 91 * DAY_MS;
  lib.pruneAll();
  assert.deepEqual(urls(lib.history('Default'), 'a'), []);
  lib.closeAll();
});

test('closeAll closes databases; the next call opens a new one', () => {
  const db = library.history('Default');
  library.closeAll();
  assert.throws(() => db.candidates(['a'], 1));
  assert.notEqual(library.history('Default'), db);
});
