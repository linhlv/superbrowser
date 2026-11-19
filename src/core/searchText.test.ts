import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchKey, splitWords, matchesAll, dayOf, dayLabel, DAY_MS } from './searchText.ts';

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
test('dayLabel: Today, Yesterday, else the formatted local day', () => {
  const fmt = (tz: number) => (ms: number) => `day ${dayOf(ms, tz)}`;
  for (const tz of [0, -420, 300, 840, -720]) {
    assert.equal(dayLabel(20_000, 20_000, tz, fmt(tz)), 'Today');
    assert.equal(dayLabel(19_999, 20_000, tz, fmt(tz)), 'Yesterday');
    assert.equal(dayLabel(19_998, 20_000, tz, fmt(tz)), 'day 19998', `tz ${tz}`);
    assert.equal(dayLabel(19_000, 20_000, tz, fmt(tz)), 'day 19000', `tz ${tz}`);
  }
});
