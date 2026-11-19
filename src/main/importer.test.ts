// Runs against a synthetic Chrome Cookies DB built here; never the real Keychain or Chrome's files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveKey, type CookieDetails } from '../core/cookies.ts';
import { ImportError, LoginImporter, type CookieJar } from './importer.ts';

const PASSWORD = 'test-password';
const KEY = deriveKey(PASSWORD);
const NOW = Math.floor(Date.now() / 1000);
const chromeTime = (unixSec: number) => (BigInt(unixSec) + 11644473600n) * 1000000n;

function encrypt(value: string, hostKey: string, prefix = 'v10'): string {
  const hash = crypto.createHash('sha256').update(hostKey).digest();
  const c = crypto.createCipheriv('aes-128-cbc', KEY, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from(prefix), c.update(Buffer.concat([hash, Buffer.from(value)])), c.final()]).toString('hex');
}

type Row = { host: string; name: string; value?: string; ev?: string; expires?: number; partition?: string; secure?: number };

/** Chrome's `cookies` table (DB version 24, or `metaVersion` in its meta table) with the given rows. */
function makeChromeDir(rows: Row[], metaVersion = '24'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-importer-test-'));
  fs.mkdirSync(path.join(root, 'Profile 1'));
  const sq = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const inserts = rows.map((r) => `INSERT INTO cookies VALUES (13300000000000000, ${sq(r.host)}, ${sq(r.partition ?? '')}, ${sq(r.name)},
    ${sq(r.value ?? '')}, X'${r.ev ?? ''}', '/', ${chromeTime(r.expires ?? NOW + 86400)}, ${r.secure ?? 1}, 1, 13300000000000000, 1, 1, 1, 0, 2, 443,
    13300000000000000, 0, 0);`).join('\n');
  const sql = `
    CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta VALUES ('version', ${sq(metaVersion)}), ('last_compatible_version', '24');
    CREATE TABLE cookies(creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
      name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL,
      last_update_utc INTEGER NOT NULL, source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL);
    ${inserts}`;
  execFileSync('sqlite3', [path.join(root, 'Profile 1', 'Cookies')], { input: sql });
  return root;
}

class FakeJar implements CookieJar {
  existing: { name: string; domain: string; path: string }[] = [];
  setCalls: CookieDetails[] = [];
  flushes = 0;
  async get(): Promise<Electron.Cookie[]> { return this.existing as Electron.Cookie[]; }
  async set(details: Electron.CookiesSetDetails): Promise<void> {
    if (details.name === 'REJECT') throw new Error('Failed to set cookie');
    this.setCalls.push(details as CookieDetails);
  }
  async flushStore(): Promise<void> { this.flushes++; }
}

function setup(rows: Row[], readPassword: () => Promise<string> = async () => PASSWORD, metaVersion?: string) {
  const chromeDir = makeChromeDir(rows, metaVersion);
  const jar = new FakeJar();
  const jarDirs: string[] = [];
  const logs: string[] = [];
  const importer = new LoginImporter({
    chromeDir, readPassword, log: (m) => logs.push(m), jarOf: (dir) => { jarDirs.push(dir); return jar; },
  });
  return { chromeDir, jar, jarDirs, logs, importer };
}

const tempCopies = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('superbrowser-cookies-')).sort();

const ROWS: Row[] = [
  { host: '.google.com', name: 'SID', ev: encrypt('sid-value', '.google.com') },
  { host: 'accounts.google.com', name: '__Host-GAPS', ev: encrypt('gaps-value', 'accounts.google.com') },
  { host: 'plain.example', name: 'PLAIN', value: 'plain-value', secure: 0 },
  { host: '.google.com', name: 'OLD', ev: encrypt('x', '.google.com'), expires: NOW - 60 },
  { host: '.google.com', name: 'PART', ev: encrypt('x', '.google.com'), partition: 'https://example.com' },
  { host: '.google.com', name: 'V11', ev: encrypt('x', '.google.com', 'v11') },
  { host: '.google.com', name: 'NID', ev: encrypt('nid-value', '.google.com') },
  { host: '.google.com', name: 'REJECT', ev: encrypt('x', '.google.com') },
];

