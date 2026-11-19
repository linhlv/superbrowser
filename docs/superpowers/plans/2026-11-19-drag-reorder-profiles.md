# Drag to Reorder Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a profile pill along the bottom bar to reorder profiles; the order is saved like Move Left/Right.

**Architecture:** A pure `placeProfile` in `src/core/profiles.ts` computes the new `profileOrder`. A validated `reorderProfile` UI command reaches `ProfileManager.place`, which saves and calls `changed()`. The UI page handles the drag with pointer events and sends one command on drop.

**Tech Stack:** Electron 45, TypeScript by type stripping, `node:test`, esbuild.

**Spec:** `docs/superpowers/specs/2026-11-19-drag-reorder-profiles-design.md`

## Global Constraints

- `src/core` never imports `electron`; imports between TS files use explicit `.ts` extensions; erasable TS only.
- Tests sit next to sources (`*.test.ts`); run `npm test` and `npm run typecheck`.
- UI commands are accepted only on the UI view's `webContents.ipc` and validated by `parseUiCommand`.
- CSP: no inline `style=""` in HTML; styles via classes or `element.style` from script.
- `src/ui/*.ts` are esbuild entry points; helper modules go in `src/ui/parts/`.
- Chrome's `Local State` is never written; the order lives only in `state.profileOrder`.
- Grabbing a pill never drags the window (`.pf` stays `-webkit-app-region: no-drag`); the bar's empty space still drags it.
- Move Left / Move Right stay in the profile menu.

## Review Focus

1. **A plain click must still switch profile** and right-click still opens the menu; a tiny pointer jitter under the threshold is a click. (Task 2 hand check; Task 2 code keeps `click`/`contextmenu` handlers working and suppresses only the click that ends a real drag.)
2. **Hidden profiles keep their exact slots** in `profileOrder` when a visible one is dragged past them. (Task 1 test `placeProfile keeps hidden profiles in their slots`.)
3. **A dropped order must not flicker back:** the arrangement shown at release stays until the state push re-renders the same order. (Task 2.)
4. **Dropping where it started, Esc, or releasing outside the bar changes nothing** and sends nothing. (Task 1 test `placeProfile returns null when nothing changes`; Task 2 code.)
5. **A forged or stale command** (unknown dir, `before` equal to `dir`, non-string `before`) is rejected or ignored. (Task 1 tests in `uiProtocol.test.ts` and `placeProfile` null cases.)

---

### Task 1: placeProfile, the reorderProfile command and ProfileManager.place

**Files:**
- Modify: `src/core/profiles.ts` (add `placeProfile`), `src/core/profiles.test.ts`
- Modify: `src/shared/types.ts` (UiCommand member), `src/core/uiProtocol.ts`, `src/core/uiProtocol.test.ts`
- Modify: `src/main/profileManager.ts` (add `place`), `src/main/main.ts` (route the command)

**Interfaces:**
- Produces:

```ts
// profiles.ts
export function placeProfile(all: Profile[], order: string[], hidden: string[], dir: string, beforeDir: string | null): string[] | null;
// types.ts — UiCommand gains:
//  | { type: 'reorderProfile'; dir: string; before: string | null }
// profileManager.ts
place(dir: string, before: string | null): void; // applies placeProfile; if non-null: state.profileOrder = next; this.changed()
```

- [ ] **Step 1: Write the failing tests**

```ts
// profiles.test.ts (reuse the file's existing `all` fixture style: profiles A, B, C, D)
test('placeProfile moves a visible profile before another', () => {
  assert.deepEqual(placeProfile(all, [], [], 'D', 'A'), ['D', 'A', 'B', 'C']);
  assert.deepEqual(placeProfile(all, [], [], 'A', 'D'), ['B', 'C', 'A', 'D']);
});
test('placeProfile with before null puts it after the last visible profile', () => {
  assert.deepEqual(placeProfile(all, [], [], 'A', null), ['B', 'C', 'D', 'A']);
});
test('placeProfile keeps hidden profiles in their slots', () => {
  // C hidden at index 2; visible order A,B,D → move D before A → visible D,A,B refilled into slots 0,1,3
  assert.deepEqual(placeProfile(all, [], ['C'], 'D', 'A'), ['D', 'A', 'C', 'B']);
  // before null with the last slot hidden: A moves after D (last visible), C stays at index 3
  assert.deepEqual(placeProfile(all, ['A', 'B', 'D', 'C'], ['C'], 'A', null), ['B', 'D', 'A', 'C']);
});
test('placeProfile returns null when nothing changes or the move is invalid', () => {
  assert.equal(placeProfile(all, [], [], 'B', 'C'), null);      // already right before C
  assert.equal(placeProfile(all, [], [], 'D', null), null);     // already last
  assert.equal(placeProfile(all, [], [], 'B', 'B'), null);      // before itself
  assert.equal(placeProfile(all, [], ['C'], 'C', 'A'), null);   // hidden dir
  assert.equal(placeProfile(all, [], ['C'], 'A', 'C'), null);   // hidden before
  assert.equal(placeProfile(all, [], [], 'Z', 'A'), null);      // unknown
});

// uiProtocol.test.ts — accepted cases:
{ type: 'reorderProfile', dir: 'Default', before: 'Profile 3' },
{ type: 'reorderProfile', dir: 'Profile 3', before: null },
// rejected:
test('parseUiCommand: rejects bad reorderProfile', () => {
  for (const c of [
    { type: 'reorderProfile', dir: 'Default' },                       // before missing
    { type: 'reorderProfile', dir: 'Default', before: 'Profile 9' },  // unknown before
    { type: 'reorderProfile', dir: 'Profile 9', before: null },       // unknown dir
    { type: 'reorderProfile', dir: 'Default', before: 3 },
  ]) assert.equal(parseUiCommand(c, known), null, JSON.stringify(c));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/core/profiles.test.ts src/core/uiProtocol.test.ts`
