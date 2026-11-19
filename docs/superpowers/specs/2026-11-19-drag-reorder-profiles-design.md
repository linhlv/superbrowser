# Drag to reorder profiles (short design)

Date: 2026-11-19 · Status: approved by the user

## Intent

The user wants to drag a profile pill along the bottom bar to a new position,
the way tabs are rearranged. Today the only way to change the order is the
dot's right-click **Move Left / Move Right**, one step at a time, which is slow
with seven or more profiles.

## What exists

- The bar order is Superbrowser's own: `state.profileOrder` in `state.json`
  (every known profile; `arrangeProfiles` puts unknown dirs last). ⌃1…⌃9 follow
  the visible order.
- `moveProfile(all, order, hidden, dir, step)` in `src/core/profiles.ts` swaps a
  visible profile with its visible neighbour; hidden profiles keep their slots.
  `ProfileManager` (`src/main/profileManager.ts`) applies it and calls
  `changed()`, which refreshes the bar, ⌃N, the menu and accepted commands.
- Pills are built in `src/ui/ui.ts` (`createPill`); `#bar` is a window-drag
  region and `.pf` is `no-drag`. `#profiles` scrolls horizontally when it
  overflows.

## Goals

- Press a pill and move it left or right; the other pills slide apart to show
  where it will land; releasing drops it there.
- Esc, or releasing outside the bar, cancels with no change.
- A drag starts only after the pointer moves a few pixels, so a plain click
  still switches profile and right-click still opens the profile menu.
- The new order is saved exactly like Move Left/Right: ⌃1…⌃9 follow it, it
  survives relaunch, and hidden profiles keep their places among the rest.
- **Move Left / Move Right stay** in the right-click menu.

## Non-goals and anti-goals

- Never write Chrome's profile order (`Local State` stays read-only).
- No dragging profiles anywhere other than along the bar (no drag to hide, no
  drag between windows).
- Grabbing a pill must never drag the window, and dragging the bar's empty space
  must still drag the window as today.
- No flicker of the bar on drop: the order the user sees at release is the order
  that is saved.

## Approaches

1. **Pointer events in the UI page (chosen).** `pointerdown` on a pill, a small
   movement threshold, pointer capture, the dragged pill follows the pointer
   with a transform while the others shift; on release the UI sends one
   command. Full control, no ghost image, works with `-webkit-app-region`.
2. HTML5 drag and drop. Shows a ghost image, is awkward to style, and interacts
   badly with the window-drag region. Rejected.
3. A separate "Arrange profiles" sheet. Heavier than the request. Rejected.

## Design

- **Core:** `placeProfile(all, order, hidden, dir, beforeDir)` in
  `src/core/profiles.ts` returns the new full `profileOrder` with the visible
  `dir` placed immediately before the visible `beforeDir` (or after the last
  visible profile when `beforeDir` is null). Hidden profiles keep their exact
  slots: only the visible slots are refilled in the new visible order. Returns
  null when `dir` isn't visible, `beforeDir` isn't visible (and isn't null), or
  nothing would change. Tested next to `moveProfile`.
- **Command:** `{ type: 'reorderProfile'; dir: string; before: string | null }`,
  validated by `parseUiCommand` like `selectProfile` (dir and before must be
  known profiles). `main.ts` routes it to a `ProfileManager.place(dir, before)`
  that applies `placeProfile` and calls `changed()` when the result isn't null.
- **UI:** pointer handling on pills in `src/ui/ui.ts` (or a small
  `src/ui/parts/profileDrag.ts`):
  - threshold of about 4 px before a press becomes a drag; below it, the click
    behaves as today;
  - while dragging, the pill follows the pointer horizontally and the others
    slide (CSS transform transition) to open a gap at the drop position;
  - releasing over the bar sends `reorderProfile` with the pill that now follows
    the gap (or null for the end) and keeps the new arrangement on screen until
    the state push re-renders it in the same order;
  - Esc, a lost pointer capture, or releasing outside the bar restores the
    original arrangement and sends nothing; dropping in the original position
    sends nothing;
  - the click that would follow a drag is suppressed;
  - when the bar overflows, dragging near its left or right edge scrolls it.
- **Docs:** README (profile bar paragraph and a "Verify it works" step), and
  CLAUDE.md's module notes if a new UI part is added.

## Left to the builder

The exact threshold, the animation timing, the edge-scroll speed, and whether
the drag code lives in `ui.ts` or a new `src/ui/parts/profileDrag.ts`.
