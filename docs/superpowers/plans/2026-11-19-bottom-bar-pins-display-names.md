# Bottom Bar: Pills, Display Names, Pinned Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Profile pills that never move under the pointer, user-set profile display names, and Arc-style pinned tabs from any profile at the right of the bottom bar.

**Architecture:** All decisions (labels, initials, pin keys, which tab a pin goes to, decode) are pure functions in `src/core` with `node:test` tests. `src/main` wires them to TabManager, menus and the UI command channel. `src/ui` renders pills and pin tiles from `UiState` and sends validated commands.

**Tech Stack:** Electron 45, TypeScript (erasable syntax only, `.ts` import extensions), esbuild, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-bottom-bar-pins-display-names-design.md`

## Global Constraints

- `src/core` never imports `electron`. New logic goes in `src/core` with a test next to it (`*.test.ts`, `node:test` + `node:assert/strict`).
- No `enum`, `namespace` or constructor parameter properties; imports use explicit `.ts` extensions.
- Bar height 44 px (`BOTTOM_H` in `src/core/layout.ts`, `--bar-h` in `src/ui/ui.css`).
- Profile avatar 30 px circle, initials 13 px bold, 6 px gap between pills. Pin tiles 30 px, favicon 16 px, profile-colour dot 8–10 px at bottom-right.
- Hover in the bar changes background only: no width, padding, margin or opacity change on any `:hover` rule in the bar.
- Display names: trimmed, at most 40 characters (code points), empty clears. Stored in `state.displayNames`; `state.knownProfiles` is never edited by the user. Nothing writes to Chrome's data.
- Pins: http(s) only; key = `dir + '|' + new URL(url).host`; at most one pin per key; exact host match (`www.` not stripped).
- Pin shortcuts `⌥⌘1…⌥⌘9` (`Alt+CmdOrCtrl+N`), counting only shown pins left to right. Defined in `src/main/menu.ts`.
- Profile isolation: a pin's tab is opened only through `TabManager` with the pin's own `dir`.
- New UI commands are validated in `parseUiCommand`; no new `ipcMain` handlers.

## Review Focus

1. A pin whose remembered tab was closed or navigated to another site: the click must fall back to the first same-host tab, else open the pin URL — never select a tab on another site. (Task 2 test `pinTarget: falls back when the remembered tab left the host`.)
2. Pins of a hidden profile, or of a dir no longer known: not shown, no shortcut, still kept in `state.pins` so unhiding brings them back. (Task 3 test `barPins: hides pins of profiles not visible and numbers the rest`.)
3. Hand-edited or corrupt `state.json` pins (non-http URL, missing fields, duplicates by key): bad entries dropped, the rest kept, first duplicate wins. (Task 2 test `decodePins: drops bad entries, keeps first duplicate`.)
4. Display name input that is whitespace only, 200 characters long, or starts with an emoji: cleared / cut to 40 / initials take whole code points, never half a surrogate pair. (Task 1 tests.)
5. A pin click to a profile whose tabs are not loaded yet (lazy restore) or a profile with no tabs: the profile is shown and the chosen/new tab loads once, with no reload of an already-loaded tab. (Task 6 manual check M3; `TabManager.showTab` goes through `refreshVisibility`, which creates the view lazily.)

---

### Task 1: Core — display names and initials

**Files:**
- Modify: `src/core/profiles.ts`, `src/core/appState.ts`
- Test: `src/core/profiles.test.ts`, `src/core/appState.test.ts`

**Interfaces:**
- Produces (in `src/core/profiles.ts`):
  - `MAX_DISPLAY_NAME = 40`
  - `normalizeDisplayName(raw: string): string` — trim, collapse inner whitespace runs to one space, cut to 40 code points, trim again.
  - `setDisplayName(names: Record<string, string>, dir: string, raw: string): Record<string, string>` — new object; empty after normalizing deletes `dir`.
  - `profileLabel(p: Profile, names: Record<string, string>): string` — `names[p.dir]` if non-empty (own property only), else `p.name`.
  - `withDisplayNames(list: Profile[], names: Record<string, string>): Profile[]` — same profiles with `name` replaced by the label.
  - `initials(label: string): string` — rule from the spec; uppercase; code-point safe; `'?'` for empty.
- Produces (in `src/core/appState.ts`): `AppState.displayNames: Record<string, string>` (default `{}`), decoded tolerantly (non-string or empty values dropped; values normalized).

- [ ] **Step 1: Write the failing tests** in `src/core/profiles.test.ts`:

```ts
test('initials: two words give two first letters, one word its first two', () => {
  assert.equal(initials('Client X'), 'CX');
  assert.equal(initials('ACME'), 'AC');
  assert.equal(initials('Me'), 'ME');
  assert.equal(initials('a'), 'A');
  assert.equal(initials('  '), '?');
  assert.equal(initials('😀 Team'), '😀T');      // whole code points
  assert.equal(initials('😀'), '😀');
});
test('normalizeDisplayName: trims, collapses spaces, cuts to 40 code points', () => {
  assert.equal(normalizeDisplayName('  ACME   Corp '), 'ACME Corp');
  assert.equal(normalizeDisplayName('   '), '');
  assert.equal(normalizeDisplayName('x'.repeat(200)).length, 40);
  assert.equal(Array.from(normalizeDisplayName('😀'.repeat(50))).length, 40);
});
test('setDisplayName: sets, and clears on empty', () => {
  assert.deepEqual(setDisplayName({}, 'Default', ' ACME '), { Default: 'ACME' });
  assert.deepEqual(setDisplayName({ Default: 'ACME' }, 'Default', '  '), {});
});
test('profileLabel / withDisplayNames: display name wins, Chrome name otherwise', () => {
  const p = { dir: 'Default', name: 'Person 1', color: '#123456' };
  assert.equal(profileLabel(p, {}), 'Person 1');
  assert.equal(profileLabel(p, { Default: 'ACME' }), 'ACME');
  assert.equal(profileLabel({ ...p, dir: 'toString' }, {}), 'Person 1');
  assert.deepEqual(withDisplayNames([p], { Default: 'ACME' }), [{ ...p, name: 'ACME' }]);
});
```

And in `src/core/appState.test.ts`:

```ts
test('decodeState: displayNames keeps non-empty strings, normalized', () => {
  const s = decodeState({ displayNames: { Default: '  ACME ', 'Profile 3': 5, 'Profile 4': '   ' } });
  assert.deepEqual(s.displayNames, { Default: 'ACME' });
  assert.deepEqual(decodeState({ displayNames: 'bad' }).displayNames, {});
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test src/core/profiles.test.ts src/core/appState.test.ts` → FAIL (`initials` not exported / `displayNames` undefined).
- [ ] **Step 3: Implement** the functions above in `src/core/profiles.ts`, and `displayNames` in `AppState`, `defaultState()` and `decodeState()` (decoder `decodeDisplayNames(v: unknown)` using `normalizeDisplayName`). The existing `decodeState(undefined)` deep-equal test keeps passing because the default is `{}`.
- [ ] **Step 4: Run** `node --test src/core/profiles.test.ts src/core/appState.test.ts` → PASS; `npm run typecheck` → no errors (add `displayNames` wherever an `AppState` literal is built in tests if typecheck asks).
- [ ] **Step 5: Commit** — `git commit -m "feat(core): profile display names and initials"`

---

### Task 2: Core — pins

**Files:**
- Create: `src/core/pins.ts`, `src/core/pins.test.ts`
- Modify: `src/core/appState.ts`, `src/core/appState.test.ts`

**Interfaces:**
- Produces (in `src/core/pins.ts`):
  - `type Pin = { dir: string; url: string; title: string; favicon: string | null }`
  - `pinHost(url: string): string | null` — `new URL(url).host` for http(s), else null (never throws).
  - `pinKey(dir: string, url: string): string | null` — `dir + '|' + host`, null when not http(s).
  - `keyOf(pin: Pin): string`
  - `addPin(pins: Pin[], pin: Pin): Pin[]` — appends; if the key exists, replaces that entry's url/title/favicon in place. Ignores non-http(s) (returns `pins`).
  - `removePin(pins: Pin[], key: string): Pin[]`
  - `movePin(pins: Pin[], key: string, step: -1 | 1, shownDirs: ReadonlySet<string>): Pin[] | null` — moves past the neighbour among *shown* pins (pins whose dir is in `shownDirs`); hidden ones keep their places; null at the ends or unknown key.
  - `decodePins(v: unknown): Pin[]` — tolerant; drops entries without string `dir`/`url`, non-http(s) urls, duplicate keys after the first; `title` defaults `''`, `favicon` must be a string or becomes null.
  - `type PinTarget = { kind: 'tab'; id: number } | { kind: 'open'; url: string }`
  - `pinTarget(pin: Pin, tabs: { id: number; url: string }[], rememberedId: number | null): PinTarget` — rules a–c of the spec.
  - `rememberShown(remembered: ReadonlyMap<string, number>, pins: Pin[], shown: { dir: string; tabId: number | null; url: string }): Map<string, number>` — if the shown tab's key equals some pin's key, map that key to `tabId`; else unchanged copy.
  - `withFavicon(pins: Pin[], key: string, favicon: string | null): Pin[]` — returns the *same array* when nothing changes (null never overwrites a stored favicon).
- Produces (in `src/core/appState.ts`): `AppState.pins: Pin[]` (default `[]`), decoded with `decodePins`.

- [ ] **Step 1: Write the failing tests** in `src/core/pins.test.ts`:

```ts
const pin = (dir: string, url: string, title = 't'): Pin => ({ dir, url, title, favicon: null });
const tabs = [{ id: 1, url: 'https://www.google.com/' }, { id: 2, url: 'https://mail.google.com/a' }, { id: 3, url: 'https://mail.google.com/b' }];

test('pinKey: http(s) host only, exact host', () => {
  assert.equal(pinKey('Default', 'https://Mail.Google.com/x'), 'Default|mail.google.com');
  assert.equal(pinKey('Default', 'http://localhost:3000/'), 'Default|localhost:3000');
  assert.equal(pinKey('Default', 'file:///etc'), null);
  assert.equal(pinKey('Default', 'not a url'), null);
});
test('addPin: appends, and updates an existing key in place', () => {
  const a = addPin([], pin('A', 'https://mail.google.com/1', 'one'));
  const b = addPin(addPin(a, pin('B', 'https://slack.com/')), pin('A', 'https://mail.google.com/2', 'two'));
  assert.deepEqual(b.map((p) => [p.dir, p.url, p.title]), [['A', 'https://mail.google.com/2', 'two'], ['B', 'https://slack.com/', 't']]);
  assert.equal(addPin(a, pin('A', 'about:blank')), a);
});
test('movePin: skips pins of hidden profiles, null at the ends', () => {
  const ps = [pin('A', 'https://a.com'), pin('H', 'https://h.com'), pin('B', 'https://b.com')];
  const shown = new Set(['A', 'B']);
  assert.deepEqual(movePin(ps, 'A|a.com', 1, shown)!.map(keyOf), ['H|h.com', 'B|b.com', 'A|a.com']);
  assert.equal(movePin(ps, 'A|a.com', -1, shown), null);
  assert.equal(movePin(ps, 'nope', 1, shown), null);
});
test('decodePins: drops bad entries, keeps first duplicate', () => {
  const out = decodePins([
    { dir: 'A', url: 'https://mail.google.com/1', title: 'Mail', favicon: 'https://x/f.ico' },
    { dir: 'A', url: 'https://mail.google.com/2' },
    { dir: 'A', url: 'javascript:alert(1)' }, { url: 'https://b.com' }, 'junk',
    { dir: 'B', url: 'https://b.com', favicon: 5 },
  ]);
  assert.deepEqual(out, [
    { dir: 'A', url: 'https://mail.google.com/1', title: 'Mail', favicon: 'https://x/f.ico' },
    { dir: 'B', url: 'https://b.com', title: '', favicon: null },
  ]);
  assert.deepEqual(decodePins('bad'), []);
});
test('pinTarget: remembered tab on the host wins', () => {
  assert.deepEqual(pinTarget(pin('A', 'https://mail.google.com/'), tabs, 3), { kind: 'tab', id: 3 });
});
test('pinTarget: falls back when the remembered tab left the host', () => {
  const moved = [{ id: 3, url: 'https://news.com/' }, ...tabs.slice(0, 2)];
  assert.deepEqual(pinTarget(pin('A', 'https://mail.google.com/'), moved, 3), { kind: 'tab', id: 2 });
  assert.deepEqual(pinTarget(pin('A', 'https://mail.google.com/'), tabs, 99), { kind: 'tab', id: 2 });
});
test('pinTarget: opens the pin url when no tab is on the host', () => {
  assert.deepEqual(pinTarget(pin('A', 'https://slack.com/x'), tabs, null), { kind: 'open', url: 'https://slack.com/x' });
  assert.deepEqual(pinTarget(pin('A', 'https://google.com/'), tabs, null), { kind: 'open', url: 'https://google.com/' }); // www. is another host
});
test('rememberShown: records the shown tab for a pinned host only', () => {
  const ps = [pin('A', 'https://mail.google.com/')];
  const m = rememberShown(new Map(), ps, { dir: 'A', tabId: 3, url: 'https://mail.google.com/b' });
  assert.deepEqual([...m], [['A|mail.google.com', 3]]);
  assert.deepEqual([...rememberShown(m, ps, { dir: 'A', tabId: 1, url: 'https://www.google.com/' })], [['A|mail.google.com', 3]]);
  assert.deepEqual([...rememberShown(m, ps, { dir: 'B', tabId: 7, url: 'https://mail.google.com/' })], [['A|mail.google.com', 3]]);
});
test('withFavicon: same array when unchanged, null never clears', () => {
  const ps = [{ ...pin('A', 'https://a.com'), favicon: 'https://a.com/f.ico' }];
  assert.equal(withFavicon(ps, 'A|a.com', 'https://a.com/f.ico'), ps);
  assert.equal(withFavicon(ps, 'A|a.com', null), ps);
  assert.equal(withFavicon(ps, 'A|a.com', 'https://a.com/g.ico')[0]!.favicon, 'https://a.com/g.ico');
});
```

In `src/core/appState.test.ts`: `decodeState({ pins: [{ dir: 'A', url: 'https://a.com' }] }).pins` deep-equals `[{ dir: 'A', url: 'https://a.com', title: '', favicon: null }]`; `decodeState({ pins: 7 }).pins` is `[]`.

- [ ] **Step 2: Run to verify they fail** — `node --test src/core/pins.test.ts src/core/appState.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `src/core/pins.ts` per the Interfaces block; add `pins` to `AppState`, `defaultState`, `decodeState`. `pinTarget` rule b uses the order of `tabs`.
- [ ] **Step 4: Run** the two test files → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): pinned tabs model"`

---

### Task 3: Shared types and UI protocol

**Files:**
- Modify: `src/shared/types.ts`, `src/core/uiProtocol.ts`, `src/core/layout.ts`
- Test: `src/core/uiProtocol.test.ts`, `src/core/layout.test.ts`

**Interfaces:**
- Consumes: Task 1 `profileLabel`, `initials`; Task 2 `Pin`, `keyOf`, `pinHost`.
- Produces (in `src/shared/types.ts`):
  - `UiProfile = Profile & { shortcut: number | null; initials: string; chromeName: string }` — `name` is the label (display name or Chrome name). `UiState.profiles: UiProfile[]`.
  - `UiPin = { key: string; dir: string; title: string; url: string; favicon: string | null; color: string; profileLabel: string; shortcut: number | null; active: boolean }`; `UiState.pins: UiPin[]`.
  - `UiCommand` adds `{ type: 'selectPin'; key: string }`, `{ type: 'pinMenu'; key: string }`, `{ type: 'tabMenu'; id: number }`, `{ type: 'setDisplayName'; dir: string; name: string }`.
  - `IPC.editProfileName = 'ui:edit-profile-name'` (payload: `dir: string`).
- Produces (in `src/core/uiProtocol.ts`):
  - `barProfiles(visible: Profile[], names: Record<string, string>): UiProfile[]` (signature change; callers updated in Task 4).
  - `barPins(pins: Pin[], visible: Profile[], names: Record<string, string>, shown: { dir: string; url: string }): UiPin[]` — only pins whose dir is visible, in `pins` order; shortcuts 1–9 then null; `active` = `shown.dir === pin.dir && pinHost(shown.url) === pinHost(pin.url)`; `color`/`profileLabel` from the visible profile.
  - `parseUiCommand` accepts the four new commands: `selectPin`/`pinMenu` need `key` a non-empty string ≤ 2048; `tabMenu` needs an integer `id`; `setDisplayName` needs a known `dir` and `name` a string ≤ 200 (normalizing happens in `setDisplayName`).
- Produces (in `src/core/layout.ts`): `BOTTOM_H = 44`.

- [ ] **Step 1: Update/write the failing tests** in `src/core/uiProtocol.test.ts`:
  - Replace the `barProfiles` tests: `barProfiles(list, { P0: 'ACME' })[0]` deep-equals `{ dir: 'P0', name: 'ACME', color: '#123456', shortcut: 1, initials: 'AC', chromeName: 'Name P0' }`; shortcuts still `[1..9, null, null]` for 11 profiles.
  - `test('barPins: hides pins of profiles not visible and numbers the rest')`: pins for dirs `A`, `H` (hidden), `B` with visible `[A, B]` → keys `['A|a.com', 'B|b.com']`, shortcuts `[1, 2]`; 10 visible pins → last shortcut `null`.
  - `test('barPins: active only for the shown profile on the same host')`: shown `{ dir: 'A', url: 'https://a.com/deep' }` → pin A active, B not; shown `{ dir: 'B', url: 'https://a.com/' }` → A not active.
  - Add to the "accepts every well-formed command" list: `{ type: 'selectPin', key: 'Default|a.com' }`, `{ type: 'pinMenu', key: 'Default|a.com' }`, `{ type: 'tabMenu', id: 3 }`, `{ type: 'setDisplayName', dir: 'Default', name: 'ACME' }`.
  - Rejections: `selectPin` with `key: ''`, `key: 5`, missing key; `tabMenu` with `id: '3'`; `setDisplayName` with `dir: 'Profile 9'` or `name: 'x'.repeat(201)` → `null`.
  - `src/core/layout.test.ts`: update any expected heights to use `BOTTOM_H` 44 (e.g. a 800-high window gives `height: 800 - 8 - 44`).
- [ ] **Step 2: Run** `node --test src/core/uiProtocol.test.ts src/core/layout.test.ts` → FAIL.
- [ ] **Step 3: Implement** the types, `barProfiles`, `barPins`, `parseUiCommand` cases and `BOTTOM_H = 44`.
- [ ] **Step 4: Run** `npm test` → PASS. `npm run typecheck` will fail in `main.ts` (old `barProfiles` call, missing `pins`) — fixed in Task 4; note it and move on only if those are the sole errors.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): UI protocol for pins and display names; 44 px bar"`

