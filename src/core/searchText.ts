// Pure text matching shared by the history database and the sidebar UI. Imports nothing.

export const DAY_MS = 86_400_000;

/** Lowercase, strip diacritics (NFD, \p{M}), đ → d. */
export function searchKey(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
}

export function splitWords(text: string): string[] {
  return searchKey(text).split(/\s+/).filter((w) => w !== '');
}

export function matchesAll(key: string, words: string[]): boolean {
  return words.every((w) => key.includes(w));
}

/** Local day number of a time; tzOffsetMin is as Date#getTimezoneOffset. */
export function dayOf(timeMs: number, tzOffsetMin: number): number {
  return Math.floor((timeMs - tzOffsetMin * 60_000) / DAY_MS);
}
