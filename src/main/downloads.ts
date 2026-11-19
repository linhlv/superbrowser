import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { shell, type DownloadItem } from 'electron';
import { recordDownload, uniqueDownloadPath } from '../core/downloads.ts';
import type { DownloadState } from '../shared/types.ts';

export type DownloadsContext = {
  log: (msg: string) => void;
  /** Where downloads are saved (`app.getPath('downloads')`). */
  downloadsDir(): string;
  profileName(dir: string): string;
  /** The sidebar's list changed (a copy; at most ~4 calls a second while bytes arrive). */
  onDownloadsChanged(list: DownloadState[]): void;
  notify(title: string, body: string): void;
};

/** Progress pushes to the UI are coalesced to one per this many ms; starts, ends and cancels go at once. */
const PUSH_INTERVAL_MS = 250;

/**
 * Every profile's downloads: saved without asking into the downloads folder under a unique name, kept in
 * one list (each profile's newest 20 of this run, hidden profiles included; the sidebar shows the shown
 * profile's), with a notification naming the profile when one completes.
 */
export class Downloads {
  private readonly ctx: DownloadsContext;
  private list: DownloadState[] = [];
  /** Save paths of downloads still running: taken, though the file may not exist yet. */
  private readonly reserved = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DownloadsContext) {
    this.ctx = ctx;
  }

  /** Call from the session's `will-download`, synchronously (the save path must be set before it returns). */
  track(item: DownloadItem, dir: string): void {
    const savePath = uniqueDownloadPath(this.ctx.downloadsDir(), item.getFilename(), (p) => existsSync(p) || this.reserved.has(p));
    item.setSavePath(savePath);
    this.reserved.add(savePath);
    const id = randomUUID();
    const filename = path.basename(savePath);
    const snapshot = (): DownloadState => ({
      id, dir, filename, path: savePath, state: item.getState(), received: item.getReceivedBytes(), total: item.getTotalBytes(),
    });
    this.ctx.log(`downloading ${item.getURL().slice(0, 200)} to ${savePath} (profile ${dir})`);
    this.record(snapshot(), true);
    item.on('updated', () => this.record(snapshot(), false));
    item.once('done', (_e, state) => {
      this.reserved.delete(savePath);
      this.record(snapshot(), true);
      if (state === 'completed') this.ctx.notify(`Downloaded ${filename}`, `Profile: ${this.ctx.profileName(dir)}`);
      else this.ctx.log(`download of ${filename} ${state}`);
    });
  }

  /** Shows a listed download in Finder; ids not in the list (unknown, or older than its profile's newest 20) are ignored. */
  reveal(id: string): void {
    const d = this.list.find((x) => x.id === id);
    if (!d) {
      this.ctx.log(`ignored reveal of unknown download ${id.slice(0, 64)}`);
      return;
    }
    if (existsSync(d.path)) shell.showItemInFolder(d.path);
    else void shell.openPath(path.dirname(d.path)); // cancelled or not written yet: the folder it would be in
  }

  private record(d: DownloadState, now: boolean): void {
    this.list = recordDownload(this.list, d);
    if (now) this.push();
    else this.timer ??= setTimeout(() => this.push(), PUSH_INTERVAL_MS);
  }

  private push(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.ctx.onDownloadsChanged([...this.list]);
  }
}
