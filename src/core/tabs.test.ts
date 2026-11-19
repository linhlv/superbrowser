import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTabs, openTab, closeTab, reopenClosed, activateTab, updateTab, tabIdForShortcut, toSaved, fromSaved,
  type ProfileTabs, type TabRecord,
} from './tabs.ts';

const t = (id: number, url = `https://site${id}.test/`, title = `T${id}`): TabRecord => ({ id, url, title });
const ids = (s: ProfileTabs) => s.tabs.map((x) => x.id);

function three(): ProfileTabs {
  let s = emptyTabs();
  for (const id of [1, 2, 3]) s = openTab(s, t(id), { activate: id === 1 });
  return s;
}

test('emptyTabs', () => {
  assert.deepEqual(emptyTabs(), { tabs: [], activeId: null, closed: [] });
});

test('openTab appends, activates on request and does not mutate', () => {
  const s0 = emptyTabs();
  const s1 = openTab(s0, t(1), { activate: true });
  const s2 = openTab(s1, t(2), { activate: false });
  assert.deepEqual(ids(s2), [1, 2]);
  assert.equal(s2.activeId, 1);
  assert.deepEqual(s0, emptyTabs());
  assert.deepEqual(ids(s1), [1]);
});

test('openTab with afterId inserts right after it', () => {
  const s = openTab(three(), t(4), { activate: true, afterId: 1 });
  assert.deepEqual(ids(s), [1, 4, 2, 3]);
  assert.equal(s.activeId, 4);
});

test('openTab with an unknown afterId appends', () => {
  assert.deepEqual(ids(openTab(three(), t(4), { activate: false, afterId: 99 })), [1, 2, 3, 4]);
});

test('closeTab of the active tab activates the right neighbour', () => {
  const s = closeTab(activateTab(three(), 2), 2);
  assert.deepEqual(ids(s), [1, 3]);
  assert.equal(s.activeId, 3);
});

test('closeTab of the last active tab activates the left neighbour', () => {
  const s = closeTab(activateTab(three(), 3), 3);
  assert.equal(s.activeId, 2);
});

test('closeTab of the only tab leaves no active tab', () => {
  const s = closeTab(openTab(emptyTabs(), t(1), { activate: true }), 1);
  assert.deepEqual(s.tabs, []);
  assert.equal(s.activeId, null);
});

test('closeTab of an inactive tab keeps the active one', () => {
  const s = closeTab(three(), 3);
  assert.equal(s.activeId, 1);
});

test('closeTab pushes to the closed stack; unknown id is a no-op', () => {
  const s = closeTab(three(), 2);
  assert.deepEqual(s.closed, [t(2)]);
  assert.deepEqual(closeTab(s, 99), s);
});

test('closed stack keeps the newest 25 and reopenClosed pops newest first', () => {
  let s = emptyTabs();
  for (let id = 1; id <= 30; id++) s = openTab(s, t(id), { activate: true });
  for (let id = 1; id <= 30; id++) s = closeTab(s, id);
  assert.equal(s.closed.length, 25);
  assert.deepEqual(s.closed.map((x) => x.id), Array.from({ length: 25 }, (_, i) => i + 6));

  const r1 = reopenClosed(s);
  assert.ok(r1);
  assert.equal(r1.tab.id, 30);
  const r2 = reopenClosed(r1.state);
  assert.ok(r2);
  assert.equal(r2.tab.id, 29);
  assert.deepEqual(ids(r2.state), [30, 29]);
  assert.equal(r2.state.activeId, 29);
  assert.equal(r2.state.closed.length, 23);
});

test('reopenClosed re-adds at the end, activated; null when nothing closed', () => {
  assert.equal(reopenClosed(three()), null);
  const r = reopenClosed(closeTab(three(), 1));
  assert.ok(r);
  assert.deepEqual(ids(r.state), [2, 3, 1]);
  assert.equal(r.state.activeId, 1);
  assert.deepEqual(r.state.closed, []);
});

test('activateTab ignores unknown ids', () => {
  assert.equal(activateTab(three(), 3).activeId, 3);
  assert.equal(activateTab(three(), 99).activeId, 1);
});

test('updateTab patches url and title', () => {
  const s = updateTab(three(), 2, { title: 'New' });
  assert.deepEqual(s.tabs[1], { id: 2, url: 'https://site2.test/', title: 'New' });
  assert.deepEqual(updateTab(s, 2, { url: 'https://x.test/' }).tabs[1], { id: 2, url: 'https://x.test/', title: 'New' });
});

test('tabIdForShortcut: 1–8 by position, 9 = last', () => {
  const s = three();
  assert.equal(tabIdForShortcut(s, 1), 1);
  assert.equal(tabIdForShortcut(s, 3), 3);
  assert.equal(tabIdForShortcut(s, 5), null);
  assert.equal(tabIdForShortcut(s, 8), null);
  assert.equal(tabIdForShortcut(s, 9), 3);
  assert.equal(tabIdForShortcut(emptyTabs(), 9), null);
});

test('tabIdForShortcut: 8 picks the eighth tab', () => {
  let s = emptyTabs();
  for (let id = 1; id <= 10; id++) s = openTab(s, t(id), { activate: false });
  assert.equal(tabIdForShortcut(s, 8), 8);
  assert.equal(tabIdForShortcut(s, 9), 10);
});

test('toSaved / fromSaved round trip with activeIndex → activeId', () => {
  const s = activateTab(three(), 2);
  const saved = toSaved(s);
  assert.deepEqual(saved, {
    tabs: [
      { url: 'https://site1.test/', title: 'T1' },
      { url: 'https://site2.test/', title: 'T2' },
      { url: 'https://site3.test/', title: 'T3' },
    ],
    activeIndex: 1,
  });
  let next = 100;
  const back = fromSaved(saved, () => next++);
  assert.deepEqual(back.tabs, [t(100, 'https://site1.test/', 'T1'), t(101, 'https://site2.test/', 'T2'), t(102, 'https://site3.test/', 'T3')]);
  assert.equal(back.activeId, 101);
  assert.deepEqual(back.closed, []);
  assert.deepEqual(toSaved(back), saved);
});

test('toSaved / fromSaved of an empty profile', () => {
  assert.deepEqual(toSaved(emptyTabs()), { tabs: [], activeIndex: 0 });
  assert.deepEqual(fromSaved({ tabs: [], activeIndex: 0 }, () => 1), emptyTabs());
});

test('fromSaved clamps an out-of-range activeIndex', () => {
  let next = 1;
  const s = fromSaved({ tabs: [{ url: 'a', title: '' }, { url: 'b', title: '' }], activeIndex: 7 }, () => next++);
  assert.equal(s.activeId, 2);
});
