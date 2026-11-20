# Superbrowser v2 (Electron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Swift window-stacking app with an Electron browser that shows every Chrome profile in one Arc-like window, each profile with isolated storage, its own tabs, and logins imported from Chrome.

**Architecture:** Same split as v1: all decision logic lives in `src/core/` (pure TypeScript, no `electron` import, unit-tested with `node --test`), and thin Electron adapters live in `src/main/` (window, tabs, sessions, menus, importer). The window's chrome (sidebar + bottom profile bar) is one `WebContentsView` rendering `src/ui/`; each tab is its own `WebContentsView` on top; each profile is the session `persist:<chrome profile dir>`.

**Tech Stack:** Electron 45 (Chromium 156, Node 24), TypeScript 5 (type-check only), esbuild (bundling), Node 22 `node --test` with built-in TS type stripping (tests), `@electron/packager` (app bundle), macOS `sqlite3`, `security`, `codesign`, `iconutil`, `sips`, `qlmanage` CLIs.

**Spec:** `docs/superpowers/specs/2026-11-19-superbrowser-electron-design.md` (read it first). The throwaway spike that proved the approach is described there; its code is not in the repo.

## Global Constraints

- macOS on Apple Silicon, Command Line Tools only (no Xcode). Nothing may require Xcode.
- `src/core/**` must never import `electron` (tests run under plain Node). Imports between TS files use explicit `.ts` extensions (Node type stripping): `import { x } from './profiles.ts'`. Use only erasable TS syntax (no `enum`, no `namespace`, no constructor parameter properties).
- Profile session partition: exactly `persist:<chrome profile dir>` (e.g. `persist:Profile 37`, `persist:Default`).
- User agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`; `Sec-CH-UA`: `"Google Chrome";v="<major>", "Chromium";v="<major>", "Not_A Brand";v="24"`; `<major>` = major of `process.versions.chrome`.
- Chrome data is read-only: never write to `~/Library/Application Support/Google/Chrome/**` or Chrome's Keychain item; copy DB files before reading.
- Chrome profile color: `profile_color_seed`, else `default_avatar_fill_color` (signed 32-bit ARGB) → `#rrggbb`; fallback `#808080`.
- Layout (from the spike): sidebar width `240`, gap `8`, bottom bar height `40` (px).
- Site permissions are never granted silently (Electron's default allows everything).
- App: name `Superbrowser`, bundle id `dev.superbrowser.app`, state file `~/Library/Application Support/Superbrowser/state.json` (v1's `settings.json` next to it is ignored).
- Commit after every task; messages in the repo's style (`feat(core): …`, `feat(app): …`, `chore: …`).

## Review Focus

1. **A popup or new tab opened from a page lands in the wrong profile** (e.g. an OAuth popup from FPT opened with the default session) — must always inherit the opener's partition. Test: Task 9 `popupWindowOptions` test.
2. **Chrome's `Local State` missing, unreadable or mid-write (empty `info_cache`)** — keep the profiles Superbrowser already knows; never show an empty bar. Test: Task 2 `mergeProfiles` tests.
3. **`state.json` corrupt or from an older/partial version** — start with defaults for the bad parts, keep the corrupt file aside, never crash or lose the other fields. Test: Task 3 `decodeState` / store tests.
4. **Individual Chrome cookies that can't be imported** (unknown prefix, decrypt failure, expired, `__Host-` with domain, `SameSite=None` without `Secure`, partitioned) — skip and count; never abort the whole import. Test: Task 7 `planImport`/`toCookieDetails` tests.
5. **Address-bar input that looks like neither URL nor search** (`localhost:3000`, `192.168.1.10/admin`, `about:blank`, `foo bar.com`, a bare word) — go where a Chrome user expects. Test: Task 1 `toNavigableUrl` tests.

---

## File structure

```
package.json, package-lock.json, tsconfig.json, .gitignore
scripts/build.mjs            esbuild: src → dist/
scripts/build-app.sh         packaged Superbrowser.app (replaces v1 script)
scripts/make-icon.sh         resources/icon.svg → resources/icon.icns
resources/icon.svg
src/shared/types.ts          Profile, TabRecord, UiState, UiCommand, DownloadState, IPC channel names
src/core/identity.ts         UA / client hints
src/core/address.ts          address-bar input → URL
src/core/profiles.ts         Local State parsing, merge with known, ordering/hiding
src/core/appState.ts         AppState type, defaults, tolerant decode
src/core/store.ts            load/save state.json (debounced, atomic)
src/core/tabs.ts             per-profile tab list model (pure)
src/core/layout.ts           view rectangles, window bounds restore
src/core/cookies.ts          Chrome cookie decryption + mapping + import planning
src/core/permissions.ts      permission policy + remembered decisions
src/core/downloads.ts        unique download path
src/core/contextMenu.ts      context-menu item spec from params
src/core/*.test.ts           unit tests next to each module
src/main/main.ts             app bootstrap, single instance, wiring
src/main/sessions.ts         per-profile session setup
src/main/browserWindow.ts    window + UI view + find view + layout
src/main/tabManager.ts       WebContentsViews per tab, lazy restore, events
src/main/menu.ts             application menu + shortcuts
src/main/importer.ts         read Chrome cookies, Keychain key, set cookies
src/main/chrome.ts           Local State reader, "Open this profile in Chrome"
src/preload/ui.ts            contextBridge API for src/ui
src/preload/frame.ts         session frame preload: passkey fail-fast
src/ui/index.html, ui.css, ui.ts       sidebar + bottom profile bar + downloads
src/ui/find.html, find.ts              find-in-page bar
```

Removed in Task 10: `Package.swift`, `Sources/`, `Tests/`, `Extension/`, old `scripts/build-app.sh` content.

---

### Task 1: Project scaffold, browser identity, address input, first window

**Files:**
- Create: `package.json`, `tsconfig.json`, `scripts/build.mjs`, `src/core/identity.ts`, `src/core/identity.test.ts`, `src/core/address.ts`, `src/core/address.test.ts`, `src/main/main.ts` (minimal)
- Modify: `.gitignore` (add `node_modules/`, `dist/`)

**Interfaces:**
- Produces:
  - `chromeMajor(chromeVersion: string): string` — `'156.0.8078.100'` → `'156'`
  - `userAgent(major: string): string`, `secChUa(major: string): string`
  - `rewriteClientHints(headers: Record<string, string>, major: string): Record<string, string>` — replaces any header named `sec-ch-ua` (case-insensitive) with `secChUa(major)`; returns a new object; other headers untouched; doesn't add the header if absent.
  - `toNavigableUrl(input: string): string | null`
  - npm scripts: `build` (`node scripts/build.mjs`), `start` (`npm run build && electron .`), `test` (`node --test "src/**/*.test.ts"`), `typecheck` (`tsc --noEmit`). `package.json` has `"type": "module"`, `"main": "dist/main.cjs"`, devDependencies `electron@^45`, `typescript@^5`, `esbuild`, `@types/node`, `@electron/packager`.
  - `scripts/build.mjs`: bundles `src/main/main.ts` → `dist/main.cjs` (cjs, platform node, external `electron`); `src/preload/*.ts` → `dist/preload/*.cjs` (cjs, external `electron`); `src/ui/*.ts` → `dist/ui/*.js` (iife, browser); copies `src/ui/*.html|*.css` to `dist/ui/`. Missing entry dirs are skipped (later tasks add them).
  - `tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `module`/`moduleResolution` `nodenext`, `target` `es2023`, `lib` `["es2023","dom"]`, `types` `["node"]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/identity.test.ts
