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

/** Rows a list moves through: those with a `data-key` (their identity across re-renders). */
const KEYED = '.pr[data-key]';
const shown = (r: HTMLElement): boolean => r.getClientRects().length > 0; // not inside a closed folder

/**
 * One Tab stop per list (a "roving" tab index): only the last-focused row (else the first shown one) is in the Tab
 * order, and ↑ ↓ Home End move between shown rows (→ ← open and close a folder). `update` wraps every re-render: the
 * row that had the keyboard keeps it if it is still there (same `data-key`), unless something else in the list (an
 * inline rename) took focus meanwhile.
 */
export function setupRoving(list: HTMLElement): { update(change: () => void): void; normalize(): void } {
  let current: string | null = null;
  const keyed = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>(KEYED));

  function normalize(): void {
    const all = keyed();
    const stop = all.find((r) => r.dataset['key'] === current && shown(r)) ?? all.find(shown) ?? all[0];
    for (const r of all) r.tabIndex = r === stop ? 0 : -1;
  }

  list.addEventListener('focusin', (e) => {
    const r = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(KEYED) : null;
    if (r && list.contains(r)) { current = r.dataset['key'] ?? null; normalize(); }
  });

  list.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches(KEYED) || e.isComposing || e.metaKey || e.altKey || e.ctrlKey) return;
    const rows = keyed().filter(shown);
    const i = rows.indexOf(t);
    const expanded = t.getAttribute('aria-expanded');
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = rows[i + 1];
    else if (e.key === 'ArrowUp') next = rows[i - 1];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows.at(-1);
    else if ((e.key === 'ArrowRight' && expanded === 'false') || (e.key === 'ArrowLeft' && expanded === 'true')) {
      e.preventDefault();
      t.click(); // a folder row opens or closes on click
      normalize();
      return;
    } else return;
    e.preventDefault(); // no list scrolling by the arrow itself; focusing scrolls the row into view
    next?.focus();
  });

  function update(change: () => void): void {
    const a = document.activeElement;
    const had = a instanceof HTMLElement && list.contains(a) ? a.closest<HTMLElement>(KEYED)?.dataset['key'] ?? null : null;
    change();
    normalize();
    if (had === null || list.contains(document.activeElement)) return;
    keyed().find((r) => r.dataset['key'] === had)?.focus({ preventScroll: true });
  }

  return { update, normalize };
}

/** Blurs the focused element if it is inside `root` (a section folding while it held the keyboard). */
export function blurWithin(root: HTMLElement): void {
  const a = document.activeElement;
  if (a instanceof HTMLElement && root.contains(a)) a.blur();
}
