import { buildReport, nonceFromClaimUrl, profileDirFromConfirmReply } from "./report.js";

const ENDPOINT = "http://127.0.0.1:47321/report";
const CONFIRM_ENDPOINT = "http://127.0.0.1:47321/claim/confirm";
let timer = null;

async function sendReport() {
  try {
    const { profileDir } = await chrome.storage.local.get("profileDir");
    if (!profileDir) return;
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildReport(profileDir, windows)),
    });
  } catch (_) {
    // App may not be running; ignore.
  }
}

function scheduleReport() {
  clearTimeout(timer);
  timer = setTimeout(sendReport, 100);
}

chrome.runtime.onStartup.addListener(scheduleReport);
chrome.windows.onCreated.addListener(scheduleReport);
chrome.windows.onRemoved.addListener(scheduleReport);
chrome.windows.onBoundsChanged.addListener(scheduleReport);
chrome.windows.onFocusChanged.addListener(scheduleReport);
chrome.alarms.create("report", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(scheduleReport);

/** Trades a claim nonce for the profile dir the app issued it for; null if the app doesn't know it. */
async function confirmClaim(nonce) {
  try {
    const res = await fetch(CONFIRM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce }),
    });
    if (!res.ok) return null;
    return profileDirFromConfirmReply(await res.json());
  } catch (_) {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "claim") return;
  const nonce = nonceFromClaimUrl(msg.url);
  if (!nonce) return;
  confirmClaim(nonce).then(async (dir) => {
    if (!dir) return;
    await chrome.storage.local.set({ profileDir: dir });
    await sendReport();
    if (sender.tab && sender.tab.id != null) chrome.tabs.remove(sender.tab.id);
  });
});

scheduleReport();
