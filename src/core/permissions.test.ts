import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, Decision } from './appState.ts';
import {
  decide, describeRequest, permissionKeys, policyFor, PromptQueue, remember, siteOrigin, storeAnswer, verdictFor,
  type PermissionPrompt,
} from './permissions.ts';

const MEET = 'https://meet.google.com';
const AV = ['media:video', 'media:audio'];

test('policyFor: allow, ask and deny groups', () => {
  for (const p of ['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'automatic-fullscreen']) {
    assert.equal(policyFor(p), 'allow', p);
  }
  for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read', 'display-capture', 'window-management']) {
    assert.equal(policyFor(p), 'ask', p);
  }
  for (const p of ['usb', 'midiSysex', 'hid', 'unknown', '']) assert.equal(policyFor(p), 'deny', p);
});

test('permissionKeys: media splits by media type, others are themselves', () => {
  assert.deepEqual(permissionKeys('media', ['video', 'audio']), AV);
  assert.deepEqual(permissionKeys('media', ['audio']), ['media:audio']);
  assert.deepEqual(permissionKeys('media', ['video']), ['media:video']);
  assert.deepEqual(permissionKeys('notifications'), ['notifications']);
  assert.deepEqual(permissionKeys('display-capture', ['video']), ['display-capture']);
});

test('permissionKeys: media without types means camera and microphone', () => {
  assert.deepEqual(permissionKeys('media'), AV);
  assert.deepEqual(permissionKeys('media', []), AV);
});

test('decide: nothing stored asks', () => {
  assert.equal(decide(undefined, MEET, AV, 'ask'), 'ask');
  assert.equal(decide({}, MEET, AV, 'ask'), 'ask');
  assert.equal(decide({ 'https://other.test': { 'media:video': 'allow', 'media:audio': 'allow' } }, MEET, AV, 'ask'), 'ask');
});

test('decide: every key allowed allows; some keys unknown still asks', () => {
  assert.equal(decide({ [MEET]: { 'media:video': 'allow', 'media:audio': 'allow' } }, MEET, AV, 'ask'), 'allow');
  assert.equal(decide({ [MEET]: { 'media:video': 'allow' } }, MEET, AV, 'ask'), 'ask');
  assert.equal(decide({ [MEET]: { 'media:video': 'allow' } }, MEET, ['media:video'], 'ask'), 'allow');
});

test('decide: any stored deny denies', () => {
  assert.equal(decide({ [MEET]: { 'media:video': 'allow', 'media:audio': 'deny' } }, MEET, AV, 'ask'), 'deny');
  assert.equal(decide({ [MEET]: { 'media:audio': 'deny' } }, MEET, AV, 'ask'), 'deny');
});

test('decide: an allow or deny policy wins over what is stored', () => {
  assert.equal(decide({ [MEET]: { fullscreen: 'deny' } }, MEET, ['fullscreen'], 'allow'), 'allow');
  assert.equal(decide({ [MEET]: { usb: 'allow' } }, MEET, ['usb'], 'deny'), 'deny');
});

test('decide: no keys never allows', () => {
  assert.equal(decide({ [MEET]: {} }, MEET, [], 'ask'), 'ask');
});

test('remember: stores every key without touching the input', () => {
  const perms: AppState['permissions'] = { Default: { [MEET]: { 'media:video': 'deny' } } };
  const before = structuredClone(perms);
  const next = remember(perms, 'Default', MEET, AV, 'allow');
  assert.deepEqual(perms, before);
  assert.deepEqual(next, { Default: { [MEET]: { 'media:video': 'allow', 'media:audio': 'allow' } } });
});

test('remember: keeps other profiles, origins and keys', () => {
  const perms: AppState['permissions'] = {
    Default: { 'https://a.test': { notifications: 'allow' }, [MEET]: { geolocation: 'deny' } },
    'Profile 1': { [MEET]: { notifications: 'allow' } },
  };
  const next = remember(perms, 'Default', MEET, ['notifications'], 'deny');
  assert.deepEqual(next, {
    Default: { 'https://a.test': { notifications: 'allow' }, [MEET]: { geolocation: 'deny', notifications: 'deny' } },
    'Profile 1': { [MEET]: { notifications: 'allow' } },
  });
  assert.deepEqual(remember({}, 'Profile 2', MEET, ['geolocation'], 'allow'), { 'Profile 2': { [MEET]: { geolocation: 'allow' } } });
});

