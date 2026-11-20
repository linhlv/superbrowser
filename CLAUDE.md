# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Superbrowser is a macOS (Apple Silicon) browser built with Electron + TypeScript. It shows every Chrome profile in one window: a toolbar strip above the page holds back/forward/reload and the address field, an Arc-style sidebar holds the current profile's tabs, and a bottom bar holds profile pills (click or ⌃1…⌃9 to switch) and, at its right, pinned tabs from any profile (⌥⌘1…⌥⌘9). Each Chrome profile gets its own Electron session partition. Logins can be imported from Chrome's cookies. README.md covers install, behaviour, known limits and the manual end-to-end checklist ("Verify it works"). v1 (a Swift app that stacked real Chrome windows, plus a helper extension) was retired and lives only in git history.

## Commands

```
npm install                       # once (Node 22, Command Line Tools only; no Xcode)
npm test                          # all unit tests: node --test "src/**/*.test.ts"
node --test src/core/tabs.test.ts # one file
npm run typecheck                 # tsc --noEmit
npm run build                     # esbuild src → dist/ (main.cjs, preload/*.cjs, ui/*)
npm start                         # build + run in Electron (dev; the menu bar says "Electron")
scripts/build-app.sh [--install]  # tests, build, package build/Superbrowser-darwin-arm64/Superbrowser.app, ad-hoc sign; --install quits Superbrowser and replaces /Applications/Superbrowser.app (removing an old ~/Applications copy)
scripts/make-icon.sh              # resources/Superbrowser.png → resources/icon.icns (commit both)
```

- `npm start` and the packaged app share `~/Library/Application Support/Superbrowser` because `productName` is `Superbrowser` in package.json (the staged package.json copies it). Keep it.
- The app logs to stderr with the `Superbrowser:` prefix (`log` in `src/main/main.ts`).
- Bumping Electron (`npm install electron@latest`, rebuild) is meant to be routine. The UA and client hints derive from `process.versions.chrome`, so don't hard-code a version anywhere.

## Architecture

- **`src/core/`**: pure logic, unit-tested under plain Node. It must **never import `electron`**. Covers:
  - address parsing, UA/client hints, Chrome profile parsing and merging, display names and initials (`profiles.ts`);
  - readable colours (`colors.ts`): WCAG luminance/contrast, `readableTint` (darkens a light profile colour for the window tint so white text reads) and `textOn` (avatar initials colour);
  - pinned tabs (`pins.ts`): keys `dir|host`, add/remove/move, decode, which tab a pin shows, remembered tab, favicon;
  - state decode and atomic store, the tab model, layout maths (`layout.ts`: page, toolbar and find bar bounds), drag-to-reorder slot maths (`dragOrder.ts`) and keyed row reordering with fewest moves (`reorder.ts`);
  - cookie decryption and import planning, the permission policy and prompt queue;
  - download names and the per-profile downloads list, context-menu spec, popup titles, UI command validation (`uiProtocol.ts`), sidebar sections and the ⌘Y/⌥⌘B/⌘D decision (`sections.ts`), a trailing-edge throttle (`throttle.ts`);
  - bookmarks and history: the bookmark tree (`bookmarks.ts`, `bookmarkStore.ts`), history queries and retention (`history.ts`), visit recording rules (`visits.ts`), accent-insensitive matching (`searchText.ts`), address-bar suggestions (`suggest.ts`), parsing Chrome's `Bookmarks`/`AccountBookmarks`/`History` and import planning (`chromeLibrary.ts`), bookmark and history context menus (`libraryMenus.ts`). `address.ts` also has `isWebUrl` and `googleSearchUrl`; `store.ts` has `writeFileAtomic`.
