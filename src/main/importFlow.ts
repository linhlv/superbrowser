import { dialog, type BrowserWindow } from 'electron';
import type { ImportMode, ImportResult } from '../core/cookies.ts';
import type { Profile } from '../shared/types.ts';
import { ImportError, LoginImporter } from './importer.ts';
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
};

const EXPLANATION = 'Superbrowser will copy this profile\'s logins (cookies) from Google Chrome. macOS will ask to allow '
  + 'access to “Chrome Safe Storage” — click Always Allow. You can keep using these accounts in Chrome too; Google may '
  + 'occasionally sign one of them out.';

const logins = (n: number) => `${n} login${n === 1 ? '' : 's'}`;

/** The window-modal sheets around importing logins from Chrome. One import runs at a time. */
export class ImportFlow {
  private readonly deps: ImportFlowDeps;
  private readonly importer: LoginImporter;
  private explained = false;
  private busy = false;

  constructor(deps: ImportFlowDeps) {
    this.deps = deps;
    this.importer = new LoginImporter({ log: deps.log, jarOf: (dir) => profileSession(dir).cookies });
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

  /** The first-run offer. `done` runs whatever the answer (so it is asked once). */
  offerOnFirstRun(done: () => void): Promise<void> {
    return this.ask('Import your logins from Chrome for all profiles?', ['Import All', 'Not Now']).then((yes) => {
      done();
      if (yes) return this.importAll();
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
