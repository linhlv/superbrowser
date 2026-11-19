import path from 'node:path';
import { loadBookmarks, profileDataDir, saveBookmarks } from '../core/bookmarkStore.ts';
import type { BookmarkTree } from '../core/bookmarks.ts';
import { HISTORY_RETENTION_DAYS } from '../core/chromeLibrary.ts';
import { HistoryDb } from '../core/history.ts';
import { DAY_MS } from '../core/searchText.ts';

/**
 * The only way to a profile's bookmarks and history: `<baseDir>/Profiles/<chrome profile dir>/history.db`
 * and `bookmarks.json`, one set per profile, opened or loaded on first use and cached.
 */
export class Library {
  private readonly baseDir: string;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private readonly dbs = new Map<string, HistoryDb>();
  private readonly trees = new Map<string, BookmarkTree>();

  constructor(baseDir: string, log: (msg: string) => void, now: () => number = Date.now) {
    this.baseDir = baseDir;
    this.log = log;
    this.now = now;
  }

  /** Opened on first use and pruned to the retention window then. Throws if it can't be opened (not cached). */
  history(dir: string): HistoryDb {
    const open = this.dbs.get(dir);
    if (open) return open;
    const db = HistoryDb.open(path.join(profileDataDir(this.baseDir, dir), 'history.db'), this.log);
    this.dbs.set(dir, db);
    this.pruneLogged(dir, db);
    return db;
  }

  bookmarks(dir: string): BookmarkTree {
    let tree = this.trees.get(dir);
    if (!tree) {
      tree = loadBookmarks(this.bookmarksFile(dir));
      this.trees.set(dir, tree);
    }
    return tree;
  }

  /** Saves at once (atomically) when `fn` returns a different tree. */
  updateBookmarks(dir: string, fn: (t: BookmarkTree) => BookmarkTree): BookmarkTree {
    const current = this.bookmarks(dir);
    const next = fn(current);
    if (next !== current) {
      saveBookmarks(this.bookmarksFile(dir), next);
      this.trees.set(dir, next);
    }
    return next;
  }

  pruneAll(): void {
    for (const [dir, db] of this.dbs) this.pruneLogged(dir, db);
  }

  closeAll(): void {
    for (const [dir, db] of this.dbs) {
      try {
        db.close();
      } catch (e) {
        this.log(`could not close history of ${dir}: ${message(e)}`);
      }
    }
    this.dbs.clear();
  }

  /** A failed prune leaves the database usable; it is tried again in a day. */
  private pruneLogged(dir: string, db: HistoryDb): void {
    try {
      const n = db.prune(this.now() - HISTORY_RETENTION_DAYS * DAY_MS);
      if (n > 0) this.log(`pruned ${n} history visits older than ${HISTORY_RETENTION_DAYS} days from ${dir}`);
    } catch (e) {
      this.log(`could not prune history of ${dir}: ${message(e)}`);
    }
  }

  private bookmarksFile(dir: string): string {
    return path.join(profileDataDir(this.baseDir, dir), 'bookmarks.json');
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
