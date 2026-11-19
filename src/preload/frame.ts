import { contextBridge } from 'electron';
import { CHROME_BRAND, chromeMajor, withChromeBrand, type Brand } from '../core/identity.ts';

/*
 * Runs in every page of every profile session (registered by sessions.ts), before the page's scripts.
 * It exposes nothing to pages: the functions below are serialized by `executeInMainWorld` and run in the
 * page's world, so they may use only their arguments and globals (no module scope, no imports).
 */

/**
 * Electron has no passkey UI, so a WebAuthn request would wait forever (Google's sign-in hangs on its
 * passkey step). Passkey requests (`publicKey` option) fail at once instead, so sites offer another way;
 * other credential calls (passwords, federated) are untouched.
 */
function failPasskeysFast(message: string): void {
  if (typeof CredentialsContainer === 'undefined') return; // insecure contexts have no navigator.credentials
  const proto = CredentialsContainer.prototype;
  for (const name of ['get', 'create'] as const) {
    const original = proto[name] as (this: CredentialsContainer, options?: CredentialRequestOptions) => Promise<Credential | null>;
    if (typeof original !== 'function') continue;
    const wrapped = {
      [name](this: CredentialsContainer, options?: CredentialRequestOptions & CredentialCreationOptions) {
        if (options != null && typeof options === 'object' && options.publicKey != null) {
          return Promise.reject(new DOMException(message, 'NotAllowedError'));
        }
        return Reflect.apply(original, this, arguments);
      },
    }[name];
    Object.defineProperty(proto, name, { ...Object.getOwnPropertyDescriptor(proto, name), value: wrapped });
  }
}

/** The part of `NavigatorUAData` (not in TypeScript's DOM lib) this file touches. */
type UaData = {
  brands: Brand[];
  getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
  toJSON(): Record<string, unknown>;
};

/**
 * `navigator.userAgentData` names Google Chrome like the Sec-CH-UA headers (sessions.ts): `brands` (and
 * `toJSON`, `getHighEntropyValues(['brands'])`) return `brands`, computed by `withChromeBrand`; a
 * `fullVersionList` gets Google Chrome `fullVersion` and the same brand order. The originals still run first,
 * so calls on a wrong receiver throw as before.
 */
function presentAsChrome(brands: Brand[], chromeBrand: string, fullVersion: string): void {
  const Ctor = (globalThis as { NavigatorUAData?: { prototype: UaData } }).NavigatorUAData;
  if (Ctor === undefined) return; // insecure contexts have no navigator.userAgentData
  const proto = Ctor.prototype;
  const names = brands.map((b) => b.brand);
  const copy = (list: Brand[]) => list.map((b) => ({ brand: b.brand, version: b.version }));
  const frozen = Object.freeze(copy(brands));
  const rank = (b: Brand) => {
    const i = names.indexOf(b.brand);
    return i === -1 ? names.length : i;
  };
  const withFullVersion = (list: Brand[]) => {
    const out = copy(list);
    if (!out.some((b) => b.brand === chromeBrand)) out.push({ brand: chromeBrand, version: fullVersion });
    return out.sort((a, b) => rank(a) - rank(b));
  };

  const brandsGetter = Object.getOwnPropertyDescriptor(proto, 'brands')?.get;
  if (typeof brandsGetter === 'function') {
    const get = Object.getOwnPropertyDescriptor({
      get brands() {
        Reflect.apply(brandsGetter, this, []);
        return frozen;
      },
    }, 'brands')!.get;
    Object.defineProperty(proto, 'brands', { ...Object.getOwnPropertyDescriptor(proto, 'brands'), get });
  }

  const getHighEntropyValues = proto.getHighEntropyValues;
  if (typeof getHighEntropyValues === 'function') {
    const wrapped = {
      getHighEntropyValues(this: UaData, _hints: string[]) {
        return (Reflect.apply(getHighEntropyValues, this, arguments) as Promise<Record<string, unknown>>).then((values) => {
          if (Array.isArray(values['brands'])) values['brands'] = copy(brands);
          if (Array.isArray(values['fullVersionList'])) values['fullVersionList'] = withFullVersion(values['fullVersionList'] as Brand[]);
          return values;
        });
      },
    }.getHighEntropyValues;
    Object.defineProperty(proto, 'getHighEntropyValues', { ...Object.getOwnPropertyDescriptor(proto, 'getHighEntropyValues'), value: wrapped });
  }

  const toJSON = proto.toJSON;
  if (typeof toJSON === 'function') {
    const wrapped = {
      toJSON(this: UaData) {
        const values = Reflect.apply(toJSON, this, arguments) as Record<string, unknown>;
        if (Array.isArray(values['brands'])) values['brands'] = copy(brands);
        return values;
      },
    }.toJSON;
    Object.defineProperty(proto, 'toJSON', { ...Object.getOwnPropertyDescriptor(proto, 'toJSON'), value: wrapped });
  }
}

contextBridge.executeInMainWorld({ func: failPasskeysFast, args: ['Passkeys are not supported in Superbrowser yet'] });

// This (isolated) world sees the same Electron brands as the page; the page gets them with Google Chrome added.
const uaData = (navigator as { userAgentData?: UaData }).userAgentData;
const chromeVersion = process.versions.chrome;
if (uaData !== undefined && typeof chromeVersion === 'string') {
  const major = chromeMajor(chromeVersion);
  const brands = withChromeBrand(uaData.brands, major, Number(major));
  contextBridge.executeInMainWorld({ func: presentAsChrome, args: [brands, CHROME_BRAND, chromeVersion] });
}
