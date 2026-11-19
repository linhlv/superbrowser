import type { Profile, UiCommand, UiState } from '../shared/types.ts';

/** Visible profiles in bar order, each with its ⌃N shortcut (only the first nine have one). */
export function barProfiles(visible: Profile[]): UiState['profiles'] {
  return visible.map((p, i) => ({ ...p, shortcut: i < 9 ? i + 1 : null }));
}

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
