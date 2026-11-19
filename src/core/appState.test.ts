import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, decodeState } from './appState.ts';

test('decodeState(undefined) is the default state', () => {
  assert.deepEqual(decodeState(undefined), defaultState());
  assert.deepEqual(decodeState('junk'), defaultState());
  assert.deepEqual(decodeState(null), defaultState());
});

test('bad fields fall back, good ones are kept, tabs are cleaned', () => {
  const s = decodeState({
    sidebarVisible: false,
    showNames: 'yes',
    extra: 1,
    tabs: { Default: { tabs: [{ url: 'https://a' }, 42], activeIndex: 9 } },
  });
  assert.equal(s.sidebarVisible, false);
  assert.equal(s.showNames, false);
  assert.deepEqual(s.tabs['Default'], { tabs: [{ url: 'https://a', title: '' }], activeIndex: 0 });
  assert.equal('extra' in s, false);
});

test('activeIndex clamps and empty tabs give 0', () => {
  const s = decodeState({ tabs: {
    A: { tabs: [{ url: 'u', title: 't' }, { url: 'v', title: 'w' }], activeIndex: 1 },
    B: { tabs: [], activeIndex: 5 },
    C: { tabs: [{ url: 'u', title: 't' }], activeIndex: -3 },
    D: 'bad',
  } });
  assert.equal(s.tabs['A']!.activeIndex, 1);
  assert.equal(s.tabs['B']!.activeIndex, 0);
  assert.equal(s.tabs['C']!.activeIndex, 0);
  assert.equal('D' in s.tabs, false);
});

test('lists, profiles, bounds, permissions are validated', () => {
  const s = decodeState({
    version: 7,
    activeProfile: 5,
    profileOrder: ['a', 1, 'b'],
    hiddenProfiles: 'x',
    knownProfiles: [{ dir: 'Default', name: 'P', color: '#000000' }, { dir: 'x' }, null],
    windowBounds: { x: 1, y: 2, width: 3, height: NaN },
    permissions: { Default: { 'https://a': { camera: 'allow', mic: 'maybe', geo: 'deny' }, bad: 3 }, X: 1 },
    firstRunDone: true,
  });
  assert.equal(s.activeProfile, null);
  assert.deepEqual(s.profileOrder, ['a', 'b']);
  assert.deepEqual(s.hiddenProfiles, []);
  assert.deepEqual(s.knownProfiles, [{ dir: 'Default', name: 'P', color: '#000000' }]);
  assert.equal(s.windowBounds, null);
  assert.deepEqual(s.permissions['Default']!['https://a'], { camera: 'allow', geo: 'deny' });
  assert.equal(s.firstRunDone, true);
  assert.equal(decodeState({ activeProfile: 'Default', windowBounds: { x: 1, y: 2, width: 3, height: 4 } }).windowBounds!.height, 4);
  assert.equal(decodeState({ activeProfile: 'Default' }).activeProfile, 'Default');
});

test('decodeState: openSections is tolerant', () => {
  assert.deepEqual(decodeState({}).openSections, []);
  assert.deepEqual(decodeState({ openSections: 'history' }).openSections, []);
  assert.deepEqual(decodeState({ openSections: ['history', 'history', 'x', 3, 'bookmarks'] }).openSections, ['bookmarks', 'history']);
  assert.equal(decodeState({ openSections: 'bad', showNames: true }).showNames, true);
});

test('decodeState: displayNames keeps non-empty strings, normalized', () => {
  const s = decodeState({ displayNames: { Default: '  ACME ', 'Profile 3': 5, 'Profile 4': '   ' } });
  assert.deepEqual(s.displayNames, { Default: 'ACME' });
  assert.deepEqual(decodeState({ displayNames: 'bad' }).displayNames, {});
});

test('decodeState: pins decode tolerantly', () => {
  assert.deepEqual(decodeState({ pins: [{ dir: 'A', url: 'https://a.com' }] }).pins, [{ dir: 'A', url: 'https://a.com', title: '', favicon: null }]);
  assert.deepEqual(decodeState({ pins: 7 }).pins, []);
});
