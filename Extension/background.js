import { buildReport, claimFromUrl } from "./report.js";

const ENDPOINT = "http://127.0.0.1:47321/report";
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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "claim") return;
  const dir = claimFromUrl(msg.url);
  if (!dir) return;
  chrome.storage.local.set({ profileDir: dir }).then(async () => {
    await sendReport();
    if (sender.tab && sender.tab.id != null) chrome.tabs.remove(sender.tab.id);
  });
});

scheduleReport();
