import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPin, decodePins, keyOf, movePin, pinKey, pinTarget, rememberShown, withFavicon } from './pins.ts';
import type { Pin } from './pins.ts';

const pin = (dir: string, url: string, title = 't'): Pin => ({ dir, url, title, favicon: null });
const tabs = [{ id: 1, url: 'https://www.google.com/' }, { id: 2, url: 'https://mail.google.com/a' }, { id: 3, url: 'https://mail.google.com/b' }];

test('pinKey: http(s) host only, exact host', () => {
  assert.equal(pinKey('Default', 'https://Mail.Google.com/x'), 'Default|mail.google.com');
  assert.equal(pinKey('Default', 'http://localhost:3000/'), 'Default|localhost:3000');
  assert.equal(pinKey('Default', 'file:///etc'), null);
  assert.equal(pinKey('Default', 'not a url'), null);
});
test('addPin: appends, and updates an existing key in place', () => {
  const a = addPin([], pin('A', 'https://mail.google.com/1', 'one'));
  const b = addPin(addPin(a, pin('B', 'https://slack.com/')), pin('A', 'https://mail.google.com/2', 'two'));
  assert.deepEqual(b.map((p) => [p.dir, p.url, p.title]), [['A', 'https://mail.google.com/2', 'two'], ['B', 'https://slack.com/', 't']]);
  assert.equal(addPin(a, pin('A', 'about:blank')), a);
});
test('movePin: skips pins of hidden profiles, null at the ends', () => {
  const ps = [pin('A', 'https://a.com'), pin('H', 'https://h.com'), pin('B', 'https://b.com')];
  const shown = new Set(['A', 'B']);
  assert.deepEqual(movePin(ps, 'A|a.com', 1, shown)!.map(keyOf), ['H|h.com', 'B|b.com', 'A|a.com']);
  assert.equal(movePin(ps, 'A|a.com', -1, shown), null);
  assert.equal(movePin(ps, 'nope', 1, shown), null);
  assert.deepEqual(movePin(ps, 'B|b.com', -1, shown)!.map(keyOf), ['B|b.com', 'A|a.com', 'H|h.com']);
});
test('decodePins: drops bad entries, keeps first duplicate', () => {
  const out = decodePins([
    { dir: 'A', url: 'https://mail.google.com/1', title: 'Mail', favicon: 'https://x/f.ico' },
    { dir: 'A', url: 'https://mail.google.com/2' },
    { dir: 'A', url: 'javascript:alert(1)' }, { url: 'https://b.com' }, 'junk',
    { dir: 'B', url: 'https://b.com', favicon: 5 },
  ]);
  assert.deepEqual(out, [
    { dir: 'A', url: 'https://mail.google.com/1', title: 'Mail', favicon: 'https://x/f.ico' },
    { dir: 'B', url: 'https://b.com', title: '', favicon: null },
  ]);
  assert.deepEqual(decodePins('bad'), []);
});
test('pinTarget: remembered tab on the host wins', () => {
  assert.deepEqual(pinTarget(pin('A', 'https://mail.google.com/'), tabs, 3), { kind: 'tab', id: 3 });
});
test('pinTarget: falls back when the remembered tab left the host', () => {
  const moved = [{ id: 3, url: 'https://news.com/' }, ...tabs.slice(0, 2)];
  assert.deepEqual(pinTarget(pin('A', 'https://mail.google.com/'), moved, 3), { kind: 'tab', id: 2 });
  assert.deepEqual(pinTarget(pin('A', 'https://mail.google.com/'), tabs, 99), { kind: 'tab', id: 2 });
});
test('pinTarget: opens the pin url when no tab is on the host', () => {
  assert.deepEqual(pinTarget(pin('A', 'https://slack.com/x'), tabs, null), { kind: 'open', url: 'https://slack.com/x' });
  assert.deepEqual(pinTarget(pin('A', 'https://google.com/'), tabs, null), { kind: 'open', url: 'https://google.com/' });
});
test('rememberShown: records the shown tab for a pinned host only', () => {
  const ps = [pin('A', 'https://mail.google.com/')];
  const m = rememberShown(new Map(), ps, { dir: 'A', tabId: 3, url: 'https://mail.google.com/b' });
  assert.deepEqual([...m], [['A|mail.google.com', 3]]);
  assert.deepEqual([...rememberShown(m, ps, { dir: 'A', tabId: 1, url: 'https://www.google.com/' })], [['A|mail.google.com', 3]]);
  assert.deepEqual([...rememberShown(m, ps, { dir: 'B', tabId: 7, url: 'https://mail.google.com/' })], [['A|mail.google.com', 3]]);
});
test('withFavicon: same array when unchanged, null never clears', () => {
  const ps = [{ ...pin('A', 'https://a.com'), favicon: 'https://a.com/f.ico' }];
  assert.equal(withFavicon(ps, 'A|a.com', 'https://a.com/f.ico'), ps);
  assert.equal(withFavicon(ps, 'A|a.com', null), ps);
  assert.equal(withFavicon(ps, 'A|a.com', 'https://a.com/g.ico')[0]!.favicon, 'https://a.com/g.ico');
});
