import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOP_LEVEL, emptyTree, decodeTree, findNode, findByUrl, addBookmark, addFolder,
  renameNode, moveNode, removeNode, folderChoices, flattenBookmarks, mergeChrome, ancestorFolders, searchBookmarks,
} from './bookmarks.ts';
import type { ChromeBookmarks, ChromeNode } from './chromeLibrary.ts';

const T0 = 1_700_000_000_000;
function sample() { // Daily(Gmail, Reports(Weekly)), Figma
  let t = emptyTree();
  const daily = addFolder(t, TOP_LEVEL, 'Daily', T0); t = daily.tree;
  const reports = addFolder(t, daily.id!, 'Reports', T0); t = reports.tree;
  t = addBookmark(t, { title: 'Weekly', url: 'https://r.test/w' }, T0).tree; t = moveNode(t, findByUrl(t, 'https://r.test/w')!.id, reports.id!);
  t = addBookmark(t, { title: 'Gmail', url: 'https://mail.google.com/' }, T0).tree; t = moveNode(t, findByUrl(t, 'https://mail.google.com/')!.id, daily.id!);
  t = addBookmark(t, { title: 'Figma', url: 'https://figma.com/' }, T0).tree;
  return { t, daily: daily.id!, reports: reports.id! };
}

test('addBookmark puts it first at the top level with a new id', () => {
  const { t } = sample();
  assert.equal(t.nodes[0]!.title, 'Figma');
  const a = addBookmark(t, { title: 'A', url: 'https://a.test/' }, T0);
  const b = addBookmark(a.tree, { title: 'B', url: 'https://b.test/' }, T0);
  assert.ok(a.id !== null && b.id !== null && b.id > a.id);
  assert.equal(b.tree.nodes[0]!.id, b.id);
  assert.equal(t.nodes.length, 2, 'input unchanged');
});

test('addBookmark refuses non-web URLs', () => {
  const t = emptyTree();
  for (const url of ['about:blank', 'data:text/html,x']) {
    const r = addBookmark(t, { title: 'x', url }, T0);
    assert.equal(r.id, null);
    assert.deepEqual(r.tree, t);
  }
});

test('addFolder refuses an unknown or non-folder parent; empty title becomes New Folder', () => {
  const { t } = sample();
  const fig = findByUrl(t, 'https://figma.com/')!;
  assert.equal(addFolder(t, 999, 'X', T0).id, null);
  assert.equal(addFolder(t, fig.id, 'X', T0).id, null);
  const r = addFolder(t, TOP_LEVEL, '   ', T0);
  assert.equal(r.tree.nodes[0]!.title, 'New Folder');
});

test('findByUrl finds nested bookmarks', () => {
  const { t, reports } = sample();
  const n = findByUrl(t, 'https://r.test/w')!;
  assert.equal(n.title, 'Weekly');
  assert.equal(findNode(t, n.id)!.parentId, reports);
  assert.equal(findByUrl(t, 'https://nope.test/'), null);
});

test('renameNode trims; an empty title leaves it unchanged', () => {
  const { t } = sample();
  const id = findByUrl(t, 'https://mail.google.com/')!.id;
  assert.equal(findNode(renameNode(t, id, '  Mail  '), id)!.node.title, 'Mail');
  assert.deepEqual(renameNode(t, id, '   '), t);
  assert.deepEqual(renameNode(t, 999, 'x'), t);
});

test('moveNode puts it first in the target; never into itself or a descendant', () => {
  const { t, daily, reports } = sample();
  const fig = findByUrl(t, 'https://figma.com/')!.id;
  const m = moveNode(t, fig, daily);
  assert.equal(findNode(m, fig)!.parentId, daily);
  assert.equal((findNode(m, daily)!.node as { children: { id: number }[] }).children[0]!.id, fig);
  assert.deepEqual(moveNode(t, daily, reports), t);
  assert.deepEqual(moveNode(t, daily, daily), t);
  assert.equal(findNode(moveNode(m, fig, TOP_LEVEL), fig)!.parentId, TOP_LEVEL);
  assert.equal(moveNode(m, fig, TOP_LEVEL).nodes[0]!.id, fig);
});

test('removeNode removes a folder with its contents', () => {
  const { t, daily } = sample();
  const r = removeNode(t, daily);
  assert.equal(findByUrl(r, 'https://mail.google.com/'), null);
  assert.equal(findByUrl(r, 'https://r.test/w'), null);
  assert.ok(findByUrl(r, 'https://figma.com/'));
  assert.deepEqual(removeNode(t, 999), t);
});

test('folderChoices lists Top Level then folder paths, minus the moving folder subtree', () => {
  const { t, daily, reports } = sample();
  assert.deepEqual(folderChoices(t, null), [{ id: 0, path: 'Top Level' }, { id: daily, path: 'Daily' }, { id: reports, path: 'Daily / Reports' }]);
  assert.deepEqual(folderChoices(t, daily), [{ id: 0, path: 'Top Level' }]);
});

