# Google sign-in inside Superbrowser: close the Chrome-identity gaps

Status: 2026-11-20, items 4 and 5 shipped first (plan `2026-11-20-withhold-device-bound-google-logins.md`). Later the
same day, after Google still rejected a sign-in, the user asked for items 1–3 ("fix it"): plan
`2026-11-20-google-sign-in-identity.md`. Size: a small change each.

Calls made for items 1–3 (the builder's):
- Header brand lists come from the version alone: Chromium's GREASE rule (`Not<c1>A<c2>Brand`, chars
  ` (:-./);=?_` at seed%11 and (seed+1)%11, version 8/99/24 at seed%3, seed = major) reproduces what Electron 156 and
  Chrome 158 send, so navigations get the same `Sec-CH-UA` subresources already carry.
- High-entropy values: platform version from `process.getSystemVersion()` padded to three parts, arch `arm`/`x86`,
  bitness `64`, model empty, wow64 `?0`, form factors `"Desktop"`: the values Chrome sent in the probe.
- All page-world changes run in one serialized function, so one private registry makes every replaced function
  report `function <name>() { [native code] }`, including `Function.prototype.toString` itself.
- Languages: `session.setUserAgent(ua, languages)` with each system language followed by its base language.

Calls made for items 4–5 (the builder's, stated to the user):
- "Google's cookies" means hosts `google.com`, `google.<cc>`, `google.co.<cc>`, `google.com.<cc>`, `youtube.com` and
  their subdomains: one Google sign-in sets its session on all of them. They are withheld before decryption.
- A profile is device-bound when its `Device Bound Sessions` table has a key whose host is one of those. No file:
  not bound. A file that exists but can't be read: treated as bound (logged), so Chrome's session is never put at risk.
- The result counts withheld cookies separately (`withheld`), and the sheet says Google wasn't copied and why.
- The Replace Logins prompt no longer says "Use this if Superbrowser got signed out", and the import explanation no
  longer promises only an occasional Google sign-out.

## Why

Personal (Chrome profile `Default`) was signed out of Google and Zalo overnight and can't sign back in.
Investigation on 2026-11-20:

- Personal is the only profile open in Chrome (`Local State` → `last_active_profiles: ["Default"]`), so its
  imported logins are copies of sessions Chrome is using at the same moment. Zalo renewed its key in Chrome
  12 minutes after the import (`zpw_sek`) and dropped Superbrowser's copy; Google recreated Chrome's web session at
  21:47 and dropped the copy. Chrome's Personal Google login is also device-bound (`Device Bound Sessions` holds
  `https://google.com`), so a copy can't keep working. Replace Logins re-copies the same session and can't help.
  The other profiles stayed signed in (the user checked NSM Infosys, `Profile 37`): they aren't open in Chrome,
  and none has a device-bound Google login.
- A fresh Google sign-in in Superbrowser lands on `accounts.google.com/v3/signin/rejected` ("This browser or app
  may not be secure"): Google classifies Superbrowser as an embedded browser.

The user wants Google in Personal to work **inside Superbrowser** (no hand-off to Chrome). That needs Personal to
have its own Google session, which needs Google's sign-in to accept Superbrowser.

## What differs from real Chrome today (measured)

A local probe page loaded in Superbrowser's session setup (same UA, header rewrite, frame preload) and in
Chrome 158 headless:

| Signal | Chrome | Superbrowser |
|---|---|---|
| `Sec-CH-UA`, `-Mobile`, `-Platform` on page loads (navigations) | always sent | **missing** |
| High-entropy hints after the site asks (`Accept-CH`) | sent (arch, bitness, model, platform version, full version list, wow64, form factors) | **never sent** (Electron ignores `Accept-CH`) |
| `window.chrome` | `app`, `csi`, `loadTimes` | **empty object** |
| `toString()` of `navigator.credentials.get`, the `userAgentData` getters | `function … { [native code] }` | **our wrapper's source code** |
| `Accept-Language` / `navigator.languages` | `en-US,en;q=0.9` / `["en-US","en"]` | `en-US` / `["en-US"]` |
| Version | 158 (installed Chrome) | 156 (Electron 45.4.1 is the latest stable) |

`navigator.webdriver`, plugins, vendor, platform, WebGL and the JS `userAgentData` values already match.

## Approaches

1. **Close the Chrome-identity gaps** (chosen by the user). One consistent Chrome identity everywhere; lowest
   account risk; may not be enough, since Google doesn't say what it checks.
2. Present as Firefox on Google's sign-in pages only. Usually passes, but two identities for one account, and a
   small flagging risk. Not chosen; the fallback if 1 fails and the user agrees.
3. Hand Google pages off to Chrome. Rejected: the user wants everything in Superbrowser.

## Design

1. **Client hints like Chrome** (`src/core/clientHints.ts`, wired in `sessions.ts`):
   - Every request to a secure origin (https, localhost) carries `Sec-CH-UA` (with Google Chrome, as now),
     `Sec-CH-UA-Mobile: ?0` and `Sec-CH-UA-Platform: "macOS"`, added when Electron left them out (page loads).
   - When a response's `Accept-CH` asks for high-entropy hints, later requests to that origin carry them with
     the same values `navigator.userAgentData.getHighEntropyValues` gives (one source for both). Remembered per
     profile session for the app run, like Chrome's per-origin memory; never shared across profiles.
   - Only Chrome's hint set; header values follow Chrome's formats exactly (as in the table's Chrome column).
2. **JS signals like Chrome** (`src/preload/frame.ts`): the wrapped functions and getters report
   `function <name>() { [native code] }` from `toString()`; `window.chrome` gets `app`, `csi` and `loadTimes` with
   Chrome's shapes. Still runs via `executeInMainWorld`, exposes no API to pages.
3. **Languages like Chrome**: `Accept-Language` and `navigator.languages` include the base language
   (`en-US,en;q=0.9`), if Electron allows setting it at startup; otherwise left as is (builder's call).
4. **Don't copy device-bound Google logins**: importing logins (add or replace) skips Google's cookies
   (`google.com` and its sign-in hosts) for a profile whose Chrome `Device Bound Sessions` lists
   `https://google.com`, and the result sheet says that profile needs a Google sign-in in Superbrowser.
   Read-only, from a temp copy, like `Cookies`.
5. **Docs**: README known limits: replace "Google may occasionally sign one browser out… use Replace Logins" with
   the real rule: a profile you also use in Chrome at the same time should sign in to Google (and Zalo) inside
   Superbrowser rather than copy Chrome's logins. Plan deviations updated.
6. **Electron** stays on the latest stable (45.4.1); the version gap to installed Chrome can't be closed by us.

## Goals, non-goals, anti-goals

- Goal: the user can sign in to Google in Personal inside Superbrowser, and stays signed in.
- Non-goal: per-site identities, defeating any specific Google check, password autofill, passkeys.
- Anti-goals (from the v2 spec): no cross-profile leaks (hint memory per session); don't get an account flagged
  (first sign-in test on Personal only, never a client profile); never automate sign-in; never write Chrome data.

## Verification

Unit tests for `clientHints.ts` and the import skip rule. Then the probe page again (headers and JS signals
match Chrome's column), then the user signs in to Google in Personal by hand. If Google still rejects, stop and
bring approach 2 back to the user; nothing else is tried without asking.

## Left to the builder

Exact hint memory structure; how `Accept-CH` is read (`onHeadersReceived`); `loadTimes`/`csi` return shapes
copied from Chrome; whether the `[native code]` disguise covers `Function.prototype.toString` itself.
