import { contextBridge } from 'electron';
import { acceptLanguages } from '../core/clientHints.ts';
import { CHROME_BRAND, chromeMajor, withChromeBrand, type Brand } from '../core/identity.ts';
import { presentAsChrome } from '../core/pageIdentity.ts';

/*
 * Runs in every page of every profile session (registered by sessions.ts), before the page's scripts.
 * It exposes nothing to pages: `presentAsChrome` is serialized by `executeInMainWorld` and runs in the page's
 * world (passkeys fail fast, userAgentData names Google Chrome, window.chrome like Chrome's; see pageIdentity.ts).
 */

// This (isolated) world sees the same Electron brands as the page; the page gets them with Google Chrome added.
const uaData = (navigator as { userAgentData?: { brands: Brand[] } }).userAgentData;
const chromeVersion = process.versions.chrome ?? '';
const major = chromeMajor(chromeVersion);
// navigator.languages gets the list the session sends as Accept-Language (from the same system languages).
const languages = acceptLanguages(navigator.languages).split(',');
const brands = uaData !== undefined && chromeVersion !== '' ? withChromeBrand(uaData.brands, major, Number(major)) : [];

contextBridge.executeInMainWorld({
  func: presentAsChrome,
  args: [{ brands, chromeBrand: CHROME_BRAND, fullVersion: chromeVersion, passkeyMessage: 'Passkeys are not supported in Superbrowser yet', languages }],
});
