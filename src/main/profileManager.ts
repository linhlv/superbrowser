import type { BrowserWindow } from 'electron';
import type { AppState } from '../core/appState.ts';
import { arrangeProfiles, hideProfile, hidesEveryProfile, moveProfile } from '../core/profiles.ts';
import type { Profile } from '../shared/types.ts';
import { openProfileInChrome } from './chrome.ts';
import { buildProfileMenu } from './menu.ts';
import type { TabManager } from './tabManager.ts';

export type ProfileManagerDeps = {
  state: AppState;
  tabs: TabManager;
  window: BrowserWindow;
  log: (msg: string) => void;
  /** The visible or hidden profiles changed: rebuild the application menu (⌃N, Show Hidden Profiles). */
  rebuildMenu(): void;
  saveAndPush(): void;
};

/**
 * The profiles' order and hidden set (`state.profileOrder`, `state.hiddenProfiles`) and what follows them:
 * the profiles TabManager shows, hidden profiles' tabs muted, the menu, and the profile dot's right-click menu.
 * A hidden profile's tabs stay (in TabManager and in `state.tabs`) so unhiding brings them back.
 */
export class ProfileManager {
  private readonly deps: ProfileManagerDeps;
  private visibleProfiles: Profile[] = [];
  private hiddenProfiles: Profile[] = [];
  private visibleDirs = new Set<string>();

  constructor(deps: ProfileManagerDeps) {
    this.deps = deps;
    this.apply();
    if (this.visibleProfiles.length === 0) deps.log('no Chrome profiles found');
  }

  /** Visible profiles in bar order (⌃1…⌃9 follow it). */
  get visible(): Profile[] { return this.visibleProfiles; }
  get hidden(): Profile[] { return this.hiddenProfiles; }
  /** The visible profiles' dirs: the only ones UI commands may name. Replaced on every change. */
  get dirs(): ReadonlySet<string> { return this.visibleDirs; }

  unhide(dir: string): void {
    const { state } = this.deps;
    state.hiddenProfiles = state.hiddenProfiles.filter((d) => d !== dir);
    this.changed();
  }

  /** The profile dot's right-click menu: move, hide, open in Chrome. */
  showMenu(dir: string): void {
    const { state, window, log } = this.deps;
    const order = (step: -1 | 1) => moveProfile(state.knownProfiles, state.profileOrder, state.hiddenProfiles, dir, step);
    const hidden = () => hideProfile(state.knownProfiles, state.hiddenProfiles, dir);
    buildProfileMenu({
      canMoveLeft: order(-1) !== null,
      canMoveRight: order(1) !== null,
      canHide: hidden() !== null,
      move: (step) => {
        const next = order(step);
        if (next) { state.profileOrder = next; this.changed(); }
      },
      hide: () => {
        const next = hidden();
        if (next) { state.hiddenProfiles = next; this.changed(); }
      },
      openInChrome: () => openProfileInChrome(dir, log),
    }).popup({ window });
  }

  /** Recomputes the lists from state and hands them to TabManager (which profiles it shows, which are muted). */
  private apply(): void {
    const { state, tabs, log } = this.deps;
    if (hidesEveryProfile(state.knownProfiles, state.hiddenProfiles)) {
      log('every profile was hidden; showing them all');
      state.hiddenProfiles = [];
    }
    const arranged = arrangeProfiles(state.knownProfiles, state.profileOrder, state.hiddenProfiles);
    this.visibleProfiles = arranged.visible;
    this.hiddenProfiles = arranged.hidden;
    this.visibleDirs = new Set(arranged.visible.map((p) => p.dir));
    tabs.setProfiles(arranged.visible.map((p) => p.dir), state.tabs);
    for (const p of arranged.visible) tabs.setProfileMuted(p.dir, false);
    for (const p of arranged.hidden) tabs.setProfileMuted(p.dir, true);
  }

  /** After the order or the hidden set changed: bar, ⌃N, menu, accepted commands and the shown profile follow. */
  private changed(): void {
    const { tabs, rebuildMenu, saveAndPush } = this.deps;
    this.apply();
    rebuildMenu();
    const first = this.visibleProfiles[0];
    if (!this.visibleDirs.has(tabs.snapshot().dir) && first) {
      tabs.showProfile(first.dir); // saves and pushes via TabManager's onChange
    } else {
      saveAndPush();
    }
  }
}
