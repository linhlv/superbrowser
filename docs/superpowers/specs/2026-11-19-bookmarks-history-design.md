# Superbrowser — bookmarks and history

Date: 2026-11-19
Status: approved 2026-11-19
Builds on `2026-11-19-superbrowser-electron-design.md` (v2). Reverses one of its
non-goals: "Importing anything other than cookies (history, bookmarks,
passwords)". Bookmarks and history are now in scope; passwords stay out.

## Intent and why

After "Import Logins" the user found their Chrome bookmarks missing from
Superbrowser. Superbrowser has no bookmarks and records no history, so it can't
yet replace Chrome. The user's words: "When I use Superbrowser, I don't want to
come back to Chrome." They want their bookmarks and history in Superbrowser, and
to keep both there from then on.

Success means:

- One import brings each profile's Chrome bookmarks and history into the
  matching Superbrowser profile.
- From then on the user bookmarks pages and finds past pages entirely inside
  Superbrowser.
- Typing in the address bar suggests pages from that profile's history and
  bookmarks.
- The user can browse their history and open a page from it.

## Goals

1. **Import once from Chrome, per profile.** Bookmarks (with their folders) and
   history are copied from each Chrome profile into the matching Superbrowser
   profile by the existing import. "Synced" means imported once, the user's
   word. Running the import again only adds what's missing.
2. **Superbrowser owns them afterwards.** ⌘D bookmarks the page. Bookmarks can be
   renamed, moved between folders and deleted in Superbrowser. Every page
   visited in a tab is recorded in that profile's history.
3. **Address-bar suggestions** (approved from a mockup). As the user types, a
   list under the address field shows matches from the shown profile's history
   and bookmarks:
   - the top row auto-completes the best-matching site;
   - bookmarks are marked ★;
   - the last row is "Search Google for …";
   - ↑/↓ move, Enter opens, Esc closes.

   The list stays inside the sidebar (see Constraints).
4. **History list in the sidebar** (user picked option B over a full-width sheet).
   - ⌘Y, or History ▸ Show History, swaps the sidebar's tab list for a history
     panel:
     - a search box;
     - entries newest first, grouped by day (Today, Yesterday, then dates);
     - each entry shows favicon and title, with time · site underneath.
   - Clicking an entry opens it. Esc, ✕ or ⌘Y brings the tabs back.
   - The page stays visible.
5. **Bookmarks in the sidebar** (user picked option B, "like History").
   - ⌘⌥B, or Bookmarks ▸ Show Bookmarks, swaps the tab list for the bookmark tree,
     with a search box. Folders open and close in place.
   - Clicking a bookmark opens it. Esc, ✕ or ⌘⌥B brings the tabs back.
6. **Per profile, always.** Each profile has its own bookmarks and its own
   history. Suggestions, the history panel and the bookmarks panel show only the
   shown profile's.

## Non-goals

- **Sync across devices.** Superbrowser can't use Chrome Sync. Bookmarks and
  history made in Superbrowser stay on this Mac. History from the user's phone
  or other computers doesn't arrive after the import.
- **Live link to Chrome.** After the import, changes in Chrome aren't followed.
  The user can run the import again by hand; it only adds.
- **Writing anything back to Chrome.**
- Passwords, autofill, Chrome's "Reading list", tab groups, and Chrome's history
  "journeys" or clusters.
- **Drag-and-drop reordering** of bookmarks (first version). Moving between
  folders uses a context-menu "Move to" submenu.
- **Export to a bookmarks HTML file.** Mentioned as a possible later addition.
- **History of popups** (sign-in windows). Only tabs record history.
- **Searching across profiles.**

## Anti-goals (a failure even if it technically works)

- **One profile's bookmarks, history or suggestions visible in another profile.**
  Client accounts must never cross. This is the same rule as cookies.
- **Touching Chrome's data.**
  - Chrome's `Bookmarks` and `History` files are only ever copied, then read.
  - Never write to them or open them in place, even while Chrome is closed.
- **Losing bookmarks or history** on quit, crash, update, or a corrupt file.
- **A re-import that undoes the user's edits.**
  - A bookmark the user renamed or moved in Superbrowser must not reappear as a
    duplicate.
  - A bookmark or history entry the user deleted may come back only if Chrome
    still has it and the user runs the import again. That is acceptable, see
    "Calls".
