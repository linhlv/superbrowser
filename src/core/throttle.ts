/** Timer functions, injectable so tests can drive time. */
export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Trailing-edge throttle: the first `call` schedules `fn` `ms` later, and calls before it runs join it. So `fn` runs
 * at most once per `ms`, always after the last call (the last change lands). `cancel` drops a pending run.
 */
export function trailingThrottle(fn: () => void, ms: number, timers: Timers = realTimers): { call(): void; cancel(): void } {
  let pending: unknown = null;
  return {
    call() {
      if (pending !== null) return;
      pending = timers.setTimeout(() => { pending = null; fn(); }, ms);
    },
    cancel() {
      if (pending === null) return;
      timers.clearTimeout(pending);
      pending = null;
    },
  };
}
