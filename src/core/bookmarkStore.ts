import fs from 'node:fs';
import path from 'node:path';
import { decodeTree, emptyTree, type BookmarkTree } from './bookmarks.ts';
import { writeFileAtomic } from './store.ts';

/** `<base>/Profiles/<chrome profile dir>`; throws if `dir` isn't a single, plain directory name. */
export function profileDataDir(base: string, dir: string): string {
  if (dir === '' || dir === '.' || dir === '..' || /[/\\\0]/.test(dir)) throw new Error(`Unsafe profile directory name: ${JSON.stringify(dir)}`);
  return path.join(base, 'Profiles', dir);
}

/** Loads a profile's bookmarks. Missing → empty. Unreadable or corrupt → set aside as `<file>.corrupt-<ms>` and empty. Never throws. */
export function loadBookmarks(file: string): BookmarkTree {
  const setAside = (): void => {
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // best effort
    }
  };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') setAside();
    return emptyTree();
  }
  try {
    return decodeTree(JSON.parse(text));
  } catch {
    setAside();
    return emptyTree();
  }
}

export function saveBookmarks(file: string, tree: BookmarkTree): void {
  writeFileAtomic(file, JSON.stringify(tree));
}
