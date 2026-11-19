import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, Decision } from './appState.ts';
import {
  decide, describeRequest, permissionKeys, policyFor, PromptQueue, remember, siteOrigin,
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
  );
  return { queue, shown, stored };
}

const flush = () => new Promise<void>((r) => setImmediate(r));
const p = (origin: string, keys = ['notifications'], dir = 'Default'): PermissionPrompt => ({ dir, origin, keys });

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
  }, () => 'ask');
  assert.equal(await queue.request(p('https://a.test')), 'deny');
  assert.equal(await queue.request(p('https://b.test')), 'allow');
});
