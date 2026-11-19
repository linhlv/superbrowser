import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTabs, openTab, closeTab, reopenClosed, activateTab, updateTab, tabIdForShortcut, toSaved, fromSaved,
  popupWindowOptions, windowOpenTarget, isOpenableLink, PAGE_WEB_PREFERENCES, sameSavedTabs, popupTitle,
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

test('popupWindowOptions: a popup opens in the opener profile session (Review Focus #1)', () => {
  const o = popupWindowOptions('Profile 36');
  assert.equal(o.webPreferences.partition, 'persist:Profile 36');
  assert.equal(o.webPreferences.nodeIntegrationInSubFrames, true);
  assert.deepEqual(o, {
    width: 520,
    height: 680,
    webPreferences: { partition: 'persist:Profile 36', sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true },
  });
  assert.equal(popupWindowOptions('Default').webPreferences.partition, 'persist:Default');
});

test('popupWindowOptions: same page preferences as tab views', () => {
  const { partition, ...rest } = popupWindowOptions('Profile 1').webPreferences;
  assert.equal(partition, 'persist:Profile 1');
  assert.deepEqual(rest, PAGE_WEB_PREFERENCES);
});

const open = (disposition: Parameters<typeof windowOpenTarget>[0]['disposition'], features = '', url = 'https://example.com/x') =>
  windowOpenTarget({ url, disposition, features });

test('windowOpenTarget: links become tabs (⌘-click in the background)', () => {
  assert.deepEqual(open('foreground-tab'), { kind: 'tab', activate: true });
  assert.deepEqual(open('background-tab'), { kind: 'tab', activate: false });
  assert.deepEqual(open('new-window'), { kind: 'tab', activate: true }); // ⇧-click: no features
  assert.deepEqual(open('default'), { kind: 'tab', activate: true });
  assert.deepEqual(open('other'), { kind: 'tab', activate: true });
});

test('windowOpenTarget: window.open with features is a popup (keeps window.opener, e.g. OAuth)', () => {
  assert.deepEqual(open('new-window', 'width=500,height=600'), { kind: 'popup' });
  assert.deepEqual(open('new-window', 'popup'), { kind: 'popup' });
});

test('windowOpenTarget: a blank window is a popup (its opener fills it in)', () => {
  assert.deepEqual(open('foreground-tab', '', 'about:blank'), { kind: 'popup' });
  assert.deepEqual(open('foreground-tab', '', ''), { kind: 'popup' });
});

test('windowOpenTarget: only web pages open', () => {
  for (const url of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.c', 'not a url']) {
    assert.deepEqual(open('foreground-tab', '', url), { kind: 'deny' }, url);
    assert.deepEqual(open('new-window', 'width=10', url), { kind: 'deny' }, url);
  }
  assert.deepEqual(open('foreground-tab', '', 'http://localhost:3000/'), { kind: 'tab', activate: true });
});

test('windowOpenTarget: a blob: URL from the page opens as a popup (loaded by the page, so a revoked URL still works)', () => {
  const blob = 'blob:https://billing.example.com/0f1e2d3c-aaaa-bbbb-cccc-123456789abc';
  assert.deepEqual(open('foreground-tab', '', blob), { kind: 'popup' });
  assert.deepEqual(open('background-tab', '', blob), { kind: 'popup' });
  assert.deepEqual(open('new-window', 'width=500', blob), { kind: 'popup' });
  assert.deepEqual(open('foreground-tab', '', 'BLOB:https://a.test/x'), { kind: 'popup' });
});

test('windowOpenTarget: dangerous schemes stay denied', () => {
  for (const url of ['javascript:alert(1)', 'JavaScript:void 0', 'file:///Users/me/.ssh/id_rsa', 'chrome://settings', 'chrome-extension://abc/x.html', 'devtools://devtools/x', 'view-source:https://a.test/', 'filesystem:https://a.test/temporary/x', 'data:text/html,<script>1</script>']) {
    for (const disposition of ['foreground-tab', 'background-tab', 'new-window'] as const) {
      assert.deepEqual(open(disposition, 'width=10', url), { kind: 'deny' }, `${disposition} ${url}`);
    }
  }
});

test('isOpenableLink: web pages and blob: only', () => {
  for (const url of ['https://a.test/', 'http://localhost:3000/x', 'blob:https://a.test/0f1e2d3c']) assert.equal(isOpenableLink(url), true, url);
  for (const url of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'data:text/html,x', 'about:blank', 'mailto:a@b.c']) {
    assert.equal(isOpenableLink(url), false, url);
  }
});

test('sameSavedTabs: equal only when every profile has the same urls, titles, order and active tab', () => {
  const a = { P1: { tabs: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://b.test/', title: 'B' }], activeIndex: 1 } };
  const copy = () => structuredClone(a);
  assert.equal(sameSavedTabs(a, copy()), true);
  assert.equal(sameSavedTabs({}, {}), true);
  const title = copy(); title.P1.tabs[0]!.title = 'A2';
  const url = copy(); url.P1.tabs[1]!.url = 'https://c.test/';
  const active = copy(); active.P1.activeIndex = 0;
  const order = copy(); order.P1.tabs.reverse();
  const fewer = copy(); fewer.P1.tabs.pop();
  assert.equal(sameSavedTabs(a, title), false);
  assert.equal(sameSavedTabs(a, url), false);
  assert.equal(sameSavedTabs(a, active), false);
  assert.equal(sameSavedTabs(a, order), false);
  assert.equal(sameSavedTabs(a, fewer), false);
  assert.equal(sameSavedTabs(a, { ...copy(), P2: { tabs: [], activeIndex: 0 } }), false);
  assert.equal(sameSavedTabs({ ...copy(), P2: { tabs: [], activeIndex: 0 } }, a), false);
});

test('popupTitle: the current host first, then the page title and the profile', () => {
  assert.equal(popupTitle('https://accounts.google.com/signin?x=1', 'Sign in – Google Accounts', 'Work'),
    'accounts.google.com — Sign in – Google Accounts (Work)');
  assert.equal(popupTitle('http://localhost:3000/a', 'App', 'Work'), 'localhost:3000 — App (Work)');
  assert.equal(popupTitle('https://evil.test/', '', 'Work'), 'evil.test (Work)');
});

test('popupTitle: IDN hosts show as punycode; blob: shows its origin host; others the URL itself', () => {
  assert.equal(popupTitle('https://gооgle.com/', 'Sign in', 'Work'), 'xn--ggle-55da.com — Sign in (Work)');
  assert.equal(popupTitle('blob:https://app.test/0b7e-11', 'invoice.pdf', 'Work'), 'app.test — invoice.pdf (Work)');
  assert.equal(popupTitle('about:blank', '', 'Work'), 'about:blank (Work)');
  assert.equal(popupTitle('', '', 'Work'), 'about:blank (Work)');
});
