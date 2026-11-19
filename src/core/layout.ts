import type { Rect } from './appState.ts';

/** Sidebar width, page inset at the sides, profile bar height, toolbar (back/forward/reload/address) height. */
export const SIDEBAR_W = 240, GAP = 8, BOTTOM_H = 44, TOP_H = 44;

/** Where the active tab's page goes, in window content coordinates. */
export function tabBounds(size: { width: number; height: number }, sidebarVisible: boolean): Rect {
  const x = sidebarVisible ? SIDEBAR_W : GAP;
  return { x, y: TOP_H, width: size.width - x - GAP, height: size.height - TOP_H - BOTTOM_H };
}

/**
 * The toolbar view: the strip above the page, as wide as the page. While the address suggestions are open it is
 * `height` tall (over the page, its empty part transparent), never shorter than the strip nor over the profile bar.
 */
export function toolbarBounds(size: { width: number; height: number }, sidebarVisible: boolean, height: number): Rect {
  const tab = tabBounds(size, sidebarVisible);
  return { x: tab.x, y: 0, width: tab.width, height: Math.min(Math.max(height, TOP_H), size.height - BOTTOM_H) };
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
