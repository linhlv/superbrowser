# Withhold device-bound Google logins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importing logins (add or replace) never copies Google's cookies for a profile whose Chrome Google login is device-bound, and says so.

**Architecture:** Pure rules in `src/core/cookies.ts` (which hosts are Google's, whether a DBSC key list binds Google). `LoginImporter` reads a temp copy of Chrome's `Device Bound Sessions` DB, filters Google rows out before decryption and counts them in `ImportResult.withheld`. `ImportFlow` adds one line to its sheets. Docs follow.

**Tech Stack:** TypeScript, `node:test`, `sqlite3` CLI (as the cookie import already uses).

**Spec:** `docs/superpowers/specs/2026-11-20-google-sign-in-identity-design.md` (items 4 and 5 and the "Calls made" list).

## Global Constraints

- Chrome data is read-only: copy `<chromeDir>/<dir>/Device Bound Sessions` (plus `-journal`/`-wal` if present) to a temp dir, read the copy, remove the temp dir.
- Google hosts: `google.com`, `google.<cc>`, `google.co.<cc>`, `google.com.<cc>`, `youtube.com` and their subdomains, leading dot ignored.
- No `Device Bound Sessions` file: not bound. File present but unreadable: bound, and logged.
- Withheld rows are never decrypted; values and keys are never logged.
- `src/core` never imports `electron`; imports use explicit `.ts`.

## Review Focus

- A profile with a DBSC entry only for another site (`https://claude.ai`) still imports Google cookies → test in Task 1.
- `google.com.vn`/`.youtube.com` cookies are withheld, `notgoogle.com`/`google.example` are not → test in Task 1.
- An unreadable DBSC file withholds Google and logs → test in Task 2.
- A bound profile with zero Google rows reports `withheld: 0` and the sheet says nothing extra → covered by Task 2's existing-tests update and Task 3's `withheld > 0` condition.
- Replace mode on a bound profile also withholds → test in Task 2.

---

### Task 1: Google host and binding rules (core)

**Files:**
- Modify: `src/core/cookies.ts`
- Test: `src/core/cookies.test.ts`

**Interfaces:**
- Produces: `isGoogleHost(hostKey: string): boolean`; `bindsGoogle(sessionKeys: readonly string[]): boolean` (a key is a site URL such as `https://google.com`; unparsable keys are ignored); `ImportResult` gains `withheld: number`.

- [ ] **Step 1: Write the failing tests** in `src/core/cookies.test.ts`:

```ts
test('isGoogleHost covers Google and YouTube domains and their subdomains only', () => {
  for (const h of ['.google.com', 'google.com', 'accounts.google.com', '.google.com.vn', 'google.co.uk', '.google.de', '.youtube.com', 'accounts.youtube.com'])
    assert.equal(isGoogleHost(h), true, h);
  for (const h of ['notgoogle.com', '.google.example', 'google.com.evil.io', 'example.com', 'youtube.com.au.example', ''])
    assert.equal(isGoogleHost(h), false, h);
});

test('bindsGoogle is true only when a device-bound session is for a Google site', () => {
  assert.equal(bindsGoogle(['https://claude.ai', 'https://google.com']), true);
  assert.equal(bindsGoogle(['https://accounts.google.com']), true);
  assert.equal(bindsGoogle(['https://claude.ai']), false);
  assert.equal(bindsGoogle([]), false);
  assert.equal(bindsGoogle(['not a url']), false);
});
```

- [ ] **Step 2: Run** `node --test src/core/cookies.test.ts` — Expected: FAIL (`isGoogleHost` is not exported).
- [ ] **Step 3: Implement** both functions in `src/core/cookies.ts`; add `withheld: number` to `ImportResult`. One anchored regex on the dot-stripped, lower-cased host: `(^|\.)(google\.(com|co)(\.[a-z]{2})?|google\.[a-z]{2}|youtube\.com)$`.
- [ ] **Step 4: Run** `node --test src/core/cookies.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): rules for Google hosts and device-bound Google sessions`.

### Task 2: Importer withholds Google cookies for a bound profile

**Files:**
- Modify: `src/main/importer.ts`
- Test: `src/main/importer.test.ts`

**Interfaces:**
- Consumes: `isGoogleHost`, `bindsGoogle`, `ImportResult.withheld` (Task 1).
- Produces: `importLogins` returns `{ set, skipped, failed, withheld, total }`; `total` still counts every Chrome row. Logged summary adds `, N Google withheld (device-bound)` when N > 0.

- [ ] **Step 1: Write the failing tests.** Extend `makeChromeDir` with an optional `dbsc: string[] | 'corrupt'` that writes `Profile 1/Device Bound Sessions` (`CREATE TABLE dbsc_session_tbl (key TEXT, proto BLOB, PRIMARY KEY(key))` with those keys; `'corrupt'` writes non-SQLite bytes). Add `withheld: 0` to every existing `deepEqual` result. New tests:

```ts
test('a device-bound Google login is withheld in add and replace modes', async () => {
  for (const mode of ['add', 'replace'] as const) {
    const { chromeDir, jar, importer } = setup(ROWS, undefined, undefined, ['https://google.com']);
    const result = await importer.importLogins('Profile 1', mode);
    assert.deepEqual(result, { set: 1, skipped: 0, failed: 0, withheld: 7, total: 8 });
    assert.deepEqual(jar.setCalls.map((c) => c.name), ['PLAIN']);
    fs.rmSync(chromeDir, { recursive: true });
  }
});

test('a device-bound session for another site keeps Google', async () => {
  const { chromeDir, importer } = setup(ROWS, undefined, undefined, ['https://claude.ai']);
  assert.equal((await importer.importLogins('Profile 1', 'add')).withheld, 0);
  fs.rmSync(chromeDir, { recursive: true });
});

test('an unreadable Device Bound Sessions file withholds Google and logs it', async () => {
  const { chromeDir, logs, importer } = setup(ROWS, undefined, undefined, 'corrupt');
  assert.equal((await importer.importLogins('Profile 1', 'add')).withheld, 7);
  assert.ok(logs.some((l) => /Device Bound Sessions/.test(l)), logs.join('\n'));
  fs.rmSync(chromeDir, { recursive: true });
});
```

  Also assert in the first new test that no `superbrowser-dbsc-` temp dir is left (like `tempCopies`).
- [ ] **Step 2: Run** `node --test src/main/importer.test.ts` — Expected: FAIL (`withheld` missing).
- [ ] **Step 3: Implement** in `src/main/importer.ts`: private `googleBound(dir: string): Promise<boolean>` reading a temp copy (`mkdtemp` prefix `superbrowser-dbsc-`) via `sqlite3 -json … 'SELECT key FROM dbsc_session_tbl'`; missing file → `false`; any error → log `profile <dir>: reading Chrome's Device Bound Sessions failed: …` and `true`. In `importLogins`, after `readRows`, drop rows with `isGoogleHost(row.host_key)` when bound (count → `withheld`) before the decrypt loop.
- [ ] **Step 4: Run** `node --test src/main/importer.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(import): never copy a device-bound Google login from Chrome`.

### Task 3: Sheets and docs say so

**Files:**
- Modify: `src/main/importFlow.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/plans/2026-11-19-superbrowser-electron.md` (Deviations section)

**Interfaces:**
- Consumes: `ImportResult.withheld` (Task 2).

- [ ] **Step 1: Copy changes in `importFlow.ts`** (exact text):
  - `EXPLANATION` ends: `… click Allow (not Always Allow). A profile you also use in Chrome at the same time can get signed out of some sites here; sign in to those sites in Superbrowser instead.`
  - Replace confirmation: `Replace this profile's logins with Chrome's current ones?`
  - When `result.withheld > 0`, the single-profile sheet detail and the Import All line append: ` Google sign-in not copied: Chrome ties this profile's Google login to this Mac, so a copy gets signed out. Sign in to Google in Superbrowser.`
- [ ] **Step 2: Docs.** README known limits: replace the "Google may occasionally sign one browser out" bullet with: **A profile you use in Chrome at the same time can get signed out here.** Sites such as Google and Zalo end a copied login once both browsers use it. Sign in to them in Superbrowser instead of importing. Google's login isn't copied at all when Chrome ties it to the Mac. README checklist item 28 and the Replace Logins line stay. CLAUDE.md "Chrome data is read-only": add `Device Bound Sessions` to the files copied to a temp dir, and one line: a device-bound Google login is never imported (`bindsGoogle`). Plan Deviations: one entry for the changed confirmation and explanation text and the withholding rule, pointing at the 2026-11-20 spec.
- [ ] **Step 3: Verify** `npm test && npm run typecheck && npm run build` — Expected: all pass, no type errors.
- [ ] **Step 4: Commit** `docs: device-bound Google logins aren't imported; sign in instead`.