test('importLogins decrypts, maps and sets new cookies, counting skips and failures', async () => {
  const { chromeDir, jar, jarDirs, logs, importer } = setup(ROWS);
  jar.existing = [{ name: 'NID', domain: '.google.com', path: '/' }];
  const before = tempCopies();
  const result = await importer.importLogins('Profile 1', 'add');
  assert.deepEqual(result, { set: 3, skipped: 3, failed: 2, total: 8 });
  assert.deepEqual(jarDirs, ['Profile 1']);
  assert.deepEqual(jar.setCalls.map((c) => [c.name, c.value, c.domain, c.url]), [
    ['SID', 'sid-value', '.google.com', 'https://google.com/'],
    ['__Host-GAPS', 'gaps-value', undefined, 'https://accounts.google.com/'],
    ['PLAIN', 'plain-value', undefined, 'http://plain.example/'],
  ]);
  assert.ok(Math.abs(jar.setCalls[0].expirationDate! - (NOW + 86400)) < 1);
  assert.equal(jar.flushes, 1);
  assert.deepEqual(tempCopies(), before, 'the temporary copy is removed');
  assert.ok(logs.some((l) => l.includes('V11')) && logs.some((l) => l.includes('REJECT')), logs.join('\n'));
  assert.ok(!logs.some((l) => /sid-value|gaps-value|plain-value|test-password/.test(l)), 'never logs values or the password');
  fs.rmSync(chromeDir, { recursive: true });
});

test('replace mode sets cookies the session already has', async () => {
  const { chromeDir, jar, importer } = setup(ROWS);
  jar.existing = [{ name: 'NID', domain: '.google.com', path: '/' }];
  const result = await importer.importLogins('Profile 1', 'replace');
  assert.deepEqual(result, { set: 4, skipped: 2, failed: 2, total: 8 });
  assert.ok(jar.setCalls.some((c) => c.name === 'NID' && c.value === 'nid-value'));
  fs.rmSync(chromeDir, { recursive: true });
});

test('the Keychain is read once per run', async () => {
  let reads = 0;
  const { chromeDir, importer } = setup(ROWS, async () => { reads++; return PASSWORD; });
  await importer.key();
  await importer.importLogins('Profile 1', 'add');
  await importer.importLogins('Profile 1', 'add');
  assert.equal(reads, 1);
  fs.rmSync(chromeDir, { recursive: true });
});

test('a denied Keychain read changes nothing and is asked again next time', async () => {
  let reads = 0;
  const { chromeDir, jarDirs, importer } = setup(ROWS, async () => { reads++; throw new Error('security exited with 128'); });
  await assert.rejects(importer.importLogins('Profile 1', 'add'), /couldn't read Chrome's login key from your Keychain/);
  await assert.rejects(importer.key(), (e) => e instanceof ImportError && /Always Allow/.test(e.detail));
  assert.equal(reads, 2);
  assert.deepEqual(jarDirs, []);
  fs.rmSync(chromeDir, { recursive: true });
});

test('a profile without a Cookies file fails with a readable message and touches no session', async () => {
  const { chromeDir, jarDirs, importer } = setup([]);
  await assert.rejects(importer.importLogins('Profile 2', 'add'), /no saved logins/);
  assert.deepEqual(jarDirs, []);
  fs.rmSync(chromeDir, { recursive: true });
});

test('an empty cookies table imports nothing', async () => {
  const { chromeDir, jar, importer } = setup([]);
  assert.deepEqual(await importer.importLogins('Profile 1', 'add'), { set: 0, skipped: 0, failed: 0, total: 0 });
  assert.equal(jar.flushes, 1);
  fs.rmSync(chromeDir, { recursive: true });
});

test('the host hash is stripped whatever the meta version says (even none)', async () => {
  const { chromeDir, jar, importer } = setup([{ host: '.google.com', name: 'SID', ev: encrypt('sid-value', '.google.com') }], undefined, '');
  assert.deepEqual(await importer.importLogins('Profile 1', 'add'), { set: 1, skipped: 0, failed: 0, total: 1 });
  assert.equal(jar.setCalls[0]?.value, 'sid-value');
  fs.rmSync(chromeDir, { recursive: true });
});
