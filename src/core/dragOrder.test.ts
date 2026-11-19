import test from 'node:test';
import assert from 'node:assert/strict';
import { dropIndex, dropBefore, slotShift } from './dragOrder.ts';

// Four pills, 40 px wide with 2 px gaps: midpoints 20, 62, 104, 146.
const mids = [20, 62, 104, 146];

test('dropIndex: the pointer between its neighbours keeps the slot', () => {
  assert.equal(dropIndex(mids, 1, 62), 1);
  assert.equal(dropIndex(mids, 1, 30), 1); // past the left neighbour's start, not its midpoint
  assert.equal(dropIndex(mids, 1, 100), 1);
});

test('dropIndex: the pointer crossing a midpoint moves one slot', () => {
  assert.equal(dropIndex(mids, 1, 19), 0);
  assert.equal(dropIndex(mids, 1, 105), 2);
  assert.equal(dropIndex(mids, 3, 61), 1);
});

test('dropIndex: past the ends clamps to the first and last slot', () => {
  assert.equal(dropIndex(mids, 3, -500), 0);
  assert.equal(dropIndex(mids, 0, 5000), 3);
});

test('dropIndex: a single pill stays put', () => {
  assert.equal(dropIndex([20], 0, 900), 0);
});

const dirs = ['A', 'B', 'C', 'D'];

test('dropBefore: the dir that follows the dropped one, null at the end', () => {
  assert.equal(dropBefore(dirs, 3, 0), 'A'); // D to the front
  assert.equal(dropBefore(dirs, 0, 1), 'C'); // A after B
  assert.equal(dropBefore(dirs, 0, 3), null); // A to the end
  assert.equal(dropBefore(dirs, 1, 2), 'D');
});

test('slotShift: pills between the slots slide to open the gap', () => {
  // Dragging index 1 to index 3: C and D slide left.
  assert.deepEqual([0, 1, 2, 3].map((i) => slotShift(i, 1, 3)), [0, 0, -1, -1]);
  // Dragging index 3 to index 0: A, B and C slide right.
  assert.deepEqual([0, 1, 2, 3].map((i) => slotShift(i, 3, 0)), [1, 1, 1, 0]);
  // Not moved: nothing slides.
  assert.deepEqual([0, 1, 2, 3].map((i) => slotShift(i, 2, 2)), [0, 0, 0, 0]);
});
