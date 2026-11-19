# Bookmarks and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each Superbrowser profile gets its own bookmarks and browsing history. They're imported once from Chrome, recorded from then on, and used for address-bar suggestions, a ⌘Y history panel and a ⌘⌥B bookmarks panel in the sidebar.

**Architecture:**
- **Pure logic in `src/core`, tested under plain Node:** the bookmark tree, the Chrome file parsing and merging, the history database (built-in `node:sqlite`), suggestion ranking, and the visit classification.
- **Thin adapters in `src/main`:** they own one store per profile, hook tab navigation into history, run the import and answer the UI's requests.
- **The UI page asks main by request and reply** over validated IPC commands. Suggestions and both panels draw only inside the 240 px sidebar.

**Tech Stack:** Electron 45.3.4 (Node 24), TypeScript run by type stripping, `node:sqlite` (no native modules), `node:test` with `node:assert/strict`, and esbuild.

**Spec:** `docs/superpowers/specs/2026-11-19-bookmarks-history-design.md`. Read it with this plan; for any behaviour this plan doesn't restate, the spec decides.

## Global Constraints

**Project rules (CLAUDE.md):**
- `src/core` must never import `electron`. Imports between TS files use explicit `.ts` extensions.
- Erasable TS syntax only: no `enum`, no `namespace`, no constructor parameter properties.
- Tests sit next to sources as `*.test.ts`. Run all with `npm test`, one file with `node --test <file>`, and also run `npm run typecheck`.
- New logic goes in `src/core` with a test; `src/main` stays wiring.
- Our UI pages' CSP forbids inline styles and scripts. Set styles through classes or `element.style` from script; never use `style=""` attributes in HTML.
- Any IPC from the UI is accepted only on the UI view's `webContents.ipc` and parsed by `parseUiCommand`.
- `src/ui/*.ts` files are each built as an entry point (`scripts/build.mjs`). UI helper modules go in `src/ui/parts/`, which isn't scanned.

**Profile isolation and storage:**
- Every bookmark, history row and suggestion belongs to exactly one profile. Per-profile files live at `<userData>/Profiles/<chrome profile dir>/history.db` and `…/bookmarks.json`, reached only through `Library` (Task 8).

**Chrome's files:**
- Chrome's `Bookmarks`, `AccountBookmarks` and `History` are copied to a temp dir and read from there. Never write to them or open them in place.
- Import is add-only.

**Values from the spec:**
- History retention is 90 days.
- Suggestions show at most 6 rows plus "Search Google for …".
- Shortcuts: ⌘Y Show History, ⌘D Bookmark This Page, ⌘⌥B Show Bookmarks.
- Only `http:` and `https:` URLs are stored or imported.
- Suggestions must answer in about 50 ms or less with 25k+ visits.

**Exact copy:**
- Menu item: "Import Bookmarks and History from Chrome", in the Profiles menu and the "+" menu.
- First-run question: "Import your logins, bookmarks and history from Chrome for all profiles?"
- Summary line: "Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped)."
- Clear history prompt: "Clear all history for <profile>?"

**SQLite warning:**
- `node:sqlite` prints an ExperimentalWarning in tests and at app start. That's expected; don't suppress it globally.

## Review Focus

1. **Vietnamese text in search.** The user's profile names and pages are Vietnamese. Typing `nguyen`, `NHÃ` or `da nang` must find titles "Nguyễn …", "… Nhã …" and "Đà Nẵng". Matching ignores case and diacritics, and đ matches d. (Task 5 test `search ignores case and Vietnamese diacritics`.)
2. **Special characters in search.** `100%`, `a_b` and quotes are matched literally, never as patterns or SQL. (Task 5 test `search treats % _ and quotes literally`.)
3. **A Chrome `Bookmarks` file of unexpected shape:** missing roots, a folder without `children`, null names, a non-web URL. Import skips and counts these and never throws. (Task 3 test `parseChromeBookmarks tolerates odd shapes`.)
4. **Chrome running during import.** `History` has an uncheckpointed `-wal`, or a file is missing. The import sees the latest visits, treats missing files as zero, and leaves Chrome's files byte-identical. (Task 9 tests `reads visits still in Chrome's WAL`, `missing files count as zero`, `Chrome's files are unchanged`.)
5. **⌘D on a page that isn't a web page:** a new tab that failed to load, `about:blank`, or a `data:` URL. Nothing is added, and the panel opens without a highlight. (Task 2 test `addBookmark refuses non-web URLs`.)

---

### Task 1: Shared types and UI commands

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/address.ts` (add `isWebUrl`)
- Modify: `src/core/uiProtocol.ts`
- Test: `src/core/uiProtocol.test.ts`, `src/core/address.test.ts` (create the file if it doesn't exist)

**Interfaces:**
- Produces, in `src/shared/types.ts`:

```ts
export type Suggestion = { url: string; title: string; bookmarked: boolean };
export type HistoryRow = { url: string; title: string; time: number; day: number; favicon: string | null };
export type BookmarkNode =
  | { id: number; kind: 'url'; title: string; url: string; added: number }
  | { id: number; kind: 'folder'; title: string; added: number; children: BookmarkNode[] };
export type LibraryReply =
  | { kind: 'suggestions'; seq: number; text: string; completion: string | null; items: Suggestion[] }
  | { kind: 'historyPage'; seq: number; rows: HistoryRow[]; more: boolean }
  | { kind: 'bookmarks'; seq: number; nodes: BookmarkNode[]; favicons: Record<string, string> };
export type PanelRequest = { panel: 'history' | 'bookmarks'; mode: 'toggle' | 'show'; highlight: number | null };
// UiCommand gains:
//  | { type: 'suggest'; seq: number; text: string }
//  | { type: 'historyPage'; seq: number; query: string; before: number | null }
//  | { type: 'bookmarks'; seq: number }
//  | { type: 'openUrl'; url: string; newTab: boolean }
//  | { type: 'historyMenu'; url: string }
//  | { type: 'bookmarkMenu'; id: number }
//  | { type: 'renameBookmark'; id: number; title: string }
// IPC gains: library: 'ui:library', libraryChanged: 'ui:library-changed', panel: 'ui:panel', startRename: 'ui:start-rename'
```

- Produces, in `src/core/address.ts`: `isWebUrl(url: string): boolean`. It's true for `http:`/`https:` URLs that `new URL` parses.

- [ ] **Step 1: Write the failing tests**

```ts
// address.test.ts
test('isWebUrl: only parseable http(s) URLs', () => {
  for (const u of ['https://a.com', 'http://localhost:3000/x', 'HTTPS://A.COM/']) assert.equal(isWebUrl(u), true);
  for (const u of ['about:blank', 'data:text/html,x', 'javascript:alert(1)', 'chrome://history', 'file:///etc', 'https://', '', 'not a url'])
    assert.equal(isWebUrl(u), false);
});

