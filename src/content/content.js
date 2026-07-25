/**
 * Content script entry — follow gate + panel + sampler on x.com
 */

(function () {
  "use strict";

  if (window.__NARV_LOADED__) return;
  window.__NARV_LOADED__ = true;

  async function gated(action) {
    if (!window.NARVPanel) return { ok: false };
    if (window.NARVFollowGate) {
      const status = await NARVFollowGate.ensureFollowing({ force: false });
      if (!status.following) {
        NARVPanel.openPanel();
        return {
          ok: false,
          blocked: true,
          message: status.message,
          following: false,
        };
      }
    }
    await action();
    return { ok: true, following: true };
  }

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

    // Background follow check on load (non-blocking)
    if (window.NARVFollowGate) {
      NARVFollowGate.ensureFollowing({ force: false }).then((s) => {
        console.info(
          "[NARV] Follow gate:",
          s.following ? "unlocked" : "locked",
          s.reason || ""
        );
      });
    }

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

    document.addEventListener("keydown", (e) => {
      if (!(e.altKey && e.shiftKey)) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        gated(() => NARVPanel.validateActive());
      } else if (k === "c") {
        e.preventDefault();
        gated(() => NARVPanel.compareProfiles?.());
      } else if (k === "s") {
        e.preventDefault();
        gated(() => NARVPanel.sampleHistoryUI?.());
      }
    });

    try {
      chrome.storage.sync.get({ autoSampleEnabled: false }, (cfg) => {
        if (cfg.autoSampleEnabled && window.NARVSampler?.isLikesPage?.()) {
          setTimeout(async () => {
            if (window.NARVFollowGate) {
              const s = await NARVFollowGate.ensureFollowing({ force: false });
              if (!s.following) return;
            }
            const r = await NARVSampler.sampleVisibleAsLiked(NARVParser);
            console.info("[NARV] Auto-sampled likes:", r);
          }, 2500);
        }
      });
    } catch {
      /* ignore */
    }

    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || !msg.type) return;

        if (msg.type === "NARV_CHECK_FOLLOW") {
          if (!window.NARVFollowGate) {
            sendResponse({
              following: false,
              message: "Follow gate missing — reload extension",
            });
            return true;
          }
          NARVFollowGate.ensureFollowing({ force: !!msg.force }).then((s) => {
            if (s.following) {
              NARVPanel.refreshFollowGate?.({ force: false });
            } else {
              NARVPanel.openPanel();
            }
            sendResponse(s);
          });
          return true;
        }

        if (msg.type === "NARV_VALIDATE_ACTIVE") {
          gated(() => NARVPanel.validateActive()).then(sendResponse);
          return true;
        }
        if (msg.type === "NARV_OPEN_PANEL") {
          NARVPanel.openPanel();
          sendResponse({ ok: true });
        }
        if (msg.type === "NARV_SCAN") {
          gated(() =>
            NARVPanel.scanTimeline?.() ||
            Promise.resolve(document.getElementById("narv-validate-hover")?.click())
          ).then(sendResponse);
          return true;
        }
        if (msg.type === "NARV_COMPARE") {
          gated(() => NARVPanel.compareProfiles?.()).then(sendResponse);
          return true;
        }
        if (msg.type === "NARV_SAMPLE") {
          gated(() => NARVPanel.sampleHistoryUI?.()).then(sendResponse);
          return true;
        }
        if (msg.type === "NARV_SHADOWBAN") {
          gated(() => NARVPanel.shadowbanUI?.()).then(sendResponse);
          return true;
        }
        if (msg.type === "NARV_UNFOLLOW") {
          gated(() => NARVPanel.massUnfollowUI?.()).then(sendResponse);
          return true;
        }
        if (msg.type === "NARV_PING") {
          sendResponse({
            ok: true,
            url: location.href,
            version: "1.5.0",
          });
        }
      });
    } catch {
      /* not in extension context */
    }

    console.info(
      "[NARV] v1.5 ready — mass unfollow · shadowban · follow @Deadmouse_jpeg"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
