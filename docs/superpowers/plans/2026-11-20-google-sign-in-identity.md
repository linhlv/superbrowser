# Google sign-in identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the measured gaps between Superbrowser's identity and Chrome's (spec items 1–3), so Google may accept a sign-in.

**Architecture:** Pure rules in `src/core` (`identity.ts` brand list from the version, new `clientHints.ts` for headers and `Accept-CH`, new `pageIdentity.ts` holding the one serialized page-world function). `sessions.ts` wires headers and languages per profile session; `frame.ts` runs the page function once.

**Tech Stack:** TypeScript, Electron 45 `webRequest`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-google-sign-in-identity-design.md` (items 1–3 and the items 1–3 "Calls made").

## Global Constraints

- Header and JS values must equal Chrome's formats in the spec's table (Chrome column); `Sec-CH-UA` keeps "Google Chrome" (`withChromeBrand` order).
- Hints only to secure URLs (https, and http://localhost / 127.0.0.1 / [::1]); `Accept-CH` memory per profile session, per origin, for the app run; never shared across profiles.
- `frame.ts` still exposes nothing to pages; the page function uses only its arguments and globals.
- Passkey fail-fast behaviour unchanged.
- No version is hard-coded; everything derives from `process.versions.chrome`.

## Review Focus

- A page that calls `Function.prototype.toString` on a replaced function, on `toString` itself, or via `Function.prototype.toString.call` → native-looking text (Task 3 test).
- A non-secure http page gets no added hints (Task 2 test).
- An origin that never sent `Accept-CH` gets only the low-entropy three (Task 2 test).
- A response with `Accept-CH` in odd case/spacing (`sec-ch-ua-arch , Sec-CH-UA-Model`) is understood (Task 2 test).
- Existing `Sec-CH-UA` headers Electron sends keep being rewritten exactly as before (existing identity tests stay green).

---

### Task 1: Chrome brand list from the version

**Files:** Modify `src/core/identity.ts`; Test `src/core/identity.test.ts`

**Interfaces:** Produces `greaseBrand(major: string): Brand` (version is the short form, e.g. `8`); `chromeBrands(major: string, version: string): Brand[]` = `withChromeBrand([greaseBrand, {Chromium, version}], version, Number(major))` with the GREASE version widened to `8.0.0.0` when `version` has dots.

- [ ] Test `greaseBrand('156')` → `{ brand: 'Not:A-Brand', version: '8' }`, `greaseBrand('158')` → `{ brand: 'Not.A/Brand', version: '24' }`; `formatBrands(chromeBrands('156','156'))` → `"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"`; `formatBrands(chromeBrands('158','158.0.8127.36'))` → `"Chromium";v="158.0.8127.36", "Not.A/Brand";v="24.0.0.0", "Google Chrome";v="158.0.8127.36"`.
- [ ] Run `node --test src/core/identity.test.ts` → FAIL (not exported). Implement. Run → PASS. Commit `feat(core): Chrome's brand list from the version alone`.

### Task 2: Client hints like Chrome

**Files:** Create `src/core/clientHints.ts`, `src/core/clientHints.test.ts`; Modify `src/main/sessions.ts`

**Interfaces:** Consumes `chromeBrands`, `rewriteClientHints` (identity.ts). Produces:
- `type HintValues = { major: string; fullVersion: string; platformVersion: string; arch: string; bitness: string }`
- `HIGH_ENTROPY: readonly string[]` = `sec-ch-ua-arch, sec-ch-ua-bitness, sec-ch-ua-full-version-list, sec-ch-ua-model, sec-ch-ua-platform-version, sec-ch-ua-wow64, sec-ch-ua-form-factors`
- `parseAcceptCh(value: string): string[]` (lower-cased, trimmed, only names in `HIGH_ENTROPY`)
- `isSecureUrl(url: string): boolean`
- `platformVersion(systemVersion: string): string` (`'27.3'` → `'27.3.0'`)
- `withClientHints(headers: Record<string,string>, url: string, v: HintValues, requested: ReadonlySet<string>): Record<string,string>` — runs `rewriteClientHints` first; for a secure URL adds any missing `sec-ch-ua`, `sec-ch-ua-mobile: ?0`, `sec-ch-ua-platform: "macOS"`, then each requested high-entropy hint not already present, with values: arch `"arm"`, bitness `"64"`, full-version-list `formatBrands(chromeBrands(major, fullVersion))`, model `""`, platform-version `"27.3.0"`, wow64 `?0`, form-factors `"Desktop"`. Header names lower-case, as Chrome sends them.