// uiProtocol.test.ts — add to the accepted cases:
{ type: 'suggest', seq: 0, text: 'jira' },
{ type: 'historyPage', seq: 3, query: '', before: null },
{ type: 'historyPage', seq: 4, query: 'ho so', before: 1762272000000 },
{ type: 'bookmarks', seq: 7 },
{ type: 'openUrl', url: 'https://a.com/x', newTab: true },
{ type: 'historyMenu', url: 'https://a.com/x' },
{ type: 'bookmarkMenu', id: 5 },
{ type: 'renameBookmark', id: 5, title: 'Sprint board' },

test('parseUiCommand: rejects bad library commands', () => {
  const bad: unknown[] = [
    { type: 'suggest', seq: -1, text: 'x' }, { type: 'suggest', seq: 1.5, text: 'x' }, { type: 'suggest', seq: 1, text: 'x'.repeat(2049) },
    { type: 'historyPage', seq: 1, query: 'x', before: 'yesterday' }, { type: 'historyPage', seq: 1, query: 'x', before: Infinity },
    { type: 'bookmarks' },
    { type: 'openUrl', url: 'javascript:alert(1)', newTab: false }, { type: 'openUrl', url: 'https://a.com' },
    { type: 'historyMenu', url: 'file:///etc/passwd' },
    { type: 'bookmarkMenu', id: 0 }, { type: 'bookmarkMenu', id: '5' },
    { type: 'renameBookmark', id: 5, title: 'x'.repeat(1025) }, { type: 'renameBookmark', id: 5 },
  ];
  for (const c of bad) assert.equal(parseUiCommand(c, known), null, JSON.stringify(c).slice(0, 80));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/uiProtocol.test.ts src/core/address.test.ts`
Expected: FAIL, because `isWebUrl` isn't exported and the new commands parse to `null`.

- [ ] **Step 3: Add the types, `isWebUrl` and the `parseUiCommand` cases**

Limits:
- `seq` is a non-negative integer;
- `text`/`query` are strings of at most 2048 characters;
- `before` is `null` or a finite number;
- `id` is a positive integer;
- `title` is a string of at most 1024 characters;
- `url` must pass `isWebUrl` and be at most 8192 characters;
- `newTab` is a boolean.

Return fresh objects with only these fields, as the existing cases do.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/uiProtocol.test.ts src/core/address.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/core/address.ts src/core/address.test.ts src/core/uiProtocol.ts src/core/uiProtocol.test.ts
git commit -m "feat: types and validated UI commands for bookmarks and history"
```

---

### Task 2: Bookmark tree model

**Files:**
- Create: `src/core/bookmarks.ts`
- Test: `src/core/bookmarks.test.ts`

**Interfaces:**
- Consumes: `BookmarkNode` (Task 1) and `isWebUrl` (Task 1).
- Produces. Every function is pure and returns a new tree, leaving its input unchanged. Id `0` means the top level.

```ts
export type BookmarkTree = { version: 1; nextId: number; nodes: BookmarkNode[] }; // nodes = top level
export const TOP_LEVEL = 0;
export function emptyTree(): BookmarkTree;
export function decodeTree(raw: unknown): BookmarkTree;
export function findNode(tree: BookmarkTree, id: number): { node: BookmarkNode; parentId: number } | null;
export function findByUrl(tree: BookmarkTree, url: string): (BookmarkNode & { kind: 'url' }) | null;
export function addBookmark(tree: BookmarkTree, b: { title: string; url: string }, now: number): { tree: BookmarkTree; id: number | null };
export function addFolder(tree: BookmarkTree, parentId: number, title: string, now: number): { tree: BookmarkTree; id: number | null };
export function renameNode(tree: BookmarkTree, id: number, title: string): BookmarkTree;
export function moveNode(tree: BookmarkTree, id: number, folderId: number): BookmarkTree;
export function removeNode(tree: BookmarkTree, id: number): BookmarkTree;
export function folderChoices(tree: BookmarkTree, movingId: number | null): { id: number; path: string }[];
export function flattenBookmarks(nodes: BookmarkNode[]): { id: number; title: string; url: string; path: string }[]; // pure, no node imports: the UI uses it too
```

- [ ] **Step 1: Write the failing tests**

```ts
const T0 = 1_700_000_000_000;
function sample() { // Daily(Gmail, Reports(Weekly)), Figma
  let t = emptyTree();
  const daily = addFolder(t, TOP_LEVEL, 'Daily', T0); t = daily.tree;
  const reports = addFolder(t, daily.id!, 'Reports', T0); t = reports.tree;
  t = addBookmark(t, { title: 'Weekly', url: 'https://r.test/w' }, T0).tree; t = moveNode(t, findByUrl(t, 'https://r.test/w')!.id, reports.id!);
  t = addBookmark(t, { title: 'Gmail', url: 'https://mail.google.com/' }, T0).tree; t = moveNode(t, findByUrl(t, 'https://mail.google.com/')!.id, daily.id!);
  t = addBookmark(t, { title: 'Figma', url: 'https://figma.com/' }, T0).tree;
  return { t, daily: daily.id!, reports: reports.id! };
}
test('addBookmark puts it first at the top level with a new id', ...)       // ids strictly increase; nodes[0].title === 'Figma' in sample()
test('addBookmark refuses non-web URLs', ...)                               // 'about:blank','data:text/html,x' → id null, tree deepEqual input
test('findByUrl finds nested bookmarks', ...)                               // 'https://r.test/w' found, parentId === reports
test('renameNode trims; an empty title leaves it unchanged', ...)           // '  Mail  ' → 'Mail'; '   ' → unchanged
test('moveNode puts it first in the target; never into itself or a descendant', ...) // move daily into reports → unchanged
test('removeNode removes a folder with its contents', ...)                  // remove daily → findByUrl(gmail) null, findByUrl(weekly) null
test('folderChoices lists Top Level then folder paths, minus the moving folder subtree', () => {
  const { t, daily, reports } = sample();
  assert.deepEqual(folderChoices(t, null), [{ id: 0, path: 'Top Level' }, { id: daily, path: 'Daily' }, { id: reports, path: 'Daily / Reports' }]);
  assert.deepEqual(folderChoices(t, daily), [{ id: 0, path: 'Top Level' }]);
});
test('flattenBookmarks gives every bookmark with its folder path', ...)     // flattenBookmarks(t.nodes): Weekly → 'Daily / Reports'; Figma → ''
test('decodeTree keeps valid nodes, drops bad ones, repairs ids', () => {
  assert.deepEqual(decodeTree('garbage'), emptyTree());
  const t = decodeTree({ version: 1, nextId: 2, nodes: [
    { id: 1, kind: 'url', title: 'A', url: 'https://a.test/', added: 1 },
    { id: 1, kind: 'url', title: 'Dup id', url: 'https://b.test/', added: 1 },
    { id: 9, kind: 'url', title: 'Bad', url: 'javascript:x', added: 1 },
    { id: 4, kind: 'folder', title: 'F', added: 1 },                     // no children → []
  ] });
  assert.equal(t.nodes.length, 3);
  assert.equal(new Set(flattenBookmarks(t.nodes).map((b) => b.id)).size, 2);
  assert.ok(t.nextId > Math.max(...t.nodes.map((n) => n.id)));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/bookmarks.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `src/core/bookmarks.ts` with the signatures above**

- Ids come from `tree.nextId`.
- `decodeTree` gives duplicate or missing ids fresh ones and recomputes `nextId`.
- Non-string titles become `''`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/bookmarks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/bookmarks.ts src/core/bookmarks.test.ts
git commit -m "feat(core): per-profile bookmark tree model"
```

---

### Task 3: Reading Chrome's bookmarks and history, and merging them

**Files:**
- Create: `src/core/chromeLibrary.ts`
- Modify: `src/core/bookmarks.ts` (add `mergeChrome`)
- Test: `src/core/chromeLibrary.test.ts`, `src/core/bookmarks.test.ts`

**Interfaces:**
- Consumes: the tree functions from Task 2 and `isWebUrl`.
- Produces:

```ts
// chromeLibrary.ts
export const HISTORY_RETENTION_DAYS = 90;
export type ChromeNode = { kind: 'url'; title: string; url: string; added: number } | { kind: 'folder'; title: string; added: number; children: ChromeNode[] };
export type ChromeBookmarks = { bar: ChromeNode[]; other: ChromeNode[]; mobile: ChromeNode[] };
export type ChromeVisitRow = { url: string; title: string; typed_count: number; hidden: number; visit_time: string }; // visit_time: µs since 1601, as text
export type ImportVisit = { url: string; title: string; typedCount: number; time: number };                      // time: ms since 1970
export type LibraryImportResult = { bookmarks: { added: number; skipped: number }; history: { pages: number; added: number; skipped: number } };
export function chromeTimeToMs(t: string | number): number;
export function parseChromeBookmarks(text: string): ChromeBookmarks | null;
export function mapChromeVisits(rows: ChromeVisitRow[], nowMs: number, retentionDays?: number): { visits: ImportVisit[]; skipped: number };
export function librarySummaryLine(profileName: string, r: LibraryImportResult): string;
// bookmarks.ts
export function mergeChrome(tree: BookmarkTree, files: ChromeBookmarks[], now: number): { tree: BookmarkTree; added: number; skipped: number };
```

- [ ] **Step 1: Write the failing tests**

```ts
test('chromeTimeToMs converts µs since 1601 to ms since 1970; junk is 0', () => {
  assert.equal(chromeTimeToMs('13406745600000000'), Date.parse('2025-11-04T16:00:00Z'));
  assert.equal(chromeTimeToMs('0'), 0);
  assert.equal(chromeTimeToMs('abc'), 0);
});
test('parseChromeBookmarks reads the three roots', ...)   // bookmark_bar/other/synced → bar/other/mobile; date_added converted
test('parseChromeBookmarks tolerates odd shapes', () => {
  assert.equal(parseChromeBookmarks('{not json'), null);
  assert.deepEqual(parseChromeBookmarks('{}'), { bar: [], other: [], mobile: [] });
  const p = parseChromeBookmarks(JSON.stringify({ roots: { bookmark_bar: { children: [
    { type: 'folder', name: null },                                   // → folder '' with children []
    { type: 'url', name: 'JS', url: 'javascript:void 0' },            // kept here; mergeChrome skips it
    { type: 'weird' }, 42,                                            // dropped
  ] } } }))!;
  assert.equal(p.bar.length, 2);
});
test('mapChromeVisits skips hidden, non-web, zero-time and old visits', ...) // now = 2025-11-19; a 100-day-old visit skipped; skipped count exact
test('librarySummaryLine', () => {
  assert.equal(librarySummaryLine('Personal', { bookmarks: { added: 175, skipped: 2 }, history: { pages: 12685, added: 25540, skipped: 1 } }),
    'Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped).');
  assert.equal(librarySummaryLine('Work', { bookmarks: { added: 1, skipped: 0 }, history: { pages: 1, added: 1, skipped: 0 } }),
    'Work: 1 bookmark, 1 page of history imported.');
});

// bookmarks.test.ts
test('mergeChrome: bar at top level, other/mobile as folders only when non-empty', ...)  // folder titles exactly 'Other Bookmarks', 'Mobile Bookmarks'
test('mergeChrome appends in Chrome order and reuses folders by name path', ...)
test('mergeChrome a second time adds nothing', ...)          // added 0, skipped = number of web bookmarks
test('mergeChrome skips URLs the user already has anywhere (renamed or moved)', ...)
test('mergeChrome merges Bookmarks and AccountBookmarks into one tree', ...)  // two files, distinct URLs → both added; shared URL once
test('mergeChrome skips and counts non-web URLs', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/chromeLibrary.test.ts src/core/bookmarks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `chromeTimeToMs`: use `BigInt` (µs values exceed 2^53): `Number(BigInt(t) / 1000n) - 11644473600000`, and return 0 when the input is ≤ 0 or invalid.
- Number formatting in `librarySummaryLine`: `toLocaleString('en-US')`.
- `mergeChrome` rules come from the spec's "Bookmarks import":
  - Imported items are appended to the end of their folder.
  - Chrome folders are created even when empty, apart from the two root wrappers.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/chromeLibrary.test.ts src/core/bookmarks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/chromeLibrary.ts src/core/chromeLibrary.test.ts src/core/bookmarks.ts src/core/bookmarks.test.ts
git commit -m "feat(core): parse Chrome bookmarks and history rows; add-only merge"
```

---

### Task 4: Bookmark storage and per-profile paths

**Files:**
- Modify: `src/core/store.ts` (extract and export `writeFileAtomic`; `createStore` uses it)
- Create: `src/core/bookmarkStore.ts`
- Test: `src/core/bookmarkStore.test.ts` (keep `src/core/store.test.ts` passing unchanged)

**Interfaces:**
- Consumes: `decodeTree`, `emptyTree` and `BookmarkTree` (Task 2).
- Produces:

```ts
// store.ts
export function writeFileAtomic(file: string, text: string): void; // mkdir -p, fsynced temp file, rename
// bookmarkStore.ts
export function profileDataDir(base: string, dir: string): string;  // `${base}/Profiles/${dir}`; throws on unsafe dir
export function loadBookmarks(file: string): BookmarkTree;          // missing → empty; unreadable/corrupt → set aside as `${file}.corrupt-<ms>`, empty
export function saveBookmarks(file: string, tree: BookmarkTree): void;
```

- [ ] **Step 1: Write the failing tests** (use `fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bm-'))`)

```ts
test('profileDataDir keeps Chrome dir names, rejects unsafe ones', () => {
  assert.equal(profileDataDir('/base', 'Profile 37'), path.join('/base', 'Profiles', 'Profile 37'));
  for (const d of ['', '.', '..', '../x', 'a/b', 'a\0b']) assert.throws(() => profileDataDir('/base', d));
});
test('bookmarks round-trip through the file', ...)
test('a missing file loads as an empty tree', ...)
test('a corrupt file is set aside and loads empty', ...)  // write '{oops'; after load: readdir has one 'bookmarks.json.corrupt-' entry; original gone
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/bookmarkStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement, moving the existing atomic-write code into `writeFileAtomic`**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/bookmarkStore.test.ts src/core/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts src/core/bookmarkStore.ts src/core/bookmarkStore.test.ts
git commit -m "feat(core): atomic per-profile bookmark file"
```

---

### Task 5: History database

**Files:**
- Create: `src/core/searchText.ts`, `src/core/history.ts`
- Test: `src/core/searchText.test.ts`, `src/core/history.test.ts`

**Interfaces:**
- Consumes: `ImportVisit` and `HISTORY_RETENTION_DAYS` (Task 3), and `HistoryRow` (Task 1).
- Produces:

```ts
// searchText.ts — pure, no node imports (the UI imports it too)
export function searchKey(text: string): string;      // lowercase, NFD, strip \p{M}, đ→d
export function splitWords(text: string): string[];   // searchKey(text) split on whitespace, empties dropped
export function matchesAll(key: string, words: string[]): boolean;
export const DAY_MS = 86_400_000;
export function dayOf(timeMs: number, tzOffsetMin: number): number;  // Math.floor((timeMs - tzOffsetMin * 60_000) / DAY_MS); tzOffsetMin as Date#getTimezoneOffset
// history.ts
export type HistoryEntry = { url: string; title: string; visitCount: number; typedCount: number; lastVisit: number; favicon: string | null };
export class HistoryDb {
  static open(file: string, log: (msg: string) => void): HistoryDb;
  recordVisit(url: string, time: number, typed: boolean): void;
  touch(url: string, time: number): void;
  setTitle(url: string, title: string): void;
  setFavicon(url: string, favicon: string): void;
  importVisits(visits: ImportVisit[]): { added: number; pages: number; skipped: number };
  candidates(words: string[], limit: number): HistoryEntry[];
  page(query: string, before: number | null, limit: number, tzOffsetMin: number): { rows: HistoryRow[]; more: boolean };
  deleteUrl(url: string): void;
  clear(): void;
  prune(cutoffMs: number): number;
  faviconsFor(urls: string[]): Record<string, string>;
  close(): void;
}
```

**Schema (decided here):**
- `urls(id INTEGER PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '', search TEXT NOT NULL, visit_count INTEGER NOT NULL DEFAULT 0, typed_count INTEGER NOT NULL DEFAULT 0, last_visit INTEGER NOT NULL, favicon TEXT)`
- `visits(id INTEGER PRIMARY KEY, url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE, time INTEGER NOT NULL, UNIQUE(url_id, time))`
- `CREATE INDEX visits_time ON visits(time)`
- `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON`

**Search and paging:**
- `search` = `searchKey(url + ' ' + title)`, kept up to date by `setTitle`.
- Word matching uses `instr(search, ?) > 0` per word, a literal match with no `LIKE`.
- `page` groups visits by `(url_id, day)` in a subquery, filters `t < before` after grouping, and orders by `t DESC`. It returns `more` by fetching `limit + 1`.

- [ ] **Step 1: Write the failing tests** (temp dir per test; `tz = 0`)

```ts
test('recordVisit counts visits and typed visits', ...)   // two visits (one typed) → visitCount 2, typedCount 1, lastVisit = later time
test('all words must match url or title', ...)
test('search ignores case and Vietnamese diacritics', () => {
  db.recordVisit('https://hr.test/1', T0, false); db.setTitle('https://hr.test/1', 'Nguyễn Thị Thanh Nhã — Hồ sơ');
  db.recordVisit('https://travel.test/', T0, false); db.setTitle('https://travel.test/', 'Đà Nẵng');
  for (const q of ['nguyen', 'NHÃ', 'ho so']) assert.equal(db.candidates(splitWords(q), 10)[0]?.url, 'https://hr.test/1', q);
  assert.equal(db.candidates(splitWords('da nang'), 10)[0]?.url, 'https://travel.test/');
});
test('search treats % _ and quotes literally', ...)        // title '100% done' found by '100%'; 'a_b' not found by 'axb'; `it's` found by "it's"
test('touch updates lastVisit only, and only for known URLs', ...)
test('page: one row per URL per day, newest first, with paging', () => {
  const day0 = Date.parse('2025-11-18T00:00:00Z');
  db.recordVisit('https://a.test/', day0 + 10 * 3600e3, false);
  db.recordVisit('https://a.test/', day0 + 11 * 3600e3, false);
  db.recordVisit('https://b.test/', day0 + 9 * 3600e3, false);
  db.recordVisit('https://a.test/', day0 - 3600e3, false);       // previous day
  const p1 = db.page('', null, 2, 0);
  assert.deepEqual(p1.rows.map((r) => [r.url, r.time]), [['https://a.test/', day0 + 11 * 3600e3], ['https://b.test/', day0 + 9 * 3600e3]]);
  assert.equal(p1.more, true);
  const p2 = db.page('', p1.rows.at(-1)!.time, 2, 0);
  assert.deepEqual(p2.rows.map((r) => r.day), [dayOf(day0 - 3600e3, 0)]);
  assert.equal(p2.more, false);
});
test('deleteUrl removes every visit of the page', ...)     // gone from candidates and page()
test('clear empties history', ...)
test('prune drops old visits and pages left with none', ...) // returns number of visits deleted
test('importVisits adds once, keeps max typed count, fills empty titles only', ...) // second run: added 0, skipped n
test('faviconsFor returns known favicons', ...)
test('a corrupt database is set aside and recreated', ...)  // write 'not a database' to history.db; open works; a 'history.db.corrupt-' file exists
test('candidates stays fast with a large history', () => {    // 12,000 URLs, 30,000 visits via importVisits
  db.candidates(['jira'], 50);                                  // warm-up
  const t = performance.now(); db.candidates(['jira'], 50);
  assert.ok(performance.now() - t < 50);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/searchText.test.ts src/core/history.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `searchText.ts` and `history.ts`**

- `open`: run `PRAGMA quick_check`. If opening or the check throws, close, rename `history.db` (and any `-wal`/`-shm`) to `.corrupt-<ms>`, log once, and create a fresh database.
- `importVisits` runs in one transaction (`BEGIN`/`COMMIT`).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/searchText.test.ts src/core/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/searchText.ts src/core/searchText.test.ts src/core/history.ts src/core/history.test.ts
git commit -m "feat(core): per-profile history database on node:sqlite"
```

---

### Task 6: Suggestion ranking and inline completion

**Files:**
- Create: `src/core/suggest.ts`
- Test: `src/core/suggest.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `splitWords`, `matchesAll` and `searchKey` (Task 5), and `Suggestion` (Task 1).
- Produces:

```ts
export const SUGGESTION_LIMIT = 6;
export function rankSuggestions(input: { text: string; history: HistoryEntry[]; bookmarks: { url: string; title: string }[]; now: number; limit?: number }): Suggestion[];
export function inlineCompletion(text: string, history: HistoryEntry[]): string | null;
```

- [ ] **Step 1: Write the failing tests** (`now = Date.parse('2025-11-19T12:00:00Z')`; `e(url, visits, typed, daysAgo, title?)` builds a `HistoryEntry`)

```ts
test('typed pages rank above untyped ones', ...)
test('a host prefix match beats a title-only match', ...)   // 'git': github.com (2 visits) above news.example 'Why git is great' (5 visits)
test('recent beats old at equal counts', ...)              // 1 day vs 60 days
test('bookmarks are included, marked, and merged with history by URL', ...)
test('at most 6 rows; every word must match', ...)         // 'jira board' matches 'Sprint board — Jira'
test('empty text suggests nothing', ...)
test('inlineCompletion', () => {
  assert.equal(inlineCompletion('acme.at', [e('https://acme.atlassian.net/', 3, 1, 1), e('https://acme.atlassian.net/jira/software', 10, 0, 1)]), 'acme.atlassian.net');
  assert.equal(inlineCompletion('acme.at', [e('https://acme.atlassian.net/jira/software', 10, 0, 1), e('https://acme.atlassian.net/browse/X', 2, 0, 1)]), 'acme.atlassian.net/jira/software');
  assert.equal(inlineCompletion('git', [e('https://www.github.com/', 1, 0, 1)]), 'github.com');
  assert.equal(inlineCompletion('www.git', [e('https://www.github.com/', 1, 0, 1)]), 'www.github.com');
  assert.equal(inlineCompletion('acme.atlassian.net/ji', [e('https://acme.atlassian.net/jira/software', 10, 0, 1)]), 'acme.atlassian.net/jira/software');
  assert.equal(inlineCompletion('a', [e('https://apple.com/', 1, 0, 1), e('https://amazon.com/', 9, 0, 1)]), 'amazon.com');
  for (const t of ['jira board', 'https://ac', 'zzz', 'github.com', ''])
    assert.equal(inlineCompletion(t, [e('https://acme.atlassian.net/', 3, 0, 1), e('https://github.com/', 1, 0, 1)]), null, t);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/suggest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- The score combines typed count, visit count, recency (it decays over the 90-day window) and a host-prefix bonus. Choose the weights so the tests hold.
- `inlineCompletion` follows the spec's "Auto-complete":
  - Matching ignores a leading `www.` unless the text starts with `www.`.
  - The completion keeps no scheme and no trailing `/`.
  - It returns `null` when there's nothing to add.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/suggest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/suggest.ts src/core/suggest.test.ts
git commit -m "feat(core): address-bar suggestion ranking and inline completion"
```

---

### Task 7: Visit classification

**Files:**
- Create: `src/core/visits.ts`
- Test: `src/core/visits.test.ts`

**Interfaces:**
- Consumes: `isWebUrl` (Task 1).
- Produces:

```ts
export type Nav = { url: string; index: number; entries: string[] }; // navigationHistory: active index and every entry's URL
export type VisitKind = 'visit' | 'revisit' | 'ignore';
export class VisitTracker {
  opened(tabId: number, restored: boolean): void;
  markTyped(tabId: number): void;
  navigated(tabId: number, nav: Nav): { kind: VisitKind; typed: boolean };
  forget(tabId: number): void;
}
```

**Rules, in order:**
1. A non-web URL → `ignore`.
2. The first navigation of a tab opened with `restored` → `ignore`.
3. Index changed, entries list the same length, and `prev.entries[nav.index]` equals `nav.url` → `revisit` (Back/Forward).
4. Same URL ignoring `#fragment` as the previous one → `ignore` (reload or anchor).
5. Otherwise → `visit`, with `typed` true once after `markTyped`.

The state is always updated to `nav`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a new tab\'s first navigation is a visit; typed is used once', ...)
test('a restored tab\'s first load is ignored, the next one counts', ...)
test('reload and #fragment changes are ignored', ...)
test('back and forward are revisits', ...)                     // entries [A,B] index 1 → index 0
test('navigating after going back is a visit (forward entries cut)', ...) // [A,B,C]@1 → [A,B,D]@2
test('a redirect or location.replace is a visit', ...)          // same index, different URL
test('non-web pages are ignored', ...)                          // 'about:blank', 'chrome-error://chromewebdata/'
test('a forgotten or unknown tab starts fresh', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/visits.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `VisitTracker`** (a `Map<number, { prev: Nav | null; restored: boolean; typed: boolean }>`)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/visits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/visits.ts src/core/visits.test.ts
git commit -m "feat(core): classify tab navigations as visits"
```

---

### Task 8: Record history from tabs

**Files:**
- Create: `src/main/library.ts`, `src/main/historyRecorder.ts`
- Modify: `src/main/tabManager.ts` (new constructor parameter; hooks in `createView`, `wire`, `destroyView`, `setProfiles`, `reopenClosedTab`)
- Modify: `src/main/main.ts` (create `Library` and `HistoryRecorder`; pass the sink to `TabManager`; close on `will-quit`)

**Interfaces:**
- Consumes: `HistoryDb` (Task 5), `loadBookmarks`/`saveBookmarks`/`profileDataDir` (Task 4), `VisitTracker` (Task 7), and `HISTORY_RETENTION_DAYS` (Task 3).
- Produces:

```ts
// library.ts — the only way to a profile's bookmarks and history
export class Library {
  constructor(baseDir: string, log: (msg: string) => void, now?: () => number);
  history(dir: string): HistoryDb;                         // opened lazily, pruned to 90 days on open
  bookmarks(dir: string): BookmarkTree;                    // loaded lazily, cached
  updateBookmarks(dir: string, fn: (t: BookmarkTree) => BookmarkTree): BookmarkTree; // saves at once (atomic)
  pruneAll(): void;                                        // main.ts calls it every 24 h (unref'd timer)
  closeAll(): void;
}
// historyRecorder.ts
export type VisitSink = {
  opened(dir: string, tabId: number, restored: boolean): void;
  navigated(dir: string, tabId: number, nav: Nav): void;
  titled(dir: string, url: string, title: string): void;
  favicon(dir: string, url: string, favicon: string): void;
  closed(tabId: number): void;
};
export class HistoryRecorder implements VisitSink {
  constructor(library: Library, log: (msg: string) => void, now?: () => number);
  markTyped(tabId: number): void;
  // …VisitSink methods: visit → recordVisit; revisit → touch; titled → setTitle; favicon → setFavicon (web URLs only)
}
// tabManager.ts: constructor(win, onChange, log, profileName, visits: VisitSink)
```

- [ ] **Step 1: Hook `TabManager`**

- **Tab ids from saved state:** collect them in `setProfiles` (from `fromSaved`) and in `reopenClosedTab` into a `restoredIds` set. `createView` calls `visits.opened(dir, tab.id, this.restoredIds.delete(tab.id))`.
- **Navigation:** `did-navigate`, and main-frame `did-navigate-in-page`, call `visits.navigated(dir, id, { url, index: nh.getActiveIndex(), entries: nh.getAllEntries().map((e) => e.url) })`.
- **Title and favicon:** `page-title-updated` calls `visits.titled(dir, wc.getURL(), title)`, and `page-favicon-updated` calls `visits.favicon(dir, wc.getURL(), favicons[0])` when one is given.
- **Closing:** `destroyView` calls `visits.closed(id)`.
- **Errors:** a recorder or database error must never break a tab. `HistoryRecorder` catches and logs every database error.

- [ ] **Step 2: Wire it in `main.ts`**

- `new Library(app.getPath('userData'), log)` and `new HistoryRecorder(library, log)`, passed as the fifth `TabManager` argument.
- Its `navigate` UI command calls `recorder.markTyped(activeTabId)` before `tabs.navigate`.
- Add `app.on('will-quit', () => library.closeAll())`.
- Add `setInterval(() => library.pruneAll(), 24 * 3600e3).unref()`.

- [ ] **Step 3: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: no errors, all tests pass, and `dist/main.cjs` builds. `node:sqlite` stays external because it's a Node built-in.

- [ ] **Step 4: Check it by hand**

Run `npm start`. Open two sites in a tab, reload one, go Back once, then type a URL in the address field. Quit, then run:

`sqlite3 "$HOME/Library/Application Support/Superbrowser/Profiles/Default/history.db" "select url, visit_count, typed_count from urls order by last_visit desc limit 5"`

Expected:
- each site appears once with `visit_count` 1;
- the typed URL has `typed_count` 1;
- no reload or Back added a visit;
- relaunching (lazy restore) adds no visit.

Use the dir of the profile you browsed in.

- [ ] **Step 5: Commit**

```bash
git add src/main/library.ts src/main/historyRecorder.ts src/main/tabManager.ts src/main/main.ts
git commit -m "feat: record each profile's history from its tabs"
```

---

### Task 9: Import bookmarks and history from Chrome

**Files:**
- Create: `src/main/libraryImport.ts` (no `electron` import, so it's testable under Node)
- Test: `src/main/libraryImport.test.ts`
- Modify: `src/main/importFlow.ts`, `src/main/menu.ts` (`MenuContext.importLibrary`, `AddProfileMenuContext.importLibrary`), `src/main/main.ts`

**Interfaces:**
- Consumes: `parseChromeBookmarks`, `mapChromeVisits`, `librarySummaryLine` and `LibraryImportResult` (Task 3), `mergeChrome` (Task 3), and `Library` (Task 8). Accept a structural `LibraryAccess = Pick<Library, 'history' | 'updateBookmarks'>`, so tests can pass a `Library` over a temp dir.
- Produces:

```ts
export class LibraryImporter {
  constructor(opts: { library: LibraryAccess; log: (msg: string) => void; chromeDir?: string; now?: () => number });
  importProfile(dir: string): Promise<LibraryImportResult>;   // copies Bookmarks, AccountBookmarks, History(+ -wal/-journal) to a temp dir; removes it after
}
// ImportFlow gains: importLibraryAll(): Promise<void>; deps gains libraryChanged(): void
```

- [ ] **Step 1: Write the failing tests**

Fixture: a temp `chromeDir/Default/` containing:
- `Bookmarks`, with a bar holding 2 URLs and a folder with 1 URL, and `other` holding 1 URL;
- `AccountBookmarks`, holding 1 URL;
- `History`, created with `node:sqlite` using Chrome's `urls` and `visits` columns.

The `History` writes are made in WAL mode, and the connection is left open while importing, so recent rows are still only in `-wal`.

```ts
test('imports bookmarks from both files and history visits', ...)  // bookmarks.added 5; history.pages/added match fixture
test('reads visits still in Chrome\'s WAL', ...)                   // a row written after PRAGMA wal_autocheckpoint=0 is imported
test('a second import adds nothing', ...)                         // all added counts 0
test('missing files count as zero', ...)                          // empty Profile dir → all zeros, no throw
test('Chrome\'s files are unchanged', ...)                        // sha256 + mtime of every fixture file identical before/after
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/main/libraryImport.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `LibraryImporter`**

- Open the temp copy of `History` with `new DatabaseSync(tmpPath)`, read-write. That way SQLite replays the copied `-wal` into the copy; the original is never opened.
- Query: `SELECT u.url, u.title, u.typed_count, u.hidden, CAST(v.visit_time AS TEXT) AS visit_time FROM visits v JOIN urls u ON u.id = v.url`.
- An unreadable `History` or bookmarks file is logged and counted as zero for that part. Other parts still import.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/main/libraryImport.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the flow and the menus**

- **`ImportFlow.importLibraryAll()`:**
  - shares the `exclusive` guard with the login import;
  - imports every visible profile in bar order and asks for no Keychain;
  - shows one sheet titled "Imported bookmarks and history from Chrome.", with one `librarySummaryLine` per profile. A failed profile shows `${name}: ${message}` instead;
  - calls `deps.libraryChanged()` when anything was added.
- **`offerOnFirstRun`:** asks "Import your logins, bookmarks and history from Chrome for all profiles?" with buttons Import All and Not Now. On yes, it runs `importAll()`, then `importLibraryAll()`.
- **Menus:** "Import Bookmarks and History from Chrome" goes in the Profiles menu, after "Import Logins for All Profiles", and in the "+" menu after its login items. Login items stay unchanged.
- **`main.ts`:** wires `importLibrary`. Its `libraryChanged` sends `IPC.libraryChanged` to the UI view; the channel exists from Task 1.

- [ ] **Step 6: Check it**

Run: `npm run typecheck && npm test`, then `npm start` → Profiles ▸ Import Bookmarks and History from Chrome.
Expected:
- no Keychain prompt and no tab reload;
- the sheet lists each profile;
- `bookmarks.json` and `history.db` exist under `Profiles/<dir>/`;
- running it again reports 0 imported.

- [ ] **Step 7: Commit**

```bash
git add src/main/libraryImport.ts src/main/libraryImport.test.ts src/main/importFlow.ts src/main/menu.ts src/main/main.ts
git commit -m "feat: import bookmarks and history from Chrome, separately from logins"
```

---

### Task 10: Main-side commands, menus and context menus

**Files:**
- Create: `src/core/libraryMenus.ts`, `src/core/libraryMenus.test.ts`
- Modify: `src/main/menu.ts`, `src/main/main.ts`, `src/preload/ui.ts`

**Interfaces:**
- Consumes: Task 1 commands and IPC; `Library` (Task 8); `rankSuggestions`/`inlineCompletion` (Task 6); `splitWords` (Task 5); `findNode`, `findByUrl`, `addBookmark`, `addFolder`, `renameNode`, `moveNode`, `removeNode` and `folderChoices` (Task 2).
- Produces:

```ts
// libraryMenus.ts — like contextMenu.ts: a spec that main turns into a native menu
export type LibraryMenuItem =
  | { id: 'open' | 'openInNewTab' | 'copyLink' | 'rename' | 'delete' | 'newFolder' | 'deleteFromHistory'; label: string }
  | { id: 'moveTo'; label: string; choices: { id: number; path: string }[] }
  | { id: 'separator' };
export function bookmarkMenuSpec(node: BookmarkNode, choices: { id: number; path: string }[]): LibraryMenuItem[];
export function historyMenuSpec(): LibraryMenuItem[];
// preload SuperbrowserApi gains: onLibrary(cb: (r: LibraryReply) => void), onLibraryChanged(cb: () => void),
//   onPanel(cb: (p: PanelRequest) => void), onStartRename(cb: (id: number) => void)
// MenuContext gains: showHistory(), clearHistory(), bookmarkPage(), showBookmarks()
```

- [ ] **Step 1: Write the failing tests**

```ts
test('bookmark menu: Open in New Tab, Copy Link, Rename…, Move to, Delete', ...)   // labels exact; moveTo.choices passed through
test('folder menu: New Folder…, Rename…, Delete', ...)
test('history menu: Open in New Tab, Copy Link, Delete from History', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/libraryMenus.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `libraryMenus.ts`, then wire `main.ts`**

Every command acts on the shown profile `dir = tabs.snapshot().dir`.

- **`suggest`:** `candidates(splitWords(text), 50)` plus `flattenBookmarks`, then `rankSuggestions` and `inlineCompletion`. Reply with `kind: 'suggestions'` and echo `text`.
- **`historyPage`:** `page(query, before, 100, new Date().getTimezoneOffset())`.
- **`bookmarks`:** reply with the tree's `nodes` and `faviconsFor` its URLs.
- **`openUrl`:** if `newTab`, `tabs.newTab(url)`; otherwise `tabs.navigate(url)`.
- **`historyMenu`:** pops `historyMenuSpec`. "Delete from History" calls `deleteUrl`, then `libraryChanged`.
- **`bookmarkMenu`:**
  - looks the id up with `findNode` in the shown profile and ignores and logs an unknown id;
  - "Rename…" sends `IPC.startRename`;
  - "New Folder…" runs `addFolder(..., 'New Folder')`, then `startRename` on the new id;
  - "Delete" on a non-empty folder first asks "Delete “<title>” and everything in it?" with buttons Delete and Cancel;
  - each edit ends with `libraryChanged`.
- **`renameBookmark`:** `renameNode` for an id that exists in the shown profile.
- **Menus:**
  - History: Back, Forward, a separator, then Show History (`CmdOrCtrl+Y`) and Clear History….
  - New Bookmarks menu after History: Bookmark This Page (`CmdOrCtrl+D`), then Show Bookmarks (`Alt+CmdOrCtrl+B`).
- **Show History / Show Bookmarks:** make the sidebar visible if needed, then send `IPC.panel` `{ panel, mode: 'toggle', highlight: null }`.
- **Bookmark This Page:**
  1. Take the main window's active tab URL (never a popup's).
  2. If `isWebUrl`, either find the existing bookmark with `findByUrl` or add one with `addBookmark` using the tab title.
  3. Send `{ panel: 'bookmarks', mode: 'show', highlight: id | null }`.
- **Clear History…:** confirms "Clear all history for <profile>?" (buttons Clear History, Cancel), then `clear()` and `libraryChanged`.
- **Preload:** add the four listeners, each passing only the payload, as the existing ones do.

- [ ] **Step 4: Run the tests and check**

Run: `node --test src/core/libraryMenus.test.ts && npm run typecheck && npm test && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 5: Commit**

```bash
git add src/core/libraryMenus.ts src/core/libraryMenus.test.ts src/main/menu.ts src/main/main.ts src/preload/ui.ts
git commit -m "feat: history and bookmark commands, menus and shortcuts"
```

---

### Task 11: Address-bar suggestions (UI)

**Files:**
- Create: `src/ui/parts/suggestions.ts`
- Modify: `src/ui/ui.ts` (move the address `keydown` handling into the new module), `src/ui/index.html` (add `<div id="suggest" hidden></div>` right after `#address`), `src/ui/ui.css`

**Interfaces:**
- Consumes: the `suggest` command, `LibraryReply` `kind: 'suggestions'` via `sb.onLibrary`, and `navigate`.
- Produces: `setupSuggestions(opts: { address: HTMLInputElement; list: HTMLElement; sb: SuperbrowserApi; currentUrl: () => string }): { onReply(r: LibraryReply): void }`. `ui.ts` routes `kind: 'suggestions'` replies to it.

- [ ] **Step 1: Implement the behaviour from the spec's "Address-bar suggestions"**

- **Requests:** on `input`, send `suggest` with an increasing `seq`. Ignore replies whose `seq` isn't the latest or whose `text` ≠ the field's typed text.
- **Inline completion:** apply it only when the caret is at the end and the last `InputEvent.inputType` didn't start with `delete`. Set `value = typed + completion.slice(typed.length)` and select the added part.
- **Rows:** at most 6, then "Search Google for “<typed>”". Each row shows favicon placeholder, title, the URL underneath, and ★ when `bookmarked`.
- **Keys:**
  - no row is pre-selected;
  - ↓/↑ select a row and put its URL in the field;
  - Enter sends `navigate` with the field's text, or with the row's URL when one is selected;
  - Esc closes the list, restores `currentUrl()` and blurs, as today.
- **Mouse:** clicking a row navigates to it.
- **Closing:** the list closes on blur and on Enter.
- **CSS:** the list is `position: absolute` within `#side`, under the address field and spanning the sidebar's inner width, so it never extends into the page area. White card style as in the approved mockup (`.superpowers/brainstorm/*/content/history.html`).

- [ ] **Step 2: Build and check by hand**

Run: `npm run typecheck && npm run build && npm start`
Expected, after importing:
- typing `jira` lists matching pages with ★ on bookmarks;
- Enter searches Google for "jira";
- typing a host prefix completes inline, and Backspace removes the completion;
- ↓ then Enter opens that row;
- switching profile (⌃2) and typing shows only that profile's pages.

- [ ] **Step 3: Commit**

```bash
git add src/ui/parts/suggestions.ts src/ui/ui.ts src/ui/index.html src/ui/ui.css
git commit -m "feat(ui): address-bar suggestions from history and bookmarks"
```

---

### Task 12: History and bookmarks panels (UI)

**Files:**
- Create: `src/ui/parts/panel.ts`
- Modify: `src/ui/index.html`, `src/ui/ui.ts`, `src/ui/ui.css`

`index.html` gets this section next to `#tabs`:

```html
<section id="panel" hidden>
  <div class="panel-h"><span id="panel-title"></span><button id="panel-close" title="Close">✕</button></div>
  <input id="panel-search" type="search" spellcheck="false">
  <div id="panel-list"></div>
</section>
```

**Interfaces:**
- Consumes: the `historyPage`, `bookmarks`, `openUrl`, `historyMenu`, `bookmarkMenu` and `renameBookmark` commands; `onLibrary`, `onLibraryChanged`, `onPanel` and `onStartRename`; `searchKey`/`splitWords`/`matchesAll`/`dayOf` from `src/core/searchText.ts`; and `flattenBookmarks` from `src/core/bookmarks.ts` (both bundled into the UI).
- Produces: `setupPanel(opts: { sb: SuperbrowserApi; root: HTMLElement; tabs: HTMLElement }): { onReply(r: LibraryReply): void; onProfileChanged(dir: string): void }`.

- [ ] **Step 1: Implement both panels**

- **Opening and closing:**
  - `onPanel` with `mode: 'toggle'` opens that panel, or closes it if it's already open; `mode: 'show'` opens it.
  - While open, `#tabs` is hidden and `#panel` is shown. Downloads stay visible.
  - Esc in the panel, ✕, or toggling again closes it.
- **History:**
  - Request the first page with `before: null`, and the next page when scrolled within 200 px of the bottom while `more` is true.
  - The search box re-queries 150 ms after typing stops.
  - Rows are grouped under day headers: Today, Yesterday, then `toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })`. Compare `row.day` with `dayOf(Date.now(), new Date().getTimezoneOffset())` from `src/core/searchText.ts`. Never import `history.ts` from the UI, which would pull `node:sqlite` into the bundle.
  - Each row shows its title, with time · host on a second line.
- **Bookmarks:**
  - The tree has folders open and closed in place; that state is kept in the UI only.
  - Search filters `flattenBookmarks(nodes)` (from `src/core/bookmarks.ts`) with `matchesAll(searchKey(title + ' ' + url), words)` and shows each one's folder path.
  - A `highlight` id scrolls to that row and marks it, opening its folders.
  - `onStartRename(id)` turns that row's label into an input: Enter sends `renameBookmark`, Esc cancels.
- **Opening a row:** click sends `openUrl` with `newTab: false`; ⌘-click sends `newTab: true`.
- **Right-click** sends `historyMenu` or `bookmarkMenu`.
- **Refreshing:** re-request the panel's data when `onLibraryChanged` fires, and when the shown profile changes (`onProfileChanged`, called from `ui.ts` when `state.activeProfile` changes).

- [ ] **Step 2: Build and check by hand**

Run: `npm run typecheck && npm run build && npm start`
Expected:
- **History:** ⌘Y shows it grouped by day; search `ho so` finds Vietnamese titles; scrolling loads older days; "Delete from History" removes a row and it stops appearing in suggestions.
- **Bookmarks:** ⌘⌥B shows the imported folders. ⌘D on a page adds it, opens the panel and highlights it. Rename, Move to and Delete all work. ⌘D on the same page doesn't duplicate it.
- **Switching profile with a panel open** shows that profile's data.

- [ ] **Step 3: Commit**

```bash
git add src/ui/parts/panel.ts src/ui/index.html src/ui/ui.ts src/ui/ui.css
git commit -m "feat(ui): history and bookmarks panels in the sidebar"
```

---

### Task 13: Docs and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-11-19-superbrowser-electron-design.md` (non-goal line → "Importing passwords (bookmarks and history: see `2026-11-19-bookmarks-history-design.md`)")
- Modify: `docs/superpowers/plans/2026-11-19-superbrowser-electron.md` ("Deviations during execution": add bookmarks and history, with a pointer to this plan)
- Modify: `CLAUDE.md`:
  - architecture lists: the new core and main modules;
  - profile isolation: `Profiles/<dir>/history.db` and `bookmarks.json`, only through `Library`;
  - Chrome data: `Bookmarks`, `AccountBookmarks` and `History` are copied then read;
  - bookmarks and history import is add-only and separate from logins.
- Modify: `README.md` (what's imported, ⌘Y/⌘D/⌘⌥B, and "Verify it works" steps for import, suggestions, both panels, and profile isolation of history)

- [ ] **Step 1: Update the four docs as listed**

- [ ] **Step 2: Run the full check**

Run: `npm test && npm run typecheck && scripts/build-app.sh`
Expected: all tests pass, no type errors, and `build/Superbrowser-darwin-arm64/Superbrowser.app` builds. Don't pass `--install` without the user's OK.

- [ ] **Step 3: Walk the new README checklist steps in `npm start`**

Expected: every new step behaves as written.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-19-superbrowser-electron-design.md docs/superpowers/plans/2026-11-19-superbrowser-electron.md CLAUDE.md README.md
git commit -m "docs: bookmarks and history"
```
