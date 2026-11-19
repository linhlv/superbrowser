import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import { mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { isWebUrl } from './address.ts';
import type { ImportVisit } from './chromeLibrary.ts';
import type { HistoryRow } from '../shared/types.ts';
import { searchKey, splitWords, DAY_MS } from './searchText.ts';

export type HistoryEntry = { url: string; title: string; visitCount: number; typedCount: number; lastVisit: number; favicon: string | null };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS urls(
  id INTEGER PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '', search TEXT NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0, typed_count INTEGER NOT NULL DEFAULT 0, last_visit INTEGER NOT NULL, favicon TEXT);
CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY, url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE, time INTEGER NOT NULL, UNIQUE(url_id, time));
CREATE INDEX IF NOT EXISTS visits_time ON visits(time);`;

class CorruptError extends Error {}

// SQLITE_CORRUPT (11) and SQLITE_NOTADB (26) are the only failures that justify setting a database aside.
function isCorruption(e: unknown): boolean {
  if (e instanceof CorruptError) return true;
  const code = (e as { errcode?: unknown } | null)?.errcode;
  return code === 11 || code === 26;
}

function openChecked(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
    const row = db.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
    if (row?.quick_check !== 'ok') throw new CorruptError(`quick_check: ${row?.quick_check}`);
    db.exec(SCHEMA);
    return db;
  } catch (e) {
    try { db.close(); } catch { /* already unusable */ }
    throw e;
  }
}

export class HistoryDb {
  private db: DatabaseSync;
  private cache = new Map<string, StatementSync>();

  private constructor(db: DatabaseSync) { this.db = db; }

  static open(file: string, log: (msg: string) => void): HistoryDb {
    mkdirSync(dirname(file), { recursive: true });
    try {
      return new HistoryDb(openChecked(file));
    } catch (e) {
      if (!isCorruption(e)) throw e;
      const stamp = Date.now();
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(file + suffix)) renameSync(file + suffix, `${file}${suffix}.corrupt-${stamp}`);
      }
      log(`history database unreadable (${e instanceof Error ? e.message : e}); set aside as ${file}.corrupt-${stamp}`);
      return new HistoryDb(openChecked(file));
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }

  private urlId(url: string): number | null {
    const r = this.stmt('SELECT id FROM urls WHERE url = ?').get(url) as { id: number } | undefined;
    return r ? r.id : null;
  }

  private upsertUrl(url: string, time: number): number {
    this.stmt('INSERT OR IGNORE INTO urls(url, search, last_visit) VALUES (?, ?, ?)').run(url, searchKey(url + ' '), time);
    return this.urlId(url)!;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  recordVisit(url: string, time: number, typed: boolean): void {
    if (!isWebUrl(url)) return;
    this.transaction(() => {
      const id = this.upsertUrl(url, time);
      const ins = this.stmt('INSERT OR IGNORE INTO visits(url_id, time) VALUES (?, ?)').run(id, time);
      if (ins.changes > 0) {
        this.stmt('UPDATE urls SET visit_count = visit_count + 1, typed_count = typed_count + ?, last_visit = max(last_visit, ?) WHERE id = ?')
          .run(typed ? 1 : 0, time, id);
      }
    });
  }

  touch(url: string, time: number): void {
    this.stmt('UPDATE urls SET last_visit = max(last_visit, ?) WHERE url = ?').run(time, url);
  }

  setTitle(url: string, title: string): void {
    this.stmt('UPDATE urls SET title = ?, search = ? WHERE url = ?').run(title, searchKey(url + ' ' + title), url);
  }

  setFavicon(url: string, favicon: string): void {
    this.stmt('UPDATE urls SET favicon = ? WHERE url = ?').run(favicon, url);
  }

  importVisits(visits: ImportVisit[]): { added: number; pages: number; skipped: number } {
    return this.transaction(() => {
      let added = 0;
      let skipped = 0;
      const touched = new Set<number>();
      for (const v of visits) {
        if (!isWebUrl(v.url)) { skipped++; continue; }
        const id = this.upsertUrl(v.url, v.time);
        const ins = this.stmt('INSERT OR IGNORE INTO visits(url_id, time) VALUES (?, ?)').run(id, v.time);
        if (ins.changes > 0) {
          added++;
          touched.add(id);
          this.stmt('UPDATE urls SET visit_count = visit_count + 1, last_visit = max(last_visit, ?) WHERE id = ?').run(v.time, id);
        } else {
          skipped++;
        }
        this.stmt('UPDATE urls SET typed_count = max(typed_count, ?) WHERE id = ?').run(v.typedCount, id);
        if (v.title !== '') {
          this.stmt("UPDATE urls SET title = ?, search = ? WHERE id = ? AND title = ''").run(v.title, searchKey(v.url + ' ' + v.title), id);
        }
      }
      return { added, pages: touched.size, skipped };
    });
  }

  private wordClause(n: number): string {
    return Array.from({ length: n }, () => 'instr(search, ?) > 0').join(' AND ');
  }

  candidates(words: string[], limit: number): HistoryEntry[] {
    if (words.length === 0) return [];
    const sql = `SELECT url, title, visit_count, typed_count, last_visit, favicon FROM urls WHERE ${this.wordClause(words.length)}
      ORDER BY typed_count DESC, visit_count DESC, last_visit DESC LIMIT ?`;
    const rows = this.stmt(sql).all(...words, limit) as Array<{ url: string; title: string; visit_count: number; typed_count: number; last_visit: number; favicon: string | null }>;
    return rows.map((r) => ({ url: r.url, title: r.title, visitCount: r.visit_count, typedCount: r.typed_count, lastVisit: r.last_visit, favicon: r.favicon }));
  }

  private pageRows(words: string[], before: number | null, exact: number | null, limit: number, tzOffsetMin: number): HistoryRow[] {
    const filter = words.length ? `WHERE url_id IN (SELECT id FROM urls WHERE ${this.wordClause(words.length)})` : '';
    // day = floor((time - tz) / DAY_MS); SQLite integer division truncates, so floor by hand.
    const sql = `SELECT u.url AS url, u.title AS title, g.t AS t, g.day AS day, u.favicon AS favicon FROM (
        SELECT url_id, day, MAX(time) AS t FROM (
          SELECT url_id, time, (x - (((x % ${DAY_MS}) + ${DAY_MS}) % ${DAY_MS})) / ${DAY_MS} AS day FROM (
            SELECT url_id, time, time - ? AS x FROM visits ${filter}))
        GROUP BY url_id, day) g
      JOIN urls u ON u.id = g.url_id
      WHERE (? IS NULL OR g.t < ?) AND (? IS NULL OR g.t = ?)
      ORDER BY g.t DESC, g.url_id DESC LIMIT ?`;
    const rows = this.stmt(sql).all(tzOffsetMin * 60_000, ...words, before, before, exact, exact, limit) as Array<{ url: string; title: string; t: number; day: number; favicon: string | null }>;
    return rows.map((r) => ({ url: r.url, title: r.title, time: r.t, day: r.day, favicon: r.favicon }));
  }

  /** A page never splits rows with equal times, so `before = last.time` loses nothing. */
  page(query: string, before: number | null, limit: number, tzOffsetMin: number): { rows: HistoryRow[]; more: boolean } {
    const words = splitWords(query);
    const rows = this.pageRows(words, before, null, limit + 1, tzOffsetMin);
    if (rows.length <= limit) return { rows, more: false };
    const lastT = rows[limit - 1].time;
    const kept = rows.slice(0, limit).filter((r) => r.time !== lastT);
    const tied = this.pageRows(words, null, lastT, -1, tzOffsetMin);
    const out = [...kept, ...tied];
    const more = this.pageRows(words, lastT, null, 1, tzOffsetMin).length > 0;
    return { rows: out, more };
  }

  deleteUrl(url: string): void {
    this.stmt('DELETE FROM urls WHERE url = ?').run(url);
  }

  clear(): void {
    this.transaction(() => { this.db.exec('DELETE FROM visits; DELETE FROM urls'); });
  }

  prune(cutoffMs: number): number {
    return this.transaction(() => {
      const n = Number(this.stmt('DELETE FROM visits WHERE time < ?').run(cutoffMs).changes);
      this.db.exec('DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits)');
      return n;
    });
  }

  faviconsFor(urls: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    const s = this.stmt('SELECT favicon FROM urls WHERE url = ?');
    for (const url of urls) {
      const r = s.get(url) as { favicon: string | null } | undefined;
      if (r?.favicon) out[url] = r.favicon;
    }
    return out;
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }
}
