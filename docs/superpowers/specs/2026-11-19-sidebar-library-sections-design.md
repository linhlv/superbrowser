# Bookmarks and History as collapsible sidebar sections (short design)

Date: 2026-11-19 · Status: approved by the user

## Intent

Today ⌘Y and ⌘⌥B open a History or Bookmarks panel that *replaces* the tab
list. The user wants to see tabs, bookmarks and history together: Bookmarks and
History become two collapsible sections under the tabs in the sidebar.

## What exists

- `src/ui/index.html`: `#tabs` (tab list + New Tab), then `#panel` (title,
  close button, search, list), then `#downloads` (only while non-empty, capped
  at 35% height).
- `src/ui/parts/panel.ts`: one panel at a time (`shown`), history day groups
  with infinite scroll, bookmark folder tree with search, rename-in-place,
  right-click menus, `seq` guards so stale or other-profile replies are dropped,
  reset on profile change.
- Main sends `PanelRequest { panel, mode: 'toggle' | 'show', highlight }`;
  the sidebar is shown first if hidden (`showPanel` in `main.ts`).
- `state.json` (`src/core/appState.ts`) holds UI flags like `sidebarVisible`,
  `showNames`, decoded tolerantly.

## Approaches

1. **One long scroll** (tabs, then sections, all scrolling together). Simplest,
   but with many tabs the section headers scroll out of sight. Rejected.
2. **Fixed headers, each section scrolls inside itself (chosen by the user).**
   Like VS Code's side panes: headers always visible, open sections share the
   free height.

## Design

- **Layout, top to bottom:** address field · **Bookmarks** section ·
  **History** section · tabs (with New Tab) · Downloads (unchanged). The tab
  list is never hidden any more; the panel's ✕ button goes away. (First built
  with the sections under the tabs; moved above them at the user's request.)
- **Section header:** one line, `▸ BOOKMARKS` / `▾ HISTORY` in the existing
  small-caps header style; clicking it opens or folds the section. A folded
  section is just its header.
- **Open section:** its own search field at the top, then its list, which
  scrolls inside the section. Bookmarks: folder tree, search, rename, menus as
  today. History: day groups, search, infinite scroll as today.
- **Height sharing:** with no section open the tabs take the whole column. When
  a section is open, the tabs take what they need up to about half the column
  (then scroll), and the open sections split what is left equally. Each open
  section keeps a minimum height so it is never squashed to nothing.
- **Both can be open at once**; each has its own state (search text, scroll,
  history paging, folder open state).
- **Open/folded is remembered** across launches in `state.json`
  (`openSections`, a list of `'bookmarks' | 'history'`, default: both folded),
  app-wide rather than per profile. The UI sends a validated
  `{ type: 'setSectionOpen'; section; open }` command; main saves it and echoes
  it in the state push.
- **Shortcuts:** ⌘Y / ⌘⌥B toggle their section: a folded one opens and its
  search field takes the keyboard; an open one folds. If the sidebar is hidden
  it is shown and the section opened, never folded (today's `mode: 'show'`
  rule). ⌘D bookmarks the page and opens Bookmarks with the bookmark revealed
  and highlighted, as today.
- **Esc** in a section's search clears it if it has text, otherwise leaves the
  field; Esc never folds a section.
- **Profile switch:** open sections reload for the new profile and drop the old
  profile's rows at once (existing `seq` guards and reset); folder open state
  resets per profile as today; which sections are open does not change.
- **Lazy:** a folded section asks the library for nothing; library-changed
  events refresh only open sections.
- **Docs:** README (sidebar paragraph, History/Bookmarks paragraphs, the
  "Verify it works" checks for History and Bookmarks), CLAUDE.md UI notes.

## Non-goals and anti-goals

- No draggable dividers between sections (possible later).
- No per-profile open/folded state.
- No change to what history or bookmarks store, or to importing.
- Anti-goals: opening or folding a section must not rebuild or flicker the tab
  list; a section must never show another profile's rows; folded sections must
  not query the library.

## Left to the builder

Exact minimum heights and the "about half" cap, header styling details, whether
`panel.ts` becomes two section instances or one module managing both, and the
order of the new state field in `appState.ts`.
