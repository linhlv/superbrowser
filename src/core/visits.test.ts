import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisitTracker } from './visits.ts';

const A = 'https://a.test/';
const B = 'https://b.test/';
const C = 'https://c.test/';
const D = 'https://d.test/';

test("a new tab's first navigation is a visit; typed is used once", () => {
  const t = new VisitTracker();
  t.opened(1, false);
  t.markTyped(1);
  assert.deepEqual(t.navigated(1, { url: A, index: 0, entries: [A] }), { kind: 'visit', typed: true });
  assert.deepEqual(t.navigated(1, { url: B, index: 1, entries: [A, B] }), { kind: 'visit', typed: false });
});

test("a restored tab's first load is ignored, the next one counts", () => {
  const t = new VisitTracker();
  t.opened(1, true);
  assert.equal(t.navigated(1, { url: A, index: 0, entries: [A] }).kind, 'ignore');
  assert.equal(t.navigated(1, { url: B, index: 1, entries: [A, B] }).kind, 'visit');
});

test('a restored tab consumes its flag even on a non-web first load', () => {
  const t = new VisitTracker();
  t.opened(1, true);
  assert.equal(t.navigated(1, { url: 'about:blank', index: 0, entries: ['about:blank'] }).kind, 'ignore');
  assert.equal(t.navigated(1, { url: A, index: 1, entries: ['about:blank', A] }).kind, 'visit');
});

test('reload and #fragment changes are ignored', () => {
  const t = new VisitTracker();
  t.opened(1, false);
  t.navigated(1, { url: A, index: 0, entries: [A] });
  assert.equal(t.navigated(1, { url: A, index: 0, entries: [A] }).kind, 'ignore');
  assert.equal(t.navigated(1, { url: A + '#x', index: 1, entries: [A, A + '#x'] }).kind, 'ignore');
  assert.equal(t.navigated(1, { url: A + '#y', index: 2, entries: [A, A + '#x', A + '#y'] }).kind, 'ignore');
});

test('back and forward are revisits', () => {
  const t = new VisitTracker();
  t.opened(1, false);
  t.navigated(1, { url: A, index: 0, entries: [A] });
  t.navigated(1, { url: B, index: 1, entries: [A, B] });
  assert.equal(t.navigated(1, { url: A, index: 0, entries: [A, B] }).kind, 'revisit');
  assert.equal(t.navigated(1, { url: B, index: 1, entries: [A, B] }).kind, 'revisit');
});

test('navigating after going back is a visit (forward entries cut)', () => {
  const t = new VisitTracker();
  t.opened(1, false);
  t.navigated(1, { url: C, index: 2, entries: [A, B, C] });
  assert.equal(t.navigated(1, { url: B, index: 1, entries: [A, B, C] }).kind, 'revisit');
  assert.equal(t.navigated(1, { url: D, index: 2, entries: [A, B, D] }).kind, 'visit');
});

test('a redirect or location.replace is a visit', () => {
  const t = new VisitTracker();
  t.opened(1, false);
  t.navigated(1, { url: A, index: 0, entries: [A] });
  assert.equal(t.navigated(1, { url: B, index: 0, entries: [B] }).kind, 'visit');
});

test('non-web pages are ignored', () => {
  const t = new VisitTracker();
  t.opened(1, false);
  assert.equal(t.navigated(1, { url: 'about:blank', index: 0, entries: ['about:blank'] }).kind, 'ignore');
  const e = 'chrome-error://chromewebdata/';
  assert.equal(t.navigated(1, { url: e, index: 1, entries: ['about:blank', e] }).kind, 'ignore');
});

test('typed does not leak from an ignored navigation to the next visit', () => {
  const t = new VisitTracker();
  t.opened(1, false);
  t.navigated(1, { url: A, index: 0, entries: [A] });
  t.markTyped(1);
  assert.deepEqual(t.navigated(1, { url: A, index: 0, entries: [A] }), { kind: 'ignore', typed: false });
  assert.deepEqual(t.navigated(1, { url: B, index: 1, entries: [A, B] }), { kind: 'visit', typed: false });
});

test('a forgotten or unknown tab starts fresh', () => {
  const t = new VisitTracker();
  assert.equal(t.navigated(9, { url: A, index: 0, entries: [A] }).kind, 'visit');
  t.opened(1, true);
  t.forget(1);
  assert.equal(t.navigated(1, { url: A, index: 0, entries: [A] }).kind, 'visit');
  t.forget(1);
  assert.equal(t.navigated(1, { url: A, index: 0, entries: [A] }).kind, 'visit');
});
