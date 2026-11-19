import test from 'node:test';
import assert from 'node:assert/strict';
import { keyedMoves, type Move } from './reorder.ts';

/** Applies the moves the way the DOM does (`insertBefore`; null appends), after dropping keys not in `desired`. */
function apply(current: string[], desired: string[], moves: Move[]): string[] {
  const list = current.filter((k) => desired.includes(k));
  for (const { key, before } of moves) {
    const at = list.indexOf(key);
    if (at >= 0) list.splice(at, 1);
    list.splice(before === null ? list.length : list.indexOf(before), 0, key);
  }
  return list;
}

test('keyedMoves: nothing to do when the order already matches', () => {
  assert.deepEqual(keyedMoves(['A', 'B', 'C'], ['A', 'B', 'C'], null), []);
  assert.deepEqual(keyedMoves(['A', 'B', 'C'], ['A', 'B', 'C'], 'B'), []);
});

test('keyedMoves: one item moved to the front moves only that item', () => {
  const moves = keyedMoves(['A', 'B', 'C', 'D'], ['D', 'A', 'B', 'C'], null);
  assert.deepEqual(moves, [{ key: 'D', before: 'A' }]);
});

test('keyedMoves: the kept item never moves; the others move around it', () => {
  const current = ['A', 'B', 'C', 'D'];
  const desired = ['D', 'A', 'B', 'C'];
  const moves = keyedMoves(current, desired, 'D');
  assert.deepEqual(moves.map((m) => m.key).sort(), ['A', 'B', 'C']);
  assert.deepEqual(apply(current, desired, moves), desired);
});

test('keyedMoves: new keys are inserted, gone keys are ignored', () => {
  const current = ['A', 'Q', 'B'];
  const desired = ['A', 'X', 'B'];
  const moves = keyedMoves(current, desired, null);
  assert.deepEqual(moves, [{ key: 'X', before: 'B' }]);
  assert.deepEqual(apply(current, desired, moves), desired);
});

test('keyedMoves: any reorder comes out right with the fewest moves', () => {
  const cases: [string[], string[], string | null, number][] = [
    [['A', 'B', 'C', 'D', 'E'], ['B', 'C', 'D', 'E', 'A'], null, 1],
    [['A', 'B', 'C', 'D', 'E'], ['E', 'D', 'C', 'B', 'A'], null, 4],
    [['A', 'B', 'C', 'D', 'E'], ['A', 'D', 'B', 'C', 'E'], 'D', 2],
    [['A', 'B', 'C', 'D', 'E'], ['B', 'A', 'D', 'C', 'E'], 'A', 2],
    [['A', 'B'], ['B', 'A'], 'Z', 1], // a kept key that isn't there is just ignored
  ];
  for (const [current, desired, keep, count] of cases) {
    const moves = keyedMoves(current, desired, keep);
    assert.deepEqual(apply(current, desired, moves), desired, `${current} → ${desired}`);
    assert.equal(moves.length, count, `${current} → ${desired}`);
    assert.ok(!moves.some((m) => m.key === keep), 'the kept key stays put');
  }
});
