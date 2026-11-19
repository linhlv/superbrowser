import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { flattenBookmarks } from '../core/bookmarks.ts';
import { HistoryDb } from '../core/history.ts';
import { DAY_MS } from '../core/searchText.ts';
import { Library } from './library.ts';
import { LibraryImporter } from './libraryImport.ts';

// Only a temp fixture is ever used as Chrome's dir; the real one is never touched.
const NOW = 1_800_000_000_000;
const chromeTime = (ms: number) => ((BigInt(ms) + 11_644_473_600_000n) * 1000n).toString();

let root: string;
let chromeDir: string;
let profileDir: string;
let logs: string[];
let library: Library;
let writer: DatabaseSync | null;
let importer: LibraryImporter;

const url = (name: string, u: string) => ({ type: 'url', name, url: u, date_added: chromeTime(NOW - DAY_MS) });
const chromeBookmarks = (bar: unknown[], other: unknown[] = []) => JSON.stringify({
  roots: {
    bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: bar },
    other: { type: 'folder', name: 'Other bookmarks', children: other },
    synced: { type: 'folder', name: 'Mobile bookmarks', children: [] },
  },
  version: 1,
});

function writeFixture(): void {
  writeFileSync(join(profileDir, 'Bookmarks'), chromeBookmarks(
    [url('A', 'https://a.test/'), url('B', 'https://b.test/'),
      { type: 'folder', name: 'Work', date_added: chromeTime(NOW - DAY_MS), children: [url('C', 'https://c.test/')] }],
    [url('D', 'https://d.test/')],
  ));
  writeFileSync(join(profileDir, 'AccountBookmarks'), chromeBookmarks([url('E', 'https://e.test/')]));

  const db = new DatabaseSync(join(profileDir, 'History'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER);
    CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, from_visit INTEGER, transition INTEGER);`);
  const addUrl = db.prepare('INSERT INTO urls(id, url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, 0, ?)');
  const addVisit = db.prepare('INSERT INTO visits(url, visit_time, from_visit, transition) VALUES (?, CAST(? AS INTEGER), 0, 0)');
  addUrl.run(1, 'https://news.test/', 'News', 2, 0);
  addUrl.run(2, 'https://mail.test/', 'Mail', 0, 0);
  addUrl.run(3, 'https://secret.test/', 'Hidden', 0, 1);
  addUrl.run(4, 'chrome://settings/', 'Settings', 0, 0);
  addVisit.run(1, chromeTime(NOW - 2 * DAY_MS));
  addVisit.run(1, chromeTime(NOW - 3 * DAY_MS));
  addVisit.run(2, chromeTime(NOW - 4 * DAY_MS));
  addVisit.run(3, chromeTime(NOW - 4 * DAY_MS)); // hidden: skipped
  addVisit.run(4, chromeTime(NOW - 4 * DAY_MS)); // not a web URL: skipped
  addVisit.run(2, chromeTime(NOW - 120 * DAY_MS)); // older than 90 days: skipped
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  // Written after the last checkpoint, with checkpoints off: only in History-wal.
  addUrl.run(5, 'https://recent.test/', 'Recent', 0, 0);
  addVisit.run(5, chromeTime(NOW - 60_000));
  writer = db; // left open while importing, like a running Chrome
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sb-library-import-'));
  chromeDir = join(root, 'Chrome');
  profileDir = join(chromeDir, 'Default');
  mkdirSync(profileDir, { recursive: true });
  logs = [];
  writer = null;
  library = new Library(join(root, 'Superbrowser'), (m) => logs.push(m), () => NOW);
  importer = new LibraryImporter({ library, log: (m) => logs.push(m), chromeDir, now: () => NOW });
});
afterEach(() => {
  writer?.close();
  library.closeAll();
  rmSync(root, { recursive: true, force: true });
});

const historyUrls = (db: HistoryDb) => db.candidates(['test'], 50).map((e) => e.url).sort();

test('imports bookmarks from both files and history visits', async () => {
  writeFixture();
  const r = await importer.importProfile('Default');
  assert.deepEqual(r, { bookmarks: { added: 5, skipped: 0 }, history: { pages: 3, added: 4, skipped: 3 } });
  assert.deepEqual(flattenBookmarks(library.updateBookmarks('Default', (t) => t).nodes).map((b) => b.url).sort(),
    ['https://a.test/', 'https://b.test/', 'https://c.test/', 'https://d.test/', 'https://e.test/']);
  assert.deepEqual(historyUrls(library.history('Default')), ['https://mail.test/', 'https://news.test/', 'https://recent.test/']);
  const news = library.history('Default').candidates(['news'], 5)[0];
  assert.equal(news?.visitCount, 2);
  assert.equal(news?.typedCount, 2);
  assert.equal(news?.title, 'News');
});

test('reads visits still in Chrome\'s WAL', async () => {
  writeFixture();
  assert.ok(statSync(join(profileDir, 'History-wal')).size > 0);
  await importer.importProfile('Default');
  const recent = library.history('Default').candidates(['recent'], 5);
  assert.deepEqual(recent.map((e) => [e.url, e.title, e.lastVisit]), [['https://recent.test/', 'Recent', NOW - 60_000]]);
});

test('a second import adds nothing', async () => {
  writeFixture();
  await importer.importProfile('Default');
  const again = await importer.importProfile('Default');
  assert.equal(again.bookmarks.added, 0);
  assert.equal(again.history.added, 0);
  assert.equal(again.history.pages, 0);
  assert.equal(flattenBookmarks(library.updateBookmarks('Default', (t) => t).nodes).length, 5);
});

test('missing files count as zero', async () => {
  mkdirSync(join(chromeDir, 'Profile 1'));
  const zero = { bookmarks: { added: 0, skipped: 0 }, history: { pages: 0, added: 0, skipped: 0 } };
  assert.deepEqual(await importer.importProfile('Profile 1'), zero);
  assert.deepEqual(await importer.importProfile('Profile 9'), zero); // no profile dir at all
});

test('an unreadable file is logged and the other parts still import', async () => {
  writeFixture();
  writeFileSync(join(profileDir, 'AccountBookmarks'), '{ not json');
  writer?.close();
  writer = null;
  writeFileSync(join(profileDir, 'History'), 'not a database, just text that is long enough to be read');
  rmSync(join(profileDir, 'History-wal'), { force: true });
  rmSync(join(profileDir, 'History-shm'), { force: true });
  const r = await importer.importProfile('Default');
  assert.deepEqual(r, { bookmarks: { added: 4, skipped: 0 }, history: { pages: 0, added: 0, skipped: 0 } });
  assert.ok(logs.some((m) => m.includes('AccountBookmarks')), logs.join('\n'));
  assert.ok(logs.some((m) => m.includes('History')), logs.join('\n'));
});

test('Chrome\'s files are unchanged', async () => {
  writeFixture();
  const snapshot = () => Object.fromEntries(readdirSync(profileDir).sort().map((name) => {
    const file = join(profileDir, name);
    const { mtimeMs, size } = statSync(file);
    return [name, { sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), mtimeMs, size }];
  }));
  const tempCopies = () => readdirSync(tmpdir()).filter((n) => n.startsWith('sb-chrome-')).length;
  const before = snapshot();
  const copiesBefore = tempCopies();
  assert.ok('History-wal' in before && 'Bookmarks' in before && 'AccountBookmarks' in before);
  await importer.importProfile('Default');
  assert.deepEqual(snapshot(), before);
  assert.equal(tempCopies(), copiesBefore, 'the temp copy is removed');
});
