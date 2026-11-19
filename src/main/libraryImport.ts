import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mergeChrome } from '../core/bookmarks.ts';
import {
  mapChromeVisits, parseChromeBookmarks,
  type ChromeBookmarks, type ChromeVisitRow, type LibraryImportResult,
} from '../core/chromeLibrary.ts';
import { CHROME_DIR } from './chrome.ts';
import type { Library } from './library.ts';

/** The part of `Library` the import uses. */
export type LibraryAccess = Pick<Library, 'history' | 'updateBookmarks'>;

export type LibraryImporterOptions = {
  library: LibraryAccess;
  log: (msg: string) => void;
  /** Defaults to Chrome's real data dir (read-only). */
  chromeDir?: string;
  now?: () => number;
  /** Copies one Chrome file to the temp dir; tests replace it. Defaults to `fs.copyFileSync`. */
  copyFile?: (from: string, to: string) => void;
};

const BOOKMARK_FILES = ['Bookmarks', 'AccountBookmarks'];
const VISITS_SQL = 'SELECT u.url, u.title, u.typed_count, u.hidden, CAST(v.visit_time AS TEXT) AS visit_time '
  + 'FROM visits v JOIN urls u ON u.id = v.url';

/**
 * Add-only import of a Chrome profile's bookmarks and history into its Superbrowser library. Chrome's files
 * are only copied (Chrome may be running) and the copies read; nothing under Chrome's dir is opened by SQLite,
 * written or removed. No Keychain, cookies or tabs are involved.
 */
export class LibraryImporter {
  private readonly library: LibraryAccess;
  private readonly log: (msg: string) => void;
  private readonly chromeDir: string;
  private readonly now: () => number;
  private readonly copyFile: (from: string, to: string) => void;

  constructor(opts: LibraryImporterOptions) {
    this.library = opts.library;
    this.log = opts.log;
    this.chromeDir = opts.chromeDir ?? CHROME_DIR;
    this.now = opts.now ?? Date.now;
    this.copyFile = opts.copyFile ?? ((from, to) => fs.copyFileSync(from, to));
  }

  /**
   * A missing Chrome file counts as zero. An unreadable one is logged and its part is marked `failed`; the
   * other parts still import. Throws only when Superbrowser's own library can't be written.
   */
  async importProfile(dir: string): Promise<LibraryImportResult> {
    const source = path.join(this.chromeDir, dir);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-chrome-'));
    try {
      const now = this.now();
      const bookmarks = this.importBookmarks(dir, source, tmp, now);
      const history = this.importHistory(dir, source, tmp, now);
      this.log(`profile ${dir}: imported ${bookmarks.added} Chrome bookmarks (${bookmarks.skipped} skipped) and `
        + `${history.added} visits to ${history.pages} pages (${history.skipped} skipped)`);
      return { bookmarks, history };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  private importBookmarks(dir: string, source: string, tmp: string, now: number): LibraryImportResult['bookmarks'] {
    const files: ChromeBookmarks[] = [];
    let failed = false;
    for (const name of BOOKMARK_FILES) {
      try {
        const copy = this.copyIfPresent(source, tmp, name);
        if (copy === null) continue;
        const parsed = parseChromeBookmarks(fs.readFileSync(copy, 'utf8'));
        if (parsed) files.push(parsed);
        else {
          failed = true;
          this.log(`profile ${dir}: Chrome's ${name} is unparsable; skipped`);
        }
      } catch (e) {
        failed = true;
        this.log(`profile ${dir}: reading Chrome's ${name} failed: ${message(e)}`);
      }
    }
    let result = { added: 0, skipped: 0, failed };
    if (files.length === 0) return result;
    this.library.updateBookmarks(dir, (tree) => {
      const merged = mergeChrome(tree, files, now);
      result = { added: merged.added, skipped: merged.skipped, failed };
      return merged.added > 0 ? merged.tree : tree;
    });
    return result;
  }

  private importHistory(dir: string, source: string, tmp: string, now: number): LibraryImportResult['history'] {
    let rows: ChromeVisitRow[];
    try {
      rows = this.readVisits(source, tmp);
    } catch (e) {
      this.log(`profile ${dir}: reading Chrome's History failed: ${message(e)}`);
      return { pages: 0, added: 0, skipped: 0, failed: true };
    }
    const mapped = mapChromeVisits(rows, now);
    if (mapped.visits.length === 0) return { pages: 0, added: 0, skipped: mapped.skipped, failed: false };
    const r = this.library.history(dir).importVisits(mapped.visits);
    return { pages: r.pages, added: r.added, skipped: mapped.skipped + r.skipped, failed: false };
  }

  /**
   * Reads a temp copy of History with its -wal/-journal. The copy is opened read-write so SQLite replays the
   * copied WAL (or rolls back the copied journal) into the copy; the original is never opened.
   */
  private readVisits(source: string, tmp: string): ChromeVisitRow[] {
    const copy = this.copyIfPresent(source, tmp, 'History');
    if (copy === null) return [];
    this.copyIfPresent(source, tmp, 'History-wal');
    this.copyIfPresent(source, tmp, 'History-journal');
    const db = new DatabaseSync(copy);
    try {
      return db.prepare(VISITS_SQL).all().map((r) => ({
        url: String(r.url ?? ''),
        title: typeof r.title === 'string' ? r.title : '',
        typed_count: Number(r.typed_count ?? 0) || 0,
        hidden: Number(r.hidden ?? 0) || 0,
        visit_time: String(r.visit_time ?? '0'),
      }));
    } finally {
      db.close();
    }
  }

  /**
   * Copies `<source>/<name>` into `tmp`; null when Chrome has no such file. Chrome may remove a -wal or
   * -journal at any moment, so a file that is gone by the time it is copied counts as absent too.
   */
  private copyIfPresent(source: string, tmp: string, name: string): string | null {
    const to = path.join(tmp, name);
    try {
      this.copyFile(path.join(source, name), to);
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === 'ENOENT') return null;
      throw e;
    }
    return to;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