- **`src/main/`**: thin Electron adapters wired together in `main.ts`:
  - `sessions.ts`: per-profile session, UA, permissions, frame preload, downloads.
  - `tabManager.ts`: one `WebContentsView` per tab, lazy restore, muting; `showTab`/`showNewTab`/`tabsOf`/`faviconOf`/`titleOf` for pins; `onFullScreen` when a page enters or leaves HTML full screen. A tab's icon is not cleared on navigation (Chromium reports icons only when they change, so a reload reports none); until a page reports one, the tab shows the icon history saved for its URL or origin (`savedFavicon`, `HistoryDb.faviconForPage`).
  - `browserWindow.ts`: window, UI view, toolbar view (`Toolbar`), find bar, layout.
  - `pages.ts`: new windows, popups, context menu.
  - `profileManager.ts`: order (applies core `moveProfile`/`placeProfile`), hide/unhide, pill menu (incl. Set Display Name…).
  - `importer.ts` and `importFlow.ts`: login import and its sheets.
  - `menu.ts`: the application menu and every shortcut (it is the source of truth for shortcuts), plus the pill, sidebar-tab and pin-tile right-click menus.
  - `chrome.ts`: reads Chrome's `Local State`; opens a profile in Chrome.
  - `downloads.ts`.
  - `library.ts`: `Library`, the only access to each profile's `history.db` (`node:sqlite`) and `bookmarks.json`.
  - `historyRecorder.ts`: records visits from tab navigation events. `main.ts` turns each visit or title recorded in the shown profile into a throttled `IPC.historyRecorded` notice; an open History section at the top, not searching, refetches its first page. `libraryChanged` (edits, deletes, clears, imports) still reloads open sections unconditionally.
  - `libraryImport.ts`: copies Chrome's files to a temp dir and imports bookmarks and history (add-only).
  - `main.ts` also wires pins: remembered tabs per pin (`rememberShown`, per run only), the pin's icon and title following its tab, and a pin click (`pinTarget`, then `showTab` or `showNewTab`), plus the toolbar's commands (suggestions, its height, a click passed through to the page).
