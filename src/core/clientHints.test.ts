import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptLanguages, HIGH_ENTROPY, isSecureUrl, parseAcceptCh, platformVersion, withClientHints, type HintValues } from './clientHints.ts';

const V: HintValues = { major: '156', fullVersion: '156.0.8078.100', platformVersion: '27.3.0', arch: 'arm', bitness: '64' };
const NAV = { 'User-Agent': 'UA', Accept: 'text/html' };
const ELECTRON_UA = '"Not:A-Brand";v="8", "Chromium";v="156"';

test('a page load to a secure URL gets the three low-entropy hints', () => {
  assert.deepEqual(withClientHints(NAV, 'https://accounts.google.com/', V, new Set()), {
    ...NAV,
    'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  });
});

test('an origin that asked with Accept-CH also gets the high-entropy hints Chrome sends', () => {
  const out = withClientHints(NAV, 'https://accounts.google.com/x', V, new Set(HIGH_ENTROPY));
  assert.equal(out['sec-ch-ua-arch'], '"arm"');
  assert.equal(out['sec-ch-ua-bitness'], '"64"');
  assert.equal(out['sec-ch-ua-full-version-list'],
    '"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.100", "Google Chrome";v="156.0.8078.100"');
  assert.equal(out['sec-ch-ua-model'], '""');
  assert.equal(out['sec-ch-ua-platform-version'], '"27.3.0"');
  assert.equal(out['sec-ch-ua-wow64'], '?0');
  assert.equal(out['sec-ch-ua-form-factors'], '"Desktop"');
});

test('only the requested high-entropy hints are added', () => {
  const out = withClientHints(NAV, 'https://example.com/', V, new Set(['sec-ch-ua-arch']));
  assert.equal(out['sec-ch-ua-arch'], '"arm"');
  assert.equal(out['sec-ch-ua-model'], undefined);
});

test('a non-secure page gets no added hints', () => {
  assert.deepEqual(withClientHints(NAV, 'http://192.168.5.10:8123/', V, new Set(HIGH_ENTROPY)), NAV);
});

test('localhost counts as secure', () => {
  assert.equal(withClientHints(NAV, 'http://localhost:3000/', V, new Set())['sec-ch-ua-mobile'], '?0');
  assert.equal(isSecureUrl('http://127.0.0.1:8080/'), true);
  assert.equal(isSecureUrl('http://[::1]/'), true);
  assert.equal(isSecureUrl('http://example.com/'), false);
  assert.equal(isSecureUrl('not a url'), false);
});

test('Electron\'s own sec-ch-ua is rewritten, not duplicated', () => {
  const out = withClientHints({ ...NAV, 'sec-ch-ua': ELECTRON_UA, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"' },
    'https://example.com/', V, new Set());
  assert.equal(out['sec-ch-ua'], '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"');
  assert.equal(Object.keys(out).filter((k) => k.toLowerCase() === 'sec-ch-ua').length, 1);
});

test('parseAcceptCh keeps known high-entropy names, in any case and spacing', () => {
  assert.deepEqual(parseAcceptCh('sec-ch-ua-arch , Sec-CH-UA-Model, Sec-CH-UA, foo'), ['sec-ch-ua-arch', 'sec-ch-ua-model']);
  assert.deepEqual(parseAcceptCh(''), []);
});

test('platformVersion has three parts', () => {
  assert.equal(platformVersion('27.3'), '27.3.0');
  assert.equal(platformVersion('15.1.2'), '15.1.2');
  assert.equal(platformVersion('26'), '26.0.0');
});

test('acceptLanguages adds each base language after its regional one, as Chrome does', () => {
  assert.equal(acceptLanguages(['en-US']), 'en-US,en');
  assert.equal(acceptLanguages(['vi-VN', 'en-US']), 'vi-VN,vi,en-US,en');
  assert.equal(acceptLanguages(['en-GB', 'en-US', 'en']), 'en-GB,en,en-US');
  assert.equal(acceptLanguages([]), 'en-US,en');
});
