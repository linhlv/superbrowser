// Reordering keyed DOM rows with as few moves as possible. Moving an element can drop its :hover, so the
// element under the pointer (`keep`) is never moved: the others move around it.

/** Insert `key` just before `before` (null: at the end). */
export type Move = { key: string; before: string | null };

/** Indices (ascending) of one longest strictly increasing subsequence of `values`. */
function longestIncreasing(values: number[]): number[] {
  const len = values.map(() => 1);
  const prev = values.map(() => -1);
  let best = -1;
  values.forEach((v, i) => {
    for (let j = 0; j < i; j++) {
      if (values[j]! < v && len[j]! + 1 > len[i]!) { len[i] = len[j]! + 1; prev[i] = j; }
    }
    if (best < 0 || len[i]! > len[best]!) best = i;
  });
  const out: number[] = [];
  for (let i = best; i >= 0; i = prev[i]!) out.unshift(i);
  return out;
}

/**
 * The `insertBefore` moves, applied in order, that turn `current` into `desired` once the keys missing from
 * `desired` are removed. Keys new in `desired` appear as moves (insertions). Items that are already in order
 * relative to each other stay put; `keep` (when present in both) is always one of them.
 */
export function keyedMoves(current: string[], desired: string[], keep: string | null): Move[] {
  const pos = new Map(desired.map((k, i) => [k, i]));
  const present = current.filter((k) => pos.has(k));
  const values = present.map((k) => pos.get(k)!);
  const k = keep === null ? -1 : present.indexOf(keep);
  let stableIdx: number[];
  if (k < 0) {
    stableIdx = longestIncreasing(values);
  } else {
    // Everything stable must sit left-and-lower or right-and-higher than `keep`; the two sides are independent.
    const left = values.map((v, i) => [v, i] as const).filter(([v, i]) => i < k && v < values[k]!);
    const right = values.map((v, i) => [v, i] as const).filter(([v, i]) => i > k && v > values[k]!);
    stableIdx = [
      ...longestIncreasing(left.map(([v]) => v)).map((i) => left[i]![1]),
      k,
      ...longestIncreasing(right.map(([v]) => v)).map((i) => right[i]![1]),
    ];
  }
  const stable = new Set(stableIdx.map((i) => present[i]!));
  const moves: Move[] = [];
  // From the end: everything right of `i` is already final, so placing `i` before its right neighbour is final too.
  for (let i = desired.length - 1; i >= 0; i--) {
    const key = desired[i]!;
    if (!stable.has(key)) moves.push({ key, before: desired[i + 1] ?? null });
  }
  return moves;
}
