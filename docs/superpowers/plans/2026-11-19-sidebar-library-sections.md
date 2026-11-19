# Bookmarks and History Sidebar Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bookmarks and History become two collapsible sections under the tab list (fixed headers, each scrolling inside itself) instead of a panel that replaces the tabs.

**Architecture:** Main owns which sections are open (`state.openSections`, saved in `state.json`). The UI reads it once from the first state push, then is authoritative for header clicks (it sends `setSectionOpen`, main saves). ⌘Y / ⌥⌘B / ⌘D are decided in main by a pure core function and reach the UI as a `PanelRequest` that says whether the section is now open. `src/ui/parts/panel.ts` is split into one module per section.

**Tech Stack:** Electron 45, TypeScript by type stripping, `node:test`, esbuild.

**Spec:** `docs/superpowers/specs/2026-11-19-sidebar-library-sections-design.md`

## Global Constraints

- `src/core` never imports `electron`; imports between TS files use explicit `.ts` extensions; erasable TS only.
- Tests sit next to sources (`*.test.ts`); run `npm test` and `npm run typecheck`.
- UI commands are accepted only on the UI view's `webContents.ipc` and validated by `parseUiCommand`.
- CSP: no inline `style=""` in HTML; styles via classes or `element.style` from script. Titles and URLs are untrusted: build rows with `textContent` (`el` in `src/ui/parts/dom.ts`).
- `src/ui/*.ts` are esbuild entry points; helper modules go in `src/ui/parts/`.
- `state.json` decodes tolerantly: a bad `openSections` falls back to its default (`[]`) without losing other fields.
- Section order is always Bookmarks then History; `openSections` is app-wide, not per profile; default both folded.
- A folded section sends no library request (`historyPage`, `bookmarks`), including on library-changed and profile change.
- Opening or folding a section never rebuilds the tab rows (`tabRows` in `ui.ts` stay keyed); only layout changes.
- A section never shows another profile's rows (keep the `seq` guards and reset on profile change).
- Esc never folds a section. With the sidebar hidden, ⌘Y / ⌥⌘B show it and open the section, never fold it.

## Review Focus

1. **A state push racing a header click must not flip the section back.** Tab events push state constantly; if the UI applied `openSections` from every push, a push sent before main processed the click would fold the section again and reload it. The UI takes `openSections` from the first push only. (Task 2 code; hand check "click a header while a page is loading".)
2. **A corrupt `openSections`** (`['history', 'history', 'x']`, a string, missing) decodes to known, unique sections in canonical order, or `[]`. (Task 1 test `decodeState: openSections is tolerant`.)
3. **⌘Y with the sidebar hidden and History already open** leaves History open and focused. (Task 1 test `sectionToggle: a revealed sidebar never folds`.)
4. **A folded section is silent:** library-changed events and profile switches send nothing for it. (Task 2 code.)
5. **A forged `setSectionOpen`** (unknown section, non-boolean `open`) is rejected. (Task 1 test in `uiProtocol.test.ts`.)

---

### Task 1: openSections state, the setSectionOpen command and the shortcut decision

**Files:**
- Create: `src/core/sections.ts`, `src/core/sections.test.ts`
- Modify: `src/core/appState.ts`, `src/core/appState.test.ts`
- Modify: `src/shared/types.ts`, `src/core/uiProtocol.ts`, `src/core/uiProtocol.test.ts`
- Modify: `src/core/libraryMenus.ts`, `src/core/libraryMenus.test.ts` (remove `panelRequestFor`, superseded by `sectionToggle`)
- Modify: `src/main/main.ts`, `src/main/menu.ts` (doc comments: "section" not "panel")

**Interfaces:**
- Produces:

```ts
// shared/types.ts
export type Section = 'bookmarks' | 'history';
// PanelRequest is replaced by: open = the section's state after the request; when open, the UI focuses its search
export type PanelRequest = { panel: Section; open: boolean; highlight: number | null };
// UiState gains: openSections: Section[];
// UiCommand gains: | { type: 'setSectionOpen'; section: Section; open: boolean }

// core/sections.ts
export const SECTIONS: readonly Section[]; // ['bookmarks', 'history']
export function isSection(v: unknown): v is Section;
/** `open` with `section` set to `isOpen`; unique, in SECTIONS order. */
export function withSection(open: readonly Section[], section: Section, isOpen: boolean): Section[];
/** ⌘Y / ⌥⌘B ('toggle') or ⌘D ('show'): the new open list and the request for the UI. */
export function sectionToggle(open: readonly Section[], section: Section, mode: 'toggle' | 'show',
  highlight: number | null, revealedSidebar: boolean): { open: Section[]; request: PanelRequest };

// core/appState.ts: AppState gains openSections: Section[] (default [])
```

- [ ] **Step 1: Write the failing tests**

