import test from 'node:test';
import assert from 'node:assert/strict';
import { argbToHex, parseLocalState, mergeProfiles, arrangeProfiles, moveProfile, placeProfile, hideProfile, hidesEveryProfile, initials, normalizeDisplayName, setDisplayName, profileLabel, withDisplayNames } from './profiles.ts';
import type { Profile } from '../shared/types.ts';

const p = (dir: string, name = dir, color = '#808080'): Profile => ({ dir, name, color });

test('argbToHex', () => {
  assert.equal(argbToHex(-16777216), '#000000');
  assert.equal(argbToHex(-1), '#ffffff');
  assert.equal(argbToHex(0x112233), '#112233');
});

const fixture = JSON.stringify({
  profile: {
    profiles_order: ['Profile 37', 'Default'],
    info_cache: {
      'Default': { name: 'Personal', profile_color_seed: -16776961 },
      'Profile 37': { name: 'NSM Infosys', default_avatar_fill_color: -3355444 },
      'Profile 9': { name: 'alpha' },
      '.chrome': { name: 'Your Chrome' },
    },
  },
});

test('parseLocalState orders, colors, filters to existing dirs', () => {
  const got = parseLocalState(fixture, new Set(['Default', 'Profile 37', '.chrome']));
  assert.deepEqual(got, [p('Profile 37', 'NSM Infosys', '#cccccc'), p('Default', 'Personal', '#0000ff')]);
});

test('parseLocalState appends unordered profiles with fallback color', () => {
  const got = parseLocalState(fixture, new Set(['Default', 'Profile 37', 'Profile 9']));
  assert.deepEqual(got.map((x) => x.dir), ['Profile 37', 'Default', 'Profile 9']);
  assert.equal(got[2].color, '#808080');
});

test('parseLocalState sorts remaining by name case-insensitively, dedupes order, name defaults to dir', () => {
  const json = JSON.stringify({ profile: { profiles_order: ['B', 'B'], info_cache: {
    B: { name: 'b' }, C: { name: 'Charlie' }, A: { name: 'alpha' }, D: {},
  } } });
  const got = parseLocalState(json, new Set(['A', 'B', 'C', 'D']));
  assert.deepEqual(got.map((x) => x.dir), ['B', 'A', 'C', 'D']);
  assert.equal(got[3].name, 'D');
});

test('parseLocalState throws on invalid JSON or missing info_cache', () => {
  assert.throws(() => parseLocalState('{nope', new Set()));
  assert.throws(() => parseLocalState('{}', new Set()));
  assert.throws(() => parseLocalState('{"profile":{}}', new Set()));
});

test('mergeProfiles keeps known when Chrome gives null or empty', () => {
  const known = [p('A'), p('B')];
  assert.deepEqual(mergeProfiles(null, known), known);
  assert.deepEqual(mergeProfiles([], known), known);
  assert.deepEqual(mergeProfiles([], []), []);
});

test('mergeProfiles takes renames from Chrome and keeps deleted ones at the end', () => {
  const known = [p('A', 'old'), p('B'), p('C')];
  const got = mergeProfiles([p('C', 'C2', '#111111'), p('A', 'new')], known);
  assert.deepEqual(got, [p('C', 'C2', '#111111'), p('A', 'new'), p('B')]);
});

test('arrangeProfiles applies order and hidden', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  const got = arrangeProfiles(all, ['C', 'Z', 'A'], ['A', 'D']);
  assert.deepEqual(got.visible.map((x) => x.dir), ['C', 'B']);
  assert.deepEqual(got.hidden.map((x) => x.dir), ['A', 'D']);
});

test('moveProfile swaps with the visible neighbour and returns the full order', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  assert.deepEqual(moveProfile(all, [], [], 'B', 1), ['A', 'C', 'B', 'D']);
  assert.deepEqual(moveProfile(all, [], [], 'B', -1), ['B', 'A', 'C', 'D']);
  assert.deepEqual(moveProfile(all, ['C', 'A'], [], 'A', -1), ['A', 'C', 'B', 'D']);
});

test('moveProfile skips hidden profiles, which keep their places', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  // visible: A, C, D — moving A right swaps it with C; hidden B stays second.
  assert.deepEqual(moveProfile(all, [], ['B'], 'A', 1), ['C', 'B', 'A', 'D']);
  assert.deepEqual(moveProfile(all, [], ['B'], 'C', -1), ['C', 'B', 'A', 'D']);
});

test('moveProfile drops unknown dirs from the saved order', () => {
  assert.deepEqual(moveProfile([p('A'), p('B')], ['Z', 'B'], [], 'A', -1), ['A', 'B']);
});

test('moveProfile is null at either end, for hidden or unknown profiles', () => {
  const all = [p('A'), p('B'), p('C')];
  assert.equal(moveProfile(all, [], [], 'A', -1), null);
  assert.equal(moveProfile(all, [], [], 'C', 1), null);
  assert.equal(moveProfile(all, [], ['C'], 'B', 1), null);
  assert.equal(moveProfile(all, [], ['B'], 'B', 1), null);
  assert.equal(moveProfile(all, [], [], 'Z', 1), null);
});

