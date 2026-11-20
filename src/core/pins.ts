export type Pin = { dir: string; url: string; title: string; favicon: string | null };
export type PinTarget = { kind: 'tab'; id: number } | { kind: 'open'; url: string };

const MAX_FAVICON = 64 * 1024;

/** A favicon worth saving: an http(s) or `data:image/…` URL of at most 64 KB (a page can't bloat state.json). */
export function usableFavicon(v: string | null): string | null {
  if (v === null || v.length > MAX_FAVICON) return null;
  return /^https?:\/\//i.test(v) || /^data:image\//i.test(v) ? v : null;
}

export function pinHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : null;
  } catch {
    return null;
  }
}

export function pinKey(dir: string, url: string): string | null {
  const host = pinHost(url);
  return host === null ? null : `${dir}|${host}`;
}

/** A pin's name in its tooltip and the Pinned Tabs menu: `Inbox · ACME`, the host when it has no title. */
export function pinLabel(pin: { title: string; url: string; profileLabel: string }): string {
  return `${pin.title || pinHost(pin.url) || pin.url} · ${pin.profileLabel}`;
}

/** Whether a tab on `url` in profile `dir` can be pinned (a web page) and whether its site is pinned there. */
export function tabPinState(pins: Pin[], dir: string, url: string): { canPin: boolean; pinned: boolean } {
  const key = pinKey(dir, url);
  return { canPin: key !== null, pinned: key !== null && pins.some((p) => keyOf(p) === key) };
}

export function keyOf(pin: Pin): string {
  return pinKey(pin.dir, pin.url) ?? `${pin.dir}|`;
}

export function addPin(pins: Pin[], pin: Pin): Pin[] {
  const key = pinKey(pin.dir, pin.url);
  if (key === null) return pins;
  const i = pins.findIndex((p) => keyOf(p) === key);
  if (i < 0) return [...pins, { ...pin, favicon: usableFavicon(pin.favicon) }];
  return pins.map((p, j) => (j === i ? { ...p, url: pin.url, title: pin.title, favicon: usableFavicon(pin.favicon) } : p));
}

export function removePin(pins: Pin[], key: string): Pin[] {
  return pins.filter((p) => keyOf(p) !== key);
}

export function movePin(pins: Pin[], key: string, step: -1 | 1, shownDirs: ReadonlySet<string>): Pin[] | null {
  const from = pins.findIndex((p) => keyOf(p) === key);
  if (from < 0) return null;
  let to = from + step;
  while (to >= 0 && to < pins.length && !shownDirs.has(pins[to]!.dir)) to += step;
  if (to < 0 || to >= pins.length) return null;
  const out = [...pins];
  const [moved] = out.splice(from, 1);
  // Removing `from` shifts later indexes down: step +1 lands right after the neighbour, step -1 right before it.
  out.splice(to, 0, moved!);
  return out;
}

/**
 * Drops the shown pin `key` just before the shown pin `beforeKey` (null: after the last shown one), as a drag in the
 * bar does; pins of hidden profiles keep their slots. Null when nothing would change or the move is invalid.
 */
export function placePin(pins: Pin[], key: string, beforeKey: string | null, shownDirs: ReadonlySet<string>): Pin[] | null {
  const shown = pins.filter((p) => shownDirs.has(p.dir));
  const moving = shown.find((p) => keyOf(p) === key);
  if (!moving || beforeKey === key) return null;
  const rest = shown.filter((p) => p !== moving);
  const at = beforeKey === null ? rest.length : rest.findIndex((p) => keyOf(p) === beforeKey);
  if (at === -1) return null;
  rest.splice(at, 0, moving);
  if (rest.every((p, i) => p === shown[i])) return null;
  let next = 0;
  return pins.map((p) => (shownDirs.has(p.dir) ? rest[next++]! : p));
}

export function decodePins(v: unknown): Pin[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Pin[] = [];
  for (const e of v) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o['dir'] !== 'string' || typeof o['url'] !== 'string') continue;
    const key = pinKey(o['dir'], o['url']);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    out.push({
      dir: o['dir'],
      url: o['url'],
      title: typeof o['title'] === 'string' ? o['title'] : '',
      favicon: usableFavicon(typeof o['favicon'] === 'string' ? o['favicon'] : null),
    });
  }
  return out;
}

export function pinTarget(pin: Pin, tabs: { id: number; url: string }[], rememberedId: number | null): PinTarget {
  const host = pinHost(pin.url);
  const onHost = tabs.filter((t) => host !== null && pinHost(t.url) === host);
  const remembered = rememberedId === null ? undefined : onHost.find((t) => t.id === rememberedId);
  if (remembered) return { kind: 'tab', id: remembered.id };
  if (onHost[0]) return { kind: 'tab', id: onHost[0].id };
  return { kind: 'open', url: pin.url };
}

export function rememberShown(
  remembered: ReadonlyMap<string, number>,
  pins: Pin[],
  shown: { dir: string; tabId: number | null; url: string },
): Map<string, number> {
  const out = new Map(remembered);
  const key = pinKey(shown.dir, shown.url);
  if (key !== null && shown.tabId !== null && pins.some((p) => keyOf(p) === key)) out.set(key, shown.tabId);
  return out;
}

/** Drops remembered tabs of keys no longer pinned (same map when nothing goes). */
export function forgetUnpinned(remembered: ReadonlyMap<string, number>, pins: Pin[]): ReadonlyMap<string, number> {
  const keys = new Set(pins.map(keyOf));
  if ([...remembered.keys()].every((k) => keys.has(k))) return remembered;
  return new Map([...remembered].filter(([k]) => keys.has(k)));
}

export function withFavicon(pins: Pin[], key: string, raw: string | null): Pin[] {
  const favicon = usableFavicon(raw);
  if (favicon === null) return pins;
  const i = pins.findIndex((p) => keyOf(p) === key);
  if (i < 0 || pins[i]!.favicon === favicon) return pins;
  return pins.map((p, j) => (j === i ? { ...p, favicon } : p));
}

/** A pin's title follows its tab's; the same array when unchanged, and an empty title never clears it. */
export function withTitle(pins: Pin[], key: string, title: string): Pin[] {
  if (title === '') return pins;
  const i = pins.findIndex((p) => keyOf(p) === key);
  if (i < 0 || pins[i]!.title === title) return pins;
  return pins.map((p, j) => (j === i ? { ...p, title } : p));
}
