import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebUrl, toNavigableUrl } from './address.ts';

const cases: [string, string | null][] = [
  ['', null], ['   ', null],
  ['https://mail.google.com/x', 'https://mail.google.com/x'],
  ['example.com', 'https://example.com'],
  ['docs.google.com/document/d/1', 'https://docs.google.com/document/d/1'],
  ['localhost:3000', 'http://localhost:3000'],
  ['localhost', 'http://localhost'],
  ['192.168.1.10/admin', 'http://192.168.1.10/admin'],
  ['about:blank', 'about:blank'],
  ['file:///Users/x/a.pdf', 'file:///Users/x/a.pdf'],
  ['foo bar.com', 'https://www.google.com/search?q=foo%20bar.com'],
  ['hello', 'https://www.google.com/search?q=hello'],
  ['c++ tutorial', 'https://www.google.com/search?q=c%2B%2B%20tutorial'],
];
for (const [input, want] of cases) test(`toNavigableUrl(${JSON.stringify(input)})`, () => assert.equal(toNavigableUrl(input), want));

test('isWebUrl: only parseable http(s) URLs', () => {
  for (const u of ['https://a.com', 'http://localhost:3000/x', 'HTTPS://A.COM/']) assert.equal(isWebUrl(u), true);
  for (const u of ['about:blank', 'data:text/html,x', 'javascript:alert(1)', 'chrome://history', 'file:///etc', 'https://', '', 'not a url'])
    assert.equal(isWebUrl(u), false);
});
