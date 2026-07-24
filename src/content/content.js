/**
 * Content script entry — wires panel, sampler, DOM observation on x.com
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
    NARVPanel.loadSettings?.().then(() => {
      NARVPanel.injectTweetButtons();
    });
    NARVPanel.injectTweetButtons();

    // Re-inject buttons as timeline virtualizes
    let scheduled = false;
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        NARVPanel.injectTweetButtons();
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (!(e.altKey && e.shiftKey)) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        NARVPanel.openPanel();
        NARVPanel.validateActive();
      } else if (k === "c") {
        e.preventDefault();
        NARVPanel.openPanel();
        NARVPanel.compareProfiles?.();
      } else if (k === "s") {
        e.preventDefault();
        NARVPanel.openPanel();
        NARVPanel.sampleHistoryUI?.();
      }
    });

    // Auto-sample prompt once on likes page
    try {
      chrome.storage.sync.get({ autoSampleEnabled: false }, (cfg) => {
        if (
          cfg.autoSampleEnabled &&
          window.NARVSampler?.isLikesPage?.()
        ) {
          setTimeout(async () => {
            const r = await NARVSampler.sampleVisibleAsLiked(NARVParser);
            console.info("[NARV] Auto-sampled likes:", r);
          }, 2500);
        }
      });
    } catch {
      /* ignore */
    }

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
          NARVPanel.scanTimeline?.() ||
            document.getElementById("narv-validate-hover")?.click();
          sendResponse({ ok: true });
          return true;
        }
        if (msg.type === "NARV_COMPARE") {
          NARVPanel.openPanel();
          NARVPanel.compareProfiles?.().then(() => sendResponse({ ok: true }));
          return true;
        }
        if (msg.type === "NARV_SAMPLE") {
          NARVPanel.openPanel();
          NARVPanel.sampleHistoryUI?.();
          sendResponse({ ok: true });
        }
        if (msg.type === "NARV_PING") {
          sendResponse({
            ok: true,
            url: location.href,
            version: "1.2.0",
          });
        }
      });
    } catch {
      /* not in extension context */
    }

    console.info(
      "[NARV] v1.2 ready — Alt+Shift+N validate · C compare · S sample"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
