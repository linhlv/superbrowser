import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryDb } from './history.ts';
import { splitWords, dayOf } from './searchText.ts';

const T0 = 1_700_000_000_000;
let dir: string;
let db: HistoryDb;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hist-')); db = HistoryDb.open(join(dir, 'history.db'), () => {}); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const urls = (words: string[]) => db.candidates(words, 50).map((e) => e.url);

test('recordVisit counts visits and typed visits', () => {
  db.recordVisit('https://a.test/', T0, true);
  db.recordVisit('https://a.test/', T0 + 5, false);
  db.recordVisit('https://a.test/', T0 + 5, true); // exact duplicate ignored
  db.recordVisit('ftp://a.test/', T0, false);
  const [e] = db.candidates(['a.test'], 10);
  assert.equal(e.visitCount, 2);
  assert.equal(e.typedCount, 1);
  assert.equal(e.lastVisit, T0 + 5);
  assert.equal(db.candidates(['ftp'], 10).length, 0);
});

test('all words must match url or title', () => {
  db.recordVisit('https://jira.acme.test/board', T0, false);
  db.setTitle('https://jira.acme.test/board', 'Sprint Board');
  assert.deepEqual(urls(['jira', 'sprint']), ['https://jira.acme.test/board']);
  assert.deepEqual(urls(['jira', 'nope']), []);
  assert.deepEqual(urls([]), []);
});

test('search ignores case and Vietnamese diacritics', () => {
  db.recordVisit('https://hr.test/1', T0, false); db.setTitle('https://hr.test/1', 'Nguyễn Thị Thanh Nhã — Hồ sơ');
  db.recordVisit('https://travel.test/', T0, false); db.setTitle('https://travel.test/', 'Đà Nẵng');
  for (const q of ['nguyen', 'NHÃ', 'ho so']) assert.equal(db.candidates(splitWords(q), 10)[0]?.url, 'https://hr.test/1', q);
  assert.equal(db.candidates(splitWords('da nang'), 10)[0]?.url, 'https://travel.test/');
});

test('search treats % _ and quotes literally', () => {
  db.recordVisit('https://p.test/1', T0, false); db.setTitle('https://p.test/1', '100% done');
  db.recordVisit('https://p.test/2', T0, false); db.setTitle('https://p.test/2', 'axb');
  db.recordVisit('https://p.test/3', T0, false); db.setTitle('https://p.test/3', "it's here");
  assert.deepEqual(urls(['100%']), ['https://p.test/1']);
  assert.deepEqual(urls(['a_b']), []);
  assert.deepEqual(urls(["it's"]), ['https://p.test/3']);
});

test('touch updates lastVisit only, and only for known URLs', () => {
  db.recordVisit('https://a.test/', T0, false);
  db.touch('https://a.test/', T0 + 100);
  db.touch('https://a.test/', T0 + 50);
  db.touch('https://unknown.test/', T0);
  const [e] = db.candidates(['a.test'], 10);
  assert.equal(e.lastVisit, T0 + 100);
  assert.equal(e.visitCount, 1);
  assert.equal(db.candidates(['unknown'], 10).length, 0);
  assert.equal(db.page('', null, 10, 0).rows.length, 1);
});

test('page: one row per URL per day, newest first, with paging', () => {
  const day0 = Date.parse('2025-11-18T00:00:00Z');
  db.recordVisit('https://a.test/', day0 + 10 * 3600e3, false);
  db.recordVisit('https://a.test/', day0 + 11 * 3600e3, false);
  db.recordVisit('https://b.test/', day0 + 9 * 3600e3, false);
  db.recordVisit('https://a.test/', day0 - 3600e3, false);
  const p1 = db.page('', null, 2, 0);
  assert.deepEqual(p1.rows.map((r) => [r.url, r.time]), [['https://a.test/', day0 + 11 * 3600e3], ['https://b.test/', day0 + 9 * 3600e3]]);
  assert.equal(p1.more, true);
  const p2 = db.page('', p1.rows.at(-1)!.time, 2, 0);
  assert.deepEqual(p2.rows.map((r) => r.day), [dayOf(day0 - 3600e3, 0)]);
  assert.equal(p2.more, false);
});

test('page filters by query and honours the timezone', () => {
  const t = Date.parse('2025-11-18T23:30:00Z');
  db.recordVisit('https://a.test/', t, false);
  db.recordVisit('https://b.test/', t, false);
  assert.deepEqual(db.page('a.test', null, 10, 0).rows.map((r) => r.url), ['https://a.test/']);
  assert.equal(db.page('', null, 10, -60).rows[0].day, dayOf(t, -60));
  assert.equal(db.page('', null, 10, -60).rows[0].day, dayOf(t, 0) + 1);
  const early = Date.parse('1969-12-31T23:00:00Z'); // negative time
  db.recordVisit('https://old.test/', early, false);
  assert.equal(db.page('old', null, 10, 0).rows[0].day, -1);
});

