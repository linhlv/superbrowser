import type { Profile } from '../shared/types.ts';

const FALLBACK_COLOR = '#808080';

/** Signed 32-bit ARGB (as Chrome stores it) to `#rrggbb`. */
export function argbToHex(argb: number): string {
  return '#' + ((argb >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

type CacheEntry = { name?: unknown; profile_color_seed?: unknown; default_avatar_fill_color?: unknown };

function colorOf(entry: CacheEntry): string {
  for (const v of [entry.profile_color_seed, entry.default_avatar_fill_color]) {
    if (typeof v === 'number' && Number.isFinite(v)) return argbToHex(v);
  }
  return FALLBACK_COLOR;
}

/** Throws when the JSON is invalid or has no `profile.info_cache`. */
export function parseLocalState(json: string, existingDirs: Set<string>): Profile[] {
  const root = JSON.parse(json);
  const cache = root?.profile?.info_cache;
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) throw new Error('Local State has no profile.info_cache');
  const order: string[] = Array.isArray(root.profile.profiles_order)
    ? root.profile.profiles_order.filter((d: unknown): d is string => typeof d === 'string') : [];

  const toProfile = (dir: string): Profile => {
    const entry: CacheEntry = cache[dir] ?? {};
    const name = typeof entry.name === 'string' && entry.name ? entry.name : dir;
    return { dir, name, color: colorOf(entry) };
  };
  const usable = (dir: string) => Object.hasOwn(cache, dir) && !dir.startsWith('.') && existingDirs.has(dir);

  const ordered = [...new Set(order)].filter(usable).map(toProfile);
  const seen = new Set(ordered.map((x) => x.dir));
  const rest = Object.keys(cache).filter((d) => usable(d) && !seen.has(d)).map(toProfile)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return [...ordered, ...rest];
}

/** Chrome's list wins (fresh names/colors); known profiles Chrome no longer lists stay at the end. */
export function mergeProfiles(fromChrome: Profile[] | null, known: Profile[]): Profile[] {
  if (!fromChrome || (fromChrome.length === 0 && known.length > 0)) return known;
  const inChrome = new Set(fromChrome.map((x) => x.dir));
  return [...fromChrome, ...known.filter((x) => !inChrome.has(x.dir))];
}

/** Every profile, `order` first (unknown dirs ignored), then the rest in `all`'s order. */
function arrange(all: Profile[], order: string[]): Profile[] {
  const byDir = new Map(all.map((x) => [x.dir, x]));
  const placed = new Set<string>();
  const arranged: Profile[] = [];
  for (const dir of [...order, ...all.map((x) => x.dir)]) {
    const profile = byDir.get(dir);
    if (profile && !placed.has(dir)) { placed.add(dir); arranged.push(profile); }
  }
  return arranged;
}

export function arrangeProfiles(all: Profile[], order: string[], hidden: string[]): { visible: Profile[]; hidden: Profile[] } {
  const arranged = arrange(all, order);
  const hiddenSet = new Set(hidden);
  return { visible: arranged.filter((x) => !hiddenSet.has(x.dir)), hidden: arranged.filter((x) => hiddenSet.has(x.dir)) };
}

/**
 * The new `profileOrder` (every known profile) after moving the visible `dir` one place left (-1) or right (+1)
 * among the visible profiles; hidden ones keep their places. Null when it can't move that way.
 */
export function moveProfile(all: Profile[], order: string[], hidden: string[], dir: string, step: -1 | 1): string[] | null {
  const dirs = arrange(all, order).map((x) => x.dir);
  const hiddenSet = new Set(hidden);
  const visible = dirs.filter((d) => !hiddenSet.has(d));
  const i = visible.indexOf(dir);
  const neighbour = i === -1 ? undefined : visible[i + step];
  if (neighbour === undefined) return null;
  const a = dirs.indexOf(dir), b = dirs.indexOf(neighbour);
  [dirs[a], dirs[b]] = [neighbour, dir];
  return dirs;
}

/**
 * The new `profileOrder` (every known profile) after dropping the visible `dir` just before the visible `beforeDir`
 * (null: after the last visible one); hidden profiles keep their slots. Null when nothing would change or the move is invalid.
 */
export function placeProfile(all: Profile[], order: string[], hidden: string[], dir: string, beforeDir: string | null): string[] | null {
  const dirs = arrange(all, order).map((x) => x.dir);
  const hiddenSet = new Set(hidden);
  const visible = dirs.filter((d) => !hiddenSet.has(d));
  if (!visible.includes(dir) || beforeDir === dir || (beforeDir !== null && !visible.includes(beforeDir))) return null;
  const moved = visible.filter((d) => d !== dir);
  moved.splice(beforeDir === null ? moved.length : moved.indexOf(beforeDir), 0, dir);
  if (moved.every((d, i) => d === visible[i])) return null;
  let next = 0;
  return dirs.map((d) => (hiddenSet.has(d) ? d : moved[next++]!));
}

/** The new `hiddenProfiles` with `dir` added. Null when `dir` isn't a visible profile or is the last visible one. */
export function hideProfile(all: Profile[], hidden: string[], dir: string): string[] | null {
  const visible = arrangeProfiles(all, [], hidden).visible;
  if (visible.length <= 1 || !visible.some((x) => x.dir === dir)) return null;
  return [...hidden, dir];
}

/** True when `hidden` hides every known profile (the bar would be empty): then show them all instead. */
export function hidesEveryProfile(all: Profile[], hidden: string[]): boolean {
  const hiddenSet = new Set(hidden);
  return all.length > 0 && all.every((x) => hiddenSet.has(x.dir));
}

export const MAX_DISPLAY_NAME = 40;

/** Trim, collapse inner whitespace to one space, cut to 40 code points, trim again. */
export function normalizeDisplayName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return Array.from(collapsed).slice(0, MAX_DISPLAY_NAME).join('').trim();
}

/** A new map with `dir` set to the normalized name, or removed when it normalizes to empty. */
export function setDisplayName(names: Record<string, string>, dir: string, raw: string): Record<string, string> {
  const out = { ...names };
  const name = normalizeDisplayName(raw);
  if (name === '') delete out[dir];
  else out[dir] = name;
  return out;
}

/** The user's display name for the profile, else Chrome's name. */
export function profileLabel(p: Profile, names: Record<string, string>): string {
  const own = Object.prototype.hasOwnProperty.call(names, p.dir) ? names[p.dir] : undefined;
  return typeof own === 'string' && own !== '' ? own : p.name;
}

export function withDisplayNames(list: Profile[], names: Record<string, string>): Profile[] {
  return list.map((p) => ({ ...p, name: profileLabel(p, names) }));
}

/** Two words give their first letters; one word gives its first two; uppercase; '?' when empty. */
export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return '?';
  const chars = words.length >= 2 ? [Array.from(words[0]!)[0]!, Array.from(words[1]!)[0]!] : Array.from(words[0]!).slice(0, 2);
  return chars.join('').toUpperCase();
}
