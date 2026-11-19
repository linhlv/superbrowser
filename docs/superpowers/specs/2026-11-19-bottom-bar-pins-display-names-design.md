# Bottom bar: easier profile pills, display names, pinned tabs

Date: 2026-11-19. Status: draft for approval.

## Why

The bottom bar is the daily switcher between ~7 profiles, and it is awkward today:

- Hovering a pill slides its name and `⌃N` out (`.pf:hover .n { max-width: 150px }`), so every pill to its right moves
  away from the pointer. Aiming at a pill makes it run away.
- Targets are small: an 18 px dot in a 26 px pill, 2 px apart, a 9 px initial.
- Profiles are told apart by colour and one letter; two profiles starting with the same letter look identical. Chrome
  profile names are often long or generic ("Person 1", an email), and the user can't change them here.
- The user switches between a handful of fixed places across profiles all day (e.g. one profile's Gmail, another's
  Slack). Getting there means pick profile, then find the tab in the sidebar.

Success: one click (or `⌥⌘N`) from anywhere lands on "Client X's Gmail"; pills never move under the pointer; every
profile reads at a glance by a short name the user chose.

## Goals

1. Profile pills that keep their size on hover, are bigger, and show a clear selected state.
2. A user-set **display name** per profile, used everywhere the app names a profile.
3. **Pinned tabs**: saved sites from any profile, shown at the right of the bar; a click switches profile and
   selects (or reopens) that site's tab.

## Non-goals

- Drag-to-reorder pins (Move Left / Move Right in their menu for now).
- Changing anything in Chrome (its profile name stays as is).
- The address bar move and the wider accessibility pass (focus rings everywhere, SVG icons, contrast against light
  profile colours). Those are the next two projects. This one only makes the elements it rebuilds (pills, pin tiles)
  keyboard-focusable with a visible focus ring.

## Anti-goals (failure even if it works)