---

### Task 4: Main — display names wired everywhere

**Files:**
- Modify: `src/main/main.ts`, `src/main/menu.ts`, `src/main/profileManager.ts`, `src/preload/ui.ts`

**Interfaces:**
- Consumes: Task 1 `withDisplayNames`, `setDisplayName`, `profileLabel`; Task 3 `barProfiles(visible, names)`, `IPC.editProfileName`, `setDisplayName` command.
- Produces:
  - `ProfileMenuContext.setDisplayName(): void`; `buildProfileMenu` adds **Set Display Name…** after Move Right (own separator group before Hide Profile).
  - `ProfileManagerDeps.editDisplayName(dir: string): void` (main sends `IPC.editProfileName` with `dir`).
  - Preload: `SuperbrowserApi.onEditProfileName(cb: (dir: string) => void): void`.

- [ ] **Step 1:** In `main.ts`, change `profileName` to `profileLabel(found, state.displayNames)` (fallback `dir`), so sessions, pages (popup titles) and TabManager use labels.
- [ ] **Step 2:** In `main.ts`, pass `withDisplayNames(...)` for `profiles` and `hiddenProfiles` in `rebuildMenu`, and for `activeProfile`/`visibleProfiles` in the `ImportFlow` deps. `pushState` uses `barProfiles(profiles.visible, state.displayNames)` and (until Task 6) `pins: []`.
- [ ] **Step 3:** Handle `case 'setDisplayName'`: `state.displayNames = setDisplayName(state.displayNames, cmd.dir, cmd.name)`, `store.save(state)`, `rebuildMenu()`, `pushState()`.
- [ ] **Step 4:** Add the menu item, the `editDisplayName` dep (wired in main to `toUi(IPC.editProfileName, dir)` after `window.focus(); ui.webContents.focus()`), and the preload method.
- [ ] **Step 5: Verify** — `npm run typecheck` clean, `npm test` PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat: profile display names in menus, popups and imports"`

