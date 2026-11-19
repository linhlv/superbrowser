import fs from 'node:fs';
import path from 'node:path';
import { decodeState, defaultState, type AppState } from './appState.ts';

export type Store = { load(): AppState; save(state: AppState): void; flush(): void };

/**
 * `state.json`, written atomically (fsynced temp file, then rename). `save` is debounced by `debounceMs`,
 * but a pending state is written at most `maxWaitMs` after the first unsaved change, so a steady stream of
 * saves can't postpone the write forever.
 */
export function createStore(file: string, opts: { debounceMs?: number; maxWaitMs?: number } = {}): Store {
  const debounceMs = opts.debounceMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 2000;
  let pending: AppState | null = null;
  let timer: NodeJS.Timeout | null = null;
  let maxTimer: NodeJS.Timeout | null = null;

  function write(state: AppState): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  function flush(): void {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = maxTimer = null;
    if (pending) {
      const state = pending;
      pending = null;
      write(state);
    }
  }

  function flushLogged(): void {
    try {
      flush();
    } catch (e) {
      console.error('Superbrowser: could not save state', e);
    }
  }

  /** Moves an unreadable or corrupt file out of the way (best effort) so it isn't overwritten. */
  function setAside(): void {
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // best effort: keep running with defaults
    }
  }

  return {
    load() {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') setAside();
        return defaultState();
      }
      try {
        return decodeState(JSON.parse(text));
      } catch {
        setAside();
        return defaultState();
      }
    },
    save(state) {
      pending = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flushLogged, debounceMs);
      timer.unref();
      if (!maxTimer) {
        maxTimer = setTimeout(flushLogged, maxWaitMs);
        maxTimer.unref();
      }
    },
    flush,
  };
}