- A pin opening a site in the wrong profile, or a pin leaking anything across profiles (it carries only its own
  profile's dir; its tab is created through the normal per-profile path).
- A pin click reloading a tab that is already open (switching never reloads).
- Losing pins or display names on a bad `state.json` (tolerant decode, like every other field).
- Writing to Chrome's data to rename a profile.
- Layout shift on hover anywhere in the bar.

## Approaches considered

For pins (the user picked **B**):

- **A. A pin is a live tab.** It follows that tab and dies with it. Simple, but ⌘W loses the pin. Rejected.
- **B. A pin is a saved site (profile + URL), like Arc's pinned tabs.** Clicking finds that profile's tab on the same
  site, or reopens it. Closing tabs never loses pins. **Chosen.**

Where pins live (one sensible way): one ordered, cross-profile list in `state.json`. Rejected: storing them as
bookmarks in each profile's library (the library is deliberately per profile; pins mix profiles in one order), and
marking saved tabs as pinned (that is approach A).

Display names live in `state.json` too (`displayNames: Record<dir, string>`); `knownProfiles` keeps mirroring Chrome
and is never edited by the user.

## Design

### Bar layout

```
names off (default)
[◧]  (AC) (ME) (CX) (+)   ··················   [M•] [S•] [J•]

names on
[◧]  (AC ACME) (ME Me) (CX Client X) (+)  ····  [M•] [S•] [J•]
```

- Left: sidebar toggle, profile pills, `+` — unchanged order, drag-to-reorder and `⌃1…⌃9` unchanged.
- Right: pin tiles, pushed to the bar's right edge. The empty middle stays a window drag region.
- The bar grows from 40 to 44 px (`BOTTOM_H` in `src/core/layout.ts`, `--bar-h` in `ui.css`). The page gets 4 px less
  height. The sidebar's minimum-height arithmetic comment in `ui.css` (500 px window) must be rechecked and updated.
- When pills and pins don't fit, the pills scroll horizontally as today; pins never shrink below their size and
  scroll horizontally in their own group too (builder: pick how the two groups share width so neither disappears).

### Profile pills

- Avatar: 30 px circle in the profile colour with 1–2 letter initials in 13 px bold white. Initials: first letters of
  the first two words of the label ("Client X" → "CX"); a single word gives its first two letters ("ACME" → "AC",
  "Me" → "ME"); grapheme-safe (as `initial()` is today); uppercase.
- Gap between pills: 6 px.
- **Hover changes only the background.** No width, padding or opacity change that moves anything. The full name and
  shortcut are in the native tooltip (`title`), which macOS draws above the page view. (Our own popover can't: the
  page's `WebContentsView` sits on top of the UI view.)
- **Selected:** a filled light pill (as `.pf.on` with names shown today) in *both* modes, so the current profile is
  obvious with names off too.
- **Names on** ("Show Profile Names"): avatar plus label always visible; label truncates with "…" at ~16 characters;
  the pill's width depends only on its label, never on hover.
- Tooltip: `ACME (⌃1)`; when a display name is set, `ACME — Work Chrome name (⌃1)`.
- Pills become `<button>`s with `aria-label` = the tooltip text and a visible `:focus-visible` ring. Drag-to-reorder
  (`profileDrag.ts`) keeps working; a drag still suppresses the click.

### Display names

- Set from the pill's right-click menu: new item **Set Display Name…** (between the Move items and Hide Profile).
- Editing happens **inline in the pill** (the look of bookmark rename's `.bm-edit`, but not its commit rules): main
  tells the UI to start editing that pill; the pill shows a text field prefilled with the current display name
  (placeholder: the Chrome name), selected. The pill may widen while editing; that is an explicit mode, not hover.
- Commit rules (designer's call; deliberately unlike bookmark rename, whose command carries no profile and so never
  commits on blur — `setDisplayName` carries its `dir`, so committing on blur is safe):
  - Enter, or blur with a changed value (including clicking another pill or anywhere else), saves.
  - Escape, or blur with the value unchanged, cancels.
  - A state push while editing must not rebuild or reset the pill being edited (skip its label update until the edit
    ends). If that profile disappears from the bar (hidden, or gone from Chrome), the edit is dropped silently.
- Saving sends a validated UI command; empty (after trim) clears the display name, falling back to the Chrome name.
  Max 40 characters after trim; longer input is cut (validation in `parseUiCommand`).
- Stored as `state.displayNames[dir]`. A display name for a profile no longer known is kept (harmless, like
  `tabs` for unknown dirs).
- **Used everywhere the app shows a profile's name**: pills, initials, tooltips, the Profiles menu (`⌃N` items),
  Show Hidden Profiles, popup window titles (`popupTitle(..., profileName)`), and import sheets. One core function
  resolves a profile's label (`displayName ?? chromeName`); main uses it instead of reading `Profile.name` directly
  (`profileName` in `main.ts`, `menu.ts`, `importFlow.ts`, `pages.ts` via `profileName`).

### Pinned tabs

**Data** (`state.json`, new field `pins`, ordered):
`{ dir: string; url: string; title: string; favicon: string | null }[]`.
- Only http(s) URLs. A pin's key is `dir` + the URL's host (`new URL(url).host`); at most one pin per key.
- Decoded tolerantly: bad entries dropped, others kept; duplicates by key keep the first.

**Pinning**
- Right-click a tab row in the sidebar → new tab context menu: **Pin to Bar** (or **Unpin from Bar** if a pin with
  that tab's key exists), separator, **Close Tab**. Disabled "Pin to Bar" when the tab's URL isn't http(s).
- Tab menu (app menu) gets **Pin Tab to Bar** / **Unpin Tab from Bar** for the active tab. No default shortcut.
- Pinning appends to the end of `pins`. Pinning a tab whose key already exists updates that pin's url, title and
  favicon in place (keeps its position).

**The tile**
- 30 px rounded tile: the pin's favicon (16 px), with a 8–10 px dot in the profile's colour at the bottom-right
  corner. No favicon → placeholder square (as tab rows do) — or the site's first letter (builder's call).
- Hover: background only. Selected look: see "The pin follows the host" below.
- Tooltip and `aria-label`: `<pin title> · <profile label> (⌥⌘N)`. `<button>`, focus ring as pills.
- Right-click → **Unpin**, separator, **Move Left**, **Move Right** (disabled at the ends).
- Pins of hidden profiles are not shown and get no shortcut; they come back on unhide.

**Clicking a pin** (or `⌥⌘1…⌥⌘9`, counting only shown pins, left to right):
1. Show the pin's profile (no reload, as any profile switch).
2. Pick the tab, in this order:
   a. the pin's remembered tab, if it still exists in that profile and is on the pin's host;
   b. otherwise the first tab in that profile (sidebar order) whose URL host equals the pin's host;
   c. otherwise open a new tab at the pin's URL (appended, activated).
3. Activate it.

**The pin follows the host, not one tab** (designer's call). A pin's *remembered tab* is the tab most recently shown
(active in the shown profile) while on the pin's host, however it got there: a pin click, the sidebar, ⌘N, or
navigating the active tab onto that host. Main updates it whenever the shown profile's active tab or its URL changes.
Remembered ids are per run only, never saved. Consequences:
- The pin looks **selected** exactly when the shown profile is the pin's profile and its active tab is on the pin's
  host; clicking a selected pin does nothing (no jump to another same-host tab).
- With two Gmail tabs open, the pin returns to whichever one you looked at last.
- The tile's favicon comes from the remembered tab (else from the tab rule b would pick).

Host match is exact (`mail.google.com` ≠ `google.com`; `www.` is not stripped). The tab picked may be on another page
of that site; that is intended (the pin returns you to the site as you left it, it doesn't reset the page).

**Keeping a pin fresh:** a pin's favicon updates when the tab it points to (see above) reports a new favicon. Its
url and title change only by pinning again.

**Shortcuts:** `⌥⌘1…⌥⌘9` in a new menu (e.g. under the Tab menu, "Pinned Tabs" submenu listing the shown pins), defined
in `menu.ts` like every shortcut. `⌥1…⌥9` were rejected: on macOS they type characters (™, £, and `[ ] { }` on some
layouts). Check that `⌥⌘` digits don't clash with an existing accelerator (none today).

### Commands and state shapes (indicative)

- `UiState` gains `pins: { key, dir, title, url, favicon, color, label, shortcut: number | null, active: boolean }[]`
  (shown pins only, bar order) and each `profiles[]` entry gains `label`/`initials`/`chromeName` (or the UI derives
  initials from the label via a shared pure helper).
- `UiCommand` gains `selectPin {key}`, `pinMenu {key}`, `tabMenu {id}`, `setDisplayName {dir, name}`; a new IPC
  channel tells the UI to start editing a pill. All validated in `parseUiCommand`; `dir`s must be visible profiles
  (as `selectProfile` is checked today); pin keys must exist.

### Where the logic goes

- `src/core/pins.ts` (new, tested): key from url, add-or-update, remove, move, decode, "which tab does this pin go
  to" (rules a–c as a pure function of the pin, the profile's tabs and the remembered id), shortcut numbering for
  shown pins.
- `src/core/profiles.ts` (or a small new module): label resolution and initials, tested.
- `src/core/appState.ts`: `pins` and `displayNames` with tolerant decode and defaults, tested.
- `src/main`: wiring only (menus, commands, TabManager calls). `src/ui`: rendering the pills/pins and inline edit.
- Update `CLAUDE.md` (core module list, bar description) and README's "Verify it works" checklist.

## Constraints (from CLAUDE.md, apply as usual)

- Profile isolation: opening a pin's tab goes through the existing per-profile tab path (`pageWebPreferences(dir)`).
- Favicons render in the UI view as tab favicons already do (`faviconIcon`); no new network access from main.
- State saves debounced as today; changing pins or display names is a saved change.
- New `ipcMain` paths: none; commands come through the UI view's validated command channel.

## Left to the builder

- Exact CSS values beyond the sizes above, colours of the selected state and focus ring.
- How pills and pins share width when the bar overflows (neither may disappear entirely).
- Whether a favicon-less tile shows a placeholder or the site's first letter.
- Names of new IPC channels, helper functions and the exact `UiState` shape.
