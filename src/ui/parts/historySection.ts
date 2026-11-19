import type { SuperbrowserApi } from '../../preload/ui.ts';
import type { HistoryRow, LibraryReply } from '../../shared/types.ts';
import { dayLabel, dayOf } from '../../core/searchText.ts';
import { el, faviconIcon as icon } from './dom.ts';
import { blurWithin, clock, emptyRow, escClearsSearch, formatDay, host, opensOnClick, row, type SectionHandle } from './libraryRows.ts';

const LOAD_MORE_WITHIN_PX = 200;
const SEARCH_DELAY_MS = 150;
/** A recorded visit refreshes the list only while it is scrolled no further than this from the top. */
const NEAR_TOP_PX = 40;

/**
 * The sidebar's History section: day groups, debounced search, older pages loaded as the list nears its bottom.
 * A folded section asks for nothing; a reply counts only while open and if its seq is the latest request's.
 */
export function setupHistorySection(opts: { sb: SuperbrowserApi; root: HTMLElement }):
  SectionHandle & { onHistoryRecorded(): void } {
  const { sb, root } = opts;
  const search = root.querySelector('.sec-search') as HTMLInputElement;
  const list = root.querySelector('.sec-list') as HTMLElement;
  let open = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let query = ''; // the query of the list on screen (and of its next pages)
  let appending = false;
  let loading = false;
  let more = false;
  let lastTime: number | null = null;
  let lastDay: number | null = null;

  function request(before: number | null): void {
    if (before === null) {
      clearTimeout(searchTimer); // this request already carries the typed query
      query = search.value;
    }
    appending = before !== null;
    loading = true;
    sb.send({ type: 'historyPage', seq: ++seq, query, before });
  }

  function historyRow(h: HistoryRow): HTMLElement {
    const where = host(h.url);
    const r = row(icon(h.favicon), h.title || h.url, where ? `${clock(h.time)} · ${where}` : clock(h.time));
    opensOnClick(sb, r, h.url);
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sb.send({ type: 'historyMenu', url: h.url });
    });
    return r;
  }

  function onPage(r: Extract<LibraryReply, { kind: 'historyPage' }>): void {
    loading = false;
    more = r.more;
    if (!appending) {
      list.replaceChildren();
      lastTime = null;
      lastDay = null;
      if (r.rows.length === 0) list.append(emptyRow(query.trim() ? 'No matches' : 'No history'));
    }
    const tz = new Date().getTimezoneOffset();
    const today = dayOf(Date.now(), tz);
    const add = document.createDocumentFragment();
    for (const h of r.rows) {
      if (h.day !== lastDay) add.append(el('div', 'pday', dayLabel(h.day, today, tz, formatDay)));
      add.append(historyRow(h));
      lastDay = h.day;
      lastTime = h.time;
    }
    list.append(add);
    loadMoreIfNear();
  }

  function loadMoreIfNear(): void {
    if (!open || !more || loading || lastTime === null) return;
    if (list.clientHeight === 0) return; // sidebar hidden: nothing is near the bottom of an unseen list
    if (list.scrollHeight - list.scrollTop - list.clientHeight < LOAD_MORE_WITHIN_PX) request(lastTime);
  }

  list.addEventListener('scroll', loadMoreIfNear);
  // Re-check when the list gets its size back (sidebar shown again) or grows (window resized, the other section folded).
  new ResizeObserver(loadMoreIfNear).observe(list);

  /** Drops what is on screen and invalidates every request in flight. */
  function reset(): void {
    clearTimeout(searchTimer);
    seq++;
    loading = false;
    more = false;
    lastTime = null;
    lastDay = null;
    list.replaceChildren();
  }

  function rerunSearch(): void {
    list.scrollTop = 0;
    request(null);
  }

  search.addEventListener('input', () => {
    if (!open) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(rerunSearch, SEARCH_DELAY_MS);
  });
  escClearsSearch(search, () => { if (open) rerunSearch(); });

  return {
    setOpen(next) {
      if (next === open) return;
      open = next;
      if (open) { request(null); return; }
      blurWithin(root);
      reset();
    },
    focusSearch() { if (open) { search.focus(); search.select(); } },
    onReply(r) {
      if (r.kind === 'historyPage' && open && r.seq === seq) onPage(r);
    },
    onProfileChanged() {
      // Rows belong to the old profile: show nothing of it while the new data loads. The search text stays.
      reset();
      if (open) request(null);
    },
    onLibraryChanged() { if (open) request(null); },
    onHistoryRecorded() {
      // A page just visited shows under Today, unless someone is searching or reading older days (no jump to the top).
      if (open && search.value.trim() === '' && list.scrollTop <= NEAR_TOP_PX) request(null);
    },
  };
}
