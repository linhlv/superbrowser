import type { Brand } from './identity.ts';

/**
 * What `presentAsChrome` needs; the frame preload computes it. `brands` empty: leave `userAgentData` alone.
 * `languages`: the Accept-Language list (`acceptLanguages`), which `navigator.languages` must match.
 */
export type PageIdentity = { brands: Brand[]; chromeBrand: string; fullVersion: string; passkeyMessage: string; languages: string[] };

/**
 * Runs in every page's own world before its scripts (the frame preload passes it to `executeInMainWorld`, which
 * serializes it): it may use only its argument and the page's globals, never this module's scope. One function, so
 * one private registry can make every function it replaces read as Chrome's native code.
 *
 * - Passkey requests (`publicKey`) fail at once with NotAllowedError: Electron has no passkey UI, so they would hang
 *   (Google's sign-in waits on its passkey step). Other credential calls are untouched.
 * - `navigator.userAgentData` names Google Chrome like the Sec-CH-UA headers: `brands`, `toJSON` and
 *   `getHighEntropyValues` (`brands`, `fullVersionList` with `chromeBrand` at `fullVersion`). Originals run first,
 *   so a wrong receiver still throws.
 * - `window.chrome` gets Chrome's `app`, `csi` and `loadTimes` (Electron leaves it empty).
 * - `navigator.languages` is the Accept-Language list (Electron's keeps only the system languages).
 * - Every replaced function (and `Function.prototype.toString` itself) reads `function <name>() { [native code] }`
 *   and keeps the original's arity.
 */
