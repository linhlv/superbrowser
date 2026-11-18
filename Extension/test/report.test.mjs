import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, nonceFromClaimUrl, profileDirFromConfirmReply } from "../report.js";

test("buildReport keeps only normal windows", () => {
  const r = buildReport("Default", [
    { id: 1, type: "normal" }, { id: 2, type: "popup" },
    { id: 3, type: "devtools" }, { id: 4, type: "app" },
  ]);
  assert.equal(r.windows.length, 1);
  assert.equal(r.profileDir, "Default");
  assert.equal(r.extensionVersion, 1);
});

test("buildReport maps bounds fields", () => {
  const r = buildReport("Default", [{
    id: 7, type: "normal", left: 10, top: 20, width: 300, height: 400,
    focused: false, state: "maximized", tabs: [{ id: 1 }],
  }]);
  assert.deepEqual(r.windows[0], {
    id: 7, left: 10, top: 20, width: 300, height: 400, focused: false, state: "maximized",
  });
});

const NONCE = "0123456789abcdef0123456789abcdef";

test("nonceFromClaimUrl reads the nonce", () => {
  assert.equal(nonceFromClaimUrl(`http://127.0.0.1:47321/claim?nonce=${NONCE}`), NONCE);
});

test("nonceFromClaimUrl rejects other origins, paths and malformed nonces", () => {
  assert.equal(nonceFromClaimUrl(`http://example.com/claim?nonce=${NONCE}`), null);
  assert.equal(nonceFromClaimUrl(`http://127.0.0.1:47321/report?nonce=${NONCE}`), null);
  assert.equal(nonceFromClaimUrl("http://127.0.0.1:47321/claim"), null);
  assert.equal(nonceFromClaimUrl("http://127.0.0.1:47321/claim?nonce=Profile%2037"), null);
  assert.equal(nonceFromClaimUrl("not a url"), null);
});

test("nonceFromClaimUrl never takes a profile dir from the URL", () => {
  assert.equal(nonceFromClaimUrl("http://127.0.0.1:47321/claim?dir=Default"), null);
});

test("profileDirFromConfirmReply reads the app's answer", () => {
  assert.equal(profileDirFromConfirmReply({ profileDir: "Profile 37" }), "Profile 37");
  assert.equal(profileDirFromConfirmReply({}), null);
  assert.equal(profileDirFromConfirmReply({ profileDir: "" }), null);
  assert.equal(profileDirFromConfirmReply({ profileDir: 7 }), null);
  assert.equal(profileDirFromConfirmReply(null), null);
});