test('describeRequest: camera and microphone', () => {
  assert.equal(describeRequest(MEET, AV), 'meet.google.com wants to use your camera and microphone');
  assert.equal(describeRequest(MEET, ['media:video']), 'meet.google.com wants to use your camera');
  assert.equal(describeRequest(MEET, ['media:audio']), 'meet.google.com wants to use your microphone');
});

test('describeRequest: the other asked permissions', () => {
  assert.equal(describeRequest('https://mail.google.com', ['notifications']), 'mail.google.com wants to show notifications');
  assert.equal(describeRequest('https://maps.google.com', ['geolocation']), 'maps.google.com wants to know your location');
  assert.equal(describeRequest('https://docs.google.com', ['clipboard-read']), 'docs.google.com wants to read your clipboard');
  assert.equal(describeRequest(MEET, ['display-capture']), 'meet.google.com wants to share your screen');
  assert.equal(describeRequest('https://slides.test', ['window-management']), 'slides.test wants to manage windows on all your displays');
});

test('describeRequest: keeps a non-default port', () => {
  assert.equal(describeRequest('http://localhost:3000', ['notifications']), 'localhost:3000 wants to show notifications');
});

test('siteOrigin: http(s) pages have an origin, other schemes none', () => {
  assert.equal(siteOrigin('https://meet.google.com/abc-defg-hij?authuser=1'), MEET);
  assert.equal(siteOrigin('http://localhost:3000/x'), 'http://localhost:3000');
  assert.equal(siteOrigin('https://meet.google.com'), MEET);
  for (const u of ['file:///Users/me/a.html', 'about:blank', 'data:text/html,hi', 'chrome://settings', '', 'not a url', undefined]) {
    assert.equal(siteOrigin(u), null, String(u));
  }
});

// --- PromptQueue -----------------------------------------------------------------------------------------

type Pending = { prompt: PermissionPrompt; answer: (d: Decision) => void };

/** A queue whose sheets are answered by the test; `stored` is what the re-check sees. */
function harness() {
  const shown: Pending[] = [];
  const stored = new Map<string, Decision>();
  /** Requests whose page is gone (tab closed or navigated), as `${source}/${navigation}`. */
  const gone = new Set<string>();
  const keyOf = (p: PermissionPrompt) => `${p.dir}|${p.origin}|${p.keys.join(',')}`;
  const queue = new PromptQueue(
    (prompt) => new Promise<Decision>((resolve) => {
      shown.push({
        prompt,
        answer: (d) => {
          stored.set(keyOf(prompt), d);
          resolve(d);
        },
      });
    }),
    (prompt) => stored.get(keyOf(prompt)) ?? 'ask',
    (prompt) => !gone.has(`${prompt.source}/${prompt.navigation}`),
  );
  return { queue, shown, stored, gone };
}

const flush = () => new Promise<void>((r) => setImmediate(r));
let nextSource = 1;
/** A request; each comes from its own tab unless `source` is given. */
const p = (origin: string, keys = ['notifications'], dir = 'Default', source = nextSource++, navigation = 0): PermissionPrompt =>
  ({ dir, origin, keys, source, navigation });

test('PromptQueue: one sheet at a time, in order', async () => {
  const { queue, shown } = harness();
  const a = queue.request(p('https://a.test'));
  const b = queue.request(p('https://b.test'));
  await flush();
  assert.equal(shown.length, 1);
  assert.equal(shown[0]?.prompt.origin, 'https://a.test');
  shown[0]?.answer('allow');
  assert.equal(await a, 'allow');
  await flush();
  assert.equal(shown.length, 2);
  assert.equal(shown[1]?.prompt.origin, 'https://b.test');
  shown[1]?.answer('deny');
  assert.equal(await b, 'deny');
});

