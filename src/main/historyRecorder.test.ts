import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Nav } from '../core/visits.ts';
import { HistoryRecorder } from './historyRecorder.ts';
import { Library } from './library.ts';

const T0 = 1_800_000_000_000;
let base: string;
let library: Library;
let logs: string[];
let now: number;
let recorder: HistoryRecorder;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sb-recorder-'));
  now = T0;
  logs = [];
  library = new Library(base, () => {}, () => now);
  recorder = new HistoryRecorder(library, (m) => logs.push(m), () => now);
});
afterEach(() => {
  library.closeAll();
  rmSync(base, { recursive: true, force: true });
});

const entry = (url: string) => library.history('Default').candidates([new URL(url).hostname], 10).find((e) => e.url === url);
const nav = (url: string, index: number, entries: string[]): Nav => ({ url, index, entries });

test('a new navigation records a visit, typed when marked', () => {
  recorder.opened('Default', 1, false);
  recorder.markTyped(1);
  recorder.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/']));
  now += 1000;
  recorder.navigated('Default', 1, nav('https://b.test/', 1, ['https://a.test/', 'https://b.test/']));
  assert.equal(entry('https://a.test/')?.visitCount, 1);
  assert.equal(entry('https://a.test/')?.typedCount, 1);
  assert.equal(entry('https://a.test/')?.lastVisit, T0);
  assert.equal(entry('https://b.test/')?.visitCount, 1);
  assert.equal(entry('https://b.test/')?.typedCount, 0);
});

test('Back only refreshes the last visit', () => {
  recorder.opened('Default', 1, false);
  recorder.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/']));
  recorder.navigated('Default', 1, nav('https://b.test/', 1, ['https://a.test/', 'https://b.test/']));
  now += 5000;
  recorder.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/', 'https://b.test/']));
  assert.equal(entry('https://a.test/')?.visitCount, 1);
  assert.equal(entry('https://a.test/')?.lastVisit, T0 + 5000);
});

test('the first load of a restored tab is not a visit', () => {
  recorder.opened('Default', 1, true);
  recorder.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/']));
  assert.equal(entry('https://a.test/'), undefined);
  recorder.navigated('Default', 1, nav('https://b.test/', 1, ['https://a.test/', 'https://b.test/']));
  assert.equal(entry('https://b.test/')?.visitCount, 1);
});

test('titles and favicons go to that URL in that profile', () => {
  recorder.opened('Default', 1, false);
  recorder.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/']));
  recorder.titled('Default', 'https://a.test/', 'Acme');
  recorder.favicon('Default', 'https://a.test/', 'https://a.test/favicon.ico');
  assert.equal(entry('https://a.test/')?.title, 'Acme');
  assert.equal(entry('https://a.test/')?.favicon, 'https://a.test/favicon.ico');
});

test('titles and favicons of non-web pages never reach the library', () => {
  let calls = 0;
  const counting = { history: () => { calls++; return library.history('Default'); } };
  const r = new HistoryRecorder(counting, (m) => logs.push(m), () => now);
  r.titled('Default', 'about:blank', 'Blank');
  r.favicon('Default', 'file:///tmp/x.html', 'data:image/png;base64,AA==');
  assert.equal(calls, 0);
});

test('closed forgets the tab', () => {
  recorder.opened('Default', 1, true);
  recorder.closed(1);
  // A forgotten tab starts over as not restored, so this load counts.
  recorder.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/']));
  assert.equal(entry('https://a.test/')?.visitCount, 1);
});

test('library errors are logged, never thrown', () => {
  const broken = { history: (): never => { throw new Error('disk on fire'); } };
  const r = new HistoryRecorder(broken, (m) => logs.push(m), () => now);
  r.opened('Default', 1, false);
  r.markTyped(1);
  assert.doesNotThrow(() => r.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/'])));
  assert.doesNotThrow(() => r.navigated('Default', 1, nav('https://b.test/', 1, ['https://a.test/', 'https://b.test/'])));
  assert.doesNotThrow(() => r.navigated('Default', 1, nav('https://a.test/', 0, ['https://a.test/', 'https://b.test/'])));
  assert.doesNotThrow(() => r.titled('Default', 'https://a.test/', 'A'));
  assert.doesNotThrow(() => r.favicon('Default', 'https://a.test/', 'https://a.test/f.ico'));
  assert.doesNotThrow(() => r.closed(1));
  assert.equal(logs.length, 5);
  assert.ok(logs.every((m) => m.includes('disk on fire')), logs.join('\n'));
});

test('onRecorded reports the profile of each recorded visit, revisit and title, not favicons or restored loads', () => {
  const seen: string[] = [];
  recorder.onRecorded = (dir) => seen.push(dir);
  recorder.opened('Profile 2', 1, true);
  recorder.navigated('Profile 2', 1, nav('https://a.test/', 0, ['https://a.test/'])); // restored: not a visit
  assert.deepEqual(seen, []);
  recorder.navigated('Profile 2', 1, nav('https://b.test/', 1, ['https://a.test/', 'https://b.test/']));
  recorder.navigated('Profile 2', 1, nav('https://a.test/', 0, ['https://a.test/', 'https://b.test/'])); // Back
  recorder.titled('Profile 2', 'https://b.test/', 'B');
  recorder.favicon('Profile 2', 'https://b.test/', 'https://b.test/favicon.ico');
  recorder.titled('Default', 'about:blank', 'New Tab'); // not a web page: nothing recorded
  assert.deepEqual(seen, ['Profile 2', 'Profile 2', 'Profile 2']);
});

test('savedFavicon: the page’s or its origin’s recorded icon, per profile; null when unknown or failing', () => {
  recorder.opened('Default', 1, false);
  recorder.navigated('Default', 1, nav('https://a.test/x', 0, ['https://a.test/x']));
  recorder.favicon('Default', 'https://a.test/x', 'https://a.test/icon.png');
  assert.equal(recorder.savedFavicon('Default', 'https://a.test/x'), 'https://a.test/icon.png');
  assert.equal(recorder.savedFavicon('Default', 'https://a.test/other'), 'https://a.test/icon.png');
  assert.equal(recorder.savedFavicon('Profile 2', 'https://a.test/x'), null, 'another profile has its own history');
  assert.equal(recorder.savedFavicon('Default', 'about:blank'), null);
  const broken = new HistoryRecorder({ history: (): never => { throw new Error('disk on fire'); } }, (m) => logs.push(m), () => now);
  assert.equal(broken.savedFavicon('Default', 'https://a.test/x'), null);
  assert.ok(logs.some((m) => m.includes('disk on fire')));
});