```ts
// sections.test.ts
test('withSection keeps SECTIONS order and no duplicates', () => {
  assert.deepEqual(withSection([], 'history', true), ['history']);
  assert.deepEqual(withSection(['history'], 'bookmarks', true), ['bookmarks', 'history']);
  assert.deepEqual(withSection(['bookmarks', 'history'], 'history', true), ['bookmarks', 'history']);
  assert.deepEqual(withSection(['bookmarks', 'history'], 'bookmarks', false), ['history']);
  assert.deepEqual(withSection([], 'history', false), []);
});
test('sectionToggle: toggle opens a folded section and folds an open one', () => {
  assert.deepEqual(sectionToggle([], 'history', 'toggle', null, false),
    { open: ['history'], request: { panel: 'history', open: true, highlight: null } });
  assert.deepEqual(sectionToggle(['bookmarks', 'history'], 'history', 'toggle', null, false),
    { open: ['bookmarks'], request: { panel: 'history', open: false, highlight: null } });
});
test('sectionToggle: a revealed sidebar never folds', () => {
  assert.deepEqual(sectionToggle(['history'], 'history', 'toggle', null, true),
    { open: ['history'], request: { panel: 'history', open: true, highlight: null } });
});
test('sectionToggle: show always opens and carries the highlight', () => {
  assert.deepEqual(sectionToggle(['bookmarks'], 'bookmarks', 'show', 7, false),
    { open: ['bookmarks'], request: { panel: 'bookmarks', open: true, highlight: 7 } });
});

// appState.test.ts
test('decodeState: openSections is tolerant', () => {
  assert.deepEqual(decodeState({}).openSections, []);
  assert.deepEqual(decodeState({ openSections: 'history' }).openSections, []);
  assert.deepEqual(decodeState({ openSections: ['history', 'history', 'x', 3, 'bookmarks'] }).openSections, ['bookmarks', 'history']);
  assert.equal(decodeState({ openSections: 'bad', showNames: true }).showNames, true);
});

// uiProtocol.test.ts — accepted:
{ type: 'setSectionOpen', section: 'history', open: true },
{ type: 'setSectionOpen', section: 'bookmarks', open: false },
// rejected:
test('parseUiCommand: rejects bad setSectionOpen', () => {
  for (const c of [
    { type: 'setSectionOpen', section: 'downloads', open: true },
    { type: 'setSectionOpen', section: 'history', open: 'yes' },
    { type: 'setSectionOpen', section: 'history' },
  ]) assert.equal(parseUiCommand(c, known), null, JSON.stringify(c));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/sections.test.ts src/core/appState.test.ts src/core/uiProtocol.test.ts`
Expected: FAIL (`sections.ts` missing, `openSections` undefined, `setSectionOpen` parses to null).

- [ ] **Step 3: Implement**

- `sections.ts` and `decodeState` (`openSections: withSection`-style canonicalisation of the strings that are sections).
- `parseUiCommand`: `setSectionOpen` returns a fresh `{ type, section, open }` when `isSection(section)` and `typeof open === 'boolean'`.
- Remove `panelRequestFor` and its test from `libraryMenus.ts`.
- `main.ts`:
  - `pushState` adds `openSections: state.openSections`.
  - `case 'setSectionOpen'`: `state.openSections = withSection(state.openSections, cmd.section, cmd.open)`, then save the same way `showNames` does. No `pushState` needed (the UI already shows it).
  - `showPanel(panel, mode, highlight)`: `reveal = !state.sidebarVisible`; show the sidebar if hidden; `const r = sectionToggle(state.openSections, panel, mode, highlight, reveal)`; store `r.open` and save; focus the window and UI view only when `r.request.open`; `toUi(IPC.panel, r.request)`. Callers: `showHistory` → `('history', 'toggle', null)`, `showBookmarks` → `('bookmarks', 'toggle', null)`, ⌘D → `('bookmarks', 'show', highlight)`.

