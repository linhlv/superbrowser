import { isWebUrl } from './address.ts';

/** navigationHistory: the active index and every entry's URL. */
export type Nav = { url: string; index: number; entries: string[] };
export type VisitKind = 'visit' | 'revisit' | 'ignore';

type TabState = { prev: Nav | null; restored: boolean; typed: boolean };

function withoutFragment(url: string): string {
  const i = url.indexOf('#');
  return i < 0 ? url : url.slice(0, i);
}

/** Decides whether a tab's navigation is a new visit, a Back/Forward revisit, or ignored. */
export class VisitTracker {
  private tabs = new Map<number, TabState>();

  opened(tabId: number, restored: boolean): void {
    this.tabs.set(tabId, { prev: null, restored, typed: false });
  }

  markTyped(tabId: number): void {
    this.state(tabId).typed = true;
  }

  navigated(tabId: number, nav: Nav): { kind: VisitKind; typed: boolean } {
    const s = this.state(tabId);
    const { prev, restored, typed } = s;
    s.prev = nav;
    s.restored = false;
    s.typed = false;

    let kind: VisitKind;
    if (!isWebUrl(nav.url) || restored) kind = 'ignore';
    else if (
      prev &&
      prev.index !== nav.index &&
      prev.entries.length === nav.entries.length &&
      prev.entries[nav.index] === nav.url
    ) kind = 'revisit';
    else if (prev && withoutFragment(prev.url) === withoutFragment(nav.url)) kind = 'ignore';
    else kind = 'visit';
    return { kind, typed: kind === 'visit' && typed };
  }

  forget(tabId: number): void {
    this.tabs.delete(tabId);
  }

  private state(tabId: number): TabState {
    let s = this.tabs.get(tabId);
    if (!s) {
      s = { prev: null, restored: false, typed: false };
      this.tabs.set(tabId, s);
    }
    return s;
  }
}
