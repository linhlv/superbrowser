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

/** The one-time nonce in a Superbrowser claim URL, or null. The profile dir is never taken from the URL. */
export function nonceFromClaimUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== CLAIM_ORIGIN || u.pathname !== "/claim") return null;
  const nonce = u.searchParams.get("nonce");
  return nonce && /^[0-9a-f]{32}$/.test(nonce) ? nonce : null;
}

/** The profile dir in the app's `POST /claim/confirm` reply, or null. */
export function profileDirFromConfirmReply(reply) {
  const dir = reply && reply.profileDir;
  return typeof dir === "string" && dir ? dir : null;
}
