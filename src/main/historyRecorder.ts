import { isWebUrl } from '../core/address.ts';
import { VisitTracker, type Nav } from '../core/visits.ts';
import type { Library } from './library.ts';

/** What `TabManager` reports about its tabs' pages. */
export type VisitSink = {
  opened(dir: string, tabId: number, restored: boolean): void;
  navigated(dir: string, tabId: number, nav: Nav): void;
  titled(dir: string, url: string, title: string): void;
  favicon(dir: string, url: string, favicon: string): void;
  closed(tabId: number): void;
  /** The icon history remembers for `url` (its own, else its origin's), shown until the page reports one; null if none. */
  savedFavicon(dir: string, url: string): string | null;
};

/**
 * Turns tab navigations into each profile's history (see `VisitTracker` for what counts as a visit).
 * Every error is logged here: a history problem must never break a tab.
 */
export class HistoryRecorder implements VisitSink {
  private readonly library: Pick<Library, 'history'>;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private readonly tracker = new VisitTracker();
  /** Called with the profile after a visit or title is recorded there (favicons don't count). */
  onRecorded: (dir: string) => void = () => {};

  constructor(library: Pick<Library, 'history'>, log: (msg: string) => void, now: () => number = Date.now) {
    this.library = library;
    this.log = log;
    this.now = now;
  }

  /** The tab's next navigation comes from the address field. */
  markTyped(tabId: number): void {
    this.guard('marking a typed navigation', () => this.tracker.markTyped(tabId));
  }

  opened(_dir: string, tabId: number, restored: boolean): void {
    this.guard('tracking a tab', () => this.tracker.opened(tabId, restored));
  }

  navigated(dir: string, tabId: number, nav: Nav): void {
    this.guard(`recording a visit in ${dir}`, () => {
      const { kind, typed } = this.tracker.navigated(tabId, nav);
      if (kind === 'visit') this.library.history(dir).recordVisit(nav.url, this.now(), typed);
      else if (kind === 'revisit') this.library.history(dir).touch(nav.url, this.now());
      else return;
      this.onRecorded(dir);
    });
  }

  titled(dir: string, url: string, title: string): void {
    if (!isWebUrl(url)) return;
    this.guard(`recording a title in ${dir}`, () => {
      this.library.history(dir).setTitle(url, title);
      this.onRecorded(dir);
    });
  }

  favicon(dir: string, url: string, favicon: string): void {
    if (!isWebUrl(url)) return;
    this.guard(`recording a favicon in ${dir}`, () => this.library.history(dir).setFavicon(url, favicon));
  }

  savedFavicon(dir: string, url: string): string | null {
    if (!isWebUrl(url)) return null;
    let icon: string | null = null;
    this.guard(`reading a favicon in ${dir}`, () => { icon = this.library.history(dir).faviconForPage(url); });
    return icon;
  }

  closed(tabId: number): void {
    this.guard('forgetting a tab', () => this.tracker.forget(tabId));
  }

  private guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.log(`history: ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