test('flattenBookmarks gives every bookmark with its folder path', () => {
  const { t } = sample();
  const flat = flattenBookmarks(t.nodes);
  assert.equal(flat.length, 3);
  assert.equal(flat.find((b) => b.title === 'Weekly')!.path, 'Daily / Reports');
  assert.equal(flat.find((b) => b.title === 'Gmail')!.path, 'Daily');
  assert.equal(flat.find((b) => b.title === 'Figma')!.path, '');
});

test('ancestorFolders lists the folders around a node, outermost first', () => {
  const { t, daily, reports } = sample();
  assert.deepEqual(ancestorFolders(t.nodes, findByUrl(t, 'https://r.test/w')!.id), [daily, reports]);
  assert.deepEqual(ancestorFolders(t.nodes, reports), [daily]);
  assert.deepEqual(ancestorFolders(t.nodes, findByUrl(t, 'https://figma.com/')!.id), []);
  assert.equal(ancestorFolders(t.nodes, 999), null);
});

test('searchBookmarks matches every word in title or URL, ignoring case and diacritics', () => {
  const { t } = sample();
  let tree = addBookmark(t, { title: 'Hồ sơ khách hàng', url: 'https://crm.test/' }, T0).tree;
  tree = addBookmark(tree, { title: 'Other', url: 'https://other.test/' }, T0).tree;
  assert.deepEqual(searchBookmarks(tree.nodes, 'ho SO').map((b) => b.title), ['Hồ sơ khách hàng']);
  assert.deepEqual(searchBookmarks(tree.nodes, 'r.test weekly').map((b) => [b.title, b.path]), [['Weekly', 'Daily / Reports']]);
  assert.deepEqual(searchBookmarks(tree.nodes, 'mail figma'), []);
  assert.equal(searchBookmarks(tree.nodes, '  ').length, 5, 'no words: everything');
});

test('a folder with an empty title is "Untitled" in folder paths', () => {
  const t = decodeTree({ version: 1, nextId: 4, nodes: [
    { id: 1, kind: 'folder', title: '', added: 1, children: [
      { id: 2, kind: 'folder', title: 'Inner', added: 1, children: [{ id: 3, kind: 'url', title: 'X', url: 'https://x.test/', added: 1 }] },
    ] },
  ] });
  assert.deepEqual(folderChoices(t, null), [{ id: 0, path: 'Top Level' }, { id: 1, path: 'Untitled' }, { id: 2, path: 'Untitled / Inner' }]);
  assert.equal(flattenBookmarks(t.nodes)[0]!.path, 'Untitled / Inner');
  assert.equal(t.nodes[0]!.title, '', 'the stored title is unchanged');
});

test('decodeTree keeps valid nodes, drops bad ones, repairs ids', () => {
  assert.deepEqual(decodeTree('garbage'), emptyTree());
  const t = decodeTree({ version: 1, nextId: 2, nodes: [
    { id: 1, kind: 'url', title: 'A', url: 'https://a.test/', added: 1 },
    { id: 1, kind: 'url', title: 'Dup id', url: 'https://b.test/', added: 1 },
    { id: 9, kind: 'url', title: 'Bad', url: 'javascript:x', added: 1 },
    { id: 4, kind: 'folder', title: 'F', added: 1 }, // no children -> []
  ] });
  assert.equal(t.nodes.length, 3);
  assert.equal(new Set(flattenBookmarks(t.nodes).map((b) => b.id)).size, 2);
  assert.ok(t.nextId > Math.max(...t.nodes.map((n) => n.id)));
  const f = t.nodes.find((n) => n.kind === 'folder')!;
  assert.deepEqual((f as { children: unknown[] }).children, []);
});

test('decodeTree makes titles strings and ids unique across nested folders', () => {
  const t = decodeTree({ nodes: [
    { id: 1, kind: 'folder', title: 5, added: 1, children: [{ id: 1, kind: 'url', title: 'N', url: 'https://n.test/', added: 1 }] },
  ] });
  assert.equal(t.nodes[0]!.title, '');
  const kid = flattenBookmarks(t.nodes)[0]!;
  assert.notEqual(kid.id, t.nodes[0]!.id);
  assert.ok(t.nextId > kid.id);
});

const cu = (title: string, url: string): ChromeNode => ({ kind: 'url', title, url, added: 5 });
const cf = (title: string, ...children: ChromeNode[]): ChromeNode => ({ kind: 'folder', title, added: 5, children });
const chrome = (p: Partial<ChromeBookmarks>): ChromeBookmarks => ({ bar: [], other: [], mobile: [], ...p });
const titles = (nodes: { title: string }[]) => nodes.map((n) => n.title);

