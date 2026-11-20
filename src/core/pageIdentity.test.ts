// Runs presentAsChrome once against stand-ins for the browser globals it touches (it patches them in place).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Brand } from './identity.ts';
import { PAGE_USER_CSS, presentAsChrome } from './pageIdentity.ts';

const ELECTRON: Brand[] = [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: '156' }];
const BRANDS: Brand[] = [...ELECTRON, { brand: 'Google Chrome', version: '156' }];
const calls: string[] = [];

class CredentialsContainer {
  get(_o?: unknown) { calls.push('get'); return Promise.resolve('original get'); }
  create(_o?: unknown) { calls.push('create'); return Promise.resolve('original create'); }
}
class NavigatorUAData {
  get brands() { return ELECTRON; }
  getHighEntropyValues(_h: string[]) {
    return Promise.resolve({ brands: ELECTRON, fullVersionList: [{ brand: 'Chromium', version: '156.0.8078.100' }] });
  }
  toJSON() { return { brands: ELECTRON, mobile: false }; }
}
const g = globalThis as Record<string, unknown>;
g['CredentialsContainer'] = CredentialsContainer;
g['NavigatorUAData'] = NavigatorUAData;
g['chrome'] = {};
class Navigator { get languages() { return ['en-US']; } }
g['Navigator'] = Navigator;
function unrelated() { return 42; }

presentAsChrome({ brands: BRANDS, chromeBrand: 'Google Chrome', fullVersion: '156.0.8078.100', passkeyMessage: 'no passkeys', languages: ['en-US', 'en'] });

const fnText = (f: unknown) => Function.prototype.toString.call(f);

test('passkey requests fail at once; other credential calls reach the original', async () => {
  const c = new CredentialsContainer();
  await assert.rejects(c.get({ publicKey: {} }), (e: unknown) => e instanceof DOMException && e.name === 'NotAllowedError');
  await assert.rejects(c.create({ publicKey: {} }), (e: unknown) => e instanceof DOMException && e.name === 'NotAllowedError');
  assert.equal(await c.get({ password: true }), 'original get');
  assert.deepEqual(calls, ['get']);
});

test('userAgentData names Google Chrome', async () => {
  const ua = new NavigatorUAData();
  assert.deepEqual(ua.brands, BRANDS);
  assert.deepEqual(ua.toJSON().brands, BRANDS);
  const he = await ua.getHighEntropyValues(['fullVersionList']);
  assert.deepEqual(he.brands, BRANDS);
  assert.deepEqual(he.fullVersionList, [{ brand: 'Chromium', version: '156.0.8078.100' }, { brand: 'Google Chrome', version: '156.0.8078.100' }]);
});

test('replaced functions read as native code, toString included', () => {
  assert.equal(fnText(CredentialsContainer.prototype.get), 'function get() { [native code] }');
  assert.equal(String(CredentialsContainer.prototype.create), 'function create() { [native code] }');
  assert.equal(fnText(NavigatorUAData.prototype.getHighEntropyValues), 'function getHighEntropyValues() { [native code] }');
  assert.equal(fnText(NavigatorUAData.prototype.toJSON), 'function toJSON() { [native code] }');
  assert.equal(fnText(Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, 'brands')!.get), 'function get brands() { [native code] }');
  assert.equal(String(Function.prototype.toString), 'function toString() { [native code] }');
  assert.equal(fnText(Function.prototype.toString), 'function toString() { [native code] }');
  assert.match(fnText(unrelated), /return 42/);
});

test('replaced functions keep the original arity', () => {
  assert.equal(CredentialsContainer.prototype.get.length, 1);
  assert.equal(Function.prototype.toString.length, 0);
});

test('window.chrome gets app, csi and loadTimes like Chrome\'s', () => {
  const chrome = g['chrome'] as Record<string, unknown>;
  assert.deepEqual(Object.keys(chrome).sort(), ['app', 'csi', 'loadTimes']);
  const app = chrome['app'] as Record<string, unknown>;
  assert.equal(app['isInstalled'], false);
  assert.deepEqual(app['InstallState'], { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' });
  assert.deepEqual(app['RunningState'], { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' });
  assert.equal((app['getIsInstalled'] as () => boolean)(), false);
  assert.equal((app['runningState'] as () => string)(), 'cannot_run');
  const loadTimes = (chrome['loadTimes'] as () => Record<string, unknown>)();
  for (const k of ['requestTime', 'startLoadTime', 'commitLoadTime', 'finishDocumentLoadTime', 'finishLoadTime', 'firstPaintTime',
    'firstPaintAfterLoadTime', 'navigationType', 'wasFetchedViaSpdy', 'wasNpnNegotiated', 'npnNegotiatedProtocol',
    'wasAlternateProtocolAvailable', 'connectionInfo']) assert.ok(k in loadTimes, k);
  const csi = (chrome['csi'] as () => Record<string, unknown>)();
  assert.deepEqual(Object.keys(csi), ['startE', 'onloadT', 'pageT', 'tran']);
  assert.equal(fnText(chrome['loadTimes']), 'function loadTimes() { [native code] }');
  assert.equal(fnText(app['getDetails']), 'function getDetails() { [native code] }');
});

test('navigator.languages matches the Accept-Language list', () => {
  const nav = new Navigator();
  assert.deepEqual(nav.languages, ['en-US', 'en']);
  assert.equal(nav.languages, nav.languages, 'the same frozen array each time, like Chrome');
  assert.ok(Object.isFrozen(nav.languages));
  assert.equal(fnText(Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages')!.get), 'function get languages() { [native code] }');
});

test('page user CSS resets app-region to its initial value, over any page rule', () => {
  // `initial` computes to `none` (no region); `none` or `no-drag` would make every element a no-drag region.
  for (const prop of ['-webkit-app-region', 'app-region']) {
    assert.match(PAGE_USER_CSS, new RegExp(`(^|[;{\\s])${prop}: initial !important`));
  }
  assert.match(PAGE_USER_CSS, /^\*, ::before, ::after \{/);
});
