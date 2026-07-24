/**
 * Follow gate — tools require following @Deadmouse_jpeg on X.
 *
 * Verifies via X web API (session cookies on x.com) when possible.
 * Caches positive results briefly; negative/unknown always re-checkable.
 */

(function (root) {
  "use strict";

  const REQUIRED_HANDLE = "Deadmouse_jpeg";
  const PROFILE_URL = `https://x.com/${REQUIRED_HANDLE}`;
  const CACHE_KEY = "narvFollowGate";
  const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for positive only

  // Public X web client bearer (same as x.com frontend bundle)
  const X_BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  function getCookie(name) {
    try {
      const m = document.cookie.match(
        new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
      );
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  async function readCache() {
    try {
      const data = await chrome.storage.local.get({ [CACHE_KEY]: null });
      return data[CACHE_KEY] || null;
    } catch {
      return null;
    }
  }

  async function writeCache(payload) {
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: payload });
    } catch {
      /* ignore */
    }
  }

  async function clearCache() {
    try {
      await chrome.storage.local.remove(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * Primary: friendships/show.json as logged-in user.
   */
  async function checkViaApi() {
    const ct0 = getCookie("ct0");
    if (!ct0) {
      return {
        following: false,
        reason: "not_logged_in",
        message: "Login ke X dulu, lalu cek ulang.",
      };
    }

    const url =
      `https://x.com/i/api/1.1/friendships/show.json?` +
      `target_screen_name=${encodeURIComponent(REQUIRED_HANDLE)}`;

    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${X_BEARER}`,
        "x-csrf-token": ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return {
        following: false,
        reason: "auth_failed",
        message: "Sesi X tidak valid. Refresh halaman atau login ulang.",
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Friendships API HTTP ${res.status}: ${text.slice(0, 120)}`);
    }

    const data = await res.json();
    const following = !!(
      data?.relationship?.source?.following ||
      data?.relationship?.target?.followed_by
    );

    return {
      following,
      reason: following ? "ok" : "not_following",
      message: following
        ? `Terhubung — following @${REQUIRED_HANDLE}`
        : `Follow @${REQUIRED_HANDLE} dulu untuk membuka tools.`,
      raw: {
        following,
        source: data?.relationship?.source || null,
      },
    };
  }

  /**
   * Fallback: open profile relationship via GraphQL UserByScreenName if available,
   * else inspect DOM if user is already on the required profile.
   */
  async function checkViaDomFallback() {
    const path = (location.pathname || "").replace(/\/$/, "");
    const onProfile =
      path.toLowerCase() === `/${REQUIRED_HANDLE.toLowerCase()}` ||
      path.toLowerCase() === `/${REQUIRED_HANDLE.toLowerCase()}/`;

    if (onProfile) {
      // Following button states on X
      const followingBtn =
        document.querySelector('[data-testid$="-unfollow"]') ||
        document.querySelector('[data-testid="placementTracking"] [data-testid$="-unfollow"]') ||
        [...document.querySelectorAll('[role="button"]')].find((el) =>
          /following|mengikuti/i.test(el.getAttribute("aria-label") || el.textContent || "")
        );
      const followBtn = [...document.querySelectorAll('[role="button"]')].find((el) => {
        const t = (el.getAttribute("aria-label") || el.textContent || "").trim();
        return /^follow |^ikuti /i.test(t) && !/following|mengikuti/i.test(t);
      });

      if (followingBtn) {
        return {
          following: true,
          reason: "ok_dom",
          message: `Following @${REQUIRED_HANDLE} (terdeteksi di profil)`,
        };
      }
      if (followBtn) {
        return {
          following: false,
          reason: "not_following",
          message: `Kamu belum follow @${REQUIRED_HANDLE}. Klik Follow di profil ini.`,
        };
      }
    }

    return {
      following: false,
      reason: "unknown",
      message: "Tidak bisa memverifikasi follow. Buka profil @Deadmouse_jpeg lalu cek ulang.",
    };
  }

  /**
   * Full check with cache for positive results.
   * @param {{ force?: boolean }} opts
   */
  async function ensureFollowing(opts = {}) {
    const force = !!opts.force;

    if (!force) {
      const cached = await readCache();
      if (
        cached &&
        cached.following === true &&
        cached.checkedAt &&
        Date.now() - cached.checkedAt < CACHE_TTL_MS
      ) {
        return {
          following: true,
          reason: "cache",
          message: cached.message || `Following @${REQUIRED_HANDLE}`,
          fromCache: true,
          requiredHandle: REQUIRED_HANDLE,
          profileUrl: PROFILE_URL,
        };
      }
    }

    let result;
    try {
      result = await checkViaApi();
    } catch (e) {
      try {
        result = await checkViaDomFallback();
        result.apiError = e.message || String(e);
      } catch (e2) {
        result = {
          following: false,
          reason: "error",
          message: e.message || String(e),
        };
      }
    }

    result.requiredHandle = REQUIRED_HANDLE;
    result.profileUrl = PROFILE_URL;
    result.checkedAt = Date.now();

    if (result.following) {
      await writeCache({
        following: true,
        checkedAt: result.checkedAt,
        message: result.message,
      });
    } else {
      // Don't cache negatives long — user may follow immediately
      await writeCache({
        following: false,
        checkedAt: result.checkedAt,
        message: result.message,
      });
    }

    return result;
  }

  /**
   * Guard helper: returns true if allowed, false if blocked.
   * onBlocked(result) optional callback.
   */
  async function requireFollow(onBlocked) {
    const status = await ensureFollowing({ force: false });
    if (status.following) return true;
    if (typeof onBlocked === "function") onBlocked(status);
    return false;
  }

  const NARVFollowGate = {
    REQUIRED_HANDLE,
    PROFILE_URL,
    ensureFollowing,
    requireFollow,
    clearCache,
    checkViaApi,
  };

  root.NARVFollowGate = NARVFollowGate;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVFollowGate;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
