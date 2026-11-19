import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeMajor, formatBrands, parseBrands, rewriteClientHints, userAgent, withChromeBrand, type Brand } from './identity.ts';

test('chromeMajor', () => assert.equal(chromeMajor('156.0.8078.100'), '156'));
test('userAgent', () => assert.equal(userAgent('156'),
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'));

// What Electron 45 (Chromium 156) sends and reports, observed headlessly.
const ELECTRON_156: Brand[] = [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: '156' }];
const ELECTRON_156_HEADER = '"Not:A-Brand";v="8", "Chromium";v="156"';
const ELECTRON_156_FULL = '"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.100"';

test('parseBrands and formatBrands round-trip a structured brand list', () => {
  assert.deepEqual(parseBrands(ELECTRON_156_HEADER), ELECTRON_156);
  assert.equal(formatBrands(ELECTRON_156), ELECTRON_156_HEADER);
  assert.deepEqual(parseBrands('"A\\"B";v="1"'), [{ brand: 'A"B', version: '1' }]);
  assert.equal(formatBrands([{ brand: 'A"B\\', version: '1' }]), '"A\\"B\\\\";v="1"');
});

test('parseBrands rejects anything that is not a brand list', () => {
  assert.equal(parseBrands(''), null);
  assert.equal(parseBrands('Chromium'), null);
  assert.equal(parseBrands('"Chromium";v="156",'), null);
  assert.equal(parseBrands('"Chromium";v="156" junk'), null);
});

test('withChromeBrand places GREASE, Chromium and Google Chrome as Chrome does for that major', () => {
  // Chrome's own lists, as shipped: 156 % 6 = 0 → GREASE, Chromium, brand.
  assert.deepEqual(withChromeBrand(ELECTRON_156, '156', 156), [...ELECTRON_156, { brand: 'Google Chrome', version: '156' }]);
  // Chrome 131 sent "Google Chrome", "Chromium", "Not_A Brand" (131 % 6 = 5).
  assert.deepEqual(
    withChromeBrand([{ brand: 'Chromium', version: '131' }, { brand: 'Not_A Brand', version: '24' }], '131', 131),
    [{ brand: 'Google Chrome', version: '131' }, { brand: 'Chromium', version: '131' }, { brand: 'Not_A Brand', version: '24' }],
  );
  // Chrome 124 sent "Chromium", "Google Chrome", "Not-A.Brand" (124 % 6 = 4).
  assert.deepEqual(
    withChromeBrand([{ brand: 'Not-A.Brand', version: '99' }, { brand: 'Chromium', version: '124' }], '124', 124),
    [{ brand: 'Chromium', version: '124' }, { brand: 'Google Chrome', version: '124' }, { brand: 'Not-A.Brand', version: '99' }],
  );
});

test('withChromeBrand keeps every brand: unchanged with Google Chrome, appended to an unexpected list', () => {
  const withBrand = [...ELECTRON_156, { brand: 'Google Chrome', version: '156' }];
  assert.deepEqual(withChromeBrand(withBrand, '156', 156), withBrand);
  const odd = [{ brand: 'Chromium', version: '156' }, { brand: 'X', version: '1' }, { brand: 'Y', version: '2' }];
  assert.deepEqual(withChromeBrand(odd, '156', 156), [...odd, { brand: 'Google Chrome', version: '156' }]);
  assert.deepEqual(withChromeBrand([], '156', 156), [{ brand: 'Google Chrome', version: '156' }]);
});

test('rewriteClientHints adds Google Chrome to sec-ch-ua (major) and the full version list (full version)', () => {
  const out = rewriteClientHints({
    'Sec-CH-UA': ELECTRON_156_HEADER,
    'sec-ch-ua-full-version-list': ELECTRON_156_FULL,
    'sec-ch-ua-mobile': '?0',
    Accept: '*/*',
  }, '156.0.8078.100');
  assert.deepEqual(out, {
    'Sec-CH-UA': '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
    'sec-ch-ua-full-version-list': '"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.100", "Google Chrome";v="156.0.8078.100"',
    'sec-ch-ua-mobile': '?0',
    Accept: '*/*',
  });
});

test('rewriteClientHints leaves requests without brand hints alone and never drops an unparsable value', () => {
  assert.deepEqual(rewriteClientHints({ Accept: '*/*' }, '156.0.8078.100'), { Accept: '*/*' });
  assert.deepEqual(rewriteClientHints({ 'sec-ch-ua': 'garbage' }, '156.0.8078.100'),
    { 'sec-ch-ua': 'garbage, "Google Chrome";v="156"' });
});