- [ ] Tests: navigation headers without hints on `https://accounts.google.com/` get exactly the three low-entropy hints; same with `requested = new Set(HIGH_ENTROPY)` adds all seven with the values above; `http://192.168.5.10:8123/` unchanged; `http://localhost:3000/` gets hints; existing Electron `sec-ch-ua` is rewritten, not duplicated; `parseAcceptCh('sec-ch-ua-arch , Sec-CH-UA-Model, Sec-CH-UA, foo')` → `['sec-ch-ua-arch','sec-ch-ua-model']`; `platformVersion('27.3')` → `'27.3.0'`, `('15.1.2')` → `'15.1.2'`.
- [ ] Run → FAIL; implement; run → PASS.
- [ ] Wire `sessions.ts`: per session `Map<origin, Set<string>>`; `s.webRequest.onHeadersReceived` (main-frame and sub-frame responses) records `parseAcceptCh` of `accept-ch` (replaces the origin's set, empty value clears) and passes headers through unchanged; `onBeforeSendHeaders` uses `withClientHints` with the request origin's set. `s.setUserAgent(ua, acceptLanguages(app.getPreferredSystemLanguages()))` where `acceptLanguages(tags: readonly string[]): string` (in `clientHints.ts`, tested: `['en-US']` → `'en-US,en'`, `['vi-VN','en-US']` → `'vi-VN,vi,en-US,en'`, no duplicates).
- [ ] `npm test && npm run typecheck` → PASS. Commit `feat: client hints on page loads and after Accept-CH, like Chrome`.

### Task 3: Page-world identity in one function

**Files:** Create `src/core/pageIdentity.ts`, `src/core/pageIdentity.test.ts`; Modify `src/preload/frame.ts`

**Interfaces:** Produces `presentAsChrome(o: { brands: Brand[]; chromeBrand: string; fullVersion: string; passkeyMessage: string }): void` — the current `failPasskeysFast` and `presentAsChrome` bodies merged, plus: a private `WeakMap<Function, string>` of replaced functions → `function <name>() { [native code] }`; `Function.prototype.toString` replaced by a function that answers from the map (and for itself) and otherwise calls the original; `window.chrome` gets `app` (`isInstalled: false`, `InstallState`, `RunningState`, `getDetails()`→null, `getIsInstalled()`→false, `installState(cb)`, `runningState()`→`'cannot_run'`), `csi()` and `loadTimes()` with Chrome's keys, all registered as native. Skips what already exists.

- [ ] Tests (run the function against stub globals in Node: a `CredentialsContainer` class, a `NavigatorUAData` class with `brands` getter/`getHighEntropyValues`/`toJSON`, `globalThis.chrome = {}`): passkey `get({publicKey:{}})` rejects `NotAllowedError`, `get({password:true})` calls the original; `brands` returns the given list; `Function.prototype.toString.call(CredentialsContainer.prototype.get)` → `function get() { [native code] }`; `String(Function.prototype.toString)` → `function toString() { [native code] }`; brands getter → `function get brands() { [native code] }`; an unrelated function's `toString` is its source; `Object.keys(chrome).sort()` → `['app','csi','loadTimes']`; `chrome.loadTimes()` has `requestTime`, `navigationType`, `connectionInfo`; `chrome.csi()` has `startE`, `onloadT`, `pageT`, `tran`.
- [ ] Run → FAIL; implement (move bodies from `frame.ts`); run → PASS.
- [ ] `frame.ts`: one `contextBridge.executeInMainWorld({ func: presentAsChrome, args: [{…}] })`; when `userAgentData` is missing, pass the brands step's input empty and the function skips it.
- [ ] `npm test && npm run typecheck && npm run build` → PASS. Commit `feat: page scripts see Chrome's window.chrome and native-looking functions`.

### Task 4: Verify against Chrome, docs, install

- [ ] Re-run the probe (scratchpad `probe/`, rebuilt from `dist/preload/frame.cjs` and the new `withClientHints`) and compare with Chrome's column; the differences left must be only the version and screen/WebGL.
- [ ] README known limits: drop "Client hints are incomplete"; CLAUDE.md "Browser identity": navigation hints, `Accept-CH`, `window.chrome`, native-looking replaced functions, languages; plan Deviations entry. Commit `docs: Chrome-identity gaps closed`.
- [ ] `scripts/build-app.sh --install`; the user signs in to Google in Personal by hand.
