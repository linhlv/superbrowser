import { session, type Session } from 'electron';
import { chromeMajor, rewriteClientHints, userAgent } from '../core/identity.ts';

/** What profile sessions need from the app; later tasks add the window, state and download UI. */
export type SessionContext = { log: (msg: string) => void };

let context: SessionContext | null = null;
const sessions = new Map<string, Session>();

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
  sessions.set(dir, s);
  context.log(`session ready for profile ${dir}`);
  return s;
}
