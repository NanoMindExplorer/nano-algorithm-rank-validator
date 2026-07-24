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
    await chrome.tabs.sendMessage(tab.id, { type });
    status.textContent = "Sent ✓";
  } catch (e) {
    status.textContent = "Reload x.com page";
  }
}

document.getElementById("btn-validate").addEventListener("click", () => {
  send("NARV_VALIDATE_ACTIVE");
});
document.getElementById("btn-scan").addEventListener("click", () => {
  send("NARV_SCAN");
});
document.getElementById("btn-open").addEventListener("click", () => {
  send("NARV_OPEN_PANEL");
});
document.getElementById("btn-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

activeTab().then((tab) => {
  const status = document.getElementById("status");
  if (tab && isX(tab.url || "")) status.textContent = "Connected";
  else status.textContent = "Not on X";
});