- **A sluggish address bar.** Suggestions must keep up with typing, about 50 ms
  or less per keystroke, with tens of thousands of history entries per profile.

## Constraints

- **Electron 45.3.4, Node 24.22.3.** `node:sqlite` works in Electron's main
  process; checked with SQLite 3.54.1 and the FTS5 extension available. Command
  Line Tools only, so no native modules that need building.
- **Where the suggestion list can draw.** Tab pages are `WebContentsView`s
  stacked above the UI view. Anything the UI page draws over the page area is
  hidden. The suggestion list and both panels must stay within the sidebar's
  240 px column.
- **Chrome's history format.** Each profile has a `History` SQLite file (copy it
  with its `-wal`/`-journal`, as the importer already does for `Cookies`).
  - Tables: `urls(id, url, title, visit_count, typed_count, last_visit_time,
    hidden)` and `visits(id, url → urls.id, visit_time, transition, …)`.
  - Times are microseconds since 1601-01-01 UTC.
  - Chrome keeps about 90 days. On this Mac, `Default` has about 12,700 URLs and
    25,500 visits.
- **Chrome's bookmarks format.** Each profile has a `Bookmarks` JSON file:
  - `roots.bookmark_bar`, `roots.other` and `roots.synced`;
  - each node is `{type: "url"|"folder", name, url?, children?, date_added}`;
  - `date_added` is microseconds since 1601.

  On this Mac: `Default` has 175 bookmarks in 36 folders, up to 3 levels deep.
  The other profiles have 14–71.
- **No Keychain needed** for bookmarks or history. Only cookies are encrypted.
- **Existing project rules** (see CLAUDE.md):
  - pure logic in `src/core`, with tests, and never importing `electron`;
  - UI commands validated by `parseUiCommand`;
  - IPC accepted only from the UI view;
  - our pages' CSP has no inline styles or scripts.

## Approaches considered (storage)

1. **One SQLite database per profile for history, using the built-in
   `node:sqlite` (chosen by the user).**
   - Instant search however large history grows, and each visit is one small
     write.
   - Each profile's history is a separate file, which keeps isolation
     structural.
   - Costs a little more code than JSON.
2. **JSON files per profile, held in memory.** Simplest, and like `state.json`.
   But every save rewrites a multi-MB file for each of about 7 profiles, and
   startup slows as history grows. Rejected.
3. **One shared database for all profiles** with a profile column. Rejected:
   isolation would rest on every query's `WHERE` clause.

Bookmarks are small, so they go in a JSON file per profile, written atomically
the way `state.json` is. The user accepted this along with approach 1.

## Decided parts of the how

### Storage

- **Location:** under `app.getPath('userData')`, in
  `Profiles/<chrome profile dir>/history.db` and
  `Profiles/<chrome profile dir>/bookmarks.json`.
- **Opening:** a profile's store is opened only through one accessor keyed by
  profile dir. It works like `profileSession(dir)` and is the only way in.
- **Retention:** history is kept for 90 days, like Chrome. Older visits are
  pruned at startup and once a day while running.
- **Robustness:**
  - A corrupt `bookmarks.json` is set aside (renamed `.corrupt-<time>`) and
    starts empty, like `state.json`.
  - A corrupt `history.db` is set aside the same way and recreated.
  - Neither may stop the app from starting.
- **A profile deleted in Chrome** keeps its Superbrowser bookmarks and history,
  as it keeps its tabs.

### Import

- **Bookmarks and history import separately from logins.** Re-running the login
  import is not harmless:
  - add mode (`planImport`) adds every Chrome cookie Superbrowser lacks, which
    includes cookies for accounts the user signed out of in Superbrowser;
  - after any cookie is set, it reloads the profile's loaded tabs;
  - each run asks for the Keychain.

  So:
  - **New menu item "Import Bookmarks and History from Chrome",** for all visible
    profiles at once. It's in the Profiles menu and the "+" menu. It needs no
    Keychain prompt, reloads no tab and never touches cookies. This is how
    already-imported users get their bookmarks and history.
  - **First-run offer** (new installs only) reads "Import your logins,
    bookmarks and history from Chrome for all profiles?". It runs the login
    import and then the bookmarks-and-history import.
  - **The login menu items stay as they are,** logins only: "Import Logins from
    Chrome", "Import Logins for All Profiles" and "Replace Logins from Chrome…".
    They don't import bookmarks or history.
