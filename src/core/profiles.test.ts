import test from 'node:test';
import assert from 'node:assert/strict';
import { argbToHex, parseLocalState, mergeProfiles, arrangeProfiles } from './profiles.ts';
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
