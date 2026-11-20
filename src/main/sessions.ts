import path from 'node:path';
import { app, dialog, session, webContents, type BrowserWindow, type Session, type WebContents, type WebPreferences } from 'electron';
import type { AppState, Decision } from '../core/appState.ts';
import { acceptLanguages, parseAcceptCh, platformVersion, withClientHints, type HintValues } from '../core/clientHints.ts';
import { chromeMajor, userAgent } from '../core/identity.ts';
import {
  describeRequest, permissionKeys, policyFor, PromptQueue, siteOrigin, storeAnswer, verdictFor,
  type PermissionPrompt, type Verdict,
} from '../core/permissions.ts';
import { PAGE_WEB_PREFERENCES } from '../core/tabs.ts';
import { Downloads, type DownloadsContext } from './downloads.ts';

/** What profile sessions need from the app. */
export type SessionContext = DownloadsContext & {
  /** The window permission sheets attach to; null once it is gone (requests are then refused). */
  mainWindow(): BrowserWindow | null;
  /** The profile whose tabs are on screen, if any. */
  shownProfile(): string | null;
  profileName(dir: string): string;
  /** Saved site decisions per profile (only Allows are saved); `setPermissions` stores (and saves) a new value. */
  getPermissions(): AppState['permissions'];
  setPermissions(p: AppState['permissions']): void;
};

let context: SessionContext | null = null;
let downloads: Downloads | null = null;
const sessions = new Map<string, Session>();
/** Blocks, and Allows given with "Remember for this site" unchecked: they hold until the app quits. */
let forThisRun: AppState['permissions'] = {};
/** Main-frame page loads per tab, so a request from a page that has since gone can be dropped. */
const navigations = new WeakMap<WebContents, number>();
const prompts = new PromptQueue(showPermissionSheet, currentVerdict, stillWanted);

/** Call once at startup, before the first `profileSession`. */
export function configureSessions(ctx: SessionContext): void {
  context = ctx;
  downloads = new Downloads(ctx);
}

/** The sidebar's Downloads list was clicked: shows that file in Finder (only files Superbrowser saved). */
export function revealDownload(id: string): void {
  downloads?.reveal(id);
}

/** The only way to get a profile's session: `persist:<chrome profile dir>`, set up on first use. */
export function profileSession(dir: string): Session {
  const existing = sessions.get(dir);
  if (existing) return existing;
  if (!context) throw new Error('configureSessions() must run before profileSession()');

  const s = session.fromPartition('persist:' + dir);
  const hints = hintValues();
  // Accept-Language and navigator.languages like Chrome's (each system language, then its base language).
  s.setUserAgent(userAgent(hints.major), acceptLanguages(app.getPreferredSystemLanguages()));
  // Client hints like Chrome's: on page loads too, and the high-entropy ones an origin asked for with Accept-CH
  // (remembered per origin for this run, in this profile's session only).
  const asked = new Map<string, Set<string>>();
  s.webRequest.onHeadersReceived({ urls: ['https://*/*', 'http://*/*'] }, (details, callback) => {
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      const acceptCh = Object.entries(details.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'accept-ch')?.[1];
      if (acceptCh !== undefined) {
        const origin = originOf(details.url);
        if (origin !== null) asked.set(origin, new Set(parseAcceptCh(acceptCh.join(','))));
      }
    }
    callback({});
  });
  s.webRequest.onBeforeSendHeaders((details, callback) => {
    const requested = asked.get(originOf(details.url) ?? '') ?? new Set<string>();
    callback({ requestHeaders: withClientHints(details.requestHeaders, details.url, hints, requested) });
  });
  installPermissionHandlers(s, dir);
  // Popups and background profiles included: every download of this profile is saved and listed.
  s.on('will-download', (_e, item) => downloads?.track(item, dir));
  // dist/main.cjs → dist/preload/frame.cjs, in every frame (see pageWebPreferences): passkey requests fail fast,
  // and navigator.userAgentData names Google Chrome like the headers above.
  s.registerPreloadScript({ type: 'frame', id: 'superbrowser-frame', filePath: path.join(__dirname, 'preload', 'frame.cjs') });
  sessions.set(dir, s);
  context.log(`session ready for profile ${dir}`);
  return s;
}

