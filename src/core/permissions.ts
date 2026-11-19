import type { AppState, Decision } from './appState.ts';

/**
 * Site permissions: what is granted silently, what asks the user (per profile, per site, remembered)
 * and what is always refused. Electron's default would grant everything.
 */
export type Policy = 'allow' | 'ask' | 'deny';
export type Verdict = 'allow' | 'deny' | 'ask';

const ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'automatic-fullscreen']);
const ASK = new Set(['media', 'notifications', 'geolocation', 'clipboard-read', 'display-capture', 'window-management']);

export function policyFor(permission: string): Policy {
  if (ALLOW.has(permission)) return 'allow';
  if (ASK.has(permission)) return 'ask';
  return 'deny';
}

/**
 * The keys a decision is stored under. Camera and microphone are remembered separately
 * (`media:video`, `media:audio`); a media request without types asks for both.
 */
export function permissionKeys(permission: string, mediaTypes?: string[]): string[] {
  if (permission !== 'media') return [permission];
  const types = mediaTypes && mediaTypes.length > 0 ? mediaTypes : ['video', 'audio'];
  return types.map((t) => `media:${t}`);
}

/** The policy decides unless it is 'ask'; then every key must be allowed, and any denied key denies. */
export function decide(
  stored: Record<string, Record<string, Decision>> | undefined,
  origin: string,
  keys: string[],
  policy: Policy,
): Verdict {
  if (policy !== 'ask') return policy;
  const site = stored?.[origin];
  if (!site || keys.length === 0) return 'ask';
  if (keys.some((k) => site[k] === 'deny')) return 'deny';
  return keys.every((k) => site[k] === 'allow') ? 'allow' : 'ask';
}

/** `perms` with `d` stored for every key; the input is left untouched. */
export function remember(perms: AppState['permissions'], dir: string, origin: string, keys: string[], d: Decision): AppState['permissions'] {
  const profile = perms[dir] ?? {};
  const site = { ...profile[origin] };
  for (const k of keys) site[k] = d;
  return { ...perms, [dir]: { ...profile, [origin]: site } };
}

const WHAT: Record<string, string> = {
  notifications: 'show notifications',
  geolocation: 'know your location',
  'clipboard-read': 'read your clipboard',
  'display-capture': 'share your screen',
  'window-management': 'manage windows on all your displays',
};

/** The permission sheet's message, e.g. `meet.google.com wants to use your camera and microphone`. */
export function describeRequest(origin: string, keys: string[]): string {
  let host = origin;
  try { host = new URL(origin).host || origin; } catch { /* keep the origin as given */ }
  const devices = [keys.includes('media:video') && 'camera', keys.includes('media:audio') && 'microphone'].filter(Boolean);
  const wants = devices.length > 0 ? [`use your ${devices.join(' and ')}`] : [];
  for (const k of keys) {
    if (!k.startsWith('media:')) wants.push(WHAT[k] ?? `use ${k}`);
  }
  return `${host} wants to ${wants.join(' and ')}`;
}

/** The origin decisions are stored under, or null for pages that are not http(s) (file:, about:, data:…), which are never asked. */
export function siteOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

export type PermissionPrompt = { dir: string; origin: string; keys: string[] };

type Entry = { id: string; prompt: PermissionPrompt; waiters: ((d: Decision) => void)[] };

/**
 * Shows permission sheets one at a time. A request identical to one already waiting or showing
 * (same profile, origin and keys) gets that sheet's answer instead of a second sheet; a queued request
 * is checked again (`current`) before its turn, as an earlier sheet may have answered it.
 * `ask` shows the sheet and stores the answer; if it fails, the request is denied.
 */
export class PromptQueue {
  private readonly ask: (p: PermissionPrompt) => Promise<Decision>;
  private readonly current: (p: PermissionPrompt) => Verdict;
  private readonly pending: Entry[] = [];
  private running = false;

  constructor(ask: (p: PermissionPrompt) => Promise<Decision>, current: (p: PermissionPrompt) => Verdict) {
    this.ask = ask;
    this.current = current;
  }

  request(prompt: PermissionPrompt): Promise<Decision> {
    const id = JSON.stringify([prompt.dir, prompt.origin, [...prompt.keys].sort()]);
    return new Promise((resolve) => {
      const same = this.pending.find((e) => e.id === id);
      if (same) {
        same.waiters.push(resolve);
        return;
      }
      this.pending.push({ id, prompt, waiters: [resolve] });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    for (let entry = this.pending[0]; entry; entry = this.pending[0]) {
      let d: Decision;
      const now = this.current(entry.prompt);
      if (now !== 'ask') d = now;
      else {
        try { d = await this.ask(entry.prompt); } catch { d = 'deny'; }
      }
      this.pending.shift(); // only now: while its sheet shows, identical requests join it
      for (const resolve of entry.waiters) resolve(d);
    }
    this.running = false;
  }
}