---

### Task 5: UI — profile bar redesign and inline display-name edit

**Files:**
- Create: `src/ui/parts/profileBar.ts` (pill rendering + inline edit, moved out of `ui.ts`)
- Modify: `src/ui/ui.ts`, `src/ui/ui.css`, `src/ui/index.html`, `src/ui/parts/profileDrag.ts` (only if selectors change)

**Interfaces:**
- Consumes: `UiProfile` (Task 3), `sb.onEditProfileName` (Task 4).
- Produces: `setupProfileBar(opts: { bar: HTMLElement; sb: SuperbrowserApi }): { render(s: UiState): void; startEdit(dir: string): void }`.

- [ ] **Step 1:** Move pill code from `ui.ts` into `profileBar.ts`. Pills become `<button class="pf" type="button">` with `aria-label` and `title` = `` `${name} (⌃${n})` `` or, when `name !== chromeName`, `` `${name} — ${chromeName} (⌃${n})` `` (no `(⌃n)` when shortcut is null). The dot shows `p.initials`. Keep drag (`setupProfileDrag`), keyed in-place updates and `keyedMoves`.
- [ ] **Step 2:** CSS per Global Constraints: `--bar-h: 44px`; `.pf .dot` 30 px, 13 px bold; `#profiles` gap 6 px; remove every hover-driven `max-width`/`padding`/`margin`/`opacity` change on `.pf`, `.pf .n`, `.pf .k`; drop the `.k` element (shortcut lives in the tooltip). With `body.names`, `.n` is always visible, `max-width` fixed (~16ch, ellipsis). `.pf.on` is the filled light pill in both modes (delete the `body:not(.names) .pf.on:not(:hover)` override). Add `.pf:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }`. Update the min-height arithmetic comment above `#side:has(.sec.open) #tabs` for the 4 px taller bar and check that the numbers still fit the 500 px window.
- [ ] **Step 3:** Inline edit (`startEdit(dir)`): replace the pill's label area with `<input class="pf-edit" maxlength="40">`, value = current label if it differs from `chromeName` else `''`, placeholder = `chromeName`, focused and selected. Enter → send `setDisplayName` if changed, end edit. Escape → end edit, no send. Blur → send if value changed, end edit. While editing, `render` must not touch that pill's content; if its dir disappears from `s.profiles`, drop the edit silently. Clicks and pointerdown inside the input must not start a drag or switch profile.
- [ ] **Step 4: Verify** — `npm run typecheck`, `npm test`, `npm start`; check manually: hover any pill — no pill moves; names on/off both show a clear selected pill; right-click → Set Display Name… → type "ACME", Enter → pill shows "AC"/"ACME", Profiles menu shows "ACME"; Escape cancels; click away with a change saves; empty resets to the Chrome name; Tab key reaches pills with a visible ring.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): bigger, steady profile pills with inline display-name edit"`

