import type { Profile, Section } from '../shared/types.ts';
import { SECTIONS, isSection } from './sections.ts';

export type Decision = 'allow' | 'deny';
export type SavedTabs = { tabs: { url: string; title: string }[]; activeIndex: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type AppState = {
  version: 1;
  activeProfile: string | null;
  sidebarVisible: boolean;
  showNames: boolean;
  openSections: Section[];
  windowBounds: Rect | null;
  profileOrder: string[];
  hiddenProfiles: string[];
  knownProfiles: Profile[];
  tabs: Record<string, SavedTabs>;
  permissions: Record<string, Record<string, Record<string, Decision>>>;
  firstRunDone: boolean;
};

export function defaultState(): AppState {
  return {
    version: 1,
    activeProfile: null,
    sidebarVisible: true,
    showNames: false,
    openSections: [],
    windowBounds: null,
    profileOrder: [],
    hiddenProfiles: [],
    knownProfiles: [],
    tabs: {},
    permissions: {},
    firstRunDone: false,
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function decodeSections(v: unknown): Section[] {
  const found = Array.isArray(v) ? v.filter(isSection) : [];
  return SECTIONS.filter((s) => found.includes(s));
}

function decodeProfiles(v: unknown): Profile[] {
  if (!Array.isArray(v)) return [];
  const out: Profile[] = [];
  for (const p of v) {
    if (isObj(p) && typeof p['dir'] === 'string' && typeof p['name'] === 'string' && typeof p['color'] === 'string') {
      out.push({ dir: p['dir'], name: p['name'], color: p['color'] });
    }
  }
  return out;
}

function decodeBounds(v: unknown): Rect | null {
  if (!isObj(v)) return null;
  const { x, y, width, height } = v;
  if ([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { x, y, width, height } as Rect;
  }
  return null;
}

function decodeTabs(v: unknown): Record<string, SavedTabs> {
  const out: Record<string, SavedTabs> = {};
  if (!isObj(v)) return out;
  for (const [dir, entry] of Object.entries(v)) {
    if (!isObj(entry)) continue;
    const tabs: SavedTabs['tabs'] = [];
    if (Array.isArray(entry['tabs'])) {
      for (const t of entry['tabs']) {
        if (isObj(t) && typeof t['url'] === 'string') {
          tabs.push({ url: t['url'], title: typeof t['title'] === 'string' ? t['title'] : '' });
        }
      }
    }
    const ai = typeof entry['activeIndex'] === 'number' && Number.isFinite(entry['activeIndex']) ? Math.trunc(entry['activeIndex']) : 0;
    out[dir] = { tabs, activeIndex: tabs.length === 0 ? 0 : Math.min(Math.max(ai, 0), tabs.length - 1) };
  }
  return out;
}

function decodePermissions(v: unknown): AppState['permissions'] {
  const out: AppState['permissions'] = {};
  if (!isObj(v)) return out;
  for (const [dir, origins] of Object.entries(v)) {
    if (!isObj(origins)) continue;
    const o: Record<string, Record<string, Decision>> = {};
    for (const [origin, keys] of Object.entries(origins)) {
      if (!isObj(keys)) continue;
      const k: Record<string, Decision> = {};
      for (const [key, d] of Object.entries(keys)) {
        if (d === 'allow' || d === 'deny') k[key] = d;
      }
      o[origin] = k;
    }
    out[dir] = o;
  }
  return out;
}

/** Tolerant decode: never throws; each bad or missing field falls back to its default. */
export function decodeState(raw: unknown): AppState {
  const d = defaultState();
  if (!isObj(raw)) return d;
  return {
    version: 1,
    activeProfile: typeof raw['activeProfile'] === 'string' ? raw['activeProfile'] : null,
    sidebarVisible: bool(raw['sidebarVisible'], d.sidebarVisible),
    showNames: bool(raw['showNames'], d.showNames),
    openSections: decodeSections(raw['openSections']),
    windowBounds: decodeBounds(raw['windowBounds']),
    profileOrder: strings(raw['profileOrder']),
    hiddenProfiles: strings(raw['hiddenProfiles']),
    knownProfiles: decodeProfiles(raw['knownProfiles']),
    tabs: decodeTabs(raw['tabs']),
    permissions: decodePermissions(raw['permissions']),
    firstRunDone: bool(raw['firstRunDone'], d.firstRunDone),
  };
}
