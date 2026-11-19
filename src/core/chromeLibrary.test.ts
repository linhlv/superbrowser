import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeTimeToMs, parseChromeBookmarks, mapChromeVisits, librarySummaryLine, libraryImportOutcome } from './chromeLibrary.ts';
import type { ChromeVisitRow, LibraryImportResult } from './chromeLibrary.ts';

const toChrome = (ms: number) => String((BigInt(ms) + 11_644_473_600_000n) * 1000n);

test('chromeTimeToMs converts µs since 1601 to ms since 1970; junk is 0', () => {
  assert.equal(chromeTimeToMs('13406745600000000'), Date.parse('2025-11-04T16:00:00Z'));
  assert.equal(chromeTimeToMs('0'), 0);
  assert.equal(chromeTimeToMs('abc'), 0);
  assert.equal(chromeTimeToMs('1'), 0); // before 1970
  assert.equal(chromeTimeToMs(1000), 0);
});

test('parseChromeBookmarks reads the three roots', () => {
  const p = parseChromeBookmarks(JSON.stringify({ roots: {
    bookmark_bar: { children: [
      { type: 'url', name: 'A', url: 'https://a.test/', date_added: '13406745600000000' },
      { type: 'folder', name: 'F', date_added: '0', children: [{ type: 'url', name: 'B', url: 'https://b.test/' }] },
    ] },
    other: { children: [{ type: 'url', name: 'O', url: 'https://o.test/' }] },
    synced: { children: [{ type: 'url', name: 'M', url: 'https://m.test/' }] },
  } }))!;
  const t = Date.parse('2025-11-04T16:00:00Z');
  assert.deepEqual(p.bar, [
    { kind: 'url', title: 'A', url: 'https://a.test/', added: t },
    { kind: 'folder', title: 'F', added: 0, children: [{ kind: 'url', title: 'B', url: 'https://b.test/', added: 0 }] },
  ]);
  assert.deepEqual(p.other, [{ kind: 'url', title: 'O', url: 'https://o.test/', added: 0 }]);
  assert.deepEqual(p.mobile, [{ kind: 'url', title: 'M', url: 'https://m.test/', added: 0 }]);
});

test('parseChromeBookmarks tolerates odd shapes', () => {
  assert.equal(parseChromeBookmarks('{not json'), null);
  assert.equal(parseChromeBookmarks('[]'), null);
  assert.deepEqual(parseChromeBookmarks('{}'), { bar: [], other: [], mobile: [] });
  const p = parseChromeBookmarks(JSON.stringify({ roots: { bookmark_bar: { children: [
    { type: 'folder', name: null },
    { type: 'url', name: 'JS', url: 'javascript:void 0' },
    { type: 'weird' }, 42,
  ] } } }))!;
  assert.equal(p.bar.length, 2);
  assert.deepEqual(p.bar[0], { kind: 'folder', title: '', added: 0, children: [] });
});

test('mapChromeVisits skips hidden, non-web, zero-time and old visits', () => {
  const now = Date.parse('2025-11-19T00:00:00Z');
  const day = 86_400_000;
  const row = (o: Partial<ChromeVisitRow>): ChromeVisitRow =>
    ({ url: 'https://a.test/', title: 'A', typed_count: 2, hidden: 0, visit_time: toChrome(now - day), ...o });
  const { visits, skipped } = mapChromeVisits([
    row({}),
    row({ hidden: 1 }),
    row({ url: 'chrome://settings' }),
    row({ visit_time: '0' }),
    row({ visit_time: toChrome(now - 100 * day) }),
    row({ visit_time: toChrome(now - 89 * day), title: null as unknown as string }),
  ], now);
  assert.equal(skipped, 4);
  assert.deepEqual(visits, [
    { url: 'https://a.test/', title: 'A', typedCount: 2, time: now - day },
    { url: 'https://a.test/', title: '', typedCount: 2, time: now - 89 * day },
  ]);
});

const result = (b: { added: number; skipped: number; failed?: boolean }, h: { pages: number; added: number; skipped: number; failed?: boolean }): LibraryImportResult =>
  ({ bookmarks: { failed: false, ...b }, history: { failed: false, ...h } });

test('librarySummaryLine', () => {
  assert.equal(librarySummaryLine('Personal', result({ added: 175, skipped: 2 }, { pages: 12685, added: 25540, skipped: 1 })),
    'Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped).');
  assert.equal(librarySummaryLine('Work', result({ added: 1, skipped: 0 }, { pages: 1, added: 1, skipped: 0 })),
    'Work: 1 bookmark, 1 page of history imported.');
  assert.equal(librarySummaryLine('Personal', result({ added: 0, skipped: 175 }, { pages: 0, added: 0, skipped: 30 })),
    'Personal: 0 bookmarks, 0 pages of history imported (205 skipped).');
});

test('librarySummaryLine says which part couldn\'t be read', () => {
  assert.equal(librarySummaryLine('Personal', result({ added: 175, skipped: 0 }, { pages: 0, added: 0, skipped: 0, failed: true })),
    'Personal: 175 bookmarks imported; history couldn\'t be read — try again.');
  assert.equal(librarySummaryLine('Personal', result({ added: 175, skipped: 3 }, { pages: 0, added: 0, skipped: 0, failed: true })),
    'Personal: 175 bookmarks imported (3 skipped); history couldn\'t be read — try again.');
  assert.equal(librarySummaryLine('Work', result({ added: 0, skipped: 0, failed: true }, { pages: 12685, added: 25540, skipped: 0 })),
    'Work: 12,685 pages of history imported; bookmarks couldn\'t be read — try again.');
  // one of Bookmarks/AccountBookmarks was read, the other wasn't
  assert.equal(librarySummaryLine('Work', result({ added: 4, skipped: 0, failed: true }, { pages: 3, added: 4, skipped: 0 })),
    'Work: 4 bookmarks, 3 pages of history imported; some bookmarks couldn\'t be read — try again.');
  assert.equal(librarySummaryLine('Work', result({ added: 0, skipped: 0, failed: true }, { pages: 0, added: 0, skipped: 0, failed: true })),
    'Work: bookmarks and history couldn\'t be read — try again.');
});

test('libraryImportOutcome: a warning when anything failed; not "Imported" when nothing could be', () => {
  const ok = result({ added: 1, skipped: 0 }, { pages: 1, added: 1, skipped: 0 });
  const historyFailed = result({ added: 1, skipped: 0 }, { pages: 0, added: 0, skipped: 0, failed: true });
  const allFailed = result({ added: 0, skipped: 0, failed: true }, { pages: 0, added: 0, skipped: 0, failed: true });
  const imported = 'Imported bookmarks and history from Chrome.';
  const nothing = 'No bookmarks or history were imported.';
  assert.deepEqual(libraryImportOutcome([ok, ok]), { warning: false, title: imported });
  assert.deepEqual(libraryImportOutcome([ok, historyFailed]), { warning: true, title: imported });
  assert.deepEqual(libraryImportOutcome([ok, null]), { warning: true, title: imported }); // null: the import threw
  assert.deepEqual(libraryImportOutcome([allFailed, null]), { warning: true, title: nothing });
  assert.deepEqual(libraryImportOutcome([historyFailed]), { warning: true, title: imported });
});