- **Summary:** one line per profile, for example "Personal: 175 bookmarks,
  12,685 pages of history imported (3 skipped)". History is counted in pages,
  meaning distinct URLs. A missing `Bookmarks`, `AccountBookmarks` or `History`
  file counts as zero, not an error.
- **Bookmarks import (add-only):**
  - **Both of Chrome's bookmark files are read.** `Bookmarks` holds synced and
    local bookmarks. `AccountBookmarks` holds bookmarks saved to a signed-in,
    non-syncing Google account.
    - On this Mac, Profile 36 has both files, and Profiles 47 and 48 have only
      `AccountBookmarks`.
    - Both trees merge into the same Superbrowser tree under the same rules.
    - The user sees one set of bookmarks per profile, as in Chrome's bookmark
      manager.
  - Chrome's `bookmark_bar` children go at the top level. `other` becomes a
    folder "Other Bookmarks", and `synced` a folder "Mobile Bookmarks". Each is
    created only if non-empty.
  - A Chrome bookmark is skipped if a bookmark with the same URL already exists
    anywhere in that profile's Superbrowser bookmarks. That covers ones the user
    renamed or moved.
  - Folders are matched by name path, so re-imports reuse the same folders.
  - Only `http:`/`https:` URLs are imported. Others (`chrome://`,
    `javascript:`, `file:`) are skipped and counted.
- **History import (add-only):**
  - Each Chrome visit becomes a Superbrowser visit. Title and typed count come
    from `urls`.
  - Skipped: `hidden` URLs, non-http(s) URLs, and visits already present (same
    URL + same visit time).
  - Visits older than 90 days are dropped.

### Recording history

- **What counts as a visit:** a tab's main-frame navigation to an `http:`/`https:`
  URL. That means `did-navigate`, plus `did-navigate-in-page` when the URL
  changes other than by `#fragment`.
- **What doesn't:** reloads, Back/Forward, and the lazy restore of saved tabs at
  launch. Back/Forward still refresh the entry's last-visit time.
- **Titles:** `page-title-updated` sets the title of that URL's entry.
- **Typed:** navigating from the address field marks the URL as typed, which
  ranks it higher in suggestions.

### Address-bar suggestions

- **Sources:** the shown profile's history and bookmarks. Every word typed must
  match the URL or title.
- **Ranking:** prefers typed URLs, frequently and recently visited pages, and
  host prefix matches.
- **The list:** at most 6 rows plus "Search Google for …", with bookmarks marked
  ★. Duplicates by URL are merged.
- **Auto-complete:**
  - When the typed text is a prefix of the best match's host, for example
    `acme.at` → `acme.atlassian.net`, the field completes it inline with the
    added part selected.
  - The completion is that host. If the user has visited the host's root page,
    that's the root; otherwise it's the host's most visited page.
  - Backspace or Delete removes the completion.