test('mergeChrome: bar at top level, other/mobile as folders only when non-empty', () => {
  const r = mergeChrome(emptyTree(), [chrome({ bar: [cu('A', 'https://a.test/')], other: [cu('O', 'https://o.test/')] })], T0);
  assert.deepEqual(titles(r.tree.nodes), ['A', 'Other Bookmarks']);
  const other = r.tree.nodes[1];
  assert.equal(other.kind, 'folder');
  assert.deepEqual(other.kind === 'folder' && titles(other.children), ['O']);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 0);
  const m = mergeChrome(emptyTree(), [chrome({ mobile: [cu('M', 'https://m.test/')] })], T0);
  assert.deepEqual(titles(m.tree.nodes), ['Mobile Bookmarks']);
  assert.deepEqual(mergeChrome(emptyTree(), [chrome({})], T0).tree.nodes, []);
});

test('mergeChrome appends in Chrome order and reuses folders by name path', () => {
  const { t, daily } = sample(); 
  const r = mergeChrome(t, [chrome({ bar: [
    cu('Z', 'https://z.test/'),
    cf('Daily', cu('N1', 'https://n1.test/'), cf('Reports', cu('N2', 'https://n2.test/')), cf('Empty')),
    cu('Y', 'https://y.test/'),
  ] })], T0);
  const before = titles(t.nodes);
  assert.deepEqual(titles(r.tree.nodes), [...before, 'Z', 'Y']);
  const d = findNode(r.tree, daily)!.node;
  assert.equal(d.kind, 'folder');
  if (d.kind !== 'folder') return;
  assert.deepEqual(titles(d.children).slice(-2), ['N1', 'Empty']);
  const reports = d.children.find((c) => c.title === 'Reports')!;
  assert.deepEqual(reports.kind === 'folder' && titles(reports.children), ['Weekly', 'N2']);
  assert.equal(r.tree.nodes.filter((n) => n.title === 'Daily').length, 1);
  const ids = new Set<number>();
  const walk = (l: typeof t.nodes) => l.forEach((n) => { assert.ok(!ids.has(n.id)); ids.add(n.id); if (n.kind === 'folder') walk(n.children); });
  walk(r.tree.nodes);
  assert.equal(r.tree.nextId, Math.max(...ids) + 1);
});

test('mergeChrome a second time adds nothing', () => {
  const file = chrome({ bar: [cu('A', 'https://a.test/'), cf('F', cu('B', 'https://b.test/'))], other: [cu('O', 'https://o.test/')] });
  const once = mergeChrome(emptyTree(), [file], T0);
  const twice = mergeChrome(once.tree, [file], T0);
  assert.equal(twice.added, 0);
  assert.equal(twice.skipped, 3);
  assert.deepEqual(twice.tree.nodes, once.tree.nodes);
});

test('mergeChrome skips URLs the user already has anywhere (renamed or moved)', () => {
  const { t } = sample();
  const r = mergeChrome(t, [chrome({ bar: [cu('Mail', 'https://mail.google.com/'), cu('Fig', 'https://figma.com/'), cu('New', 'https://new.test/')] })], T0);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
  assert.equal(flattenBookmarks(r.tree.nodes).filter((b) => b.url === 'https://mail.google.com/').length, 1);
});

test('mergeChrome merges Bookmarks and AccountBookmarks into one tree', () => {
  const a = chrome({ bar: [cu('A', 'https://a.test/'), cu('S', 'https://shared.test/')] });
  const b = chrome({ bar: [cu('B', 'https://b.test/'), cu('S2', 'https://shared.test/')], other: [cu('A again', 'https://a.test/')] });
  const r = mergeChrome(emptyTree(), [a, b], T0);
  assert.deepEqual(flattenBookmarks(r.tree.nodes).map((x) => x.url), ['https://a.test/', 'https://shared.test/', 'https://b.test/']);
  assert.equal(r.added, 3);
  assert.equal(r.skipped, 2);
});

test('mergeChrome skips and counts non-web URLs', () => {
  const r = mergeChrome(emptyTree(), [chrome({ bar: [cu('JS', 'javascript:void 0'), cu('Settings', 'chrome://settings'), cu('OK', 'https://ok.test/'), cf('F', cu('File', 'file:///x'))] })], T0);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 3);
  assert.deepEqual(titles(r.tree.nodes), ['OK', 'F']);
});

test('mergeChrome creates a wrapper folder only when it adds something inside it', () => {
  const file = chrome({ other: [cu('O', 'https://o.test/')], mobile: [cu('M', 'https://m.test/')] });
  const once = mergeChrome(emptyTree(), [file], T0);
  // the user moves the bookmarks out and deletes both wrapper folders
  let t = once.tree;
  for (const url of ['https://o.test/', 'https://m.test/']) t = moveNode(t, findByUrl(t, url)!.id, TOP_LEVEL);
  for (const n of t.nodes.filter((x) => x.kind === 'folder')) t = removeNode(t, n.id);
  const again = mergeChrome(t, [file], T0);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.deepEqual(again.tree, t);
  // all-duplicate content on a fresh tree leaves no empty wrapper either
  const dup = mergeChrome(addBookmark(emptyTree(), { title: 'O', url: 'https://o.test/' }, T0).tree, [chrome({ other: [cu('O', 'https://o.test/')] })], T0);
  assert.deepEqual(titles(dup.tree.nodes), ['O']);
});
