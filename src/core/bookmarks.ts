import type { BookmarkNode } from '../shared/types.ts';
import { isWebUrl } from './address.ts';
import type { ChromeBookmarks, ChromeNode } from './chromeLibrary.ts';

export type BookmarkTree = { version: 1; nextId: number; nodes: BookmarkNode[] }; // nodes = top level
export const TOP_LEVEL = 0;

type Folder = Extract<BookmarkNode, { kind: 'folder' }>;

export function emptyTree(): BookmarkTree {
  return { version: 1, nextId: 1, nodes: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Tolerant decode: keeps valid nodes, drops bad ones, gives duplicate or missing ids fresh ones. */
export function decodeTree(raw: unknown): BookmarkTree {
  if (!isRecord(raw)) return emptyTree();
  const seen = new Set<number>();
  const needId: BookmarkNode[] = [];
  const decodeNodes = (list: unknown): BookmarkNode[] => {
    if (!Array.isArray(list)) return [];
    const out: BookmarkNode[] = [];
    for (const r of list) {
      if (!isRecord(r)) continue;
      const title = typeof r.title === 'string' ? r.title : '';
      const added = typeof r.added === 'number' && Number.isFinite(r.added) ? r.added : 0;
      let node: BookmarkNode;
      if (r.kind === 'url') {
        if (typeof r.url !== 'string' || !isWebUrl(r.url)) continue;
        node = { id: 0, kind: 'url', title, url: r.url, added };
      } else if (r.kind === 'folder') {
        node = { id: 0, kind: 'folder', title, added, children: decodeNodes(r.children) };
      } else continue;
      if (isId(r.id) && !seen.has(r.id)) { seen.add(r.id); node.id = r.id; } else needId.push(node);
      out.push(node);
    }
    return out;
  };
  const nodes = decodeNodes(raw.nodes);
  let next = Math.max(isId(raw.nextId) ? raw.nextId : 1, ...[...seen].map((i) => i + 1));
  for (const n of needId) n.id = next++;
  return { version: 1, nextId: next, nodes };
}

export function findNode(tree: BookmarkTree, id: number): { node: BookmarkNode; parentId: number } | null {
  const walk = (list: BookmarkNode[], parentId: number): { node: BookmarkNode; parentId: number } | null => {
    for (const node of list) {
      if (node.id === id) return { node, parentId };
      if (node.kind === 'folder') {
        const hit = walk(node.children, node.id);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(tree.nodes, TOP_LEVEL);
}

export function findByUrl(tree: BookmarkTree, url: string): (BookmarkNode & { kind: 'url' }) | null {
  const walk = (list: BookmarkNode[]): (BookmarkNode & { kind: 'url' }) | null => {
    for (const node of list) {
      if (node.kind === 'url' && node.url === url) return node;
      if (node.kind === 'folder') {
        const hit = walk(node.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(tree.nodes);
}

/** Rebuilds the tree, replacing the children list of folder `id` (or the top level for 0) with `f(children)`. */
function mapChildren(nodes: BookmarkNode[], id: number, f: (c: BookmarkNode[]) => BookmarkNode[]): BookmarkNode[] {
  return nodes.map((n) => n.kind === 'folder'
    ? { ...n, children: n.id === id ? f(n.children) : mapChildren(n.children, id, f) }
    : n);
}

function insertFirst(tree: BookmarkTree, parentId: number, node: BookmarkNode): BookmarkNode[] {
  return parentId === TOP_LEVEL
    ? [node, ...tree.nodes]
    : mapChildren(tree.nodes, parentId, (c) => [node, ...c]);
}

export function addBookmark(tree: BookmarkTree, b: { title: string; url: string }, now: number): { tree: BookmarkTree; id: number | null } {
  if (!isWebUrl(b.url)) return { tree, id: null };
  const node: BookmarkNode = { id: tree.nextId, kind: 'url', title: b.title.trim() || b.url, url: b.url, added: now };
  return { tree: { ...tree, nextId: tree.nextId + 1, nodes: [node, ...tree.nodes] }, id: node.id };
}

export function addFolder(tree: BookmarkTree, parentId: number, title: string, now: number): { tree: BookmarkTree; id: number | null } {
  if (parentId !== TOP_LEVEL && findNode(tree, parentId)?.node.kind !== 'folder') return { tree, id: null };
  const node: Folder = { id: tree.nextId, kind: 'folder', title: title.trim() || 'New Folder', added: now, children: [] };
  return { tree: { ...tree, nextId: tree.nextId + 1, nodes: insertFirst(tree, parentId, node) }, id: node.id };
}

function removeFrom(nodes: BookmarkNode[], id: number): BookmarkNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => n.kind === 'folder' ? { ...n, children: removeFrom(n.children, id) } : n);
}

export function renameNode(tree: BookmarkTree, id: number, title: string): BookmarkTree {
  const t = title.trim();
  if (!t || !findNode(tree, id)) return tree;
  const walk = (list: BookmarkNode[]): BookmarkNode[] => list.map((n) => {
    const withKids = n.kind === 'folder' ? { ...n, children: walk(n.children) } : n;
    return n.id === id ? { ...withKids, title: t } : withKids;
  });
  return { ...tree, nodes: walk(tree.nodes) };
}

function containsId(node: BookmarkNode, id: number): boolean {
  return node.id === id || (node.kind === 'folder' && node.children.some((c) => containsId(c, id)));
}

export function moveNode(tree: BookmarkTree, id: number, folderId: number): BookmarkTree {
  const found = findNode(tree, id);
  if (!found) return tree;
  if (folderId !== TOP_LEVEL) {
    const target = findNode(tree, folderId);
    if (!target || target.node.kind !== 'folder' || containsId(found.node, folderId)) return tree;
  }
  const without = { ...tree, nodes: removeFrom(tree.nodes, id) };
  return { ...tree, nodes: insertFirst(without, folderId, found.node) };
}

export function removeNode(tree: BookmarkTree, id: number): BookmarkTree {
  if (!findNode(tree, id)) return tree;
  return { ...tree, nodes: removeFrom(tree.nodes, id) };
}

/** A folder path as shown in menus and search results; a folder with no title (Chrome allows it) shows "Untitled". */
function joinPath(prefix: string, title: string): string {
  const name = title || 'Untitled';
  return prefix ? `${prefix} / ${name}` : name;
}

export function folderChoices(tree: BookmarkTree, movingId: number | null): { id: number; path: string }[] {
  const out = [{ id: TOP_LEVEL, path: 'Top Level' }];
  const walk = (list: BookmarkNode[], prefix: string) => {
    for (const n of list) {
      if (n.kind !== 'folder' || n.id === movingId) continue;
      const path = joinPath(prefix, n.title);
      out.push({ id: n.id, path });
      walk(n.children, path);
    }
  };
  walk(tree.nodes, '');
  return out;
}

export function flattenBookmarks(nodes: BookmarkNode[]): { id: number; title: string; url: string; path: string }[] {
  const out: { id: number; title: string; url: string; path: string }[] = [];
  const walk = (list: BookmarkNode[], prefix: string) => {
    for (const n of list) {
      if (n.kind === 'url') out.push({ id: n.id, title: n.title, url: n.url, path: prefix });
      else walk(n.children, joinPath(prefix, n.title));
    }
  };
  walk(nodes, '');
  return out;
}

/**
 * Add-only merge of Chrome's bookmark files. Imported items are appended to the end of their
 * folder in Chrome order. A URL already anywhere in the tree (or seen earlier in this import) is
 * skipped and counted, as is a non-web URL. Folders are reused by name path.
 */
export function mergeChrome(tree: BookmarkTree, files: ChromeBookmarks[], now: number): { tree: BookmarkTree; added: number; skipped: number } {
  const work = structuredClone(tree);
  const seen = new Set(flattenBookmarks(work.nodes).map((b) => b.url));
  let added = 0;
  let skipped = 0;

  const folderIn = (list: BookmarkNode[], title: string, addedAt: number): Folder => {
    const hit = list.find((n): n is Folder => n.kind === 'folder' && n.title === title);
    if (hit) return hit;
    const node: Folder = { id: work.nextId++, kind: 'folder', title, added: addedAt, children: [] };
    list.push(node);
    return node;
  };
  const importInto = (list: BookmarkNode[], items: ChromeNode[]) => {
    for (const item of items) {
      if (item.kind === 'folder') {
        importInto(folderIn(list, item.title, item.added || now).children, item.children);
      } else if (!isWebUrl(item.url) || seen.has(item.url)) {
        skipped++;
      } else {
        seen.add(item.url);
        list.push({ id: work.nextId++, kind: 'url', title: item.title || item.url, url: item.url, added: item.added || now });
        added++;
      }
    }
  };
  // A wrapper folder is created only when something is actually added inside it.
  const importWrapper = (title: string, items: ChromeNode[]) => {
    if (!items.length) return;
    const existing = work.nodes.find((n): n is Folder => n.kind === 'folder' && n.title === title);
    if (existing) { importInto(existing.children, items); return; }
    const before = added;
    const children: BookmarkNode[] = [];
    importInto(children, items);
    if (added > before) work.nodes.push({ id: work.nextId++, kind: 'folder', title, added: now, children });
  };
  for (const f of files) {
    importInto(work.nodes, f.bar);
    importWrapper('Other Bookmarks', f.other);
    importWrapper('Mobile Bookmarks', f.mobile);
  }
  return { tree: work, added, skipped };
}
