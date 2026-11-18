import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, claimFromUrl } from "../report.js";

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

test("claimFromUrl decodes profile dir", () => {
  assert.equal(claimFromUrl("http://127.0.0.1:47321/claim?dir=Profile%2037"), "Profile 37");
});

test("claimFromUrl rejects other origins", () => {
  assert.equal(claimFromUrl("http://example.com/claim?dir=Default"), null);
  assert.equal(claimFromUrl("http://127.0.0.1:47321/claim"), null);
});
