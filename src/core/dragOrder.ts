// Slot maths for dragging an item along a row or column (pills, pin tiles, tab rows), measured once when the drag starts.

/**
 * The slot (0…n-1 in the final row) that the dragged item at `from` lands in: one slot past every other item
 * whose midpoint lies left of the pointer `x`. `mids` are all items' midpoints in row order.
 */
export function dropIndex(mids: number[], from: number, x: number): number {
  return mids.filter((m, i) => i !== from && m < x).length;
}

/** The id that follows the item moved from `from` to slot `to`, or null when it ends up last. */
export function dropBefore(ids: string[], from: number, to: number): string | null {
  return ids.filter((_, i) => i !== from)[to] ?? null;
}

/** Which way item `i` slides while the item at `from` hovers over slot `to`: -1 left or up, 1 right or down, 0 stays. */
export function slotShift(i: number, from: number, to: number): -1 | 0 | 1 {
  if (i > from && i <= to) return -1;
  if (i < from && i >= to) return 1;
  return 0;
}