test('PromptQueue: an identical request joins the pending one', async () => {
  const { queue, shown } = harness();
  const first = queue.request(p(MEET, AV));
  await flush();
  const second = queue.request(p(MEET, ['media:audio', 'media:video'])); // same keys, other order
  const queued = queue.request(p('https://b.test'));
  const queuedAgain = queue.request(p('https://b.test'));
  await flush();
  assert.equal(shown.length, 1);
  shown[0]?.answer('allow');
  assert.deepEqual(await Promise.all([first, second]), ['allow', 'allow']);
  await flush();
  assert.equal(shown.length, 2);
  shown[1]?.answer('deny');
  assert.deepEqual(await Promise.all([queued, queuedAgain]), ['deny', 'deny']);
});

test('PromptQueue: same site in another profile, or other keys, is a separate sheet', async () => {
  const { queue, shown } = harness();
  void queue.request(p(MEET, ['notifications'], 'Default'));
  void queue.request(p(MEET, ['notifications'], 'Profile 1'));
  void queue.request(p(MEET, ['geolocation'], 'Default'));
  await flush();
  shown[0]?.answer('allow');
  await flush();
  shown[1]?.answer('allow');
  await flush();
  assert.equal(shown.length, 3);
});

test('PromptQueue: a queued request answered meanwhile is not asked again', async () => {
  const { queue, shown, stored } = harness();
  const a = queue.request(p('https://a.test'));
  const b = queue.request(p('https://b.test'));
  await flush();
  stored.set('Default|https://b.test|notifications', 'deny'); // e.g. remembered by the sheet for a
  shown[0]?.answer('allow');
  assert.equal(await a, 'allow');
  assert.equal(await b, 'deny');
  assert.equal(shown.length, 1);
});

test('PromptQueue: a failing sheet denies and the queue goes on', async () => {
  let calls = 0;
  const queue = new PromptQueue(async () => {
    calls++;
    if (calls === 1) throw new Error('window gone');
    return 'allow';
  }, () => 'ask', () => true);
  assert.equal(await queue.request(p('https://a.test')), 'deny');
  assert.equal(await queue.request(p('https://b.test')), 'allow');
});

test('PromptQueue: a waiting request whose tab closed or navigated is refused without a sheet', async () => {
  const { queue, shown, gone } = harness();
  const a = queue.request(p('https://a.test'));
  const closed = queue.request(p('https://b.test', ['notifications'], 'Default', 50, 0));
  const navigated = queue.request(p('https://c.test', ['geolocation'], 'Default', 51, 3));
  const kept = queue.request(p('https://d.test'));
  await flush();
  gone.add('50/0');
  gone.add('51/3');
  shown[0]?.answer('allow');
  assert.equal(await a, 'allow');
  assert.equal(await closed, 'deny');
  assert.equal(await navigated, 'deny');
  await flush();
  assert.deepEqual(shown.map((s) => s.prompt.origin), ['https://a.test', 'https://d.test']);
  shown[1]?.answer('allow');
  assert.equal(await kept, 'allow');
});

test('PromptQueue: a gone request does not cancel an identical one from a live tab', async () => {
  const { queue, shown, gone } = harness();
  void queue.request(p('https://a.test'));
  const dead = queue.request(p(MEET, AV, 'Default', 60));
  const live = queue.request(p(MEET, AV, 'Default', 61));
  await flush();
  gone.add('60/0');
  shown[0]?.answer('allow');
  await flush();
  assert.equal(shown.length, 2);
  assert.equal(shown[1]?.prompt.source, 61);
  shown[1]?.answer('allow');
  assert.equal(await dead, 'deny');
  assert.equal(await live, 'allow');
});

