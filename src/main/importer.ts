import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Cookies } from 'electron';
import {
  decryptValue, deriveKey, planImport, toCookieDetails,
  type ChromeCookieRow, type CookieDetails, type ImportMode, type ImportResult,
} from '../core/cookies.ts';
import { CHROME_DIR } from './chrome.ts';

const run = promisify(execFile);

/** The part of a session's cookie store the import uses. */
export type CookieJar = Pick<Cookies, 'get' | 'set' | 'flushStore'>;

export type ImporterOptions = {
  /** The Superbrowser profile session's cookies for a Chrome profile dir. */
  jarOf: (dir: string) => CookieJar;
  log: (msg: string) => void;
  /** Defaults to Chrome's real data dir (read-only). */
  chromeDir?: string;
  /** Defaults to the "Chrome Safe Storage" Keychain password. */
  readPassword?: () => Promise<string>;
};

/** A failure to show the user: `message` is the sheet's title, `detail` its text. Nothing was imported. */
export class ImportError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

const keychainError = () => new ImportError('Superbrowser couldn\'t read Chrome\'s login key from your Keychain.',
  'Nothing was imported. Try again and click Always Allow when macOS asks about “Chrome Safe Storage”.');
/** Failures logged per import (the rest are only counted). */
const MAX_LOGGED_FAILURES = 5;

/** Asks macOS for Chrome's cookie password; the first time, macOS shows an allow/deny prompt. */
async function keychainPassword(): Promise<string> {
  const { stdout } = await run('security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage']);
  return stdout.trim();
}

/**
 * Copies a Chrome profile's cookies into the matching Superbrowser session. Chrome's files are only copied
 * (Chrome may be running); the key is read from the Keychain once per app run and kept in memory only.
 * Cookie values and the key are never logged.
 */
export class LoginImporter {
  private readonly opts: Required<ImporterOptions>;
  private keyPromise: Promise<Buffer> | null = null;

  constructor(opts: ImporterOptions) {
    this.opts = { chromeDir: CHROME_DIR, readPassword: keychainPassword, ...opts };
  }

  /** Chrome's cookie key. Throws an ImportError when the Keychain read is denied or fails (asked again next time). */
  key(): Promise<Buffer> {
    this.keyPromise ??= this.opts.readPassword().then(deriveKey, (e: unknown) => {
      this.keyPromise = null;
      this.opts.log(`Keychain read failed: ${e instanceof Error ? e.message : String(e)}`);
      throw keychainError();
    });
    return this.keyPromise;
  }

  /** Throws an ImportError before any session is touched when the key or Chrome's cookies can't be read. */
  async importLogins(dir: string, mode: ImportMode): Promise<ImportResult> {
    const key = await this.key();
    const rows = await this.readRows(dir);
    const { log, jarOf } = this.opts;

    let skipped = 0, failed = 0;
    const fail = (what: string, row: { name: string }, host: string, e: unknown) => {
      failed++;
      if (failed <= MAX_LOGGED_FAILURES) {
        log(`profile ${dir}: could not ${what} cookie ${row.name} for ${host}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const nowSec = Date.now() / 1000;
    const candidates: CookieDetails[] = [];
    for (const row of rows) {
      let value: string;
      try {
        value = row.ev ? decryptValue(Buffer.from(row.ev, 'hex'), row.host_key, key) : row.value;
      } catch (e) {
        fail('decrypt', row, row.host_key, e);
        continue;
      }
      const details = toCookieDetails(row, value, nowSec);
      if (details) candidates.push(details);
      else skipped++;
    }

    const jar = jarOf(dir);
    const existing = (await jar.get({})).map((c) => ({ name: c.name, domain: c.domain, path: c.path ?? '/' }));
    const planned = planImport(candidates, existing, mode);
    skipped += candidates.length - planned.length;
    let set = 0;
    for (const details of planned) {
      try {
        await jar.set(details);
        set++;
      } catch (e) {
        fail('set', details, details.domain ?? details.url, e);
      }
    }
    await jar.flushStore();
    log(`profile ${dir}: imported ${set} of ${rows.length} Chrome cookies (${skipped} skipped, ${failed} failed)`);
    return { set, skipped, failed, total: rows.length };
  }

  /** Reads a temporary copy of `<chromeDir>/<dir>/Cookies` (with its journal or WAL, so a running Chrome's state is consistent). */
  private async readRows(dir: string): Promise<ChromeCookieRow[]> {
    const source = path.join(this.opts.chromeDir, dir, 'Cookies');
    if (!fs.existsSync(source)) {
      throw new ImportError('Chrome has no saved logins for this profile.', 'Its Cookies file wasn\'t found. Nothing was imported.');
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'superbrowser-cookies-'));
    try {
      const db = path.join(tmp, 'Cookies');
      for (const suffix of ['', '-wal', '-journal']) {
        if (suffix === '' || fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, db + suffix);
      }
      const { stdout } = await run('sqlite3', ['-json', db,
        'SELECT host_key, name, value, hex(encrypted_value) AS ev, path, CAST(expires_utc AS TEXT) AS expires_utc, '
        + 'is_secure, is_httponly, samesite, has_expires, is_persistent, top_frame_site_key FROM cookies'],
      { maxBuffer: 64 * 1024 * 1024 });
      // sqlite3 -json prints nothing at all for zero rows.
      return stdout.trim() === '' ? [] : JSON.parse(stdout) as ChromeCookieRow[];
    } catch (e) {
      this.opts.log(`profile ${dir}: reading Chrome's Cookies failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new ImportError('Superbrowser couldn\'t read Chrome\'s cookies for this profile.', 'Nothing was imported.');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