test('deleteUrl removes every visit of the page', () => {
  db.recordVisit('https://a.test/', T0, false); db.recordVisit('https://a.test/', T0 + DAYS, false);
  db.recordVisit('https://b.test/', T0, false);
  db.deleteUrl('https://a.test/');
  assert.deepEqual(urls(['test']), ['https://b.test/']);
  assert.deepEqual(db.page('', null, 10, 0).rows.map((r) => r.url), ['https://b.test/']);
});
const DAYS = 86_400_000;

test('clear empties history', () => {
  db.recordVisit('https://a.test/', T0, false);
  db.clear();
  assert.deepEqual(urls(['test']), []);
  assert.equal(db.page('', null, 10, 0).rows.length, 0);
});

test('prune drops old visits and pages left with none', () => {
  db.recordVisit('https://old.test/', T0, false);
  db.recordVisit('https://mix.test/', T0, false); db.recordVisit('https://mix.test/', T0 + 2 * DAYS, false);
  assert.equal(db.prune(T0 + DAYS), 2);
  assert.deepEqual(urls(['test']), ['https://mix.test/']);
  assert.equal(db.page('', null, 10, 0).rows.length, 1);
});

test('importVisits adds once, keeps max typed count, fills empty titles only', () => {
  db.recordVisit('https://a.test/', T0 - 1, true);
  db.setTitle('https://a.test/', 'Mine');
  const visits = [
    { url: 'https://a.test/', title: 'Theirs', typedCount: 5, time: T0 },
    { url: 'https://b.test/', title: 'B', typedCount: 0, time: T0 },
    { url: 'https://b.test/', title: 'B', typedCount: 0, time: T0 + 1 },
    { url: 'file:///x', title: 'x', typedCount: 0, time: T0 },
  ];
  assert.deepEqual(db.importVisits(visits), { added: 3, pages: 2, skipped: 1 });
  assert.deepEqual(db.importVisits(visits), { added: 0, pages: 0, skipped: 4 });
  const a = db.candidates(['a.test'], 1)[0];
  assert.equal(a.title, 'Mine');
  assert.equal(a.typedCount, 5);
  assert.equal(a.visitCount, 2);
  assert.equal(a.lastVisit, T0);
  assert.equal(db.candidates(['b.test'], 1)[0].title, 'B');
  assert.equal(db.candidates(['b.test'], 1)[0].visitCount, 2);
});

test('faviconsFor returns known favicons', () => {
  db.recordVisit('https://a.test/', T0, false); db.recordVisit('https://b.test/', T0, false);
  db.setFavicon('https://a.test/', 'data:image/png;base64,AA');
  db.setFavicon('https://nope.test/', 'x');
  assert.deepEqual(db.faviconsFor(['https://a.test/', 'https://b.test/', 'https://nope.test/']), { 'https://a.test/': 'data:image/png;base64,AA' });
  assert.deepEqual(db.faviconsFor([]), {});
  assert.equal(db.page('', null, 10, 0).rows.find((r) => r.url === 'https://a.test/')?.favicon, 'data:image/png;base64,AA');
});

test('a corrupt database is set aside and recreated', () => {
  const file = join(dir, 'bad', 'history.db');
  const dir2 = join(dir, 'bad');
  db.close();
  rmSync(dir2, { recursive: true, force: true });
  HistoryDb.open(file, () => {}).close();
  writeFileSync(file, 'not a database'.repeat(100));
  const msgs: string[] = [];
  const fresh = HistoryDb.open(file, (m) => msgs.push(m));
  fresh.recordVisit('https://a.test/', T0, false);
  assert.equal(fresh.candidates(['a.test'], 1).length, 1);
  fresh.close();
  assert.ok(readdirSync(dir2).some((f) => f.startsWith('history.db.corrupt-')));
  assert.equal(msgs.length, 1);
  db = HistoryDb.open(join(dir, 'history.db'), () => {});
});

test('candidates stays fast with a large history', () => {
  const visits = [];
  for (let i = 0; i < 12_000; i++) visits.push({ url: `https://site${i}.test/${i % 7 === 0 ? 'jira' : 'p'}`, title: `Page ${i}`, typedCount: i % 5, time: T0 + i });
  for (let i = 0; i < 18_000; i++) visits.push({ url: `https://site${i % 12_000}.test/${(i % 12_000) % 7 === 0 ? 'jira' : 'p'}`, title: `Page`, typedCount: 0, time: T0 + 20_000 + i });
  db.importVisits(visits);
  db.candidates(['jira'], 50);
  const t = performance.now();
  const r = db.candidates(['jira'], 50);
  assert.equal(r.length, 50);
  assert.ok(performance.now() - t < 50);
});