test('PromptQueue: one waiting request per tab, others refused at once', async () => {
  const { queue, shown } = harness();
  const first = queue.request(p('https://a.test', ['geolocation'], 'Default', 70));
  const sameAgain = queue.request(p('https://a.test', ['geolocation'], 'Default', 70)); // joins, no new sheet
  const extras = [
    queue.request(p('https://a.test', ['notifications'], 'Default', 70)),
    queue.request(p('https://x.a.test', AV, 'Default', 70)),
    queue.request(p('https://y.a.test', ['geolocation'], 'Default', 70)),
  ];
  assert.deepEqual(await Promise.all(extras), ['deny', 'deny', 'deny']);
  const otherTab = queue.request(p('https://b.test', ['geolocation'], 'Default', 71));
  await flush();
  assert.equal(shown.length, 1);
  shown[0]?.answer('allow');
  assert.deepEqual(await Promise.all([first, sameAgain]), ['allow', 'allow']);
  await flush();
  shown[1]?.answer('deny');
  assert.equal(await otherTab, 'deny');
  // Its turn is over: the tab may ask again.
  const later = queue.request(p('https://a.test', ['notifications'], 'Default', 70));
  await flush();
  assert.equal(shown.length, 3);
  shown[2]?.answer('allow');
  assert.equal(await later, 'allow');
});

test('PromptQueue: a throwing check refuses that request and the queue goes on', async () => {
  let checks = 0;
  const queue = new PromptQueue(async () => 'allow', () => 'ask', () => {
    checks++;
    if (checks === 1) throw new Error('boom');
    return true;
  });
  assert.equal(await queue.request(p('https://a.test')), 'deny');
  assert.equal(await queue.request(p('https://b.test')), 'allow');
});

// --- where answers go, what is decided without asking ----------------------------------------------------

test('storeAnswer: only a remembered Allow is saved', () => {
  const empty = { saved: {}, run: {} };
  assert.deepEqual(storeAnswer(empty, 'Default', MEET, AV, 'allow', true), {
    saved: { Default: { [MEET]: { 'media:video': 'allow', 'media:audio': 'allow' } } },
    run: {},
  });
  assert.deepEqual(storeAnswer(empty, 'Default', MEET, AV, 'deny', true), {
    saved: {},
    run: { Default: { [MEET]: { 'media:video': 'deny', 'media:audio': 'deny' } } },
  });
  assert.deepEqual(storeAnswer(empty, 'Default', MEET, ['notifications'], 'allow', false), {
    saved: {},
    run: { Default: { [MEET]: { notifications: 'allow' } } },
  });
  assert.deepEqual(storeAnswer(empty, 'Default', MEET, ['notifications'], 'deny', false), {
    saved: {},
    run: { Default: { [MEET]: { notifications: 'deny' } } },
  });
});

test('storeAnswer: leaves its inputs untouched', () => {
  const stores = { saved: { Default: { [MEET]: { geolocation: 'allow' as Decision } } }, run: {} };
  const before = structuredClone(stores);
  storeAnswer(stores, 'Default', MEET, ['notifications'], 'allow', true);
  storeAnswer(stores, 'Default', MEET, ['notifications'], 'deny', true);
  assert.deepEqual(stores, before);
});

test('verdictFor: saved Allow, then this run', () => {
  const allowAV = { Default: { [MEET]: { 'media:video': 'allow' as Decision, 'media:audio': 'allow' as Decision } } };
  const denyAV = { Default: { [MEET]: { 'media:video': 'deny' as Decision, 'media:audio': 'deny' as Decision } } };
  assert.equal(verdictFor({}, {}, 'Default', MEET, AV), 'ask');
  assert.equal(verdictFor(allowAV, {}, 'Default', MEET, AV), 'allow');
  assert.equal(verdictFor({}, allowAV, 'Default', MEET, AV), 'allow');
  assert.equal(verdictFor({}, denyAV, 'Default', MEET, AV), 'deny');
  assert.equal(verdictFor(allowAV, {}, 'Profile 1', MEET, AV), 'ask');
});

test('verdictFor: a saved deny from an earlier version counts as not stored', () => {
  const denyAV = { Default: { [MEET]: { 'media:video': 'deny' as Decision, 'media:audio': 'deny' as Decision } } };
  const mixed = { Default: { [MEET]: { 'media:video': 'allow' as Decision, 'media:audio': 'deny' as Decision } } };
  assert.equal(verdictFor(denyAV, {}, 'Default', MEET, AV), 'ask');
  assert.equal(verdictFor(mixed, {}, 'Default', MEET, AV), 'ask');
  assert.equal(verdictFor(mixed, {}, 'Default', MEET, ['media:video']), 'allow');
});