test('hideProfile adds a visible profile to the hidden list', () => {
  const all = [p('A'), p('B'), p('C')];
  assert.deepEqual(hideProfile(all, ['A'], 'B'), ['A', 'B']);
  assert.deepEqual(hideProfile(all, [], 'C'), ['C']);
});

test('hideProfile is null for the last visible profile, a hidden one or an unknown one', () => {
  const all = [p('A'), p('B'), p('C')];
  assert.equal(hideProfile(all, ['A', 'B'], 'C'), null);
  assert.equal(hideProfile([p('A')], [], 'A'), null);
  assert.equal(hideProfile(all, ['A'], 'A'), null);
  assert.equal(hideProfile(all, [], 'Z'), null);
});

test('hidesEveryProfile is true only when every known profile is hidden', () => {
  const all = [p('A'), p('B')];
  assert.equal(hidesEveryProfile(all, ['A', 'B']), true);
  assert.equal(hidesEveryProfile(all, ['B', 'Z', 'A']), true);
  assert.equal(hidesEveryProfile(all, ['A']), false);
  assert.equal(hidesEveryProfile(all, ['Z']), false);
  assert.equal(hidesEveryProfile(all, []), false);
  assert.equal(hidesEveryProfile([], ['A']), false); // nothing known: nothing to show either way
});

test('placeProfile moves a visible profile before another', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  assert.deepEqual(placeProfile(all, [], [], 'D', 'A'), ['D', 'A', 'B', 'C']);
  assert.deepEqual(placeProfile(all, [], [], 'A', 'D'), ['B', 'C', 'A', 'D']);
});

test('placeProfile with before null puts it after the last visible profile', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  assert.deepEqual(placeProfile(all, [], [], 'A', null), ['B', 'C', 'D', 'A']);
});

test('placeProfile keeps hidden profiles in their slots', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  // C hidden at index 2; visible order A,B,D → move D before A → visible D,A,B refilled into slots 0,1,3
  assert.deepEqual(placeProfile(all, [], ['C'], 'D', 'A'), ['D', 'A', 'C', 'B']);
  // before null with the last slot hidden: A moves after D (last visible), C stays at index 3
  assert.deepEqual(placeProfile(all, ['A', 'B', 'D', 'C'], ['C'], 'A', null), ['B', 'D', 'A', 'C']);
});

test('placeProfile returns null when nothing changes or the move is invalid', () => {
  const all = [p('A'), p('B'), p('C'), p('D')];
  assert.equal(placeProfile(all, [], [], 'B', 'C'), null);      // already right before C
  assert.equal(placeProfile(all, [], [], 'D', null), null);     // already last
  assert.equal(placeProfile(all, [], [], 'B', 'B'), null);      // before itself
  assert.equal(placeProfile(all, [], ['C'], 'C', 'A'), null);   // hidden dir
  assert.equal(placeProfile(all, [], ['C'], 'A', 'C'), null);   // hidden before
  assert.equal(placeProfile(all, [], [], 'Z', 'A'), null);      // unknown
});

test('initials: two words give two first letters, one word its first two', () => {
  assert.equal(initials('Client X'), 'CX');
  assert.equal(initials('ACME'), 'AC');
  assert.equal(initials('Me'), 'ME');
  assert.equal(initials('a'), 'A');
  assert.equal(initials('  '), '?');
  assert.equal(initials('😀 Team'), '😀T');      // whole code points
  assert.equal(initials('😀'), '😀');
});
test('normalizeDisplayName: trims, collapses spaces, cuts to 40 code points', () => {
  assert.equal(normalizeDisplayName('  ACME   Corp '), 'ACME Corp');
  assert.equal(normalizeDisplayName('   '), '');
  assert.equal(normalizeDisplayName('x'.repeat(200)).length, 40);
  assert.equal(Array.from(normalizeDisplayName('😀'.repeat(50))).length, 40);
});
test('setDisplayName: sets, and clears on empty', () => {
  assert.deepEqual(setDisplayName({}, 'Default', ' ACME '), { Default: 'ACME' });
  assert.deepEqual(setDisplayName({ Default: 'ACME' }, 'Default', '  '), {});
});
test('profileLabel / withDisplayNames: display name wins, Chrome name otherwise', () => {
  const p = { dir: 'Default', name: 'Person 1', color: '#123456' };
  assert.equal(profileLabel(p, {}), 'Person 1');
  assert.equal(profileLabel(p, { Default: 'ACME' }), 'ACME');
  assert.equal(profileLabel({ ...p, dir: 'toString' }, {}), 'Person 1');
  assert.deepEqual(withDisplayNames([p], { Default: 'ACME' }), [{ ...p, name: 'ACME' }]);
});
test('initials: keeps a ZWJ emoji and a combining accent whole', () => {
  assert.equal(initials('👨‍👩‍👧 Family'), '👨‍👩‍👧F');
  assert.equal(initials('école'), 'ÉC');
  assert.equal(initials('🇻🇳 Viet'), '🇻🇳V');
});