---

### Task 6: Main + UI — pinned tabs

**Files:**
- Modify: `src/main/tabManager.ts`, `src/main/main.ts`, `src/main/menu.ts`, `src/ui/ui.ts`, `src/ui/ui.css`, `src/ui/index.html`
- Create: `src/ui/parts/pinBar.ts`

**Interfaces:**
- Consumes: Task 2 (`addPin`, `removePin`, `movePin`, `pinTarget`, `rememberShown`, `withFavicon`, `pinKey`, `keyOf`), Task 3 (`barPins`, commands).
- Produces:
  - `TabManager.tabsOf(dir: string): { id: number; url: string }[]` (model order; `[]` if unknown).
  - `TabManager.showTab(dir: string, id: number): void` — activates `id` in `dir` and shows `dir` with one `changed()` (no-op if `id` not in `dir` or `dir` not visible).
  - `TabManager.showNewTab(dir: string, url: string): void` — shows `dir` and opens `url` there as its active tab with one visible switch.
  - `menu.ts`: `buildTabMenu(ctx: { canPin: boolean; pinned: boolean; togglePin(): void; close(): void }): Menu` (items **Pin to Bar** / **Unpin from Bar**, separator, **Close Tab**); `buildPinMenu(ctx: { canMoveLeft: boolean; canMoveRight: boolean; unpin(): void; move(step: -1 | 1): void }): Menu` (**Unpin**, separator, **Move Left**, **Move Right**); `MenuContext` gains `pins: { label: string }[]`, `selectPin(n: number): void`, `togglePinActiveTab(): void`, `activeTabPinned: boolean`, `canPinActiveTab: boolean`. Tab menu gets a checkbox item `id: 'pinTab'` "Pinned to Bar" and a **Pinned Tabs** submenu listing shown pins as `` `${title || host} · ${profileLabel}` `` with `Alt+CmdOrCtrl+N` for the first nine.
  - `setupPinBar(opts: { bar: HTMLElement; sb: SuperbrowserApi }): { render(s: UiState): void }`.

