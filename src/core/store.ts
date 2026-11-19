import fs from 'node:fs';
import path from 'node:path';
import { decodeState, defaultState, type AppState } from './appState.ts';

export type Store = { load(): AppState; save(state: AppState): void; flush(): void };

export function createStore(file: string, opts: { debounceMs?: number } = {}): Store {
  const debounceMs = opts.debounceMs ?? 500;
  let pending: AppState | null = null;
  let timer: NodeJS.Timeout | null = null;

  function write(state: AppState): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  function flush(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      const state = pending;
      pending = null;
      write(state);
    }
  }

  return {
    load() {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        return defaultState();
      }
      try {
        return decodeState(JSON.parse(text));
      } catch {
        try {
          fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        } catch {
          // best effort: keep running with defaults
        }
        return defaultState();
      }
    },
    save(state) {
      pending = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          flush();
        } catch (e) {
          console.error('Superbrowser: could not save state', e);
        }
      }, debounceMs);
      timer.unref();
    },
    flush,
  };
}
