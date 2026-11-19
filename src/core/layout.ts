import type { Rect } from './appState.ts';

export const SIDEBAR_W = 240, GAP = 8, BOTTOM_H = 44;

/** Where the active tab's page goes, in window content coordinates. */
export function tabBounds(size: { width: number; height: number }, sidebarVisible: boolean): Rect {
  const x = sidebarVisible ? SIDEBAR_W : GAP;
  return { x, y: GAP, width: size.width - x - GAP, height: size.height - GAP - BOTTOM_H };
}

export const FIND_W = 320, FIND_H = 44, FIND_INSET = 8;

/** The find-in-page bar: top-right inside the tab rect. */
export function findBarBounds(tab: Rect): Rect {
  return { x: tab.x + tab.width - FIND_W - FIND_INSET, y: tab.y + FIND_INSET, width: FIND_W, height: FIND_H };
}

const MIN_VISIBLE = 100;

/** Saved bounds are kept only if at least 100×100 px of them lie on one work area; else the fallback size (window centers itself). */
export function restoreBounds(saved: Rect | null, workAreas: Rect[], fallback: { width: number; height: number }): Rect | { width: number; height: number } {
  if (!saved) return fallback;
  const visible = workAreas.some((a) => {
    const w = Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x);
    const h = Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y);
    return w >= MIN_VISIBLE && h >= MIN_VISIBLE;
  });
  return visible ? saved : fallback;
}
