/**
 * Content script entry — wires panel + DOM observation on x.com / twitter.com
 */

(function () {
  "use strict";

  if (window.__NARV_LOADED__) return;
  window.__NARV_LOADED__ = true;

  function init() {
    if (!window.NARVPanel) {
      console.warn("[NARV] Panel module missing");
      return;
    }
    NARVPanel.ensureRoot();
    NARVPanel.injectTweetButtons();

    // Re-inject buttons as timeline virtualizes
    const obs = new MutationObserver(() => {
      NARVPanel.injectTweetButtons();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Keyboard shortcut: Alt+Shift+N
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        NARVPanel.openPanel();
        NARVPanel.validateActive();
      }
    });

    // Messages from popup / background
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || !msg.type) return;

        if (msg.type === "NARV_VALIDATE_ACTIVE") {
          NARVPanel.validateActive().then(() => sendResponse({ ok: true }));
          return true;
        }
        if (msg.type === "NARV_OPEN_PANEL") {
          NARVPanel.openPanel();
          sendResponse({ ok: true });
        }
        if (msg.type === "NARV_SCAN") {
          NARVPanel.openPanel();
          document.getElementById("narv-validate-hover")?.click();
          sendResponse({ ok: true });
        }
        if (msg.type === "NARV_PING") {
          sendResponse({
            ok: true,
            url: location.href,
            version: "1.0.0",
          });
        }
      });
    } catch {
      /* not in extension context */
    }

    console.info(
      "[NARV] Nano Algorithm Rank Validator ready — Alt+Shift+N to validate"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
