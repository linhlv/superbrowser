import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './searchText.ts';
import type { HistoryEntry } from './history.ts';
import { inlineCompletion, rankSuggestions, SUGGESTION_LIMIT } from './suggest.ts';

const now = Date.parse('2025-11-19T12:00:00Z');
function e(url: string, visitCount: number, typedCount: number, daysAgo: number, title = ''): HistoryEntry {
  return { url, title, visitCount, typedCount, lastVisit: now - daysAgo * DAY_MS, favicon: null };
}
const rank = (text: string, history: HistoryEntry[], bookmarks: { url: string; title: string }[] = []) =>
  rankSuggestions({ text, history, bookmarks, now });

test('typed pages rank above untyped ones', () => {
  const r = rank('site', [e('https://a.example/site', 5, 0, 1), e('https://b.example/site', 5, 2, 1)]);
  assert.deepEqual(r.map((s) => s.url), ['https://b.example/site', 'https://a.example/site']);
});

test('a host prefix match beats a title-only match', () => {
  const r = rank('git', [e('https://news.example/a', 5, 0, 1, 'Why git is great'), e('https://github.com/', 2, 0, 1, 'GitHub')]);
  assert.equal(r[0]!.url, 'https://github.com/');
});

test('recent beats old at equal counts', () => {
  const r = rank('page', [e('https://a.example/page', 3, 0, 60), e('https://b.example/page', 3, 0, 1)]);
  assert.equal(r[0]!.url, 'https://b.example/page');
});

test('bookmarks are included, marked, and merged with history by URL', () => {
  const r = rank(
    'jira',
    [e('https://acme.atlassian.net/jira', 4, 0, 2, 'Jira'), e('https://other.example/jira', 1, 0, 2, 'Other jira')],
    [{ url: 'https://acme.atlassian.net/jira', title: 'Bookmark title' }, { url: 'https://never.example/jira', title: 'Never visited jira' }],
  );
  assert.equal(r.length, 3);
  const merged = r.find((s) => s.url === 'https://acme.atlassian.net/jira')!;
  assert.equal(merged.bookmarked, true);
  assert.equal(merged.title, 'Jira');
  const only = r.find((s) => s.url === 'https://never.example/jira')!;
  assert.deepEqual(only, { url: 'https://never.example/jira', title: 'Never visited jira', bookmarked: true });
  assert.equal(r.find((s) => s.url === 'https://other.example/jira')!.bookmarked, false);
  // a bookmark with an empty history title takes the bookmark title
  const r2 = rank('x', [e('https://x.example/', 1, 0, 1)], [{ url: 'https://x.example/', title: 'X site' }]);
  assert.equal(r2[0]!.title, 'X site');
  // a frequently visited page beats a never-visited bookmark
  const r3 = rank('foo', [e('https://a.example/foo', 20, 0, 1)], [{ url: 'https://b.example/foo', title: '' }]);
  assert.equal(r3[0]!.url, 'https://a.example/foo');
});

test('at most 6 rows; every word must match', () => {
  const many = Array.from({ length: 10 }, (_, i) => e(`https://s${i}.example/x`, 1 + i, 0, 1, 'Sprint board — Jira'));
  assert.equal(SUGGESTION_LIMIT, 6);
  assert.equal(rank('jira board', many).length, 6);
  assert.equal(rankSuggestions({ text: 'jira board', history: many, bookmarks: [], now, limit: 3 }).length, 3);
  assert.equal(rank('jira zzz', many).length, 0);
  assert.equal(rank('jira board', [e('https://a.example/', 1, 0, 1, 'Jira only')]).length, 0);
});

test('empty text suggests nothing', () => {
  assert.deepEqual(rank('', [e('https://a.example/', 1, 0, 1)]), []);
  assert.deepEqual(rank('   ', [e('https://a.example/', 1, 0, 1)]), []);
});

test('ties break by visit count then URL', () => {
  const r = rank('zz', [e('https://b.example/zz', 2, 0, 1), e('https://a.example/zz', 2, 0, 1)]);
  assert.deepEqual(r.map((s) => s.url), ['https://a.example/zz', 'https://b.example/zz']);
});

test('inlineCompletion', () => {
  assert.equal(inlineCompletion('acme.at', [e('https://acme.atlassian.net/', 3, 1, 1), e('https://acme.atlassian.net/jira/software', 10, 0, 1)]), 'acme.atlassian.net');
  assert.equal(inlineCompletion('acme.at', [e('https://acme.atlassian.net/jira/software', 10, 0, 1), e('https://acme.atlassian.net/browse/X', 2, 0, 1)]), 'acme.atlassian.net/jira/software');
  assert.equal(inlineCompletion('git', [e('https://www.github.com/', 1, 0, 1)]), 'github.com');
  assert.equal(inlineCompletion('www.git', [e('https://www.github.com/', 1, 0, 1)]), 'www.github.com');
  assert.equal(inlineCompletion('acme.atlassian.net/ji', [e('https://acme.atlassian.net/jira/software', 10, 0, 1)]), 'acme.atlassian.net/jira/software');
  assert.equal(inlineCompletion('a', [e('https://apple.com/', 1, 0, 1), e('https://amazon.com/', 9, 0, 1)]), 'amazon.com');
  for (const t of ['jira board', 'https://ac', 'zzz', 'github.com', ''])
    assert.equal(inlineCompletion(t, [e('https://acme.atlassian.net/', 3, 0, 1), e('https://github.com/', 1, 0, 1)]), null, t);
});

test('inlineCompletion ignores case and non-http entries', () => {
  assert.equal(inlineCompletion('GIT', [e('https://GitHub.com/', 1, 0, 1)]), 'github.com');
  assert.equal(inlineCompletion('fi', [e('file:///etc/hosts', 5, 0, 1), e('ftp://files.example/', 5, 0, 1)]), null);
});
