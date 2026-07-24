async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isX(url = "") {
  return /https:\/\/(x|twitter|mobile\.x|mobile\.twitter)\.com\//.test(url);
}

async function send(type) {
  const tab = await activeTab();
  const status = document.getElementById("status");
  if (!tab?.id || !isX(tab.url || "")) {
    status.textContent = "Open x.com first";
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type });
    if (res && res.blocked) {
      status.textContent = "Follow required";
      showGate(res.message || "Follow @Deadmouse_jpeg dulu");
      return;
    }
    status.textContent = "Sent ✓";
  } catch {
    status.textContent = "Reload x.com page";
  }
}

function showGate(msg) {
  document.getElementById("gate-block").hidden = false;
  document.getElementById("actions-block").hidden = true;
  if (msg) document.getElementById("gate-msg").textContent = msg;
}

function showActions() {
  document.getElementById("gate-block").hidden = true;
  document.getElementById("actions-block").hidden = false;
}

async function checkFollowFromPage() {
  const tab = await activeTab();
  const status = document.getElementById("status");
  if (!tab?.id || !isX(tab.url || "")) {
    showGate("Buka x.com (login) untuk verifikasi follow.");
    status.textContent = "Not on X";
    return false;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "NARV_CHECK_FOLLOW",
      force: true,
    });
    if (res?.following) {
      showActions();
      status.textContent = "Unlocked";
      return true;
    }
    showGate(res?.message || "Belum follow @Deadmouse_jpeg");
    status.textContent = "Locked";
    return false;
  } catch {
    showGate("Reload halaman x.com, lalu buka popup lagi.");
    status.textContent = "Reload x.com";
    return false;
  }
}

document.getElementById("btn-validate")?.addEventListener("click", () => {
  send("NARV_VALIDATE_ACTIVE");
});
document.getElementById("btn-scan")?.addEventListener("click", () => {
  send("NARV_SCAN");
});
document.getElementById("btn-compare")?.addEventListener("click", () => {
  send("NARV_COMPARE");
});
document.getElementById("btn-sample")?.addEventListener("click", () => {
  send("NARV_SAMPLE");
});
document.getElementById("btn-open")?.addEventListener("click", () => {
  send("NARV_OPEN_PANEL");
});
document.getElementById("btn-options")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById("btn-recheck")?.addEventListener("click", () => {
  document.getElementById("gate-msg").textContent = "Checking…";
  checkFollowFromPage();
});

chrome.storage.sync.get(
  { profileId: "balanced", useSidecar: false, sidecarMode: "hash" },
  (s) => {
    const line = document.getElementById("profile-line");
    if (line) {
      line.textContent = `Profile: ${s.profileId}${
        s.useSidecar ? ` · sidecar ${s.sidecarMode || "hash"}` : ""
      }`;
    }
  }
);

checkFollowFromPage();
