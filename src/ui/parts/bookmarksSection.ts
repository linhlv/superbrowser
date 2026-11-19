import type { SuperbrowserApi } from '../../preload/ui.ts';
import type { BookmarkNode, LibraryReply } from '../../shared/types.ts';
import { ancestorFolders, searchBookmarks } from '../../core/bookmarks.ts';
import { el, faviconIcon as icon } from './dom.ts';
import { icon as lineIcon } from './icons.ts';
import { blurWithin, emptyRow, escClearsSearch, opensOnClick, row, type SectionHandle } from './libraryRows.ts';

/**
 * The sidebar's Bookmarks section: the folder tree, a flat search, highlight/reveal, rename in place, row menus.
 * A folded section asks for nothing; a reply counts only while open and if its seq is the latest request's.
 */
export function setupBookmarksSection(opts: { sb: SuperbrowserApi; root: HTMLElement }):
  SectionHandle & { reveal(id: number): void; startRename(id: number): void } {
  const { sb, root } = opts;
  const search = root.querySelector('.sec-search') as HTMLInputElement;
  const list = root.querySelector('.sec-list') as HTMLElement;
  let open = false;
  let seq = 0;
  let nodes: BookmarkNode[] | null = null; // the whole tree, once loaded
  let favicons: Record<string, string> = {};
  let openFolders = new Set<number>(); // folder open/closed state lives here only, per profile (kept across a fold)
  const rows = new Map<number, { row: HTMLElement; title: string }>(); // rendered bookmarks and folders
  let highlight: number | null = null;
  let revealing = false; // scroll to `highlight` once a tree containing it is shown
  let pendingRename: number | null = null; // may arrive before the tree that has it
  let editing: { id: number; input: HTMLInputElement; label: HTMLElement } | null = null;

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
      opensOnClick(sb, r, n.url);
      return bookmarkRow(r, n.id, n.title);
    }
    const isOpen = () => openFolders.has(n.id);
    const arrow = el('span', 'fd');
    arrow.append(lineIcon('chevron'));
    const r = bookmarkRow(row(arrow, n.title || 'Untitled', null), n.id, n.title);
    const kids = el('div', 'bm-kids');
    kids.hidden = !isOpen();
    r.classList.toggle('open', isOpen());
    r.setAttribute('aria-expanded', String(isOpen()));
    kids.append(...n.children.map(treeNode));
    r.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      if (isOpen()) openFolders.delete(n.id); else openFolders.add(n.id);
      kids.hidden = !isOpen();
      r.classList.toggle('open', isOpen());
      r.setAttribute('aria-expanded', String(isOpen()));
    });
    const wrap = el('div', 'bm-folder');
    wrap.append(r, kids);
    return wrap;
  }

  function render(): void {
    const carry = editing ? { id: editing.id, value: editing.input.value } : null;
    editing = null; // the input is about to go; its blur must not count as a cancel
    rows.clear();
    if (nodes === null) { list.replaceChildren(); return; }
    if (search.value.trim()) {
      const hits = searchBookmarks(nodes, search.value).map((b) => {
        const r = row(icon(favicons[b.url]), b.title || b.url, b.path || 'Top Level');
        opensOnClick(sb, r, b.url);
        return bookmarkRow(r, b.id, b.title);
      });
      list.replaceChildren(...(hits.length > 0 ? hits : [emptyRow('No matches')]));
    } else {
      list.replaceChildren(...(nodes.length > 0 ? nodes.map(treeNode) : [emptyRow('No bookmarks')]));
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
      render();
    }
    return rows.has(id);
  }

  function onTree(r: Extract<LibraryReply, { kind: 'bookmarks' }>): void {
    nodes = r.nodes;
    favicons = r.favicons;
    render();
    if (revealing && highlight !== null && showInTree(highlight)) {
      revealing = false;
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
      e.stopPropagation(); // Esc here cancels the rename and nothing else
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
    if (!open) return; // the menu that asks for it belongs to an open section
    endEdit(null);
    pendingRename = id;
    if (showInTree(id)) {
      pendingRename = null;
      beginEdit(id);
    }
  }

  function load(): void {
    sb.send({ type: 'bookmarks', seq: ++seq });
  }

  /** Drops what is on screen and invalidates every request in flight. */
  function reset(): void {
    endEdit(null);
    seq++;
    nodes = null;
    favicons = {};
    rows.clear();
    highlight = null;
    revealing = false;
    pendingRename = null;
    list.replaceChildren();
  }

  function rerunSearch(): void {
    endEdit(null);
    highlight = null;
    revealing = false;
    render();
    list.scrollTop = 0;
  }

  search.addEventListener('input', () => { if (open) rerunSearch(); });
  escClearsSearch(search, () => { if (open) rerunSearch(); });

  return {
    setOpen(next) {
      if (next === open) return;
      open = next;
      if (open) { load(); return; }
      blurWithin(root);
      reset();
    },
    focusSearch() { if (open) { search.focus(); search.select(); } },
    reveal(id) {
      if (!open) return;
      highlight = id;
      revealing = true;
      if (search.value) { search.value = ''; render(); }
      load(); // the latest tree, with the bookmark just added; its reply reveals it
    },
    startRename,
    onReply(r) {
      if (r.kind === 'bookmarks' && open && r.seq === seq) onTree(r);
    },
    onProfileChanged() {
      // Ids and folders belong to the old profile: drop them, and show nothing of it while the new data loads.
      reset();
      openFolders = new Set();
      if (open) load();
    },
    onLibraryChanged() { if (open) load(); },
  };
}
