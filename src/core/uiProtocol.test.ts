import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barProfiles, parseUiCommand } from './uiProtocol.ts';

const p = (dir: string) => ({ dir, name: `Name ${dir}`, color: '#123456' });

test('barProfiles: shortcuts 1–9 in bar order, null after the ninth', () => {
  const bar = barProfiles(Array.from({ length: 11 }, (_, i) => p(`P${i}`)));
  assert.deepEqual(bar.map((x) => x.shortcut), [1, 2, 3, 4, 5, 6, 7, 8, 9, null, null]);
  assert.deepEqual(bar[0], { dir: 'P0', name: 'Name P0', color: '#123456', shortcut: 1 });
});

test('barProfiles: empty list stays empty', () => {
  assert.deepEqual(barProfiles([]), []);
});

const known = new Set(['Default', 'Profile 3']);

test('parseUiCommand: accepts every well-formed command and keeps only its fields', () => {
  const cases: unknown[] = [
    { type: 'selectProfile', dir: 'Default' },
    { type: 'profileMenu', dir: 'Profile 3' },
    { type: 'addProfileMenu' },
    { type: 'reorderProfile', dir: 'Default', before: 'Profile 3' },
    { type: 'reorderProfile', dir: 'Profile 3', before: null },
    { type: 'selectTab', id: 4 },
    { type: 'closeTab', id: 1 },
    { type: 'newTab' },
    { type: 'navigate', input: 'example.com' },
    { type: 'back' },
    { type: 'forward' },
    { type: 'reload' },
    { type: 'toggleSidebar' },
    { type: 'revealDownload', id: 'd1' },
    { type: 'find', text: 'needle', forward: true },
    { type: 'find', text: '', forward: false },
    { type: 'findClose' },
    { type: 'suggest', seq: 0, text: 'jira' },
    { type: 'historyPage', seq: 3, query: '', before: null },
    { type: 'historyPage', seq: 4, query: 'ho so', before: 1762272000000 },
    { type: 'bookmarks', seq: 7 },
    { type: 'openUrl', url: 'https://a.com/x', newTab: true },
    { type: 'historyMenu', url: 'https://a.com/x' },
    { type: 'bookmarkMenu', id: 5 },
    { type: 'renameBookmark', id: 5, title: 'Sprint board' },
  ];
  for (const c of cases) assert.deepEqual(parseUiCommand(c, known), c);
  assert.deepEqual(parseUiCommand({ type: 'back', extra: 'x' }, known), { type: 'back' });
  assert.deepEqual(parseUiCommand({ type: 'selectTab', id: 2, dir: 'Default' }, known), { type: 'selectTab', id: 2 });
});

test('parseUiCommand: rejects unknown types and non-objects', () => {
  for (const raw of [null, undefined, 'back', 42, [], {}, { type: 'quit' }, { type: 'toString' }, { type: 7 }]) {
    assert.equal(parseUiCommand(raw, known), null, JSON.stringify(raw));
  }
});

test('parseUiCommand: profile commands need a known profile dir', () => {
  assert.equal(parseUiCommand({ type: 'selectProfile', dir: 'Profile 9' }, known), null);
  assert.equal(parseUiCommand({ type: 'selectProfile' }, known), null);
  assert.equal(parseUiCommand({ type: 'profileMenu', dir: 3 }, known), null);
  assert.equal(parseUiCommand({ type: 'selectProfile', dir: '__proto__' }, known), null);
});

test('parseUiCommand: tab ids must be integers', () => {
  for (const id of ['1', 1.5, NaN, Infinity, null, undefined]) {
    assert.equal(parseUiCommand({ type: 'selectTab', id }, known), null, String(id));
    assert.equal(parseUiCommand({ type: 'closeTab', id }, known), null, String(id));
  }
});

test('parseUiCommand: string payloads must be strings', () => {
  assert.equal(parseUiCommand({ type: 'navigate', input: 5 }, known), null);
  assert.equal(parseUiCommand({ type: 'navigate' }, known), null);
  assert.equal(parseUiCommand({ type: 'revealDownload', id: 5 }, known), null);
});

test('parseUiCommand: find needs a string text and a boolean direction', () => {
  assert.equal(parseUiCommand({ type: 'find', text: 5, forward: true }, known), null);
  assert.equal(parseUiCommand({ type: 'find', forward: true }, known), null);
  assert.equal(parseUiCommand({ type: 'find', text: 'x' }, known), null);
  assert.equal(parseUiCommand({ type: 'find', text: 'x', forward: 'yes' }, known), null);
});

test('parseUiCommand: revealDownload needs a non-empty id', () => {
  assert.equal(parseUiCommand({ type: 'revealDownload', id: '' }, known), null);
  assert.equal(parseUiCommand({ type: 'revealDownload' }, known), null);
});

test('parseUiCommand: rejects bad library commands', () => {
  const bad: unknown[] = [
    { type: 'suggest', seq: -1, text: 'x' }, { type: 'suggest', seq: 1.5, text: 'x' }, { type: 'suggest', seq: 1, text: 'x'.repeat(2049) },
    { type: 'historyPage', seq: 1, query: 'x', before: 'yesterday' }, { type: 'historyPage', seq: 1, query: 'x', before: Infinity },
    { type: 'bookmarks' },
    { type: 'openUrl', url: 'javascript:alert(1)', newTab: false }, { type: 'openUrl', url: 'https://a.com' },
    { type: 'historyMenu', url: 'file:///etc/passwd' },
    { type: 'bookmarkMenu', id: 0 }, { type: 'bookmarkMenu', id: '5' },
    { type: 'renameBookmark', id: 5, title: 'x'.repeat(1025) }, { type: 'renameBookmark', id: 5 },
  ];
  for (const c of bad) assert.equal(parseUiCommand(c, known), null, JSON.stringify(c).slice(0, 80));
});

test('parseUiCommand: rejects bad reorderProfile', () => {
  for (const c of [
    { type: 'reorderProfile', dir: 'Default' },                       // before missing
    { type: 'reorderProfile', dir: 'Default', before: 'Profile 9' },  // unknown before
    { type: 'reorderProfile', dir: 'Profile 9', before: null },       // unknown dir
    { type: 'reorderProfile', dir: 'Default', before: 3 },
  ]) assert.equal(parseUiCommand(c, known), null, JSON.stringify(c));
});
