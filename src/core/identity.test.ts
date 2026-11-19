import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeMajor, userAgent, secChUa, rewriteClientHints } from './identity.ts';

test('chromeMajor', () => assert.equal(chromeMajor('156.0.8078.100'), '156'));
test('userAgent', () => assert.equal(userAgent('156'),
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'));
test('secChUa', () => assert.equal(secChUa('156'), '"Google Chrome";v="156", "Chromium";v="156", "Not_A Brand";v="24"'));
test('rewriteClientHints replaces any-case sec-ch-ua only', () => {
  const out = rewriteClientHints({ 'Sec-CH-UA': '"Chromium";v="156"', Accept: '*/*' }, '156');
  assert.deepEqual(out, { 'Sec-CH-UA': secChUa('156'), Accept: '*/*' });
  assert.deepEqual(rewriteClientHints({ Accept: '*/*' }, '156'), { Accept: '*/*' });
});