export function presentAsChrome(o: PageIdentity): void {
  type Fn = (...args: never[]) => unknown;
  const g = globalThis as Record<string, unknown>;
  const nativeText = new WeakMap<object, string>();
  const disguise = <F extends Fn>(fn: F, name: string, length: number): F => {
    Object.defineProperty(fn, 'length', { value: length, configurable: true });
    nativeText.set(fn, `function ${name}() { [native code] }`);
    return fn;
  };
  const replace = (proto: object, name: string, wrapped: Fn) => {
    Object.defineProperty(proto, name, { ...Object.getOwnPropertyDescriptor(proto, name), value: wrapped });
  };

  const originalToString = Function.prototype.toString;
  const toString = {
    toString(this: unknown) {
      if ((typeof this === 'function' || typeof this === 'object') && this !== null && nativeText.has(this)) return nativeText.get(this)!;
      return Reflect.apply(originalToString, this, arguments) as string;
    },
  }.toString;
  replace(Function.prototype, 'toString', disguise(toString, 'toString', originalToString.length));

  // Passkeys fail fast.
  const Credentials = g['CredentialsContainer'] as { prototype: Record<string, Fn> } | undefined; // insecure pages have none
  if (Credentials !== undefined) {
    for (const name of ['get', 'create']) {
      const original = Credentials.prototype[name];
      if (typeof original !== 'function') continue;
      const wrapped = {
        [name](this: unknown, options?: { publicKey?: unknown }) {
          if (options != null && typeof options === 'object' && options.publicKey != null) {
            return Promise.reject(new DOMException(o.passkeyMessage, 'NotAllowedError'));
          }
          return Reflect.apply(original, this, arguments);
        },
      }[name]!;
      replace(Credentials.prototype, name, disguise(wrapped, name, original.length));
    }
  }

  // userAgentData names Google Chrome.
  type UaData = { getHighEntropyValues: Fn; toJSON: Fn };
  const UaCtor = g['NavigatorUAData'] as { prototype: UaData } | undefined; // insecure pages have none
  if (UaCtor !== undefined && o.brands.length > 0) {
    const proto = UaCtor.prototype;
    const names = o.brands.map((b) => b.brand);
    const copy = (list: Brand[]) => list.map((b) => ({ brand: b.brand, version: b.version }));
    const frozen = Object.freeze(copy(o.brands));
    const rank = (b: Brand) => {
      const i = names.indexOf(b.brand);
      return i === -1 ? names.length : i;
    };
    const withFullVersion = (list: Brand[]) => {
      const out = copy(list);
      if (!out.some((b) => b.brand === o.chromeBrand)) out.push({ brand: o.chromeBrand, version: o.fullVersion });
      return out.sort((a, b) => rank(a) - rank(b));
    };

    const brandsGetter = Object.getOwnPropertyDescriptor(proto, 'brands')?.get;
    if (typeof brandsGetter === 'function') {
      const get = Object.getOwnPropertyDescriptor({
        get brands() {
          Reflect.apply(brandsGetter, this, []);
          return frozen;
        },
      }, 'brands')!.get as Fn;
      Object.defineProperty(proto, 'brands', { ...Object.getOwnPropertyDescriptor(proto, 'brands'), get: disguise(get, 'get brands', 0) });
    }

    const getHighEntropyValues = proto.getHighEntropyValues;
    if (typeof getHighEntropyValues === 'function') {
      const wrapped = {
        getHighEntropyValues(this: unknown, _hints: string[]) {
          return (Reflect.apply(getHighEntropyValues, this, arguments) as Promise<Record<string, unknown>>).then((values) => {
            if (Array.isArray(values['brands'])) values['brands'] = copy(o.brands);
            if (Array.isArray(values['fullVersionList'])) values['fullVersionList'] = withFullVersion(values['fullVersionList'] as Brand[]);
            return values;
          });
        },
      }.getHighEntropyValues as Fn;
      replace(proto, 'getHighEntropyValues', disguise(wrapped, 'getHighEntropyValues', getHighEntropyValues.length));
    }

    const toJSON = proto.toJSON;
    if (typeof toJSON === 'function') {
      const wrapped = {
        toJSON(this: unknown) {
          const values = Reflect.apply(toJSON, this, arguments) as Record<string, unknown>;
          if (Array.isArray(values['brands'])) values['brands'] = copy(o.brands);
          return values;
        },
      }.toJSON as Fn;
      replace(proto, 'toJSON', disguise(wrapped, 'toJSON', toJSON.length));
    }
  }

  // navigator.languages matches the Accept-Language header.
  const NavigatorCtor = g['Navigator'] as { prototype: object } | undefined;
  const languagesGetter = NavigatorCtor && Object.getOwnPropertyDescriptor(NavigatorCtor.prototype, 'languages')?.get;
  if (NavigatorCtor !== undefined && typeof languagesGetter === 'function' && o.languages.length > 0) {
    const languages = Object.freeze([...o.languages]);
    const get = Object.getOwnPropertyDescriptor({
      get languages() {
        Reflect.apply(languagesGetter, this, []);
        return languages;
      },
    }, 'languages')!.get as Fn;
    Object.defineProperty(NavigatorCtor.prototype, 'languages', {
      ...Object.getOwnPropertyDescriptor(NavigatorCtor.prototype, 'languages'), get: disguise(get, 'get languages', 0),
    });
  }

  // window.chrome like Chrome's (only what is missing).
  if (typeof g['chrome'] !== 'object' || g['chrome'] === null) g['chrome'] = {};
  const chrome = g['chrome'] as Record<string, unknown>;
  const timing = () => {
    const perf = g['performance'] as { timeOrigin: number; now(): number; getEntriesByType(t: string): Record<string, unknown>[] } | undefined;
    const nav = perf?.getEntriesByType('navigation')[0] ?? {};
    const paint = perf?.getEntriesByType('paint').find((e) => e['name'] === 'first-paint');
    const origin = perf?.timeOrigin ?? Date.now();
    const at = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? (origin + ms) / 1000 : 0);
    const protocol = typeof nav['nextHopProtocol'] === 'string' && nav['nextHopProtocol'] !== '' ? nav['nextHopProtocol'] as string : 'http/1.1';
    return { perf, nav, paint, origin, at, protocol };
  };
  if (!('app' in chrome)) {
    chrome['app'] = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: disguise({ getDetails() { return null; } }.getDetails, 'getDetails', 0),
      getIsInstalled: disguise({ getIsInstalled() { return false; } }.getIsInstalled, 'getIsInstalled', 0),
      installState: disguise({
        installState(callback?: (state: string) => void) { if (typeof callback === 'function') setTimeout(() => callback('not_installed'), 0); },
      }.installState as Fn, 'installState', 0),
      runningState: disguise({ runningState() { return 'cannot_run'; } }.runningState, 'runningState', 0),
    };
  }
  if (!('csi' in chrome)) {
    chrome['csi'] = disguise({
      csi() {
        const t = timing();
        const loadEnd = typeof t.nav['loadEventEnd'] === 'number' ? t.nav['loadEventEnd'] as number : 0;
        return { startE: Math.round(t.origin), onloadT: loadEnd > 0 ? Math.round(t.origin + loadEnd) : 0, pageT: t.perf ? t.perf.now() : 0, tran: 15 };
      },
    }.csi, 'csi', 0);
  }
  if (!('loadTimes' in chrome)) {
    chrome['loadTimes'] = disguise({
      loadTimes() {
        const t = timing();
        const multiplexed = /^h[23]/.test(t.protocol);
        return {
          requestTime: t.origin / 1000,
          startLoadTime: t.origin / 1000,
          commitLoadTime: t.at(t.nav['responseStart']),
          finishDocumentLoadTime: t.at(t.nav['domContentLoadedEventEnd']),
          finishLoadTime: t.at(t.nav['loadEventEnd']),
          firstPaintTime: t.at(t.paint?.['startTime']),
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: multiplexed,
          wasNpnNegotiated: multiplexed,
          npnNegotiatedProtocol: multiplexed ? t.protocol : 'unknown',
          wasAlternateProtocolAvailable: false,
          connectionInfo: t.protocol,
        };
      },
    }.loadTimes, 'loadTimes', 0);
  }
}
