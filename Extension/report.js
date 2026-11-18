export const EXTENSION_VERSION = 1;
const CLAIM_ORIGIN = "http://127.0.0.1:47321";

export function buildReport(profileDir, windows) {
  return {
    profileDir,
    extensionVersion: EXTENSION_VERSION,
    windows: windows
      .filter((w) => w.type === "normal")
      .map((w) => ({
        id: w.id, left: w.left, top: w.top, width: w.width, height: w.height,
        focused: w.focused, state: w.state,
      })),
  };
}

export function claimFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== CLAIM_ORIGIN || u.pathname !== "/claim") return null;
  const dir = u.searchParams.get("dir");
  return dir ? dir : null;
}