- [ ] **Step 1:** TabManager methods above. `showTab` sets `activeDir`, applies `activateTab`, then `refreshVisibility()` + `changed()` (the lazy view creation in `refreshVisibility` loads an unloaded tab once). `showNewTab` sets `activeDir = dir` then calls `newTab(url, { dir })`.
- [ ] **Step 2:** In `main.ts`: `let remembered = new Map<string, number>()`. In TabManager's `onChange`, after the existing save logic: `remembered = rememberShown(remembered, state.pins, { dir, tabId: activeTabId, url })`; if the shown active tab has a pin key, `const next = withFavicon(state.pins, key, favicon)`; if `next !== state.pins` assign and `store.save(state)`. Update the `pinTab` checkbox via `Menu.getApplicationMenu()?.getMenuItemById('pinTab')` (`checked`, `enabled`).
- [ ] **Step 3:** `openPin(pin)`: `if (!profiles.dirs.has(pin.dir)) return;` then `const t = pinTarget(pin, tabs.tabsOf(pin.dir), remembered.get(keyOf(pin)) ?? null)`; `'tab'` → `tabs.showTab(pin.dir, t.id)` unless it is already the shown active tab; `'open'` → `tabs.showNewTab(pin.dir, t.url)`. Commands: `selectPin` (find by key among shown pins), `pinMenu` (buildPinMenu with `movePin(..., new Set(profiles.dirs))`), `tabMenu` (tab must be in the shown profile; pin key from its URL; title and favicon from the snapshot). Every pins change: `store.save(state)`, `rebuildMenu()`, `pushState()`. `pushState` sends `pins: barPins(state.pins, profiles.visible, state.displayNames, snap)`.
- [ ] **Step 4:** UI: `index.html` adds `<div id="pins"></div>` after `#addprofile` in `#bar`. `pinBar.ts` renders keyed `<button class="pin">` tiles (favicon via `faviconIcon`, `<span class="pin-dot">` with `style.background = color`), `title`/`aria-label` = `` `${title || host} · ${profileLabel}` `` + `` ` (⌥⌘${n})` `` when shortcut; `.on` when `active`; click → `selectPin`, contextmenu → `pinMenu`. Tab rows in `ui.ts` get `contextmenu` → `tabMenu`. CSS: `#pins { margin-left: auto; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: 0 1 auto; min-width: 30px }`, `#profiles { min-width: 0; flex: 0 1 auto }` so both groups keep at least one item visible and scroll; 30 px tile, hover background only, focus ring as pills.
- [ ] **Step 5: Verify** — `npm run typecheck`, `npm test`, `npm start`, then manually:
  - M1: right-click a Gmail tab in profile A → Pin to Bar → tile appears at the right with A's colour dot; Tab menu "Pinned to Bar" is checked.
  - M2: switch to profile B, click the tile → profile A shows the same Gmail tab, no reload (scroll position kept). ⌥⌘1 does the same.
  - M3: hide profile A → its tile disappears; unhide → it returns. Quit/relaunch with A's Gmail tab not yet loaded → click the pin → the tab loads once.
  - M4: close A's Gmail tab, click the pin → a new Gmail tab opens in A. Open two Gmail tabs, view the second, go elsewhere, click the pin → returns to the second.
  - M5: right-click tile → Move Right / Unpin work; quit and relaunch → pins and order survive.
