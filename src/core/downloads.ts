import path from 'node:path';
import type { DownloadState } from '../shared/types.ts';

/** Downloads listed in the sidebar: the newest of this app run (the list is not saved). */
export const MAX_DOWNLOADS = 20;
const MAX_NAME = 200;
const FALLBACK = 'download';

/**
 * A server-supplied file name made safe to create in the downloads folder: only its last path segment,
 * without control characters, colons (shown as "/" in Finder) or leading dots (no hidden files), at most
 * 200 characters with its extension kept; "download" when nothing is left.
 */
export function safeFilename(filename: string): string {
  const last = filename.split(/[/\\]/).filter((s) => s.trim() !== '').at(-1) ?? '';
  const name = last
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/:/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (name === '') return FALLBACK;
  if (name.length <= MAX_NAME) return name;
  const { base, ext } = splitExtension(name);
  return base.slice(0, MAX_NAME - ext.length) + ext;
}

/** 'a.pdf' → 'a.pdf', then 'a (1).pdf', 'a (2).pdf'…; no extension → 'a (1)'. The name is made safe first. */
export function uniqueDownloadPath(dir: string, filename: string, exists: (p: string) => boolean): string {
  const name = safeFilename(filename);
  const { base, ext } = splitExtension(name);
  let candidate = path.join(dir, name);
  for (let n = 1; exists(candidate); n++) candidate = path.join(dir, `${base} (${n})${ext}`);
  return candidate;
}

/** The extension is from the last dot on, unless that dot starts the name. */
function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' };
}

/** Replaces the download with the same id in place, or appends it; keeps the newest `MAX_DOWNLOADS`. */
export function recordDownload(list: readonly DownloadState[], d: DownloadState): DownloadState[] {
  const i = list.findIndex((x) => x.id === d.id);
  if (i !== -1) return list.map((x, j) => (j === i ? d : x));
  return [...list, d].slice(-MAX_DOWNLOADS);
}
