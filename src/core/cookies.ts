import crypto from 'node:crypto';

/** The AES key from Chrome's "Chrome Safe Storage" Keychain password, as Chrome derives it on macOS. */
export function deriveKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

const IV = Buffer.alloc(16, 0x20);
/** From Cookies DB version 24 on, Chrome prepends sha256(host_key) to the value before encrypting. */
const HOST_HASH_DB_VERSION = 24;

/** One `encrypted_value`. Throws for a prefix other than `v10` or a value the key can't decrypt. */
export function decryptValue(encrypted: Buffer, hostKey: string, dbVersion: number, key: Buffer): string {
  if (encrypted.length === 0) return '';
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10') throw new Error(`unsupported cookie encryption ${JSON.stringify(prefix)}`);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, IV);
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  if (dbVersion >= HOST_HASH_DB_VERSION) {
    const hostHash = crypto.createHash('sha256').update(hostKey).digest();
    if (plain.subarray(0, 32).equals(hostHash)) plain = plain.subarray(32);
  }
  return plain.toString('utf8');
}

/** A row of Chrome's `cookies` table as `sqlite3 -json` prints it (`ev` = hex(encrypted_value)). */
export type ChromeCookieRow = {
  host_key: string; name: string; value: string; ev: string; path: string;
  expires_utc: string; is_secure: number; is_httponly: number; samesite: number; has_expires: number;
  is_persistent: number; top_frame_site_key: string;
};

/** Electron's `CookiesSetDetails` (kept here so core doesn't import electron). */
export type CookieDetails = {
  url: string; name: string; value: string; domain?: string; path: string; secure: boolean;
  httpOnly: boolean; sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'; expirationDate?: number;
};

const SAME_SITE: Record<number, CookieDetails['sameSite']> = { [-1]: 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };
/** Seconds between 1601-01-01 (Chrome's epoch) and 1970-01-01. */
const WINDOWS_EPOCH_OFFSET = 11644473600;

/** Null for cookies not worth importing: partitioned ones and expired persistent ones. */
export function toCookieDetails(row: ChromeCookieRow, value: string, nowSec: number): CookieDetails | null {
  if (row.top_frame_site_key !== '') return null;
  const secure = row.is_secure !== 0;
  const path = row.path || '/';
  let sameSite = SAME_SITE[row.samesite] ?? 'unspecified';
  if (sameSite === 'no_restriction' && !secure) sameSite = 'unspecified'; // Chromium rejects SameSite=None without Secure
  const details: CookieDetails = {
    url: `${secure ? 'https' : 'http'}://${row.host_key.replace(/^\./, '')}${path}`,
    name: row.name,
    value,
    path,
    secure,
    httpOnly: row.is_httponly !== 0,
    sameSite,
  };
  // A leading dot marks a domain cookie; __Host- cookies must be host-only.
  if (row.host_key.startsWith('.') && !row.name.startsWith('__Host-')) details.domain = row.host_key;
  if (row.has_expires && row.is_persistent) {
    const expirationDate = Number(row.expires_utc) / 1e6 - WINDOWS_EPOCH_OFFSET;
    if (expirationDate <= nowSec) return null;
    details.expirationDate = expirationDate;
  }
  return details;
}

export type ImportMode = 'add' | 'replace';
export type ImportResult = { set: number; skipped: number; failed: number; total: number };

/** `name|host|path`, the host without a leading dot (from `domain`, else from `url`). */
export function cookieKey(c: { name: string; domain?: string; url?: string; path: string }): string {
  let host = c.domain ?? '';
  if (!host && c.url) {
    try { host = new URL(c.url).hostname; } catch { /* no host: key on name and path only */ }
  }
  return `${c.name}|${host.replace(/^\./, '')}|${c.path}`;
}

/** 'add' keeps what the session already has (only new cookies are set); 'replace' overwrites with Chrome's. */
export function planImport(
  candidates: CookieDetails[], existing: { name: string; domain?: string; path: string }[], mode: ImportMode,
): CookieDetails[] {
  if (mode === 'replace') return candidates;
  const have = new Set(existing.map(cookieKey));
  return candidates.filter((c) => !have.has(cookieKey(c)));
}