Expected: FAIL (`placeProfile` not exported; `reorderProfile` parses to null).

- [ ] **Step 3: Implement**

- `placeProfile`: return null if `dir` isn't visible, `beforeDir === dir`, or `beforeDir` is non-null and not visible. Take `arrange(all, order)` dirs; compute the visible list; remove `dir` and insert it before `beforeDir` (or at the end); if the new visible list equals the old, return null; otherwise refill the visible slots of the full list, in order, with the new visible list.
- `parseUiCommand`: `before` must be `null` or a known dir; return a fresh `{ type, dir, before }`.
- `ProfileManager.place` as in Interfaces; `main.ts` routes `case 'reorderProfile': profiles.place(cmd.dir, cmd.before); break;`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/core/profiles.test.ts src/core/uiProtocol.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/profiles.ts src/core/profiles.test.ts src/shared/types.ts src/core/uiProtocol.ts src/core/uiProtocol.test.ts src/main/profileManager.ts src/main/main.ts
git commit -m "feat: placeProfile and a validated reorderProfile command"
```

---

### Task 2: Drag pills in the bottom bar, and docs

**Files:**
- Create: `src/ui/parts/profileDrag.ts`
- Modify: `src/ui/ui.ts` (attach the drag to pills; keep `click`/`contextmenu`), `src/ui/ui.css`
- Modify: `README.md` (profile bar paragraph: "drag a profile to reorder it"; a new "Verify it works" step), `CLAUDE.md` (mention `profileDrag.ts` among the UI parts)

**Interfaces:**
- Consumes: the `reorderProfile` command (Task 1).
- Produces: `setupProfileDrag(opts: { bar: HTMLElement; send: (cmd: { type: 'reorderProfile'; dir: string; before: string | null }) => void }): { suppressClick(): boolean }` — attached once to `#profiles` with event delegation, so pills rebuilt by `renderProfiles` keep working. `createPill`'s click handler returns early when `suppressClick()` is true.

- [ ] **Step 1: Implement the drag per the spec's "UI" bullets**

- Primary button only; `pointerdown` on a `.pf` records start X; a drag starts after the pointer moves 4 px horizontally; then `setPointerCapture`, add a `dragging` class to the pill and the bar.
- While dragging: the pill follows the pointer with `transform: translateX(…)` (set from script); the other pills get `translateX(±pill width + gap)` via a class/transform with a short CSS transition to open the gap at the drop position. Compute the drop index from the pointer X against the other pills' midpoints.
- `pointerup` inside the bar's rect: if the index differs from the start, reorder the DOM children to the new arrangement immediately (so nothing flickers), clear transforms, and `send({ type: 'reorderProfile', dir, before })` where `before` is the dir of the pill now right after it, or null at the end. Mark the next click as suppressed.
- Esc, `pointercancel`, `lostpointercapture` without a drop, or `pointerup` outside the bar: clear transforms and classes, send nothing.
- Edge scroll: while dragging within 24 px of `#profiles`' left/right edge and it overflows, scroll it by a few px per animation frame.
- `renderProfiles` rebuilds pills only when the list changes; after the state push the rebuilt order equals the DOM order, so no flicker.

- [ ] **Step 2: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean.

- [ ] **Step 3: Hand check (for the user, in `npm start`)**

- Drag the 4th pill to the front: the others slide, the drop sticks, ⌃1 now selects it; relaunch keeps the order.
- A click still switches; right-click still opens the menu with Move Left/Right; a tiny wobble while clicking still switches.
- Esc mid-drag and releasing above the bar both cancel.
- Dragging a pill never moves the window; dragging the bar's empty space still does.
- With a profile hidden, reorder the visible ones, then unhide: the hidden one is back where it was.

- [ ] **Step 4: Commit**

```bash
git add src/ui/parts/profileDrag.ts src/ui/ui.ts src/ui/ui.css README.md CLAUDE.md
git commit -m "feat(ui): drag profile pills to reorder them"
```
