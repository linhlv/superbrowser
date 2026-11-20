import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  bindsGoogle, cookieKey, decryptValue, deriveKey, isGoogleHost, planImport, toCookieDetails, type ChromeCookieRow, type CookieDetails,
} from './cookies.ts';

const KEY = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

/** What Chrome stores on macOS: 'v10' + AES-128-CBC(sha256(host) (DB version ≥ 24) + value). */
function chromeEncrypt(value: string, hostKey: string, dbVersion: number, key = KEY): Buffer {
  const prefix = dbVersion >= 24 ? crypto.createHash('sha256').update(hostKey).digest() : Buffer.alloc(0);
  const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10'), c.update(Buffer.concat([prefix, Buffer.from(value)])), c.final()]);
}

test('deriveKey matches Chrome on macOS (PBKDF2-SHA1, saltysalt, 1003 rounds, 16 bytes)', () => {
  assert.equal(deriveKey('peanuts').toString('hex'), 'd9a09d499b4e1b7461f28e67972c6dbd');
});

test('decryptValue strips the host hash (DB version 24 on)', () => {
  assert.equal(decryptValue(chromeEncrypt('abc', '.google.com', 24), '.google.com', KEY), 'abc');
});

test('decryptValue reads values that have no host hash (DB version 23 and older)', () => {
  assert.equal(decryptValue(chromeEncrypt('abc', '.google.com', 23), '.google.com', KEY), 'abc');
});

test('decryptValue: empty input is an empty value; other prefixes or a wrong key throw', () => {
  assert.equal(decryptValue(Buffer.alloc(0), 'x.com', KEY), '');
  const v11 = chromeEncrypt('abc', 'x.com', 24);
  v11.write('v11', 0);
  assert.throws(() => decryptValue(v11, 'x.com', KEY));
  assert.throws(() => decryptValue(chromeEncrypt('abc', 'x.com', 24), 'x.com', deriveKey('wrong')));
});

const NOW = 1_800_000_000; // seconds since 1970
/** Chrome's time: microseconds since 1601-01-01. */
const chromeTime = (unixSec: number) => String((unixSec + 11644473600) * 1e6);

function row(p: Partial<ChromeCookieRow>): ChromeCookieRow {
  return {
    host_key: '.google.com', name: 'SID', value: '', ev: '', path: '/', expires_utc: chromeTime(NOW + 86400),
    is_secure: 1, is_httponly: 1, samesite: 0, has_expires: 1, is_persistent: 1, top_frame_site_key: '', ...p,
  };
}

test('toCookieDetails maps a domain cookie', () => {
  assert.deepEqual(toCookieDetails(row({}), 'v', NOW), {
    url: 'https://google.com/', name: 'SID', value: 'v', domain: '.google.com', path: '/',
    secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: NOW + 86400,
  });
});

test('toCookieDetails: host-only and __Host- cookies get no domain', () => {
  const host = toCookieDetails(row({ host_key: 'accounts.google.com', name: '__Host-GAPS', path: '/' }), 'v', NOW);
  assert.equal(host?.domain, undefined);
  assert.equal(host?.url, 'https://accounts.google.com/');
  const dotted = toCookieDetails(row({ host_key: '.google.com', name: '__Host-X' }), 'v', NOW);
  assert.equal(dotted?.domain, undefined);
});

test('toCookieDetails maps SameSite, and SameSite=None without Secure becomes unspecified', () => {
  const same = (samesite: number, is_secure = 1) => toCookieDetails(row({ samesite, is_secure }), 'v', NOW)?.sameSite;
  assert.equal(same(-1), 'unspecified');
  assert.equal(same(1), 'lax');
  assert.equal(same(2), 'strict');
  assert.equal(same(0, 0), 'unspecified');
  const insecure = toCookieDetails(row({ is_secure: 0, path: '/a' }), 'v', NOW);
  assert.equal(insecure?.url, 'http://google.com/a');
  assert.equal(insecure?.secure, false);
});

test('toCookieDetails: session cookies have no expirationDate', () => {
  const session = toCookieDetails(row({ has_expires: 0, is_persistent: 0, expires_utc: '0' }), 'v', NOW);
  assert.ok(session);
  assert.equal('expirationDate' in session, false);
});

test('toCookieDetails skips expired and partitioned cookies', () => {
  assert.equal(toCookieDetails(row({ expires_utc: chromeTime(NOW - 1) }), 'v', NOW), null);
  assert.equal(toCookieDetails(row({ top_frame_site_key: 'https://example.com' }), 'v', NOW), null);
});

test('cookieKey ignores a leading dot and falls back to the URL host', () => {
  assert.equal(cookieKey({ name: 'SID', domain: '.google.com', path: '/' }), 'SID|google.com|/');
  assert.equal(cookieKey({ name: 'SID', domain: 'google.com', path: '/' }), 'SID|google.com|/');
  assert.equal(cookieKey({ name: 'A', url: 'https://accounts.google.com/x', path: '/x' }), 'A|accounts.google.com|/x');
});

test('planImport add skips cookies already there; replace takes them all', () => {
  const c = (name: string, domain?: string): CookieDetails => ({
    url: 'https://google.com/', name, value: 'v', path: '/', secure: true, httpOnly: false, sameSite: 'lax',
    ...(domain ? { domain } : {}),
  });
  const candidates = [c('SID', '.google.com'), c('HSID', '.google.com'), c('NID')];
  const existing = [{ name: 'SID', domain: 'google.com', path: '/' }, { name: 'NID', domain: 'google.com', path: '/' }];
  assert.deepEqual(planImport(candidates, existing, 'add').map((x) => x.name), ['HSID']);
  assert.deepEqual(planImport(candidates, existing, 'replace'), candidates);
});

test('isGoogleHost covers Google and YouTube domains and their subdomains only', () => {
  for (const h of ['.google.com', 'google.com', 'accounts.google.com', '.google.com.vn', 'google.co.uk', '.google.de', '.youtube.com', 'accounts.youtube.com']) {
    assert.equal(isGoogleHost(h), true, h);
  }
  for (const h of ['notgoogle.com', '.google.example', 'google.com.evil.io', 'example.com', 'youtube.com.au.example', '']) {
    assert.equal(isGoogleHost(h), false, h);
  }
});

test('bindsGoogle is true only when a device-bound session is for a Google site', () => {
  assert.equal(bindsGoogle(['https://claude.ai', 'https://google.com']), true);
  assert.equal(bindsGoogle(['https://accounts.google.com']), true);
  assert.equal(bindsGoogle(['https://claude.ai']), false);
  assert.equal(bindsGoogle([]), false);
  assert.equal(bindsGoogle(['not a url']), false);
});