Until Task 2 lands the old UI reads the new `PanelRequest` loosely; that is expected and is fixed by Task 2.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test && npm run typecheck`
Expected: PASS. (`typecheck` will flag `src/ui/parts/panel.ts` where it reads `mode`; make the minimal change there that keeps today's behaviour: treat `open: false` as close, `open: true` as show.)

- [ ] **Step 5: Commit**

```bash
git add src/core/sections.ts src/core/sections.test.ts src/core/appState.ts src/core/appState.test.ts src/shared/types.ts src/core/uiProtocol.ts src/core/uiProtocol.test.ts src/core/libraryMenus.ts src/core/libraryMenus.test.ts src/main/main.ts src/main/menu.ts src/ui/parts/panel.ts
git commit -m "feat: remembered sidebar sections and the shortcut decision in core"
```

---

### Task 2: Bookmarks and History sections under the tabs, and docs

**Files:**
- Create: `src/ui/parts/libraryRows.ts` (shared row helpers now in `panel.ts`: `row`, `host`, `clock`, `formatDay`, empty row, open-on-click), `src/ui/parts/historySection.ts`, `src/ui/parts/bookmarksSection.ts`
- Delete: `src/ui/parts/panel.ts`
- Modify: `src/ui/index.html`, `src/ui/ui.ts`, `src/ui/ui.css`, `src/preload/ui.ts` (only if the `PanelRequest` import needs it)
- Modify: `README.md` (line 3 sidebar sentence if needed; the "Bookmarks and history" paragraph's "panels" wording; shortcut table rows for ⌘Y / ⌥⌘B: "Open or fold History/Bookmarks in the sidebar"; checks 37–42 reworded for sections; a new check 44 for this feature), `CLAUDE.md` (UI parts list: replace `panel.ts` with the two section modules and `libraryRows.ts`)

**Interfaces:**
- Consumes (Task 1): `Section`, `PanelRequest { panel; open; highlight }`, `UiState.openSections`, command `setSectionOpen`.
- Produces: each section module exports a setup function returning this shape (names are binding):

```ts
type SectionHandle = {
  setOpen(open: boolean): void;      // no-op when unchanged; opening loads, folding drops rows and invalidates requests
  focusSearch(): void;
  onReply(r: LibraryReply): void;    // ignores replies while folded or with a stale seq
  onProfileChanged(): void;          // drop rows at once; reload only if open; keeps the search text
  onLibraryChanged(): void;          // reload only if open
};
export function setupHistorySection(opts: { sb: SuperbrowserApi; root: HTMLElement }): SectionHandle;
export function setupBookmarksSection(opts: { sb: SuperbrowserApi; root: HTMLElement }):
  SectionHandle & { reveal(id: number): void; startRename(id: number): void };
```

- [ ] **Step 1: Markup and layout**

- `index.html`: inside `#side`, after `#tabs` and before `#downloads`, two `<section class="sec" id="sec-bookmarks">` / `id="sec-history"` elements, each with a header button (`.sec-h`: arrow `▸`/`▾` + title "Bookmarks"/"History"), and a body (`.sec-b`, hidden while folded) holding a search `<input type="search">` (placeholders "Search bookmarks" / "Search history") and a list. Remove `#panel`. `#tabs` is never hidden any more.
- `ui.css`: `#side` stays a flex column. Folded `.sec` is `flex: none` (header only). `.sec.open` is `flex: 1 1 0; min-height: 120px;` a flex column whose list scrolls (`overflow-y: auto; min-height: 0`). When any section is open, `#tabs` becomes `flex: 0 1 auto; max-height: 50%` (use `#side:has(.sec.open) #tabs`); otherwise it keeps `flex: 1`. Reuse the existing `.pr`, `.pday`, `.pempty`, `.bm-*` row styles and the `.panel-h` small-caps look for `.sec-h`. Drop the `#panel*` rules.

- [ ] **Step 2: Split `panel.ts` into the section modules**

Move the History logic (day groups, paging with `LOAD_MORE_WITHIN_PX`, debounced search `SEARCH_DELAY_MS`, row menu) to `historySection.ts` and the Bookmarks logic (tree, search, folder open state per profile, highlight/reveal, rename-in-place, row menu) to `bookmarksSection.ts`, each with its own `seq`, search field and list, behaving as today except:
- `shown` becomes the section's own `open` flag; `close()`/`onPanel` become `setOpen`, `reveal`, `focusSearch`.
- Esc in a section's search: clears it (and re-runs the search) when it has text, otherwise blurs it. The document-level Esc-closes-panel handler goes away.
- `reveal(id)` and `startRename(id)` work as today's highlight/pendingRename paths (they may arrive before the tree loads).

- [ ] **Step 3: Wire it in `ui.ts`**

- Set up both sections. Header click: flip that section locally with `setOpen`, toggle `.open` on its `<section>` and the arrow, and `sb.send({ type: 'setSectionOpen', section, open })`; focus its search when it opens.
- First state push only: apply `s.openSections` to both sections (later pushes don't touch them, see Review Focus 1).
- `sb.onPanel(req)`: `setOpen(req.open)` on that section (same DOM update as a click, without sending); when `req.open`, `focusSearch()`, and for bookmarks with `req.highlight !== null`, `reveal(req.highlight)`. Leaving focus when a section folds while it held focus: blur, as `close()` does today.
- `sb.onLibrary`: suggestions as today; other replies go to both sections' `onReply`. `sb.onLibraryChanged` → both `onLibraryChanged()`. `sb.onStartRename` → bookmarks `startRename`. Profile change → both `onProfileChanged()`.

- [ ] **Step 4: Docs** (files listed above). New check 44:

> 44. Under the tabs, **Bookmarks** and **History** headers are folded on first launch. Click Bookmarks: it opens under the tabs, the tab list stays and shrinks to at most about half the sidebar, and both scroll on their own. Open History too: the two share the space. Quit and relaunch: both are still open. Click a header while a page is loading: it stays the way you clicked it. Esc in a section's search clears it, then leaves the field; it never folds the section. ⌘Y folds History; ⌘Y again opens it with the search focused.

- [ ] **Step 5: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui src/preload/ui.ts README.md CLAUDE.md
git commit -m "feat(ui): bookmarks and history as collapsible sections under the tabs"
```