test('chromeMajor', () => assert.equal(chromeMajor('156.0.8078.100'), '156'));
test('userAgent', () => assert.equal(userAgent('156'),
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'));
test('secChUa', () => assert.equal(secChUa('156'), '"Google Chrome";v="156", "Chromium";v="156", "Not_A Brand";v="24"'));
test('rewriteClientHints replaces any-case sec-ch-ua only', () => {
  const out = rewriteClientHints({ 'Sec-CH-UA': '"Chromium";v="156"', Accept: '*/*' }, '156');
  assert.deepEqual(out, { 'Sec-CH-UA': secChUa('156'), Accept: '*/*' });
  assert.deepEqual(rewriteClientHints({ Accept: '*/*' }, '156'), { Accept: '*/*' });
});

// src/core/address.test.ts
const cases: [string, string | null][] = [
  ['', null], ['   ', null],
  ['https://mail.google.com/x', 'https://mail.google.com/x'],
  ['example.com', 'https://example.com'],
  ['docs.google.com/document/d/1', 'https://docs.google.com/document/d/1'],
  ['localhost:3000', 'http://localhost:3000'],
  ['localhost', 'http://localhost'],
  ['192.168.1.10/admin', 'http://192.168.1.10/admin'],
  ['about:blank', 'about:blank'],
  ['file:///Users/x/a.pdf', 'file:///Users/x/a.pdf'],
  ['foo bar.com', 'https://www.google.com/search?q=foo%20bar.com'],
  ['hello', 'https://www.google.com/search?q=hello'],
  ['c++ tutorial', 'https://www.google.com/search?q=c%2B%2B%20tutorial'],
];
for (const [input, want] of cases) test(`toNavigableUrl(${JSON.stringify(input)})`, () => assert.equal(toNavigableUrl(input), want));
```

- [ ] **Step 2: Run tests to verify they fail** — `npm install && npm test` → FAIL (modules missing).

- [ ] **Step 3: Implement `identity.ts` and `toNavigableUrl` in `address.ts`.** Rules: trim; empty → `null`; scheme in `http|https|file|about|data|view-source` → as typed; `localhost[:port][/…]` or IPv4 `[:port][/…]` → `http://`; no whitespace and host part matches `label(.label)+` with a 2+-letter TLD → `https://`; anything else → Google search with `encodeURIComponent`.

- [ ] **Step 4: Run tests** — `npm test` → all PASS; `npm run typecheck` → no errors.

- [ ] **Step 5: Minimal `src/main/main.ts`:** one `BrowserWindow` (1400×900, `titleBarStyle: 'hiddenInset'`), `app.userAgentFallback = userAgent(chromeMajor(process.versions.chrome))`, loads `https://www.google.com`. Run `npm start` → a window opens showing Google. (Replaced by Task 4.)

- [ ] **Step 6: Commit** — `git add -A package.json package-lock.json tsconfig.json .gitignore scripts/build.mjs src && git commit -m "feat: Electron scaffold with Chrome identity and address parsing"`

---

### Task 2: Profiles from Chrome

**Files:**
- Create: `src/shared/types.ts` (start it with `Profile`), `src/core/profiles.ts`, `src/core/profiles.test.ts`, `src/main/chrome.ts`

**Interfaces:**
- Produces:
  - `type Profile = { dir: string; name: string; color: string }` (color `#rrggbb`)
  - `argbToHex(argb: number): string` — `-16777216`→`'#000000'`, `-1`→`'#ffffff'`, `0x112233`→`'#112233'`
  - `parseLocalState(json: string, existingDirs: Set<string>): Profile[]` — throws on invalid JSON / missing `profile.info_cache`. Order: `profile.profiles_order` first (deduplicated), then remaining cache entries sorted by name (case-insensitive, `localeCompare`). Only dirs in `existingDirs`; skip dirs starting with `.`; name defaults to dir.
  - `mergeProfiles(fromChrome: Profile[] | null, known: Profile[]): Profile[]` — `null` or `[]` while `known` is non-empty → `known` unchanged; otherwise Chrome's list (updated names/colors) followed by known profiles missing from Chrome, in their known order.
  - `arrangeProfiles(all: Profile[], order: string[], hidden: string[]): { visible: Profile[]; hidden: Profile[] }` — dirs in `order` first (in that order, unknown dirs ignored), then the rest in `all` order; hidden ones go to `hidden`.
  - `src/main/chrome.ts`: `CHROME_DIR` (`~/Library/Application Support/Google/Chrome`), `readChromeProfiles(): Profile[] | null` (null when the file is missing/unparsable), `openProfileInChrome(dir: string): void` (`execFile('open', ['-na', 'Google Chrome', '--args', \`--profile-directory=${dir}\`])`).

- [ ] **Step 1: Write the failing tests** — `argbToHex` cases above; `parseLocalState` with a fixture `{ profile: { profiles_order: ['Profile 37','Default'], info_cache: { 'Default': {name:'Personal', profile_color_seed: -16776961}, 'Profile 37': {name:'NSM Infosys', default_avatar_fill_color: -3355444}, 'Profile 9': {name:'alpha'}, '.chrome': {name:'Your Chrome'} } } }` and `existingDirs` without `Profile 9` → `[NSM Infosys #cccccc, Personal #0000ff]`; with `Profile 9` present it's appended with `#808080`; invalid JSON throws. `mergeProfiles`: `(null, known)`→known; `([], known)`→known; `([], [])`→`[]`; renamed Chrome profile updates name; profile deleted in Chrome stays at the end. `arrangeProfiles`: order + hidden partitioning, unknown dir in `order` ignored.

- [ ] **Step 2: Run** `npm test` → new tests FAIL.
- [ ] **Step 3: Implement `profiles.ts` and `chrome.ts`.**
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(core): read Chrome profiles, keep known ones, order and hide`

---

### Task 3: App state and persistence

**Files:**
- Create: `src/core/appState.ts`, `src/core/appState.test.ts`, `src/core/store.ts`, `src/core/store.test.ts`

**Interfaces:**
- Consumes: `Profile` (Task 2)
- Produces:
```ts
export type Decision = 'allow' | 'deny';
export type SavedTabs = { tabs: { url: string; title: string }[]; activeIndex: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type AppState = {
  version: 1;
  activeProfile: string | null;
  sidebarVisible: boolean;          // default true
  showNames: boolean;               // default false
  windowBounds: Rect | null;
  profileOrder: string[];
  hiddenProfiles: string[];
  knownProfiles: Profile[];
  tabs: Record<string, SavedTabs>;  // by profile dir
  permissions: Record<string, Record<string, Record<string, Decision>>>; // dir → origin → permission key
  firstRunDone: boolean;            // default false
};
export function defaultState(): AppState;
export function decodeState(raw: unknown): AppState; // never throws; each invalid/missing field → its default; invalid tab entries dropped; activeIndex clamped
export type Store = { load(): AppState; save(state: AppState): void; flush(): void };
export function createStore(file: string, opts?: { debounceMs?: number }): Store; // debounce default 500
```
  `load`: missing file → defaults; unparsable JSON → rename to `<file>.corrupt-<Date.now()>` and return defaults. `save` debounces; `flush` writes pending state now. Writes go to `<file>.tmp` then `rename`; parent dir is created if missing.

- [ ] **Step 1: Write the failing tests** — `decodeState(undefined)` deep-equals `defaultState()`; `decodeState({ sidebarVisible: false, showNames: 'yes', tabs: { 'Default': { tabs: [{url:'https://a'}, 42], activeIndex: 9 } } })` → `sidebarVisible false`, `showNames false`, Default tabs `[{url:'https://a', title:''}]`, `activeIndex 0`; unknown extra fields ignored. Store (in `fs.mkdtempSync` dir): load of missing file → defaults; `save` then `flush` then new store `load` round-trips; corrupt file → defaults and a `state.json.corrupt-*` file exists; two `save`s within debounce → one write (check via `fs.statSync(...).mtimeMs` or by saving A then B and asserting file has B after flush).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(core): app state with tolerant decoding and atomic store`

---

### Task 4: Window, per-profile sessions and tabs (no UI yet)

**Files:**
- Create: `src/core/tabs.ts`, `src/core/tabs.test.ts`, `src/core/layout.ts`, `src/core/layout.test.ts`, `src/main/sessions.ts`, `src/main/tabManager.ts`, `src/main/browserWindow.ts`
- Modify: `src/main/main.ts`, `src/shared/types.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (core/tabs.ts — pure; `id`s are numbers allocated by the caller):
```ts
export type TabRecord = { id: number; url: string; title: string };
export type ProfileTabs = { tabs: TabRecord[]; activeId: number | null; closed: TabRecord[] }; // closed: newest last, max 25
export function emptyTabs(): ProfileTabs;
export function openTab(s: ProfileTabs, tab: TabRecord, opts: { activate: boolean; afterId?: number }): ProfileTabs; // afterId → insert right after it, else append
export function closeTab(s: ProfileTabs, id: number): ProfileTabs;   // activates right neighbour, else left, else null; pushes to closed
export function reopenClosed(s: ProfileTabs): { state: ProfileTabs; tab: TabRecord } | null; // re-adds at end, activated
export function activateTab(s: ProfileTabs, id: number): ProfileTabs;
export function updateTab(s: ProfileTabs, id: number, patch: Partial<Pick<TabRecord, 'url' | 'title'>>): ProfileTabs;
export function tabIdForShortcut(s: ProfileTabs, n: number): number | null; // 1–8 = position, 9 = last (Chrome)
export function toSaved(s: ProfileTabs): SavedTabs;
export function fromSaved(saved: SavedTabs, nextId: () => number): ProfileTabs;
```
  core/layout.ts:
```ts
export const SIDEBAR_W = 240, GAP = 8, BOTTOM_H = 40;
export function tabBounds(size: { width: number; height: number }, sidebarVisible: boolean): Rect;
  // visible: {x:240, y:8, width:w-248, height:h-48}; hidden: {x:8, y:8, width:w-16, height:h-48}
export function restoreBounds(saved: Rect | null, workAreas: Rect[], fallback: { width: number; height: number }): Rect | { width: number; height: number };
  // saved kept only if ≥ 100×100 px of it lies inside some work area; else fallback size (window centers itself)
```
  main/sessions.ts: `profileSession(dir: string): Session` — memoized `session.fromPartition('persist:' + dir)`; on first creation sets UA (`setUserAgent`) and `webRequest.onBeforeSendHeaders` with `rewriteClientHints`. (Permissions, downloads and the frame preload are added in Tasks 8–9 through this same function.)
  main/tabManager.ts: `class TabManager` with `constructor(win: BrowserWindow, onChange: () => void)`, `setProfiles(dirs: string[], saved: Record<string, SavedTabs>)`, `showProfile(dir: string)`, `newTab(url?: string, opts?: { afterId?: number; activate?: boolean; dir?: string })` (default URL `https://www.google.com`), `closeTab(id)`, `reopenClosedTab()`, `selectTab(id)`, `selectTabByShortcut(n)`, `navigate(input: string)`, `back()`, `forward()`, `reload()`, `activeWebContents(): WebContents | null`, `snapshot(): { dir: string; tabs: UiTab[]; activeTabId: number | null; url: string; canGoBack: boolean; canGoForward: boolean }`, `savedState(): Record<string, SavedTabs>`, `layout(rect: Rect)`.
  Lazy restore: restored tabs have no view until first shown; at startup only the active profile's active tab gets a view. Each view is a `WebContentsView` with `webPreferences: { session: profileSession(dir), sandbox: true, contextIsolation: true }`, `setBorderRadius(10)`; only the active profile's active tab is `setVisible(true)`. Switching profile/tab only toggles visibility (no reload). A profile with no tabs gets a new tab when shown. Title/URL/favicon/loading come from `page-title-updated`, `did-navigate`, `did-navigate-in-page`, `page-favicon-updated`, `did-start-loading`, `did-stop-loading`.
  `UiTab = { id: number; title: string; url: string; favicon: string | null; loading: boolean }` goes in `src/shared/types.ts`.
  main/browserWindow.ts: `createBrowserWindow(state: AppState): BrowserWindow` (restores bounds via `restoreBounds`, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 14, y: 16 }`, `backgroundColor: '#1e1e22'`, min size 800×500) and `layoutWindow(...)` calling `tabManager.layout(tabBounds(...))`.
  main/main.ts: single-instance lock (second launch focuses the window); loads state via `createStore(path.join(app.getPath('userData'), 'state.json'))`; profiles = `arrangeProfiles(mergeProfiles(readChromeProfiles(), state.knownProfiles), …).visible`; saves `knownProfiles`, tabs, active profile, window bounds (on `resize`/`move`, debounced by the store); `before-quit` → `store.flush()`; `window-all-closed` → `app.quit()`. Temporary: `Ctrl+1…9` via a minimal menu to switch profile (Task 6 replaces the menu).

- [ ] **Step 1: Write the failing tests** for `tabs.ts` (open append/after, close activates right then left then null, closed stack capped at 25 and `reopenClosed` order, `tabIdForShortcut` 1/8/9 with 3 tabs → 9 gives last and 5 gives null, `toSaved`/`fromSaved` round trip incl. `activeIndex` → `activeId`) and `layout.ts` (both `tabBounds` cases at 1400×900 → `{240,8,1152,852}` / `{8,8,1384,852}`; `restoreBounds` keeps on-screen rect, drops an off-screen one, drops a 50-px sliver).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement core, then the three main modules and `main.ts`.** **Step 4: Run** `npm test` → PASS, `npm run typecheck` clean.
- [ ] **Step 5: Manual check** — `npm start`: window opens on the first visible profile with Google; ⌃2 shows another profile's Google page; ⌃1 returns to the first page **without reload** (scroll position kept); sign in on one profile and confirm another profile is still signed out (isolation); quit and relaunch → same profile and tabs come back.
- [ ] **Step 6: Commit** — `feat(app): one window with per-profile sessions and lazily restored tabs`

---

### Task 5: Sidebar and bottom profile bar UI

**Files:**
- Create: `src/preload/ui.ts`, `src/ui/index.html`, `src/ui/ui.css`, `src/ui/ui.ts`
- Modify: `src/shared/types.ts`, `src/main/browserWindow.ts`, `src/main/main.ts`

**Interfaces:**
- Consumes: `TabManager.snapshot()`, `arrangeProfiles` (Tasks 2, 4).
- Produces (`src/shared/types.ts`):
```ts
export type DownloadState = { id: string; filename: string; path: string; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'; received: number; total: number };
export type UiState = {
  profiles: (Profile & { shortcut: number | null })[]; // visible profiles in bar order; shortcut 1–9 or null
  activeProfile: string;
  tabs: UiTab[]; activeTabId: number | null;
  url: string; canGoBack: boolean; canGoForward: boolean;
  sidebarVisible: boolean; showNames: boolean;
  downloads: DownloadState[];   // filled in Task 9; [] until then
};
export type UiCommand =
  | { type: 'selectProfile'; dir: string } | { type: 'profileMenu'; dir: string }
  | { type: 'selectTab'; id: number } | { type: 'closeTab'; id: number } | { type: 'newTab' }
  | { type: 'navigate'; input: string } | { type: 'back' } | { type: 'forward' } | { type: 'reload' }
  | { type: 'toggleSidebar' } | { type: 'revealDownload'; id: string };
export const IPC = { state: 'ui:state', command: 'ui:command', focusAddress: 'ui:focus-address' } as const;
```
  `src/preload/ui.ts` exposes `window.superbrowser = { onState(cb), onFocusAddress(cb), send(cmd: UiCommand) }` via `contextBridge`.
  The UI view is a `WebContentsView` (preload `dist/preload/ui.cjs`) filling the whole window **below** the tab views; main pushes `UiState` on every change (tab events, profile switch, setting change).
- Look (as approved in the spike):
  - Background: `linear-gradient(160deg, color-mix(in srgb, <profile color> 70%, #000), color-mix(in srgb, <profile color> 35%, #111))`, transitions on switch.
  - Sidebar (240 px, hidden when `sidebarVisible` is false): top-right back/forward/reload buttons (top 40 px is a window drag region), address field (focus selects all; Enter → `navigate`; Esc blurs), tab list (favicon, title with ellipsis, `⋯` while loading, close × on hover, active tab white card), "+ New Tab".
  - Bottom bar (40 px, full width, drag region except controls): sidebar toggle `◧` at the left, then one pill per visible profile — an 18-px colour dot with the profile's initial; active profile's dot has a white ring. Name and `⌃N` are hidden (width 0) and slide out on hover; with `showNames` names are always shown (shortcut still only on hover). Tooltip `"<name>  (⌃N)"`. Left-click → `selectProfile`; right-click → `profileMenu` (Task 6 builds that menu).
  - Main hides the window buttons (`setWindowButtonVisibility(false)`) when the sidebar is hidden.

- [ ] **Step 1: Implement** the preload, UI files and the main-side wiring (`UiCommand` dispatch to `TabManager`; `toggleSidebar` updates state + layout + buttons).
- [ ] **Step 2: Run** `npm run typecheck && npm test` → clean/PASS.
- [ ] **Step 3: Manual check** — `npm start`: sidebar shows tabs of the active profile; clicking a tab/“+ New Tab”/×/back/forward/reload works; typing `example.com` + Enter navigates; bottom bar shows coloured dots only, hovering a dot slides out the name + ⌃N; clicking a dot switches profile and tint; ◧ hides the sidebar → page fills the width, window buttons disappear, bottom bar still switches profiles; window can be dragged by the bottom bar.
- [ ] **Step 4: Commit** — `feat(ui): Arc-style sidebar and bottom profile bar`

---

### Task 6: Menu, shortcuts, find, zoom, profile management

**Files:**
- Create: `src/main/menu.ts`, `src/ui/find.html`, `src/ui/find.ts`
- Modify: `src/main/main.ts`, `src/main/browserWindow.ts`, `src/preload/ui.ts`, `src/shared/types.ts`

**Interfaces:**
- Consumes: `TabManager`, `openProfileInChrome`, `arrangeProfiles`.
- Produces: `buildMenu(ctx: MenuContext): Menu` where `MenuContext` exposes the actions below; rebuilt whenever profiles, order, hidden set or `showNames` change. Find bar: a second small `WebContentsView` (same UI preload) shown top-right inside the tab rect (320×44, 8 px from the tab rect's top/right edges), above the tab view; `UiCommand` gains `{ type: 'find'; text: string; forward: boolean }` and `{ type: 'findClose' }`; main → find view channel `ui:find-result` with `{ active: number; matches: number }` from `found-in-page`.
- Menus and shortcuts:
  - **App:** standard `appMenu` role.
  - **File:** New Tab ⌘T (shows the sidebar, focuses the address field), Reopen Closed Tab ⇧⌘T, Close Tab ⌘W (does nothing if no tabs; never closes the window), Open Location ⌘L (shows sidebar, focuses address), Print… ⌘P (`webContents.print()`).
  - **Edit:** standard `editMenu` role + Find… ⌘F, Find Next ⌘G, Find Previous ⇧⌘G.
  - **View:** Toggle Sidebar ⌘S, Show Profile Names (checkbox), Reload ⌘R, Actual Size ⌘0, Zoom In ⌘+ (also ⌘=), Zoom Out ⌘−, Enter Full Screen (`togglefullscreen` role), Developer Tools ⌥⌘I (active tab, detached).
  - **History:** Back ⌘[, Forward ⌘].
  - **Profiles:** one item per visible profile with ⌃1…⌃9; separator; Import Logins from Chrome / Import Logins for All Profiles / Replace Logins from Chrome… (wired in Task 7); Open This Profile in Chrome; **Show Hidden Profiles ▸** (one item per hidden profile → unhide).
  - **Tab:** Select Tab 1…8 ⌘1…⌘8, Select Last Tab ⌘9.
  - **Window:** standard `windowMenu` role.
  - **Profile dot right-click menu** (`profileMenu`): Move Left, Move Right, Hide Profile (disabled when it's the last visible one), Open in Chrome. Moving/hiding updates `profileOrder`/`hiddenProfiles` in state; hiding the active profile switches to the first visible one.

- [ ] **Step 1: Implement** menu, find view, zoom (`webContents.setZoomLevel` ±0.5, 0 resets) and profile management handlers.
- [ ] **Step 2: Run** `npm run typecheck && npm test` → clean/PASS.
- [ ] **Step 3: Manual check** — every shortcut above works with the sidebar shown and hidden; ⌘F opens the find bar, typing highlights matches with "2/7"-style count, Enter/⇧Enter step, Esc closes; right-click a dot → Move Right changes bar order and ⌃N mapping; Hide removes it, Profiles ▸ Show Hidden Profiles brings it back; settings survive relaunch.
- [ ] **Step 4: Commit** — `feat(app): menus, shortcuts, find in page, profile ordering and hiding`

---

### Task 7: Import logins from Chrome

**Files:**
- Create: `src/core/cookies.ts`, `src/core/cookies.test.ts`, `src/main/importer.ts`
- Modify: `src/main/menu.ts`, `src/main/main.ts`

**Interfaces:**
- Produces (core/cookies.ts):
```ts
export function deriveKey(password: string): Buffer;  // pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
export function decryptValue(encrypted: Buffer, hostKey: string, dbVersion: number, key: Buffer): string;
  // '' for empty input; throws unless prefix 'v10'; AES-128-CBC, IV = 16 × 0x20; when dbVersion >= 24 and the
  // first 32 bytes equal sha256(hostKey), strip them
export type ChromeCookieRow = { host_key: string; name: string; value: string; ev: string /* hex */; path: string;
  expires_utc: string; is_secure: number; is_httponly: number; samesite: number; has_expires: number;
  is_persistent: number; top_frame_site_key: string };
export type CookieDetails = { url: string; name: string; value: string; domain?: string; path: string; secure: boolean;
  httpOnly: boolean; sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'; expirationDate?: number };
export function toCookieDetails(row: ChromeCookieRow, value: string, nowSec: number): CookieDetails | null;
  // null for partitioned (top_frame_site_key != '') and expired persistent cookies.
  // url = (secure ? 'https' : 'http') + '://' + host_key without leading dot + path;
  // domain = host_key only if it starts with '.' and name doesn't start with '__Host-';
  // samesite -1/0/1/2 → unspecified/no_restriction/lax/strict; no_restriction without secure → unspecified;
  // expirationDate = expires_utc / 1e6 - 11644473600 only when has_expires && is_persistent
export type ImportMode = 'add' | 'replace';
export function cookieKey(c: { name: string; domain?: string; url?: string; path: string }): string; // name|domain-or-host without leading dot|path
export function planImport(candidates: CookieDetails[], existing: { name: string; domain?: string; path: string }[], mode: ImportMode): CookieDetails[];
  // 'add' → only candidates whose key isn't in existing; 'replace' → all
export type ImportResult = { set: number; skipped: number; failed: number; total: number };
```
  main/importer.ts: `importLogins(dir: string, mode: ImportMode): Promise<ImportResult>` — copies `<CHROME_DIR>/<dir>/Cookies` to a temp dir, reads `meta.version` and rows with `sqlite3 -json` (`hex(encrypted_value) AS ev`, `maxBuffer` 64 MB), gets the Keychain password once per app run (`security find-generic-password -w -s "Chrome Safe Storage"`), decrypts each row in a try/catch (failures counted, first 5 logged), `planImport` against `profileSession(dir).cookies.get({})`, `cookies.set` each (failures counted), `cookies.flushStore()`, deletes the temp dir in `finally`. Keychain denial / missing Cookies file → throws an `Error` with a user-readable message; nothing is half-written before the key is obtained (get the key first).
- UI flow (menu items from Task 6):
  - **Import Logins from Chrome** (current profile, mode `add`) and **Import Logins for All Profiles** (`add`, every visible profile in order, summary per profile).
  - **Replace Logins from Chrome…** (current profile, mode `replace`) — confirmation sheet: "Replace this profile's logins with Chrome's current ones? Use this if Superbrowser got signed out."
  - Before the first import of a run, one sheet: "Superbrowser will copy this profile's logins (cookies) from Google Chrome. macOS will ask to allow access to “Chrome Safe Storage” — click Always Allow. You can keep using these accounts in Chrome too; Google may occasionally sign one of them out." [Import] [Cancel].
  - After import: sheet "Imported N logins for <name>." with detail "S skipped, F failed."; reload that profile's loaded tabs.
  - **First run** (`firstRunDone` false): after the window shows, sheet "Import your logins from Chrome for all profiles?" [Import All] [Not Now]; set `firstRunDone = true` either way.

- [ ] **Step 1: Write the failing tests** — round trip: encrypt `'abc'` with a known key the way Chrome does (prefix `v10`, sha256(host) prefix for v24) and assert `decryptValue` returns `'abc'` for v24 and for v23 without the hash prefix; non-`v10` prefix throws; empty buffer → `''`; `deriveKey('peanuts').toString('hex') === 'd9a09d499b4e1b7461f28e67972c6dbd'`. `toCookieDetails`: `.google.com` `SID` secure httpOnly samesite 0 → domain `.google.com`, url `https://google.com/`, sameSite `no_restriction`; `__Host-GAPS` on `accounts.google.com` → no domain; samesite 0 + insecure → `unspecified`; session cookie → no `expirationDate`; expired → `null`; partitioned → `null`. `planImport`: add skips existing same key (leading-dot-insensitive), replace returns all.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement core + importer + menu wiring + first-run sheet.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Manual check** — fresh state (`rm ~/Library/Application\ Support/Superbrowser/state.json` and the `Partitions` dir): first-run sheet appears; Import All → Keychain prompt → per-profile summaries; Gmail opens signed in on NSM Infosys and FPT - Neilson without logging in; Chrome is still signed in; running Import again sets 0 new cookies.
- [ ] **Step 6: Commit** — `feat: import logins from Chrome per profile`

---

### Task 8: Site permissions and passkey fail-fast

**Files:**
- Create: `src/core/permissions.ts`, `src/core/permissions.test.ts`, `src/preload/frame.ts`
- Modify: `src/main/sessions.ts`, `src/main/main.ts`

**Interfaces:**
- Produces:
```ts
export type Policy = 'allow' | 'ask' | 'deny';
export function policyFor(permission: string): Policy;
  // allow: 'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'automatic-fullscreen'
  // ask:   'media', 'notifications', 'geolocation', 'clipboard-read', 'display-capture', 'window-management'
  // everything else: 'deny'
export function permissionKeys(permission: string, mediaTypes?: string[]): string[];
  // 'media' + ['video','audio'] → ['media:video','media:audio']; others → [permission]
export function decide(stored: Record<string, Record<string, Decision>> | undefined, origin: string, keys: string[], policy: Policy): 'allow' | 'deny' | 'ask';
  // policy allow/deny wins; for 'ask': all keys stored 'allow' → allow; any stored 'deny' → deny; else ask
export function remember(perms: AppState['permissions'], dir: string, origin: string, keys: string[], d: Decision): AppState['permissions']; // returns new object
export function describeRequest(origin: string, keys: string[]): string;
  // e.g. 'meet.google.com wants to use your camera and microphone' / '… show notifications' / '… know your location'
  //      / '… read your clipboard' / '… share your screen'
```
  sessions.ts additions in `profileSession(dir)`: `setPermissionRequestHandler` → `decide`; on `ask`, native sheet on the main window: message `describeRequest(...)`, detail = profile name, buttons [Allow] [Block], checkbox "Remember for this site" (checked) → `remember` when checked; `setPermissionCheckHandler` → `decide(...) === 'allow'` (never prompts); `setDisplayMediaRequestHandler(handler, { useSystemPicker: true })` where the handler (used only if the system picker is unavailable) denies; `registerPreloadScript({ type: 'frame', filePath: dist/preload/frame.cjs })`.
  `src/preload/frame.ts`: runs `contextBridge.executeInMainWorld` with a function that wraps `navigator.credentials.get` and `.create`: calls with a `publicKey` option reject immediately with `new DOMException('Passkeys are not supported in Superbrowser yet', 'NotAllowedError')`; other calls pass through.

- [ ] **Step 1: Write the failing tests** — `policyFor` for one of each group and `'usb'` → deny; `permissionKeys`; `decide` matrix (no stored → ask; all allow → allow; one deny → deny; policy allow ignores stored deny); `remember` doesn't mutate input; `describeRequest('https://meet.google.com', ['media:video','media:audio'])` → `'meet.google.com wants to use your camera and microphone'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check** — Google Meet test call (`meet.google.com` → "Check your audio and video"): sheet asks once for camera+mic, Allow works, relaunch doesn't ask again; Present now → macOS system screen picker appears; Gmail desktop notifications prompt appears; Google sign-in passkey step immediately offers other options instead of hanging.
- [ ] **Step 6: Commit** — `feat: ask before granting site permissions; passkeys fail fast`

---

### Task 9: Popups, context menu, downloads, Open in Chrome

**Files:**
- Create: `src/core/downloads.ts`, `src/core/downloads.test.ts`, `src/core/contextMenu.ts`, `src/core/contextMenu.test.ts`
- Modify: `src/core/tabs.ts`, `src/core/tabs.test.ts`, `src/main/tabManager.ts`, `src/main/sessions.ts`, `src/main/main.ts`, `src/ui/ui.ts`, `src/ui/ui.css`

**Interfaces:**
- Produces:
```ts
// core/downloads.ts
export function uniqueDownloadPath(dir: string, filename: string, exists: (p: string) => boolean): string;
  // 'a.pdf' → 'a.pdf', then 'a (1).pdf', 'a (2).pdf'…; no extension → 'a (1)'; empty/unsafe name → 'download'
// core/contextMenu.ts
export type MenuParams = { linkURL: string; srcURL: string; mediaType: string; selectionText: string; isEditable: boolean;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean } };
export type MenuItemSpec = { id: 'openLinkInNewTab' | 'copyLink' | 'copyImage' | 'saveImage' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'searchSelection' | 'inspect'; label: string } | { id: 'separator' };
export function contextMenuSpec(p: MenuParams): MenuItemSpec[];
  // link → Open Link in New Tab, Copy Link Address; image → Copy Image, Save Image As…; selection → Copy,
  // Search Google for “<first 30 chars>…”; editable → Cut/Copy/Paste/Select All per editFlags; always last: Inspect;
  // separators between groups, never leading/trailing/double
// core/tabs.ts gains (pure, so the profile-inheritance rule is unit-tested):
export function popupWindowOptions(dir: string): { width: number; height: number; webPreferences: { partition: string; sandbox: true; contextIsolation: true } };
  // { width: 520, height: 680, webPreferences: { partition: 'persist:' + dir, sandbox: true, contextIsolation: true } }
```
- Behaviour:
  - `setWindowOpenHandler` on every tab: `foreground-tab`/`background-tab`/`new-window` with a user gesture link → `TabManager.newTab(url, { afterId: openerId, activate: disposition !== 'background-tab', dir })` and deny; `new-window` popups (window features) → `allow` with `overrideBrowserWindowOptions: popupWindowOptions(dir)` (keeps `window.opener`, needed for OAuth). Popup windows get the same UA (session-level) and close themselves when the page calls `window.close()`.
  - `context-menu` → `Menu.buildFromTemplate` from `contextMenuSpec`; Save Image → `webContents.downloadURL`; Search → new tab after current with `toNavigableUrl(selection)`; Inspect → `inspectElement(x, y)`.
  - `will-download` on each profile session: `item.setSavePath(uniqueDownloadPath(app.getPath('downloads'), item.getFilename(), fs.existsSync))`; track in `UiState.downloads` (id = `crypto.randomUUID()`, keep last 20 per app run); `done` → macOS notification "Downloaded <name>" for completed.
  - UI: a "Downloads" section at the bottom of the sidebar (above the bottom bar), shown only when the list is non-empty: filename, progress bar while `progressing`, click → `revealDownload` → `shell.showItemInFolder(path)`.
  - HTML5 full screen: on `enter-html-full-screen` make the tab view fill the window (and the window full screen); restore on `leave-html-full-screen`.

- [ ] **Step 1: Write the failing tests** — `uniqueDownloadPath` cases above (with a fake `exists`); `contextMenuSpec` for link-only, image, selection-in-editable, and plain page (only Inspect) with no leading/trailing/double separators; `popupWindowOptions('Profile 36').webPreferences.partition === 'persist:Profile 36'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check** — ⌘-click a link → background tab next to the current one; "Sign in with Google" popup on a third-party site opens a small window in the **same** profile and completes; right-click menus for link/image/text/input; download a PDF → appears in Downloads list, lands in `~/Downloads` with `(1)` on repeat, click reveals in Finder; YouTube full screen fills the window and Esc restores; Profiles ▸ Open This Profile in Chrome opens Chrome on that profile.
- [ ] **Step 6: Commit** — `feat: popups in the same profile, context menu, downloads, full screen`

---

### Task 10: Packaged app, retire v1, docs

**Files:**
- Create: `resources/icon.svg`, `scripts/make-icon.sh`, `resources/icon.icns` (generated, committed)
- Rewrite: `scripts/build-app.sh`, `README.md`, `CLAUDE.md`
- Delete: `Package.swift`, `Package.resolved` (if present), `Sources/`, `Tests/`, `Extension/`
- Modify: `docs/superpowers/specs/2026-11-18-superbrowser-design.md` (status line → `Status: superseded 2026-11-19 by 2026-11-19-superbrowser-electron-design.md`), `.gitignore` (drop `.build/`)

**Interfaces:**
- `scripts/make-icon.sh`: `qlmanage -t -s 1024 -o <tmp> resources/icon.svg` → `sips -z` to 16/32/64/128/256/512/1024 into `icon.iconset` (standard `icon_16x16.png`, `icon_16x16@2x.png`, … names) → `iconutil -c icns -o resources/icon.icns`. Icon: rounded square with a diagonal gradient and three overlapping profile-colour dots (simple, legible at 16 px).
- `scripts/build-app.sh [--install]`: `npm ci` (if `node_modules` missing) → `npm test` → `npm run build` → stage `build/stage/` with `dist/` and a minimal `package.json` (`name`, `version`, `main: dist/main.cjs`) → `npx @electron/packager build/stage Superbrowser --platform=darwin --arch=arm64 --app-bundle-id=dev.superbrowser.app --icon=resources/icon.icns --out=build --overwrite --prune` → `codesign --force --deep --sign - build/Superbrowser-darwin-arm64/Superbrowser.app` → `codesign --verify --deep` → with `--install`: quit a running Superbrowser (`osascript -e 'quit app "Superbrowser"'`, ignore errors), replace `~/Applications/Superbrowser.app`, print the path.
- README: what it is (one paragraph), install (`scripts/build-app.sh --install`), first run (import logins; Keychain "Always Allow"), shortcuts table (from Task 6), profile management, known limits (no passkeys — use password + 2-step or import; no password autofill — use the Passwords app; no Chrome extensions — "Open This Profile in Chrome"; claude.ai needs a fresh login; Google may occasionally sign one browser out — use Replace Logins), and a **Verify it works** checklist made of the manual checks from Tasks 4–9.
- CLAUDE.md: commands (`npm install`, `npm test`, `npm run typecheck`, `npm start`, `scripts/build-app.sh [--install]`), architecture (core vs main vs ui vs preload, the `src/core` no-electron rule, `.ts` import extensions), invariants (partition naming, read-only Chrome data, permissions never silently granted, state decoding defaults, popups inherit the opener's partition, lazy restore), docs pointers (this spec and plan).

- [ ] **Step 1: Write `make-icon.sh` + `icon.svg`, run it** → `resources/icon.icns` exists (`file resources/icon.icns` reports "Mac OS X icon").
- [ ] **Step 2: Rewrite `build-app.sh`; run** `scripts/build-app.sh --install` → tests pass, `codesign --verify` succeeds, `~/Applications/Superbrowser.app` launches, the menu bar and Dock say "Superbrowser" with the new icon, and state/partitions from `npm start` runs are reused (same userData dir).
- [ ] **Step 3: Delete v1 files; run** `npm test && npm run typecheck` → still PASS (nothing referenced them); `git status` shows only intended deletions.
- [ ] **Step 4: Rewrite README and CLAUDE.md; update the old spec's status line.**
- [ ] **Step 5: Walk the README's "Verify it works" checklist on the installed app** and fix anything that fails.
- [ ] **Step 6: Commit** — `chore: package Superbrowser.app, retire the Swift app and extension, rewrite docs`

---

## Deviations during execution

- **App icon (R4):** the icon comes from the user's `resources/Superbrowser.png`. `scripts/make-icon.sh` resizes it with `sips` into an iconset and runs `iconutil`, producing `resources/icon.icns`. There is no `resources/icon.svg` and no `qlmanage` step.
- **No `--install` during the build task (R7):** Task 10 built and checked the bundle in `build/` only, because installing would replace `~/Applications/Superbrowser.app` and quit the running v1. Installing waits for the user's OK. `scripts/build-app.sh --install` still does it.
- **Packaging details:**
  - `productName: "Superbrowser"` is in package.json and in the staged package.json, so `npm start` and the app share `~/Library/Application Support/Superbrowser`.
  - The packager gets `--electron-version` explicitly, because the staged package.json has no electron dependency.
  - Info.plist gets `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`, which Meet needs, and `NSLocalNetworkUsageDescription` (2026-11-20) so macOS asks before pages reach LAN devices.
  - `--install` targets `/Applications` since 2026-11-20 (Finder's Applications folder); it removes the older `~/Applications` copy.
- **Extra modules beyond the file map:**
  - `src/core/uiProtocol.ts`: UI command validation and bar profiles.
  - `src/main/profileManager.ts`: profile order, hide/unhide and the dot menu. It was moved out of `main.ts` before the import work (R5).
  - `src/main/importFlow.ts`: the import sheets and import lock, separate from `importer.ts`.
  - `src/main/pages.ts`: new-window handling, popups and the context menu.
  - `src/main/downloads.ts`: download tracking. `src/core/downloads.ts` has the pure parts.
  - Also `src/ui/find.css` (the CSP forbids inline styles).
- **Import menu items (R1):** Task 7 added the import items to the Profiles menu, not Task 6.
- **Only Allow is persisted (R6):** a Block, remembered or not, lasts only for the app run. The default stays Block, and a site can always ask again after a relaunch.
- **Permission prompts are tied to their tab:**
  - At most one pending prompt per tab. Further requests from that tab are refused.
  - A prompt from a page that navigated or closed is dropped without a sheet.
- **blob: URLs open as popups** in the opener's profile (`windowOpenTarget`). This survives the page revoking the URL right after `window.open`. A context-menu "Open Link in New Tab" on a blob: link opens a tab.
- **`nodeIntegrationInSubFrames: true` on page views** (`PAGE_WEB_PREFERENCES`), so the per-session frame preload (passkey fail-fast) also runs in iframes. Page views stay sandboxed with context isolation, and the preload exposes nothing to pages.
- **Hidden profiles are muted (R5):** a hidden profile's live tab views keep running but are muted until the profile is shown again.
- **Device-bound Google logins aren't imported (2026-11-20):** see `docs/superpowers/specs/2026-11-20-google-sign-in-identity-design.md` and `docs/superpowers/plans/2026-11-20-withhold-device-bound-google-logins.md`. A copied Personal Google login was signed out because Chrome binds it to the Mac, and Replace Logins couldn't help. Import (add and replace) now withholds Google's cookies for such a profile. The Replace confirmation is now "Replace this profile's logins with Chrome's current ones?", and the first-import explanation says a profile used in Chrome at the same time can get signed out of some sites, instead of "Google may occasionally sign one of them out".
- **Chrome-identity gaps closed (2026-11-20):** see plan `docs/superpowers/plans/2026-11-20-google-sign-in-identity.md`. Page loads carry client hints, `Accept-CH` is honoured per origin, `window.chrome` has `app`/`csi`/`loadTimes`, replaced page functions read as native code, and the language list matches Chrome's. The frame preload's two page functions were merged into core `presentAsChrome`.
- **Bookmarks and history (added later):** see `docs/superpowers/plans/2026-11-19-bookmarks-history.md` and `docs/superpowers/specs/2026-11-19-bookmarks-history-design.md`. This supersedes the non-goal of importing history and bookmarks. Controller rulings during that work that differ from the plan's text:
  - a folder the import would create (a Chrome folder, or the "Other Bookmarks" / "Mobile Bookmarks" wrapper) is created only when at least one bookmark is added inside it, so empty Chrome folders aren't imported and re-importing doesn't recreate a folder the user renamed or deleted (bookmarks-bar items go at the top level);
  - Ruling A: inline completion also completes a typed path prefix (`acme.atlassian.net/ji` → `acme.atlassian.net/jira/software`), beyond the spec's host-only rule. Matching ignores case, but the completion keeps the stored case of the path and query (only the host is lowercased), so Enter opens a working URL;
  - an import whose Chrome History or bookmarks file exists but can't be read marks that part failed: its summary line says so ("…; history couldn't be read — try again."), the sheet is a warning, and its title is "No bookmarks or history were imported." when every profile failed outright. A -wal/-journal that Chrome removes mid-copy counts as absent;
  - history `page()` never splits rows with equal times across pages;
  - only real corruption sets `history.db` aside;
  - inline rename commits only on Enter (blur, Esc and a profile change cancel it);
  - an empty folder title is shown as "Untitled".
- **Tests sit next to sources** (`src/**/*.test.ts`), not in `test/`, which would collide with v1's `Tests/` on the case-insensitive disk.
- **Client hints insert the Google Chrome brand (final review F5; overrides the spec's fixed `Sec-CH-UA` string, which was Chrome 131's):**
  - `rewriteClientHints` parses Electron's own `Sec-CH-UA` and `Sec-CH-UA-Full-Version-List` values and adds `"Google Chrome"` (major, or full version). Electron's GREASE entry and `"Chromium"` are kept; the three take the slots Chrome's `GenerateBrandVersionList` gives them for that major (for 156: GREASE, Chromium, Google Chrome), so the header equals what Chrome 156 sends. A value that doesn't parse gets the entry appended.
  - The frame preload gives `navigator.userAgentData.brands`, `getHighEntropyValues(['brands', 'fullVersionList'])` and `toJSON()` the same list. The brands are computed in the preload's isolated world with the same core function and passed to the page-world function as arguments.
  - Electron sends client hints only on subresource requests, not on navigations, and never sends opt-in hints such as the full version list. Superbrowser doesn't add missing hints.
- **Startup loads every visible profile's active tab (final review F8):** the shown profile's active tab loads at once, the other visible profiles' active tabs 300 ms apart, hidden (`TabManager.loadActiveTabs`), so their notifications and reminders work from launch. This is what the spec asked for; the first implementation loaded only the shown profile's tab. Other tabs and hidden profiles' tabs stay lazy.
- **Keychain copy says Allow, not Always Allow (final review F4):** the Keychain prompt comes from `/usr/bin/security`, so Always Allow would trust `security` for "Chrome Safe Storage" and let any process read Chrome's cookie key without a prompt. The import sheet, the Keychain error and the README say Allow; macOS then asks once per app run that imports. The README explains how to remove an earlier Always Allow.
- **Shortcuts act on a focused popup (final review F2):** ⌘W closes the popup; ⌘R, ⌘P, zoom, DevTools and Back/Forward act on the popup's page; ⌘F/⌘G do nothing there (no find bar in popups). Other shortcuts (⌘T, ⌘L, ⌃N, ⌘1…9) act on the main window, which ⌘T/⌘L focus.
- **Popup titles show host and profile (final review F3):** a popup's title is `host — page title (profile)` from its current URL (punycode for IDN hosts, a blob: URL's origin host). The page's own title can't replace it.
- **Downloads list per profile (final review M2):** downloads carry their profile; the sidebar lists only the shown profile's, and each profile keeps its newest 20 of the run. Completion notifications still name the profile.
- **Address field above the page (2026-11-19, user request):** back, forward, reload and the address field moved from the top of the sidebar to a 44 px toolbar strip above the page (`toolbar.html`, its own view so the suggestions card can drop down over the page; the view grows while the card shows and is raised over the tabs, then returns below them). It stays visible with the sidebar hidden, and ⌘T/⌘L no longer show the sidebar. The sidebar now starts with the tabs.
