import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkMenuSpec, historyMenuSpec, panelRequestFor, type LibraryMenuItem } from './libraryMenus.ts';
import type { BookmarkNode } from '../shared/types.ts';

const labels = (spec: LibraryMenuItem[]) => spec.map((i) => ('label' in i ? i.label : '—'));
const choices = [{ id: 0, path: 'Top Level' }, { id: 4, path: 'Daily' }, { id: 7, path: 'Daily / Reports' }];

test('bookmark menu: Open in New Tab, Copy Link, Rename…, Move to, Delete', () => {
  const node: BookmarkNode = { id: 9, kind: 'url', title: 'Gmail', url: 'https://mail.google.com/', added: 1 };
  const spec = bookmarkMenuSpec(node, choices);
  assert.deepEqual(labels(spec), ['Open in New Tab', 'Copy Link', '—', 'Rename…', 'Move to', '—', 'Delete']);
  assert.deepEqual(spec.map((i) => i.id), ['openInNewTab', 'copyLink', 'separator', 'rename', 'moveTo', 'separator', 'delete']);
  const moveTo = spec.find((i) => i.id === 'moveTo');
  assert.ok(moveTo && moveTo.id === 'moveTo');
  assert.deepEqual(moveTo.choices, choices);
});

test('folder menu: New Folder…, Rename…, Delete', () => {
  const node: BookmarkNode = { id: 4, kind: 'folder', title: 'Daily', added: 1, children: [] };
  const spec = bookmarkMenuSpec(node, choices);
  assert.deepEqual(labels(spec), ['New Folder…', 'Rename…', '—', 'Delete']);
  assert.deepEqual(spec.map((i) => i.id), ['newFolder', 'rename', 'separator', 'delete']);
});

test('history menu: Open in New Tab, Copy Link, Delete from History', () => {
  const spec = historyMenuSpec();
  assert.deepEqual(labels(spec), ['Open in New Tab', 'Copy Link', '—', 'Delete from History']);
  assert.deepEqual(spec.map((i) => i.id), ['openInNewTab', 'copyLink', 'separator', 'deleteFromHistory']);
});

test('a panel request that had to reveal the sidebar always shows the panel', () => {
  const toggle = { panel: 'history', mode: 'toggle', highlight: null } as const;
  assert.deepEqual(panelRequestFor(toggle, true), { panel: 'history', mode: 'show', highlight: null });
  assert.deepEqual(panelRequestFor(toggle, false), toggle);
  const show = { panel: 'bookmarks', mode: 'show', highlight: 3 } as const;
  assert.deepEqual(panelRequestFor(show, true), show);
});
