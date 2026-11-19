import test from 'node:test';
import assert from 'node:assert/strict';
import { contextMenuSpec, type MenuItemSpec, type MenuParams } from './contextMenu.ts';

const noEdit = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false };
const params = (p: Partial<MenuParams>): MenuParams =>
  ({ linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false, editFlags: noEdit, ...p });
const ids = (spec: MenuItemSpec[]) => spec.map((i) => i.id);

/** No separator first, last or twice in a row. */
function assertSeparators(spec: MenuItemSpec[]): void {
  assert.notEqual(spec[0]?.id, 'separator');
  assert.notEqual(spec.at(-1)?.id, 'separator');
  spec.forEach((item, i) => {
    if (item.id === 'separator') assert.notEqual(spec[i + 1]?.id, 'separator', `double separator at ${i}`);
  });
}

test('contextMenuSpec: plain page → only Inspect', () => {
  const spec = contextMenuSpec(params({}));
  assert.deepEqual(spec, [{ id: 'inspect', label: 'Inspect' }]);
});

test('contextMenuSpec: link only', () => {
  const spec = contextMenuSpec(params({ linkURL: 'https://example.com/' }));
  assert.deepEqual(spec, [
    { id: 'openLinkInNewTab', label: 'Open Link in New Tab' },
    { id: 'copyLink', label: 'Copy Link Address' },
    { id: 'separator' },
    { id: 'inspect', label: 'Inspect' },
  ]);
  assertSeparators(spec);
});

test('contextMenuSpec: image (also a link) → link group, image group, Inspect', () => {
  const spec = contextMenuSpec(params({ linkURL: 'https://example.com/', srcURL: 'https://example.com/a.png', mediaType: 'image' }));
  assert.deepEqual(ids(spec), ['openLinkInNewTab', 'copyLink', 'separator', 'copyImage', 'saveImage', 'separator', 'inspect']);
  assert.deepEqual(spec.slice(3, 5), [{ id: 'copyImage', label: 'Copy Image' }, { id: 'saveImage', label: 'Save Image As…' }]);
  assertSeparators(spec);
});

test('contextMenuSpec: a video is not an image', () => {
  assert.deepEqual(ids(contextMenuSpec(params({ srcURL: 'https://example.com/v.mp4', mediaType: 'video' }))), ['inspect']);
});

test('contextMenuSpec: selection on a page → Copy and a search, label truncated to 30 characters', () => {
  const spec = contextMenuSpec(params({ selectionText: 'the quick brown fox jumps over the lazy dog', editFlags: { ...noEdit, canCopy: true } }));
  assert.deepEqual(spec, [
    { id: 'copy', label: 'Copy' },
    { id: 'searchSelection', label: 'Search Google for “the quick brown fox jumps over…”' },
    { id: 'separator' },
    { id: 'inspect', label: 'Inspect' },
  ]);
});

test('contextMenuSpec: a short selection is not truncated; whitespace is collapsed', () => {
  const spec = contextMenuSpec(params({ selectionText: '  hello\n\n world ' }));
  assert.deepEqual(spec.find((i) => i.id === 'searchSelection'), { id: 'searchSelection', label: 'Search Google for “hello world”' });
});

test('contextMenuSpec: whitespace-only selection gives no search', () => {
  assert.deepEqual(ids(contextMenuSpec(params({ selectionText: ' \n ' }))), ['inspect']);
});

test('contextMenuSpec: selection in an editable field → edit items per editFlags, search, Inspect', () => {
  const spec = contextMenuSpec(params({
    selectionText: 'hello', isEditable: true,
    editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
  }));
  assert.deepEqual(ids(spec), ['cut', 'copy', 'paste', 'selectAll', 'separator', 'searchSelection', 'separator', 'inspect']);
  assertSeparators(spec);
});

test('contextMenuSpec: empty editable field → only what editFlags allow', () => {
  const spec = contextMenuSpec(params({ isEditable: true, editFlags: { ...noEdit, canPaste: true, canSelectAll: false } }));
  assert.deepEqual(ids(spec), ['paste', 'separator', 'inspect']);
  const none = contextMenuSpec(params({ isEditable: true }));
  assert.deepEqual(ids(none), ['inspect']);
  assertSeparators(none);
});
