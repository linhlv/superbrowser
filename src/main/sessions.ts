import path from 'node:path';
import { dialog, session, type BrowserWindow, type Session, type WebPreferences } from 'electron';
import type { AppState, Decision } from '../core/appState.ts';
import { chromeMajor, rewriteClientHints, userAgent } from '../core/identity.ts';
import {
  decide, describeRequest, permissionKeys, policyFor, PromptQueue, remember, siteOrigin,
  type PermissionPrompt, type Verdict,
} from '../core/permissions.ts';

/** What profile sessions need from the app; later tasks add the download UI. */
export type SessionContext = {
  log: (msg: string) => void;
  /** The window permission sheets attach to; null once it is gone (requests are then refused). */
  mainWindow(): BrowserWindow | null;
  /** The profile whose tabs are on screen, if any. */
  shownProfile(): string | null;
  profileName(dir: string): string;
  /** Remembered site decisions per profile; `setPermissions` stores (and saves) a new value. */
  getPermissions(): AppState['permissions'];
  setPermissions(p: AppState['permissions']): void;
};

let context: SessionContext | null = null;
const sessions = new Map<string, Session>();
/** Answers given with "Remember for this site" unchecked: they hold until the app quits. */
let forThisRun: AppState['permissions'] = {};
const prompts = new PromptQueue(showPermissionSheet, currentVerdict);

/** Call once at startup, before the first `profileSession`. */
export function configureSessions(ctx: SessionContext): void {
  context = ctx;
}

/** The only way to get a profile's session: `persist:<chrome profile dir>`, set up on first use. */
export function profileSession(dir: string): Session {
  const existing = sessions.get(dir);
  if (existing) return existing;
  if (!context) throw new Error('configureSessions() must run before profileSession()');

  const s = session.fromPartition('persist:' + dir);
  const major = chromeMajor(process.versions.chrome);
  s.setUserAgent(userAgent(major));
  s.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: rewriteClientHints(details.requestHeaders, major) });
  });
  installPermissionHandlers(s, dir);
  // dist/main.cjs → dist/preload/frame.cjs: passkey requests fail fast in every frame (see pageWebPreferences).
  s.registerPreloadScript({ type: 'frame', id: 'superbrowser-passkey', filePath: path.join(__dirname, 'preload', 'frame.cjs') });
  sessions.set(dir, s);
  context.log(`session ready for profile ${dir}`);
  return s;
}

/**
 * For every view or window showing a profile's pages. `nodeIntegrationInSubFrames` only makes the session's
 * frame preload (passkey fail-fast) run in iframes too; sandboxed, so pages still get no Node.
 */
export function pageWebPreferences(dir: string): WebPreferences {
  return { session: profileSession(dir), sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true };
}

/** Never granted silently: see `policyFor`. Asked permissions show one sheet at a time on the main window. */
function installPermissionHandlers(s: Session, dir: string): void {
  s.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const keys = permissionKeys(permission, mediaTypes);
    const policy = policyFor(permission);
    const origin = siteOrigin(details.requestingUrl);
    if (policy !== 'ask') return callback(policy === 'allow');
    if (origin === null) return callback(false); // file:, about:, data:… pages are never asked
    void prompts.request({ dir, origin, keys }).then((d) => callback(d === 'allow'));
  });

  // Synchronous and never asks: answers what is already decided (e.g. Notification.permission).
  s.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const policy = policyFor(permission);
    if (policy !== 'ask') return policy === 'allow';
    const origin = siteOrigin(requestingOrigin);
    if (origin === null) return false;
    const media = details.mediaType === 'video' || details.mediaType === 'audio' ? [details.mediaType] : undefined;
    return currentVerdict({ dir, origin, keys: permissionKeys(permission, media) }) === 'allow';
  });

  // Screen sharing goes through the macOS picker (macOS 15+). Without it there is no picker of our own: refuse.
  s.setDisplayMediaRequestHandler((_request, callback) => {
    context?.log('screen sharing needs the macOS system picker (macOS 15 or later); refused');
    callback(null);
  }, { useSystemPicker: true });
}

/** What is decided for a prompt without asking: remembered decisions first, then this run's answers. */
function currentVerdict(p: PermissionPrompt): Verdict {
  if (!context) return 'deny';
  const remembered = decide(context.getPermissions()[p.dir], p.origin, p.keys, 'ask');
  return remembered !== 'ask' ? remembered : decide(forThisRun[p.dir], p.origin, p.keys, 'ask');
}

/** The permission sheet on the main window; stores the answer. No window: refused, nothing stored. */
async function showPermissionSheet(p: PermissionPrompt): Promise<Decision> {
  const win = context?.mainWindow();
  if (!context || !win || win.isDestroyed()) return 'deny';
  const name = context.profileName(p.dir);
  // A request from a profile that is not on screen must not look like it came from the one that is.
  const detail = context.shownProfile() === p.dir ? name : `Profile: ${name}`;
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question',
    message: describeRequest(p.origin, p.keys),
    detail,
    buttons: ['Allow', 'Block'],
    defaultId: 1, // Return blocks: a keystroke meant for the page must not grant camera or location
    cancelId: 1,
    checkboxLabel: 'Remember for this site',
    checkboxChecked: true,
  });
  const d: Decision = response === 0 ? 'allow' : 'deny';
  if (checkboxChecked) context.setPermissions(remember(context.getPermissions(), p.dir, p.origin, p.keys, d));
  else forThisRun = remember(forThisRun, p.dir, p.origin, p.keys, d);
  context.log(`${p.origin} ${p.keys.join('+')} in profile ${p.dir}: ${d}${checkboxChecked ? ' (remembered)' : ''}`);
  return d;
}
