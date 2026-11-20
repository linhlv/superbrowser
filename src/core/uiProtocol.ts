import { isWebUrl } from './address.ts';
import { isSection } from './sections.ts';
import { initials, profileLabel } from './profiles.ts';
import { keyOf, pinHost } from './pins.ts';
import type { Pin } from './pins.ts';
import type { Profile, UiCommand, UiPin, UiProfile } from '../shared/types.ts';

/** Visible profiles in bar order, each with its ⌃N shortcut (only the first nine have one), label and initials. */
export function barProfiles(visible: Profile[], names: Record<string, string>): UiProfile[] {
  return visible.map((p, i) => {
    const label = profileLabel(p, names);
    return { ...p, name: label, chromeName: p.name, initials: initials(label), shortcut: i < 9 ? i + 1 : null };
  });
}

/** Pins of visible profiles, in pin order, numbered 1–9 then null; active when the shown page is on the pin's host in its profile. */
export function barPins(pins: Pin[], visible: Profile[], names: Record<string, string>, shown: { dir: string; url: string }): UiPin[] {
  const byDir = new Map(visible.map((p) => [p.dir, p]));
  const shownHost = pinHost(shown.url);
  const out: UiPin[] = [];
  for (const pin of pins) {
    const prof = byDir.get(pin.dir);
    if (!prof) continue;
    out.push({
      key: keyOf(pin), dir: pin.dir, title: pin.title, url: pin.url, favicon: pin.favicon,
      color: prof.color, profileLabel: profileLabel(prof, names), shortcut: out.length < 9 ? out.length + 1 : null,
      active: shown.dir === pin.dir && shownHost !== null && shownHost === pinHost(pin.url),
    });
  }
  return out;
}

const isSeq = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** A pin key (`dir|host`). */
const isKey = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 2048;
const isUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= 8192 && isWebUrl(v);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The IPC boundary: a message from the UI view becomes a `UiCommand` only if its type is known and its
 * fields have the right types (`dir` must be one of `knownDirs`). Returns a fresh object with just those fields.
 */
export function parseUiCommand(raw: unknown, knownDirs: ReadonlySet<string>): UiCommand | null {
  if (!isObj(raw)) return null;
  const { type } = raw;
  const dir = typeof raw['dir'] === 'string' && knownDirs.has(raw['dir']) ? raw['dir'] : null;
  const id = raw['id'];
  switch (type) {
    case 'selectProfile':
    case 'profileMenu':
      return dir === null ? null : { type, dir };
    case 'reorderProfile': {
      const before = raw['before'];
      return dir !== null && (before === null || (typeof before === 'string' && knownDirs.has(before))) ? { type, dir, before } : null;
    }
    case 'selectTab':
    case 'closeTab':
      return Number.isInteger(id) ? { type, id: id as number } : null;
    case 'navigate':
      return typeof raw['input'] === 'string' ? { type, input: raw['input'] } : null;
    case 'revealDownload':
      return typeof id === 'string' && id !== '' ? { type, id } : null;
    case 'find':
      return typeof raw['text'] === 'string' && typeof raw['forward'] === 'boolean'
        ? { type, text: raw['text'], forward: raw['forward'] } : null;
    case 'suggest':
      return isSeq(raw['seq']) && isText(raw['text'], 2048) ? { type, seq: raw['seq'], text: raw['text'] } : null;
    case 'historyPage': {
      const before = raw['before'];
      return isSeq(raw['seq']) && isText(raw['query'], 2048) && (before === null || (typeof before === 'number' && Number.isFinite(before)))
        ? { type, seq: raw['seq'], query: raw['query'], before } : null;
    }
    case 'bookmarks':
      return isSeq(raw['seq']) ? { type, seq: raw['seq'] } : null;
    case 'openUrl':
      return isUrl(raw['url']) && typeof raw['newTab'] === 'boolean' ? { type, url: raw['url'], newTab: raw['newTab'] } : null;
    case 'historyMenu':
      return isUrl(raw['url']) ? { type, url: raw['url'] } : null;
    case 'bookmarkMenu':
      return isId(id) ? { type, id } : null;
    case 'renameBookmark':
      return isId(id) && isText(raw['title'], 1024) ? { type, id, title: raw['title'] } : null;
    case 'selectPin':
    case 'pinMenu':
      return isKey(raw['key']) ? { type, key: raw['key'] } : null;
    case 'reorderTab': {
      const before = raw['before'];
      return Number.isInteger(id) && (before === null || Number.isInteger(before)) ? { type, id: id as number, before: before as number | null } : null;
    }
    case 'reorderPin': {
      const { key, before } = raw;
      return isKey(key) && (before === null || isKey(before)) ? { type, key, before } : null;
    }
    case 'tabMenu':
    case 'togglePinTab':
      return Number.isInteger(id) ? { type, id: id as number } : null;
    case 'setDisplayName':
      return dir !== null && isText(raw['name'], 200) ? { type, dir, name: raw['name'] } : null;
    case 'setSectionOpen':
      return isSection(raw['section']) && typeof raw['open'] === 'boolean' ? { type, section: raw['section'], open: raw['open'] } : null;
    case 'toolbarHeight': {
      const height = raw['height'];
      return Number.isInteger(height) && (height as number) >= 0 && (height as number) <= 4000 ? { type, height: height as number } : null;
    }
    case 'toolbarClickThrough': {
      const { x, y } = raw;
      const px = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10000;
      return px(x) && px(y) ? { type, x, y } : null;
    }
    case 'addProfileMenu':
    case 'newTab':
    case 'back':
    case 'forward':
    case 'reload':
    case 'toggleSidebar':
    case 'findClose':
    case 'toggleBookmark':
      return { type };
    default:
      return null;
  }
}