- [ ] **Step 6: Commit** — `git commit -m "feat: pinned tabs from any profile in the bottom bar"`

---

### Task 7: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-11-19-bottom-bar-pins-display-names-design.md` (Status: implemented)

- [ ] **Step 1:** `CLAUDE.md`: add `pins.ts` (pinned tabs: keys, target tab, decode) and display names/initials (`profiles.ts`) to the `src/core` list; mention `profileBar.ts` and `pinBar.ts` under `src/ui/parts`; in the intro, the bottom bar also holds pinned tabs at the right and `⌥⌘1…⌥⌘9`. Add to invariants: display names live only in `state.displayNames`; a pin carries its own `dir` and opens only in that profile.
- [ ] **Step 2:** `README.md` "Verify it works": replace item 4 ("Hovering a dot slides out…") with "Hovering a profile pill changes only its background; no pill moves. The tooltip shows the name and ⌃N." Add items for Set Display Name…, pinning/unpinning, pin click across profiles without reload, ⌥⌘N, and hidden-profile pins. Add ⌥⌘1–9 to the shortcuts table.
- [ ] **Step 3: Verify** — `npm test` PASS, `npm run typecheck` clean, `npm run build` succeeds; walk README items for the bar.
- [ ] **Step 4: Commit** — `git commit -m "docs: bottom bar pins and display names"`
