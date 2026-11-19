// Rows shared by the sidebar's Bookmarks and History sections. Titles and URLs are untrusted: textContent only.
import type { SuperbrowserApi } from '../../preload/ui.ts';
import type { LibraryReply } from '../../shared/types.ts';
import { activatable, el } from './dom.ts';

/** What ui.ts drives a sidebar section with. */
export type SectionHandle = {
  /** No-op when unchanged; opening loads, folding drops rows and invalidates requests. */
  setOpen(open: boolean): void;
  focusSearch(): void;
  /** Ignores replies while folded or with a stale seq. */
  onReply(r: LibraryReply): void;
  /** Drops rows at once; reloads only if open; keeps the search text. */
  onProfileChanged(): void;
  /** Reloads only if open. */
  onLibraryChanged(): void;
};

export function host(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

export function clock(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const formatDay = (time: number): string =>
  new Date(time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** A row: icon, label, optional muted second line. */
export function row(iconEl: HTMLElement, label: string, sub: string | null): HTMLElement {
  const r = el('div', 'pr');
  const text = el('div', 'pt');
  text.append(el('span', 't', label));
  if (sub !== null) text.append(el('span', 'ps', sub));
  r.append(iconEl, text);
  activatable(r);
  return r;
}

/** The muted line shown when a list has nothing ("No history", "No matches"). */
export const emptyRow = (text: string): HTMLElement => el('div', 'pempty', text);

/** A click opens `url` in the current tab, ⌘-click in a new tab; the tooltip shows title and URL. */
export function opensOnClick(sb: SuperbrowserApi, r: HTMLElement, url: string): void {
  r.title = `${r.querySelector('.t')!.textContent}\n${url}`;
  r.addEventListener('click', (e) => {
    if (e.button === 0) sb.send({ type: 'openUrl', url, newTab: e.metaKey });
  });
}

/** Esc in a section's search: clears it (then `cleared` re-runs the search) when it has text, otherwise leaves the field.
 *  It never folds the section. */
export function escClearsSearch(search: HTMLInputElement, cleared: () => void): void {
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    if (search.value) { search.value = ''; cleared(); } else search.blur();
  });
}

/** Blurs the focused element if it is inside `root` (a section folding while it held the keyboard). */
export function blurWithin(root: HTMLElement): void {
  const a = document.activeElement;
  if (a instanceof HTMLElement && root.contains(a)) a.blur();
}