- **Enter always does what the field shows (Chrome's rule):**
  - With no row chosen, Enter opens exactly what the field shows: the typed
    text, or the typed text plus its inline completion. The field is treated as
    today, as a URL or a Google search.
  - Typed words with no completion, such as `jira`, search Google. They never
    jump to a history page.
  - No row is pre-selected. ↓/↑ choose a row, which puts that row's URL in the
    field, and Enter opens it. Clicking a row opens it.
  - The approved mockup's highlighted first row should be read as "the best
    match", not as pre-selected.
- **Placement:** the list overlays the tab list inside the sidebar, as in the
  approved mockup.

### History panel (⌘Y)

- **What's stored:** visits, which ranking needs, and day grouping, which needs
  their times. Each profile's URLs are unique and carry title, visit count,
  typed count and last visit.
- **What's shown:** one row per page per day, like Chrome. A page visited 30
  times today is one row in "Today", with its latest time.
- **Search:** the box filters by words in title or URL.
- **Order:** entries newest first, grouped by day.
- **Loading:** loads more as you scroll; it never sends the whole history to the
  UI at once.
- **Opening:**
  - click opens the entry in the current tab;
  - ⌘-click opens it in a new tab;
  - right-click offers "Open in New Tab", "Copy Link" and "Delete from History".
- **"Delete from History" removes the page completely:** every visit to that
  URL on every day. It then no longer appears in suggestions. That's safer for
  client URLs on a shared screen than Chrome's per-visit delete. Bookmarks
  aren't affected.
- **Clearing:** History ▸ Clear History… asks "Clear all history for
  <profile>?". On confirm it deletes that profile's history only.

### Bookmarks panel (⌘⌥B)

- **Tree:** Chrome's folder structure. Search shows matching bookmarks as a flat
  list with each one's folder path.
- **Opening:** click opens in the current tab, and ⌘-click opens in a new tab.
- **Bookmark context menu:** "Open in New Tab", "Copy Link", "Rename…",
  "Move to ▸ <folders>" and "Delete".
- **Folder context menu:** "New Folder…", "Rename…" and "Delete".
  - Deleting a non-empty folder asks first and deletes its contents.
  - Rename and New Folder edit the name inline in the panel, since native menus
    have no text input.
- **⌘D (Bookmarks ▸ Bookmark This Page):**
  - Adds the current page at the top of the top level.
  - Opens the bookmarks panel with the new bookmark highlighted, so the user can
    rename or move it right away.
  - If the page is already bookmarked, ⌘D only opens the panel on the existing
    bookmark. It never creates a duplicate.

### Menus and shortcuts

- **History menu:** Back, Forward, then Show History (⌘Y) and Clear History….
- **Bookmarks menu (new):** Bookmark This Page (⌘D) and Show Bookmarks (⌘⌥B).
- **Shortcuts:** ⌘Y, ⌘D and ⌘⌥B are unused today. `menu.ts` stays the source of
  truth for shortcuts.
- **When a panel is open:** the address field still works. Switching profile
  shows the new profile's history or bookmarks in the same panel.
- **Shortcuts in a focused popup:** they act on the main window's shown profile
  (popups have no sidebar). If that proves confusing, they can do nothing in
  popups.

### IPC

- Suggestions, history pages and the bookmark tree go to the UI by request and
  reply. The UI sends a validated command with a sequence number, and main
  answers on a new channel. Late replies, with a lower sequence number, are
  ignored.
- New commands go through `parseUiCommand` with tests. Bookmark ids and folder
  ids are validated as the shown profile's, so the UI can never name another
  profile's data.

### Docs to update with the build

- v2 spec: the non-goal line, and a pointer to this document.
- The plan's "Deviations during execution" section.
- CLAUDE.md:
  - add `history.db`/`bookmarks.json` to the profile-isolation invariant;
  - add `Bookmarks`/`History` to "Chrome data is read-only";
  - add the import rules.
- README: what's imported, the shortcuts, and new "Verify it works" checklist
  steps.

## Calls made by the designer (user may override)

- **Retention:** 90 days, like Chrome.
- **Re-import may bring back** a bookmark or history entry the user deleted in
  Superbrowser, if Chrome still has it. Tracking deletions ("tombstones") isn't
  worth it, because the user doesn't plan to keep using Chrome.
- **Only tabs record history**, not popups.
- **Bookmarks and history get their own import menu item,** separate from
  logins, so getting them never re-imports cookies, asks for the Keychain or
  reloads tabs. Already-imported users get no extra prompt: they use that menu
  item once.
- **`AccountBookmarks` is imported too** and merged into the same tree.
- **Enter does what the field shows,** like Chrome. Words search Google unless
  the user picks a row with ↓/↑ or the mouse.
- **History shows one row per page per day.** "Delete from History" removes
  every visit to that page.
- **Clear History** is all-time for the shown profile, with no time-range picker
  in the first version.
- **Chrome's folders:** "Other Bookmarks" and "Mobile Bookmarks" become ordinary
  top-level folders.
- **⌘D** adds at the top level and opens the panel for filing. There's no
  separate "Add bookmark" dialog.

## Left to the builder

- **History schema:** tables, indexes, whether to use FTS5 or `LIKE`, and how
  the ranking score is computed. It must meet the ~50 ms budget on 25k+ visits.
- **Module split:** for example `src/core/bookmarks.ts` (tree model, import
  merge, tested), `src/core/historyImport.ts` (row mapping, Chrome time
  conversion, tested) and a thin `src/main/history.ts` adapter. Where
  `node:sqlite` code lives, given that `src/core` tests run under plain Node,
  which also has `node:sqlite`.
- **Exact styling** within the approved mockups, panel animations, and how the
  inline rename looks.
- How much of the history panel loads per page, and the debounce on the search
  box.
- **Favicons:** use the page's favicon URL already tracked for tabs where known,
  falling back to a placeholder. Importing Chrome's `Favicons` DB is optional.
