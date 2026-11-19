import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchKey, splitWords, matchesAll, dayOf, DAY_MS } from './searchText.ts';

test('searchKey lowercases and strips Vietnamese diacritics', () => {
  assert.equal(searchKey('Nguyễn Thị Đà Nẵng'), 'nguyen thi da nang');
});
test('splitWords drops empties', () => {
  assert.deepEqual(splitWords('  Hồ   sơ '), ['ho', 'so']);
  assert.deepEqual(splitWords('   '), []);
});
test('matchesAll needs every word', () => {
  assert.equal(matchesAll('jira acme', ['jira', 'acm']), true);
  assert.equal(matchesAll('jira acme', ['jira', 'x']), false);
});
test('dayOf floors, honouring the timezone offset and negatives', () => {
  assert.equal(dayOf(DAY_MS + 5, 0), 1);
  assert.equal(dayOf(-1, 0), -1);
  assert.equal(dayOf(DAY_MS, 60), 0); // UTC-1: still the previous local day
  assert.equal(dayOf(DAY_MS - 1, -60), 1); // UTC+1
});
