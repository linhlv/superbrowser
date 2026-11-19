import test from 'node:test';
import assert from 'node:assert/strict';
import { trailingThrottle, type Timers } from './throttle.ts';

/** A fake clock: `advance` runs timers that fall due, in order. */
function fakeTimers(): Timers & { advance(ms: number): void; pending(): number } {
  let now = 0, next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(handle) { timers.delete(handle as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

test('trailingThrottle runs once, ms after the first call, for a burst of calls', () => {
  const t = fakeTimers();
  let runs = 0;
  const th = trailingThrottle(() => runs++, 1500, t);
  th.call();
  t.advance(500);
  th.call();
  th.call();
  t.advance(999);
  assert.equal(runs, 0);
  t.advance(1);
  assert.equal(runs, 1);
  assert.equal(t.pending(), 0);
});

test('trailingThrottle: a call after a run schedules the next one, so the last change lands', () => {
  const t = fakeTimers();
  let runs = 0;
  const th = trailingThrottle(() => runs++, 1500, t);
  th.call();
  t.advance(1500);
  th.call();
  assert.equal(runs, 1);
  t.advance(1500);
  assert.equal(runs, 2);
  t.advance(10_000);
  assert.equal(runs, 2); // nothing new: no run
});

test('trailingThrottle: cancel drops the pending run', () => {
  const t = fakeTimers();
  let runs = 0;
  const th = trailingThrottle(() => runs++, 1500, t);
  th.call();
  th.cancel();
  t.advance(5000);
  assert.equal(runs, 0);
  th.call();
  t.advance(1500);
  assert.equal(runs, 1);
});
