import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseLocalState } from '../core/profiles.ts';
import type { Profile } from '../shared/types.ts';

export const CHROME_DIR = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

/** Read-only. Null when Chrome's Local State is missing or unparsable. */
export function readChromeProfiles(): Profile[] | null {
  try {
    const existing = new Set(readdirSync(CHROME_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    return parseLocalState(readFileSync(join(CHROME_DIR, 'Local State'), 'utf8'), existing);
  } catch {
    return null;
  }
}

/** Opens Chrome's "new profile" page. Chrome creates the profile itself (we never write Chrome's data). */
export function newProfileInChrome(log: (msg: string) => void): void {
  execFile('open', ['-na', 'Google Chrome', '--args', 'chrome://profile-picker/new-profile'], (err) => {
    if (err) log(`could not open Chrome's new profile page: ${err.message}`);
  });
}

export function openProfileInChrome(dir: string, log: (msg: string) => void): void {
  execFile('open', ['-na', 'Google Chrome', '--args', `--profile-directory=${dir}`], (err) => {
    if (err) log(`could not open profile ${dir} in Chrome: ${err.message}`);
  });
}
