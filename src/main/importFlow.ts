import { dialog, type BrowserWindow } from 'electron';
import { librarySummaryLine } from '../core/chromeLibrary.ts';
import type { ImportMode, ImportResult } from '../core/cookies.ts';
import type { Profile } from '../shared/types.ts';
import { ImportError, LoginImporter } from './importer.ts';
import { LibraryImporter, type LibraryAccess } from './libraryImport.ts';
import { profileSession } from './sessions.ts';

export type ImportFlowDeps = {
  window: BrowserWindow;
  log: (msg: string) => void;
  /** The profile shown now. */
  activeProfile(): Profile | null;
  /** Visible profiles in bar order. */
  visibleProfiles(): Profile[];
  /** A profile's cookies changed: reload its loaded tabs. */
  reloadProfile(dir: string): void;
  /** Where imported bookmarks and history go. */
  library: LibraryAccess;
  /** Bookmarks or history were imported: the UI refreshes what it shows of them. */
  libraryChanged(): void;
};

// "Allow", not "Always Allow": the prompt comes from /usr/bin/security, so Always Allow would let any program
// read Chrome's cookie key through it without asking.
const EXPLANATION = 'Superbrowser will copy this profile\'s logins (cookies) from Google Chrome. macOS will ask to allow '
  + 'access to “Chrome Safe Storage” — click Allow (not Always Allow). You can keep using these accounts in Chrome too; '
  + 'Google may occasionally sign one of them out.';

const logins = (n: number) => `${n} login${n === 1 ? '' : 's'}`;

/** The window-modal sheets around importing logins, and bookmarks and history, from Chrome. One import runs at a time. */
export class ImportFlow {
  private readonly deps: ImportFlowDeps;
  private readonly importer: LoginImporter;
  private readonly libraryImporter: LibraryImporter;
  private explained = false;
  private busy = false;

  constructor(deps: ImportFlowDeps) {
    this.deps = deps;
    this.importer = new LoginImporter({ log: deps.log, jarOf: (dir) => profileSession(dir).cookies });
    this.libraryImporter = new LibraryImporter({ library: deps.library, log: deps.log });
  }

  /** Imports the shown profile's logins: 'add' keeps cookies the session has; 'replace' (confirmed first) overwrites them. */
  importCurrent(mode: ImportMode): Promise<void> {
    return this.exclusive(async () => {
      const profile = this.deps.activeProfile();
      if (!profile) return;
      if (mode === 'replace' && !await this.ask(
        'Replace this profile\'s logins with Chrome\'s current ones? Use this if Superbrowser got signed out.',
        ['Replace', 'Cancel'],
      )) return;
      if (!await this.prepare()) return;
      try {
        const result = await this.importProfile(profile, mode);
        await this.sheet('info', `Imported ${logins(result.set)} for ${profile.name}.`, `${result.skipped} skipped, ${result.failed} failed.`);
      } catch (e) {
        await this.showError(e, profile);
      }
    });
  }

  /** Adds every visible profile's logins, in bar order, and shows one summary. */
  importAll(): Promise<void> {
    return this.exclusive(async () => {
      const profiles = this.deps.visibleProfiles();
      if (profiles.length === 0 || !await this.prepare()) return;
      const lines: string[] = [];
      let failures = 0;
      for (const profile of profiles) {
        try {
          const r = await this.importProfile(profile, 'add');
          lines.push(`${profile.name}: ${logins(r.set)} imported, ${r.skipped} skipped, ${r.failed} failed.`);
        } catch (e) {
          failures++;
          lines.push(`${profile.name}: ${e instanceof Error ? e.message : String(e)}`);
          if (!(e instanceof ImportError)) this.deps.log(`importing ${profile.dir} failed: ${String(e)}`);
        }
      }
      const title = failures === profiles.length ? 'No logins were imported.' : 'Imported logins from Chrome.';
      await this.sheet(failures > 0 ? 'warning' : 'info', title, lines.join('\n'));
    });
  }

  /**
   * Adds every visible profile's Chrome bookmarks and history, in bar order, and shows one summary.
   * Needs no Keychain, touches no cookies and reloads no tab.
   */
  importLibraryAll(): Promise<void> {
    return this.exclusive(async () => {
      const profiles = this.deps.visibleProfiles();
      if (profiles.length === 0) return;
      const lines: string[] = [];
      let failures = 0;
      let changed = false;
      for (const profile of profiles) {
        try {
          const r = await this.libraryImporter.importProfile(profile.dir);
          if (r.bookmarks.added > 0 || r.history.added > 0) changed = true;
          lines.push(librarySummaryLine(profile.name, r));
        } catch (e) {
          failures++;
          lines.push(`${profile.name}: ${e instanceof Error ? e.message : String(e)}`);
          this.deps.log(`importing bookmarks and history of ${profile.dir} failed: ${String(e)}`);
        }
      }
      // A failed profile may have saved its bookmarks before its history failed: refresh then too.
      if (changed || failures > 0) this.deps.libraryChanged();
      await this.sheet(failures > 0 ? 'warning' : 'info', 'Imported bookmarks and history from Chrome.', lines.join('\n'));
    });
  }

  /**
   * The first-run offer. `done` runs whatever the answer (so it is asked once). Bookmarks and history import
   * after the logins, even when the login import was cancelled or failed (they need no Keychain).
   */
  offerOnFirstRun(done: () => void): Promise<void> {
    return this.ask('Import your logins, bookmarks and history from Chrome for all profiles?', ['Import All', 'Not Now'])
      .then(async (yes) => {
        done();
        if (!yes) return;
        try {
          await this.importAll();
        } catch (e) {
          this.deps.log(`importing logins failed: ${String(e)}`);
        }
        await this.importLibraryAll();
      });
  }

  private async exclusive(work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.deps.log('an import is already running');
      return;
    }
    this.busy = true;
    try {
      await work();
    } finally {
      this.busy = false;
    }
  }

  /** The explanation (first import of a run) and Chrome's key, before any session is touched. False: stop. */
  private async prepare(): Promise<boolean> {
    if (!this.explained) {
      if (!await this.ask(EXPLANATION, ['Import', 'Cancel'])) return false;
      this.explained = true;
    }
    try {
      await this.importer.key();
      return true;
    } catch (e) {
      await this.showError(e, null);
      return false;
    }
  }

  private async importProfile(profile: Profile, mode: ImportMode): Promise<ImportResult> {
    const result = await this.importer.importLogins(profile.dir, mode);
    if (result.set > 0) this.deps.reloadProfile(profile.dir);
    return result;
  }

  private async showError(e: unknown, profile: Profile | null): Promise<void> {
    if (e instanceof ImportError) {
      await this.sheet('warning', e.message, e.detail);
      return;
    }
    this.deps.log(`importing ${profile?.dir ?? 'logins'} failed: ${String(e)}`);
    await this.sheet('warning', `Importing logins${profile ? ` for ${profile.name}` : ''} failed.`, e instanceof Error ? e.message : String(e));
  }

  /** True when the first button was chosen. */
  private async ask(message: string, buttons: [string, string]): Promise<boolean> {
    const { response } = await dialog.showMessageBox(this.deps.window, { type: 'question', message, buttons, defaultId: 0, cancelId: 1 });
    return response === 0;
  }

  private async sheet(type: 'info' | 'warning', message: string, detail: string): Promise<void> {
    await dialog.showMessageBox(this.deps.window, { type, message, detail, buttons: ['OK'] });
  }
}