/** The values client hints carry, from this Electron's Chromium and this Mac. */
function hintValues(): HintValues {
  const fullVersion = process.versions.chrome;
  return {
    major: chromeMajor(fullVersion),
    fullVersion,
    platformVersion: platformVersion(process.getSystemVersion()),
    arch: process.arch === 'arm64' ? 'arm' : 'x86',
    bitness: '64',
  };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * For every view showing a profile's pages (popups get the same via `popupWindowOptions`). `nodeIntegrationInSubFrames`
 * only makes the session's frame preload (passkey fail-fast) run in iframes too; sandboxed, so pages still get no Node.
 */
export function pageWebPreferences(dir: string): WebPreferences {
  return { session: profileSession(dir), ...PAGE_WEB_PREFERENCES };
}

/** Never granted silently: see `policyFor`. Asked permissions show one sheet at a time on the main window. */
function installPermissionHandlers(s: Session, dir: string): void {
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const keys = permissionKeys(permission, mediaTypes);
    const policy = policyFor(permission);
    const origin = siteOrigin(details.requestingUrl);
    if (policy !== 'ask') return callback(policy === 'allow');
    if (origin === null) return callback(false); // file:, about:, data:… pages are never asked
    const prompt = { dir, origin, keys, source: wc.id, navigation: navigationOf(wc) };
    void prompts.request(prompt).then((d) => callback(d === 'allow'), (e: unknown) => {
      context?.log(`permission prompt failed: ${e instanceof Error ? e.message : String(e)}`);
      callback(false);
    });
  });

  // Synchronous and never asks: answers what is already decided (e.g. Notification.permission).
  s.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const policy = policyFor(permission);
    if (policy !== 'ask') return policy === 'allow';
    const origin = siteOrigin(requestingOrigin);
    if (origin === null) return false;
    const media = details.mediaType === 'video' || details.mediaType === 'audio' ? [details.mediaType] : undefined;
    return context !== null && verdictFor(context.getPermissions(), forThisRun, dir, origin, permissionKeys(permission, media)) === 'allow';
  });

  // Screen sharing goes through the macOS picker (macOS 15+). Without it there is no picker of our own: refuse.
  s.setDisplayMediaRequestHandler((_request, callback) => {
    context?.log('screen sharing needs the macOS system picker (macOS 15 or later); refused');
    callback(null);
  }, { useSystemPicker: true });
}

/** The tab's current page-load count; starts counting on the tab's first request. */
function navigationOf(wc: WebContents): number {
  const n = navigations.get(wc);
  if (n !== undefined) return n;
  navigations.set(wc, 0);
  // Main frame, new document (reloads too); same-document changes (pushState) keep requests.
  wc.on('did-navigate', () => navigations.set(wc, (navigations.get(wc) ?? 0) + 1));
  return 0;
}

/** False once the requesting tab is closed or has loaded another page: its request is then dropped. */
function stillWanted(p: PermissionPrompt): boolean {
  const wc = webContents.fromId(p.source);
  return wc !== undefined && !wc.isDestroyed() && navigations.get(wc) === p.navigation;
}

/** What is decided for a prompt without asking: saved Allows, then this run's answers. */
function currentVerdict(p: PermissionPrompt): Verdict {
  return context ? verdictFor(context.getPermissions(), forThisRun, p.dir, p.origin, p.keys) : 'deny';
}

/** The permission sheet on the main window; stores the answer (`storeAnswer`). No window: refused, nothing stored. */
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
  // Only a remembered Allow is saved; a Block lasts for this run, so a stray Return can't block a site for good.
  const saved = context.getPermissions();
  const next = storeAnswer({ saved, run: forThisRun }, p.dir, p.origin, p.keys, d, checkboxChecked);
  forThisRun = next.run;
  if (next.saved !== saved) context.setPermissions(next.saved);
  context.log(`${p.origin} ${p.keys.join('+')} in profile ${p.dir}: ${d}${next.saved !== saved ? ' (saved)' : ' (this run)'}`);
  return d;
}