- **`src/preload/`**: `ui.ts` (contextBridge API for our UI pages) and `frame.ts` (per-session frame preload: runs core `presentAsChrome` from `pageIdentity.ts` in each page: passkey requests fail fast, `navigator.userAgentData` names Google Chrome, `window.chrome` and `navigator.languages` like Chrome's).
- **`src/ui/`**: the sidebar + bottom bar page (`index.html`, `ui.ts`), the toolbar above the page (`toolbar.html`, `toolbar.ts`: back, forward, reload, address field and its suggestions) and the find bar (`find.html`, `find.ts`). Our own pages; CSP forbids inline styles/scripts. `src/ui/parts/` holds UI helper modules (`suggestions.ts` for the address suggestions, `bookmarksSection.ts` and `historySection.ts` for the collapsible sections right under the tabs, `libraryRows.ts` for their shared rows (and `setupRoving`: one Tab stop per list, arrow keys, focus kept across re-renders), `profileBar.ts` for the pills and inline display-name edit, `pinBar.ts` for the pin tiles, `icons.ts` for the inline SVG icon set (no text glyphs as icons), `profileDrag.ts` for dragging profile pills, `dom.ts`) bundled into the entry points; only `src/ui/*.ts` are entry points.
- **`src/shared/types.ts`**: types and IPC channel names shared by main, preload and UI.

New logic belongs in `src/core` with a test; keep `src/main` to wiring. Tests sit next to sources as `*.test.ts` (`node:test` + `node:assert/strict`). Imports between TS files use explicit `.ts` extensions (`import { x } from './profiles.ts'`) and only erasable TS syntax (no `enum`, `namespace` or constructor parameter properties). Node runs the tests by type stripping.

Window structure: one `BrowserWindow`. Its child views stack in insertion order:

- the UI view first, filling the window;
- the toolbar view (`Toolbar` in `browserWindow.ts`), a 44 px strip above the page (`toolbarBounds`). While the address suggestions are open it grows over the page (transparent except the card) and is raised to the top; when they close it shrinks back and returns to index 1. It is hidden while a page is in HTML full screen (`TabManager.onFullScreen`), and reset to the strip if its page crashes or reloads;
- each tab's view on top, only the active one visible, starting below the strip (`tabBounds`, `TOP_H`);
- the find bar view, re-raised whenever it is shown.

Popups are separate small windows (registered in `pages.ts`, `isPopupWindow`). Their title is always `host — page title (profile)` (`popupTitle`). Page shortcuts (⌘W, ⌘R, ⌘P, zoom, DevTools, Back/Forward) act on a focused popup; ⌘W closes it. Closing the main window quits: tab pages close at once (`TabManager.shutDown`), popups are destroyed, and the saved tabs are kept. ⌘W never closes the main window.

## Invariants that are easy to break

- **Profile isolation.** The partition is exactly `persist:<chrome profile dir>` (`persist:Default`, `persist:Profile 37`). Get a session only through `profileSession(dir)`. Every web contents, popup, download, service worker and permission decision belongs to exactly one profile. A profile's cookies or storage must never reach another, and nothing may use the default session for pages.
- **Library isolation.** Every bookmark, history row and suggestion belongs to one profile. They live in `<userData>/Profiles/<chrome profile dir>/history.db` and `bookmarks.json`, reached only through `Library`. History keeps 90 days and stores only http(s) URLs. `node:sqlite` prints an ExperimentalWarning in tests and at app start; that is expected, don't suppress it globally.
- **Popups and new tabs inherit the opener's profile.**
  - Tab views use `pageWebPreferences(dir)`.
  - Popups use `popupWindowOptions(dir)` (partition plus `PAGE_WEB_PREFERENCES`).
  - `windowOpenTarget` decides tab, popup or deny: `blob:` opens as a popup, and anything but http(s), `blob:` and `about:blank` is denied.
- **Pages get no privileged API.**
  - `src/preload/frame.ts` is registered per profile session. It runs in subframes because page views set `nodeIntegrationInSubFrames` (sandboxed, so pages still get no Node). It must never expose an API, IPC or `contextBridge.exposeInMainWorld` to pages. It runs one function, `presentAsChrome` (`src/core/pageIdentity.ts`), via `executeInMainWorld`: it wraps `navigator.credentials`, `NavigatorUAData` and `navigator.languages`, fills `window.chrome`, and makes each replaced function (and `Function.prototype.toString`) read as native code. It is serialized, so it uses only its argument and page globals (no module scope); keep every page-world change inside it so they share its private registry.
  - UI commands are listened for only on the UI, toolbar and find views' own `webContents.ipc`, and validated by `parseUiCommand`. The find view only accepts find commands; the toolbar view only back, forward, reload, navigate, suggest, its own height and the bookmark star (`toggleBookmark`); the UI view not navigate, suggest, the toolbar height or the star.
  - Any `ipcMain` handler you add must reject senders that aren't the app's UI, toolbar or find views.
- **Chrome data is read-only.**
  - Never write to `~/Library/Application Support/Google/Chrome/**` or the "Chrome Safe Storage" Keychain item.
  - Copy a `Cookies` DB to a temp file before reading it.
  - Import is add-only. Only the explicit, confirmed "Replace Logins" overwrites.
  - Chrome's `Bookmarks`, `AccountBookmarks` and `History` are copied to a temp dir, then read from the copy. Bookmarks and history import is add-only, one-way, separate from the logins import, and needs no Keychain access.
  - A cookie that can't be imported is skipped and counted; it never aborts the import.
  - A device-bound Google login is never imported: when the profile's `Device Bound Sessions` (copied to a temp dir, like `Cookies`) lists a Google site (`bindsGoogle`), Google's cookies (`isGoogleHost`) are withheld before decryption and counted as `withheld`. An unreadable file counts as bound.
- **Site permissions are never granted silently** (Electron's default allows everything); `policyFor` decides allow/ask/deny.
  - Only Allow decisions are persisted. Block lasts for the app run.
  - Prompts are tied to their tab: one pending prompt per tab, and a prompt from a page that navigated or closed is dropped.
- **Browser identity:**
  - UA `… Chrome/<major>.0.0.0 Safari/537.36`.
  - Client hints add `"Google Chrome"` to Electron's own brand list (`withChromeBrand`): Electron's GREASE brand and `"Chromium"` are kept, and the three take the order Chrome of that major uses. `Sec-CH-UA` gets `v="<major>"`, `Sec-CH-UA-Full-Version-List` the full version. The frame preload gives `navigator.userAgentData` (`brands`, `getHighEntropyValues`, `toJSON`) the same list. Never hard-code a brand list.
  - Electron sends no hints on page loads and ignores `Accept-CH`, so `withClientHints` (`clientHints.ts`, wired in `sessions.ts`) adds the low-entropy three to every secure request and the high-entropy hints an origin asked for (per profile session, per origin, for the run). `chromeBrands` builds the list from the version (Chromium's GREASE rule).
  - `Accept-Language` and `navigator.languages` are the system languages each followed by its base language (`acceptLanguages`), like Chrome's.
  - `<major>` is the major of `process.versions.chrome`.
  - Never automate sign-in.
- **Profiles from Chrome:** a missing, unreadable or mid-write `Local State` (empty `info_cache`) keeps the profiles already known (`mergeProfiles`). Profiles deleted in Chrome stay until hidden. The bar is never empty.
- **State:** `state.json` decodes tolerantly. A bad or missing field falls back to its default without losing the others, a corrupt file is set aside, and writes are atomic. v1's `settings.json` next to it is ignored.
- **Lazy restore:** after launch, only each visible profile's active tab loads: the shown one at once, the others hidden, 300 ms apart (`loadActiveTabs`). Other tabs, and hidden profiles' tabs, load when first shown. Within a run, tabs are never unloaded, and switching tab or profile never reloads.
- **Closing tabs:** a tab closes through `webContents.close({ waitForBeforeUnload: true })` and leaves the model only when its page is destroyed, so "Stay" on the "Leave site?" sheet (`will-prevent-unload`, in `wirePage`) keeps it. After a page is destroyed Electron drops the view's `webContents` (it reads `undefined`): go through `openContents(view)`. Nothing that runs while the window closes may change the saved tabs.
- **State saves:** the store writes at most 2 s after the first unsaved change, however often `save` is called; tab events that change nothing saved (loading, favicons, titles) don't save, except when they change a pin's stored icon or title.
- **Display names:** live only in `state.displayNames`; Chrome's profile names are never written.
- **Pins:** a pin carries its own `dir` and opens only in that profile (through the normal per-profile tab path). One pin per profile and host (`dir|host`); a click goes to the remembered tab on that host, else the first tab on it, else opens the pin's URL, and never reloads. Pins of hidden profiles are kept but not shown.
- **Hidden profiles:** their tab views keep running but are muted (`setAudioMuted`) while hidden.

## Docs

- `docs/superpowers/specs/2026-11-19-superbrowser-electron-design.md`: intent, goals, non-goals and anti-goals for v2. The anti-goals:
  - no cross-profile leaks;
  - don't get a client account flagged;
  - never break the user's Chrome;
  - no silent permissions;
  - no flicker or reloads;
  - never lose tabs or logins.
- `docs/superpowers/plans/2026-11-19-superbrowser-electron.md`: the implementation plan. Its **Deviations during execution** section records where the code intentionally differs; update it when you change one of those decisions.
- `docs/superpowers/specs/2026-11-19-bottom-bar-pins-display-names-design.md` and `docs/superpowers/plans/2026-11-19-bottom-bar-pins-display-names.md`: steady profile pills, display names and pinned tabs (the spec ends with its own deviations).
- `docs/superpowers/specs/2026-11-18-superbrowser-design.md` and `docs/superpowers/plans/2026-11-18-superbrowser.md` cover v1 (superseded).
