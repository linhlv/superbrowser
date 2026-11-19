import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionToggle, withSection } from './sections.ts';

test('withSection keeps SECTIONS order and no duplicates', () => {
  assert.deepEqual(withSection([], 'history', true), ['history']);
  assert.deepEqual(withSection(['history'], 'bookmarks', true), ['bookmarks', 'history']);
  assert.deepEqual(withSection(['bookmarks', 'history'], 'history', true), ['bookmarks', 'history']);
  assert.deepEqual(withSection(['bookmarks', 'history'], 'bookmarks', false), ['history']);
  assert.deepEqual(withSection([], 'history', false), []);
});
test('sectionToggle: toggle opens a folded section and folds an open one', () => {
  assert.deepEqual(sectionToggle([], 'history', 'toggle', null, false),
    { open: ['history'], request: { panel: 'history', open: true, highlight: null } });
  assert.deepEqual(sectionToggle(['bookmarks', 'history'], 'history', 'toggle', null, false),
    { open: ['bookmarks'], request: { panel: 'history', open: false, highlight: null } });
});
test('sectionToggle: a revealed sidebar never folds', () => {
  assert.deepEqual(sectionToggle(['history'], 'history', 'toggle', null, true),
    { open: ['history'], request: { panel: 'history', open: true, highlight: null } });
});
test('sectionToggle: show always opens and carries the highlight', () => {
  assert.deepEqual(sectionToggle(['bookmarks'], 'bookmarks', 'show', 7, false),
    { open: ['bookmarks'], request: { panel: 'bookmarks', open: true, highlight: 7 } });
});
