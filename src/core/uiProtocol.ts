import { isWebUrl } from './address.ts';
import type { Profile, UiCommand, UiState } from '../shared/types.ts';

/** Visible profiles in bar order, each with its ⌃N shortcut (only the first nine have one). */
export function barProfiles(visible: Profile[]): UiState['profiles'] {
  return visible.map((p, i) => ({ ...p, shortcut: i < 9 ? i + 1 : null }));
}

const isSeq = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
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
    case 'addProfileMenu':
    case 'newTab':
    case 'back':
    case 'forward':
    case 'reload':
    case 'toggleSidebar':
    case 'findClose':
      return { type };
    default:
      return null;
  }
}
