import type { SuperbrowserApi } from '../../preload/ui.ts';
import type { BookmarkNode, HistoryRow, LibraryReply, PanelRequest } from '../../shared/types.ts';
import { dayLabel, dayOf } from '../../core/searchText.ts';
import { ancestorFolders, searchBookmarks } from '../../core/bookmarks.ts';
import { el, faviconIcon as icon } from './dom.ts';

type Panel = PanelRequest['panel'];

const LOAD_MORE_WITHIN_PX = 200;
const SEARCH_DELAY_MS = 150;

function host(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

function clock(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const formatDay = (time: number): string =>
  new Date(time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** A row: icon, label, optional muted second line. */
function row(iconEl: HTMLElement, label: string, sub: string | null): HTMLElement {
  const r = el('div', 'pr');
  const text = el('div', 'pt');
  text.append(el('span', 't', label));
  if (sub !== null) text.append(el('span', 'ps', sub));
  r.append(iconEl, text);
  return r;
}

/**
 * The History and Bookmarks panels, which take the tab list's place in the sidebar.
 * Titles and URLs are untrusted: everything is built with textContent.
 */
export function setupPanel(opts: { sb: SuperbrowserApi; root: HTMLElement; tabs: HTMLElement }): {
  onReply(r: LibraryReply): void; onProfileChanged(dir: string): void;
} {
  const { sb, root, tabs } = opts;
  const titleEl = root.querySelector('#panel-title') as HTMLElement;
  const search = root.querySelector('#panel-search') as HTMLInputElement;
  const list = root.querySelector('#panel-list') as HTMLElement;
  let shown: Panel | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  // History: pages are appended; a reply counts only if its seq is the latest request's.
  let historySeq = 0;
  let historyQuery = ''; // the query of the list on screen (and of its next pages)
  let appending = false;
  let loading = false;
  let more = false;
  let lastTime: number | null = null;
  let lastDay: number | null = null;

  // Bookmarks: the whole tree; folder open/closed state lives here only, per profile.
  let bookmarksSeq = 0;
  let nodes: BookmarkNode[] | null = null;
  let favicons: Record<string, string> = {};
  let openFolders = new Set<number>();
  const rows = new Map<number, { row: HTMLElement; title: string }>(); // rendered bookmarks and folders
  let highlight: number | null = null;
  let reveal = false; // scroll to `highlight` once a tree containing it is shown
  let pendingRename: number | null = null; // may arrive before the tree that has it
  let editing: { id: number; input: HTMLInputElement; label: HTMLElement } | null = null;

  const empty = (text: string): HTMLElement => el('div', 'pempty', text);

  function opensOnClick(r: HTMLElement, url: string): void {
    r.title = `${r.querySelector('.t')!.textContent}\n${url}`;
    r.addEventListener('click', (e) => {
      if (e.button === 0) sb.send({ type: 'openUrl', url, newTab: e.metaKey });
    });
  }

  // ---- History

  function requestHistory(before: number | null): void {
    if (before === null) {
      clearTimeout(searchTimer); // this request already carries the typed query
      historyQuery = search.value;
    }
    appending = before !== null;
    loading = true;
    sb.send({ type: 'historyPage', seq: ++historySeq, query: historyQuery, before });
  }

  function historyRow(h: HistoryRow): HTMLElement {
    const where = host(h.url);
    const r = row(icon(h.favicon), h.title || h.url, where ? `${clock(h.time)} · ${where}` : clock(h.time));
    opensOnClick(r, h.url);
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sb.send({ type: 'historyMenu', url: h.url });
    });
    return r;
  }

  function onHistory(r: Extract<LibraryReply, { kind: 'historyPage' }>): void {
    loading = false;
    more = r.more;
    if (!appending) {
      list.replaceChildren();
      lastTime = null;
      lastDay = null;
      if (r.rows.length === 0) list.append(empty(historyQuery.trim() ? 'No matches' : 'No history'));
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
    if (shown !== 'history' || !more || loading || lastTime === null) return;
    if (list.clientHeight === 0) return; // sidebar hidden: nothing is near the bottom of an unseen list
    if (list.scrollHeight - list.scrollTop - list.clientHeight < LOAD_MORE_WITHIN_PX) requestHistory(lastTime);
  }

  list.addEventListener('scroll', loadMoreIfNear);
  // Re-check when the list gets its size back (sidebar shown again) or grows (window resized).
  new ResizeObserver(loadMoreIfNear).observe(list);

  // ---- Bookmarks

  function bookmarkRow(r: HTMLElement, id: number, title: string): HTMLElement {
    rows.set(id, { row: r, title });
    if (id === highlight) r.classList.add('hl');
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sb.send({ type: 'bookmarkMenu', id });
    });
    return r;
  }

  function treeNode(n: BookmarkNode): HTMLElement {
    if (n.kind === 'url') {
      const r = row(icon(favicons[n.url]), n.title || n.url, null);
      opensOnClick(r, n.url);
      return bookmarkRow(r, n.id, n.title);
    }
    const isOpen = () => openFolders.has(n.id);
    const arrow = el('span', 'fd', isOpen() ? '▾' : '▸');
    const r = bookmarkRow(row(arrow, n.title || 'Untitled', null), n.id, n.title);
    const kids = el('div', 'bm-kids');
    kids.hidden = !isOpen();
    kids.append(...n.children.map(treeNode));
    r.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      if (isOpen()) openFolders.delete(n.id); else openFolders.add(n.id);
      kids.hidden = !isOpen();
      arrow.textContent = isOpen() ? '▾' : '▸';
    });
    const wrap = el('div', 'bm-folder');
    wrap.append(r, kids);
    return wrap;
  }

  function renderBookmarks(): void {
    const carry = editing ? { id: editing.id, value: editing.input.value } : null;
    editing = null; // the input is about to go; its blur must not count as a cancel
    rows.clear();
    if (nodes === null) { list.replaceChildren(); return; }
    if (search.value.trim()) {
      const hits = searchBookmarks(nodes, search.value).map((b) => {
        const r = row(icon(favicons[b.url]), b.title || b.url, b.path || 'Top Level');
        opensOnClick(r, b.url);
        return bookmarkRow(r, b.id, b.title);
      });
      list.replaceChildren(...(hits.length > 0 ? hits : [empty('No matches')]));
    } else {
      list.replaceChildren(...(nodes.length > 0 ? nodes.map(treeNode) : [empty('No bookmarks')]));
    }
    if (carry && rows.has(carry.id)) beginEdit(carry.id, carry.value);
  }

  /** Makes node `id` visible in the tree (clearing the search, opening its folders); false if the tree lacks it. */
  function showInTree(id: number): boolean {
    const folders = nodes ? ancestorFolders(nodes, id) : null;
    if (folders === null) return false;
    const closed = folders.filter((f) => !openFolders.has(f));
    if (closed.length > 0 || !rows.has(id)) {
      for (const f of closed) openFolders.add(f);
      search.value = '';
      renderBookmarks();
    }
    return rows.has(id);
  }

  function onBookmarks(r: Extract<LibraryReply, { kind: 'bookmarks' }>): void {
    nodes = r.nodes;
    favicons = r.favicons;
    renderBookmarks();
    if (reveal && highlight !== null && showInTree(highlight)) {
      reveal = false;
      rows.get(highlight)!.row.scrollIntoView({ block: 'nearest' });
    }
    if (pendingRename !== null) startRename(pendingRename);
  }

  function beginEdit(id: number, value?: string): void {
    const target = rows.get(id);
    const label = target?.row.querySelector('.t');
    if (!target || !(label instanceof HTMLElement)) return;
    const input = el('input', 'bm-edit');
    input.type = 'text';
    input.spellcheck = false;
    input.value = value ?? target.title;
    label.replaceWith(input);
    editing = { id, input, label };
    for (const type of ['click', 'contextmenu']) input.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Esc here cancels the rename, not the panel
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
      else if (e.key === 'Escape') { e.preventDefault(); endEdit(null); }
    });
    // Blur never commits: the rename command carries no profile, so only an explicit Enter sends it.
    input.addEventListener('blur', () => { if (editing?.input === input) endEdit(null); });
    target.row.scrollIntoView({ block: 'nearest' });
    input.focus();
    if (value === undefined) input.select();
  }

  /** Puts the label back, showing `title` if given (the refreshed tree follows). */
  function endEdit(title: string | null): void {
    if (!editing) return;
    const { input, label } = editing;
    editing = null;
    if (title !== null) label.textContent = title;
    input.replaceWith(label);
  }

  function commitEdit(): void {
    if (!editing) return;
    const { id } = editing;
    const title = editing.input.value.trim();
    const changed = title !== '' && title !== rows.get(id)?.title;
    endEdit(changed ? title : null);
    if (changed) sb.send({ type: 'renameBookmark', id, title });
  }

  function startRename(id: number): void {
    endEdit(null);
    pendingRename = id;
    if (shown === 'bookmarks' && showInTree(id)) {
      pendingRename = null;
      beginEdit(id);
    }
  }

  // ---- Opening, closing, refreshing

  function load(): void {
    if (shown === 'history') requestHistory(null);
    else if (shown === 'bookmarks') sb.send({ type: 'bookmarks', seq: ++bookmarksSeq });
  }

  /** Drops what is on screen and invalidates every request in flight. */
  function reset(): void {
    endEdit(null);
    clearTimeout(searchTimer);
    historySeq++;
    bookmarksSeq++;
    loading = false;
    more = false;
    lastTime = null;
    lastDay = null;
    nodes = null;
    favicons = {};
    rows.clear();
    highlight = null;
    reveal = false;
    pendingRename = null;
    list.replaceChildren();
  }

  function close(): void {
    if (shown === null) return;
    const hadFocus = root.contains(document.activeElement);
    reset();
    shown = null;
    root.hidden = true;
    tabs.hidden = false;
    if (hadFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function onPanel(req: PanelRequest): void {
    if (req.mode === 'toggle' && shown === req.panel) { close(); return; }
    if (shown !== req.panel) {
      reset();
      shown = req.panel;
      const history = req.panel === 'history';
      titleEl.textContent = history ? 'History' : 'Bookmarks';
      search.placeholder = history ? 'Search history' : 'Search bookmarks';
      search.value = '';
      tabs.hidden = true;
      root.hidden = false;
    }
    if (req.panel === 'bookmarks' && req.highlight !== null) {
      highlight = req.highlight;
      reveal = true;
      if (search.value) { search.value = ''; renderBookmarks(); }
    }
    load();
    search.focus();
  }

  search.addEventListener('input', () => {
    if (shown === 'history') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { list.scrollTop = 0; requestHistory(null); }, SEARCH_DELAY_MS);
    } else if (shown === 'bookmarks') {
      endEdit(null);
      highlight = null;
      reveal = false;
      renderBookmarks();
      list.scrollTop = 0;
    }
  });

  root.querySelector('#panel-close')!.addEventListener('click', close);

  // Esc closes the panel when the keyboard is in it (or nowhere in particular); the address field keeps its own Esc.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || shown === null || editing) return;
    if (!(e.target instanceof Node) || !(root.contains(e.target) || e.target === document.body)) return;
    e.preventDefault();
    close();
  });

  sb.onPanel(onPanel);
  sb.onLibraryChanged(() => load());
  sb.onStartRename((id) => { if (shown === 'bookmarks') startRename(id); });

  return {
    onReply(r) {
      if (r.kind === 'historyPage' && shown === 'history' && r.seq === historySeq) onHistory(r);
      else if (r.kind === 'bookmarks' && shown === 'bookmarks' && r.seq === bookmarksSeq) onBookmarks(r);
    },
    onProfileChanged() {
      // Ids and folders belong to the old profile: drop them, and show nothing of it while the new data loads.
      const panel = shown;
      reset();
      openFolders = new Set();
      if (panel !== null) load();
    },
  };
}
